import { LIMITS, type CanvasAttachment } from './types';

/** Live File objects stay in the page adapter. Only metadata crosses the extension bridge. */
export class NativeDraftFiles {
  private identities = new WeakMap<File, string>();
  private files = new Map<string, File>();
  private sequence = 0;

  sync(selected: File[]): CanvasAttachment[] {
    const next = new Map<string, File>();
    for (const file of selected) {
      let id = this.identities.get(file);
      if (!id) { id = `draft:${++this.sequence}`; this.identities.set(file, id); }
      next.set(id, file);
    }
    this.files = next;
    return [...next].map(([id, file]) => ({ id, name: file.name, size: file.size }));
  }

  async chunk(id: string, offset: number) {
    const file = this.files.get(id);
    if (!file) throw new Error('附件范围已变化，正在自动同步。');
    if (file.size > LIMITS.bytes) throw new Error('文件超过 20 MB。');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size || (file.size > 0 && offset === file.size)) throw new Error('文件传输状态不一致。');
    const bytes = new Uint8Array(await file.slice(offset, offset + 192 * 1024).arrayBuffer());
    if (this.files.get(id) !== file) throw new Error('附件范围已变化，正在自动同步。');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { base64: btoa(binary), length: bytes.length, size: file.size, name: file.name, type: file.type };
  }
}

export function activeUploadPane(doc: Document): Element | undefined {
  return [...doc.querySelectorAll('#file-upload-container, [data-testid="file-upload-container"], #submit_online_upload_form')].find(node => {
    if (node.closest('[hidden], [aria-hidden="true"], [style*="display: none"], [style*="display:none"]')) return false;
    // The file input itself may be visually hidden behind Canvas's file chooser.
    for (let parent: Element | null = node; parent; parent = parent.parentElement) {
      if (doc.defaultView && parent.isConnected) {
        const style = doc.defaultView.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
    }
    return true;
  });
}
