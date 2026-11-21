export interface AssignmentSnapshot {
  key: string;
  title: string;
  url: string;
  description: string;
  paragraphs: string[];
  permittedExtensions: string[];
  attempt: string;
  source: 'canvas' | 'demo';
  capturedAt: number;
  submissionMode?: 'upload' | 'text' | 'mixed' | 'quiz' | 'offline' | 'external' | 'none' | 'unknown';
  submissionTypes?: string[];
  grading?: import('./pregrade').GradingBasis;
}

export type RequirementKind = 'file' | 'java-for' | 'java-variable' | 'semantic';
export interface Requirement {
  id: string;
  label: string;
  kind: RequirementKind;
  quote: string;
  extensions?: string[];
  variable?: string;
  conditional?: boolean;
  artifact?: 'image' | 'text' | 'any';
}

export interface JavaLocation { line: number; text: string }
export interface JavaAnalysis {
  parsed: boolean;
  error?: string;
  forLoops: JavaLocation[];
  variables: Record<string, JavaLocation[]>;
  comments: JavaLocation[];
}

export interface ReadFile {
  id: string;
  name: string;
  size: number;
  extension: string;
  detectedFormat?: string;
  kind: 'java' | 'pdf' | 'image' | 'text' | 'document' | 'presentation' | 'spreadsheet' | 'unknown';
  state: 'ready' | 'unreadable' | 'unsupported';
  text?: string;
  pages?: { page: number; text: string }[];
  parts?: ContentPart[];
  totalParts?: number;
  java?: JavaAnalysis;
  preview?: string;
  width?: number;
  height?: number;
  note?: string;
  origin?: 'canvas-text' | 'canvas-inline';
}
export interface ContentPart { id: string; label: string; page?: number; text?: string; image?: string; complete: boolean }

export type ResultStatus = 'found' | 'not-found' | 'confirm' | 'uncheckable';
export interface CheckResult {
  requirement: Requirement;
  status: ResultStatus;
  detail: string;
  evidence: { fileId: string; fileName: string; line?: number; page?: number; partId?: string; partLabel?: string; text: string }[];
}

export interface CanvasAttachment {
  id: string;
  name: string;
  size: number | null;
  origin?: 'canvas-inline';
}

export interface SubmissionAttempt {
  attempt: number;
  submittedAt: string | null;
  attachments: CanvasAttachment[];
  submissionText?: string;
  textIncomplete?: boolean;
}

export interface CanvasState {
  gradingHistory?: import('./pregrade').GradingHistory;
  protocolVersion?: number;
  assignment: AssignmentSnapshot | null;
  revision: number;
  attachmentSource?: 'draft' | 'submitted';
  attachments: CanvasAttachment[];
  coverage: 'complete' | 'pending' | 'unavailable';
  warning: string;
  history?: SubmissionAttempt[];
  historyStatus?: 'loading' | 'ready' | 'unavailable';
  historyWarning?: string;
  submissionText?: string;
  textIncomplete?: boolean;
}

export const LIMITS = { files: 10, bytes: 20 * 1024 * 1024, pdfPages: 20, aiImages: 24, aiImageCharacters: 8000000 };
