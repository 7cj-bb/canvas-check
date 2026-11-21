import type { AIFile } from '../src/ai/contracts';
import type { Requirement } from '../src/core/types';
import type { Language } from '../src/core/i18n';
import { LIMITS, type ContentPart } from '../src/core/types';

export function validateInput(raw: unknown, evidence = false) {
  const input = raw as { task?: { title?: string; description?: string }; requirements?: Requirement[]; files?: AIFile[]; language?: unknown };
  if (input?.language !== undefined && input.language !== 'en' && input.language !== 'zh-CN') throw new Error('Unsupported interface language.');
  const language: Language = input?.language === 'en' ? 'en' : 'zh-CN';
  if (!input?.task || typeof input.task.title !== 'string' || input.task.title.length > 500 || typeof input.task.description !== 'string' || input.task.description.length > 80000) throw new Error('作业要求超出本轮分析范围。');
  const task = { title: input.task.title, description: input.task.description };
  if (!evidence) return { task, requirements: [], files: [], language };
  if (!Array.isArray(input.requirements) || input.requirements.length > 41 || !Array.isArray(input.files) || input.files.length > LIMITS.files + 1) throw new Error('核对材料范围无效。');
  const requirements = input.requirements.filter(r => r.kind === 'semantic');
  for (const r of requirements) if (typeof r.id !== 'string' || typeof r.label !== 'string' || typeof r.quote !== 'string' || !r.quote.trim() || !['image', 'text', 'any'].includes(r.artifact ?? '') || !task.description.replace(/\s+/g, ' ').includes(r.quote.replace(/\s+/g, ' '))) throw new Error('检查项缺少老师原文依据。');
  const ids = new Set<string>();
  let imageCharacters = 0, imageCount = 0;
  const imageValue = (value: unknown) => {
    if (typeof value !== 'string' || value.length > 4000000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new Error('图片必须是本地读取的 PNG 或 JPEG。');
    imageCharacters += value.length; imageCount++;
    if (imageCharacters > LIMITS.aiImageCharacters || imageCount > LIMITS.aiImages) throw new Error('图片及文档页面超过本轮读取范围。');
    return value;
  };
  const files = input.files.map(file => {
    if (!file || typeof file.id !== 'string' || ids.has(file.id) || typeof file.name !== 'string' || typeof file.complete !== 'boolean' || !['java', 'text', 'pdf', 'image', 'document','presentation','spreadsheet','unknown'].includes(file.kind)) throw new Error('文件信息无效。');
    ids.add(file.id);
    if (file.text !== undefined && (typeof file.text !== 'string' || file.text.length > 120000)) throw new Error('文件文字过长。');
    if (file.image !== undefined && file.kind !== 'image') throw new Error('文件图片范围无效。');
    const image = file.image === undefined ? undefined : imageValue(file.image);
    let parts: ContentPart[] | undefined;
    if (file.parts !== undefined) {
      if (!['pdf','document','presentation','spreadsheet'].includes(file.kind) || !Array.isArray(file.parts) || file.parts.length > LIMITS.pdfPages) throw new Error('文档页面范围无效。');
      const partIds = new Set<string>(), pageNumbers = new Set<number>();
      parts = file.parts.map(part => {
        if (!part || typeof part.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(part.id) || partIds.has(part.id) || typeof part.label !== 'string' || part.label.length > 100 || typeof part.complete !== 'boolean') throw new Error('文档页面信息无效。');
        partIds.add(part.id);
        if (part.page !== undefined && (!Number.isSafeInteger(part.page) || part.page < 1 || part.page > 10000 || pageNumbers.has(part.page))) throw new Error('文档页码无效。');
        if (part.page !== undefined) pageNumbers.add(part.page);
        if (part.text !== undefined && (typeof part.text !== 'string' || part.text.length > 6000)) throw new Error('文档单页文字过长。');
        const image = part.image === undefined ? undefined : imageValue(part.image);
        return {id:part.id,label:part.label,page:part.page,text:part.text,image,complete:part.complete && Boolean(image || part.text?.trim())};
      });
    }
    if (file.totalParts !== undefined && (!Number.isSafeInteger(file.totalParts) || file.totalParts < 0 || file.totalParts > 10000)) throw new Error('文档页数无效。');
    const partsComplete = !parts || parts.length === (file.totalParts ?? parts.length) && parts.every(part=>part.complete) && (file.kind !== 'pdf' || parts.every((part,index)=>part.page===index+1 && Boolean(part.image)));
    const text = file.text ?? (parts ? parts.map(part=>part.text ?? '').join('\n\n') : undefined);
    return { id: file.id, name: file.name.slice(0, 300), kind: file.kind, complete: file.complete && partsComplete && (file.kind === 'image' ? Boolean(image) : file.kind === 'unknown' ? false : text !== undefined || Boolean(parts?.length)), text, image, parts,totalParts:file.totalParts };
  });
  return { task, requirements, files, language };
}
