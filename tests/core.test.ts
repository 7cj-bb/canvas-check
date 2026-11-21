import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeJava } from '../src/core/java';
import { extractLocalRequirements, sourceFingerprint } from '../src/core/requirements';
import { canUseResult, runLocalChecks, selectionKey } from '../src/core/checks';
import { DEMO_ASSIGNMENT, SAMPLE_JAVA } from '../src/core/demo';
import type { ReadFile } from '../src/core/types';
import { attachmentSnapshotKey, resolveAttachmentRows } from '../src/core/attachments';
import { detectFormat } from '../src/core/formats';

const code = (text: string, id = 'one'): ReadFile => ({ id, name: 'Main.java', extension: 'java', size: text.length, kind: 'java', state: 'ready', text, java: analyzeJava(text) });
const requirements = extractLocalRequirements(DEMO_ASSIGNMENT);

test('extracts separate Java and screenshot deliverables with original quotes', () => {
  const fileRules = requirements.filter(r => r.kind === 'file');
  assert.equal(fileRules.length, 2);
  assert.deepEqual(fileRules.map(r => r.extensions), [['java'], ['png','jpg','jpeg','webp','gif','bmp','avif','heic','heif']]);
  assert.ok(fileRules.every(r => DEMO_ASSIGNMENT.description.includes(r.quote)));
});

test('Java grammar ignores for in comments, ordinary strings and text blocks', () => {
  for (const source of [
    'class Main { void x() { /* for (int i=0;i<3;i++) {} */ } }',
    'class Main { String s = "for (int i=0;i<3;i++) {}"; }',
    'class Main { String s = """\nfor (int i=0;i<3;i++) {}\n"""; }',
  ]) {
    const analysis = analyzeJava(source);
    assert.equal(analysis.parsed, true);
    assert.equal(analysis.forLoops.length, 0);
  }
});

test('Java grammar locates actual standard and enhanced loops', () => {
  const result = analyzeJava('class Main {\n void x(int[] values) {\n for (int n: values) {}\n for (int i=0;i<3;i++) {}\n }\n}');
  assert.equal(result.parsed, true);
  assert.deepEqual(result.forLoops.map(x => x.line), [3, 4]);
});

test('variable declarations are distinct from references and comment mentions', () => {
  const parsed = analyzeJava('class Main { void x() { /* int largest; */ int smallest=0; System.out.println(smallest); } }');
  assert.equal(parsed.variables.smallest?.length, 1);
  assert.equal(parsed.variables.largest, undefined);
});

test('invalid Java is uncheckable, never a false missing structure', () => {
  const invalid = code('class Main { void x( { for ???');
  const checked = runLocalChecks(requirements, [invalid], true);
  assert.equal(checked.find(r => r.requirement.kind === 'java-for')?.status, 'uncheckable');
});

test('missing screenshot is only flagged when the current file list is complete', () => {
  const source = code(SAMPLE_JAVA);
  const trusted = runLocalChecks(requirements, [source], true);
  const untrusted = runLocalChecks(requirements, [source], false);
  const isPhoto = (r: (typeof trusted)[number]) => r.requirement.extensions?.includes('png');
  assert.equal(trusted.find(isPhoto)?.status, 'not-found');
  assert.equal(untrusted.find(isPhoto)?.status, 'uncheckable');
  assert.ok(trusted.filter(r => r.status === 'found').every(r => r.evidence.length));
});

test('photo attachment presence does not imply photo content was recognized', () => {
  const image: ReadFile = { id: 'image', name: 'result.png', extension: 'png', size: 10, kind: 'image', state: 'ready' };
  const results = runLocalChecks(requirements, [code(SAMPLE_JAVA), image], true);
  assert.equal(results.find(r => r.requirement.extensions?.includes('png'))?.status, 'found');
  assert.equal(results.find(r => r.requirement.kind === 'semantic')?.status, 'confirm');
});

test('conditional instructions are not treated as unconditional missing work', () => {
  const assignment = { ...DEMO_ASSIGNMENT, paragraphs: ['If you choose the coding option, submit the Java file.'] };
  const rules = extractLocalRequirements(assignment);
  assert.equal(runLocalChecks(rules, [], true)[0]?.status, 'confirm');
});

test('PDF or Word remains a single alternative deliverable', () => {
  const rules = extractLocalRequirements({ ...DEMO_ASSIGNMENT, paragraphs: ['Submit a PDF or Word file.'] });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].extensions, ['pdf', 'docx']);
});

