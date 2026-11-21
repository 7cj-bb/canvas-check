import type { CanvasState, CheckResult, ReadFile, Requirement } from './types';
import { checksApply } from './submission-mode';

export const MATCH_REQUIREMENT_ID = 'precheck:assignment-match';
export function withAssignmentMatch(requirements: Requirement[], description: string): Requirement[] {
  if (!description.trim()) return requirements;
  return [...requirements.filter(r => r.id !== MATCH_REQUIREMENT_ID), {id:MATCH_REQUIREMENT_ID,kind:'semantic',artifact:'any',label:'材料对应当前作业',quote:description.trim().slice(0,1000)}];
}

/** Null always means the unsubmitted draft, never whichever submitted attempt Canvas shows. */
export function reviewSelection(state: CanvasState | null, attempt: number | null) {
  const historical = attempt === null ? undefined : state?.history?.find(item => item.attempt === attempt);
  const draft = attempt === null && state?.attachmentSource === 'draft';
  const source = historical ?? (draft ? state : undefined);
  const attachments = source?.attachments ?? [];
  const text = source?.submissionText;
  return {draft, historical, waiting:attempt === null && !draft, attachments, text, textIncomplete:source?.textIncomplete,
    trusted:Boolean(historical) || draft && state?.coverage === 'complete',
    count:attachments.length + (text?.trim() ? 1 : 0)};
}

export type PrecheckPhase = 'waiting' | 'checking' | 'attention' | 'checked';
export interface PrecheckReport { phase:PrecheckPhase; missing:number; uncertain:number; unread:number; wrongFile:boolean }
export function precheckReport(args:{hasDraft:boolean;materialCount:number;trusted:boolean;finished:boolean;analyzing:boolean;requirements:Requirement[];results:CheckResult[]|null;files:ReadFile[]}):PrecheckReport {
  const base:PrecheckReport={phase:'waiting',missing:0,uncertain:0,unread:0,wrongFile:false};
  if(!args.hasDraft || !args.materialCount)return base;
  if(!args.trusted || !args.finished || args.analyzing)return {...base,phase:'checking'};
  const results=args.results??[],missing=results.filter(r=>r.status==='not-found').length,uncertain=results.filter(r=>r.status==='confirm'||r.status==='uncheckable').length;
  const unread=args.files.filter(f=>f.state!=='ready').length;
  const everyChecked=args.requirements.length>0 && args.requirements.every(r=>results.some(result=>result.requirement.id===r.id && result.status==='found'));
  // Reading a same-format file alone is never proof that this is the intended assignment.
  const matched=results.some(r=>r.requirement.id===MATCH_REQUIREMENT_ID && r.status==='found');
  return {phase:everyChecked && matched && !unread?'checked':'attention',missing,uncertain,unread,wrongFile:results.some(r=>r.requirement.id===MATCH_REQUIREMENT_ID&&r.status==='not-found')};
}

export function needsSubmitReview(state:CanvasState, report:{assignmentKey:string;revision:number;phase:PrecheckPhase}|null):boolean {
  if(!checksApply(state.assignment) || state.attachmentSource!=='draft')return false;
  return state.coverage!=='complete' || (!state.attachments.length&&!state.submissionText?.trim()) || !report || report.assignmentKey!==state.assignment?.key || report.revision!==state.revision || report.phase!=='checked';
}
