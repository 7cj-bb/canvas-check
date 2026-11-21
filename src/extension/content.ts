import type { AssignmentSnapshot, CanvasState, SubmissionAttempt } from '../core/types';
import { parseSubmissionHistory } from '../core/history';
import { sourceFingerprint } from '../core/requirements';
import { attachmentSnapshotKey, scanCanvasAttachments } from '../core/attachments';
import { CHANNEL, PROTOCOL_VERSION } from '../core/protocol';
import { readCanvasFileMetadata } from './metadata';
import { initialLanguage, translateText, type Language } from '../core/i18n';
import { submissionMode, checksApply } from '../core/submission-mode';
import { scanSubmissionText } from '../core/submission-text';
import { resolveSubmissionScope } from '../core/submission-scope';
import { readGradingBasis, readGradingHistory, type GradingBasis, type GradingHistory } from '../core/pregrade';
import { activeUploadPane, NativeDraftFiles } from '../core/draft-files';
import { attachSubmitGuard } from './submit-guard';
let submitGuard:ReturnType<typeof attachSubmitGuard>|undefined;
const nativeFiles = new NativeDraftFiles();
let grading: GradingBasis | undefined, gradingHistory: GradingHistory | undefined;
let language: Language = initialLanguage(null);
const t = (text: string) => translateText(text, language);

const host = globalThis as typeof globalThis & { canvasCheckDisconnect?: () => void };
host.canvasCheckDisconnect?.();
document.querySelectorAll<HTMLElement>('[data-canvas-check-entry]').forEach(button => { button.style.display = 'none'; });
const metadataCache = new Map<string, Promise<{ id: string; size: number; url: string; 'content-type'?: string }>>();
let history: SubmissionAttempt[] = [];
let historyStatus: NonNullable<CanvasState['historyStatus']> = 'loading';
let historyWarning = '';
let historyContext = '';
let historyRequest: AbortController | null = null;
let historyGeneration = 0;
let historyLoadedAt = 0;
let revision = 0;
let current: AssignmentSnapshot | null = null;
let listing: Pick<CanvasState, 'attachments' | 'coverage' | 'warning' | 'attachmentSource'> = { attachments: [], coverage: 'unavailable', warning: '' };
let previous = '';
let uploadingFrom = '';
let timer: ReturnType<typeof setTimeout>;
let entry: HTMLButtonElement | null = null;
let observer: MutationObserver | null = null;
let detached = false;
let modeContext = '', modeTypes: string[] | undefined, modeRequest: AbortController | null = null, modeLoadedAt = 0;
let submissionText: string | undefined;
let textIncomplete: boolean | undefined;
let poll: ReturnType<typeof setInterval> | undefined;

function readAssignment(): AssignmentSnapshot | null {
  const match = location.pathname.match(/\/courses\/(\d+)\/assignments\/(\d+)/);
  if (!match && !document.querySelector('[data-canvas-check-fixture]')) return null;
  const root = document.querySelector<HTMLElement>('[data-testid="assignments-2-assignment-description"], #assignment_show .description');
  if (!root && !document.querySelector('h1')) return null;
  const paragraphs = [...(root?.querySelectorAll<HTMLElement>('p, li') ?? [])].map(el => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('ul,ol').forEach(child => child.remove());
    return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }).filter(Boolean);
  const input = activeUploadPane(document)?.querySelector<HTMLInputElement>('input[type="file"]');
  const attempt = document.querySelector<HTMLInputElement>('[role="combobox"]');
  return {
    key: `${location.origin}:${match?.[1] ?? 'fixture'}:${match?.[2] ?? '1'}`,
    title: document.querySelector('h1')?.textContent?.trim() || 'Canvas 作业',
    url: `${location.origin}${location.pathname}`, description: root?.innerText.trim() ?? '', paragraphs,
    permittedExtensions: (input?.accept ?? '').split(',').map(x => x.trim().replace(/^\./, '')).filter(Boolean),
    attempt: attempt?.value || attempt?.textContent?.trim() || '当前尝试', source: 'canvas', capturedAt: Date.now(),
    submissionTypes:modeTypes, submissionMode:modeTypes ? submissionMode(modeTypes) : activeUploadPane(document) || document.querySelector('[data-testid="uploaded_files_table"]') ? 'upload' : scanSubmissionText(document) ? 'text' : 'unknown',
    grading,
  };
}

