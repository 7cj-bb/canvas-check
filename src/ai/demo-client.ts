import { createAIClient } from './client';
import { prepareAIFiles } from './provider';
import type { AssignmentSnapshot, ReadFile, Requirement } from '../core/types';
import type { Language } from '../core/i18n';

/** Only the explicitly labelled localhost demo uses this synthetic transport. */
export function createDemoAIClient() {
  const calls = {summary:0, evidence:0};
  const client = createAIClient(async <T>(endpoint:string, data:unknown):Promise<T> => {
    const input = data as {language:Language;requirements?:Requirement[]};
    const en = input.language === 'en';
    if(endpoint==='/api/summary') calls.summary++; else calls.evidence++;
    await new Promise(resolve=>setTimeout(resolve,400));
    return (endpoint==='/api/summary' ? {
      objective:en?'Read integers and report the smallest and largest values.':'读取整数，并输出其中的最小值和最大值。',
      constraints:[en?'Use a for loop and include pseudocode.':'使用 for 循环，并包含伪代码。'], requirements:[]
    } : {results:input.requirements?.map(requirement=>({requirement,status:'confirm',detail:en?'Synthetic check: review the material.':'模拟核对：请确认材料。',evidence:[]}))}) as T;
  });
  return {...client,calls,async locate(assignment:AssignmentSnapshot,requirements:Requirement[],files:ReadFile[],signal:AbortSignal,language:Language,scope:string){
    return client.locate(assignment,requirements,await prepareAIFiles(files),scope,signal,language);
  }};
}
