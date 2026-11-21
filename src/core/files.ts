import { analyzeJava } from './java';
import { LIMITS, type ReadFile, type ContentPart } from './types';
import { detectFormat } from './formats';
import { imageData } from './images';
import { readOffice } from './office';

export function extensionOf(name: string): string { return name.split('.').pop()?.toLowerCase() ?? ''; }
export async function hashBytes(data: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('');
}

let pdfModule: Promise<{ pdfjs: typeof import('pdfjs-dist'); workerUrl: string }> | undefined;
async function pdfReader() {
  pdfModule ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(async module => {
    const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    return { pdfjs: module, workerUrl: worker };
  });
  return pdfModule;
}

export async function readSubmissionFile(file: File, signal?: AbortSignal): Promise<ReadFile> {
  signal?.throwIfAborted();
  const extension = extensionOf(file.name);
  const base: Pick<ReadFile, 'name' | 'size' | 'extension' | 'detectedFormat'> = { name: file.name, size: file.size, extension };
  if (file.size > LIMITS.bytes) return { ...base, id: `oversize:${file.name}:${file.size}`, kind: 'unknown', state: 'unreadable', note: '文件超过本轮 20 MB 的读取限制。' };
  let id = `unreadable:${file.name}:${file.size}`;
  try {
    const bytes = await file.arrayBuffer();
    id = await hashBytes(bytes);
    const format = detectFormat(file.name, new Uint8Array(bytes));
    base.detectedFormat = format;
    if (['jpg', 'png'].includes(format)) {
      const image = new File([bytes], file.name, { type: format === 'png' ? 'image/png' : 'image/jpeg' });
      const bitmap = await createImageBitmap(image);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      const preview = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片预览读取失败'));
        reader.readAsDataURL(image);
      });
      return { ...base, id, kind: 'image', state: 'ready', preview, ...dimensions, note: '图片已读取；具体内容结论请查看核对清单。' };
    }
    if (['webp','gif','bmp','avif','heic','heif'].includes(format)) {
      const data = await imageData(new Uint8Array(bytes), `image/${format}`, signal);
      const raw = new Uint8Array(bytes);
      const animated = format === 'gif' || format === 'webp' && String.fromCharCode(...raw.slice(12,16)) === 'VP8X' && (raw[20] & 2) !== 0;
      return { ...base,id,kind:'image',state:animated?'unreadable':'ready',preview:data.image,width:data.width,height:data.height,note:animated?'动图仅读取首帧，其余帧尚未核对。': '图片已读取；具体内容结论请查看核对清单。' };
    }
    if (['docx','pptx','xlsx'].includes(format)) {
      const data = await readOffice(new Uint8Array(bytes),format,signal);
      return { ...base,id,kind:format==='docx'?'document':format==='pptx'?'presentation':'spreadsheet',state:data.complete?'ready':'unreadable',text:data.text,parts:data.parts,totalParts:data.totalParts,note:data.complete?'已读取文档文字及内嵌图片。':'已读取部分文字和内嵌图片；图表、布局或其余内容未完整读取。' };
    }
    if (format === 'pdf') {
      const { pdfjs, workerUrl } = await pdfReader();
      // Pass a packaged worker explicitly: avoid PDF.js generating a blob worker
      // for chrome-extension URLs, which would conflict with Manifest V3 CSP.
      const port = new Worker(workerUrl, { type: 'module' });
      const worker = pdfjs.PDFWorker.create({ port });
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes), worker, useSystemFonts:true, useWorkerFetch:false });
      try {
        const pdf = await task.promise;
        const pages = [];
        const parts: ContentPart[] = [];
        let imageBytes = 0;
        for (let page = 1; page <= Math.min(pdf.numPages,LIMITS.pdfPages); page++) {
          signal?.throwIfAborted();
          const p = await pdf.getPage(page);
          let text = '', image: string | undefined;
          try {
            try { const content = await p.getTextContent(); text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim(); } catch {}
            const original = p.getViewport({scale:1});
            const viewport = p.getViewport({scale:Math.min(2,1800/Math.max(original.width,original.height))});
            const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.ceil(viewport.width)); canvas.height = Math.max(1,Math.ceil(viewport.height));
            const context = canvas.getContext('2d'); if (!context) throw new Error('PDF 页面画布不可用。');
            const render = p.render({canvasContext:context,canvas,viewport,background:'#ffffff'});
            const cancel = () => render.cancel(); signal?.addEventListener('abort',cancel,{once:true});
            try { await render.promise; } finally { signal?.removeEventListener('abort',cancel); }
            for (const quality of [0.88,0.72,0.55]) { const candidate = canvas.toDataURL('image/jpeg',quality); if (candidate.length <= 1000000) { image = candidate; break; } }
            canvas.width = canvas.height = 0;
            if (image && imageBytes + image.length <= LIMITS.aiImageCharacters) imageBytes += image.length; else image = undefined;
          } catch (error) { if (signal?.aborted) throw error; }
          finally { p.cleanup(); }
          pages.push({page,text}); parts.push({id:`page-${page}`,label:`第 ${page} 页`,page,text,image,complete:Boolean(image)});
        }
        const complete = parts.length === pdf.numPages && parts.every(part => part.complete);
        return { ...base,id,kind:'pdf',state:complete?'ready':'unreadable',pages,parts,totalParts:pdf.numPages,text:pages.map(p=>p.text).join('\n\n'),note:complete ? pages.some(page=>!page.text.trim())?'扫描页面已生成预览，启用 AI 后会识别文字和图片内容。':'PDF 文字与页面图像已读取。' : `PDF 共 ${pdf.numPages} 页，已处理 ${parts.length} 页；未完整读取的页面暂不判断遗漏。` };
      } finally { try { await task.destroy(); } finally { worker.destroy(); port.terminate(); } }
    }
    if (!['doc','xls','ppt','rtf','zip','7z','rar','exe','class','jar','mp4','mp3','wav','tiff','tif','psd'].includes(format)) {
      const raw = new Uint8Array(bytes);
      const encoding = raw[0]===0xff && raw[1]===0xfe ? 'utf-16le' : raw[0]===0xfe && raw[1]===0xff ? 'utf-16be' : 'utf-8';
      const text = new TextDecoder(encoding,{fatal:true}).decode(bytes);
      if (!text.includes('\u0000') && (text.match(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g)?.length ?? 0) < Math.max(1,text.length/100)) return { ...base,id,kind:format==='java'?'java':'text',state:'ready',text,java:format==='java'?analyzeJava(text):undefined,note:!text.trim()?'文件没有文字内容。':undefined };
    }
    return { ...base, id, kind: 'unknown', state: 'unsupported', note: '这一版还不能读取此格式。' };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ...base, id, kind: extension === 'java' ? 'java' : extension === 'pdf' ? 'pdf' : 'unknown', state: 'unreadable', note: '内容未能读取，可能涉及编码、加密或文件损坏。不会据此判断缺项。' };
  }
}
