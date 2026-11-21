import { readSubmissionFile } from '../core/files';
import { runLocalChecks } from '../core/checks';
import { DEMO_ASSIGNMENT } from '../core/demo';
import { extractLocalRequirements } from '../core/requirements';
import { attachmentSnapshotKey, scanCanvasAttachments } from '../core/attachments';
import './style.css';
import { scanSubmissionText } from '../core/submission-text';
import { prepareAIFiles } from '../ai/provider';
import { NativeDraftFiles } from '../core/draft-files';
import {attachSubmitGuard} from '../extension/submit-guard';
import type {CanvasState} from '../core/types';

document.querySelector('main')!.className = 'fixture-main';
const checks = document.querySelector('#checks')!;
let passed = 0, failed = 0;
async function expect(label: string, check: () => Promise<boolean>) {
  const li = document.createElement('li');
  try { if (!(await check())) throw new Error('结果不符合预期'); li.textContent = `通过 · ${label}`; passed++; }
  catch (e) { li.textContent = `失败 · ${label}：${e instanceof Error ? e.message : '读取错误'}`; failed++; }
  checks.append(li);
}
async function sample(name: string) {
  const response = await fetch(`./samples/${name}`);
  if (!response.ok) throw new Error('合成样例没有找到');
  return readSubmissionFile(new File([await response.arrayBuffer()], name));
}

