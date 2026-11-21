import type { Language } from './i18n';
import type { AssignmentOverview } from './overview';

type Pair = {sourceLanguage:string;targetLanguage:string};
export interface LocalTranslator {translate(text:string):Promise<string>}
export interface TranslationAPI {
  availability(pair:Pair):Promise<'available'|'downloadable'|'downloading'|'unavailable'>;
  create(options:Pair & {monitor?:(monitor:{addEventListener:(name:string,listener:(event:{loaded:number})=>void)=>void})=>void}):Promise<LocalTranslator>;
}
export type TranslationProgress = {state:'translating'}|{state:'downloading';percent:number};
export class LocalTranslationError extends Error {
  constructor(public code:'activation'|'unavailable'|'failed'){super(code);}
}

/** The app currently supports English and Chinese, including technical literals.
 * App-authored text has already been localized by summarizeRequirements. */
export function needsTranslation(text:string, language:Language):boolean {
  const prose=text.replace(/`[^`]+`|\b[\w$-]+\.(?:java|pdf|docx|png|jpg|cpp|py|txt)\b/g,'');
  return language==='en' ? /\p{Script=Han}/u.test(prose) : !/\p{Script=Han}/u.test(prose) && /[a-zA-Z]{3,}/.test(prose);
}
export function overviewNeedsTranslation(overview:AssignmentOverview, language:Language){
  return [overview.objective,...overview.constraints].some(text=>needsTranslation(text,language));
}
export function translationKey(overview:AssignmentOverview,language:Language){
  return JSON.stringify([language,overview.objective,overview.constraints]);
}

async function preserveLiterals(text:string,translator:LocalTranslator):Promise<string>{
  const literals:string[]=[];
  const masked=text.replace(/`[^`]+`|\b[\w$-]+\.(?:java|pdf|docx|pptx|xlsx|png|jpe?g|cpp|py|txt)\b|\b(?:int|double|float|boolean|String|System\.out\.println)\b/g,value=>{
    const index=literals.push(value)-1;return `ZXQKEEP${index}QXZ`;
  });
  let result=(await translator.translate(masked)).trim();
  for(const [index,value] of literals.entries()){
    const token=`ZXQKEEP${index}QXZ`;
    if(!result.includes(token))throw new LocalTranslationError('failed');
    result=result.replaceAll(token,value);
  }
  return result;
}

/** Purely browser-local translation: never falls back to a network translation endpoint. */
export class LocalOverviewTranslator {
  private instances=new Map<string,Promise<LocalTranslator>>();
  private pending=new Map<string,Promise<AssignmentOverview>>();
  private completed=new Map<string,AssignmentOverview>();
  private listeners=new Map<string,Set<(value:TranslationProgress)=>void>>();
  constructor(private api:()=>TranslationAPI|undefined, private activated:()=>boolean){}
  peek(overview:AssignmentOverview,language:Language){return this.completed.get(translationKey(overview,language));}
  async translate(overview:AssignmentOverview,language:Language,progress:(value:TranslationProgress)=>void=()=>{}):Promise<AssignmentOverview>{
    if(!overviewNeedsTranslation(overview,language))return overview;
    const key=translationKey(overview,language),saved=this.completed.get(key);if(saved)return saved;
    const listeners=this.listeners.get(key)??new Set();listeners.add(progress);this.listeners.set(key,listeners);
    let job=this.pending.get(key);
    if(!job){
      const emit=(value:TranslationProgress)=>this.listeners.get(key)?.forEach(listener=>listener(value));
      job=this.run(overview,language,emit).then(value=>{
        this.completed.set(key,value);
        while(this.completed.size>24)this.completed.delete(this.completed.keys().next().value!);
        return value;
      }).finally(()=>{this.pending.delete(key);this.listeners.delete(key);});
      this.pending.set(key,job);
    }
    try{return await job;}finally{listeners.delete(progress);}
  }
  private async run(overview:AssignmentOverview,language:Language,progress:(value:TranslationProgress)=>void){
    const api=this.api();if(!api)throw new LocalTranslationError('unavailable');
    const pair:Pair=language==='zh-CN'?{sourceLanguage:'en',targetLanguage:'zh'}:{sourceLanguage:'zh',targetLanguage:'en'};
    const pairKey=JSON.stringify(pair);
    let translator=this.instances.get(pairKey);
    if(!translator){
      const availability=await api.availability(pair);
      if(availability==='unavailable')throw new LocalTranslationError('unavailable');
      if(availability!=='available'&&!this.activated())throw new LocalTranslationError('activation');
      if(availability!=='available')progress({state:'downloading',percent:0});
      // Check again after awaiting availability: another overview may have created it.
      translator=this.instances.get(pairKey);
      if(!translator){
        translator=api.create({...pair,monitor:monitor=>monitor.addEventListener('downloadprogress',event=>progress({state:'downloading',percent:Math.round(event.loaded*100)}))});
        this.instances.set(pairKey,translator);
        void translator.catch(()=>this.instances.delete(pairKey));
      }
    }
    try{
      const instance=await translator;progress({state:'translating'});
      const convert=async(text:string)=>{
        if(!needsTranslation(text,language))return text;
        const translated=await preserveLiterals(text,instance);
        // Never label an untouched English excerpt as a completed Chinese translation.
        if(!translated || needsTranslation(translated,language))throw new LocalTranslationError('failed');
        return translated;
      };
      const objective=await convert(overview.objective),constraints:string[]=[];
      for(const text of overview.constraints)constraints.push(await convert(text));
      return {...overview,objective,constraints,translated:true};
    }catch(error){
      if(error instanceof LocalTranslationError)throw error;
      if(error instanceof DOMException && error.name==='NotAllowedError')throw new LocalTranslationError('activation');
      throw new LocalTranslationError('failed');
    }
  }
}
export const localOverviewTranslator=new LocalOverviewTranslator(
  ()=> (globalThis as typeof globalThis & {Translator?:TranslationAPI}).Translator,
  ()=> typeof navigator!=='undefined' && navigator.userActivation?.isActive===true
);
