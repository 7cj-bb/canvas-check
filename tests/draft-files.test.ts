import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDraftFiles } from '../src/core/draft-files';
import { LIMITS } from '../src/core/types';

test('selected Java is readable before Canvas assigns a file ID or submits it', async () => {
  const store = new NativeDraftFiles();
  const [meta] = store.sync([new File(['class Main {}'], 'Main.java')]);
  assert.match(meta.id, /^draft:/);
  assert.equal(Buffer.from((await store.chunk(meta.id, 0)).base64, 'base64').toString(), 'class Main {}');
});

test('same-name, same-size replacement gets a different identity and revokes old bytes', async () => {
  const store = new NativeDraftFiles(), one = new File(['AAAA'], 'Main.java', {lastModified:1});
  const [a] = store.sync([one]);
  assert.equal(store.sync([one])[0].id, a.id);
  const [b] = store.sync([new File(['BBBB'], 'Main.java', {lastModified:1})]);
  assert.notEqual(a.id, b.id);
  await assert.rejects(store.chunk(a.id, 0));
  assert.equal(Buffer.from((await store.chunk(b.id, 0)).base64, 'base64').toString(), 'BBBB');
});

test('removing files, switching mode or leaving the assignment revokes native bytes', async () => {
  const store = new NativeDraftFiles();
  const [a, b] = store.sync([new File(['A'], 'a.txt'), new File(['B'], 'b.txt')]);
  store.sync([]);
  await assert.rejects(store.chunk(a.id, 0));
  await assert.rejects(store.chunk(b.id, 0));
});

test('draft chunking preserves binary bytes and enforces bounds', async () => {
  const store = new NativeDraftFiles(), bytes = new Uint8Array(200_000).map((_, i) => i % 256);
  const [file] = store.sync([new File([bytes], 'photo.bin')]);
  const first = await store.chunk(file.id, 0), last = await store.chunk(file.id, first.length);
  assert.equal(first.length, 192 * 1024);
  assert.deepEqual(Buffer.concat([Buffer.from(first.base64, 'base64'), Buffer.from(last.base64, 'base64')]), Buffer.from(bytes));
  for (const offset of [-1, 0.5, 200_000, 200_001]) await assert.rejects(store.chunk(file.id, offset));
  const [large] = store.sync([new File([new Uint8Array(LIMITS.bytes + 1)], 'large.txt')]);
  await assert.rejects(store.chunk(large.id, 0), /20 MB/);
});

test('empty file produces a bounded empty chunk, not a historical fallback', async () => {
  const store = new NativeDraftFiles(), [file] = store.sync([new File([], 'empty.java')]);
  assert.equal((await store.chunk(file.id, 0)).length, 0);
});
