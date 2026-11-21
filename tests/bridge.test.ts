import test from 'node:test';
import assert from 'node:assert/strict';
import { readCanvasState } from '../src/panel/bridge';
import { PROTOCOL_VERSION } from '../src/core/protocol';
test('old or absent page adapters are reconnected before accepting assignment state', async () => {
  const old = (globalThis as { chrome?: unknown }).chrome;
  let injected = 0, reads = 0;
  const expected = { protocolVersion: PROTOCOL_VERSION, assignment: null, revision: 1, attachments: [], coverage: 'complete', warning: '', historyStatus: 'ready', history: [] };
  (globalThis as { chrome?: unknown }).chrome = { tabs: { sendMessage: async (_tabId: number, message: { language: string }) => { assert.equal(message.language,'en'); reads++; if (reads === 1) return { ...expected, protocolVersion: PROTOCOL_VERSION - 1 }; return expected; } }, runtime: { sendMessage: async (message: { type: string }) => { assert.equal(message.type, 'ensure-page'); injected++; return { ok: true }; } } };
  try { assert.deepEqual(await readCanvasState(1), expected); assert.equal(injected, 1); }
  finally { (globalThis as { chrome?: unknown }).chrome = old; }
});
