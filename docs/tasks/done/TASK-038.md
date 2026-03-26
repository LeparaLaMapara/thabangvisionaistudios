# TASK-038: Verification Redesign — Selfie + ID with EXIF Fraud Detection
## Priority: HIGH | Phase: V3 | Depends on: TASK-036 (auth fixes), avatar upload working
## Created: 2026-03-18

---

## Pre-Session Setup

```
/new-session
```
Branch name: `feature/task-038-verification-redesign`

Read these files first:
```
Read CLAUDE.md
Read MEMORY.md
Read lib/constants.ts
Read app/(platform)/dashboard/verification/page.tsx
Read app/api/verifications/route.ts (or wherever verification submission is handled)
Read app/(admin)/admin/verifications/page.tsx (or wherever admin reviews verifications)
Read lib/supabase/queries/verifications.ts (if exists)
```

---

## Context

Current verification requires 3 certified documents (SA ID front, SA ID back, proof of address). Real users find this confusing and difficult. Simplify to: take a photo of your ID (front + back) and a selfie holding your ID. Platform extracts EXIF metadata from photos and runs automated fraud detection to assist admin review. Admin sees full metadata, fraud flags, and documents before approving or rejecting.

> **V5 follow-up:** AI screening with Claude Vision (face matching, ID readability, auto-extraction of ID number/name) will be added in a future task. The `verification_ai_check` column is included in the migration so it's ready when needed.

---

## Database Migration

Create `lib/migrations/008-verification-redesign.sql`:

```sql
-- ═══ 0. Drop legacy proof_of_address column ═══
alter table profiles drop column if exists proof_of_address_path;

-- ═══ 1. Add new verification columns ═══

-- Selfie with ID path
alter table profiles add column if not exists
  selfie_with_id_path text;

-- EXIF metadata from all verification photos
alter table profiles add column if not exists
  verification_metadata jsonb default null;

-- AI screening results from Claude Vision
alter table profiles add column if not exists
  verification_ai_check jsonb default null;

-- Fraud flags detected by automated checks
alter table profiles add column if not exists
  verification_fraud_flags jsonb default '[]';

-- Hash of ID document for duplicate detection
alter table profiles add column if not exists
  id_document_hash text;

-- IP and device info from submission
alter table profiles add column if not exists
  verification_ip text;

alter table profiles add column if not exists
  verification_user_agent text;

-- Number of submission attempts
alter table profiles add column if not exists
  verification_attempts integer default 0;

-- Index for duplicate hash detection
create index if not exists idx_profiles_id_hash
  on profiles (id_document_hash)
  where id_document_hash is not null;
```

---

## Implementation

### PART 1: Verification Page Redesign

#### 1A. Update verification page — `app/(platform)/dashboard/verification/page.tsx`

Replace the current 3-document upload with a guided 3-step flow:

**Status-aware rendering:**
```typescript
// Check current verification status first
const status = profile.verification_status;

if (status === 'verified') {
  // Show green verified badge, hide form
  return <VerifiedBadge verifiedDate={profile.verification_reviewed_at} />;
}

if (status === 'pending') {
  // Show pending status, hide form
  return <PendingStatus submittedDate={profile.verification_submitted_at} />;
}

if (status === 'rejected') {
  // Show rejection reason + form to resubmit
  return <RejectedStatus reason={profile.verification_rejected_reason} />;
  // Then show the upload form below
}

// status === 'unverified' — show upload form
```

**Upload form — 3 steps with preview:**

```
VERIFY YOUR IDENTITY
Get verified to list equipment and join our crew.

STEP 1 OF 3 — SA ID Smart Card (Front)
Take a clear photo of the front of your SA ID Smart Card.
Tips: Good lighting, flat surface, all text readable.
┌─────────────────────────┐
│                         │
│  [Upload or Take Photo] │
│                         │
└─────────────────────────┘
[Preview shown after upload]

STEP 2 OF 3 — SA ID Smart Card (Back)
Take a clear photo of the back of your SA ID Smart Card.
┌─────────────────────────┐
│                         │
│  [Upload or Take Photo] │
│                         │
└─────────────────────────┘
[Preview shown after upload]

STEP 3 OF 3 — Selfie with your ID
Hold your ID next to your face and take a photo.
We need to see both your face and your ID clearly.

HOW TO TAKE THIS PHOTO:
┌──────────────────────┐
│                      │
│   😊  ┌────────┐    │
│  Your  │  Your  │    │
│  face  │  ID    │    │
│        │  card  │    │
│        └────────┘    │
│                      │
└──────────────────────┘

┌─────────────────────────┐
│                         │
│  [Upload or Take Photo] │
│                         │
└─────────────────────────┘
[Preview shown after upload]

[ ] I confirm this is my real SA ID and the selfie is of me.

[SUBMIT FOR VERIFICATION]
```

