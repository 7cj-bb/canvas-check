import type { CheckResult, Requirement, ContentPart } from '../core/types';
export interface AISummary { objective: string; constraints: string[]; requirements: Requirement[] }
export interface AIFile { id: string; name: string; kind: string; complete: boolean; text?: string; image?: string; parts?: ContentPart[]; totalParts?: number }
export interface AIStatus { configured: boolean; model: string; mode?: 'cloud' | 'development'; features?: { pregrade?: number } }
export interface AIEvidenceResult { results: CheckResult[] }
