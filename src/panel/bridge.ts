import type { CanvasState } from '../core/types';
import { LIMITS } from '../core/types';
import { CHANNEL, PROTOCOL_VERSION } from '../core/protocol';
import type { Language } from '../core/i18n';

export const inExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id) && !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === '1');
export { CHANNEL };

export async function currentTabId(): Promise<number | undefined> {
  if (!inExtension) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

export async function readCanvasState(tabId: number, language: Language = 'en'): Promise<CanvasState> {
  let current: CanvasState | undefined;
  try { current = await chrome.tabs.sendMessage(tabId, { channel: CHANNEL, type: 'get-state', language }); } catch {}
  if (current?.protocolVersion === PROTOCOL_VERSION) return current;
  const response = await chrome.runtime.sendMessage({ channel: CHANNEL, type: 'ensure-page', tabId });
  if (!response?.ok) throw new Error(response?.error || '当前作业页暂时无法连接。');
  const next: CanvasState = await chrome.tabs.sendMessage(tabId, { channel: CHANNEL, type: 'get-state', language });
  if (next?.protocolVersion !== PROTOCOL_VERSION) throw new Error('页面连接版本不一致，请完整刷新 Canvas。');
  return next;
}

export async function retrieveFile(tabId: number, id: string, knownSize: number | null, signal: AbortSignal, scope: { assignmentKey: string; revision: number; attempt?: number }): Promise<File> {
  if (knownSize !== null && knownSize > LIMITS.bytes) throw new Error('文件超过 20 MB。');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let name = '', type = '', size = knownSize;
  for (let offset = 0; size === null || offset < size || (size === 0 && offset === 0);) {
    signal.throwIfAborted();
    const chunk = await chrome.tabs.sendMessage(tabId, { channel: CHANNEL, type: 'get-file-chunk', id, offset, ...scope });
    if (chunk.error) throw new Error(chunk.error);
    if (!Number.isSafeInteger(chunk.size) || chunk.size < 0 || chunk.size > LIMITS.bytes || (size !== null && chunk.size !== size)) throw new Error('文件大小超限或状态不一致。');
    size = chunk.size;
    if (typeof chunk.base64 !== 'string' || !Number.isSafeInteger(chunk.length) || chunk.length < 0 || chunk.length > 192 * 1024) throw new Error('文件传输状态不一致。');
    const binary = atob(chunk.base64);
    if (binary.length !== chunk.length || (chunk.size > 0 && !chunk.length) || offset + chunk.length > chunk.size) throw new Error('文件分块不完整。');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    chunks.push(bytes);
    name = chunk.name; type = chunk.type;
    offset += chunk.length;
    if (!size) break;
  }
  signal.throwIfAborted();
  return new File(chunks, name, { type });
}
