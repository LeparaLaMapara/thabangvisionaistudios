import type { VerificationMetadata } from './verification';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FraudFlag {
  severity: 'low' | 'medium' | 'high';
  code: string;
  message: string;
}

export interface FaceMatchInput {
  match: boolean;
  confidence: number;
  reasoning?: string;
}

// Confidence below this threshold on the selfie↔ID face match raises a flag.
const FACE_MATCH_CONFIDENCE_THRESHOLD = 0.9;

// ─── Fraud Detection ────────────────────────────────────────────────────────

export function detectFraudFlags(
  metadata: VerificationMetadata,
  faceMatch?: FaceMatchInput | null,
): FraudFlag[] {
  const flags: FraudFlag[] = [];
  const { id_front, id_back, selfie } = metadata;

  // 1. No EXIF at all on selfie = likely screenshot or edited
  if (!selfie.dateTaken && !selfie.device) {
    flags.push({
      severity: 'high',
      code: 'NO_EXIF_SELFIE',
      message: 'Selfie has no EXIF data — possible screenshot or edited image',
    });
  }

  // 2. Selfie older than 24 hours
  if (selfie.dateTaken) {
    const age = Date.now() - new Date(selfie.dateTaken).getTime();
    if (age > 24 * 60 * 60 * 1000) {
      flags.push({
        severity: 'medium',
        code: 'SELFIE_OLD',
        message: `Selfie taken ${Math.round(age / (60 * 60 * 1000))} hours ago`,
      });
    }
  }

  // 3. Different devices for selfie and ID
  if (selfie.device && id_front.device && selfie.device !== id_front.device) {
    flags.push({
      severity: 'medium',
      code: 'DIFFERENT_DEVICES',
      message: `Selfie: ${selfie.device}, ID: ${id_front.device}`,
    });
  }

  // 4. GPS outside South Africa
  if (selfie.gps && Number.isFinite(selfie.gps.latitude) && Number.isFinite(selfie.gps.longitude)) {
    const { latitude, longitude } = selfie.gps;
    const inSA =
      latitude >= -35 && latitude <= -22 && longitude >= 16 && longitude <= 33;
    if (!inSA) {
      flags.push({
        severity: 'high',
        code: 'GPS_OUTSIDE_SA',
        message: `Location: ${latitude.toFixed(2)}, ${longitude.toFixed(2)} — outside South Africa`,
      });
    }
  }

  // 5. Editing software detected
  if (
    selfie.software &&
    /photoshop|gimp|canva|picsart|snapseed/i.test(selfie.software)
  ) {
    flags.push({
      severity: 'high',
      code: 'EDITING_SOFTWARE',
      message: `Selfie processed with: ${selfie.software}`,
    });
  }

  // 6. ID photos taken at very different times (more than 10 minutes apart)
  if (id_front.dateTaken && selfie.dateTaken) {
    const diff = Math.abs(
      new Date(selfie.dateTaken).getTime() -
        new Date(id_front.dateTaken).getTime(),
    );
    if (diff > 10 * 60 * 1000) {
      flags.push({
        severity: 'low',
        code: 'TIME_MISMATCH',
        message: `ID and selfie taken ${Math.round(diff / 60000)} minutes apart`,
      });
    }
  }

  // 7. No EXIF on any photo
  if (
    !id_front.dateTaken &&
    !id_front.device &&
    !id_back.dateTaken &&
    !id_back.device &&
    !selfie.dateTaken &&
    !selfie.device
  ) {
    flags.push({
      severity: 'high',
      code: 'NO_EXIF_ALL',
      message:
        'No EXIF metadata on any photo — all may be screenshots or downloads',
    });
  }

  // 8. Low face-match confidence (selfie vs. ID photo)
  if (faceMatch) {
    if (!faceMatch.match) {
      flags.push({
        severity: 'high',
        code: 'FACE_MISMATCH',
        message: faceMatch.reasoning
          ? `Selfie and ID appear to be different people — ${faceMatch.reasoning}`
          : 'Selfie and ID appear to be different people',
      });
    } else if (faceMatch.confidence < FACE_MATCH_CONFIDENCE_THRESHOLD) {
      flags.push({
        severity: 'medium',
        code: 'LOW_FACE_MATCH',
        message: `Face-match confidence only ${(faceMatch.confidence * 100).toFixed(0)}% (threshold ${FACE_MATCH_CONFIDENCE_THRESHOLD * 100}%)`,
      });
    }
  }

  // 9. What the vision model read from the ID document
  const doc = metadata.id_document;
  if (doc) {
    if (doc.document_type === 'not_an_id') {
      flags.push({ severity: 'high', code: 'NOT_AN_ID', message: 'The ID photo does not show an identity document' });
    } else if (!doc.readable) {
      flags.push({ severity: 'medium', code: 'ID_UNREADABLE', message: 'The ID photo is not sharp enough to read' });
    }
    if (doc.id_number_valid === false) {
      flags.push({
        severity: 'high',
        code: 'ID_NUMBER_INVALID',
        message: `ID number ${doc.id_number_masked} fails the SA ID check digit (misread or fake)`,
      });
    }
    if (doc.dob_matches_id_number === false) {
      flags.push({
        severity: 'medium',
        code: 'ID_DOB_MISMATCH',
        message: `Birth date printed (${doc.date_of_birth}) differs from the one in the ID number`,
      });
    }
    if (doc.expired) {
      flags.push({ severity: 'medium', code: 'ID_EXPIRED', message: `The document expired on ${doc.expiry_date}` });
    }
  }

  return flags;
}