await expect('Java：读取代码与真实循环', async () => { const f = await sample('NumberStats.java'); return f.java?.parsed === true && f.java.forLoops.length === 1; });
await expect('Java：注释和字符串不算循环', async () => { const f = await sample('KeywordOnly.java'); return f.java?.parsed === true && f.java.forLoops.length === 0; });
await expect('PDF：两页文字与页码完整保留', async () => { const f = await sample('TwoPages.pdf'); return f.state === 'ready' && f.pages?.length === 2 && f.pages[1].page === 2 && f.pages[1].text.includes('Second page'); });
await expect('PDF：没有文字层时自动渲染页面供 AI 识别', async () => { const f = await sample('NoTextLayer.pdf'); return f.state === 'ready' && f.parts?.length === 1 && Boolean(f.parts[0].image); });
await expect('扫描 PDF：读取页面图像并保留准确页码', async () => { const f = await sample('ScanOutput.pdf'); const ai = await prepareAIFiles([f]); return f.state==='ready' && f.pages?.[0].text==='' && Boolean(ai[0].parts?.[0].image) && ai[0].parts?.[0].page===1 && ai[0].complete; });
await expect('混合 PDF：文字页与扫描页都读取', async () => { const f = await sample('MixedScan.pdf'); return f.state==='ready' && f.pages?.length===2 && Boolean(f.pages[0].text.includes('page 2')) && !f.pages[1].text && f.parts?.every(part=>Boolean(part.image))===true; });
await expect('Word：正文和已引用的内嵌输出图片', async () => { const f = await sample('Sample.docx'); return f.state==='ready' && f.text?.includes('Synthetic reflection')===true && f.parts?.length===1 && Boolean(f.parts[0].image); });
await expect('PowerPoint：读取文字，原生布局保留未完整状态', async () => { const f = await sample('Sample.pptx'); return f.kind==='presentation' && f.text?.includes('Synthetic presentation evidence')===true && f.state==='unreadable'; });
await expect('Excel：读取工作表文字和数值', async () => { const f = await sample('Sample.xlsx'); return f.state==='ready' && f.kind==='spreadsheet' && f.text?.includes('A1: Synthetic evidence')===true && f.text.includes('B1: 42'); });
await expect('CSV / Python / UTF-16：自动读取文本和编码', async () => { const files = await Promise.all(['Sample.csv','Sample.py','UTF16.txt'].map(sample)); return files.every(file=>file.state==='ready') && files[2].text?.includes('你好')===true; });
await expect('JPEG / WebP / AVIF：自动解码图片', async () => { const files = await Promise.all(['RunOutput.jpg','RunOutput.webp','RunOutput.avif'].map(sample)); return files.every(file=>file.kind==='image' && file.state==='ready' && Boolean(file.preview)); });
await expect('GIF：保留首帧预览，不把其余帧当已读取', async () => { const f = await sample('RunOutput.gif'); return f.kind==='image' && Boolean(f.preview) && f.state==='unreadable'; });
await expect('Canvas 文字草稿：读取当前输入，而不是初始 textarea 内容', async () => { const doc = new DOMParser().parseFromString('<div id="text-entry-container"><textarea name="submission[body]">Old answer</textarea></div>','text/html'); const input=doc.querySelector('textarea')!; input.value='Current typed answer'; return scanSubmissionText(doc)?.text==='Current typed answer'; });
await expect('Canvas 富文本：读取当前正文，不读取页面其他输入', async () => { const doc = new DOMParser().parseFromString('<textarea>Unrelated teacher comment</textarea><div id="text-entry-container"><div role="textbox" contenteditable="true">Student answer with evidence</div></div>','text/html'); return scanSubmissionText(doc)?.text==='Student answer with evidence'; });
await expect('Canvas 富文本：关联本次正文图片，不保留签名链接', async () => { const doc=submittedFixture('<div id="text-entry-container"><div role="textbox" contenteditable="true">Answer<img src="/courses/1/files/301/preview?verifier=private"><img src="https://external.example/p.png"></div></div>');const body=scanSubmissionText(doc); return body?.images[0]?.id==='301' && body.incomplete && !JSON.stringify(body).includes('private'); });
await expect('Canvas 隐藏编辑器：不读取上一次草稿', async () => { const doc=submittedFixture('<form style="display:none"><textarea name="submission[body]">Old answer</textarea></form>');return scanSubmissionText(doc)===null; });
await expect('Canvas 编辑器未加载：不退回可能过期的 textarea', async () => { const doc=submittedFixture('<div id="text-entry-container"><iframe class="tox-edit-area__iframe"></iframe><textarea name="submission[body]">Old answer</textarea></div>');const body=scanSubmissionText(doc);return body?.incomplete===true && body.text===''; });
await expect('图片：正确解码尺寸与预览', async () => { const f = await sample('RunOutput.png'); return f.state === 'ready' && f.width === 500 && f.height === 180 && Boolean(f.preview?.startsWith('data:')); });
await expect('混合附件：找到截图文件，伪代码仍需确认', async () => { const files = await Promise.all([sample('NumberStats.java'), sample('RunOutput.png')]); const results = runLocalChecks(extractLocalRequirements(DEMO_ASSIGNMENT), files, true); return results.find(r => r.requirement.extensions?.includes('png'))?.status === 'found' && results.find(r => r.requirement.kind === 'semantic')?.status === 'confirm'; });
await expect('自动检测：不同后缀的真实 PNG 仍能识别和读取', async () => { const response = await fetch('./samples/RunOutput.png'); const f = await readSubmissionFile(new File([await response.arrayBuffer()], 'photo.bin')); return f.kind === 'image' && f.detectedFormat === 'png' && f.width === 500; });
await expect('附件列表：按 Canvas 当前行检测追加、移除和同名替换', async () => {
  const doc = new DOMParser().parseFromString('<div id="file-upload-container"><input type="file"><table data-testid="uploaded_files_table"><tbody><tr><td></td><td><span title="Main.java">Main.java</span></td><td></td><td></td><td><button id="101">Remove</button></td></tr><tr><td></td><td><span title="photo.png">photo.png</span></td><td></td><td></td><td><button id="102">Remove</button></td></tr></tbody></table></div>', 'text/html');
  const first = scanCanvasAttachments(doc);
  doc.getElementById('102')!.closest('tr')!.remove();
  const removed = scanCanvasAttachments(doc);
  doc.getElementById('101')!.id = '103';
  const replaced = scanCanvasAttachments(doc);
  return first.coverage === 'complete' && first.attachments.length === 2 && removed.attachments.length === 1 && attachmentSnapshotKey(removed) !== attachmentSnapshotKey(replaced);
});
function submittedFixture(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  Object.defineProperty(doc, 'URL', { value: 'https://canvas.example/courses/1/assignments/2' });
  return doc;
}
const submittedTable = '<table data-testid="uploaded_files_table"><tbody><tr><td><button>File<span>Main.java</span></button></td><td>Ma...java<span>Main.java</span></td><td>1 KB</td><td></td><td><a href="/files/201/download?verifier=synthetic-only">Download</a></td></tr></tbody></table>';
await expect('已提交记录：读取完整文件名和下载链接中的 ID，不保留访问凭据', async () => {
  const state = scanCanvasAttachments(submittedFixture(submittedTable));
  return state.attachmentSource === 'submitted' && state.coverage === 'complete' && state.attachments[0]?.name === 'Main.java' && state.attachments[0]?.id === '201' && !JSON.stringify(state).includes('verifier');
});
await expect('已提交记录：多份列表或外部文件链接不误报完整范围', async () => {
  const ambiguous = scanCanvasAttachments(submittedFixture(submittedTable + submittedTable));
  const external = scanCanvasAttachments(submittedFixture(submittedTable.replace('/files/201/download', 'https://other.example/files/201/download')));
  return ambiguous.coverage === 'unavailable' && external.coverage !== 'complete';
});
await expect('草稿优先：准备新尝试时不把上一份已提交附件混进来', async () => {
  const state = scanCanvasAttachments(submittedFixture(submittedTable + '<div id="file-upload-container"><input type="file"></div>'));
  return state.attachmentSource === 'draft' && state.coverage === 'complete' && state.attachments.length === 0;
});
await expect('提交前：原生文件框中的 Java 和图片可读取，不需要先 Submit', async () => {
  const doc = submittedFixture(submittedTable + '<form id="submit_online_upload_form"><input type="file" multiple></form>');
  const transfer = new DataTransfer();
  transfer.items.add(new File(['class Main {}'], 'Main.java'));
  transfer.items.add(new File([await (await fetch('./samples/RunOutput.png')).arrayBuffer()], 'output.png'));
  const input = doc.querySelector<HTMLInputElement>('input')!; input.files = transfer.files;
  const store = new NativeDraftFiles(), state = scanCanvasAttachments(doc, store);
  const read = await Promise.all(state.attachments.map(async meta => {
    const chunk = await store.chunk(meta.id, 0);
    return readSubmissionFile(new File([Uint8Array.from(atob(chunk.base64), c => c.charCodeAt(0))], meta.name));
  }));
  return state.attachmentSource === 'draft' && state.coverage === 'complete' && state.attachments.length === 2 && read[0].java?.parsed === true && read[1].kind === 'image' && read[1].state === 'ready';
});
await expect('提交前：替换同名文件和移除后立即失效，空草稿不继承旧 Attempt', async () => {
  const doc = submittedFixture(submittedTable + '<form id="submit_online_upload_form"><input type="file"></form>');
  const input = doc.querySelector<HTMLInputElement>('input')!, store = new NativeDraftFiles();
  const select = (text: string) => { const transfer = new DataTransfer(); transfer.items.add(new File([text], 'same.java', {lastModified:1})); input.files = transfer.files; };
  select('AAAA'); const a = scanCanvasAttachments(doc, store);
  select('BBBB'); const b = scanCanvasAttachments(doc, store);
  input.value = ''; const empty = scanCanvasAttachments(doc, store);
  let revoked = false; try { await store.chunk(b.attachments[0].id, 0); } catch { revoked = true; }
  return attachmentSnapshotKey(a) !== attachmentSnapshotKey(b) && empty.attachmentSource === 'draft' && empty.attachments.length === 0 && revoked;
});
await expect('提交前：切到文字输入时不读取隐藏文件草稿', async () => {
  const doc = submittedFixture('<form id="submit_online_upload_form" hidden><input type="file"></form><div id="text-entry-container"><textarea>Current text draft</textarea></div>');
  const transfer = new DataTransfer(); transfer.items.add(new File(['Old file'], 'old.txt')); doc.querySelector<HTMLInputElement>('input')!.files = transfer.files;
  return scanCanvasAttachments(doc).attachments.length === 0 && scanSubmissionText(doc)?.text === 'Current text draft';
});
await expect('最终 Submit：未核对时先提醒，确认提醒不会自动提交，仍需本人再点 Submit',async()=>{
  const fixture=document.createElement('section');fixture.innerHTML='<div id="assignments-student-footer" data-testid="student-footer"><button type="button">Submit</button><button type="button">New Attempt</button></div>';document.body.append(fixture);
  let submitted=0;const button=fixture.querySelector('button')!;button.addEventListener('click',()=>submitted++);
  let state:CanvasState={assignment:DEMO_ASSIGNMENT,revision:1,coverage:'complete',warning:'',attachmentSource:'draft',attachments:[{id:'1',name:'Main.java',size:1}]};
  const guard=attachSubmitGuard(document,{state:()=>state,language:()=> 'en',open:()=>{}});guard.update();
  try{
    button.click();const root=document.querySelector('[data-canvas-check-guard]')!.shadowRoot!;
    if(submitted!==0||!root.querySelector('dialog')!.open)return false;
    root.querySelector<HTMLButtonElement>('#continue')!.click();if(submitted!==0)return false;
    button.click();if(Number(submitted)!==1)return false;
    state={...state,revision:2};button.click();if(Number(submitted)!==1||!root.querySelector('dialog')!.open)return false;
    root.querySelector<HTMLButtonElement>('#back')!.click();
    guard.accept({assignmentKey:DEMO_ASSIGNMENT.key,revision:2,phase:'checked',missing:0,uncertain:0,unread:0,wrongFile:false});button.click();
    return Number(submitted)===2;
  }finally{guard.disconnect();fixture.remove();}
});
await expect('最终 Submit：键盘表单提交也受保护，评论按钮不被拦截',async()=>{
  const fixture=document.createElement('section');fixture.innerHTML='<form id="submit_online_text_entry_form"><textarea>Draft</textarea><button type="submit">Submit Assignment</button></form><form id="comment"><button type="button">Submit</button></form>';document.body.append(fixture);
  const state:CanvasState={assignment:{...DEMO_ASSIGNMENT,submissionMode:'text'},revision:1,coverage:'complete',warning:'',attachmentSource:'draft',attachments:[],submissionText:'Draft'};
  const guard=attachSubmitGuard(document,{state:()=>state,language:()=> 'en',open:()=>{}});guard.update();
  try{const event=new Event('submit',{bubbles:true,cancelable:true});fixture.querySelector('form')!.dispatchEvent(event);let comments=0;const comment=fixture.querySelector<HTMLButtonElement>('#comment button')!;comment.addEventListener('click',()=>comments++);comment.click();return event.defaultPrevented&&comments===1;}finally{guard.disconnect();fixture.remove();}
});
document.querySelector('#summary')!.textContent = `${passed} 项通过，${failed} 项失败。`;
