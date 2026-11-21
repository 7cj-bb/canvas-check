import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIClient } from '../src/ai/client';
import { RequestCache } from '../src/ai/cache';
import { DEMO_ASSIGNMENT } from '../src/core/demo';
import type { AIFile } from '../src/ai/contracts';
import type { Requirement } from '../src/core/types';

const signal=()=>new AbortController().signal;
const rule:Requirement={id:'match',kind:'semantic',label:'Matches assignment',quote:'Submit source',artifact:'any'};
const file:AIFile={id:'1',name:'Main.java',kind:'java',complete:true,text:'class Main {}'};
function fixture(){
  const calls:{endpoint:string;data:any}[]=[];
  const client=createAIClient(async <T>(endpoint:string,data:unknown):Promise<T>=>{
    calls.push({endpoint,data});
    const input=data as {language:string};
    return (endpoint==='/api/summary'?{objective:input.language==='en'?'Read integers.':'读取整数。',constraints:[],requirements:[]}:{results:[]}) as T;
  });
  return {client,calls};
}
test('returning to AI reuses summaries; poll timestamps and attempts do not regenerate instructions',async()=>{
  const {client,calls}=fixture();
  const first=await client.summarize(DEMO_ASSIGNMENT,signal(),'en');
  const next=await client.summarize({...DEMO_ASSIGNMENT,capturedAt:Date.now(),attempt:'Attempt 3'},signal(),'en');
  assert.equal(next,first);assert.equal(calls.length,1);
});
test('summary languages are separate and immediately reusable when switching back',async()=>{
  const {client,calls}=fixture();
  assert.equal((await client.summarize(DEMO_ASSIGNMENT,signal(),'en')).objective,'Read integers.');
  assert.equal(client.peekSummary(DEMO_ASSIGNMENT,'zh-CN'),undefined);
  assert.equal((await client.summarize(DEMO_ASSIGNMENT,signal(),'zh-CN')).objective,'读取整数。');
  assert.equal((await client.summarize(DEMO_ASSIGNMENT,signal(),'en')).objective,'Read integers.');
  assert.equal(calls.length,2);
});
test('changed instructions or a different school assignment require a fresh summary',async()=>{
  const {client,calls}=fixture();
  for(const assignment of [DEMO_ASSIGNMENT,{...DEMO_ASSIGNMENT,description:'Changed instructions'},{...DEMO_ASSIGNMENT,key:'different-school:1'}])await client.summarize(assignment,signal(),'en');
  assert.equal(calls.length,3);
});
test('switching away during a request unsubscribes without duplicating the in-flight work',async()=>{
  let resolve!:(value:string)=>void,calls=0;
  const cache=new RequestCache<string>(), firstController=new AbortController();
  const load=async()=>{calls++;return new Promise<string>(done=>{resolve=done;});};
  const first=cache.get('same',load,firstController.signal);const rejected=assert.rejects(first,{name:'AbortError'});
  await Promise.resolve();firstController.abort();
  const second=cache.get('same',load,signal());resolve('completed');
  await rejected;assert.equal(await second,'completed');assert.equal(await cache.get('same',load,signal()),'completed');assert.equal(calls,1);
});
test('failed requests are not cached and a deliberate retry can succeed',async()=>{
  const cache=new RequestCache<number>();let calls=0;
  const load=async()=>{if(++calls===1)throw new Error('temporary network failure');return 7;};
  await assert.rejects(cache.get('task',load,signal()));assert.equal(await cache.get('task',load,signal()),7);assert.equal(calls,2);
});
test('content checks reuse exact materials; same filename with different text or image invalidates',async()=>{
  const {client,calls}=fixture();
  const locate=(files:AIFile[])=>client.locate(DEMO_ASSIGNMENT,[rule],files,'draft',signal(),'en');
  await locate([file]);await locate([{...file}]);assert.equal(calls.length,1);
  await locate([{...file,text:'class Other {}'}]);
  await locate([{...file,image:'data:image/png;base64,AAAA'}]);
  await locate([{...file,image:'data:image/png;base64,BBBB'}]);
  await locate([{...file,complete:false}]);assert.equal(calls.length,5);
});
test('history, languages, requirements and document parts cannot share an incompatible content result',async()=>{
  const {client,calls}=fixture();
  await client.locate(DEMO_ASSIGNMENT,[rule],[file],'draft',signal(),'en');
  await client.locate(DEMO_ASSIGNMENT,[rule],[file],'history:1',signal(),'en');
  await client.locate(DEMO_ASSIGNMENT,[rule],[file],'draft',signal(),'zh-CN');
  await client.locate(DEMO_ASSIGNMENT,[{...rule,quote:'New requirement'}],[file],'draft',signal(),'en');
  await client.locate(DEMO_ASSIGNMENT,[rule],[{...file,parts:[{id:'p1',label:'Page 1',text:'Changed page',complete:true}]}],'draft',signal(),'en');
  assert.equal(calls.length,5);
});
test('memory results are bounded; eviction triggers a fresh request',async()=>{
  const cache=new RequestCache<string>(2);let calls=0;
  for(const key of ['a','b','c','a'])await cache.get(key,async()=>{calls++;return key;},signal());
  assert.equal(calls,4);assert.equal(cache.peek('b'),undefined);
});
