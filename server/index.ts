import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { bridgeToken, loadSettings, saveSettings } from './private';
import { ANALYSIS_PATHS, validateAnalysis, executeAnalysis } from './analysis';
import { privacyHTML } from '../cloud/privacy';
export { validateInput } from './input';

const ADDRESS = '127.0.0.1', PORT = 4318, ORIGIN = `http://${ADDRESS}:${PORT}`;
const MAX_BODY = 12 * 1024 * 1024;

export async function createService() {
  const token = await bridgeToken(), csrf = randomBytes(32).toString('hex');
  const cache = new Map<string, { at: number; value: unknown }>(), pending = new Map<string, Promise<unknown>>();
  let active = 0;
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin ?? '';
    const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    const sameOrigin = origin === ORIGIN;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== `${ADDRESS}:${PORT}`) { res.writeHead(403).end(); return; }
    if (extensionOrigin || sameOrigin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Canvas-Check-Extension'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }
    if (req.method === 'OPTIONS') { res.writeHead(extensionOrigin || sameOrigin ? 204 : 403).end(); return; }
    const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value)); };
    try {
      const pathname = new URL(req.url ?? '/', ORIGIN).pathname;
      if (req.method === 'GET' && pathname === '/privacy') { res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" }).end(privacyHTML); return; }
      if (req.method === 'GET' && (pathname === '/' || pathname === '/setup')) {
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        const html = (await readFile(new URL('./setup.html', import.meta.url), 'utf8')).replace('__CSRF__', csrf);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html); return;
      }
      if (req.method === 'GET' && pathname === '/setup.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await readFile(new URL('./setup.js', import.meta.url))); return; }
      if (req.method === 'GET' && pathname === '/health') { const settings = await loadSettings(); json(200, { configured: Boolean(settings.apiKey), model: settings.model, features: { pregrade: 1 } }); return; }
      const localSetup = pathname === '/configure' && sameOrigin && req.headers['x-csrf-token'] === csrf;
      const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const authenticated = /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
      const declaredId = req.headers['x-canvas-check-extension'];
      const allowed = authenticated && (extensionOrigin || ((!origin || sameOrigin) && typeof declaredId==='string' && /^[a-p]{32}$/.test(declaredId)));
      if (req.method !== 'POST' || (!localSetup && !allowed)) { json(403, { error: '此请求未获本机服务授权。' }); return; }
      if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) { json(415, { error: '请求格式无效。' }); return; }
      let body = '', length = 0;
      for await (const part of req) { length += part.length; if (length > MAX_BODY) { json(413, { error: '本轮材料过大，未发送到 OpenAI。' }); return; } body += part; }
      let input; try { input = JSON.parse(body); } catch { json(400, { error: '请求格式不完整。' }); return; }
      if (localSetup) {
        if (typeof input.apiKey !== 'string' || !/^sk-[A-Za-z0-9_\-]{16,}$/.test(input.apiKey.trim()) || typeof input.model !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(input.model)) { json(400, { error: '请填写有效的 OpenAI API 密钥与模型名称。' }); return; }
        await saveSettings(input.apiKey.trim(), input.model); cache.clear(); json(200, { saved: true }); return;
      }
      if (!ANALYSIS_PATHS.includes(pathname)) { json(404, { error: '接口不存在。' }); return; }
      const settings = await loadSettings(); if (!settings.apiKey) { json(503, { error: '请先在本机配置页连接 OpenAI。' }); return; }
      const data = validateAnalysis(pathname, input);
      const key = createHash('sha256').update(JSON.stringify([pathname, settings.model, settings.pregradeModel, data])).digest('hex');
      for (const [id, item] of cache) if (Date.now() - item.at > 10 * 60000) cache.delete(id);
      if (cache.has(key)) { json(200, cache.get(key)!.value); return; }
      let work = pending.get(key);
      if (!work) {
        if (active >= 2) { json(429, { error: '正在分析其他材料，请稍后自动重试。' }); return; }
        active++;
        work = executeAnalysis(settings, data).then(result => { if (cache.size >= 30) cache.delete(cache.keys().next().value!); cache.set(key, { at: Date.now(), value: result }); return result; }).finally(() => { active--; pending.delete(key); });
        pending.set(key, work);
      }
      json(200, await work);
    } catch (e) { if (!res.headersSent) json(400, { error: e instanceof Error ? e.message : '本轮分析未完成。' }); }
  });
  return server;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const server = await createService();
  server.listen(PORT, ADDRESS, () => { process.stdout.write(`Canvas Check 本机 AI 服务：http://${ADDRESS}:${PORT}/setup\n密钥和材料不会写入服务日志。\n`); });
}
