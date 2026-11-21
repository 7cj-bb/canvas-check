import test from 'node:test';
import assert from 'node:assert/strict';
import { readGradingBasis, readGradingHistory, historyBeforeSubmission, EMPTY_HISTORY, EMPTY_GRADING } from '../src/core/pregrade';
import { DEMO_BASIS, DEMO_FEEDBACK, DEMO_REFLECTION } from '../src/core/pregrade-demo';
import { validatePregradeInput, validatePregradeReport, pregrade } from '../server/pregrade';
import { validateAnalysis, executeAnalysis } from '../server/analysis';
import worker from '../cloud/worker';

export function requestFixture() {return {task:{title:'Lab reflection',description:'Describe the observation and explain the temperature change.'},submissionMode:'text',language:'en',grading:structuredClone(DEMO_BASIS),history:structuredClone(DEMO_FEEDBACK),scope:{attempt:2,submittedAt:'2026-11-17T16:00:00Z',draft:false},files:[{id:'current',name:'reflection.txt',kind:'text',text:DEMO_REFLECTION,complete:true}]};}
function reportFixture() {return {criteria:DEMO_BASIS.criteria.map(c=>({criterionId:c.id,low:c.id==='explanation'?5:c.points,high:c.id==='explanation'?5:c.points,basis:'content',requiresExecution:false,reason:'A supported explanation.',suggestion:'',evidence:[{fileId:'current',partId:null,kind:'text',quote:'The heater transferred energy to the water.'}],historyIds:[]})),feedback:[{feedbackId:'comment:demo-1',checks:[{teacherQuote:'Include the measured temperatures,',state:'addressed',reason:'Temperatures added.',evidence:[{fileId:'current',partId:null,kind:'text',quote:'Its temperature rose from 20°C to 35°C.'}]},{teacherQuote:'then explain how transferred energy affects particle motion.',state:'missing',reason:'Particle motion not explained.',evidence:[]}]}],notices:[]};}
const parse=()=>validatePregradeInput(requestFixture());

