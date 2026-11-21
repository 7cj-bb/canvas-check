import test from 'node:test';
import assert from 'node:assert/strict';
import { submissionMode, checksApply } from '../src/core/submission-mode';
import { parseSubmissionHistory } from '../src/core/history';
import { submissionHTMLText, inlineCanvasImages } from '../src/core/submission-text';
import { resolveSubmissionScope } from '../src/core/submission-scope';
import { DEMO_ASSIGNMENT } from '../src/core/demo';
import { prepareAIFiles } from '../src/ai/provider';
import { validateInput } from '../server/input';
import { validateEvidence, locate } from '../server/openai';
import { extractLocalRequirements } from '../src/core/requirements';
import { runLocalChecks } from '../src/core/checks';
import type { AIFile } from '../src/ai/contracts';
import type { Requirement } from '../src/core/types';
const image = 'data:image/png;base64,AA==';
const rule: Requirement = {id:'output',kind:'semantic',artifact:'image',label:'Output',quote:'Submit a screenshot of the output.'};
const task = { title:'Synthetic',description:rule.quote };
const page = {id:'page-2',label:'Page 2',page:2,image,complete:true};
const pdf: AIFile = {id:'pdf',name:'scanned.pdf',kind:'pdf',complete:true,parts:[page],totalParts:1};
const result = (status: string, evidence: unknown[]=[]) => ({results:[{requirementId:rule.id,status,detail:'Presence only.',evidence}]});

test('Canvas metadata distinguishes grade items, quizzes, offline and external submissions', () => {
  for (const [types, mode] of [[['none'],'none'],[['on_paper'],'offline'],[['online_quiz'],'quiz'],[['external_tool'],'external'],[['online_url'],'external']] as const) {
    const parsed = submissionMode([...types]); assert.equal(parsed,mode); assert.equal(checksApply({...DEMO_ASSIGNMENT,submissionMode:parsed}),false);
  }
  assert.equal(submissionMode(['online_upload','online_text_entry']),'mixed');
  assert.equal(checksApply({...DEMO_ASSIGNMENT,title:'Final Exam — upload answers',submissionMode:'upload'}),true);
  assert.equal(submissionMode(null),'unknown'); assert.equal(checksApply({...DEMO_ASSIGNMENT,submissionMode:'unknown'}),false);
});
test('historical text submissions stay separate and exclude scripts, grades and comments', () => {
  const history = parseSubmissionHistory({attempt:2,submission_type:'online_text_entry',body:'<p>Current answer</p>',grade:'private-grade',submission_comments:['private-comment'],submission_history:[{attempt:1,submission_type:'online_text_entry',body:'<p>Previous answer</p><script>unsafe()</script>'}]});
  assert.equal(history[0].submissionText,'Current answer'); assert.equal(history[1].submissionText,'Previous answer');
  assert.ok(!JSON.stringify(history).includes('private')); assert.ok(!JSON.stringify(history).includes('unsafe()'));
  assert.equal(submissionHTMLText('<p>A &amp; B</p><p>Line 2</p>'),'A & B\n\nLine 2');
});
test('Canvas text content cannot impersonate a required uploaded file', () => {
  const file = {id:'text',name:'Canvas text entry.txt',size:12,extension:'txt',kind:'text' as const,state:'ready' as const,text:'Answer here',origin:'canvas-text' as const};
  assert.equal(runLocalChecks([{id:'txt',kind:'file',label:'Upload TXT',quote:'Upload a .txt file',extensions:['txt']}],[file],true)[0].status,'not-found');
});
test('screenshots requested inside a PDF do not require a second image attachment', () => {
  const description = 'Submit a PDF containing screenshots of the output.';
  const rules = extractLocalRequirements({...DEMO_ASSIGNMENT,description,paragraphs:[description]});
  assert.deepEqual(rules.filter(rule=>rule.kind==='file').map(rule=>rule.extensions),[['pdf']]);
  assert.equal(rules.find(rule=>rule.kind==='semantic')?.artifact,'image');
});
test('PDF evidence must identify a provided page and cannot invent a page or part ID', () => {
  const valid = {fileId:'pdf',partId:'page-2',page:2,quote:'smallest: 2',line:null};
  assert.equal(validateEvidence(result('found',[valid]),[rule],[pdf])[0].status,'found');
  assert.equal(validateEvidence(result('found',[{...valid,page:3}]),[rule],[pdf])[0].status,'confirm');
  assert.equal(validateEvidence(result('found',[{...valid,partId:'unknown'}]),[rule],[pdf])[0].status,'confirm');
  assert.equal(validateEvidence(result('found',[{...valid,partId:null,page:null}]),[rule],[pdf])[0].status,'confirm');
  assert.equal(validateEvidence(result('not-found'),[rule],[{...pdf,complete:false}])[0].status,'uncheckable');
  assert.equal(validateEvidence(result('not-found'),[rule],[pdf])[0].status,'not-found');
});
test('document images are included as image inputs, never as base64 in the text prompt', async () => {
  const checked = await locate({apiKey:'synthetic',model:'test'},task,[rule],[pdf],async(_url,init)=>{
    const body = JSON.parse(String(init?.body)); const content = body.input[0].content;
    assert.ok(!content[0].text.includes('base64,'));
    assert.equal(content.filter((item:{type:string})=>item.type==='input_image').length,1);
    assert.match(content.find((item:{type:string;text?:string})=>item.type==='input_text' && item.text?.includes('partId='))?.text,/partId=page-2/);
    return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result('found',[{fileId:'pdf',partId:'page-2',page:2,line:null,quote:'smallest: 2'}]))}]}]}));
  });
  assert.equal(checked[0].evidence[0].page,2);
});
test('page gaps, unread pages and oversized images cannot become a complete PDF', () => {
  const normalized = validateInput({task,requirements:[rule],files:[pdf]},true);
  assert.equal(normalized.files[0].complete,false);
  assert.throws(()=>validateInput({task,requirements:[rule],files:[{...pdf,parts:[{...page,image:'https://external.example/image.png'}]}]},true));
  assert.throws(()=>validateInput({task,requirements:[rule],files:[{...pdf,parts:[page,page]}]},true));
});
test('AI preparation keeps page provenance and does not claim truncated content is complete', async () => {
  const files = await prepareAIFiles([{id:'pdf',name:'scan.pdf',extension:'pdf',size:100,kind:'pdf',state:'ready',text:'',parts:[{...page,page:1,id:'page-1'}],totalParts:2}]);
  assert.equal(files[0].parts?.[0].id,'page-1'); assert.equal(files[0].complete,false); assert.equal(files[0].text,undefined);
});

