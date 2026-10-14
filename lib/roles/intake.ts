import type { ProofFormat } from './types';

/**
 * "Show us your work": one box takes anything. Pure.
 *
 * The browser sorts what was added by type; the role decides what proof it
 * becomes: photos and clips are work (Look, or Thing for gear and vehicles),
 * audio is Listen for listen roles and a voice note (facts) for everyone else,
 * a PDF, Word file or a photo of a CV becomes facts.
 */

export type IntakeKind = 'photo' | 'video' | 'audio' | 'cv' | 'unknown';

const CV_EXT = /\.(pdf|docx?|rtf|odt)$/i;

export function classifyIntakeFile(mime: string, name: string): IntakeKind {
  const m = (mime || '').toLowerCase();
  if (m === 'application/pdf' || m.includes('word') || m.includes('officedocument') || CV_EXT.test(name)) return 'cv';
  if (m.startsWith('image/')) return 'photo';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'unknown';
}

/** A photo whose name says it is a CV ("cv.jpg", "my resume.png") is read as a CV. */
export function photoLooksLikeCv(name: string): boolean {
  return /\b(cv|resume|résumé|curriculum)\b/i.test(name.replace(/[_.-]/g, ' '));
}

/** What an audio file becomes once the role is known. */
export function audioBecomes(format: ProofFormat): 'listen' | 'voice' {
  return format === 'listen' ? 'listen' : 'voice';
}

/** The one extra photo the law needs, asked inline on screen 2, only for these roles. */
export interface InlineLegalAsk {
  code: string;
  label: string;
}

export function inlineLegalAsks(legal: readonly { code: string; label: string; required: boolean; basis: string; when?: string }[], roleSlug: string): InlineLegalAsk[] {
  const asks: InlineLegalAsk[] = legal
    // The law's documents for this work; of the "only if" ones, the PrDP is
    // asked (drivers on ThabangVision carry crew), the rest stay with review.
    .filter((r) => r.required && r.basis === 'law' && !r.code.startsWith('age_') && (!r.when || r.code === 'prdp'))
    .map((r) => ({ code: r.code, label: r.label }));
  if (roleSlug === 'model') asks.push({ code: 'age_18', label: 'A photo of your ID (to confirm you are 18 or older)' });
  return asks;
}

export interface FinishInput {
  hasFace: boolean;
  roleLive: boolean;
  proofFormat: ProofFormat;
  workCount: number;
  listenCount: number;
  factsCount: number;
  missingLegal: number;
  priceCents: number | null;
}

/** What is left before "Done", in plain words. Empty: ready. */
export function finishTodo(i: FinishInput): string[] {
  const todo: string[] = [];
  if (!i.hasFace) todo.push('your photo');
  if (!i.roleLive) todo.push('this kind of work opens soon');
  const hasProof =
    i.proofFormat === 'listen' ? i.listenCount > 0 : i.proofFormat === 'trust' ? i.factsCount > 0 || i.workCount > 0 : i.workCount > 0;
  if (!hasProof) todo.push(i.proofFormat === 'listen' ? 'a sound clip' : i.proofFormat === 'trust' ? 'a few words about your work, or your CV' : 'photos or a clip of your work');
  if (i.missingLegal > 0) todo.push('the photo the law needs for this work');
  if (i.priceCents === null || i.priceCents <= 0) todo.push('your price');
  return todo;
}
