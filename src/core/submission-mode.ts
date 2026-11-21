import type { AssignmentSnapshot } from './types';
export function submissionMode(types: unknown): NonNullable<AssignmentSnapshot['submissionMode']> {
  if (!Array.isArray(types) || !types.every(type => typeof type === 'string') || !types.length) return 'unknown';
  const upload = types.includes('online_upload'), text = types.includes('online_text_entry');
  if (upload && text) return 'mixed';
  if (upload) return 'upload';
  if (text) return 'text';
  if (types.includes('online_quiz')) return 'quiz';
  if (types.includes('external_tool') || types.includes('online_url') || types.includes('media_recording') || types.includes('student_annotation') || types.includes('discussion_topic')) return 'external';
  if (types.includes('on_paper')) return 'offline';
  return types.every(type => type === 'none' || type === 'not_graded') ? 'none' : 'unknown';
}
export function checksApply(assignment: AssignmentSnapshot | null): boolean { return Boolean(assignment && !['none','quiz','offline','external','unknown'].includes(assignment.submissionMode ?? 'upload')); }
