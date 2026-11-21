export const CANVAS_ORIGIN = 'https://thevillageschool.instructure.com';
export const FILE_ORIGIN = 'https://cdn.inst-fs-iad-prod.inscloudgate.net';
export const FILE_GATEWAY_ORIGIN = 'https://inst-fs-iad-prod.inscloudgate.net';

export function allowedFileUrl(raw: string, id: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || !/^\d+$/.test(id)) return false;
    return url.origin === CANVAS_ORIGIN ? url.pathname === `/files/${id}/download` : url.origin === FILE_GATEWAY_ORIGIN ? url.pathname.startsWith('/files/') && url.pathname.length > 7 : url.origin === FILE_ORIGIN && url.pathname.length > 1;
  } catch { return false; }
}
