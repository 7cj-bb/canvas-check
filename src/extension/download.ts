import { allowedFileUrl, CANVAS_ORIGIN } from '../core/download-policy';
import { LIMITS } from '../core/types';

export async function fetchCanvasFile(id: string, fetcher: typeof fetch = fetch, pageMetadata?: unknown): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  if (!/^\d+$/.test(id)) throw new Error('文件编号无效。');
  let meta;
  if (pageMetadata !== undefined) {
    meta = pageMetadata as { id?: unknown; size?: unknown; url?: unknown; 'content-type'?: unknown };
    try { if (!allowedFileUrl(String(meta.url), id)) throw new Error(); }
    catch { throw new Error('页面提供的文件地址无效。'); }
  } else {
    const metaResponse = await fetcher(`${CANVAS_ORIGIN}/api/v1/files/${id}`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
    if (!metaResponse.ok) throw new Error('Canvas 未允许读取这份文件，请确认学校登录仍有效。');
    try { meta = JSON.parse((await metaResponse.text()).replace(/^while\s*\(\s*1\s*\)\s*;\s*/, '')); }
    catch { throw new Error('文件接口返回了登录页，请回到 Canvas 登录后重试。'); }
  }
  if (!meta || String(meta.id) !== id || !Number.isSafeInteger(meta.size) || meta.size < 0) throw new Error('文件信息不完整。');
  if (meta.size > LIMITS.bytes) throw new Error('文件超过 20 MB 读取范围。');
  if (typeof meta.url !== 'string' || !allowedFileUrl(meta.url, id)) throw new Error('学校使用了尚未支持的文件存储域名。');
  let response: Response;
  try { response = await fetcher(meta.url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('文件存储连接失败，请确认扩展具有学校文件存储域名的访问权限。'); }
  if (!response.ok || !response.body) throw new Error('文件下载失败，请检查扩展的学校和文件存储访问权限。');
  if (response.url && !allowedFileUrl(response.url, id)) throw new Error('文件被重定向到了未授权的位置。');
  if (/text\/html/i.test(response.headers.get('content-type') ?? '')) throw new Error('收到的是登录页面，尚未读到原始文件。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > LIMITS.bytes || total > meta.size) throw new Error('下载内容超过 Canvas 记录的大小。');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (total !== meta.size) throw new Error('文件未下载完整，暂不进行内容检查。');
  const bytes = new Uint8Array(total); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  return { bytes, type: typeof meta['content-type'] === 'string' ? meta['content-type'] : 'application/octet-stream' };
}
