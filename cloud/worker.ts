import { privacyHTML } from './privacy';
import { ANALYSIS_PATHS, validateAnalysis, executeAnalysis } from '../server/analysis';
import { analysisUnits, type BudgetNamespace } from './usage-budget';
export { AIUsageBudget } from './usage-budget';
interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_PREGRADE_MODEL?: string;
  CLIENT_TOKEN?: string;
  ALLOWED_EXTENSION_ID?: string;
  ALLOWED_EXTENSION_IDS?: string;
  AI_RATE_LIMITER?: { limit(value: { key: string }): Promise<{ success: boolean }> };
  AI_USAGE_BUDGET?: BudgetNamespace;
}
/** Anonymous beta access: allowlisted clients plus strict global usage limits. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const url = new URL(request.url);
    if (['GET', 'HEAD'].includes(request.method) && ['/', '/privacy'].includes(url.pathname)) return new Response(request.method === 'HEAD' ? null : privacyHTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' } });
    const allowedIds = [env.ALLOWED_EXTENSION_ID, ...(env.ALLOWED_EXTENSION_IDS ?? '').split(',')].map(id => id?.trim() ?? '').filter(id => /^[a-p]{32}$/.test(id));
    const extensionId = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)?.[1];
    const declaredId = request.headers.get('X-Canvas-Check-Extension') ?? '';
    const authenticated = (env.CLIENT_TOKEN?.length ?? 0) >= 32 && request.headers.get('Authorization') === `Bearer ${env.CLIENT_TOKEN}`;
    const allowedOrigin = Boolean(extensionId && allowedIds.includes(extensionId) && (!declaredId || declaredId === extensionId));
    // Chrome host permissions can omit Origin on GET and use the target origin on POST.
    // These transports require both the explicit allowlisted extension ID and bearer token.
    const allowedTransport = (!origin || origin === url.origin) && /^[a-p]{32}$/.test(declaredId) && allowedIds.includes(declaredId) && authenticated;
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (allowedOrigin) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Vary', 'Origin'); headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Canvas-Check-Extension'); headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
    if (!allowedOrigin && !allowedTransport) return json(403, { error: '此扩展未获服务访问权限。' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const configured = Boolean(env.OPENAI_API_KEY && (env.CLIENT_TOKEN?.length ?? 0) >= 32 && env.AI_RATE_LIMITER && env.AI_USAGE_BUDGET);
    if (request.method === 'GET' && url.pathname === '/health') return json(200, { configured, version:'0.8.4', model: env.OPENAI_MODEL || 'gpt-4.1-mini', features: { pregrade: 1, precheck: 1 } });
    if (!configured) return json(503, { error: 'AI 服务尚未配置完成。' });
    if (request.method !== 'POST' || !ANALYSIS_PATHS.includes(url.pathname)) return json(404, { error: '接口不存在。' });
    if (!authenticated) return json(401, { error: '服务访问授权无效。' });
    const { success } = await env.AI_RATE_LIMITER!.limit({ key: 'protected-demo' });
    if (!success) return json(429, { error: '演示服务调用频率已满，请稍后再试。' });
    try {
      if (!/^application\/json\b/.test(request.headers.get('Content-Type') ?? '')) return json(415, { error: '请求格式无效。' });
      const reader = request.body?.getReader(); if (!reader) return json(400, { error: '没有收到材料。' });
      let total = 0; const parts: Uint8Array[] = [];
      try { while (true) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > 12 * 1024 * 1024) return json(413, { error: '材料过大，本轮未发送到 OpenAI。' }); parts.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      const bytes = new Uint8Array(total); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      const data = validateAnalysis(url.pathname, JSON.parse(new TextDecoder().decode(bytes)));
      try {
        const budget = env.AI_USAGE_BUDGET!.get(env.AI_USAGE_BUDGET!.idFromName('global-ai-usage'));
        const reservation = await budget.fetch(new Request('https://usage.internal/reserve', { method: 'POST', body: JSON.stringify({ units: analysisUnits(data) }) }));
        const value = await reservation.json() as { allowed?: boolean; retryAfter?: number };
        if (reservation.status === 429 && value.allowed === false) {
          if (Number.isSafeInteger(value.retryAfter) && value.retryAfter! > 0) headers.set('Retry-After', String(value.retryAfter));
          return json(429, { error: data.data.language === 'en' ? 'The shared AI beta limit has been reached. Try again later; local checks are still available.' : '共享 AI 测试额度已用完，请稍后再试；本地检查仍可使用。' });
        }
        if (!reservation.ok || value.allowed !== true) throw new Error('Usage control unavailable');
      } catch {
        return json(503, { error: data.data.language === 'en' ? 'AI is temporarily unavailable. Local checks are still available.' : 'AI 暂时无法使用，本地检查仍可使用。' });
      }
      const settings = { apiKey: env.OPENAI_API_KEY!, model: env.OPENAI_MODEL || 'gpt-4.1-mini', pregradeModel: env.OPENAI_PREGRADE_MODEL || 'gpt-5-mini' };
      return json(200, await executeAnalysis(settings, data));
    } catch (e) { return json(400, { error: e instanceof Error ? e.message : '本轮分析未完成。' }); }
  },
};
