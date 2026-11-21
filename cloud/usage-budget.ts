import type { validateAnalysis } from '../server/analysis';

interface Counter { day: string; used: number; minute: number; requests: number }
interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}
interface State { storage: Store & { transaction<T>(callback: (store: Store) => Promise<T>): Promise<T> } }
export interface BudgetNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

// Application access credentials are distributable, not user authentication.
// One global, durable counter bounds anonymous beta usage across all locations.
// Only aggregate counters are stored; no IP addresses or assignment content.
export class AIUsageBudget {
  constructor(private state: State, private env: { AI_DAILY_UNITS?: string }) {}
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const value = await request.json() as { units?: number };
    const units = value?.units;
    if (!Number.isSafeInteger(units) || units! < 1 || units! > 10000) return new Response(null, { status: 400 });
    const limit = Number(this.env.AI_DAILY_UNITS ?? 200);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) return new Response(null, { status: 503 });
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), minute = Math.floor(now / 60000);
    const result = await this.state.storage.transaction(async store => {
      const saved = await store.get<Counter>('usage');
      const counter: Counter = { day, used: saved?.day === day ? saved.used : 0, minute, requests: saved?.minute === minute ? saved.requests : 0 };
      if (![counter.used, counter.requests].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid usage counter');
      if (counter.used + units! > limit) return { allowed: false, retryAfter: Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86400000 - now) / 1000) };
      if (counter.requests >= 6) return { allowed: false, retryAfter: 60 - Math.floor(now / 1000) % 60 };
      counter.used += units!; counter.requests++;
      await store.put('usage', counter);
      return { allowed: true, retryAfter: 0 };
    });
    return Response.json(result, { status: result.allowed ? 200 : 429 });
  }
}

export function analysisUnits(request: ReturnType<typeof validateAnalysis>): number {
  let images = 0;
  const text = JSON.stringify(request.data, (key, value) => {
    if (key === 'image' && typeof value === 'string') { images++; return undefined; }
    return value;
  });
  const base = request.kind === 'pregrade' ? 5 : request.kind === 'evidence' ? 2 : 1;
  return base + Math.ceil(text.length / 20000) + images * 2;
}