test('same file name with changed content and changed requirements invalidate results', () => {
  const oldFile = code(SAMPLE_JAVA, 'old-content');
  const newFile = code(SAMPLE_JAVA + '\n// new', 'new-content');
  assert.equal(canUseResult(selectionKey([oldFile]), selectionKey([newFile])), false);
  assert.notEqual(sourceFingerprint(DEMO_ASSIGNMENT), sourceFingerprint({ ...DEMO_ASSIGNMENT, description: DEMO_ASSIGNMENT.description + '\nSubmit a PDF file.' }));
});

test('source excerpt and semantic presence are not replaced with invented grades', () => {
  const results = runLocalChecks(requirements, [code(SAMPLE_JAVA)], true);
  assert.equal(results.find(r => r.requirement.kind === 'semantic')?.status, 'confirm');
  assert.equal('score' in results[0], false);
});

test('automatic attachment tracking follows the current list, not past choices', () => {
  const before = resolveAttachmentRows([{ id: '1', name: 'Main.java', uploading: false }, { id: '2', name: 'photo.png', uploading: false }], true);
  const removed = resolveAttachmentRows([{ id: '1', name: 'Main.java', uploading: false }], true);
  assert.equal(removed.coverage, 'complete');
  assert.deepEqual(removed.attachments.map(f => f.id), ['1']);
  assert.notEqual(attachmentSnapshotKey(before), attachmentSnapshotKey(removed));
});

test('same-name replacements are detected through Canvas file IDs', () => {
  const first = resolveAttachmentRows([{ id: '1', name: 'Main.java', uploading: false }], true);
  const replaced = resolveAttachmentRows([{ id: '3', name: 'Main.java', uploading: false }], true);
  assert.notEqual(attachmentSnapshotKey(first), attachmentSnapshotKey(replaced));
});

test('submitted and draft attachments never share the same snapshot', () => {
  const state = resolveAttachmentRows([{ id: '1', name: 'Main.java', uploading: false }], true);
  assert.notEqual(attachmentSnapshotKey({ ...state, attachmentSource: 'draft' }), attachmentSnapshotKey({ ...state, attachmentSource: 'submitted' }));
});

test('a combined submission sentence extracts Java and screenshot separately', () => {
  const sentence = 'Submit the source code (the .java file) for your program and a screenshot of the output.';
  const rules = extractLocalRequirements({ ...DEMO_ASSIGNMENT, description: sentence, paragraphs: [sentence] });
  assert.deepEqual(rules.filter(r => r.kind === 'file').map(r => r.extensions), [['java'], ['png','jpg','jpeg','webp','gif','bmp','avif','heic','heif']]);
});

test('same filenames with different IDs are preserved as separate attachments', () => {
  const state = resolveAttachmentRows([{ id: '1', name: 'Main.java', uploading: false }, { id: '2', name: 'Main.java', uploading: false }], true);
  assert.equal(state.coverage, 'complete'); assert.equal(state.attachments.length, 2);
});

test('uploading rows never produce a falsely complete attachment scope', () => {
  const state = resolveAttachmentRows([{ id: '1', name: 'Main.java', uploading: false }, { id: '', name: 'photo.png', uploading: true }], true);
  assert.equal(state.coverage, 'pending');
});

test('unavailable or inconsistent lists are not treated as empty submissions', () => {
  assert.equal(resolveAttachmentRows([], false).coverage, 'unavailable');
  assert.equal(resolveAttachmentRows([{ id: '1', name: 'a.java', uploading: false }, { id: '1', name: 'a.java', uploading: false }], true).coverage, 'unavailable');
  assert.equal(resolveAttachmentRows([], true).coverage, 'complete');
});

test('file format detection uses image and PDF signatures automatically', () => {
  assert.equal(detectFormat('photo.bin', new Uint8Array([137,80,78,71,13,10,26,10])), 'png');
  assert.equal(detectFormat('scan.data', new TextEncoder().encode('%PDF-1.7')), 'pdf');
  assert.equal(detectFormat('photo.unknown', new Uint8Array([255,216,255,0])), 'jpg');
  assert.equal(detectFormat('Main.java', new TextEncoder().encode('class Main { String x = "%PDF-"; }')), 'java');
});

test('an unread Java attachment prevents a false missing-structure result', () => {
  const unread: ReadFile = { id: 'failed', name: 'Other.java', extension: 'java', size: 0, kind: 'java', state: 'unreadable' };
  const result = runLocalChecks(requirements, [code('class Main {}'), unread], true);
  assert.equal(result.find(r => r.requirement.kind === 'java-for')?.status, 'uncheckable');
});
