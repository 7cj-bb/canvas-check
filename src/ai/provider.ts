import { LIMITS, type AssignmentSnapshot, type CheckResult, type ReadFile, type Requirement, type ContentPart } from '../core/types';
import type { AIFile, AISummary, AIStatus } from './contracts';
import type { Language } from '../core/i18n';
import type { GradingBasis, GradingHistory, PregradeReport } from '../core/pregrade';
import { createAIClient } from './client';
export { summaryKey } from './client';
export const SETUP_URL = 'http://127.0.0.1:4318/setup';
interface Backend { baseUrl: string; token: string; mode: 'cloud' | 'development' }
let credential: Promise<Backend> | undefined;
async function backend() {
  credential ??= fetch(chrome.runtime.getURL('local-bridge.json')).then(async response => {
    if (!response.ok) throw new Error('请重新加载最新版扩展。');
    const data = await response.json();
    const url = new URL(data.baseUrl);
    if (url.protocol !== 'https:' && url.origin !== 'http://127.0.0.1:4318' || typeof data.token !== 'string' || data.token.length < 32) throw new Error('AI 服务连接配置不完整。');
    return { baseUrl: url.origin, token: data.token, mode: data.mode === 'cloud' ? 'cloud' : 'development' };
  });
  return credential;
}
export async function aiStatus(signal: AbortSignal): Promise<AIStatus> {
  const config = await backend();
  const headers: Record<string, string> = { Authorization: `Bearer ${config.token}` };
  headers['X-Canvas-Check-Extension'] = chrome.runtime.id;
  const response = await fetch(`${config.baseUrl}/health`, { signal, headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`AI 服务连接未通过（HTTP ${response.status}）。`); return { ...await response.json(), mode: config.mode };
}
async function post<T>(endpoint: string, data: unknown, signal: AbortSignal): Promise<T> {
  const config = await backend();
  const headers: Record<string, string> = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
  headers['X-Canvas-Check-Extension'] = chrome.runtime.id;
  const response = await fetch(`${config.baseUrl}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(data), signal });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'AI 分析未完成。'); return value;
}
export async function summarizeWithAI(assignment: AssignmentSnapshot, signal: AbortSignal, language: Language = 'zh-CN'): Promise<AISummary> {
  return client.summarize(assignment, signal, language);
}
const client = createAIClient(post);
export const cachedSummary = client.peekSummary;
export async function pregradeWithAI(assignment: AssignmentSnapshot, grading: GradingBasis, history: GradingHistory, scope: {attempt:number|null; submittedAt:string|null; draft:boolean}, files: ReadFile[], signal: AbortSignal, language: Language): Promise<PregradeReport> {
  const prepared = await prepareAIFiles(files); signal.throwIfAborted();
  return post('/api/pregrade', {task:{title:assignment.title,description:assignment.description},submissionMode:assignment.submissionMode??'upload',grading,history,scope,files:prepared,language}, signal);
}
async function smallImage(file: ReadFile): Promise<string | undefined> {
  if (!file.preview?.startsWith('data:image/')) return;
  if (file.preview.length < 3000000 && Math.max(file.width ?? 0, file.height ?? 0) <= 1800) return file.preview;
  const bitmap = await createImageBitmap(await (await fetch(file.preview)).blob());
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d'); if (!context) return;
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    if (blob.size > 2500000) return;
    const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } finally { bitmap.close(); }
}
export async function prepareAIFiles(files: ReadFile[]): Promise<AIFile[]> {
  let total = 0, images = 0;
  const prepared: AIFile[] = [];
  for (const file of files) {
    const kind = file.kind === 'unknown' && ['png', 'jpg', 'jpeg'].includes(file.extension) ? 'image' : file.kind;
    let image: string | undefined;
    if (kind === 'image' && file.preview) { try { image = await smallImage(file); } catch {} }
    if (image && (total + image.length > LIMITS.aiImageCharacters || images >= LIMITS.aiImages)) image = undefined;
    total += image?.length ?? 0;
    if (image) images++;
    const text = file.text?.slice(0, 120000);
    const parts: ContentPart[] | undefined = file.parts?.map(part => {
      let image = part.image;
      if (image && (total + image.length > LIMITS.aiImageCharacters || images >= LIMITS.aiImages)) image = undefined;
      if (image) { total += image.length; images++; }
      const text = part.text?.slice(0,6000);
      return {id:part.id,label:part.label,page:part.page,text,image,complete:part.complete && Boolean(image || text?.trim()) && (!part.image || Boolean(image)) && (!part.text || part.text.length <= 6000)};
    });
    const fullParts = !parts || parts.length === (file.totalParts ?? parts.length) && parts.every(part=>part.complete);
    prepared.push({ id: file.id, name: file.name, kind, image, text:kind==='pdf' && parts ? undefined : text,parts,totalParts:file.totalParts, complete: file.state === 'ready' && fullParts && (kind === 'image' ? Boolean(image) : kind==='pdf' && parts ? parts.length>0 : file.text !== undefined && file.text.length <= 120000) });
  }
  return prepared;
}
export async function locateWithAI(assignment: AssignmentSnapshot, requirements: Requirement[], files: ReadFile[], signal: AbortSignal, language: Language = 'zh-CN', scope = 'draft'): Promise<CheckResult[]> {
  const prepared = await prepareAIFiles(files); signal.throwIfAborted();
  return client.locate(assignment, requirements, prepared, scope, signal, language);
}
export function mergeRequirements(local: Requirement[], ai: Requirement[]): Requirement[] {
  const combined = [...ai, ...local.filter(item => item.kind !== 'semantic' || !ai.some(rule => rule.kind === 'semantic' && rule.quote === item.quote))];
  const seen = new Set<string>();
  return combined.filter(item => { const key = item.kind === 'file' ? `file:${[...item.extensions ?? []].sort().join(',')}` : `${item.kind}:${item.variable ?? item.label}:${item.quote}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
