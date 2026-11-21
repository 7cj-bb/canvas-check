import { DEMO_ASSIGNMENT } from '../core/demo';
import './style.css';
import {attachSubmitGuard} from '../extension/submit-guard';

const description = document.querySelector('[data-testid="assignments-2-assignment-description"]')!;
for (const text of DEMO_ASSIGNMENT.paragraphs) { const p = document.createElement('p'); p.textContent = text; description.append(p); }
const files = new Map<string, File>();
let nextId = 100;
let revision = 0;
const list = document.querySelector('#fixture-files')!;
function render() {
  revision++;
  list.replaceChildren();
  for (const [id, file] of files) {
    const li = document.createElement('tr');
    const icon = document.createElement('td'); icon.textContent = '▤';
    const name = document.createElement('td');
    const label = document.createElement('span'); label.textContent = file.name; label.title = file.name; name.append(label);
    const progress = document.createElement('td'); progress.textContent = `${file.size} B`;
    const done = document.createElement('td'); done.textContent = '✓';
    const actions = document.createElement('td');
    const remove = document.createElement('button'); remove.id = id; remove.type = 'button'; remove.textContent = '移除'; remove.setAttribute('aria-label', `移除 ${file.name}`);
    remove.onclick = () => { files.delete(id); render(); };
    actions.append(remove); li.append(icon, name, progress, done, actions); list.append(li);
  }
}
function add(input: FileList) { for (const file of Array.from(input)) files.set(String(++nextId), file); render(); }
const input = document.querySelector<HTMLInputElement>('#inputFileDrop')!;
input.addEventListener('change', () => { if (input.files) add(input.files); input.value = ''; });
const drop = document.querySelector<HTMLElement>('#file-upload-container')!;
drop.addEventListener('dragover', e => e.preventDefault());
drop.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files) add(e.dataTransfer.files); });
document.querySelector('#submit-button')!.addEventListener('click', () => { document.querySelector('#fixture-status')!.textContent = `仅模拟：当前有 ${files.size} 个待交文件，没有向任何服务器发送。`; });
const guard=attachSubmitGuard(document,{language:()=> 'en',state:()=>({assignment:{...DEMO_ASSIGNMENT,submissionMode:'upload'},revision,attachmentSource:'draft',coverage:'complete',warning:'',attachments:[...files].map(([id,file])=>({id,name:file.name,size:file.size}))}),open:()=>{document.querySelector('#fixture-status')!.textContent='本机演示：正常扩展会在此打开提交前核对侧栏。没有提交或上传材料。';}});
guard.update();
