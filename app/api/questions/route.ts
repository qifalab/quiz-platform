import { env } from 'cloudflare:workers';

type StoredQuestion = {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  answer: string[];
  explanation: string;
  category: string;
};

function database() {
  if (!env.DB) throw new Error('Database binding is unavailable');
  return env.DB;
}

async function seed() {
  const db = database();
  const count = await db.prepare('SELECT COUNT(*) as count FROM questions').first<{ count: number }>();
  if (Number(count?.count || 0) > 0) return;
  const seedRows: StoredQuestion[] = [
    { id: 'q1', type: '单选题', prompt: '党的二十大报告提出，必须更好发挥法治____的保障作用，在法治轨道上全面建设社会主义现代化国家。', options: ['固根本、稳预期、利长远', '促发展、保民生、惠大众', '守底线、提效率、保增长', '谋发展、抓改革、促创新'], answer: ['A'], explanation: '全面依法治国是国家治理的一场深刻革命。法治固根本、稳预期、利长远的保障作用，需要在发展中持续发挥。', category: '理论知识' },
    { id: 'q2', type: '多选题', prompt: '下列哪些属于高质量学习计划的关键要素？', options: ['明确的目标', '可执行的时间安排', '复盘与错题整理', '只在考试前集中突击'], answer: ['A', 'B', 'C'], explanation: '清晰目标、可执行的节奏和持续复盘共同构成有效的学习闭环。', category: '学习方法' },
    { id: 'q3', type: '判断题', prompt: '错题只需要记录正确答案，不需要记录当时的错误原因。', options: ['正确', '错误'], answer: ['B'], explanation: '错题的价值在于找到错误原因，记录误区才能避免重复犯错。', category: '学习方法' },
  ];
  await db.batch(seedRows.map((row, index) => db.prepare('INSERT INTO questions (id,type,prompt,options,answer,explanation,category,sort_order) VALUES (?,?,?,?,?,?,?,?)').bind(row.id, row.type, row.prompt, JSON.stringify(row.options), JSON.stringify(row.answer), row.explanation, row.category, index)));
}

export async function GET() {
  await seed();
  const rows = await database().prepare('SELECT id,type,prompt,options,answer,explanation,category FROM questions ORDER BY sort_order,id').all<Record<string, string>>();
  return Response.json((rows.results || []).map((row) => ({ ...row, options: JSON.parse(row.options), answer: JSON.parse(row.answer) })));
}

export async function POST(request: Request) {
  const body = await request.json() as { questions?: StoredQuestion[] };
  const incoming = Array.isArray(body.questions) ? body.questions.filter((row) => row.prompt && row.answer?.length) : [];
  if (!incoming.length) return Response.json({ error: '没有可导入的题目' }, { status: 400 });
  const db = database();
  await db.batch(incoming.map((row, index) => db.prepare('INSERT OR REPLACE INTO questions (id,type,prompt,options,answer,explanation,category,sort_order) VALUES (?,?,?,?,?,?,?,?)').bind(row.id || crypto.randomUUID(), row.type || '单选题', row.prompt, JSON.stringify(row.options || []), JSON.stringify(row.answer), row.explanation || '暂无解析', row.category || '导入题库', Date.now() + index)));
  return Response.json({ imported: incoming.length });
}
