import { allowedFileUrl } from '../core/download-policy';
import { LIMITS } from '../core/types';
export interface DownloadMetadata { id: string; size: number; url: string; 'content-type'?: string }
const parse = (text: string) => JSON.parse(text.replace(/^\uFEFF/, '').trimStart().replace(/^while\s*\(\s*1\s*\)\s*;\s*/, ''));

/** Obtain metadata and the signed read address using the student's existing same-origin session. */
export async function readCanvasFileMetadata(id: string, fetcher: typeof fetch = fetch): Promise<DownloadMetadata> {
  if (!/^\d+$/.test(id)) throw new Error('文件编号无效。');
  const options: RequestInit = { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } };
  const infoResponse = await fetcher(`/api/v1/files/${id}`, options);
  if (!infoResponse.ok) throw new Error(`Canvas 文件信息读取失败（${infoResponse.status}）。`);
  let meta;
  try { meta = parse(await infoResponse.text()); } catch { throw new Error('Canvas 未返回完整的文件信息。'); }
  if (String(meta.id) !== id || !Number.isSafeInteger(meta.size) || meta.size < 0) throw new Error('Canvas 文件信息不完整。');
  if (meta.size > LIMITS.bytes) throw new Error('文件超过本轮 20 MB 读取范围。');
  const addressResponse = await fetcher(`/api/v1/files/${id}/public_url`, options);
  if (!addressResponse.ok) throw new Error(`Canvas 文件地址读取失败（${addressResponse.status}）。`);
  let address;
  try { address = parse(await addressResponse.text()).public_url; } catch { throw new Error('Canvas 未返回可用的文件地址。'); }
  if (typeof address !== 'string' || !allowedFileUrl(address, id)) {
    let host = ''; try { host = new URL(address).hostname; } catch {}
    throw new Error(host ? `学校返回了尚未支持的文件存储域名：${host}` : 'Canvas 文件地址无效。');
  }
  return { id, size: meta.size, url: address, 'content-type': typeof meta['content-type'] === 'string' ? meta['content-type'] : undefined };
}