function state(): CanvasState { return { protocolVersion: PROTOCOL_VERSION, assignment: current, revision, ...listing, history, historyStatus, historyWarning,submissionText,textIncomplete,gradingHistory }; }
async function loadMode(key: string) {
  modeLoadedAt = Date.now();
  const match = location.pathname.match(/^\/courses\/(\d+)\/assignments\/(\d+)\/?$/); if (!match) return;
  modeRequest?.abort(); const controller = new AbortController(); modeRequest = controller;
  try {
    const response = await fetch(`/api/v1/courses/${match[1]}/assignments/${match[2]}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),headers:{Accept:'application/json'}});
    if (!response.ok) return;
    const raw = JSON.parse((await response.text()).replace(/^while\s*\(\s*1\s*\)\s*;\s*/,''));
    if (current?.key !== key || controller.signal.aborted || String(raw.id) !== match[2]) return;
    if (Array.isArray(raw.submission_types) && raw.submission_types.every((type:unknown)=>typeof type==='string')) modeTypes = raw.submission_types;
    grading = readGradingBasis(raw, current.description);
  } catch {} finally { if (!detached && current?.key === key && !controller.signal.aborted) refresh(); }
}
function announce() { chrome.runtime.sendMessage({ channel: CHANNEL, type: 'state-changed', state: state() }).catch(() => {}); }
function describeConnection() {
  if (!entry) return;
  entry.dataset.canvasCheckVersion = String(PROTOCOL_VERSION);
  entry.dataset.canvasCheckBuild = chrome.runtime.getManifest().version;
  entry.dataset.canvasCheckLanguage = language;
  entry.dataset.canvasCheckHistory = historyStatus;
  entry.title = t(!checksApply(current) ? current?.submissionMode === 'unknown' ? '提交方式尚未确认，暂不判断遗漏。' : '此项目不在这里提交材料' : historyStatus === 'ready' ? `已载入 ${history.length} 次提交记录` : historyStatus === 'loading' ? '正在获取历史提交记录' : historyWarning);
}

async function loadHistory(assignment: AssignmentSnapshot) {
  const match = location.pathname.match(/^\/courses\/(\d+)\/assignments\/(\d+)\/?$/);
  if (!match) return;
  const before = JSON.stringify([history, gradingHistory, historyStatus, historyWarning]);
  const generation = ++historyGeneration;
  historyRequest?.abort(); const controller = new AbortController(); historyRequest = controller;
  historyStatus = 'loading'; historyWarning = ''; historyLoadedAt = Date.now();
  try {
    const response = await fetch(`/api/v1/courses/${match[1]}/assignments/${match[2]}/submissions/self?include[]=submission_history&include[]=submission_comments&include[]=rubric_assessment`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
    if (!response.ok) throw new Error(`历史提交读取失败（${response.status}）。可在 Canvas 原页面切换 Attempt 查看。`);
    const raw = JSON.parse((await response.text()).replace(/^while\s*\(\s*1\s*\)\s*;\s*/, ''));
    const parsed = parseSubmissionHistory(raw, location.origin);
    if (generation !== historyGeneration || current?.key !== assignment.key) return;
    history = parsed; historyStatus = 'ready';
    gradingHistory = readGradingHistory(raw);
  } catch (e) {
    if (generation !== historyGeneration || controller.signal.aborted) return;
    history = []; gradingHistory = undefined; historyStatus = 'unavailable'; historyWarning = e instanceof Error ? e.message : '历史提交暂时无法读取。';
  }
  if (!detached && generation === historyGeneration && current?.key === assignment.key) {
    refresh();
    if (before !== JSON.stringify([history, gradingHistory, historyStatus, historyWarning])) { revision++; describeConnection(); announce(); }
    else describeConnection();
  }
}

function refresh() {
  if (detached) return;
  if (current && current.key !== `${location.origin}:${location.pathname.match(/\/courses\/(\d+)/)?.[1]}:${location.pathname.match(/\/assignments\/(\d+)/)?.[1]}`) { modeTypes = undefined; grading = undefined; gradingHistory = undefined; modeContext = ''; modeRequest?.abort(); }
  const next = readAssignment();
  let nextListing = next ? scanCanvasAttachments(document, nativeFiles) : { attachments: [], coverage: 'unavailable' as const, warning: '' };
  if(current?.key!==next?.key || nextListing.attachmentSource!=='draft')uploadingFrom='';
  if(uploadingFrom){
    if(attachmentSnapshotKey(nextListing)!==uploadingFrom)uploadingFrom='';
    else nextListing={...nextListing,coverage:'pending',warning:'Canvas 正在更新附件，完成后会自动核对。'};
  }
  if (!next) nativeFiles.sync([]);
  const draftText = next ? scanSubmissionText(document) : null;
  const attemptNumber = Number(next?.attempt.match(/\d+/)?.[0]);
  const submitted = current?.key === next?.key ? Number.isSafeInteger(attemptNumber) && attemptNumber > 0 ? history.find(item=>item.attempt===attemptNumber) : history[0] : undefined;
  const resolved = resolveSubmissionScope(next,nextListing,draftText,submitted);
  nextListing = resolved;
  const nextText = resolved.submissionText, nextIncomplete = resolved.textIncomplete;
  const key = JSON.stringify([next ? sourceFingerprint(next) : '',attachmentSnapshotKey(nextListing),nextText,nextIncomplete]);
  if (key !== previous) {
    if (current?.key !== next?.key) { historyRequest?.abort(); historyGeneration++; history = []; historyContext = ''; historyStatus = 'loading'; historyWarning = ''; metadataCache.clear(); }
    current = next; listing = nextListing; submissionText = nextText; textIncomplete = nextIncomplete; previous = key; revision++;
    if (entry) entry.textContent = t(nextListing.coverage === 'pending' ? '附件更新中 · 查看作业概述' : '查看作业概述与自动查漏');
    announce();
  }
  if (next && (modeContext !== next.key || Date.now() - modeLoadedAt > 60000)) { modeContext = next.key; void loadMode(next.key); }
  if (next && next.submissionMode !== 'unknown' && checksApply(next) && (historyContext !== next.key || Date.now() - historyLoadedAt > 60000)) { historyContext = next.key; void loadHistory(next); }
  if (!next) { entry?.remove(); entry = null; submitGuard?.update(); return; }
  if (!entry?.isConnected) {
    entry = document.createElement('button');
    entry.type = 'button'; entry.textContent = t('查看作业概述与自动查漏'); entry.setAttribute('data-canvas-check-entry', '');
    entry.style.cssText = 'margin:10px 0 16px;padding:9px 14px;border:1px solid #cad9d4;background:#f1f8f4;color:#174a39;border-radius:8px;font:600 14px system-ui;cursor:pointer';
    entry.addEventListener('click', () => chrome.runtime.sendMessage({ channel: CHANNEL, type: 'open-panel' }).then(response => { if (!response?.ok && entry) entry.textContent = t('点击工具栏中的 Canvas Check 查看'); }).catch(() => {}));
    document.querySelector('h1')?.insertAdjacentElement('afterend', entry);
  }
  describeConnection();
  submitGuard?.update();
}

const onMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message, sender, respond) => {
  if (message?.channel !== CHANNEL || sender.id !== chrome.runtime.id) return;
  if (['set-language','get-state'].includes(message.type) && ['en', 'zh-CN'].includes(message.language)) {
    language = message.language;
    if (entry) entry.textContent = t(listing.coverage === 'pending' ? '附件更新中 · 查看作业概述' : '查看作业概述与自动查漏');
    describeConnection();
    if (message.type === 'set-language') { respond({ ok: true }); return; }
  }
  if (message.type === 'get-state') { refresh(); respond(state()); return; }
  if (message.type === 'precheck-status') {
    if(sender.url !== chrome.runtime.getURL('sidepanel.html') || !['waiting','checking','attention','checked'].includes(message.report?.phase)){respond({ok:false});return;}
    submitGuard?.accept(message.report);respond({ok:true});return;
  }
  if (message.type === 'check-status') {
    if (message.language !== language) { respond({ ok: false }); return; }
    if (message.revision === revision && entry && typeof message.text === 'string') entry.textContent = message.text.slice(0, 100);
    if (message.revision === revision && entry && typeof message.diagnostic === 'string') entry.title = `${entry.title}\n${message.diagnostic.slice(0, 800)}`;
    respond({ ok: true }); return;
  }
  if (message.type === 'get-file-chunk') {
    refresh(); // FileList can change without a DOM mutation; never serve stale selected bytes.
    const id = String(message.id), offset = message.offset;
    const selected = message.attempt === undefined ? listing.coverage === 'complete' ? listing.attachments : [] : history.find(item => item.attempt === message.attempt)?.attachments ?? [];
    const file = selected.find(item => item.id === id), captured = revision;
    if (!current || message.assignmentKey !== current.key || message.revision !== revision || !file || !Number.isSafeInteger(offset) || offset < 0) { respond({ error: '附件范围已变化，正在自动同步。' }); return; }
    if (id.startsWith('draft:')) {
      if (message.attempt !== undefined || listing.attachmentSource !== 'draft') { respond({ error: '附件范围已变化，正在自动同步。' }); return; }
      nativeFiles.chunk(id, offset).then(chunk => {
        refresh();
        respond(captured === revision ? chunk : { error: '附件范围已变化，正在自动同步。' });
      }).catch(e => respond({ error: e instanceof Error ? e.message : '文件读取未完成。' }));
      return true;
    }
    let pending = metadataCache.get(id);
    if (!pending) {
      pending = readCanvasFileMetadata(id);
      metadataCache.set(id, pending); pending.catch(() => metadataCache.delete(id));
    }
    pending.then(metadata => chrome.runtime.sendMessage({ channel: CHANNEL, type: 'download-chunk', id, offset, metadata })).then(chunk => {
      if (captured !== revision) { respond({ error: '提交记录已变化，正在自动同步。' }); return; }
      respond({ ...chunk, name: file.name });
    }).catch(e => respond({ error: e instanceof Error ? e.message : '文件读取服务未连接，请重新加载扩展并刷新 Canvas。' }));
    return true;
  }
};
chrome.runtime.onMessage.addListener(onMessage);
const onChange = (event:Event) => {
  const pane=activeUploadPane(document),target=event.target;
  const selected=event instanceof DragEvent?Boolean(event.dataTransfer?.files.length):target instanceof HTMLInputElement&&target.type==='file'&&Boolean(target.files?.length);
  if(selected&&target instanceof Node&&pane?.contains(target)&&pane.querySelector('[data-testid="uploaded_files_table"]')){
    uploadingFrom=attachmentSnapshotKey(scanCanvasAttachments(document,nativeFiles));
    listing={...listing,attachmentSource:'draft',coverage:'pending'};revision++;announce();submitGuard?.update();
  }
  clearTimeout(timer); timer = setTimeout(refresh, 250);
};

function observe() {
  refresh();
  document.addEventListener('change', onChange, true);
  document.addEventListener('input',onChange,true);
  document.addEventListener('drop',onChange,true);
  poll = setInterval(()=>{ if (current && checksApply(current) && !document.hidden) refresh(); },1000);
  observer = new MutationObserver(records => {
    if (records.every(r => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest('[data-canvas-check-entry], [data-canvas-check-guard]'))) return;
    clearTimeout(timer); timer = setTimeout(refresh, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['id', 'title', 'aria-valuenow', 'value', 'hidden', 'aria-hidden', 'style', 'class'] });
}
submitGuard=attachSubmitGuard(document,{state,refresh,language:()=>language,open:()=>{void chrome.runtime.sendMessage({channel:CHANNEL,type:'open-panel'}).catch(()=>{});}});
host.canvasCheckDisconnect = () => { detached = true; submitGuard?.disconnect(); clearTimeout(timer); clearInterval(poll); modeRequest?.abort(); historyRequest?.abort(); observer?.disconnect(); document.removeEventListener('change', onChange, true); document.removeEventListener('input',onChange,true); document.removeEventListener('drop',onChange,true); document.removeEventListener('DOMContentLoaded', observe); chrome.runtime.onMessage.removeListener(onMessage); entry?.remove(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true }); else observe();
