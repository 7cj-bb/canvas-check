import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloud/worker';
const origin = `chrome-extension://${'a'.repeat(32)}`;
const budget = { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ allowed: true }) }) };

test('public privacy information is readable without extension credentials', async () => {
  const response = await worker.fetch(new Request('https://api.example/privacy'), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type') ?? '', /text\/html/);
  const html = await response.text();
  assert.match(html, /Cloudflare Workers/); assert.match(html, /OpenAI/); assert.match(html, /store:false/);
  assert.match(html, /AI settings/); assert.match(html, /简体中文隐私说明/);
  assert.equal((await worker.fetch(new Request('https://api.example/api/summary', { method: 'POST' }), {})).status, 403);
});
test('cloud backend cannot be called by an unapproved website', async () => {
  const response = await worker.fetch(new Request('https://api.example/health', { headers: { Origin: 'https://external.example' } }), { ALLOWED_EXTENSION_ID: 'a'.repeat(32) });
  assert.equal(response.status, 403);
});

test('cloud allowlist accepts the fixed distribution ID and rejects similar unapproved origins', async () => {
  const id = 'b'.repeat(32);
  const env = { ALLOWED_EXTENSION_ID: 'a'.repeat(32), ALLOWED_EXTENSION_IDS: ` ${id},invalid-id` };
  for (const candidate of [`chrome-extension://${id}`, origin]) {
    const response = await worker.fetch(new Request('https://api.example/health', { headers: { Origin: candidate } }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), candidate);
  }
  for (const candidate of [`https://${id}`, `chrome-extension://${id}.evil`, `chrome-extension://${'c'.repeat(32)}`, `chrome-extension://invalid-id`]) {
    const response = await worker.fetch(new Request('https://api.example/health', { headers: { Origin: candidate } }), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
});
test('cloud mode needs server credentials, an access token and a rate limiter', async () => {
  const env = { ALLOWED_EXTENSION_ID: 'a'.repeat(32), OPENAI_API_KEY: 'synthetic-not-real', CLIENT_TOKEN: 'x'.repeat(64) };
  const response = await worker.fetch(new Request('https://api.example/health', { headers: { Origin: origin } }), env);
  assert.equal((await response.json()).configured, false);
});
test('cloud authentication and rate limits are checked before any model request', async () => {
  const env = { ALLOWED_EXTENSION_ID: 'a'.repeat(32), OPENAI_API_KEY: 'synthetic-not-real', CLIENT_TOKEN: 'x'.repeat(64), AI_RATE_LIMITER: { limit: async () => ({ success: false }) }, AI_USAGE_BUDGET: budget };
  const missing = await worker.fetch(new Request('https://api.example/api/summary', { method: 'POST', headers: { Origin: origin } }), env);
  assert.equal(missing.status, 401);
  const limited = await worker.fetch(new Request('https://api.example/api/summary', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${env.CLIENT_TOKEN}` } }), env);
  assert.equal(limited.status, 429);
});

test('Chrome host-permission transports require both an allowlisted ID and bearer credential', async () => {
  const id = 'a'.repeat(32), token = 'x'.repeat(64);
  const env = { ALLOWED_EXTENSION_ID: id, OPENAI_API_KEY: 'synthetic-not-real', CLIENT_TOKEN: token, AI_RATE_LIMITER: { limit: async () => ({ success: false }) }, AI_USAGE_BUDGET: budget };
  for (const source of ['', 'https://api.example']) {
    const valid: Record<string, string> = { Authorization: `Bearer ${token}`, 'X-Canvas-Check-Extension': id };
    if (source) valid.Origin = source;
    const health = await worker.fetch(new Request('https://api.example/health', { headers: valid }), env);
    assert.equal(health.status, 200); assert.equal((await health.json()).configured, true);
    const limited = await worker.fetch(new Request('https://api.example/api/summary', { method: 'POST', headers: valid }), env);
    assert.equal(limited.status, 429);
    for (const invalid of [{ ...valid, Authorization: 'Bearer wrong' }, { ...valid, 'X-Canvas-Check-Extension': 'b'.repeat(32) }, { ...valid, 'X-Canvas-Check-Extension': '' }, { ...valid, Origin: 'https://unapproved.example' }, { ...valid, Origin: origin, 'X-Canvas-Check-Extension': 'b'.repeat(32) }]) {
      assert.equal((await worker.fetch(new Request('https://api.example/health', { headers: invalid }), env)).status, 403);
    }
  }
});

test('global budget exhaustion or outage prevents model calls, including missing binding', async () => {
  const env = { ALLOWED_EXTENSION_ID: 'a'.repeat(32), OPENAI_API_KEY: 'synthetic-not-real', CLIENT_TOKEN: 'x'.repeat(64), AI_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const request = () => new Request('https://api.example/api/summary', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${env.CLIENT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ task: { title: 'Synthetic', description: 'Submit a file.' }, language: 'en' }) });
  assert.equal((await worker.fetch(request(), env)).status, 503);
  const denied = { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ allowed: false, retryAfter: 42 }, { status: 429 }) }) };
  const limited = await worker.fetch(request(), { ...env, AI_USAGE_BUDGET: denied });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '42');
  assert.match((await limited.json()).error, /local checks/i);
  const failed = { idFromName: (name: string) => name, get: () => ({ fetch: async (): Promise<Response> => { throw new Error('unavailable'); } }) };
  assert.equal((await worker.fetch(request(), { ...env, AI_USAGE_BUDGET: failed })).status, 503);
});
