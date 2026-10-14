import { describe, it, expect } from 'vitest';
import { submissionAlert } from '@/lib/verification/owner-alert';
import type { VerificationMetadata } from '@/lib/metadata/verification';

const blank = { dateTaken: null, gps: null, device: null, software: null, imageWidth: null, imageHeight: null };
const metadata: VerificationMetadata = {
  id_front: blank, id_back: blank, selfie: blank,
  face_match: { match: true, confidence: 0.93, reasoning: 'same jawline', checked_at: '2026-10-14T08:00:00Z' },
  id_document: {
    document_type: 'smart_id_card', readable: true, id_number_masked: '800101****087', id_number_valid: true,
    dob_matches_id_number: true, expired: false, surname: 'DOE', names: 'JANE', date_of_birth: '1980-01-01',
    expiry_date: null, confidence: 0.9, checked_at: '2026-10-14T08:00:00Z',
  } as never,
};

describe('owner email when someone submits an ID check', () => {
  it('says who, what the checks found and where to review', () => {
    const a = submissionAlert({ name: 'Jane', email: 'jane@example.com', attempt: 1, flags: [], metadata });
    expect(a.subject).toBe('[ID check] Jane submitted');
    expect(a.text).toContain('Jane (jane@example.com)');
    expect(a.text).toContain('smart ID card');
    expect(a.text).toContain('ID number: valid');
    expect(a.text).toContain('same person (93% sure)');
    expect(a.text).toContain('/admin/verifications');
  });

  it('never carries the ID number, names or birth date from the document', () => {
    const a = submissionAlert({ name: 'Jane', email: 'jane@example.com', attempt: 1, flags: [], metadata });
    for (const secret of ['800101', '****087', 'DOE', '1980-01-01']) expect(a.text).not.toContain(secret);
  });

  it('puts high warnings in the subject and lists every warning', () => {
    const a = submissionAlert({
      name: null, email: 'x@example.com', attempt: 2,
      flags: [
        { severity: 'high', code: 'FACE_MISMATCH', message: 'Selfie and ID appear to be different people' },
        { severity: 'low', code: 'TIME_MISMATCH', message: 'ID and selfie taken 30 minutes apart' },
      ],
      metadata: { ...metadata, id_document: null, face_match: null },
    });
    expect(a.subject).toBe('[ID check] x@example.com submitted, 1 warning');
    expect(a.text).toContain('(attempt 2)');
    expect(a.text).toContain('[high] Selfie and ID appear to be different people');
    expect(a.text).toContain('the AI could not read it');
    expect(a.text).toContain('Face match: did not run');
  });
});
