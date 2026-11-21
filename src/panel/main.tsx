import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CanvasAttachment, CanvasState, CheckResult, ReadFile, SubmissionAttempt } from '../core/types';
import { LIMITS } from '../core/types';
import { DEMO_ASSIGNMENT, SAMPLE_JAVA } from '../core/demo';
import { extractLocalRequirements, sourceFingerprint } from '../core/requirements';
import { summarizeRequirements } from '../core/overview';
import { previousFileOccurrences } from '../core/history';
import { extensionOf, readSubmissionFile } from '../core/files';
import { runLocalChecks } from '../core/checks';
import { CHANNEL, currentTabId, inExtension, readCanvasState, retrieveFile } from './bridge';
import { aiStatus, cachedSummary, locateWithAI, mergeRequirements, SETUP_URL, summarizeWithAI, summaryKey } from '../ai/provider';
import type { AISummary } from '../ai/contracts';
import { initialLanguage, LANGUAGE_KEY, translateText, type Language } from '../core/i18n';
import './style.css';
import './ai.css';
import './language.css';
import { checksApply } from '../core/submission-mode';
import { analyzeJava } from '../core/java';
import { Pregrade } from './Pregrade';
import { historyBeforeSubmission, selectedGradeScope } from '../core/pregrade';
import { pregradeDemoState } from '../core/pregrade-demo';
import { attachmentSnapshotKey } from '../core/attachments';
import { precheckReport, reviewSelection, withAssignmentMatch } from '../core/precheck';
import { createDemoAIClient } from '../ai/demo-client';
import { useLocalOverview } from './useLocalOverview';
const demoClient = !inExtension && location.hostname==='127.0.0.1' && new URLSearchParams(location.search).get('scenario')==='ai-cache' ? createDemoAIClient() : null;
const lookupSummary = demoClient?.peekSummary ?? cachedSummary;
const requestSummary = demoClient?.summarize ?? summarizeWithAI;
const requestEvidence = demoClient?.locate ?? locateWithAI;
const labels = { found: '已找到', 'not-found': '未找到', confirm: '待确认', uncheckable: '未读完整' };
const marks = { found: '✓', 'not-found': '!', confirm: '?', uncheckable: '—' };
const sizeLabel = (size: number) => size < 1024 ? `${size} B` : size < 1048576 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1048576).toFixed(1)} MB`;
type Scenario = 'translation' | 'submitted' | 'pregrade' | 'missing' | 'complete' | 'replaced' | 'empty' | 'scan' | 'office' | 'text' | 'grade' | 'quiz';
function App() {
    const [language, setLanguage] = useState<Language>(() => { try {
        return initialLanguage(localStorage.getItem(LANGUAGE_KEY));
    }
    catch {
        return initialLanguage(null);
    } });
    const [aiConsent, setAIConsent] = useState(() => { try {
        return localStorage.getItem('canvas-check-ai-consent-v1') ?? '';
    }
    catch {
        return '';
    } });
    const [showPrivacy, setShowPrivacy] = useState(!aiConsent);
    const [aiApproved, setAIApproved] = useState(() => { try { return aiConsent === 'enabled' || localStorage.getItem('canvas-check-ai-approved-v1') === '1'; } catch { return aiConsent === 'enabled'; } });
    const t = (text: string | undefined) => translateText(text, language);
    const chooseAI = (enabled: boolean) => { if (enabled) { setAIApproved(true); try { localStorage.setItem('canvas-check-ai-approved-v1', '1'); } catch {} } const choice = enabled ? 'enabled' : 'local'; setAIConsent(choice); setShowPrivacy(false); try {
        localStorage.setItem('canvas-check-ai-consent-v1', choice);
    }
    catch { } };
    useEffect(() => { document.documentElement.lang = language; try {
        localStorage.setItem(LANGUAGE_KEY, language);
    }
    catch { } }, [language]);
    const [snapshot, setSnapshot] = useState<CanvasState | null>(null);
    const [attempt, setAttempt] = useState<number | null>(null);
    const [view, setView] = useState<'checks' | 'files' | 'pregrade'>('checks');
    const [files, setFiles] = useState<ReadFile[]>([]);
    const [aiResults, setAIResults] = useState<{key:string;value:CheckResult[]} | null>(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [connection, setConnection] = useState(inExtension ? '正在连接 Canvas' : '本地演示');
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [scenario, setScenario] = useState<Scenario>('missing');
    const [tabId, setTabId] = useState<number | undefined>();
    const [aiEnabled, setAIEnabled] = useState(Boolean(demoClient));
    const [pregradeAvailable, setPregradeAvailable] = useState(false);
    const canUseAI = aiEnabled && aiConsent === 'enabled';
    const [developmentBackend, setDevelopmentBackend] = useState(false);
    const [aiSummary, setAISummary] = useState<AISummary | null>(null);
    const [aiSummaryKey, setAISummaryKey] = useState('');
    const [aiBusy, setAIBusy] = useState('');
    const [aiError, setAIError] = useState('');
    const [aiConnectionError, setAIConnectionError] = useState('');
    const [readStamp, setReadStamp] = useState('');
    const generation = useRef(0), activeTab = useRef<number | undefined>(undefined), lastState = useRef(''), assignmentKey = useRef('');
    const lastDraft = useRef(''), viewedAttempt = useRef<number|null>(null); viewedAttempt.current=attempt;
    const assignment = snapshot?.assignment ?? null;
    const history = snapshot?.history ?? [];
    const selection = reviewSelection(snapshot, attempt);
    const {historical,attachments,text:submissionText,textIncomplete,count:contentCount,trusted}=selection;
    const currentNumber = Number(assignment?.attempt.match(/\d+/)?.[0]) || undefined;
    const scopeLabel = attempt !== null ? `历史 Attempt ${attempt}` : '当前待交';
    const aiTaskKey = assignment ? summaryKey(assignment, language) : '';
    const currentSummary = canUseAI && assignment ? (lookupSummary(assignment, language) ?? (aiSummaryKey === aiTaskKey ? aiSummary : null)) : null;
    const localOverview = useMemo(() => assignment ? summarizeRequirements(assignment, language) : null, [assignment,language]);
    const translation = useLocalOverview(localOverview,language,!canUseAI);
    const overview = currentSummary ?? translation.value ?? localOverview;
    const awaitingTranslation = !currentSummary && translation.needed && !translation.value;
    const requirements = useMemo(() => assignment ? withAssignmentMatch(mergeRequirements(extractLocalRequirements(assignment), currentSummary?.requirements ?? []), assignment.description) : [], [assignment, currentSummary]);
    // Reading bytes is independent of language and analysis mode. A new revision
    // still invalidates the receipt before any old result can reach Submit.
    const desiredReadStamp = JSON.stringify([tabId, assignment?.key, snapshot?.revision, attempt, trusted, attachments, submissionText, textIncomplete, assignment?.submissionMode]);
    const checkStamp = JSON.stringify([desiredReadStamp, aiTaskKey, requirements, canUseAI]);
    const localResults = useMemo(() => readStamp === desiredReadStamp && contentCount ? runLocalChecks(requirements, files, trusted) : null, [readStamp,desiredReadStamp,requirements,files,trusted,contentCount]);
    const visibleResults = localResults?.map(item => canUseAI && aiResults?.key === checkStamp ? aiResults.value.find(result=>result.requirement.id===item.requirement.id) ?? item : item) ?? null;
    const precheck = precheckReport({hasDraft:selection.draft,materialCount:contentCount,trusted,finished:readStamp===desiredReadStamp,analyzing:Boolean(busy||aiBusy)||(canUseAI&&!currentSummary&&!aiError),requirements,results:visibleResults,files});
    useEffect(()=>{
        if(inExtension && tabId!==undefined && attempt===null && selection.draft && assignment) void chrome.tabs.sendMessage(tabId,{channel:CHANNEL,type:'precheck-status',report:{...precheck,assignmentKey:assignment.key,revision:snapshot?.revision}}).catch(()=>{});
    },[tabId,attempt,selection.draft,assignment?.key,snapshot?.revision,JSON.stringify(precheck)]);
    useEffect(() => {
        if (!inExtension)
            return;
        let active = true;
        const controller = new AbortController();
        const probe = async () => { try {
            const status = await aiStatus(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
            if (active) {
                setAIEnabled(status.configured);
                setPregradeAvailable(status.features?.pregrade === 1);
                setDevelopmentBackend(status.mode === 'development');
                setAIConnectionError(status.configured ? '' : 'AI 后端尚未配置完成。');
            }
        }
        catch (e) {
            if (active) {
                setAIEnabled(false);
                setAIConnectionError(e instanceof TypeError ? '无法连接 AI 后端，请检查网络及扩展的网站访问权限。' : e instanceof Error ? e.message : 'AI 服务连接失败。');
            }
        } };
        void probe();
        const timer = setInterval(() => { void probe(); }, 6000);
        return () => { active = false; controller.abort(); clearInterval(timer); };
    }, []);
    useEffect(() => {
        setAIError('');
        if (!assignment || !canUseAI) {
            setAIBusy('');
            return;
        }
        const saved = lookupSummary(assignment, language);
        if (saved) { setAISummary(saved); setAISummaryKey(aiTaskKey); setAIBusy(''); return; }
        const controller = new AbortController();
        setAIBusy('正在提炼作业要求…');
        void requestSummary(assignment, controller.signal, language).then(value => { if (!controller.signal.aborted) {
            setAISummary(value);
            setAISummaryKey(aiTaskKey);
        } }).catch(e => { if (!controller.signal.aborted)
            setAIError(e instanceof Error ? e.message : 'AI 概览未完成'); }).finally(() => { if (!controller.signal.aborted)
            setAIBusy(''); });
        return () => controller.abort();
    }, [canUseAI, aiTaskKey]);
    useEffect(() => {
        if (!checksApply(assignment) || !assignment || !canUseAI || !currentSummary || !contentCount || busy || !trusted || readStamp !== desiredReadStamp || !requirements.some(rule => rule.kind === 'semantic'))
            return;
        const controller = new AbortController();
        let progress:ReturnType<typeof setTimeout>|undefined;
        const timer = setTimeout(()=>{
        progress=setTimeout(()=>setAIBusy('正在核对材料内容…'),150);
        void requestEvidence(assignment, requirements, files, controller.signal, language, attempt===null?'draft':`history:${attempt}`).then(checked => {
            if (!controller.signal.aborted)
                setAIResults({key:checkStamp,value:checked});
        }).catch(e => { if (!controller.signal.aborted)
            setAIError(e instanceof Error ? e.message : 'AI 内容核对未完成'); }).finally(() => { clearTimeout(progress); if (!controller.signal.aborted)
            setAIBusy(''); });},submissionText !== undefined?1200:100);
        return () => {clearTimeout(timer);clearTimeout(progress);controller.abort();setAIBusy(value=>value==='正在核对材料内容…'?'':value);};
    }, [canUseAI, currentSummary, files, requirements, busy, trusted, checkStamp, readStamp, desiredReadStamp]);
    useEffect(() => {
        if (inExtension && tabId !== undefined) void chrome.tabs.sendMessage(tabId, { channel: CHANNEL, type: 'set-language', language }).catch(() => {});
    }, [language, tabId, snapshot?.assignment?.key]);
    const acceptState = useCallback((next: CanvasState, id: number) => {
        if (activeTab.current !== id)
            return;
        const key = `${id}:${next.revision}:${next.assignment ? sourceFingerprint(next.assignment) : ''}`;
        if (key === lastState.current)
            return;
        lastState.current = key;
        const draftKey = next.attachmentSource === 'draft' ? JSON.stringify([next.assignment?.key, attachmentSnapshotKey(next), next.submissionText, next.textIncomplete]) : '';
        // A new selection returns to the live draft; polling alone preserves a chosen history view.
        if (draftKey && draftKey !== lastDraft.current) {setAttempt(null);if(viewedAttempt.current!==null)setView('checks');}
        lastDraft.current = draftKey;
        if (assignmentKey.current !== (next.assignment?.key ?? '')) {
            assignmentKey.current = next.assignment?.key ?? '';
            setAttempt(null); setView('checks');
        }
        setSnapshot(next);
        setConnection(next.assignment ? '已连接 Canvas' : '等待作业页面');
    }, []);
    const connect = useCallback(async () => {
        const id = await currentTabId();
        if (id !== activeTab.current) {
            activeTab.current = id;
            lastState.current = ''; lastDraft.current = '';
            setSnapshot(null);
            setAttempt(null);
            setTabId(id);
        }
        if (id === undefined) {
            setConnection('等待作业页面');
            return;
        }
        try {
            acceptState(await readCanvasState(id, language), id);
        }
        catch {
            if (activeTab.current === id) {
                setSnapshot(null);
                setConnection('请刷新 Canvas 作业页');
            }
        }
    }, [acceptState, language]);
    useEffect(() => {
        if (!inExtension)
            return;
        void connect();
        const onMessage = (message: {
            channel?: string;
            type?: string;
            state?: CanvasState;
        }, sender: chrome.runtime.MessageSender) => {
            if (message.channel === CHANNEL && message.type === 'state-changed' && message.state && sender.tab?.id !== undefined)
                acceptState(message.state, sender.tab.id);
        };
        const onActive = () => { void connect(); };
        const onUpdate = (id: number, change: chrome.tabs.OnUpdatedInfo) => { if (id === activeTab.current && (change.status === 'complete' || change.url))
            void connect(); };
        chrome.runtime.onMessage.addListener(onMessage);
        chrome.tabs.onActivated.addListener(onActive);
        chrome.tabs.onUpdated.addListener(onUpdate);
        return () => { chrome.runtime.onMessage.removeListener(onMessage); chrome.tabs.onActivated.removeListener(onActive); chrome.tabs.onUpdated.removeListener(onUpdate); };
    }, [acceptState, connect]);
    useEffect(() => {
        if (attempt !== null && snapshot?.historyStatus === 'ready' && !history.some(item => item.attempt === attempt))
            setAttempt(null);
    }, [history, attempt, snapshot?.historyStatus]);
    const loadDemo = useCallback((next: Scenario) => {
        setScenario(next);
        if (next === 'pregrade') {setAttempt(null);setView('pregrade');setSnapshot(previous=>pregradeDemoState((previous?.revision??0)+1));return;}
        setAttempt(null);setView('checks');
        if(next==='translation'){
            const description='Write project documentation for your Arduino circuit.\nYour document must include an aim, procedure, circuit diagram, observations, and a conclusion.\nThe appendix must contain Main.java.\nSubmit a PDF document.';
            setSnapshot(previous=>({assignment:{...DEMO_ASSIGNMENT,key:'demo:translation',title:'Arduino project documentation',description,paragraphs:description.split('\n'),submissionMode:'upload'},revision:(previous?.revision??0)+1,attachments:[],coverage:'complete',warning:'',attachmentSource:'draft',history:[],historyStatus:'ready'}));return;
        }
        if (['scan','office','text','grade','quiz'].includes(next)) {
            const description = next==='scan'?'Submit a PDF containing a screenshot of the program output.':next==='office'?'Submit a Word document containing a screenshot of the output.':next==='text'?'Write a reflection and submit it using the Canvas text entry.':next==='quiz'?'Complete this Canvas quiz on its quiz page.':'Participation points are recorded by the teacher. No student submission is required.';
            const mode = next==='text'?'text':next==='grade'?'none':next==='quiz'?'quiz':'upload';
            const attachments: CanvasAttachment[] = next==='scan'?[{id:'scan',name:'ScanOutput.pdf',size:null}]:next==='office'?[{id:'office',name:'Sample.docx',size:null}]:[];
            setSnapshot(previous=>({assignment:{...DEMO_ASSIGNMENT,key:`demo:${next}`,title:next==='scan'?'Scanned output':next==='office'?'Word with embedded output':next==='text'?'Text reflection':next==='grade'?'Participation grade':'Canvas quiz',description,paragraphs:[description],submissionMode:mode,attempt:'Attempt 1'},revision:(previous?.revision ?? 0)+1,attachments,coverage:'complete',warning:'',attachmentSource:['grade','quiz'].includes(next)?'submitted':'draft',history:[],historyStatus:'ready',...(next==='text'?{submissionText:'My reflection: I tested the program with several inputs and recorded the output.'}:{})}));
            return;
        }
        const source = new File([SAMPLE_JAVA], 'NumberStats.java');
        const current: CanvasAttachment[] = next === 'empty' ? [] : [{ id: next === 'replaced' ? '103' : '101', name: source.name, size: next === 'replaced' ? null : source.size }];
        if (next === 'complete')
            current.push({ id: '102', name: 'RunOutput.png', size: null });
        const old: SubmissionAttempt = { attempt: 1, submittedAt: null, attachments: [{ id: '100', name: source.name, size: source.size }, { id: '102', name: 'RunOutput.png', size: null }] };
        setSnapshot(previous => ({ assignment: { ...DEMO_ASSIGNMENT, attempt: 'Attempt 2' }, revision: (previous?.revision ?? 0) + 1, attachmentSource: next==='submitted'?'submitted':'draft', attachments: current, coverage: 'complete', warning: '', history: next==='submitted'?[{ attempt: 2, submittedAt: null, attachments: current }, old]:[old], historyStatus: 'ready' }));
    }, []);
    useEffect(() => { if (!inExtension)
        loadDemo(new URLSearchParams(location.search).get('scenario')==='translation'?'translation':new URLSearchParams(location.search).get('scenario')==='pregrade'?'pregrade':'missing'); }, [loadDemo]);
    useEffect(() => {
        const version = ++generation.current, controller = new AbortController();
        setFiles([]);
        setSelectedFile(null);
        setError('');
        setReadStamp('');
        if (!assignment || !snapshot || !checksApply(assignment)) {
            setBusy('');
            return;
        }
        if (!trusted || !contentCount) {
            setBusy(snapshot.coverage === 'pending' ? '等待 Canvas 完成上传…' : '');
            return;
        }
        const read = async () => {
            if (attachments.length > LIMITS.files) {
                setBusy('');
                setError('本轮最多读取 10 个文件。');
                return;
            }
            const foundFiles: ReadFile[] = [];
            let total = 0;
            for (let i = 0; i < attachments.length; i++) {
                const item = attachments[i];
                if (version !== generation.current)
                    return;
                setBusy(`正在读取文件 ${i + 1}/${attachments.length}`);
                try {
                    let file: File;
                    if (inExtension) {
                        if (tabId === undefined)
                            return;
                        file = await retrieveFile(tabId, item.id, item.size, controller.signal, { assignmentKey: assignment.key, revision: snapshot.revision, attempt: attempt ?? undefined });
                    }
                    else if (item.id === '103') {
                        const response = await fetch('./samples/KeywordOnly.java', { signal: controller.signal });
                        if (!response.ok)
                            throw new Error('演示文件不可用');
                        file = new File([await response.arrayBuffer()], item.name);
                    }
                    else if (item.name.endsWith('.java'))
                        file = new File([SAMPLE_JAVA], item.name);
                    else {
                        const response = await fetch(`./samples/${encodeURIComponent(item.name)}`, { signal: controller.signal });
                        if (!response.ok)
                            throw new Error('演示文件不可用');
                        file = new File([await response.arrayBuffer()], item.name);
                    }
                    total += file.size;
                    if (total > LIMITS.bytes)
                        throw new Error('本轮文件合计超过 20 MB。');
                    foundFiles.push({ ...await readSubmissionFile(file,controller.signal), id: `canvas:${item.id}`,origin:item.origin });
                }
                catch (e) {
                    if (controller.signal.aborted)
                        return;
                    foundFiles.push({ id: `unread:${item.id}`, origin:item.origin, name: item.name, size: item.size ?? 0, extension: extensionOf(item.name), kind: extensionOf(item.name) === 'java' ? 'java' : 'unknown', state: 'unreadable', note: e instanceof Error ? e.message : '文件暂时无法读取。' });
                }
            }
            if (submissionText?.trim()) {
                const body = await readSubmissionFile(new File([submissionText],'Canvas text entry.txt'),controller.signal);
                const java = analyzeJava(submissionText);
                foundFiles.push({...body,id:'canvas:text',origin:'canvas-text',...(java.parsed?{kind:'java' as const,java}: {}),...(textIncomplete?{kind:'unknown' as const,state:'unreadable' as const,note:'正文中的部分图片、嵌入内容或编辑器尚未读到，暂不判断内容遗漏。'}:{})});
            }
            if (version !== generation.current)
                return;
            const checked = runLocalChecks(requirements, foundFiles, true);
            setFiles(foundFiles);
            setBusy('');
            setReadStamp(desiredReadStamp);
            if (inExtension && tabId !== undefined && attempt === null && selection.draft) {
                const missing = checked.filter(item => item.status === 'not-found').length;
                const unreadCount = foundFiles.filter(file => file.state !== 'ready').length;
                const javaCount = foundFiles.filter(file => file.kind === 'java' && file.state === 'ready').length;
                const text = language === 'en' ? unreadCount ? `${unreadCount} incomplete files · View details` : javaCount ? `${javaCount} source files read · ${missing} items to check` : 'View checks · Canvas Check' : unreadCount ? `${unreadCount} 个文件未读完整 · 查看详情` : javaCount ? `${javaCount} 份源码已读取 · ${missing ? `${missing} 项待核对` : '查看核对结果'}` : missing ? `发现 ${missing} 个待核对项 · Canvas Check` : '核对结果 · Canvas Check';
                void chrome.tabs.sendMessage(tabId, { channel: CHANNEL, type: 'check-status', revision: snapshot.revision, language, text, diagnostic: foundFiles.filter(file => file.state !== 'ready').map(file => t(file.note)).join('; ') }).catch(() => { });
            }
        };
        void read().catch(e => { if (version === generation.current) {
            setBusy('');
            setError(e instanceof Error ? e.message : '读取暂未完成');
        } });
        return () => { controller.abort(); generation.current++; };
    }, [desiredReadStamp]);
    const missing = visibleResults?.filter(r => r.status === 'not-found').length ?? 0;
    const needsConfirmation = visibleResults?.filter(r => ['confirm', 'uncheckable'].includes(r.status)).length ?? 0;
    const unread = files.filter(file => file.state !== 'ready');
    const preview = files.find(file => file.id === selectedFile);
    const viewFile = (id: string) => { setSelectedFile(id); setView('files'); };
    const gradeScope = assignment ? selectedGradeScope(assignment,history,attempt,selection.draft) : {attempt:null,submittedAt:null,draft:true};
    const gradeHistory = historyBeforeSubmission(snapshot?.gradingHistory,gradeScope);
    const showingPregrade = view === 'pregrade' && checksApply(assignment) && !selection.waiting;
    const panel = <main className="panel">
    <header className="app-header"><span className="brand"><img className="brand-icon" src="./icons/icon-32.png" alt="" aria-hidden="true"/>Canvas Check</span><div className="header-tools"><label className="language-picker"><span className="sr-only">{t("Language / 语言")}</span><select aria-label={t("Language / 语言")} value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="en">English</option><option value="zh-CN">{t("简体中文")}</option></select></label><span className="connection"><i />{t(connection)}</span></div></header>
    <section className="analysis-toolbar" aria-label={t('分析方式')}><span>{t('分析方式')}</span><div className="mode-buttons" role="group" aria-label={t('选择分析方式')}><button type="button" aria-pressed={aiConsent !== 'enabled'} onClick={() => chooseAI(false)}>{t('本地检查')}</button><button type="button" aria-pressed={aiConsent === 'enabled'} onClick={() => { if (aiApproved) chooseAI(true); else setShowPrivacy(true); }}>{t('AI 分析')}</button></div></section>
    <p className="mode-note">{t('选择会记住，换作业后也可在这里切换。')}</p>
    {demoClient && <p className="inline-note" data-testid="ai-demo-counts">Synthetic AI transport · No model calls · Summary requests: {demoClient.calls.summary} · Evidence requests: {demoClient.calls.evidence}</p>}
    {showPrivacy && <section className="privacy-card" aria-label={t('AI 使用说明')}><h2>{t('AI 使用说明')}</h2><p>{language==='en'?'AI summaries and checks send the current assignment and selected materials through the configured service to OpenAI. Grades and teacher comments are used only with separate Pre-grade consent. Canvas login credentials are never sent.':'AI 概述和查漏会通过已配置的服务将当前作业要求与所选材料发送至 OpenAI；成绩和评语仅在单独同意 Pre-grade 后使用，Canvas 登录凭据不会发送。'}</p><a href={developmentBackend ? "http://127.0.0.1:4318/privacy" : "https://canvas-check-ai.canvas-check.workers.dev/privacy"} target="_blank" rel="noreferrer">{t('隐私说明')}</a><div><button className="primary" onClick={() => chooseAI(true)}>{t('启用 AI')}</button><button onClick={() => chooseAI(false)}>{t('仅使用本地检查')}</button></div></section>}
    {assignment && overview ? <>
      <div className="assignment-heading"><span className="eyebrow">{t("作业要求")}</span><h1>{assignment.title}</h1></div>
      {!showingPregrade && <section className="overview-card" aria-label={t("要求概览")}>
        <div className="card-heading"><h2>{t("这次要做什么")}</h2><span className="method-label">{currentSummary ? t('AI 提炼') : translation.value?.translated ? (language==='en'?'Local · Translated on device':'本地整理 · 本机翻译') : t('本地整理')}</span></div>
        {awaitingTranslation ? <div className="local-translation" role="status">
          <p>{canUseAI ? (language==='en'?'Generating the summary in English…':'正在生成中文概述…') : translation.status==='downloading' ? (language==='en'?`Preparing local translation · ${translation.percent??0}%`:`正在准备本机翻译 · ${translation.percent??0}%`) : translation.status==='activation' ? (language==='en'?'Enable on-device translation for this overview. Chrome may download its language pack once.':'启用本机翻译即可查看中文概述，Chrome 首次可能需要下载语言包。') : translation.status==='unavailable' ? (language==='en'?'On-device translation is unavailable in this browser. The original instructions remain below.':'当前浏览器暂不支持本机翻译。老师原文仍可在下方查看。') : translation.status==='failed' ? (language==='en'?'Local translation could not finish. Retry or view the original instructions below.':'本机翻译未完成，可重试或在下方查看老师原文。') : (language==='en'?'Translating the local overview into English…':'正在将本地概述翻译成中文…')}</p>
          {!canUseAI && ['activation','failed'].includes(translation.status) && <button type="button" className="primary" onClick={translation.retry}>{language==='en'?'Translate on this device':'启用本机翻译'}</button>}
        </div> : <><p className="objective" lang={language}>{overview.objective}</p>
        {overview.constraints.length > 0 && <ul className="constraint-list">{overview.constraints.map((text, i) => <li key={i}>{text}</li>)}</ul>}</>}
        {checksApply(assignment) && <div className="deliverables"><span>{t("需要提交")}</span>{requirements.filter(r => r.kind === 'file').map(r => <span className="deliverable-chip" key={r.id}>{t(r.label)}</span>)}</div>}
        <details className="original"><summary>{t("查看老师原文")}</summary><div>{assignment.description}</div></details>
      </section>}
      {showingPregrade && <details className="pg-assignment"><summary>{language==='en'?'Assignment instructions':'作业说明'}</summary><p>{assignment.description}</p></details>}
      {inExtension && !aiEnabled && <p className="inline-note">{developmentBackend ? <>{t("开发测试连接 ·")}<a href={SETUP_URL} target="_blank" rel="noreferrer">{t("开发者配置 ↗")}</a></> : t('AI 服务暂未连接，当前显示本地核对结果。')}</p>}
      {aiBusy && <p className="progress" role="status"><span className="spinner"/>{t(aiBusy)}</p>}
      {(aiConnectionError || aiError) && <p className="inline-note">{t(aiConnectionError || aiError)}{t("· 当前保留本地核对结果。")}</p>}
      {checksApply(assignment) ? <section className="submission-section" aria-label={t("提交核对")}>
        <div className="submission-heading"><h2>{attempt === null ? (language === 'en' ? 'Before you submit' : '提交前核对') : (language==='en'?'History review':'历史记录参考')}</h2><label className="attempt-picker"><span className="sr-only">{t("查看提交记录")}</span><select aria-label={t("查看提交记录")} value={attempt ?? 'current'} onChange={e => setAttempt(e.target.value === 'current' ? null : Number(e.target.value))}><option value="current">{language==='en'?'Current draft · Not submitted':'当前待交 · 尚未提交'}</option>{history.map(item => <option value={item.attempt} key={item.attempt}>Attempt {item.attempt} · {t(`${item.attachments.length + (item.submissionText !== undefined ? 1 : 0)} 份材料`)}</option>)}</select></label></div>
        <div className="scope-line"><span>{t(scopeLabel)} · {t(`${contentCount} 份材料`)}</span><span>{snapshot?.historyStatus === 'loading' ? t('正在获取历史记录…') : history.length ? t(`${history.length} 次提交可查看`) : ''}</span></div>
        {snapshot?.historyStatus === 'unavailable' && <p className="inline-note">{t(snapshot.historyWarning)}</p>}
        {selection.waiting && <div className="draft-notice"><strong>{language==='en'?'Waiting for your next submission':'等待你准备本次提交'}</strong><p>{language==='en'?'Select files or enter text in Canvas before final Submit. If this page shows an old attempt, open New Attempt first. Earlier files are not checked automatically or counted as this draft.':'请在 Canvas 选择待交文件或填写正文，再点击最终 Submit。当前若显示旧记录，请先打开 New Attempt。旧附件不会自动用于本次核对。'}</p></div>}
        {attempt!==null && <p className="draft-notice">{language==='en'?'History reference only. This is already submitted and does not confirm your current draft.':'仅供历史参考：这份材料已经提交，不代表本次待交内容已核对。'}</p>}
        {!selection.waiting && <nav className="view-tabs" aria-label={t("内容视图")}><button className={view === 'checks' ? 'active' : ''} aria-pressed={view === 'checks'} onClick={() => setView('checks')}>{t("核对清单")}{missing > 0 && <span className="count-badge">{missing}</span>}</button><button className={view === 'files' ? 'active' : ''} aria-pressed={view === 'files'} onClick={() => setView('files')}>{t(submissionText !== undefined ? "文件与正文" : "文件内容")}<span>{contentCount}</span></button><button className={view === 'pregrade' ? 'active' : ''} aria-pressed={view === 'pregrade'} onClick={() => setView('pregrade')}>Pre-grade</button></nav>}
        {busy && <p className="progress" role="status"><span className="spinner"/>{t(busy)}</p>}
        {error && <p className="error" role="alert">{t(error)}</p>}
        {!trusted && !busy && !selection.waiting && <p className="inline-note">{t(snapshot?.warning || '附件列表尚未完整，暂不判断遗漏。')}</p>}
        {view === 'checks' && !selection.waiting ? <>
          {!busy && visibleResults && <div className={`result-banner ${missing ? 'has-missing' : unread.length || needsConfirmation || !requirements.length ? 'has-unread' : 'complete'}`}><strong>{!requirements.length ? t('暂未识别到可自动核对的提交项，请查看上方要求。') : aiBusy ? t('正在核对材料内容…') : missing ? t(`${missing} 项在这次提交中未找到`) : unread.length ? t('文件内容尚未全部读到') : needsConfirmation ? t(`${needsConfirmation} 项仍需确认`) : t('明确检查项已核对')}</strong><span>{attempt !== null || snapshot?.attachmentSource === 'submitted' ? t('各次提交分开核对，不自动合并附件。') : t('附件变化后会自动更新。')}</span></div>}
          <div className="check-list">{requirements.map(requirement => {
                    const result = visibleResults?.find(r => r.requirement.id === requirement.id);
                    const occurrences = result?.status === 'not-found' && requirement.extensions ? previousFileOccurrences(history, requirement.extensions, attempt ?? currentNumber) : [];
                    return <div className="check-item" key={requirement.id}><details><summary><span className={`status-mark ${result?.status ?? 'pending'}`}>{result ? marks[result.status] : '·'}</span><span className="check-label">{t(requirement.label)}</span><span className={`status-text ${result?.status ?? ''}`}>{result ? t(labels[result.status]) : busy ? t('读取中') : t('等待文件')}</span></summary><div className="check-detail"><p>{t(result?.detail || '文件读取后自动核对。')}</p>{result?.evidence.map((item, i) => <button className="evidence" key={i} onClick={() => viewFile(item.fileId)}>{item.fileName}{item.partLabel ? ` · ${t(item.partLabel)}` : ""}{item.line ? language === 'en' ? ` · Line ${item.line}` : t(` · 第 ${item.line} 行`) : ''} ↗<small>{requirement.kind === 'file' ? t(item.text) : item.text}</small></button>)}<blockquote>{requirement.quote}</blockquote></div></details>{occurrences.length > 0 && <div className="history-hint"><span>{t("其他记录中有同格式文件：")}</span>{occurrences.map(item => <button key={item.attempt} onClick={() => { setAttempt(item.attempt); setView('checks'); }}>{t(`查看 Attempt ${item.attempt}`)} ↗</button>)}</div>}</div>;
                })}</div>
          {!requirements.length && <p className="inline-note">{t("暂未识别到可自动核对的提交项，请查看上方要求。")}</p>}
          {unread.length > 0 && <div className="read-errors"><strong>{t(`${unread.length} 个文件未读完整`)}</strong>{unread.map(file => <p key={file.id}><button onClick={() => viewFile(file.id)}>{file.name} ↗</button><span>{t(file.note)}</span></p>)}</div>}
        </> : view === 'files' && !selection.waiting ? <div className="file-view"><div className="file-list">{files.map(file => <button className={`file-row ${selectedFile === file.id ? 'selected' : ''}`} key={file.id + file.name} onClick={() => setSelectedFile(selectedFile === file.id ? null : file.id)}><span className={`file-icon ${file.kind}`}>{file.origin === "canvas-text" ? "TEXT" : (file.detectedFormat ?? file.extension).toUpperCase().slice(0, 4)}</span><span className="file-meta"><strong>{file.name}</strong><small>{file.state !== 'ready' ? t('未读完整') : file.kind === 'java' ? t(`${file.text?.split('\n').length ?? 0} 行源码 · ${file.java?.parsed ? t('结构已解析') : t('结构待确认')}`) : file.kind === 'image' ? t(`${file.width} × ${file.height} · 图片已读取`) : t('内容已读取')}{file.size ? ` · ${sizeLabel(file.size)}` : ''}</small></span><span>{selectedFile === file.id ? '−' : '↗'}</span></button>)}</div>
          {preview && <section className="file-preview" aria-label={t("文件预览")}><div className="preview-heading"><strong>{preview.name}</strong><button aria-label={t("关闭文件预览")} onClick={() => setSelectedFile(null)}>×</button></div>{preview.note && <p className="inline-note">{t(preview.note)}</p>}{preview.text && <pre tabIndex={0}>{preview.text.split('\n').slice(0, 500).map((line, i) => <span className="code-line" key={i}><span className="line-number">{i + 1}</span>{line}{'\n'}</span>)}</pre>}{preview.parts?.map(part => <section className="document-page" key={part.id}><h4>{t(part.label)}</h4>{part.image ? <img loading="lazy" src={part.image} alt={t(part.label)}/> : <p className="inline-note">{t("此页图像尚未完整读取。")}</p>}</section>)}{preview.preview && <img src={preview.preview} alt={preview.name}/>}{preview.text && preview.text.split('\n').length > 500 && <p className="inline-note">{t("预览显示前 500 行；检查使用完整源码。")}</p>}</section>}
          {!files.length && !busy && <p className="empty-files">{attachments.length ? t('文件暂未读取。') : t('这次记录中没有附件。')}</p>}
        </div> : null}
        <Pregrade key={assignment.key} assignment={assignment} files={files} history={gradeHistory} scope={gradeScope} scopeLabel={t(scopeLabel)} stamp={desiredReadStamp} ready={trusted && !busy && readStamp===desiredReadStamp} available={pregradeAvailable} aiEnabled={canUseAI} demo={!inExtension} language={language} onFile={viewFile} active={!selection.waiting && view==='pregrade'}/>
        <div className="auto-status" data-testid="auto-status" role="status">{t(busy || aiBusy || (selection.waiting ? '请先在 Canvas 准备待交材料' : !contentCount ? '尚未选择材料，未完成核对' : visibleResults ? (attempt!==null ? '仅查看历史记录' : precheck.phase==='checked' ? '当前草稿已核对' : '提交前仍有项目需要确认') : '等待可读取的附件'))}</div>
      </section> : <section className="submission-section no-submission"><h2>{t(assignment.submissionMode === 'unknown' ? '确认提交方式' : '此项目不在这里提交材料')}</h2><p>{t(assignment.submissionMode === 'unknown' ? '提交方式尚未确认，暂不判断遗漏。' : assignment.submissionMode === 'quiz' ? '这是 Canvas 测验或考试，请在测验页面作答，不检查附件遗漏。' : assignment.submissionMode === 'offline' ? '这是线下或纸质提交项目，不检查在线附件遗漏。' : assignment.submissionMode === 'external' ? '此项目在其他入口完成提交，不检查这里的附件遗漏。' : '这是无需在线提交的成绩或活动项目，不检查附件遗漏。')}</p></section>}
      <footer><span>{language==='en'?'Checks + optional Pre-grade · Never submits work':'查漏与可选预评分 · 不修改或代交作业'}</span><div className="footer-settings"><button className="text-button" onClick={() => setShowPrivacy(value => !value)}>{t('AI 设置')}</button><a href={developmentBackend ? "http://127.0.0.1:4318/privacy" : "https://canvas-check-ai.canvas-check.workers.dev/privacy"} target="_blank" rel="noreferrer">{t('隐私说明')}</a></div><details><summary>{t("能力说明")}</summary><p>{canUseAI ? t('AI 分析会将作业要求及当前所选材料的文字和图片发送至 OpenAI。只判断要求的内容是否出现，不比较答案或程序输出的正确性。看不清或读取不完整时保留待确认状态。') : t('AI 尚未连接。当前概览为本地整理；文件有无和 Java 结构在本机核对，图片内容暂不自动判断。')}{" "}{t("OpenAI 密钥由服务端管理，扩展不持有该密钥。")} {language==='en'?'Pre-grade is a separate optional estimate using teacher criteria and eligible earlier feedback. It never changes Canvas grades.':'Pre-grade 单独提供参考估分，使用老师标准和可用的较早反馈，不修改 Canvas 成绩。'}</p></details></footer>
    </> : <div className="empty-state"><span>▤</span><h1>{t("打开一份 Canvas 作业")}</h1><p>{t("作业要求、提交记录和文件内容会自动出现在这里。刚更新扩展时，请刷新作业页。")}</p><a href={inExtension ? chrome.runtime.getURL("demo.html?demo=1") : "./demo.html"} target="_blank" rel="noreferrer">{t("查看示例")}</a></div>}
  </main>;
    return inExtension ? panel : <div className="demo-shell"><aside className="demo-controls"><div className="demo-brand">CANVAS CHECK <span>v0.8.4 · Pre-check</span></div><div><span className="eyebrow">{t("交作业前，快速看一眼")}</span><h2>{t("要求清楚，")}<br />{t("遗漏有据。")}</h2><p>{t("作业要求、每次提交、文件内容。")}<br />{t("在一个轻量侧栏里查看。")}</p><div className="demo-scenarios"><h3>{t("模拟 Canvas 附件变化")}</h3>{([['submitted',language==='en'?'Already submitted · No draft':'已提交 · 尚无新草稿'], ['pregrade', 'Pre-grade · '+(language==='en'?'Rubric & feedback':'评分与反馈')], ['missing', language==='en'?'Current draft · Missing screenshot':'当前草稿 · 缺少截图'], ['complete', t('补上截图')], ['replaced', t('替换同名 Java')], ['empty', t('移除全部附件')], ['scan', t('扫描 PDF')], ['office', t('Word 内嵌图片')], ['text', t('Canvas 文字提交')], ['grade', t('平时分：无需提交')], ['quiz', t('Canvas 测验')]] as const).map(([id, label]) => <button className={scenario === id ? 'active' : ''} key={id} onClick={() => loadDemo(id)}>{label}<span>↗</span></button>)}</div><p className="demo-caption">{scenario==='pregrade'?(language==='en'?'Synthetic rubric and teacher feedback.':'合成评分表与老师反馈。'):t("仅使用合成材料。试试右侧 Attempt 1，")}<br />{scenario==='pregrade'?(language==='en'?'Switch attempts to check scope isolation.':'切换 Attempt 可检查记录隔离。'):t("可看到之前的截图和源码。")}</p></div><a href="/smoke.html">{t("查看读取验证 ↗")}</a></aside>{panel}</div>;
}
createRoot(document.getElementById('root')!).render(<App />);
