import { describe, it, expect } from 'vitest';
import { detectFraudFlags } from '@/lib/metadata/fraud-detection';
import type { VerificationMetadata } from '@/lib/metadata/verification';

const EMPTY_PHOTO = {
  dateTaken: '2026-04-20T10:00:00Z',
  gps: { latitude: -26.2, longitude: 28.04 },
  device: 'iPhone 13',
  software: null,
  imageWidth: 3024,
  imageHeight: 4032,
};

function baseMetadata(): VerificationMetadata {
  return {
    id_front: { ...EMPTY_PHOTO },
    id_back: { ...EMPTY_PHOTO },
    selfie: { ...EMPTY_PHOTO },
    face_match: null,
  };
}

describe('detectFraudFlags — face match', () => {
  it('emits no face-match flag when confidence is high', () => {
    const flags = detectFraudFlags(baseMetadata(), {
      match: true,
      confidence: 0.95,
      reasoning: 'Clear match',
    });
    expect(flags.find((f) => f.code === 'LOW_FACE_MATCH')).toBeUndefined();
    expect(flags.find((f) => f.code === 'FACE_MISMATCH')).toBeUndefined();
  });

  it('emits LOW_FACE_MATCH at medium severity when confidence is below threshold', () => {
    const flags = detectFraudFlags(baseMetadata(), {
      match: true,
      confidence: 0.8,
      reasoning: 'Hard to tell',
    });
    const flag = flags.find((f) => f.code === 'LOW_FACE_MATCH');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('medium');
  });

  it('emits FACE_MISMATCH at high severity when match is false', () => {
    const flags = detectFraudFlags(baseMetadata(), {
      match: false,
      confidence: 0.92,
      reasoning: 'Different jawline and eye spacing',
    });
    const flag = flags.find((f) => f.code === 'FACE_MISMATCH');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('high');
    expect(flag?.message).toContain('Different jawline');
  });

  it('does not emit face-match flags when face_match is not provided', () => {
    const flags = detectFraudFlags(baseMetadata());
    expect(flags.find((f) => f.code === 'LOW_FACE_MATCH')).toBeUndefined();
    expect(flags.find((f) => f.code === 'FACE_MISMATCH')).toBeUndefined();
  });
});
