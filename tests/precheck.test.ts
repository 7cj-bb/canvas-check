import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewSelection,withAssignmentMatch,precheckReport,needsSubmitReview,MATCH_REQUIREMENT_ID} from '../src/core/precheck';
import {DEMO_ASSIGNMENT} from '../src/core/demo';
import type {CanvasState,CheckResult,ReadFile} from '../src/core/types';
import {validateEvidence} from '../server/openai';
const state:CanvasState={assignment:DEMO_ASSIGNMENT,revision:7,coverage:'complete',warning:'',attachmentSource:'submitted',attachments:[{id:'old',name:'Old.java',size:10}],history:[{attempt:1,submittedAt:null,attachments:[{id:'old',name:'Old.java',size:10}]}]};
const requirements=withAssignmentMatch([{id:'file',kind:'file',label:'Java file',quote:'Submit Java',extensions:['java']}],'Write a Java program to compute a letter grade from three scores.');
const source:ReadFile={id:'f',name:'Main.java',size:10,kind:'java',extension:'java',state:'ready'};
const results:CheckResult[]=requirements.map(requirement=>({requirement,status:'found',detail:'Found',evidence:[]}));
const ready={hasDraft:true,materialCount:1,trusted:true,finished:true,analyzing:false,requirements,results,files:[source]};

test('default pre-check never reads the already submitted attempt',()=>{
  const selected=reviewSelection(state,null);assert.equal(selected.waiting,true);assert.equal(selected.count,0);assert.deepEqual(selected.attachments,[]);assert.equal(selected.trusted,false);
});
test('history requires an explicit selection and cannot fall back to draft or another attempt',()=>{
  assert.equal(reviewSelection(state,1).attachments[0].id,'old');assert.equal(reviewSelection(state,2).attachments.length,0);assert.equal(reviewSelection(state,2).trusted,false);
});
test('new or empty draft does not inherit old files or whitespace text',()=>{
  const selected=reviewSelection({...state,attachmentSource:'draft',attachments:[],submissionText:'  \n'},null);assert.equal(selected.draft,true);assert.equal(selected.waiting,false);assert.equal(selected.count,0);
});
test('a file-format pass is not a submission-identity pass',()=>{
  assert.equal(precheckReport({...ready,results:[results[0]]}).phase,'attention');
  assert.equal(precheckReport({...ready,requirements:[requirements[0]],results:[results[0]]}).phase,'attention');
});
test('only current complete content checks with assignment evidence can pass',()=>{
  assert.equal(precheckReport(ready).phase,'checked');
  for(const changed of [{finished:false},{analyzing:true},{trusted:false}])assert.equal(precheckReport({...ready,...changed}).phase,'checking');
  assert.equal(precheckReport({...ready,materialCount:0}).phase,'waiting');
  assert.equal(precheckReport({...ready,files:[{...source,state:'unreadable'}]}).phase,'attention');
});
test('mismatched work remains an explicit pre-submit issue',()=>{
  const report=precheckReport({...ready,results:results.map(r=>r.requirement.id===MATCH_REQUIREMENT_ID?{...r,status:'not-found'}:r)});assert.equal(report.wrongFile,true);assert.equal(report.phase,'attention');
});
test('submit gate rejects stale receipts from changed materials or another assignment',()=>{
  const draft={...state,attachmentSource:'draft' as const},receipt={assignmentKey:DEMO_ASSIGNMENT.key,revision:7,phase:'checked' as const};
  assert.equal(needsSubmitReview(draft,null),true);assert.equal(needsSubmitReview(draft,receipt),false);
  assert.equal(needsSubmitReview({...draft,revision:8},receipt),true);
  assert.equal(needsSubmitReview(draft,{...receipt,assignmentKey:'another-task'}),true);
  assert.equal(needsSubmitReview({...draft,attachments:[]},receipt),true);
  assert.equal(needsSubmitReview({...draft,coverage:'pending'},receipt),true);
});
test('history, grade-only, offline and quiz pages never get a submission gate',()=>{
  assert.equal(needsSubmitReview(state,null),false);
  for(const submissionMode of ['none','offline','quiz','external','unknown'] as const)assert.equal(needsSubmitReview({...state,attachmentSource:'draft',assignment:{...DEMO_ASSIGNMENT,submissionMode}},null),false);
});
test('assignment matching needs evidence for every file, not just one good attachment',()=>{
  const rule=requirements.find(r=>r.id===MATCH_REQUIREMENT_ID)!;
  const files=[{id:'a',name:'good.java',kind:'java',complete:true,text:'compute average'},{id:'b',name:'other.java',kind:'java',complete:true,text:'stock market'}];
  const response={results:[{requirementId:rule.id,status:'found',detail:'Looks relevant',evidence:[{fileId:'a',quote:'compute average',line:null,page:null}]}]};
  assert.equal(validateEvidence(response,[rule],files)[0].status,'confirm');
  response.results[0].status='not-found';response.results[0].evidence=[];
  assert.equal(validateEvidence(response,[rule],files)[0].status,'confirm');
  response.results[0].evidence=[{fileId:'b',quote:'stock market',line:null,page:null}];
  assert.equal(validateEvidence(response,[rule],files)[0].status,'not-found');
});
