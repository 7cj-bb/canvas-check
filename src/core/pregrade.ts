import type { AssignmentSnapshot, CheckResult, SubmissionAttempt } from './types';

export interface GradeCriterion {
  id: string; label: string; description: string; points: number;
  ratings: { id: string; points: number; description: string }[];
  useRange: boolean; ignore: boolean; quote?: string;
}
export interface GradingBasis {
  source: 'canvas' | 'instructions' | 'none'; title: string;
  assignmentPoints: number | null; useForGrading: boolean | null; hidePoints: boolean;
  criteria: GradeCriterion[];
}
export interface TeacherFeedback {
  id: string; text: string; createdAt: string; attempt: number | null; criterionId?: string;
}
export interface PriorGrade {
  id: string; attempt: number | null; score: number; gradedAt: string; pointsDeducted: number | null;
}
export interface GradingHistory {
  feedback: TeacherFeedback[]; grades: PriorGrade[]; excludedComments: number;
}
export type GradeEvidence = CheckResult['evidence'][number];
export interface CriterionEstimate {
  criterionId: string; low: number | null; high: number | null;
  reason: string; suggestion: string; evidence: GradeEvidence[]; historyIds: string[];
}
export interface FeedbackReview {
  feedbackId: string; status: 'resolved' | 'partial' | 'unresolved' | 'unknown';
  reason: string; evidence: GradeEvidence[];
}
export interface PregradeReport {
  criteria: CriterionEstimate[]; feedback: FeedbackReview[]; notices: string[];
  total: { low: number; high: number; max: number; kind: 'assignment' | 'rubric' } | null;
  assessedPoints: number; possiblePoints: number; complete: boolean;
}
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const str = (v: unknown, max = 4000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const points = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10000 ? v : null;
const stamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : '';
export const EMPTY_GRADING: GradingBasis = { source: 'none', title: '', assignmentPoints: null, useForGrading: null, hidePoints: false, criteria: [] };
export const EMPTY_HISTORY: GradingHistory = { feedback: [], grades: [], excludedComments: 0 };

/** Only explicit, standalone points lines qualify. A rubric's presence prevents prose from replacing it. */
export function instructionCriteria(description: string): GradeCriterion[] {
  const result: GradeCriterion[] = [];
  for (const line of description.split(/\r?\n/).map(s => s.trim())) {
    const match = /^(.{3,160}?)(?:\s*[:：—–-]\s*|\s*\(\s*)(\d+(?:\.\d+)?)\s*(?:points?|pts?|分)\s*\)?\s*$/i.exec(line);
    if (!match || /^(?:total|maximum|满分|总分)\b/i.test(match[1]) || /\b(?:deduct|penalty|bonus|optional)\b|扣|加分|可选/i.test(line)) continue;
    const value = points(Number(match[2])); if (value === null || value === 0) continue;
    result.push({ id: `instruction:${result.length}`, label: match[1], description: match[1], points: value, ratings: [], useRange: true, ignore: false, quote: line });
  }
  return result.length >= 2 && result.length <= 20 ? result : [];
}

export function readGradingBasis(value: unknown, description = ''): GradingBasis {
  const raw = row(value), settings = row(raw.rubric_settings);
  const base: GradingBasis = { ...EMPTY_GRADING, assignmentPoints: points(raw.points_possible), title: str(settings.title, 200),
    useForGrading: typeof raw.use_rubric_for_grading === 'boolean' ? raw.use_rubric_for_grading : null,
    hidePoints: settings.hide_points === true || settings.hide_score_total === true, criteria: [] };
  if (Array.isArray(raw.rubric) && raw.rubric.length) {
    base.source = 'canvas';
    if (raw.rubric.length > 20) return base;
    const ids = new Set<string>();
    for (const item of raw.rubric) {
      const c = row(item), id = str(String(c.id ?? ''), 100), max = points(c.points);
      if (!id || ids.has(id) || max === null || !str(c.description)) return { ...base, criteria: [] };
      ids.add(id);
      const ratings = (Array.isArray(c.ratings) ? c.ratings : []).slice(0, 20).flatMap(item => {
        const r = row(item), score = points(r.points);
        return score !== null && score <= max ? [{ id: str(String(r.id ?? score), 100), points: score, description: [str(r.description), str(r.long_description)].filter(Boolean).join('\n') }] : [];
      });
      base.criteria.push({ id, label: str(c.description, 300), description: str(c.long_description), points: max,
        ratings, useRange: c.criterion_use_range === true || settings.free_form_criterion_comments === true || !ratings.length, ignore: c.ignore_for_scoring === true });
    }
    return base;
  }
  const criteria = instructionCriteria(description);
  return criteria.length ? { ...base, source: 'instructions', title: 'Scoring instructions', criteria, useForGrading: base.assignmentPoints !== null && Math.abs(criteria.reduce((s,c)=>s+c.points,0)-base.assignmentPoints)<0.001 ? true : null } : base;
}

/** Never attribute a stale grade to a newer attempt, or treat a student's comment as teacher feedback. */
export function readGradingHistory(value: unknown): GradingHistory {
  const root = row(value), prior = Array.isArray(root.submission_history) ? root.submission_history.map(row) : [];
  const rows = [...prior, root], graders = new Set(rows.map(r=>r.grader_id).filter(id=>typeof id==='number' && id>0));
  const grades = new Map<string, PriorGrade>(), feedback = new Map<string, TeacherFeedback>();
  let excludedComments = 0;
  for (const r of rows) {
    const submitted = stamp(r.submitted_at), graded = stamp(r.graded_at), score = points(r.score);
    const attempt = Number.isSafeInteger(r.attempt) && Number(r.attempt)>0 ? Number(r.attempt) : null;
    const matched = attempt !== null && r.grade_matches_current_submission !== false && submitted && graded && Date.parse(graded)>=Date.parse(submitted);
    if (score !== null && graded && r.excused !== true && r.posted_at !== null) {
      const id = `grade:${graded}:${score}`;
      const candidate = { id, attempt: matched ? attempt : null, score, gradedAt: graded, pointsDeducted: points(r.points_deducted) };
      if (!grades.has(id) || candidate.attempt !== null) grades.set(id, candidate);
    }
    for (const item of Array.isArray(r.submission_comments) ? r.submission_comments : []) {
      const c = row(item), id = str(String(c.id ?? ''), 100), text = str(c.comment), createdAt = stamp(c.created_at);
      if (!id || !text || !createdAt || c.author_id === root.user_id || !graders.has(c.author_id)) { excludedComments++; continue; }
      // Most Canvas comments are assignment-level. A timestamp alone is not an attempt identifier.
      const linked = Number.isSafeInteger(c.attempt) && Number(c.attempt)>0 ? Number(c.attempt) : null;
      feedback.set(`comment:${id}`, { id: `comment:${id}`, text, createdAt, attempt: linked });
    }
    if (matched && graders.has(r.grader_id) && r.posted_at !== null) for (const [criterionId, item] of Object.entries(row(r.rubric_assessment))) {
      const text = str(row(item).comments); if (!text) continue;
      const id = `rubric:${attempt}:${criterionId}`;
      feedback.set(id, { id, text, createdAt: graded, attempt, criterionId });
    }
  }
  return { grades: [...grades.values()].sort((a,b)=>Date.parse(b.gradedAt)-Date.parse(a.gradedAt)).slice(0,10),
    feedback: [...feedback.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,12), excludedComments };
}

/** Historical previews use only information available before that submission. Drafts may use latest prior feedback. */
export function historyBeforeSubmission(history: GradingHistory | undefined, scope: { attempt: number | null; submittedAt: string | null; draft: boolean }): GradingHistory {
  if (!history) return EMPTY_HISTORY;
  const cutoff = scope.draft ? Date.now() : scope.submittedAt ? Date.parse(scope.submittedAt) : NaN;
  const earlier = (at: string, attempt: number | null) => (scope.draft || scope.attempt === null || attempt === null || attempt < scope.attempt) && (Number.isFinite(cutoff) ? Date.parse(at) < cutoff : attempt!==null && scope.attempt!==null && attempt<scope.attempt);
  return { feedback: history.feedback.filter(f=>earlier(f.createdAt,f.attempt)).slice(0,8), grades: history.grades.filter(g=>g.attempt!==null && earlier(g.gradedAt,g.attempt)).slice(0,5), excludedComments: history.excludedComments };
}

export function selectedGradeScope(assignment: AssignmentSnapshot, history: SubmissionAttempt[], selected: number | null, draft: boolean) {
  const attempt = selected ?? (Number(assignment.attempt.match(/\d+/)?.[0]) || null);
  return { attempt, submittedAt: history.find(h=>h.attempt===attempt)?.submittedAt ?? null, draft: selected===null && draft };
}
