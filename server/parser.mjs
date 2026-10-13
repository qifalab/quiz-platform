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
  const s = value.replace(/\s/g,'').replace(/[（(].*?[）)]$/g,'');
  if (/^(题目|试题题干|试题题目|题干|question|prompt)/i.test(s)) return 'prompt';
  if (/^(类型编号|题型编号|类型代码|题型代码|试题类型|题型|题目类型|type)/i.test(s)) return 'type';
  if (/^(标签|分类|章节|tag|category)/i.test(s)) return 'category';
  if (/^(学科|科目|subject)/i.test(s)) return 'subject';
  if (/^(客观题答案|答案|正确答案|answer)/i.test(s)) return 'answer';
  if (/^(试题解析|解析|答案解析|explanation)/i.test(s)) return 'explanation';
  if (/^(难易度|难度|difficulty)/i.test(s)) return 'difficulty';
  if (/^(?:选项\s*)?[A-H](?:选项)?$/i.test(s)) return s.match(/[A-H]/i)[0].toUpperCase();
  if (/^(选项|options)/i.test(s)) return 'options';
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
    if (/^(填写说明|使用说明|说明|guide|readme)$/i.test(sheet.name.trim())) continue;
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
        let rawAnswer = get('answer').normalize('NFKC').toUpperCase();
        const normalizedAnswer = rawAnswer.replace(/[\s,，、;；|｜]/g,'');
        const explicitJudgement = /判|判断|true|false|judge/i.test(typeText);
        const explicitMultiple = /多|multiple|multi/i.test(typeText);
        const numericType = /^\d+$/.test(typeText.trim()) ? Number(typeText.trim()) : null;
        const type = explicitJudgement || numericType === 3
          ? '判断题'
          : explicitMultiple || normalizedAnswer.length > 1 || numericType === 2
            ? '多选题'
            : '单选题';
        let options = get('options') ? splitOptions(get('options')) : 'ABCDEFGH'.split('').map(get).filter(Boolean);
        if (type === '判断题' && !options.length) options = ['正确','错误'];
        if (type === '判断题') {
          const truth = /^(正确|对|是|TRUE|T|√|1)$/.test(rawAnswer), falsity = /^(错误|错|否|FALSE|F|×|0)$/.test(rawAnswer);
          if (truth || falsity) { const expected = truth ? /^(正确|对|是|TRUE|√)$/i : /^(错误|错|否|FALSE|×)$/i; const n = options.findIndex(v => expected.test(v)); rawAnswer = n >= 0 ? String.fromCharCode(65+n) : rawAnswer; }
        }
        const normalized = rawAnswer.replace(/[\s,，、;；|｜]/g,'');
        if (!/^[A-H]+$/.test(normalized)) throw new Error('无法识别答案，请使用 A、BC 或判断题的正确/错误');
        questions.push(validateQuestion({ prompt: get('prompt'), type, options, answer: normalized.split(''), explanation: get('explanation'), category: get('category') || get('subject') || sheet.name, difficulty: get('difficulty') }));
      } catch (error) { errors.push({ sheet: sheet.name, row: i, message: error.message }); }
    }
  }
  return { questions, errors };
}

export async function template() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('示例题库');
  ws.addRow(['类型编号（必填）','题干（必填）','标签（必填）','学科（非必要）','客观题答案（必填）','选项A','选项B','选项C','选项D']);
  ws.addRow([1,'一年有多少个月？','常识','数学','C','10','11','12','13']);
  ws.addRow([2,'下列哪些是偶数？','数学','','BD','1','2','3','4']);
  ws.addRow([3,'三角形有三条边。','基础判断','','正确','正确','错误','','']);
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 30;
  ws.autoFilter = 'A1:I1';
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns = [14, 48, 18, 16, 18, 20, 20, 20, 20].map(width => ({ width }));
  const guide = wb.addWorksheet('填写说明');
  guide.addRows([
    ['类型编号','题型'],
    [1,'单选题'],
    [2,'多选题'],
    [3,'判断题'],
    [],
    ['答案填写','单选填一个字母，如 C；多选填多个字母，如 BD；判断题可填“正确”或“错误”'],
    ['选项填写','每个选项单独放在选项A、选项B、选项C、选项D列；至少填写两个选项'],
  ]);
  guide.getRow(1).font = { bold: true };
  guide.getColumn(1).width = 18;
  guide.getColumn(2).width = 90;
  return wb.xlsx.writeBuffer();
}
