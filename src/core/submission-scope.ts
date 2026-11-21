import type { AssignmentSnapshot, CanvasState, SubmissionAttempt } from './types';
import type { scanSubmissionText } from './submission-text';
import { checksApply } from './submission-mode';
type Listing = Pick<CanvasState, 'attachments' | 'coverage' | 'warning' | 'attachmentSource'>;
/** A draft never inherits the body or inline images of a submitted attempt. */
export function resolveSubmissionScope(assignment: AssignmentSnapshot | null, listing: Listing, draft: ReturnType<typeof scanSubmissionText>, submitted?: SubmissionAttempt): Listing & Pick<CanvasState, 'submissionText' | 'textIncomplete'> {
  if (!checksApply(assignment)) return {attachments:[],coverage:'complete',warning:'',attachmentSource:'submitted'};
  if (draft) {
    const uploading = listing.attachmentSource === 'draft' && assignment?.submissionMode === 'mixed';
    const attachments = uploading ? [...listing.attachments] : [];
    for (const image of draft.images) if (!attachments.some(file => file.id === image.id)) attachments.push(image);
    return {...listing, attachments, coverage:uploading ? listing.coverage : 'complete', warning:uploading ? listing.warning : '', attachmentSource:'draft',submissionText:draft.text,textIncomplete:draft.incomplete};
  }
  if (listing.attachmentSource !== 'draft' && ['text','mixed'].includes(assignment?.submissionMode ?? '') && submitted?.submissionText !== undefined) {
    return {attachments:submitted.attachments,coverage:'complete',warning:'',attachmentSource:'submitted',submissionText:submitted.submissionText,textIncomplete:submitted.textIncomplete};
  }
  return listing;
}