**Mobile camera access:**
```html
<!-- Opens phone camera directly on mobile -->
<input 
  type="file" 
  accept="image/jpeg,image/png" 
  capture="environment"  <!-- back camera for ID photos -->
/>

<!-- For selfie step -->
<input 
  type="file" 
  accept="image/jpeg,image/png" 
  capture="user"  <!-- front camera for selfie -->
/>
```

**Client-side validation before upload:**
```typescript
function validateImage(file: File): { valid: boolean; error?: string } {
  // Must be image
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    return { valid: false, error: 'Only JPG and PNG files allowed.' };
  }
  
  // Minimum 200KB (reject tiny/blank images)
  if (file.size < 200 * 1024) {
    return { valid: false, error: 'Photo is too small. Please take a clearer photo.' };
  }
  
  // Maximum 10MB
  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: 'Photo is too large. Maximum 10MB.' };
  }
  
  return { valid: true };
}
```

---

### PART 2: EXIF Metadata Extraction

#### 2A. Create `lib/metadata/verification.ts`

```typescript
import exifr from 'exifr';

export interface PhotoMetadata {
  dateTaken: string | null;
  gps: { latitude: number; longitude: number } | null;
  device: string | null;
  software: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

export interface VerificationMetadata {
  id_front: PhotoMetadata;
  id_back: PhotoMetadata;
  selfie: PhotoMetadata;
}

export async function extractPhotoMetadata(
  fileBuffer: ArrayBuffer
): Promise<PhotoMetadata> {
  try {
    const exif = await exifr.parse(fileBuffer, {
      pick: [
        'DateTimeOriginal', 'GPSLatitude', 'GPSLongitude',
        'Make', 'Model', 'Software', 'ImageWidth', 'ImageHeight'
      ]
    });

    if (!exif) return emptyMetadata();

    return {
      dateTaken: exif.DateTimeOriginal?.toISOString() || null,
      gps: exif.GPSLatitude && exif.GPSLongitude
        ? { latitude: exif.GPSLatitude, longitude: exif.GPSLongitude }
        : null,
      device: exif.Make && exif.Model
        ? `${exif.Make} ${exif.Model}`.trim() : null,
      software: exif.Software || null,
      imageWidth: exif.ImageWidth || null,
      imageHeight: exif.ImageHeight || null,
    };
  } catch {
    return emptyMetadata();
  }
}

function emptyMetadata(): PhotoMetadata {
  return {
    dateTaken: null, gps: null, device: null,
    software: null, imageWidth: null, imageHeight: null,
  };
}
```

Dependency `exifr` is already installed in package.json — no install needed.

#### 2B. Fraud Flag Detection — `lib/metadata/fraud-detection.ts`

```typescript
import { VerificationMetadata } from './verification';

export interface FraudFlag {
  severity: 'low' | 'medium' | 'high';
  code: string;
  message: string;
}

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
    const inSA = latitude >= -35 && latitude <= -22 && longitude >= 16 && longitude <= 33;
    if (!inSA) {
      flags.push({
        severity: 'high',
        code: 'GPS_OUTSIDE_SA',
        message: `Location: ${latitude.toFixed(2)}, ${longitude.toFixed(2)} — outside South Africa`,
      });
    }
  }

  // 5. Editing software detected
  if (selfie.software && /photoshop|gimp|canva|picsart|snapseed/i.test(selfie.software)) {
    flags.push({
      severity: 'high',
      code: 'EDITING_SOFTWARE',
      message: `Selfie processed with: ${selfie.software}`,
    });
  }

  // 6. ID photos taken at very different times (more than 10 minutes apart)
  if (id_front.dateTaken && selfie.dateTaken) {
    const diff = Math.abs(
      new Date(selfie.dateTaken).getTime() - new Date(id_front.dateTaken).getTime()
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
  if (!id_front.dateTaken && !id_front.device && 
      !id_back.dateTaken && !id_back.device &&
      !selfie.dateTaken && !selfie.device) {
    flags.push({
      severity: 'high',
      code: 'NO_EXIF_ALL',
      message: 'No EXIF metadata on any photo — all may be screenshots or downloads',
    });
  }

  return flags;
}
```

#### 2C. SA ID Number Validation — `lib/metadata/sa-id-validation.ts`