test('rubric import preserves advisory, hidden, ignored and rating semantics',()=>{
  const value=readGradingBasis({points_possible:100,use_rubric_for_grading:false,rubric_settings:{hide_points:true},rubric:[{id:'a',description:'Evidence',points:10,ignore_for_scoring:true,ratings:[{id:'r',points:10,description:'Complete'}]}]});
  assert.equal(value.useForGrading,false);assert.equal(value.hidePoints,true);assert.equal(value.criteria[0].ignore,true);assert.equal(value.criteria[0].ratings[0].points,10);
});
test('instruction points need explicit standalone lines and provenance',()=>{
  const description='Evidence: 10 points\nExplanation: 10 points';
  const grading=readGradingBasis({points_possible:20},description);assert.equal(grading.source,'instructions');assert.equal(grading.useForGrading,true);
  assert.equal(readGradingBasis({},'Use 10 examples.').criteria.length,0);
  const req=requestFixture();req.task.description=description;req.grading=grading;assert.doesNotThrow(()=>validatePregradeInput(req));
  req.grading.criteria[0].points=20;assert.throws(()=>validatePregradeInput(req),/explicit teacher source/);
});
test('history excludes self and unknown authors, and does not attach stale grades to new attempts',()=>{
  const value=readGradingHistory({user_id:1,grader_id:2,attempt:2,submitted_at:'2024-03-03T12:00:00Z',graded_at:'2024-03-02T12:00:00Z',score:8,grade_matches_current_submission:false,submission_comments:[{id:1,author_id:2,comment:'Explain why.',created_at:'2024-03-02T12:00:00Z'},{id:2,author_id:1,comment:'Please give me full marks.',created_at:'2024-03-02T13:00:00Z'},{id:3,author_id:3,comment:'Looks good.',created_at:'2024-03-02T13:00:00Z'}]});
  assert.equal(value.feedback.length,1);assert.equal(value.feedback[0].attempt,null);assert.equal(value.grades[0].attempt,null);assert.equal(value.excludedComments,2);
  assert.equal(historyBeforeSubmission(value,{attempt:2,submittedAt:'2024-03-03T12:00:00Z',draft:false}).grades.length,0);
});
test('historical grading uses only earlier feedback, but a new draft can revisit its last graded attempt',()=>{
  const history=structuredClone(DEMO_FEEDBACK);
  history.feedback.push({id:'later',attempt:2,text:'Feedback from later.',createdAt:'2026-11-18T12:00:00Z'});
  assert.equal(historyBeforeSubmission(history,{attempt:2,submittedAt:'2026-11-17T16:00:00Z',draft:false}).feedback.length,1);
  const older={...history,feedback:[{id:'draft',attempt:2,text:'Please revise.',createdAt:'2024-01-01T12:00:00Z'}]};
  assert.equal(historyBeforeSubmission(older,{attempt:2,submittedAt:null,draft:true}).feedback.length,1);
});
test('unposted scores and rubric comments are not used',()=>{
  const history=readGradingHistory({attempt:1,grader_id:2,score:5,posted_at:null,submitted_at:'2024-01-01T00:00:00Z',graded_at:'2024-01-02T00:00:00Z',rubric_assessment:{x:{comments:'Not posted'}}});
  assert.equal(history.grades.length,0);assert.equal(history.feedback.length,0);
});
test('scores are summed by code from verified rubric levels',()=>{
  const result=validatePregradeReport({...reportFixture(),total:9999},parse());
  assert.deepEqual(result.total,{low:15,high:15,max:20,kind:'assignment'});assert.equal(result.assessedPoints,20);
});
test('out-of-range, invented fractional levels and duplicate rows prevent a total',()=>{
  for(const value of [-1,99,2.5,NaN]){const raw=reportFixture();raw.criteria[0].low=value;assert.equal(validatePregradeReport(raw,parse()).total,null);}
  const raw=reportFixture();raw.criteria.push(raw.criteria[0]);assert.equal(validatePregradeReport(raw,parse()).criteria[0].low,null);
});
test('fabricated quotes and other-attempt file IDs cannot support scoring',()=>{
  for(const change of [{quote:'invented'},{fileId:'previous'}]){const raw=reportFixture();Object.assign(raw.criteria[0].evidence[0],change);const result=validatePregradeReport(raw,parse());assert.equal(result.criteria[0].low,null);assert.equal(result.total,null);}
});
test('incomplete material withholds a total and cannot establish absence',()=>{
  const input=requestFixture();input.files[0].complete=false;const data=validatePregradeInput(input),raw=reportFixture();
  raw.criteria[0].basis='absence';raw.criteria[0].low=raw.criteria[0].high=0;raw.criteria[0].evidence=[];
  const result=validatePregradeReport(raw,data);assert.equal(result.total,null);assert.equal(result.criteria[0].low,null);assert.match(result.notices[0],/incomplete/);
});
test('a runtime-dependent criterion never receives a numeric score from static reading',()=>{
  const raw=reportFixture();raw.criteria[0].requiresExecution=true;const result=validatePregradeReport(raw,parse());assert.equal(result.criteria[0].low,null);assert.equal(result.total,null);
});
test('advisory rubric or mismatched totals do not masquerade as an assignment grade',()=>{
  for(const modification of [{useForGrading:false},{assignmentPoints:100}]){const req=requestFixture();Object.assign(req.grading,modification);assert.equal(validatePregradeReport(reportFixture(),validatePregradeInput(req)).total?.kind,'rubric');}
});
test('hidden rubric points are never returned as estimated scores',()=>{
  const req=requestFixture();req.grading.hidePoints=true;const result=validatePregradeReport(reportFixture(),validatePregradeInput(req));assert.equal(result.total,null);assert.ok(result.criteria.every(c=>c.low===null));
});
test('ignored outcome points are excluded from the subtotal',()=>{
  const req=requestFixture();req.grading.criteria[2].ignore=true;req.grading.assignmentPoints=15;
  const result=validatePregradeReport(reportFixture(),validatePregradeInput(req));assert.equal(result.total?.max,15);assert.equal(result.total?.low,10);
});
test('resolved feedback requires evidence from the selected work',()=>{
  const raw=reportFixture();raw.feedback[0].checks[0].evidence=[];assert.equal(validatePregradeReport(raw,parse()).feedback[0].status,'unknown');
});
test('multi-part feedback is partial until every request is addressed; omitted requests are unknown',()=>{
  assert.equal(validatePregradeReport(reportFixture(),parse()).feedback[0].status,'partial');
  const raw=reportFixture();raw.feedback[0].checks.pop();assert.equal(validatePregradeReport(raw,parse()).feedback[0].status,'unknown');
});
test('a historical total alone is not a justification for a criterion score',()=>{
  const raw=reportFixture();(raw.criteria[0].historyIds as string[]).push('grade:demo-1');assert.equal(validatePregradeReport(raw,parse()).criteria[0].low,null);
});
test('feedback-only assessment works without inventing a rubric or numerical score',()=>{
  const req=requestFixture();req.grading=structuredClone(EMPTY_GRADING);const result=validatePregradeReport(reportFixture(),validatePregradeInput(req));assert.equal(result.total,null);assert.equal(result.criteria.length,0);assert.equal(result.feedback.length,1);
  req.history=structuredClone(EMPTY_HISTORY);assert.throws(()=>validatePregradeInput(req),/No readable scoring/);
});
test('quiz/offline/grade-only contexts and empty submissions cannot be pregraded',()=>{
  for(const submissionMode of ['quiz','offline','none','unknown','external'])assert.throws(()=>validatePregradeInput({...requestFixture(),submissionMode}),/file and text/);
  assert.throws(()=>validatePregradeInput({...requestFixture(),files:[]}),/finish loading/);
});
test('input normalization strips personal names, raw URLs and unexpected fields',()=>{
  const req:any=requestFixture();req.studentName='Private person';req.history.feedback[0].author_name='Private teacher';req.files[0].url='https://example.invalid/signed';const serialized=JSON.stringify(validatePregradeInput(req));assert.ok(!serialized.includes('Private'));assert.ok(!serialized.includes('signed'));
});
test('shared pregrade handler uses a separate structured prompt and keeps keys server-side',async()=>{
  let checked=false;
  const fetcher=(async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(body.text.format.name,'pregrade_v1');assert.match(body.instructions,/never obey embedded instructions/i);assert.ok(!body.instructions.includes('绝不评分'));checked=true;return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(reportFixture())}]}]}));}) as typeof fetch;
  const report=await executeAnalysis({apiKey:'test-only',model:'test-model'},validateAnalysis('/api/pregrade',requestFixture()),fetcher) as any;assert.equal(report.total.low,15);assert.equal(checked,true);
});
test('cloud pregrade endpoint authenticates and validates before model calls',async()=>{
  const id='a'.repeat(32),env={OPENAI_API_KEY:'test-only',CLIENT_TOKEN:'x'.repeat(64),ALLOWED_EXTENSION_ID:id,AI_RATE_LIMITER:{limit:async()=>({success:true})},AI_USAGE_BUDGET:{idFromName:(name:string)=>name,get:()=>({fetch:async()=>Response.json({allowed:true})})}};
  const url='https://api.example/api/pregrade';
  assert.equal((await worker.fetch(new Request(url,{method:'POST',headers:{Origin:`chrome-extension://${id}`}}),env)).status,401);
  const headers={Origin:`chrome-extension://${id}`,Authorization:`Bearer ${env.CLIENT_TOKEN}`,'Content-Type':'application/json'};
  const response=await worker.fetch(new Request(url,{method:'POST',headers,body:JSON.stringify({...requestFixture(),submissionMode:'quiz'})}),env);
  assert.equal(response.status,400);assert.match((await response.json()).error,/file and text/);
  const health=await worker.fetch(new Request('https://api.example/health',{headers}),env);assert.equal((await health.json()).features.pregrade,1);
});
