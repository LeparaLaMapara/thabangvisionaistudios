# TASK-038: Student Discount — 50% Off Deposit with AI-Verified Registration

## Status: Todo

## Summary
Students often can't afford full deposits on equipment rentals. Allow them to upload a certified proof of registration from their institution. Validate the document using Gemma 4 (free tier vision model), and if legitimate, apply a 50% discount on the rental deposit.

## User Flow
1. Student goes to their profile or a dedicated `/dashboard/student-verification` page
2. Uploads a photo/scan of their certified proof of registration (university letterhead, student number, current year)
3. Gemma 4 vision model analyzes the document and extracts: institution name, student name, student number, registration year, certification stamp/signature
4. If valid and current year: mark profile as `student_verified = true`, store verification metadata
5. If unclear or suspicious: flag for manual admin review
6. Once verified, all equipment booking deposits are automatically halved (50% of normal deposit)

## Technical Implementation

### Database Changes
- `profiles` table additions:
  - `student_verified BOOLEAN DEFAULT false`
  - `student_verification_data JSONB` — stores extracted info (institution, student number, year, verified_at, document_url)
  - `student_verification_status TEXT` — `pending | verified | rejected | expired`

### API Route
- `app/api/student-verification/route.ts`
  - POST: accepts image upload, sends to Gemma 4 for analysis
  - Uses `trackedCompletion()` with agent `student-verifier`
  - Stores document in Cloudinary (private/restricted access)
  - Updates profile with verification result

### AI Validation (Gemma 4)
- Register `student-verifier` agent in `lib/agents/registry.ts` using `gemma-4-31b-it` (free tier, same as onboarding/portfolios agents)
- Vision prompt should check for:
  - Is this a legitimate student registration document?
  - Institution name (must be a recognized SA institution)
  - Student full name (must match profile name)
  - Registration year (must be current academic year)
  - Certification stamp, registrar signature, or official letterhead
  - Any signs of tampering or forgery
- Return structured JSON: `{ valid: boolean, confidence: number, institution: string, studentNumber: string, year: number, reason: string }`

### Deposit Discount Logic
- In `lib/payments/` deposit calculation: check `profile.student_verified === true` and `student_verification_status === 'verified'`
- Apply `STUDIO.rental.studentDepositDiscount` (0.5) to the deposit amount
- Add `studentDepositDiscount: 0.5` to `lib/constants.ts` under `STUDIO.rental`
- Show "Student discount applied" badge on booking confirmation

### UI
- `/dashboard/student-verification` page with upload dropzone
- Status display: pending review, verified (with green badge), rejected (with reason)
- Dashboard stat or badge showing student status
- Booking flow: show original deposit crossed out with discounted amount

### Expiry
- Student verification expires annually (registration is per academic year)
- Cron job or check at booking time: if `student_verification_data.year < currentYear`, set `student_verification_status = 'expired'` and prompt re-upload

### Admin
- Admin view at `/admin/student-verifications` to review flagged submissions
- Override capability: manually approve or reject

## Security Considerations
- Rate limit uploads (max 3 attempts per day)
- Store documents with restricted Cloudinary access (not public URLs)
- Name matching between document and profile (fuzzy match to handle variations)
- Don't accept screenshots of student portals — must be official certified document
- Log all verification attempts for audit trail

## Constants
```ts
// In STUDIO.rental
studentDepositDiscount: 0.5, // 50% off deposit for verified students
```

## Priority
Medium — high impact for student adoption, relatively contained scope.
