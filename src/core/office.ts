import { unzipSync } from 'fflate';
import { LIMITS, type ContentPart } from './types';
import { detectFormat } from './formats';
import { imageData } from './images';

function xml(bytes: Uint8Array): Document {
  const source = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('文档包含不支持的 XML 声明。');
  const doc = new DOMParser().parseFromString(source,'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('文档 XML 未能完整读取。');
  return doc;
}
const nodes = (doc: Document | Element, tag: string) => [...doc.getElementsByTagNameNS('*',tag)];
function paragraphs(doc: Document) { return nodes(doc,'p').map(p => nodes(p,'t').map(t => t.textContent ?? '').join('')).join('\n'); }

/** Read bounded OOXML text and embedded images; never execute macros or resolve external relationships. */
export async function readOffice(bytes: Uint8Array, format: string, signal?: AbortSignal) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('文件不是有效的 Office Open XML 文档。');
  let entries = 0, expanded = 0, omittedObjects = false;
  const archive = unzipSync(bytes,{filter(file) {
    if (++entries > 1200) throw new Error('文档内部项目超过读取范围。');
    if (/\/(?:charts|diagrams|embeddings)\//.test(file.name)) omittedObjects = true;
    const selected = /^(?:word|ppt|xl)\/(?:.*\.(?:xml|rels)|media\/[^/]+)$/i.test(file.name) && !file.name.includes('..');
    if (!selected) return false;
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize > LIMITS.bytes || (expanded += file.originalSize) > LIMITS.bytes) throw new Error('文档解压内容超过 20 MB。');
    return true;
  }});
  signal?.throwIfAborted();
  let text = '';
  const parts: ContentPart[] = [];
  let complete = !omittedObjects;
  if (format === 'pptx' || Object.keys(archive).some(name => /\/(?:charts|diagrams|embeddings)\//.test(name))) complete = false;
  if (format === 'docx') {
    if (!archive['word/document.xml']) throw new Error('Word 正文未找到。');
    const documents = Object.keys(archive).filter(name => /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(name));
    text = documents.map(name => { const doc = xml(archive[name]); if (nodes(doc,'shape').length || nodes(doc,'wsp').length || nodes(doc,'altChunk').length) complete = false; return paragraphs(doc); }).join('\n\n');
  } else if (format === 'pptx') {
    const slides = Object.keys(archive).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));
    if (!slides.length) throw new Error('演示文稿中未找到幻灯片。');
    if (slides.length > 100) complete = false;
    text = slides.slice(0,100).map((name,i) => `Slide ${i+1}\n${paragraphs(xml(archive[name]))}`).join('\n\n');
  } else {
    const shared = archive['xl/sharedStrings.xml'] ? nodes(xml(archive['xl/sharedStrings.xml']),'si').map(si => nodes(si,'t').map(t => t.textContent ?? '').join('')) : [];
    const sheets = Object.keys(archive).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort((a,b) => Number(a.match(/sheet(\d+)/)?.[1]) - Number(b.match(/sheet(\d+)/)?.[1]));
    if (!sheets.length) throw new Error('工作簿中未找到工作表。');
    text = sheets.slice(0,30).map((name,i) => {
      const rows = nodes(xml(archive[name]),'row');
      if (rows.length > 5000) complete = false;
      return `Sheet ${i+1}\n` + rows.slice(0,5000).map(row => nodes(row,'c').map(cell => {
        const type = cell.getAttribute('t'), value = nodes(cell,'v')[0]?.textContent ?? '';
        const content = type === 's' ? shared[Number(value)] ?? '' : type === 'inlineStr' ? nodes(cell,'t').map(t => t.textContent ?? '').join('') : value;
        const formula = nodes(cell,'f')[0]?.textContent;
        return `${cell.getAttribute('r') ?? ''}: ${content}${formula ? ` [formula: ${formula}]` : ''}`;
      }).join('\t')).join('\n');
    }).join('\n\n');
    if (sheets.length > 30) complete = false;
  }
  const linked = new Set<string>(), visited = new Set<string>();
  const pending = Object.keys(archive).filter(name => format==='docx' ? name==='word/document.xml' : format==='pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(name) : /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  while (pending.length) {
    const owner = pending.shift()!; if (visited.has(owner)) continue; visited.add(owner);
    const slash = owner.lastIndexOf('/'), relName = `${owner.slice(0,slash)}/_rels/${owner.slice(slash+1)}.rels`;
    if (!archive[relName]) continue;
    const document = xml(archive[owner]);
    const ids = new Set([...document.getElementsByTagName('*')].flatMap(element=>[...element.attributes].filter(attr=>attr.namespaceURI?.includes('relationships')).map(attr=>attr.value)));
    for (const relation of nodes(xml(archive[relName]),'Relationship')) {
      if (!ids.has(relation.getAttribute('Id') ?? '')) continue;
      if (relation.getAttribute('TargetMode')==='External') { if (/\/(?:image|oleObject|package)$/.test(relation.getAttribute('Type') ?? '')) complete = false; continue; }
      const target = relation.getAttribute('Target') ?? ''; if (/^[a-z]+:|\\/i.test(target)) continue;
      const segments: string[] = [];
      for (const segment of `${target.startsWith('/')?'':owner.slice(0,slash)}/${target}`.split('/')) { if(segment==='..') segments.pop(); else if(segment && segment!=='.') segments.push(segment); }
      const name = segments.join('/');
      if (archive[name] && /\/media\//.test(name)) linked.add(name);
      else if (archive[name] && name.endsWith('.xml')) pending.push(name);
      else if (/\/(?:image|oleObject|package)$/.test(relation.getAttribute('Type') ?? '')) complete = false;
    }
  }
  const allMedia = Object.keys(archive).filter(name=>/\/media\//.test(name));
  const media = [...linked];
  if (media.length < allMedia.length) complete = false;
  for (const [index,name] of media.entries()) {
    signal?.throwIfAborted();
    const format = detectFormat(name,archive[name]);
    if (index >= LIMITS.pdfPages) { complete = false; break; }
    try {
      if (!['png','jpg','webp','bmp','gif'].includes(format)) throw new Error('Unsupported embedded image');
      const data = await imageData(archive[name],`image/${format === 'jpg' ? 'jpeg' : format}`,signal);
      parts.push({id:`image-${index+1}`,label:`内嵌图片 ${index+1}`,image:data.image,complete:format !== 'gif'});
      if (format === 'gif') complete = false;
    } catch (error) {
      if (signal?.aborted) throw error;
      complete = false; parts.push({id:`image-${index+1}`,label:`内嵌图片 ${index+1}`,complete:false});
    }
  }
  if (text.length > 240000) { text = text.slice(0,240000); complete = false; }
  return { text, parts, totalParts:media.length, complete };
}
