import type { CanvasAttachment } from './types';
export function inlineCanvasImages(html: string, origin: string): { images: CanvasAttachment[]; incomplete:boolean } {
  const images: CanvasAttachment[] = []; let incomplete=/<(?:iframe|object|embed|video|audio)\b/i.test(html);
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const attributes = new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match=>[match[1].toLowerCase(),match[2]??match[3]]));
    let id = '';
    for (const value of [attributes.get('data-api-endpoint'),attributes.get('src')]) {
      if(!value) continue;
      try { const url=new URL(value.replaceAll('&amp;','&'),origin); if(url.origin===origin) id=url.pathname.match(/^\/(?:api\/v1\/)?(?:courses\/\d+\/)?files\/(\d+)(?:\/|$)/)?.[1] ?? ''; } catch {}
      if(id) break;
    }
    if(!id) { incomplete=true; continue; }
    if(!images.some(image=>image.id===id)) images.push({id,name:`Canvas image ${id}.png`,size:null,origin:'canvas-inline'});
  }
  return {images,incomplete};
}
/** Strip active elements before parsing Canvas rich text; never insert returned HTML into the app. */
export function submissionHTMLText(html: string): string {
  const safe = html.replace(/<(script|style|iframe|object|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(?:img|iframe|link|video|audio|source|object|embed|script)\b[^>]*\/?\s*>/gi,'').replace(/<\/?(?:p|div|li|tr|h[1-6]|pre|blockquote)\b[^>]*>|<br\s*\/?\s*>/gi,'\n');
  if (typeof DOMParser !== 'undefined') return (new DOMParser().parseFromString(safe,'text/html').body.textContent ?? '').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  return safe.replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[entity]!)).trim();
}
export function scanSubmissionText(doc: Document): { text: string; draft: boolean; images:CanvasAttachment[]; incomplete:boolean } | null {
  const containers = [...doc.querySelectorAll('#text-entry-container, [data-testid="text-entry-container"], #submit_online_text_entry_form')].filter(node => !node.closest('[hidden], [aria-hidden="true"], [style*="display: none"], [style*="display:none"]'));
  const textarea = doc.querySelector<HTMLTextAreaElement>('textarea[name="submission[body]"]');
  const fallback = textarea?.closest('form');
  const container = containers[0] ?? (fallback && !fallback.closest('[hidden], [aria-hidden="true"], [style*="display: none"], [style*="display:none"]') ? fallback : null);
  if (!container) return null;
  let origin='https://canvas.invalid'; try { origin=new URL(doc.URL).origin; } catch {}
  for (const iframe of container.querySelectorAll<HTMLIFrameElement>('iframe.tox-edit-area__iframe, iframe[id$="_ifr"]')) {
    try { const body = iframe.contentDocument?.body; if (body) return { text: body.innerText?.trim() || body.textContent?.trim() || '', draft:true,...inlineCanvasImages(body.innerHTML,origin) }; } catch {}
    return {text:'',draft:true,images:[],incomplete:true};
  }
  const rich = container.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"], [contenteditable="true"].mce-content-body');
  if (rich) return { text: rich.innerText?.trim() || rich.textContent?.trim() || '', draft:true,...inlineCanvasImages(rich.innerHTML,origin) };
  const input = container.querySelector<HTMLTextAreaElement>('textarea[name="submission[body]"],textarea');
  if (!input) return null;
  return /<(?:p|div|br|img)\b/i.test(input.value) ? {text:submissionHTMLText(input.value),draft:true,...inlineCanvasImages(input.value,origin)} : { text:input.value,draft:true,images:[],incomplete:false };
}
