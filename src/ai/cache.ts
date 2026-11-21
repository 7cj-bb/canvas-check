/** Results live only for this panel session. Switching views cancels a subscriber,
 * not an already-authorized request that another view may reuse. No disk storage. */
export class RequestCache<T> {
  private done = new Map<string, T>();
  private pending = new Map<string, Promise<T>>();
  constructor(private limit = 24) {}
  peek(key: string) { return this.done.get(key); }
  get(key: string, load: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.done.has(key)) {
      const value = this.done.get(key)!;
      this.done.delete(key); this.done.set(key, value);
      return Promise.resolve(value);
    }
    let job = this.pending.get(key);
    if (!job) {
      job = Promise.resolve().then(() => load(AbortSignal.timeout(90000))).then(value => {
        this.done.set(key, value);
        while (this.done.size > this.limit) this.done.delete(this.done.keys().next().value!);
        return value;
      }).finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      job!.then(value => { if (!signal.aborted) resolve(value); }, error => { if (!signal.aborted) reject(error); })
        .finally(() => signal.removeEventListener('abort', abort));
    });
  }
}

export async function contentKey(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
