import React, { useEffect, useRef, useState } from 'react';
import type { AssignmentSnapshot, ReadFile } from '../core/types';
import type { Language } from '../core/i18n';
import { EMPTY_GRADING, type GradingHistory, type GradeEvidence, type PregradeReport } from '../core/pregrade';
import { pregradeWithAI } from '../ai/provider';
import { samplePregrade } from '../core/pregrade-demo';
import './pregrade.css';

interface Props {
  assignment:AssignmentSnapshot; files:ReadFile[]; history:GradingHistory;
  scope:{attempt:number|null;submittedAt:string|null;draft:boolean}; scopeLabel:string;
  stamp:string; ready:boolean; available:boolean; aiEnabled:boolean; demo:boolean;
  language:Language; onFile:(id:string)=>void; active:boolean;
}
export function Pregrade(props:Props) {
  const {assignment,files,history,scope,scopeLabel,stamp,ready,available,aiEnabled,demo,language,onFile,active}=props;
  const en=language==='en',say=(english:string,chinese:string)=>en?english:chinese;
  const grading=assignment.grading??EMPTY_GRADING;
  const [report,setReport]=useState<{key:string;value:PregradeReport}|null>(null);
  const [working,setWorking]=useState(false),[error,setError]=useState('');
  const [consent,setConsent]=useState(false);
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  // Keep reports only in memory and bind them to content, rubric, feedback, attempt and language.
  const key=JSON.stringify([stamp,grading,history,scope,language]);
  const result=report?.key===key && ready?report.value:null;
  const stale=Boolean(report && !result);
  useEffect(()=>{generation.current++;request.current?.abort();setWorking(false);setError('');},[key,ready,aiEnabled,available,consent]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  const canRun=ready && files.length>0 && (grading.criteria.length>0 || history.feedback.length>0) && (demo ? assignment.key==='demo:pregrade' && (scope.draft || scope.attempt===2) : aiEnabled && available && consent);
  async function estimate() {
    if (!canRun || working) return;
    request.current?.abort();const controller=new AbortController();request.current=controller;const run=++generation.current;
    setWorking(true);setError('');
    try {
      const value=demo ? samplePregrade(language) : await pregradeWithAI(assignment,grading,history,scope,files,controller.signal,language);
      if(!controller.signal.aborted && generation.current===run) setReport({key,value});
    } catch(e) { if(!controller.signal.aborted && generation.current===run) setError(e instanceof Error?e.message:say('Estimate could not be completed.','估分未完成。')); }
    finally {if(generation.current===run)setWorking(false);}
  }
  const proof=(items:GradeEvidence[])=>items.map((e,i)=><button className="pg-evidence" key={`${e.fileId}:${i}`} onClick={()=>onFile(e.fileId)}><span>{e.fileName}{e.page?` · ${say('Page','页')} ${e.page}`:e.partLabel?` · ${e.partLabel}`:e.line?` · ${say('Line','行')} ${e.line}`:''} ↗</span><q>{e.text}</q></button>);
  const score=(low:number,high:number)=>low===high?String(low):`${low}–${high}`;
  const statuses={resolved:say('Resolved','已修正'),partial:say('Partly resolved','部分修正'),unresolved:say('Still present','仍存在'),unknown:say('Needs review','无法确认')};
  return <section className="pregrade" hidden={!active} aria-label="Pre-grade">
    <div className="pg-intro"><span className="pg-kicker">PRE-GRADE <span>BETA</span></span><h3>{scope.draft?say('Review your work before you submit.','提交前，先看看哪里可能扣分。'):say('Review this submitted attempt.','查看这一次已提交的作业。')}</h3><p>{say('Teacher criteria, earlier feedback, and evidence from this submission.','结合老师标准、历史反馈与本次提交中的证据。')}</p></div>
    {demo && <p className="pg-note">{say('Synthetic demo · The sample report is not an AI assessment.','合成演示 · 示例报告不是 AI 实际评分。')}</p>}
    <details className="pg-sources"><summary>{say('Assessment sources','评分依据')}<span>{grading.criteria.length} {say('criteria','项标准')} · {history.feedback.length} {say(history.feedback.length===1?'comment':'comments','条反馈')}</span></summary>
      <p>{grading.source==='canvas'?say('Canvas rubric','Canvas 评分表'):grading.source==='instructions'?say('Explicit points in assignment instructions','作业正文中的明确分值'):assignment.grading?say('No readable Canvas rubric or explicit point allocation was found.','未找到可读的 Canvas 评分表或明确的分项分值。'):say('Canvas grading information has not been loaded.','Canvas 评分信息尚未载入。')}</p>
      <p className="pg-note">{say('Sources: the rubric attached to this assignment; otherwise clearly stated scoring items and points in its instructions. Earlier grades and feedback come from your submission history for this same assignment. AI does not invent these sources.','来源：当前作业附带的 rubric；没有时，查找作业说明中明确列出的评分项和分值。较早成绩与反馈来自你在同一作业下的提交记录，这些依据不是 AI 自行编造的。')}{!demo && <> <a href={assignment.url} target="_blank" rel="noreferrer">{say('Open assignment in Canvas ↗','在 Canvas 查看作业 ↗')}</a></>}</p>
      {grading.criteria.map(c=><div className="pg-source" key={c.id}><strong>{c.label}{!grading.hidePoints && !c.ignore?` · ${c.points} ${say('points','分')}`:''}</strong><p>{c.description||c.quote}</p>{c.ratings.length>0 && <small>{c.ratings.map(r=>`${grading.hidePoints?'':`${r.points}: `}${r.description}`).join(' · ')}</small>}</div>)}
      {history.grades.map(g=><p key={g.id} className="pg-note">Attempt {g.attempt} · {say('Previous score','历史得分')} {g.score}{g.pointsDeducted?` · ${say('Recorded late/missing deduction','记录的迟交或缺交扣分')} ${g.pointsDeducted}`:''} · {say('Reference only; not a score target.','仅作背景，不作为本次得分目标。')}</p>)}
      {history.feedback.map(f=><blockquote key={f.id}><span>{f.attempt?`Attempt ${f.attempt}`:say('Assignment-level teacher comment','作业层面的老师评语')} · {f.id.startsWith('rubric:')?say('Rubric comment','评分表评语'):say('Submission comment','提交评语')} · <time dateTime={f.createdAt}>{new Date(f.createdAt).toLocaleString(language)}</time></span>{f.text}</blockquote>)}
      <p className="pg-note">{say('Only earlier, identifiable grader feedback from this assignment is included. Other courses, document annotations and unverified authors are not included in this preview.','本预览仅使用同一作业中较早且可确认评分者身份的反馈，暂不包含其他课程、文档批注及身份不明的评论。')}</p>
    </details>
    {!demo && <label className="pg-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>{say('Use the listed earlier grades and teacher comments, current instructions, rubric and selected files with AI for this pre-grade session.','允许本次预评分通过 AI 分析以上历史成绩与老师评语、当前要求、评分表和所选材料。')}</span></label>}
    {!demo && (!aiEnabled || !available) && <p className="pg-note">{!aiEnabled?say('Enable AI analysis above to estimate a grade.','请启用上方 AI 分析以预估分数。'):say('Pre-grade is temporarily unavailable. Reopen the panel to reconnect.','预评分暂时不可用，请重新打开侧栏连接。')}</p>}
    {!ready && <p className="pg-note" role="status">{say('Waiting for a complete attachment list and the current file read.','等待附件清单和本次文件读取完成。')}</p>}
    {!grading.criteria.length && !history.feedback.length && <p className="pg-note">{say('No scoring criteria or eligible earlier feedback were found. An estimate would have no teacher basis.','尚未找到评分标准或可用的较早反馈，暂无法给出有依据的估分。')}</p>}
    <div className="pg-actions"><button type="button" className="primary" disabled={!canRun||working} onClick={()=>void estimate()}>{working?say('Estimating…','正在预评分…'):demo?say('Show sample estimate','查看示例预评分'):say('Estimate grade','开始预评分')}</button>{working && <button onClick={()=>{request.current?.abort();generation.current++;setWorking(false);}}>{say('Cancel','取消')}</button>}<span>{scopeLabel}</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    {stale && <p className="pg-stale" role="status">{say('The submission or assessment context changed. Run a new estimate.','提交内容或评分依据已变化，请重新预评分。')}</p>}
    {result && <div className="pg-report" aria-live="polite">
      <div className="pg-score"><span>{result.total ? result.total.kind==='assignment'?say('Estimated assignment score','作业参考估分'):say('Rubric alignment estimate','评分表参考估分'):say('Partial assessment','部分评估')}</span>{result.total?<strong>{score(result.total.low,result.total.high)}<small> / {result.total.max}</small></strong>:<strong className="pg-no-total">{say('Overall score unavailable','暂不汇总总分')}</strong>}<p>{grading.hidePoints?say('This rubric hides point totals.','此评分表隐藏分值。'):`${result.assessedPoints} / ${result.possiblePoints} ${say('points assessed','分已评估')}`}</p><small>{say('An estimate, not an official grade. Late penalties are not included.','仅供参考，不是正式成绩，不计迟交扣分。')}</small></div>
      {result.criteria.some(c=>c.suggestion) && <div className="pg-priorities"><h4>{say('Where to focus','优先改进')}</h4><ol>{result.criteria.filter(c=>c.suggestion).slice(0,3).map(c=><li key={c.criterionId}>{c.suggestion}</li>)}</ol></div>}
      {result.feedback.length>0 && <div className="pg-feedback"><h4>{say('Earlier feedback, revisited','历史反馈修正情况')}</h4>{result.feedback.map((f,i)=><details key={f.feedbackId} open={i===0}><summary><span>{say('Teacher feedback','老师反馈')}</span><span className={`pg-status ${f.status}`}>{statuses[f.status]}</span></summary><blockquote>{history.feedback.find(x=>x.id===f.feedbackId)?.text}</blockquote><p>{f.reason}</p>{proof(f.evidence)}</details>)}</div>}
      <div className="pg-criteria"><h4>{say('Criterion breakdown','逐项分析')}</h4>{result.criteria.map(c=>{const standard=grading.criteria.find(r=>r.id===c.criterionId)!;return <details key={c.criterionId}><summary><span>{standard.label}</span><strong>{c.low===null||c.high===null?say('Needs review','待确认'):`${score(c.low,c.high)} / ${standard.points}`}</strong></summary><p>{c.reason}</p><blockquote>{standard.description||standard.label}</blockquote>{proof(c.evidence)}{c.historyIds.filter(id=>history.feedback.some(f=>f.id===id)).map(id=><blockquote key={id}><span>{say('Earlier teacher feedback used','引用历史老师反馈')}</span>{history.feedback.find(f=>f.id===id)?.text}</blockquote>)}</details>;})}</div>
      {result.notices.map((note,i)=><p className="pg-note" key={i}>{note}</p>)}
    </div>}
  </section>;
}
