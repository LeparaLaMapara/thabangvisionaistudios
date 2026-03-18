import type { VerificationMetadata } from './verification';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FraudFlag {
  severity: 'low' | 'medium' | 'high';
  code: string;
  message: string;
}

// ─── Fraud Detection ────────────────────────────────────────────────────────

export function detectFraudFlags(metadata: VerificationMetadata): FraudFlag[] {
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
  if (selfie.gps) {
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

  return flags;
}
