import { fetchCanvasFile } from './download';
import { CANVAS_ORIGIN, FILE_ORIGIN, FILE_GATEWAY_ORIGIN } from '../core/download-policy';
import { LIMITS } from '../core/types';
import { CHANNEL } from '../core/protocol';
const cached = new Map<string, { at: number; size: number; pending: ReturnType<typeof fetchCanvasFile> }>();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== CHANNEL || sender.id !== chrome.runtime.id) return;
  if (message.type === 'ensure-page') {
    if (sender.tab || !Number.isSafeInteger(message.tabId) || sender.url !== chrome.runtime.getURL('sidepanel.html')) { respond({ ok: false }); return; }
    chrome.tabs.get(message.tabId).then(tab => {
      const url = tab.url ? new URL(tab.url) : null;
      if (!url || url.origin !== CANVAS_ORIGIN || !/^\/courses\/\d+\/assignments\/\d+\/?$/.test(url.pathname)) throw new Error('请先打开 Canvas 作业。');
      return chrome.scripting.executeScript({ target: { tabId: message.tabId }, files: ['content.js'] });
    }).then(() => respond({ ok: true })).catch(e => respond({ ok: false, error: e instanceof Error ? e.message : '作业页连接未完成。' }));
    return true;
  }
  if (message.type === 'download-chunk') {
    const id = String(message.id), offset = message.offset;
    const source = sender.tab?.url ? new URL(sender.tab.url) : null;
    if (!source || source.origin !== CANVAS_ORIGIN || !/^\/courses\/\d+\/assignments\/\d+\/?$/.test(source.pathname) || !/^\d+$/.test(id) || !Number.isSafeInteger(offset) || offset < 0) { respond({ error: '当前页面不能读取此文件。' }); return; }
    const key = `${sender.tab!.id}:${source.pathname}:${id}`;
    for (const [cacheKey, item] of cached) if (Date.now() - item.at > 60000) cached.delete(cacheKey);
    let item = cached.get(key);
    if (!item) {
      if (cached.size >= LIMITS.files) { respond({ error: '本轮文件读取范围已满，请稍后重试。' }); return; }
      const pending = chrome.permissions.contains({ origins: [`${FILE_GATEWAY_ORIGIN}/*`, `${FILE_ORIGIN}/*`] }).then(granted => {
        if (!granted) throw new Error('尚未获得学校文件存储访问权限，请在 Chrome 的 Canvas Check 网站访问设置中允许两个文件存储域名。');
        return fetchCanvasFile(id, fetch, message.metadata);
      }).then(result => {
        if ([...cached.values()].reduce((sum, entry) => sum + entry.size, 0) + result.bytes.length > LIMITS.bytes) throw new Error('这批文件合计超过 20 MB。');
        const entry = cached.get(key); if (entry) entry.size = result.bytes.length;
        return result;
      });
      item = { at: Date.now(), size: 0, pending }; cached.set(key, item);
      pending.catch(() => cached.delete(key));
    }
    item.pending.then(({ bytes, type }) => {
      if (offset > bytes.length) throw new Error('文件分块范围无效。');
      const part = bytes.subarray(offset, offset + 192 * 1024); let binary = '';
      for (let i = 0; i < part.length; i += 8192) binary += String.fromCharCode(...part.subarray(i, i + 8192));
      respond({ base64: btoa(binary), length: part.length, size: bytes.length, type });
    }).catch(e => respond({ error: e instanceof Error ? e.message : '文件暂时无法读取。' }));
    return true;
  }
  if (message.type === 'open-panel' && sender.tab?.id !== undefined) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
    return true;
  }
});
