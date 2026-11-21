import type { CanvasState } from '../core/types';
import { checksApply } from '../core/submission-mode';
import { needsSubmitReview, type PrecheckReport } from '../core/precheck';

type Receipt=PrecheckReport & {assignmentKey:string;revision:number};
const own='[data-canvas-check-guard]';
const uploadForms='#submit_online_upload_form, #submit_online_text_entry_form';
const footers='#assignments-student-footer, [data-testid="student-footer"], [data-testid="assignments-student-footer"], #submit_assignment';

/** Only Canvas's final assignment-submit controls. Never comments, quizzes or New Attempt. */
export function assignmentSubmitControl(target:EventTarget|null):HTMLElement|null {
  if(!(target instanceof Element) || target.closest(own))return null;
  const button=target.closest<HTMLElement>('button,input[type="submit"]');
  if(!button || button.hasAttribute('disabled') || button.getAttribute('aria-disabled')==='true')return null;
  const label=(button.getAttribute('aria-label')||button.textContent||(button as HTMLInputElement).value||'').replace(/\s+/g,' ').trim();
  return /^(?:Submit(?: Assignment)?|提交(?:作业)?)$/i.test(label) && Boolean(button.closest(`${uploadForms},${footers}`))?button:null;
}

export function attachSubmitGuard(doc:Document, options:{state:()=>CanvasState;refresh?:()=>void;language:()=>string;open:()=>void}) {
  let receipt:Receipt|null=null, bypass='', passThrough='', promptKey='', host:HTMLElement|null=null, dialog:HTMLDialogElement|null=null, identity='', renderKey='';
  const key=(state:CanvasState)=>`${state.assignment?.key}:${state.revision}`;
  const say=(en:string,zh:string)=>options.language()==='en'?en:zh;
  function clear(){host?.remove();host=null;dialog=null;renderKey='';}
  function mount(state:CanvasState){
    const anchor=doc.querySelector(footers)??doc.querySelector(uploadForms);
    if(!anchor)return;
    const current=key(state); if(identity!==current){identity=current;bypass='';receipt=null;dialog?.close();}
    if(host?.isConnected && host.nextElementSibling===anchor)return;
    clear();host=doc.createElement('div');host.setAttribute('data-canvas-check-guard','');anchor.insertAdjacentElement('beforebegin',host);
    const root=host.attachShadow({mode:'open'});
    root.innerHTML=`<style>:host{display:block;margin:16px 0;font:14px/1.5 system-ui;color:#213e34}.bar,dialog{background:#f5f9f6;border:1px solid #cbded3;border-radius:10px;padding:14px}.bar{display:flex;align-items:center;justify-content:space-between;gap:16px}.copy strong{display:block}.copy p{margin:3px 0 0}button{font:inherit;border:1px solid #b4cabe;border-radius:7px;padding:8px 12px;cursor:pointer;background:white;color:#163f36}button.primary{background:#235443;color:white}dialog{max-width:450px;padding:24px;box-shadow:0 8px 40px #0003}dialog::backdrop{background:#152b2466}h2{font-size:20px;margin:0 0 12px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}.minor{font-size:12px;color:#4b6259}</style><div class="bar" role="status"><div class="copy"><strong>Canvas Check · Pre-check</strong><p id="status"></p></div><button id="review" class="primary"></button></div><dialog aria-labelledby="title"><h2 id="title"></h2><p id="reason"></p><p class="minor" id="note"></p><div class="actions"><button id="open" class="primary"></button><button id="continue"></button><button id="back"></button></div></dialog>`;
    dialog=root.querySelector('dialog');
    root.querySelector('#review')!.addEventListener('click',options.open);
    root.querySelector('#open')!.addEventListener('click',()=>{dialog?.close();options.open();});
    root.querySelector('#back')!.addEventListener('click',()=>dialog?.close());
    root.querySelector('#continue')!.addEventListener('click',()=>{
      options.refresh?.();
      const now=options.state();
      if(key(now)===identity&&key(now)===promptKey)bypass=identity;
      dialog?.close();update(); // The student must click Canvas Submit again; never replay submission.
    });
  }
  function update(){
    const state=options.state();
    if(!checksApply(state.assignment)||state.attachmentSource!=='draft'){clear();receipt=null;bypass='';identity='';return;}
    const current=key(state);if(identity!==current){identity=current;receipt=null;bypass='';dialog?.close();}
    mount(state);if(!host)return;
    const next=JSON.stringify([identity,options.language(),receipt,bypass]);if(next===renderKey)return;renderKey=next;
    const root=host.shadowRoot!;
    root.querySelector('#status')!.textContent=bypass===identity?say('Review acknowledged. Click Canvas Submit again if you want to proceed.','已确认提醒。如仍要提交，请再次点击 Canvas 的 Submit。'):receipt?.phase==='checked'?say('Current draft checked. Review the files, then submit in Canvas.','当前草稿已核对。确认材料后，在 Canvas 提交。'):say('Check the current files and text before you submit.','提交前，核对当前文件和正文。');
    root.querySelector('#review')!.textContent=say('Open pre-check','打开提交前核对');
    root.querySelector('#title')!.textContent=say('Review before you submit','提交前请先确认');
    root.querySelector('#reason')!.textContent=receipt?.wrongFile?say('Some material may belong to a different assignment. Review the evidence first.','材料可能对应另一份作业，请先查看依据。'):receipt?.phase==='attention'?say('Some requirements are missing, unreadable or still need confirmation.','仍有缺项、未读完整或需要确认的内容。'):say('These materials have not finished checking, or changed since the last check.','当前材料尚未核对完成，或已在核对后发生变化。');
    root.querySelector('#note')!.textContent=say('Canvas Check does not submit for you. You can review first or acknowledge this reminder and click Canvas Submit again.','Canvas Check 不会代你提交。你可以先查看，或确认提醒后再次点击 Canvas 的 Submit。');
    root.querySelector('#open')!.textContent=say('Review materials','查看材料核对');root.querySelector('#continue')!.textContent=say('Acknowledge and return','已了解，返回提交');root.querySelector('#back')!.textContent=say('Keep editing','继续修改');
  }
  function attempt(event:Event){
    const isSubmit=event.type==='submit' && event.target instanceof Element && event.target.matches(uploadForms);
    if(!isSubmit && !assignmentSubmitControl(event.target))return;
    options.refresh?.();
    const state=options.state();update();if(!checksApply(state.assignment)||state.attachmentSource!=='draft')return;
    const current=key(state);
    if(passThrough===current)return;
    if(bypass===current){bypass='';passThrough=current;setTimeout(()=>{passThrough='';update();},0);return;}
    if(!needsSubmitReview(state,receipt))return;
    // If the target cannot be represented safely, do not break Canvas's form.
    if(!dialog)return;
    event.preventDefault();event.stopImmediatePropagation();
    promptKey=current;if(!dialog.open)dialog.showModal();
  }
  doc.addEventListener('click',attempt,true);doc.addEventListener('submit',attempt,true);
  return {update,accept(value:Receipt){const state=options.state();update();if(value.assignmentKey===state.assignment?.key&&value.revision===state.revision&&state.attachmentSource==='draft'){receipt=value;update();}},disconnect(){doc.removeEventListener('click',attempt,true);doc.removeEventListener('submit',attempt,true);clear();}};
}