```typescript
export function validateSAID(id: string): {
  valid: boolean;
  dateOfBirth?: string;
  gender?: string;
  citizenship?: string;
  error?: string;
} {
  if (!id || id.length !== 13) {
    return { valid: false, error: 'SA ID must be exactly 13 digits' };
  }

  if (!/^\d{13}$/.test(id)) {
    return { valid: false, error: 'SA ID must contain only numbers' };
  }

  // Date of birth: YYMMDD
  const year = parseInt(id.substring(0, 2));
  const month = parseInt(id.substring(2, 4));
  const day = parseInt(id.substring(4, 6));

  if (month < 1 || month > 12) return { valid: false, error: 'Invalid month in ID' };
  if (day < 1 || day > 31) return { valid: false, error: 'Invalid day in ID' };

  // Gender: digits 7-10 (0000-4999 = female, 5000-9999 = male)
  const genderDigits = parseInt(id.substring(6, 10));
  const gender = genderDigits < 5000 ? 'female' : 'male';

  // Citizenship: digit 11 (0 = SA citizen, 1 = permanent resident)
  const citizenshipDigit = parseInt(id[10]);
  if (citizenshipDigit !== 0 && citizenshipDigit !== 1) {
    return { valid: false, error: 'Invalid citizenship digit' };
  }
  const citizenship = citizenshipDigit === 0 ? 'SA Citizen' : 'Permanent Resident';

  // Luhn checksum on digit 13
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let digit = parseInt(id[i]);
    if (i % 2 !== 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  if (checkDigit !== parseInt(id[12])) {
    return { valid: false, error: 'Invalid ID checksum — ID number may be fake' };
  }

  // Full year
  const fullYear = year >= 0 && year <= 26 ? 2000 + year : 1900 + year;
  const dateOfBirth = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { valid: true, dateOfBirth, gender, citizenship };
}
```

---

### PART 3: Verification API Route

#### 3A. Update `app/api/verifications/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractPhotoMetadata } from '@/lib/metadata/verification';
import { detectFraudFlags } from '@/lib/metadata/fraud-detection';
import crypto from 'node:crypto';

