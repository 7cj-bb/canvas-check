import type { AssignmentSnapshot, CheckResult, Requirement } from '../core/types';
import type { Language } from '../core/i18n';
import type { AIFile, AISummary } from './contracts';
import { contentKey, RequestCache } from './cache';

export type AITransport = <T>(endpoint: string, data: unknown, signal: AbortSignal) => Promise<T>;
export const summaryKey = (assignment: AssignmentSnapshot, language: Language) =>
  JSON.stringify([assignment.key, assignment.title, assignment.description, assignment.submissionMode, language]);

/** Identity, actual content and language determine reuse; UI mode and poll revisions do not. */
export function createAIClient(post: AITransport) {
  const summaries = new RequestCache<AISummary>(24), evidence = new RequestCache<CheckResult[]>(16);
  return {
    peekSummary: (assignment: AssignmentSnapshot, language: Language) => summaries.peek(summaryKey(assignment, language)),
    summarize(assignment: AssignmentSnapshot, signal: AbortSignal, language: Language) {
      return summaries.get(summaryKey(assignment, language), shared =>
        post<AISummary>('/api/summary', {task:{title:assignment.title, description:assignment.description}, language}, shared), signal);
    },
    async locate(assignment: AssignmentSnapshot, requirements: Requirement[], files: AIFile[], scope: string, signal: AbortSignal, language: Language) {
      signal.throwIfAborted();
      const data = {task:{title:assignment.title, description:assignment.description}, requirements:requirements.filter(r=>r.kind==='semantic'), files, language};
      const key = await contentKey([assignment.key, assignment.submissionMode, scope, data]);
      signal.throwIfAborted();
      return evidence.get(key, async shared => (await post<{results:CheckResult[]}>('/api/evidence', data, shared)).results, signal);
    }
  };
}