test('inline images stay in their attempt and strip signed URLs; external embeds remain incomplete', () => {
  const origin = 'https://canvas.example';
  const body = '<p>Answer</p><img src="/courses/1/files/201/preview?verifier=private"><img data-api-endpoint="https://canvas.example/api/v1/files/202" src="https://cdn.example/private"><img src="https://external.example/files/203">';
  const inline = inlineCanvasImages(body,origin);
  assert.deepEqual(inline.images.map(file=>file.id),['201','202']); assert.equal(inline.incomplete,true);
  assert.ok(!JSON.stringify(inline).includes('private')); assert.ok(inline.images.every(file=>file.origin==='canvas-inline'));
  const history = parseSubmissionHistory({attempt:2,submission_type:'online_text_entry',body:'<p>New</p>',submission_history:[{attempt:1,submission_type:'online_text_entry',body}]},origin);
  assert.equal(history[0].attachments.length,0); assert.equal(history[1].attachments.length,2); assert.equal(history[1].textIncomplete,true);
  assert.equal(inlineCanvasImages('<iframe src="https://external.example"></iframe>',origin).incomplete,true);
});
test('a new text or file draft never inherits a previous body or inline images', () => {
  const assignment = {...DEMO_ASSIGNMENT,submissionMode:'mixed' as const};
  const old = {attempt:1,submittedAt:null,attachments:[{id:'20',name:'Old.png',size:100}],submissionText:'Old answer'};
  const submitted = {attachments:old.attachments,coverage:'complete' as const,warning:'',attachmentSource:'submitted' as const};
  const draft = {text:'New answer',draft:true,images:[],incomplete:false};
  const current = resolveSubmissionScope(assignment,submitted,draft,old);
  assert.equal(current.submissionText,'New answer'); assert.deepEqual(current.attachments,[]);
  const upload = resolveSubmissionScope(assignment,{...submitted,attachments:[],attachmentSource:'draft'},null,old);
  assert.equal(upload.submissionText,undefined); assert.deepEqual(upload.attachments,[]);
  assert.equal(resolveSubmissionScope(assignment,submitted,null,old).submissionText,'Old answer');
  assert.equal(resolveSubmissionScope({...assignment,submissionMode:'none'},submitted,draft,old).submissionText,undefined);
});
test('inline images cannot stand in for a separate required upload; unread text images block missing-content claims', () => {
  const inline = {id:'inline',name:'Inline.png',size:12,extension:'png',kind:'image' as const,state:'ready' as const,origin:'canvas-inline' as const};
  assert.equal(runLocalChecks([{id:'png',kind:'file',label:'Upload PNG',quote:'Upload a .png file',extensions:['png']}],[inline],true)[0].status,'not-found');
  assert.equal(validateEvidence(result('not-found'),[rule],[{id:'body',name:'Body',kind:'unknown',text:'Some text',complete:false}])[0].status,'uncheckable');
});
test('text requirements may use OCR evidence from an image', () => {
  const textRule = {...rule,artifact:'text' as const};
  const photo = {id:'photo',name:'Photo.png',kind:'image',image,complete:true};
  assert.equal(validateEvidence(result('found',[{fileId:'photo',quote:'Pseudocode',page:null,line:null,partId:null}]),[textRule],[photo])[0].status,'found');
  assert.equal(validateEvidence(result('not-found'),[textRule],[{...photo,complete:false}])[0].status,'uncheckable');
});
