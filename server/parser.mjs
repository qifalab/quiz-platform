import ExcelJS from 'exceljs';

export function validateQuestion(q) {
  if (!q || typeof q !== 'object') throw new Error('题目格式错误');
  const prompt = String(q.prompt || '').trim();
  const type = q.type;
  const options = Array.isArray(q.options) ? q.options.map(v => String(v).trim()) : [];
  const answer = [...new Set(Array.isArray(q.answer) ? q.answer.map(String) : [])].sort();
  if (!prompt || prompt.length > 5000) throw new Error('题干为空或超过 5000 字');
  if (!['单选题','多选题','判断题'].includes(type)) throw new Error('不支持的题型');
  if (options.length < 2 || options.length > 8 || options.some(v => !v || v.length > 2000)) throw new Error('需有 2—8 个非空选项');
  if (!answer.length || answer.some(v => !/^[A-H]$/.test(v) || v.charCodeAt(0) - 65 >= options.length)) throw new Error('答案与选项不匹配');
  if (type !== '多选题' && answer.length !== 1) throw new Error('单选和判断只能有一个答案');
  if (type === '判断题' && options.length !== 2) throw new Error('判断题必须有两个选项');
  return { prompt, type, options, answer, explanation: String(q.explanation || '').slice(0, 10000), category: String(q.category || '默认章节').slice(0, 100), difficulty: String(q.difficulty || '中').slice(0, 20) };
}

function cellText(cell) {
  const v = cell?.value;
  if (v && typeof v === 'object' && 'formula' in v) throw new Error('不支持公式单元格，请粘贴为值后导入');
  return (cell?.text || '').trim();
}
function fieldFor(value) {
  const s = value.replace(/\s/g,'');
  if (/^(题目|试题题干|试题题目|题干|question|prompt)/i.test(s)) return 'prompt';
  if (/^(试题类型|题型|题目类型|type)/i.test(s)) return 'type';
  if (/^(选项|options)/i.test(s)) return 'options';
  if (/^(答案|正确答案|answer)/i.test(s)) return 'answer';
  if (/^(试题解析|解析|答案解析|explanation)/i.test(s)) return 'explanation';
  if (/^(分类|章节|category)/i.test(s)) return 'category';
  if (/^(难易度|难度|difficulty)/i.test(s)) return 'difficulty';
  if (/^[A-H](选项)?$/i.test(s)) return s[0].toUpperCase();
  return null;
}

export function splitOptions(raw) {
  return raw.split(/[|｜\n]/).map(s => s.trim()).filter(Boolean).map(s => s.replace(/^[A-HＡ-Ｈ][.、:：)）]\s*/i, '').trim());
}

export async function parseWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const questions = [], errors = [];
  let seenRows = 0;
  for (const sheet of workbook.worksheets) {
    let header = null, headerRow = 0;
    for (let i = 1; i <= Math.min(sheet.rowCount,30); i++) {
      const fields = {};
      sheet.getRow(i).eachCell((cell, column) => { const key = fieldFor(cell.text); if (key) fields[key] = column; });
      if (fields.prompt && fields.answer) { header = fields; headerRow = i; break; }
    }
    if (!header) { errors.push({ sheet: sheet.name, row: 0, message: '没有找到包含「题目」和「答案」的表头' }); continue; }
    for (let i = headerRow + 1; i <= sheet.rowCount; i++) {
      if (++seenRows > 5000) throw new Error('每次最多导入 5000 行，请拆分文件');
      const row = sheet.getRow(i);
      if (!row.getCell(header.prompt).text.trim()) continue;
      try {
        const get = key => header[key] ? cellText(row.getCell(header[key])) : '';
        const typeText = get('type') || sheet.name;
        const type = /多/.test(typeText) ? '多选题' : /判/.test(typeText) ? '判断题' : '单选题';
        let options = get('options') ? splitOptions(get('options')) : 'ABCDEFGH'.split('').map(get).filter(Boolean);
        if (type === '判断题' && !options.length) options = ['正确','错误'];
        let rawAnswer = get('answer').normalize('NFKC').toUpperCase();
        if (type === '判断题') {
          const truth = /^(正确|对|是|TRUE|T|√|1)$/.test(rawAnswer), falsity = /^(错误|错|否|FALSE|F|×|0)$/.test(rawAnswer);
          if (truth || falsity) { const expected = truth ? /^(正确|对|是|TRUE|√)$/i : /^(错误|错|否|FALSE|×)$/i; const n = options.findIndex(v => expected.test(v)); rawAnswer = n >= 0 ? String.fromCharCode(65+n) : rawAnswer; }
        }
        const normalized = rawAnswer.replace(/[\s,，、;；|｜]/g,'');
        if (!/^[A-H]+$/.test(normalized)) throw new Error('无法识别答案，请使用 A、BC 或判断题的正确/错误');
        questions.push(validateQuestion({ prompt: get('prompt'), type, options, answer: normalized.split(''), explanation: get('explanation'), category: get('category') || sheet.name, difficulty: get('difficulty') }));
      } catch (error) { errors.push({ sheet: sheet.name, row: i, message: error.message }); }
    }
  }
  return { questions, errors };
}

export async function template() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('示例题库');
  ws.addRow(['题目','题型','选项','答案','解析','分类','难度']);
  ws.addRow(['一年有多少个月？','单选','10|11|12|13','C','一年有 12 个月。','常识','低']);
  ws.addRow(['下列哪些是偶数？','多选','1|2|3|4','BD','2 和 4 是偶数。','数学','低']);
  ws.addRow(['三角形有三条边。','判断','','正确','三角形由三条线段首尾相接组成。','数学','低']);
  ws.getRow(1).font = { bold: true }; ws.columns.forEach(c => { c.width = 24; }); ws.getColumn(1).width = 50;
  return wb.xlsx.writeBuffer();
}
