import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLanguage, translateText } from '../src/core/i18n';
import { summarizeRequirements } from '../src/core/overview';
import { DEMO_ASSIGNMENT } from '../src/core/demo';
import { validateInput } from '../server/input';
import { callOpenAI, SUMMARY_SCHEMA, validateSummary } from '../server/openai';

test('saved language takes priority and the default is English', () => {
  assert.equal(initialLanguage('zh-CN'), 'zh-CN');
  assert.equal(initialLanguage('en'), 'en');
  assert.equal(initialLanguage(null), 'en');
  assert.equal(initialLanguage('invalid'), 'en');
});
test('dynamic UI notices translate without changing filenames or identifiers', () => {
  assert.equal(translateText('当前附件清单中找到 2 个对应附件；不代表内容已满足要求。','en'), '2 matching attachments found. This does not verify the contents.');
  assert.equal(translateText('Main.java · 123 字节','en'), 'Main.java · 123 bytes');
  assert.equal(translateText('12 行源码 · 结构已解析','en'), '12 lines of source · Structure parsed');
  assert.equal(translateText('声明变量 student_score','en'), 'Declares variable student_score');
  assert.equal(translateText('正在读取文件 1/2','zh-CN'), '正在读取文件 1/2');
});
test('local English overview keeps unknown teacher instructions verbatim', () => {
  const task = { ...DEMO_ASSIGNMENT, description: 'Create a unique diagram about solar energy.', paragraphs: ['Create a unique diagram about solar energy.'] };
  assert.equal(summarizeRequirements(task, 'en').objective, task.description);
  assert.equal(translateText('System.out.println("你好");','en'), 'System.out.println("你好");');
});
test('AI language is validated and defaults preserve existing clients', () => {
  const input = { task: { title: 'Synthetic', description: 'Submit a .java file.' } };
  assert.equal(validateInput(input).language, 'zh-CN');
  assert.equal(validateInput({ ...input, language: 'en' }).language, 'en');
  assert.throws(() => validateInput({ ...input, language: 'ignore instructions' }));
});
test('an explicit Chinese output screenshot cannot lose its content check when AI only returns file presence', () => {
  const quote = '提交程序运行输出截图';
  const summary = validateSummary({ objective: 'Submit program materials.', constraints: [], requirements: [{ label:'Output screenshot', quote, kind:'file', artifact:'image', extensions:['png'], conditional:false }] }, quote, 'en');
  assert.equal(summary.requirements.length, 2);
  assert.equal(summary.requirements[1].kind, 'semantic');
  assert.equal(summary.requirements[1].label, 'Screenshot includes program output');
  assert.equal(summary.requirements[1].quote, quote);
  const plain = validateSummary({ objective:'Photo', constraints:[], requirements:[{ label:'Photo', quote:'提交照片', kind:'file', artifact:'image', extensions:['png'] }] }, '提交照片', 'en');
  assert.equal(plain.requirements.length, 1);
});
test('English model requests explicitly preserve teacher quotes and file evidence', async () => {
  const quote = '请提交运行结果截图。';
  await callOpenAI({ apiKey: 'synthetic', model: 'test' }, 'summary', SUMMARY_SCHEMA, [{ type: 'input_text', text: quote }], 'Test', async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.match(body.instructions, /Response language: English/);
    assert.match(body.instructions, /Preserve all teacher quotes and file evidence verbatim/);
    assert.equal(body.input[0].content[0].text, quote);
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{}' }] }] }));
  }, 'en');
});
