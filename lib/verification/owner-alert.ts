import { STUDIO } from '@/lib/constants';
import type { FraudFlag } from '@/lib/metadata/fraud-detection';
import type { VerificationMetadata } from '@/lib/metadata/verification';

/**
 * The email the owner gets the moment someone submits an ID check. It says who,
 * what the automatic checks found and where to review. It never carries the
 * photos or the ID number: ID details stay in the private bucket (POPIA).
 */
const DOCUMENT_WORDS: Record<string, string> = {
  smart_id_card: 'smart ID card',
  green_id_book: 'green ID book',
  passport: 'passport',
  drivers_licence: "driver's licence",
  other_id: 'another ID document',
  not_an_id: 'NOT an ID document',
};

export interface SubmissionAlertInput {
  name: string | null;
  email: string | null;
  attempt: number;
  flags: FraudFlag[];
  metadata: VerificationMetadata;
}

export function submissionAlert(input: SubmissionAlertInput): { subject: string; text: string } {
  const who = input.name?.trim() || input.email || 'Someone';
  const high = input.flags.filter((f) => f.severity === 'high').length;
  const doc = input.metadata.id_document;
  const face = input.metadata.face_match;

  const checks: string[] = [];
  if (doc) {
    checks.push(`Document: ${DOCUMENT_WORDS[doc.document_type] ?? doc.document_type}${doc.readable === false ? ' (hard to read)' : ''}`);
    if (doc.id_number_valid !== null) checks.push(`ID number: ${doc.id_number_valid ? 'valid' : 'NOT valid'}`);
    if (doc.expired) checks.push('Document: EXPIRED');
  } else {
    checks.push('Document: the AI could not read it');
  }
  checks.push(
    face
      ? `Face match: ${face.match ? 'same person' : 'DIFFERENT people'} (${Math.round(face.confidence * 100)}% sure)`
      : 'Face match: did not run',
  );

  const subject = `[ID check] ${who} submitted${high ? `, ${high} warning${high === 1 ? '' : 's'}` : ''}`;
  const text = [
    `${who}${input.email && input.name ? ` (${input.email})` : ''} sent their ID photo and selfie for checking${input.attempt > 1 ? ` (attempt ${input.attempt})` : ''}.`,
    '',
    'Automatic checks:',
    ...checks.map((c) => `- ${c}`),
    '',
    input.flags.length
      ? ['Warnings:', ...input.flags.map((f) => `- [${f.severity}] ${f.message}`)].join('\n')
      : 'Warnings: none.',
    '',
    `Review and approve: ${STUDIO.meta.url}/admin/verifications`,
    `They were told: a person checks it ${STUDIO.verification.reviewTime}.`,
  ].join('\n');
  return { subject, text };
}
