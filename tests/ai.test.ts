import test from 'node:test';
import assert from 'node:assert/strict';
import { callOpenAI, EVIDENCE_SCHEMA, SUMMARY_SCHEMA, validateEvidence, validateSummary } from '../server/openai';
import { validateInput } from '../server/index';
import type { Requirement } from '../src/core/types';
import { mergeRequirements, prepareAIFiles } from '../src/ai/provider';

const description = 'Submit the .java file and a screenshot of the output.';
const requirement: Requirement = { id: 'output', kind: 'semantic', artifact: 'image', label: '截图中包含程序运行输出', quote: description };
const row = (status = 'found', evidence: unknown[] = []) => ({ results: [{ requirementId: 'output', status, detail: '只核对输出是否出现。', evidence }] });

test('AI extracts a separate output-screenshot content requirement with original provenance', () => {
  const value = validateSummary({ objective: '编写程序并提交运行结果。', constraints: [], requirements: [{ ...requirement, extensions: [], conditional: false }, { ...requirement, quote: 'invented instruction' }] }, description);
  assert.equal(value.requirements.length, 1); assert.equal(value.requirements[0].artifact, 'image');
  assert.equal(value.requirements[0].kind, 'semantic');
});
test('an image name alone never proves that the screenshot contains program output', () => {
  const result = validateEvidence(row(), [requirement], [{ id: 'photo', name: 'output.png', kind: 'image', complete: true }]);
  assert.equal(result[0].status, 'confirm'); assert.equal(result[0].evidence.length, 0);
});
test('image evidence must refer to a supplied image, never a previous attempt or unknown ID', () => {
  const evidence = [{ fileId: 'previous', quote: 'Enter score:', line: null, page: null }];
  const result = validateEvidence(row('found', evidence), [requirement], [{ id: 'current', name: 'output.png', kind: 'image', complete: true, image: 'data:image/png;base64,AA==' }]);
  assert.equal(result[0].status, 'confirm');
  const valid = validateEvidence(row('found', [{ ...evidence[0], fileId: 'current' }]), [requirement], [{ id: 'current', name: 'output.png', kind: 'image', complete: true, image: 'data:image/png;base64,AA==' }]);
  assert.equal(valid[0].status, 'found'); assert.equal(valid[0].evidence[0].fileName, 'output.png');
});
test('unread screenshots and unknown files prevent false missing-content conclusions', () => {
  for (const kind of ['image', 'unknown']) {
    const result = validateEvidence(row('not-found'), [requirement], [{ id: 'unread', name: 'scan.bin', kind, complete: false }]);
    assert.equal(result[0].status, 'uncheckable');
  }
});
test('source evidence is verified verbatim and its line is computed from the supplied source', () => {
  const rule: Requirement = { ...requirement, artifact: 'text' };
  const files = [{ id: 'java', name: 'Main.java', kind: 'java', complete: true, text: 'class Main {\n // Pseudocode: read input\n}' }];
  const result = validateEvidence(row('found', [{ fileId: 'java', quote: '// Pseudocode: read input', line: 99, page: null }]), [rule], files);
  assert.equal(result[0].evidence[0].line, 2);
  const invented = validateEvidence(row('found', [{ fileId: 'java', quote: 'invented quote', line: 1, page: null }]), [rule], files);
  assert.equal(invented[0].status, 'confirm');
});
test('PDF text alone cannot prove that a required screenshot exists or is missing', () => {
  const files = [{ id: 'report', name: 'report.pdf', kind: 'pdf', complete: true, text: 'Program output' }];
  assert.equal(validateEvidence(row('not-found'), [requirement], files)[0].status, 'uncheckable');
  assert.equal(validateEvidence(row('found', [{ fileId: 'report', quote: 'Program output', line: null, page: null }]), [requirement], files)[0].status, 'confirm');
});
test('conditional requirements remain undecided even when the model says found', () => {
  assert.equal(validateEvidence(row('found'), [{ ...requirement, conditional: true }], [])[0].status, 'confirm');
});
test('gateway rejects remote image URLs and requirements without teacher provenance', () => {
  assert.throws(() => validateInput({ task: { title: 'X', description }, requirements: [requirement], files: [{ id: '1', name: 'x.png', kind: 'image', complete: true, image: 'https://evil.example/private.png' }] }, true));
  assert.throws(() => validateInput({ task: { title: 'X', description }, requirements: [{ ...requirement, quote: 'not in assignment' }], files: [] }, true));
});
test('AI requests use structured Responses with no storage, no tools and no browser key', async () => {
  let inspected = false;
  const mock: typeof fetch = async (url, init) => {
    inspected = true; assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body)); assert.equal(body.store, false); assert.equal(body.text.format.strict, true); assert.equal(body.tools, undefined);
    assert.match(body.instructions, /绝不评分/); assert.equal(body.input[0].content[0].text, 'synthetic');
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }));
  };
  assert.deepEqual(await callOpenAI({ apiKey: 'synthetic-test-key', model: 'gpt-4.1-mini' }, 'test', SUMMARY_SCHEMA, [{ type: 'input_text', text: 'synthetic' }], 'test', mock), { ok: true });
  assert.equal(inspected, true); assert.equal(EVIDENCE_SCHEMA.additionalProperties, false);
});
test('partial and refused AI replies never become check results', async () => {
  for (const data of [{ status: 'incomplete', output: [] }, { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }]) {
    await assert.rejects(callOpenAI({ apiKey: 'fake', model: 'fake' }, 'test', SUMMARY_SCHEMA, [], '', async () => new Response(JSON.stringify(data))));
  }
});
test('AI file preparation preserves unread image state and excludes unnecessary metadata', async () => {
  const files = await prepareAIFiles([{ id: 'photo', name: 'run.png', extension: 'png', kind: 'unknown', size: 100, state: 'unreadable' }]);
  assert.equal(files[0].kind, 'image'); assert.equal(files[0].complete, false); assert.equal('size' in files[0], false);
  const local: Requirement = { id: 'file', label: '图片附件', kind: 'file', quote: description, extensions: ['png', 'jpg', 'jpeg'] };
  const merged = mergeRequirements([local], [{ ...local, id: 'ai-file' }, requirement]);
  assert.equal(merged.length, 2); assert.equal(merged[1].kind, 'semantic');
});
