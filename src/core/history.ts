import type { CanvasAttachment, SubmissionAttempt } from './types';
import { submissionHTMLText,inlineCanvasImages } from './submission-text';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue => v !== null && typeof v === 'object' ? v as RecordValue : {};

/** Deliberately keep only submission dates, attempt numbers, and attachment metadata. */
export function parseSubmissionHistory(value: unknown, origin = 'https://canvas.invalid'): SubmissionAttempt[] {
  const root = record(value);
  const entries = [...(Array.isArray(root.submission_history) ? root.submission_history : []), root];
  const attempts = new Map<number, SubmissionAttempt>();
  for (const entry of entries) {
    const row = record(entry);
    const textEntry = row.submission_type === 'online_text_entry' && typeof row.body === 'string';
    if (!Number.isSafeInteger(row.attempt) || Number(row.attempt) < 1 || (!Array.isArray(row.attachments) && !textEntry)) continue;
    const attachments: CanvasAttachment[] = [];
    let valid = true;
    for (const raw of Array.isArray(row.attachments) ? row.attachments : []) {
      const file = record(raw), id = String(file.id ?? '');
      const name = typeof file.display_name === 'string' ? file.display_name : typeof file.filename === 'string' ? file.filename : '';
      if (!/^\d+$/.test(id) || !name || attachments.some(f => f.id === id)) { valid = false; break; }
      attachments.push({ id, name, size: Number.isSafeInteger(file.size) && Number(file.size) >= 0 ? Number(file.size) : null });
    }
    const inline = textEntry ? inlineCanvasImages(row.body as string,origin) : {images:[],incomplete:false};
    for(const image of inline.images) if(!attachments.some(file=>file.id===image.id)) attachments.push(image);
    if (valid) attempts.set(Number(row.attempt), { attempt: Number(row.attempt), submittedAt: typeof row.submitted_at === 'string' ? row.submitted_at : null, attachments, ...(textEntry ? { submissionText:submissionHTMLText(row.body as string),...(inline.incomplete?{textIncomplete:true}:{}) } : {}) });
  }
  return [...attempts.values()].sort((a, b) => b.attempt - a.attempt);
}

export function previousFileOccurrences(history: SubmissionAttempt[], extensions: string[], selectedAttempt?: number) {
  return history.filter(item => item.attempt !== selectedAttempt).flatMap(item => {
    const names = item.attachments.filter(f => extensions.includes(f.name.split('.').pop()?.toLowerCase() ?? '')).map(f => f.name);
    return names.length ? [{ attempt: item.attempt, names }] : [];
  });
}
