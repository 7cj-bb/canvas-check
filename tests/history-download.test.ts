import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubmissionHistory, previousFileOccurrences } from '../src/core/history';
import { summarizeRequirements } from '../src/core/overview';
import { DEMO_ASSIGNMENT } from '../src/core/demo';
import { allowedFileUrl, CANVAS_ORIGIN, FILE_ORIGIN, FILE_GATEWAY_ORIGIN } from '../src/core/download-policy';
import { fetchCanvasFile } from '../src/extension/download';
import { readCanvasFileMetadata } from '../src/extension/metadata';

test('history preserves separate attempts and drops grades, comments and signed URLs', () => {
  const first = { attempt: 1, submitted_at: '2026-01-01', attachments: [{ id: 11, display_name: 'Main.java', size: 20 }, { id: 12, filename: 'run.png', url: 'secret-token', size: 40 }] };
  const second = { attempt: 2, attachments: [{ id: 21, display_name: 'Main.java', size: 30 }], grade: 100, submission_comments: ['private'] };
  const parsed = parseSubmissionHistory({ ...second, submission_history: [first, second] });
  assert.deepEqual(parsed.map(p => [p.attempt, p.attachments.length]), [[2, 1], [1, 2]]);
  assert.equal(JSON.stringify(parsed).includes('secret-token'), false);
  assert.equal(JSON.stringify(parsed).includes('private'), false);
  assert.equal('grade' in parsed[0], false);
  assert.deepEqual(previousFileOccurrences(parsed, ['png'], 2).map(p => p.attempt), [1]);
  assert.deepEqual(parsed[0].attachments.map(f => f.id), ['21']);
});
test('malformed history never becomes a falsely complete empty submission', () => {
  assert.deepEqual(parseSubmissionHistory({ attempt: 1 }), []);
  assert.deepEqual(parseSubmissionHistory({ attempt: 1, attachments: [{ id: 'invalid', filename: 'Main.java' }] }), []);
  assert.deepEqual(parseSubmissionHistory({ attempt: 1, attachments: [] })[0].attachments, []);
});
test('summary extracts the task and constraints instead of the Program Name paragraph', () => {
  const paragraphs = ['Program Name: Example', 'Write a program that prompts the user for three integer test scores and then displays the average and letter grade.', 'The test scores must be integers (must be declared as int), but the average must be declared as double.', 'Submit the .java file and a screenshot.'];
  const summary = summarizeRequirements({ ...DEMO_ASSIGNMENT, description: paragraphs.join('\n'), paragraphs });
  assert.match(summary.objective, /3 个整数成绩/);
  assert.match(summary.constraints.join(' '), /int/); assert.match(summary.constraints.join(' '), /double/);
  assert.equal(summary.method, 'local');
});
test('unknown tasks preserve source wording without inventing a summary', () => {
  const paragraphs = ['Program Name: X', 'Build a model of a bridge using household materials.'];
  const summary = summarizeRequirements({ ...DEMO_ASSIGNMENT, description: paragraphs.join('\n'), paragraphs });
  assert.equal(summary.objective, paragraphs[1]); assert.equal(summary.constraints.length, 0);
});
test('grade range boundaries survive summarization and variables are kept compact', () => {
  const paragraphs = ['Write a program.', 'B: Between 80 and 90 (include 80, exclude 90)'];
  const summary = summarizeRequirements({ ...DEMO_ASSIGNMENT, description: paragraphs.join('\n'), paragraphs });
  assert.match(summary.constraints.join(' '), /80–<90/);
  assert.match(summarizeRequirements(DEMO_ASSIGNMENT).constraints.join(' '), /LIMIT、smallest、largest/);
});
test('file access is limited to exact school file IDs and the observed Canvas CDN', () => {
  assert.equal(allowedFileUrl(`${CANVAS_ORIGIN}/files/12/download?verifier=x`, '12'), true);
  assert.equal(allowedFileUrl(`${CANVAS_ORIGIN}/files/13/download`, '12'), false);
  assert.equal(allowedFileUrl(`${FILE_ORIGIN}/id/Main.java?token=x`, '12'), true);
  assert.equal(allowedFileUrl(`${FILE_GATEWAY_ORIGIN}/files/uuid/Main.java?token=x`, '12'), true);
  assert.equal(allowedFileUrl(`${FILE_GATEWAY_ORIGIN}/api/private`, '12'), false);
  assert.equal(allowedFileUrl('https://cdn.inst-fs-iad-prod.inscloudgate.net.evil.example/Main.java', '12'), false);
  assert.equal(allowedFileUrl('https://user:password@cdn.inst-fs-iad-prod.inscloudgate.net/Main.java', '12'), false);
});
function fakeFileFetch(source: string, overrides: Record<string, unknown> = {}, body?: Response): typeof fetch {
  let call = 0;
  return (async (url, init) => {
    assert.equal(init?.credentials, call === 0 ? 'include' : 'omit');
    if (call++ === 0) { assert.equal(String(url), `${CANVAS_ORIGIN}/api/v1/files/12`); return new Response(JSON.stringify({ id: 12, size: new TextEncoder().encode(source).length, url: `${FILE_ORIGIN}/id/Main.java`, 'content-type': 'text/x-java', ...overrides })); }
    return body ?? new Response(source, { headers: { 'Content-Type': 'text/x-java' } });
  }) as typeof fetch;
}
test('background file reader follows vetted CDN metadata and preserves original Java bytes', async () => {
  const source = 'class Main { String text = "你好"; }';
  const result = await fetchCanvasFile('12', fakeFileFetch(source));
  assert.equal(new TextDecoder().decode(result.bytes), source);
  assert.equal(result.type, 'text/x-java');
});
test('wrong IDs, truncated downloads and HTML login responses cannot pass as Java source', async () => {
  await assert.rejects(fetchCanvasFile('12', fakeFileFetch('class Main {}', { id: 13 })));
  await assert.rejects(fetchCanvasFile('12', fakeFileFetch('class Main {}', {}, new Response('short'))));
  await assert.rejects(fetchCanvasFile('12', fakeFileFetch('class Main {}', {}, new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }))));
});
test('page-authenticated metadata avoids a background cookie-authenticated API request', async () => {
  let calls = 0;
  const source = 'class Main {}';
  const fetcher: typeof fetch = async (url, init) => { calls++; assert.equal(String(url), `${CANVAS_ORIGIN}/files/12/download?verifier=synthetic`); assert.equal(init?.credentials, 'omit'); return new Response(source); };
  const result = await fetchCanvasFile('12', fetcher, { id: '12', size: source.length, url: `${CANVAS_ORIGIN}/files/12/download?verifier=synthetic` });
  assert.equal(calls, 1); assert.equal(new TextDecoder().decode(result.bytes), source);
  await assert.rejects(fetchCanvasFile('12', fetcher, { id: '12', size: 1, url: 'https://external.example/file' }));
});
test('Canvas public_url preserves the actual storage gateway without exposing credentials in state', async () => {
  const calls: string[] = [];
  const signed = `${FILE_GATEWAY_ORIGIN}/files/uuid/Main.java?token=synthetic-only`;
  const metadata = await readCanvasFileMetadata('12', (async (url, init) => {
    calls.push(String(url)); assert.equal(init?.credentials, 'same-origin');
    return calls.length === 1 ? new Response('while(1);' + JSON.stringify({ id: 12, size: 13, 'content-type': 'text/x-java' })) : new Response(JSON.stringify({ public_url: signed }));
  }) as typeof fetch);
  assert.deepEqual(calls, ['/api/v1/files/12', '/api/v1/files/12/public_url']);
  assert.equal(metadata.url, signed);
  const result = await fetchCanvasFile('12', (async url => { assert.equal(String(url), signed); return new Response('class Main {}'); }) as typeof fetch, metadata);
  assert.equal(new TextDecoder().decode(result.bytes), 'class Main {}');
});
test('public_url cannot introduce an unrelated or spoofed download host', async () => {
  let calls = 0;
  await assert.rejects(readCanvasFileMetadata('12', (async () => ++calls === 1 ? new Response(JSON.stringify({ id: 12, size: 10 })) : new Response(JSON.stringify({ public_url: 'https://inst-fs-iad-prod.inscloudgate.net.evil.example/files/source' }))) as typeof fetch));
});
