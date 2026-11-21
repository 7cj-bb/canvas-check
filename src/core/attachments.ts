import type { CanvasAttachment, CanvasState } from './types';
import { activeUploadPane, NativeDraftFiles } from './draft-files';

export interface AttachmentRow { id: string; name: string; uploading: boolean }

/** IDs come from the current Canvas table, never from a history of file choices. */
export function resolveAttachmentRows(rows: AttachmentRow[], paneAvailable: boolean): Pick<CanvasState, 'attachments' | 'coverage' | 'warning'> {
  if (!paneAvailable) return { attachments: [], coverage: 'unavailable', warning: '当前页面暂时没有可识别的待交附件列表。' };
  if (rows.some(row => row.uploading || !/^\d+$/.test(row.id) || !row.name)) {
    return { attachments: rows.filter(row => /^\d+$/.test(row.id) && row.name && !row.uploading).map(row => ({ id: row.id, name: row.name, size: null })), coverage: 'pending', warning: 'Canvas 正在更新附件，完成后会自动核对。' };
  }
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) return { attachments: [], coverage: 'unavailable', warning: '附件列表暂时无法完整识别，核对已暂停。' };
    ids.add(row.id);
  }
  return { attachments: rows.map(row => ({ id: row.id, name: row.name, size: null })), coverage: 'complete', warning: '' };
}

type AttachmentListing = Pick<CanvasState, 'attachments' | 'coverage' | 'warning' | 'attachmentSource'>;

function scanSubmittedAttachments(doc: Document): AttachmentListing {
  const tables = [...doc.querySelectorAll('[data-testid="uploaded_files_table"]')].filter(table => !table.closest('[hidden], [aria-hidden="true"]'));
  if (!tables.length) return resolveAttachmentRows([], false);
  if (tables.length !== 1) return { attachments: [], coverage: 'unavailable', attachmentSource: 'submitted', warning: '页面上有多份提交记录，暂时无法确认当前附件范围。' };
  const rows = [...tables[0].querySelectorAll('tbody tr')].map(row => {
    const cell = row.querySelector('td:nth-child(2)');
    // Canvas displays an ellipsis followed by the full name for screen readers.
    const name = cell?.querySelector('[title]')?.getAttribute('title')?.trim()
      || cell?.querySelector('span:last-child')?.textContent?.trim() || '';
    const links = [...row.querySelectorAll<HTMLAnchorElement>('a[href]')].map(link => {
      try {
        const url = new URL(link.getAttribute('href')!, doc.URL);
        if (url.origin !== new URL(doc.URL).origin) return '';
        return url.pathname.match(/^\/files\/(\d+)\/download\/?$/)?.[1] ?? '';
      } catch { return ''; }
    }).filter(Boolean);
    return { name, id: links.length === 1 ? links[0] : '', uploading: false };
  });
  const result = resolveAttachmentRows(rows, true);
  return { ...result, attachmentSource: 'submitted', warning: result.coverage === 'complete'
    ? '只核对当前选中尝试的已提交文件；不合并其他尝试，也不影响原提交。'
    : '当前提交记录尚未读取完整，暂不判断遗漏。' };
}

export function scanCanvasAttachments(doc: Document, nativeFiles = new NativeDraftFiles()): AttachmentListing {
  const pane = activeUploadPane(doc);
  if (!pane) { nativeFiles.sync([]); return scanSubmittedAttachments(doc); }
  const table = pane.querySelector('[data-testid="uploaded_files_table"]');
  if (!table) {
    // Classic Canvas keeps FileList until Submit; modern Canvas initially has no table.
    const knownInput = pane.querySelector('input[type="file"], #inputFileDrop');
    const files = [...pane.querySelectorAll<HTMLInputElement>('input[type="file"]')].filter(input => !input.disabled && !input.parentElement?.closest('[hidden], [aria-hidden="true"]')).flatMap(input => [...(input.files ?? [])]);
    return { ...resolveAttachmentRows([], Boolean(knownInput)), attachments: nativeFiles.sync(files), attachmentSource: 'draft' };
  }
  // Once Canvas creates its draft table, that live table owns additions/removals.
  nativeFiles.sync([]);
  const rows = [...table.querySelectorAll('tbody tr')].map(row => {
    const name = row.querySelector('td:nth-child(2) [title]')?.getAttribute('title')?.trim() ?? '';
    const remove = row.querySelector<HTMLButtonElement>('td:last-child button[id]');
    return { name, id: remove?.id ?? '', uploading: Boolean(row.querySelector('[role="progressbar"]')) || !remove };
  });
  if (!rows.length && table.querySelector('tr td')) return { ...resolveAttachmentRows([{ id: '', name: '', uploading: true }], true), attachmentSource: 'draft' };
  return { ...resolveAttachmentRows(rows, true), attachmentSource: 'draft' };
}

export function attachmentSnapshotKey(state: Pick<CanvasState, 'attachments' | 'coverage' | 'attachmentSource'>): string {
  return JSON.stringify([state.attachmentSource ?? 'draft', state.coverage, state.attachments.map(file => [file.id, file.name]).sort((a, b) => a[0].localeCompare(b[0]))]);
}