export async function POST(req: NextRequest) {
  // 1. Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 2. Rate limit: max 3 attempts
  const { data: profile } = await supabase
    .from('profiles')
    .select('verification_attempts, verification_status')
    .eq('id', user.id)
    .single();

  if (profile.verification_status === 'pending') {
    return Response.json({ error: 'Verification already pending review.' }, { status: 400 });
  }

  if (profile.verification_status === 'verified') {
    return Response.json({ error: 'Account already verified.' }, { status: 400 });
  }

  if (profile.verification_attempts >= 3) {
    return Response.json({ 
      error: 'Maximum submission attempts reached. Contact support.' 
    }, { status: 429 });
  }

  // 3. Parse files from FormData
  const formData = await req.formData();
  const idFront = formData.get('id_front') as File;
  const idBack = formData.get('id_back') as File;
  const selfie = formData.get('selfie_with_id') as File;
  const confirmed = formData.get('confirmed') === 'true';

  if (!idFront || !idBack || !selfie) {
    return Response.json({ error: 'All three photos required.' }, { status: 400 });
  }

  if (!confirmed) {
    return Response.json({ error: 'You must confirm the photos are real.' }, { status: 400 });
  }

  // 4. Validate file sizes
  for (const [name, file] of [['ID Front', idFront], ['ID Back', idBack], ['Selfie', selfie]]) {
    if ((file as File).size < 200 * 1024) {
      return Response.json({ error: `${name} is too small. Take a clearer photo.` }, { status: 400 });
    }
    if ((file as File).size > 10 * 1024 * 1024) {
      return Response.json({ error: `${name} is too large. Maximum 10MB.` }, { status: 400 });
    }
  }

  // 5. Extract EXIF metadata BEFORE uploading to storage
  const idFrontBuffer = await idFront.arrayBuffer();
  const idBackBuffer = await idBack.arrayBuffer();
  const selfieBuffer = await selfie.arrayBuffer();

  const metadata = {
    id_front: await extractPhotoMetadata(idFrontBuffer),
    id_back: await extractPhotoMetadata(idBackBuffer),
    selfie: await extractPhotoMetadata(selfieBuffer),
  };

  // 6. Generate document hash for duplicate detection
  const idHash = crypto
    .createHash('sha256')
    .update(Buffer.from(idFrontBuffer))
    .digest('hex');

  // Check for duplicate
  const { data: duplicate } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('id_document_hash', idHash)
    .neq('id', user.id)
    .single();

  // 7. Detect fraud flags from metadata
  const fraudFlags = detectFraudFlags(metadata);

  if (duplicate) {
    fraudFlags.push({
      severity: 'high',
      code: 'DUPLICATE_ID',
      message: `Same ID document submitted by another account`,
    });
  }

  // 8. Upload files to Supabase Storage (fixed filenames per user)
  const storagePaths = {
    id_front: `verifications/${user.id}/id-front`,
    id_back: `verifications/${user.id}/id-back`,
    selfie: `verifications/${user.id}/selfie-with-id`,
  };

  // Delete old files if resubmitting
  await supabase.storage.from('verifications').remove([
    storagePaths.id_front, storagePaths.id_back, storagePaths.selfie
  ]);

  // Upload new files
  await supabase.storage.from('verifications')
    .upload(storagePaths.id_front, idFrontBuffer, { contentType: idFront.type, upsert: true });
  await supabase.storage.from('verifications')
    .upload(storagePaths.id_back, idBackBuffer, { contentType: idBack.type, upsert: true });
  await supabase.storage.from('verifications')
    .upload(storagePaths.selfie, selfieBuffer, { contentType: selfie.type, upsert: true });

  // 9. Get request metadata
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';

  // 10. Update profile
  await supabase.from('profiles').update({
    verification_status: 'pending',
    verification_submitted_at: new Date().toISOString(),
    id_front_path: storagePaths.id_front,
    id_back_path: storagePaths.id_back,
    selfie_with_id_path: storagePaths.selfie,
    verification_metadata: metadata,
    verification_ai_check: null, // V5: will be populated by AI screening
    verification_fraud_flags: fraudFlags,
    id_document_hash: idHash,
    verification_ip: ip,
    verification_user_agent: userAgent,
    verification_attempts: (profile.verification_attempts || 0) + 1,
    // Clear any previous rejection
    verification_rejected_reason: null,
    verification_reviewed_at: null,
  }).eq('id', user.id);

  // 11. Return response
  return Response.json({
    success: true,
    message: 'Documents submitted successfully. We\'ll review your verification within 1-2 business days.',
    flags_detected: fraudFlags.length,
  });
}
```

---

### PART 4: Admin Verification Review Page

#### 4A. Redesign `app/(admin)/admin/verifications/page.tsx`

For each verification submission, show:

```
┌─────────────────────────────────────────────────────────┐
│ VERIFICATION REVIEW                                      │
│                                                          │
│ ┌─ USER INFO ─────────────────────────────────────────┐ │
│ │ [Avatar] Thabang Mokwena          ⏳ PENDING         │ │
│ │ thabang@email.com | 079 xxx xxxx                    │ │
│ │ Member since: 16 Mar 2026                           │ │
│ │ Bio: Cinematographer and photographer               │ │
│ │ Skills: [LIGHTROOM] [PREMIERE PRO]                  │ │
│ │ Submission attempt: 1 of 3                          │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ PHOTO METADATA ────────────────────────────────────┐ │
│ │                                                      │ │
│ │ Selfie with ID:                                      │ │
│ │   Taken: 18 Mar 2026, 14:32                         │ │
│ │   Device: Samsung SM-S911B (Galaxy S24)              │ │
│ │   Location: -26.20, 28.04 (Johannesburg) 📍         │ │
│ │                                                      │ │
│ │ ID Front:                                            │ │
│ │   Taken: 18 Mar 2026, 14:31                         │ │
│ │   Device: Samsung SM-S911B (Galaxy S24)              │ │
│ │   Location: -26.20, 28.04 (Johannesburg) 📍         │ │
│ │                                                      │ │
│ │ ID Back:                                             │ │
│ │   Taken: 18 Mar 2026, 14:31                         │ │
│ │   Device: Samsung SM-S911B (Galaxy S24)              │ │
│ │   Location: -26.20, 28.04 (Johannesburg) 📍         │ │
│ │                                                      │ │
│ │ CONSISTENCY:                                         │ │
│ │   Same device:  ✅ Yes                               │ │
│ │   Same location: ✅ Yes                              │ │
│ │   Same time (< 5 min): ✅ Yes                       │ │
│ │   Fresh (< 24hrs): ✅ Yes                           │ │
│ │   Editing software: ✅ None detected                │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ FRAUD FLAGS ───────────────────────────────────────┐ │
│ │ ✅ No flags detected                                │ │
│ │                                                      │ │
│ │ OR:                                                  │ │
│ │ 🔴 HIGH: Selfie processed with Photoshop            │ │
│ │ 🟡 MEDIUM: Selfie and ID taken on different devices │ │
│ │ 🔵 LOW: Photos taken 8 minutes apart                │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ DOCUMENTS ─────────────────────────────────────────┐ │
│ │ [ID FRONT]      [ID BACK]      [SELFIE + ID]       │ │
│ │  Open full ↗     Open full ↗    Open full ↗        │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ ADMIN CHECKLIST ───────────────────────────────────┐ │
│ │ [ ] Face in selfie matches face on ID               │ │
│ │ [ ] ID is clearly readable                          │ │
│ │ [ ] ID appears valid and not expired                │ │
│ │ [ ] Name on ID matches profile name                 │ │
│ │ [ ] No signs of tampering or editing                │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ Admin notes: [textarea]                                  │
│                                                          │
│ [✅ APPROVE]    [❌ REJECT]                              │
│                                                          │
│ Rejection reason: [required if rejecting]                │
└─────────────────────────────────────────────────────────┘
```

**Document viewing:**
- Generate signed URLs from Supabase Storage: `supabase.storage.from('verifications').createSignedUrl(path, 3600)`
- Open in new tab or show inline with zoom
- Signed URLs expire after 1 hour

**GPS location display:**
- If GPS available, show reverse-geocoded location (or just lat/lon with a Google Maps link)
- Link: `https://www.google.com/maps?q=${lat},${lon}`

