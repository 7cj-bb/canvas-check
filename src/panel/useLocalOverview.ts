import {useEffect,useState} from 'react';
import type {AssignmentOverview} from '../core/overview';
import type {Language} from '../core/i18n';
import {localOverviewTranslator,LocalTranslationError,overviewNeedsTranslation,translationKey,type TranslationProgress} from '../core/local-translation';

type State={key:string;value?:AssignmentOverview;status:'activation'|'unavailable'|'failed'|'ready'|'translating'|'downloading';percent?:number};
export function useLocalOverview(overview:AssignmentOverview|null,language:Language,enabled:boolean){
  const key=overview?translationKey(overview,language):'',needed=Boolean(overview&&overviewNeedsTranslation(overview,language));
  const [state,setState]=useState<State|null>(null),[retry,setRetry]=useState(0);
  const saved=overview?localOverviewTranslator.peek(overview,language):undefined;
  const current=state?.key===key?state:null;
  useEffect(()=>{
    if(!overview||!enabled||!needed||saved)return;
    let active=true;
    setState({key,status:'translating'});
    const progress=(value:TranslationProgress)=>{if(active)setState({key,status:value.state,...(value.state==='downloading'?{percent:value.percent}:{})});};
    void localOverviewTranslator.translate(overview,language,progress).then(value=>{
      if(active)setState({key,value,status:'ready'});
    }).catch(error=>{if(active)setState({key,status:error instanceof LocalTranslationError?error.code:'failed'});});
    return()=>{active=false;};
  },[key,enabled,needed,retry]);
  return {needed,value:saved??current?.value,status:saved?'ready':current?.status??'translating',percent:current?.percent,retry:()=>setRetry(value=>value+1)};
}
