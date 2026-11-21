import { validateInput } from './input';
import { summarize, locate } from './openai';
import { validatePregradeInput, pregrade } from './pregrade';

export const ANALYSIS_PATHS = ['/api/summary','/api/evidence','/api/pregrade'];
export function validateAnalysis(path: string, value: unknown) {
  if(path==='/api/pregrade') return {kind:'pregrade' as const,data:validatePregradeInput(value)};
  if(path==='/api/summary' || path==='/api/evidence') return {kind:path==='/api/summary'?'summary' as const:'evidence' as const,data:validateInput(value,path==='/api/evidence')};
  throw new Error('Unknown analysis endpoint.');
}
export async function executeAnalysis(settings:{apiKey:string;model:string;pregradeModel?:string},request:ReturnType<typeof validateAnalysis>,fetcher?:typeof fetch) {
  if(request.kind==='pregrade') return pregrade({...settings,model:settings.pregradeModel||'gpt-5-mini'},request.data,fetcher);
  const data=request.data;
  return request.kind==='summary' ? summarize(settings,data.task,fetcher,data.language) : {results:await locate(settings,data.task,data.requirements,data.files,fetcher,data.language)};
}