---

### PART 5: Duplicate ID Detection Across Users

When admin views a verification with DUPLICATE_ID flag:

```
🔴 DUPLICATE ID DETECTED
This document hash matches another account:
User: [other user display_name]
Status: [their verification status]
[View other user's verification →]
```

Admin can then investigate and decide which account is legitimate.

---

### PART 6: Rejected Resubmission Flow

When verification_status = 'rejected':

1. User sees rejection reason on verification page
2. Upload form is shown again
3. On resubmit:
   - Old files deleted from storage (fixed filenames overwrite)
   - New metadata extracted
   - New fraud flags detected
   - verification_attempts incremented
   - Status reset to 'pending'
4. After 3 failed attempts:
   - Form hidden
   - Message: "Maximum attempts reached. Contact support at [STUDIO.email]"

---

## Files to Create/Modify

```
CREATE:
  lib/metadata/verification.ts          — EXIF extraction
  lib/metadata/fraud-detection.ts       — fraud flag detection
  lib/metadata/sa-id-validation.ts      — SA ID Luhn validation
  lib/migrations/008-verification-redesign.sql

MODIFY:
  app/(platform)/dashboard/verification/page.tsx   — new 3-step upload
  app/api/verifications/route.ts                   — new submission handler
  app/(admin)/admin/verifications/page.tsx          — redesigned review page
  package.json                                      — exifr already installed, no changes needed
```

---

## Acceptance Criteria

- [ ] Verification page shows 3-step upload: ID front, ID back, selfie with ID
- [ ] Mobile camera opens directly for photo capture
- [ ] Client-side validation rejects tiny/large/wrong format files
- [ ] EXIF metadata extracted from all 3 photos before upload
- [ ] Fraud flags auto-detected from metadata (device mismatch, old photos, editing software, GPS outside SA)
- [ ] Duplicate ID hash detection across all users
- [ ] SA ID number validation utility with Luhn checksum (ready for V5 AI integration)
- [ ] Rate limited to 3 attempts per user
- [ ] Pending status blocks resubmission
- [ ] Verified status hides the form completely
- [ ] Rejected status shows reason + allows resubmission
- [ ] Admin review page shows: user info, metadata, fraud flags, documents, checklist
- [ ] Admin can approve or reject with notes
- [ ] Signed URLs for secure document viewing
- [ ] All old certified document references removed
- [ ] npm run build passes
- [ ] Existing tests still pass

---

## Update MEMORY.md

After completion, append:

```
## Session: TASK-038 — Verification Redesign (2026-03-XX)
### Branch: feature/task-038-verification-redesign
### Built:
- 3-step verification: ID front, ID back, selfie with ID
- EXIF metadata extraction with exifr
- Fraud flag detection (7 checks: no EXIF, old photo, device mismatch, GPS outside SA, editing software, time mismatch, duplicate hash)
- SA ID number validation utility (Luhn checksum, DOB, gender, citizenship)
- Duplicate ID detection across users
- Rate limiting (3 attempts max)
- Admin review page with full metadata, fraud flags, documents, checklist
- Rejection + resubmission flow
- V5 follow-up: AI screening with Claude Vision (verification_ai_check column ready)
### Database: 008-verification-redesign.sql migration (drops proof_of_address_path, adds selfie + AI columns)
### Dependencies: exifr (already installed)
### Tests: [results]
### Notes: [blockers or follow-ups]
```

---

## Post-Session

```
/pre-merge
```
Verify CI passes. Merge to main. Run `/end-session`.