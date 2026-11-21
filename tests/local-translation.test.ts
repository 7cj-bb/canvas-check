import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalOverviewTranslator,overviewNeedsTranslation,type TranslationAPI} from '../src/core/local-translation';
import type {AssignmentOverview} from '../src/core/overview';
const source:AssignmentOverview={objective:'Write project documentation for your Arduino circuit.',constraints:['Your document must include observations and a conclusion.'],method:'local',sourceExcerpt:true};
function fixture(){
  const inputs:string[]=[];let created=0;
  const api:TranslationAPI={availability:async()=> 'available',create:async()=>{created++;return {translate:async text=>{inputs.push(text);return text.includes('document must')?'文档必须包含观察记录与结论。':'为你的 Arduino 电路撰写项目文档。';}};}};
  return {api,inputs,created:()=>created,translator:new LocalOverviewTranslator(()=>api,()=>false)};
}
test('local translation covers objective and English constraints without changing source',async()=>{
  const {translator,inputs}=fixture(),before=JSON.stringify(source);
  const result=await translator.translate(source,'zh-CN');
  assert.equal(result.objective,'为你的 Arduino 电路撰写项目文档。');assert.equal(result.constraints[0],'文档必须包含观察记录与结论。');
  assert.equal(result.method,'local');assert.equal(result.translated,true);assert.equal(inputs.length,2);assert.equal(JSON.stringify(source),before);
});
test('switching back to Chinese reuses translation; changed instructions invalidate it',async()=>{
  const {translator,inputs,created}=fixture();
  const a=await translator.translate(source,'zh-CN');await translator.translate(source,'en');
  assert.equal(await translator.translate({...source,constraints:[...source.constraints]},'zh-CN'),a);assert.equal(inputs.length,2);
  await translator.translate({...source,objective:'Write a different report.'},'zh-CN');assert.equal(inputs.length,4);assert.equal(created(),1);
});
test('English constraints still translate when local objective is already Chinese',async()=>{
  const {translator,inputs}=fixture();
  const result=await translator.translate({...source,objective:'完成实验文档。'},'zh-CN');
  assert.equal(result.objective,'完成实验文档。');assert.equal(inputs.length,1);assert.match(result.constraints[0],/观察/);
});
test('first language-pack download requires activation, then retry can translate',async()=>{
  const {api}=fixture();api.availability=async()=> 'downloadable';let active=false;
  const translator=new LocalOverviewTranslator(()=>api,()=>active);
  await assert.rejects(translator.translate(source,'zh-CN'),{code:'activation'});
  active=true;assert.ok((await translator.translate(source,'zh-CN')).translated);
});
test('unsupported browser reports unavailable and never disguises source as translation',async()=>{
  const translator=new LocalOverviewTranslator(()=>undefined,()=>true);
  await assert.rejects(translator.translate(source,'zh-CN'),{code:'unavailable'});assert.equal(translator.peek(source,'zh-CN'),undefined);
});
test('failed or unchanged-English translation is not cached and can be retried',async()=>{
  const {api,translator}=fixture();let failed=true;
  api.create=async()=>({translate:async text=>failed?text:'这是中文译文。'});
  await assert.rejects(translator.translate(source,'zh-CN'),{code:'failed'});assert.equal(translator.peek(source,'zh-CN'),undefined);
  failed=false;assert.equal((await translator.translate(source,'zh-CN')).objective,'这是中文译文。');
});
test('filenames and code literals survive local translation exactly',async()=>{
  const {api,translator}=fixture();api.create=async()=>({translate:async text=>'译文：'+text});
  const objective='Submit Main.java with `student_score` declared as double.';
  const result=await translator.translate({...source,objective,constraints:[]},'zh-CN');
  for(const literal of ['Main.java','`student_score`','double'])assert.ok(result.objective.includes(literal));assert.ok(!result.objective.includes('ZXQKEEP'));
});
test('already-localized technical descriptions require no translation request',()=>{
  assert.equal(overviewNeedsTranslation({...source,objective:'使用 double 计算平均值。',constraints:['提交 Main.java。']},'zh-CN'),false);
});
