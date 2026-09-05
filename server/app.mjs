import express from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseWorkbook, validateQuestion, template } from './parser.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const decode = q => ({ ...q, options: JSON.parse(q.options), answer: JSON.parse(q.answer) });

export function createApp({ dbPath = process.env.DATABASE_PATH || './data/quiz.sqlite', adminPassword = process.env.ADMIN_PASSWORD, origin = process.env.APP_ORIGIN || 'http://localhost:3202', staticDir = resolve('dist-web') } = {}) {
  if (!adminPassword || adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must have at least 12 characters');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS banks(id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY, bank_id TEXT REFERENCES banks(id) ON DELETE CASCADE, type TEXT NOT NULL, prompt TEXT NOT NULL, options TEXT NOT NULL, answer TEXT NOT NULL, explanation TEXT NOT NULL, category TEXT NOT NULL, difficulty TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS visitors(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, created INTEGER, admin_until INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, user_id TEXT REFERENCES visitors(id), question_id TEXT REFERENCES questions(id) ON DELETE CASCADE, selected TEXT NOT NULL, correct INTEGER NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id,created);
    CREATE TABLE IF NOT EXISTS results(user_id TEXT REFERENCES visitors(id), question_id TEXT REFERENCES questions(id) ON DELETE CASCADE, correct INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(user_id,question_id));
    CREATE TABLE IF NOT EXISTS practice(id TEXT PRIMARY KEY, user_id TEXT REFERENCES visitors(id), bank_id TEXT REFERENCES banks(id) ON DELETE CASCADE, mode TEXT NOT NULL, question_ids TEXT NOT NULL, cursor INTEGER DEFAULT 0, answers TEXT NOT NULL DEFAULT '{}', drafts TEXT NOT NULL DEFAULT '{}', completed INTEGER DEFAULT 0, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS practice_user ON practice(user_id, updated);`);
  const app = express();
  app.disable('x-powered-by');
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const transact = fn => { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  function addBank(name, questions) {
    const bankId = randomUUID();
    transact(() => { run('INSERT INTO banks VALUES(?,?,?)', bankId, name, Date.now()); questions.forEach((q, i) => run('INSERT INTO questions VALUES(?,?,?,?,?,?,?,?,?,?)', randomUUID(), bankId, q.type, q.prompt, JSON.stringify(q.options), JSON.stringify(q.answer), q.explanation, q.category, q.difficulty, i)); });
    return bankId;
  }
  if (!one('SELECT id FROM banks LIMIT 1')) addBank('入门示例题库', [
    { type:'单选题', prompt:'一年有多少个月？', options:['10','11','12','13'], answer:['C'], explanation:'一年有 12 个月。', category:'常识' },
    { type:'多选题', prompt:'下列哪些是偶数？', options:['1','2','3','4'], answer:['B','D'], explanation:'能够被 2 整除的整数是偶数。', category:'数学' },
    { type:'判断题', prompt:'三角形有三条边。', options:['正确','错误'], answer:['A'], explanation:'三角形由三条线段首尾相接组成。', category:'数学' },
  ].map(validateQuestion));
  app.use('/api', (req,res,next) => { res.set('Cache-Control','no-store'); res.set('X-Content-Type-Options','nosniff'); if (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin) return res.status(403).json({ error:'请求来源不正确，请刷新页面重试' }); next(); });
  app.use(express.json({ limit: '12mb' }));
  app.get('/api/health', (req,res) => { one('SELECT 1'); res.json({ status:'ok', version:'1.0.0' }); });
  app.use('/api', (req,res,next) => {
    const token = req.headers.cookie?.match(/(?:^|;\s*)quiz_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    let user = token ? one('SELECT * FROM visitors WHERE token_hash=?', hash(token)) : null;
    if (!user) { const newToken = randomBytes(32).toString('hex'); user = { id:randomUUID(), admin_until:0 }; run('INSERT INTO visitors(id,token_hash,created) VALUES(?,?,?)',user.id,hash(newToken),Date.now()); res.set('Set-Cookie', `quiz_session=${newToken}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax${origin.startsWith('https:') ? '; Secure' : ''}`); }
    req.user = user; next();
  });
  const admin = (req,res,next) => { if (req.user.admin_until < Date.now()) return res.status(401).json({error:'请先登录题库管理'}); next(); };
  app.post('/api/admin/login', rateLimit({ windowMs:900000,limit:10,standardHeaders:true,legacyHeaders:false, message:{error:'尝试次数过多，请 15 分钟后重试'} }), (req,res) => { const supplied = String(req.body?.password || ''); if (!timingSafeEqual(Buffer.from(hash(supplied)),Buffer.from(hash(adminPassword)))) throw fail('管理密码不正确',401); run('UPDATE visitors SET admin_until=? WHERE id=?',Date.now()+8*3600000,req.user.id); res.json({ok:true}); });
  app.post('/api/admin/logout', (req,res) => { run('UPDATE visitors SET admin_until=0 WHERE id=?',req.user.id); res.json({ok:true}); });
  app.get('/api/state',(req,res) => {
    const banks = all(`SELECT b.*, COUNT(q.id) total FROM banks b LEFT JOIN questions q ON q.bank_id=b.id GROUP BY b.id ORDER BY b.created DESC`).map(b => ({...b,
      types:all('SELECT DISTINCT type FROM questions WHERE bank_id=?',b.id).map(r=>r.type), categories:all('SELECT DISTINCT category FROM questions WHERE bank_id=?',b.id).map(r=>r.category),
      ...one('SELECT COUNT(*) answered, COALESCE(SUM(r.correct),0) correct FROM results r JOIN questions q ON q.id=r.question_id WHERE r.user_id=? AND q.bank_id=?',req.user.id,b.id),
      resume:one('SELECT id, cursor, mode, question_ids FROM practice WHERE user_id=? AND bank_id=? AND completed=0 ORDER BY updated DESC LIMIT 1',req.user.id,b.id) || null,
    }));
    const summary = one('SELECT COUNT(*) answered,COALESCE(SUM(correct),0) correct FROM results WHERE user_id=?',req.user.id);
    const attempts = one('SELECT COUNT(*) total,COALESCE(SUM(correct),0) correct FROM attempts WHERE user_id=?',req.user.id);
    res.json({ admin:req.user.admin_until>Date.now(),banks,summary,attempts });
  });
  app.get('/api/questions',(req,res) => {
    const bank = one('SELECT id FROM banks ORDER BY created LIMIT 1');
    const rows = bank ? all('SELECT * FROM questions WHERE bank_id=? ORDER BY position', bank.id).map(decode) : [];
    res.json(rows);
  });
  app.post('/api/progress',(req,res) => {
    const q = one('SELECT * FROM questions WHERE id=?', String(req.body?.questionId || ''));
    if (!q) return res.status(404).json({ error:'题目不存在' });
    const selected = [...new Set(Array.isArray(req.body?.selected) ? req.body.selected.map(String) : [])].sort();
    const correct = JSON.stringify(selected) === JSON.stringify(JSON.parse(q.answer).sort());
    run('INSERT INTO attempts VALUES(?,?,?,?,?,?)', randomUUID(), req.user.id, q.id, JSON.stringify(selected), Number(correct), Date.now());
    run('INSERT INTO results VALUES(?,?,?,?) ON CONFLICT(user_id,question_id) DO UPDATE SET correct=excluded.correct,updated=excluded.updated', req.user.id, q.id, Number(correct), Date.now());
    res.json({ saved:true, correct, answer:JSON.parse(q.answer), explanation:q.explanation });
  });
  app.get('/api/wrong',(req,res) => { res.json(all(`SELECT q.id,q.bank_id,q.prompt,q.type,q.category,b.name bank_name FROM results r JOIN questions q ON q.id=r.question_id JOIN banks b ON b.id=q.bank_id WHERE r.user_id=? AND r.correct=0 ORDER BY r.updated DESC`,req.user.id)); });
  function practiceData(req,id) {
    const p = one('SELECT * FROM practice WHERE id=? AND user_id=?',id,req.user.id); if(!p) throw fail('练习不存在',404);
    const ids = JSON.parse(p.question_ids), answers = JSON.parse(p.answers);
    return {...p,answers,drafts:JSON.parse(p.drafts),question_ids:undefined,user_id:undefined,questions:ids.map(id => { const q = decode(one('SELECT * FROM questions WHERE id=?',id)); return {...q,answer:undefined,explanation:undefined}; }), bank_name:one('SELECT name FROM banks WHERE id=?',p.bank_id).name};
  }
  app.post('/api/practice',(req,res) => {
    const {bankId,type,category,mode='顺序练习'}=req.body;
    if(!one('SELECT id FROM banks WHERE id=?',String(bankId))) throw fail('题库不存在',404);
    if(!['顺序练习','随机练习','错题练习'].includes(mode)) throw fail('练习模式不正确');
    let rows=all('SELECT id,type,category FROM questions WHERE bank_id=? ORDER BY position',bankId).filter(q=>(!type||q.type===type)&&(!category||q.category===category));
    if(mode==='错题练习') { const wrong=new Set(all('SELECT question_id FROM results WHERE user_id=? AND correct=0',req.user.id).map(r=>r.question_id)); rows=rows.filter(q=>wrong.has(q.id)); }
    if(mode==='随机练习') for(let i=rows.length-1;i>0;i--) {const j=Math.floor(Math.random()*(i+1)); [rows[i],rows[j]]=[rows[j],rows[i]];}
    if(!rows.length) throw fail('当前筛选没有可练习的题目');
    const id=randomUUID(); run('INSERT INTO practice(id,user_id,bank_id,mode,question_ids,updated) VALUES(?,?,?,?,?,?)',id,req.user.id,bankId,mode,JSON.stringify(rows.map(q=>q.id)),Date.now()); res.json(practiceData(req,id));
  });
  app.get('/api/practice/:id',(req,res)=>res.json(practiceData(req,req.params.id)));
  app.patch('/api/practice/:id',(req,res)=> {
    const p=practiceData(req,req.params.id), cursor=req.body.cursor;
    if(!Number.isInteger(cursor)||cursor<0||cursor>=p.questions.length) throw fail('题目位置不正确');
    const drafts={...p.drafts}; if(req.body.selected) drafts[p.questions[cursor].id]=req.body.selected;
    run('UPDATE practice SET cursor=?,drafts=?,updated=? WHERE id=?',cursor,JSON.stringify(drafts),Date.now(),p.id); res.json({ok:true});
  });
  app.post('/api/practice/:id/answer',(req,res)=> {
    const p=practiceData(req,req.params.id), qid=req.body.questionId;
    if(!p.questions.some(q=>q.id===qid)) throw fail('题目不在当前练习中');
    if(p.answers[qid]) return res.json(p.answers[qid]);
    const q=decode(one('SELECT * FROM questions WHERE id=?',qid));
    const selected=[...new Set(Array.isArray(req.body.selected)?req.body.selected:[])].sort();
    if(!selected.length || selected.some(s=>typeof s!=='string'||!/^[A-H]$/.test(s)||s.charCodeAt(0)-65>=q.options.length)|| (q.type!=='多选题'&&selected.length!==1)) throw fail('请选择有效答案');
    const correct=JSON.stringify(selected)===JSON.stringify(q.answer.sort());
    const result={selected,correct,answer:q.answer,explanation:q.explanation};
    transact(()=> { run('INSERT INTO attempts VALUES(?,?,?,?,?,?)',randomUUID(),req.user.id,qid,JSON.stringify(selected),Number(correct),Date.now()); run('INSERT INTO results VALUES(?,?,?,?) ON CONFLICT(user_id,question_id) DO UPDATE SET correct=excluded.correct,updated=excluded.updated',req.user.id,qid,Number(correct),Date.now()); run('UPDATE practice SET answers=?,updated=? WHERE id=?',JSON.stringify({...p.answers,[qid]:result}),Date.now(),p.id); });
    res.json(result);
  });
  app.post('/api/practice/:id/finish',(req,res)=> { const p=practiceData(req,req.params.id); if(Object.keys(p.answers).length!==p.questions.length) throw fail('请完成全部题目后结束练习'); run('UPDATE practice SET completed=1,updated=? WHERE id=?',Date.now(),p.id); res.json({ok:true}); });
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});
  app.get('/api/template', async(req,res)=> { res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.set('Content-Disposition',"attachment; filename=quiz-template.xlsx"); res.send(Buffer.from(await template())); });
  app.post('/api/admin/preview',admin,upload.single('file'),async(req,res)=> { if(!req.file || !/\.xlsx$/i.test(req.file.originalname)) throw fail('请选择 .xlsx 文件'); try{res.json(await parseWorkbook(req.file.buffer));}catch(error){throw fail(`无法导入：${error.message}`);} });
  app.post('/api/admin/banks',admin,(req,res)=> { const name=String(req.body.name||'').trim(); if(!name||name.length>100)throw fail('题库名称需为 1—100 字'); if(!Array.isArray(req.body.questions)||!req.body.questions.length||req.body.questions.length>5000)throw fail('每次导入 1—5000 道题'); const qs=req.body.questions.map(validateQuestion); res.json({id:addBank(name,qs),count:qs.length}); });
  app.get('/api/admin/banks/:id',admin,(req,res)=>res.json(all('SELECT * FROM questions WHERE bank_id=? ORDER BY position',req.params.id).map(decode)));
  app.put('/api/admin/questions/:id',admin,(req,res)=> { const q=validateQuestion(req.body), old=one('SELECT bank_id FROM questions WHERE id=?',req.params.id); if(!old)throw fail('题目不存在',404); transact(()=> { run('UPDATE questions SET type=?,prompt=?,options=?,answer=?,explanation=?,category=?,difficulty=? WHERE id=?',q.type,q.prompt,JSON.stringify(q.options),JSON.stringify(q.answer),q.explanation,q.category,q.difficulty,req.params.id); run('DELETE FROM practice WHERE bank_id=?',old.bank_id); run('DELETE FROM results WHERE question_id=?',req.params.id); }); res.json({ok:true}); });
  app.delete('/api/admin/banks/:id',admin,(req,res)=> {run('DELETE FROM banks WHERE id=?',req.params.id);res.json({ok:true});});
  app.use('/api',(req,res)=>res.status(404).json({error:'接口不存在'}));
  app.use(express.static(staticDir));
  app.get('/{*path}',(req,res)=>res.sendFile(resolve(staticDir,'index.html')));
  app.use((error,req,res,next)=> {if(res.headersSent)return next(error);const status=error.status || (error instanceof multer.MulterError?400:500); if(status===500) console.error(error.message);res.status(status).json({error:status===500?'服务暂时不可用，请稍后重试':error.message});});
  return {app,db};
}
