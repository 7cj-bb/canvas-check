import test from 'node:test';
import assert from 'node:assert/strict';
import { AIUsageBudget, analysisUnits } from '../cloud/usage-budget';
import { validateAnalysis } from '../server/analysis';

function storage() {
  interface MockStore {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    transaction<T>(callback: (s: MockStore) => Promise<T>): Promise<T>;
  }
  const values = new Map<string, unknown>();
  let queue = Promise.resolve();
  const store: MockStore = {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
    transaction: <T>(callback: (s: MockStore) => Promise<T>): Promise<T> => {
      const result = queue.then(() => callback(store));
      queue = result.then(() => {}, () => {}); return result;
    }
  };
  return store;
}
const reserve = (budget: AIUsageBudget, units = 1) => budget.fetch(new Request('https://internal/reserve', { method: 'POST', body: JSON.stringify({ units }) }));

test('concurrent reservations and restarted instances cannot exceed the daily budget', async () => {
  const state = { storage: storage() };
  const a = new AIUsageBudget(state, { AI_DAILY_UNITS: '5' });
  const results = await Promise.all(Array.from({ length: 10 }, () => reserve(a)));
  assert.equal(results.filter(r => r.status === 200).length, 5);
  const b = new AIUsageBudget(state, { AI_DAILY_UNITS: '5' });
  const response = await reserve(b);
  assert.equal(response.status, 429);
  assert.ok((await response.json()).retryAfter > 0);
});

test('global minute limit rejects a seventh request and old daily counters reset', async () => {
  const state = { storage: storage() };
  const a = new AIUsageBudget(state, {});
  for (let i = 0; i < 6; i++) assert.equal((await reserve(a)).status, 200);
  assert.equal((await reserve(a)).status, 429);
  await state.storage.put('usage', { day: '2000-01-01', used: 200, minute: 0, requests: 6 });
  assert.equal((await reserve(a)).status, 200);
});

test('invalid units, configuration, or corrupt counters cannot authorize AI', async () => {
  const state = { storage: storage() };
  const a = new AIUsageBudget(state, {});
  for (const units of [0, -1, 1.1, 10001]) assert.equal((await reserve(a, units)).status, 400);
  assert.equal((await reserve(new AIUsageBudget(state, { AI_DAILY_UNITS: 'invalid' }))).status, 503);
  await state.storage.put('usage', { day: new Date().toISOString().slice(0, 10), used: -1, minute: 0, requests: 0 });
  await assert.rejects(reserve(a));
});

test('larger inputs and image evidence consume more units without persisting content', () => {
  const small = validateAnalysis('/api/summary', { task: { title: 'Test', description: 'Submit work.' } });
  const large = validateAnalysis('/api/summary', { task: { title: 'Test', description: 'x'.repeat(60000) } });
  const image = validateAnalysis('/api/evidence', { task: small.data.task, requirements: [], files: [{ id: 'file', name: 'photo.png', kind: 'image', complete: true, image: 'data:image/png;base64,aGVsbG8=' }] });
  assert.ok(analysisUnits(large) > analysisUnits(small));
  assert.ok(analysisUnits(image) > analysisUnits(small));
});
