# Security Audit Report - Thabang Vision AI Studios

**Date:** 2026-03-09 (Updated: 2026-03-10)
**Auditor:** Claude Code (Automated Codebase Security Review)
**Scope:** Full codebase - all API routes, middleware, auth, database queries, client components, file uploads, payment integration

---

## Executive Summary

The codebase has a solid foundation with several security patterns implemented correctly (signed Cloudinary uploads, PayFast ITN multi-step validation, Supabase auth guards on admin/dashboard layouts, no raw SQL). The initial audit found **4 Critical**, **10 High**, **9 Medium**, and **6 Low** severity findings. As of 2026-03-10, **all 4 Critical and all 10 High findings have been fixed**.

| Severity | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 4 | 4 | 0 |
| High | 10 | 10 | 0 |
| Medium | 9 | 0 | 9 |
| Low | 6 | 0 | 6 |

---

## Critical Findings

### C1. Middleware Not Running - Session Refresh Broken

- **Severity:** CRITICAL
- **Status:** VERIFIED - NOT AN ISSUE
- **File:** `proxy.ts` (project root)
- **Description:** Next.js 16 (v16.1.6) uses `proxy.ts` with a `proxy` export — this is the correct convention. The file exists, exports `proxy`, and has a proper matcher pattern covering all non-static routes. Session refresh is working correctly.
- **Resolution (2026-03-10):** Verified that `proxy.ts` is the correct filename for Next.js 16. No rename needed.

### C2. Admin API Routes Have No Authentication

- **Severity:** CRITICAL
- **Status:** FIXED
- **Files:**
  - `app/api/admin/verifications/route.ts` (GET)
  - `app/api/admin/verifications/[id]/route.ts` (GET + PUT)
- **Resolution (2026-03-10):** Added `requireAdmin()` guard to all three handlers. Returns 401 if not authenticated, 403 if not an admin. Uses shared `lib/auth.ts` helper with `ADMIN_EMAILS` allowlist from `lib/constants.ts`.

### C3. No Admin Role Verification Anywhere

- **Severity:** CRITICAL
- **Status:** FIXED
- **Files:**
  - `app/(admin)/layout.tsx` - admin layout
  - `app/api/admin/verifications/route.ts` - admin API
  - `app/api/admin/verifications/[id]/route.ts` - admin API
  - `app/api/cloudinary/delete/route.ts` - asset deletion
  - `app/api/cloudinary/delete-folder/route.ts` - folder deletion
- **Resolution (2026-03-10):** Implemented admin role verification using `ADMIN_EMAILS` allowlist in `lib/constants.ts`. The admin layout now checks the user's email against the allowlist and redirects non-admins to `/dashboard`. All admin API routes use the shared `requireAdmin()` helper from `lib/auth.ts` which returns 401/403 as appropriate. Cloudinary delete routes require admin access.

### C4. Cloudinary Routes Have No Authentication

- **Severity:** CRITICAL
- **Status:** FIXED
- **Files:**
  - `app/api/cloudinary/sign/route.ts` - requires authenticated user
  - `app/api/cloudinary/delete/route.ts` - requires admin
  - `app/api/cloudinary/delete-folder/route.ts` - requires admin
- **Resolution (2026-03-10):** Added `requireAuth()` to the sign route (any logged-in user can upload). Added `requireAdmin()` to both delete routes (only admins can delete assets/folders). Uses shared `lib/auth.ts` helpers.

---

## High Severity Findings

### H1. Gemini API Proxy - No Authentication or Rate Limiting

- **Severity:** HIGH
- **Status:** FIXED
- **File:** `app/api/gemini/route.ts`
- **Resolution (2026-03-10):** Added `requireAuth()` guard — only logged-in users can use the AI proxy. Added in-memory rate limiting (10 requests/minute per user) via `checkRateLimit()` from `lib/auth.ts`. Added model allowlist validation (`gemini-pro`, `gemini-pro-vision`, `gemini-1.5-pro`, `gemini-1.5-flash`) to prevent URL manipulation. Raw upstream error messages are no longer exposed to clients.

### H2. Search API - Supabase Filter Injection via `ilike` Pattern

- **Severity:** HIGH
- **Status:** FIXED
- **File:** `app/api/search/route.ts`
- **Resolution (2026-03-10):** Search input is now sanitized before use in `.or()` filters. All PostgREST special characters (`,`, `.`, `(`, `)`, `"`, `'`, `\`, `%`, `_`) are stripped from the query. If the sanitized query is less than 2 characters, an empty result is returned. This prevents filter injection via crafted search terms.

### H3. No Rate Limiting on Any Endpoint

- **Severity:** HIGH
- **Status:** FIXED
- **Files:** Multiple API routes
- **Resolution (2026-03-10):** Added in-memory rate limiting via `checkRateLimit()` from `lib/auth.ts` to all key endpoints:
  - `/api/contact` — 3 req/min per IP
  - `/api/gemini` — 10 req/min per user (fixed in prior commit)
  - `/api/bookings` POST — 5 req/min per user
  - `/api/subscriptions` POST — 3 req/min per user
  - `/api/cloudinary/sign` — 20 req/min per user
  - Note: Login/register rate limiting is handled by Supabase's built-in auth rate limits

### H4. File Upload - No Type or Size Validation

- **Severity:** HIGH
- **Status:** FIXED
- **Files:**
  - `app/api/cloudinary/sign/route.ts` - validates resource_type
  - `app/api/verifications/route.ts` - validates file type and size
- **Resolution (2026-03-10):**
  - Cloudinary sign: Validates `resource_type` against allowlist (`image`, `video`, `raw`). Rejects unknown resource types.
  - Verification uploads: Validates each file's MIME type against `STUDIO.verification.acceptedTypes` (`image/jpeg`, `image/png`, `application/pdf`). Validates file size against `STUDIO.verification.maxFileSizeMB` (5MB). Returns descriptive errors for invalid files.

### H5. PayFast Webhook - Weak IP Validation in Production

- **Severity:** HIGH
- **Status:** FIXED
- **File:** `lib/payfast.ts`
- **Resolution (2026-03-10):** Replaced naive string prefix matching with proper CIDR bit-level matching via `ipInCidr()`. Now correctly validates that IPs fall within the exact CIDR ranges (`197.97.145.144/28` = 16 IPs, `41.74.179.192/27` = 32 IPs) rather than allowing the entire /24 subnet. Sandbox bypass mode preserved for testing.

### H6. Subscription Created as "active" Before Payment

- **Severity:** HIGH
- **Status:** FIXED
- **File:** `app/api/subscriptions/route.ts`
- **Resolution (2026-03-10):** Changed subscription insert status from `'active'` to `'pending'`. Subscriptions are now only activated by the PayFast ITN webhook upon successful payment confirmation.

### H7. Booking Status Manipulation by Users

- **Severity:** HIGH
- **Status:** FIXED
- **File:** `app/api/bookings/[id]/route.ts`
- **Resolution (2026-03-10):** Restricted user-modifiable booking statuses to `['cancelled']` only. Users can only cancel their own bookings. All other status transitions (`confirmed`, `active`, `completed`) are system-only, handled by the PayFast ITN webhook. Returns 403 if a user attempts an unauthorized status change.

### H8. PayFast Signature Comparison Vulnerable to Timing Attack

- **Severity:** HIGH
- **Status:** FIXED
- **File:** `lib/payfast.ts`
- **Resolution (2026-03-10):** Replaced `===` string comparison with `crypto.timingSafeEqual()` for constant-time signature comparison. Wrapped in try/catch to handle mismatched buffer lengths (which would indicate non-matching signatures).

### H9. Open Redirect via Payment URL Redirect

- **Severity:** HIGH
- **Status:** FIXED
- **Files:**
  - `components/booking/BookingWidget.tsx`
  - `app/(platform)/pricing/page.tsx`
- **Resolution (2026-03-10):** Both files now validate the payment URL hostname against an allowlist (`sandbox.payfast.co.za`, `www.payfast.co.za`) before redirecting. Invalid URLs show an error message instead of redirecting. Uses `new URL()` parsing to prevent protocol-level attacks.

### H10. Unvalidated Social Media URLs in Creator Profiles (javascript: XSS)

- **Severity:** HIGH
- **Status:** FIXED
- **Files:**
  - `app/(platform)/creators/[id]/CreatorProfileClient.tsx` - client-side rendering
  - `app/(platform)/dashboard/profile/page.tsx` - profile save
- **Resolution (2026-03-10):** Two-layer protection:
  1. **Client-side (render):** Social links are filtered before rendering — only URLs with `https:` or `http:` protocols are displayed. `javascript:`, `data:`, and other dangerous protocols are silently dropped.
  2. **Server-side (save):** Profile update validates all social link URLs before persisting. Invalid URLs and dangerous protocols are stripped from the payload before writing to Supabase.

---

## Medium Severity Findings

### M1. No CSRF Protection on Mutation Endpoints

- **Severity:** MEDIUM
- **Files:** All POST/PUT/DELETE API routes
- **Description:** There is no CSRF token validation on any API route. While Next.js API routes using `fetch()` from the same origin have some protection via the SameSite cookie attribute (Supabase cookies default to `Lax`), this isn't sufficient for all scenarios. A malicious website could potentially trigger POST requests if the user has an active session.
- **Fix:**
  1. Verify Supabase auth cookies are set with `SameSite=Lax` (they should be by default)
  2. For sensitive mutations (delete, payment), consider adding a custom CSRF token or requiring the `Origin`/`Referer` header to match your domain
  3. Add `X-Requested-With` header check for API routes

### M2. No Security Headers Configured

- **Severity:** MEDIUM
- **File:** `next.config.ts`
- **Description:** No security headers are configured:
  - No `Content-Security-Policy` (CSP) header
  - No `X-Frame-Options` (clickjacking protection)
  - No `X-Content-Type-Options` (MIME sniffing protection)
  - No `Referrer-Policy`
  - No `Permissions-Policy`
  - No `Strict-Transport-Security` (HSTS)
- **Fix:** Add security headers in `next.config.ts`:
  ```typescript
  const nextConfig: NextConfig = {
    headers: async () => [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ],
    // ...existing config
  };
  ```

### M3. Availability Check Leaks Booking Details

- **Severity:** MEDIUM
- **File:** `app/api/rentals/[id]/availability/route.ts:56-61`
- **Description:** The availability endpoint returns the full `conflicts` array including booking IDs, dates, and statuses for other users' bookings. This leaks information about when and how often other users are booking equipment, which could be a business intelligence/privacy concern.
- **Fix:** Return only the boolean `available` flag and counts, not the conflict details:
  ```typescript
  return NextResponse.json({ available, booked_count: bookedCount, total_quantity: totalQuantity });
  ```

### M4. Contact Form Email Validation Too Permissive

- **Severity:** MEDIUM
- **File:** `app/api/contact/route.ts:20-21`
- **Description:** The email regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` is very loose and allows many invalid email formats. More importantly, the `name`, `email`, and `subject` fields from the contact form are logged to the server console (line 29) without sanitization when email is not configured. If logs are collected by a log aggregation service, this could lead to log injection.
- **Fix:** Use a stricter email validation library. Sanitize all user input before logging.

### M5. Sensitive Error Messages Exposed to Client

- **Severity:** MEDIUM
- **Files:**
  - `app/api/gemini/route.ts:53` - returns raw Gemini upstream error text to client
  - Multiple routes return `error.message` from Supabase errors directly
- **Description:** Raw error messages from upstream services (Gemini, Supabase) are passed to the client. These can reveal internal implementation details, table names, column names, and database schema information.
- **Fix:** Return generic error messages to clients and log detailed errors server-side:
  ```typescript
  console.error('[gemini] Upstream error:', detail);
  return NextResponse.json({ error: 'AI service temporarily unavailable.' }, { status: 502 });
  ```

### M6. PayFast Notify URL Uses APP_URL Which May Be localhost

- **Severity:** MEDIUM
- **File:** `lib/payfast.ts:128-135`
- **Description:** The `notify_url` for PayFast ITN is built from `NEXT_PUBLIC_APP_URL` which defaults to `http://localhost:3000`. If this env var is not properly set in production, PayFast won't be able to send ITN notifications, meaning payments succeed on PayFast's side but bookings/subscriptions never get confirmed in the database.
- **Fix:** Add a runtime check that `NEXT_PUBLIC_APP_URL` is set to a publicly accessible HTTPS URL in production. Throw an error if it contains `localhost` when sandbox mode is off.

### M7. PayFast ITN Does Not Reconcile Payment Amount

- **Severity:** MEDIUM
- **File:** `app/api/webhooks/payfast/route.ts:29-48`
- **Description:** When a `COMPLETE` payment is received, the ITN handler updates the booking to `confirmed` and inserts a `booking_payments` record using `params.amount_gross`. However, it never checks that `amount_gross` matches the `total_price` stored in `equipment_bookings`. A manipulated PayFast redirect (or a partial payment scenario) could result in a booking being confirmed at a lower amount than expected.
- **Fix:** After receiving the ITN, fetch the booking record and compare the amounts:
  ```typescript
  const { data: booking } = await supabase
    .from('equipment_bookings')
    .select('total_price')
    .eq('id', paymentId)
    .single();

  if (Math.abs(booking.total_price - parseFloat(params.amount_gross)) > 0.01) {
    console.error('[PayFast ITN] Amount mismatch:', { expected: booking.total_price, received: params.amount_gross });
    // Flag for manual review instead of auto-confirming
    return;
  }
  ```

### M8. Booking Dates Not Validated as Future Dates

- **Severity:** MEDIUM
- **File:** `app/api/bookings/route.ts:51-59`
- **Description:** The booking endpoint validates `end > start` but does not check that dates are in the future. A user could create bookings for past dates. Additionally, there's no maximum duration limit — someone could book equipment for 10 years.
- **Fix:**
  ```typescript
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (start < now) {
    return NextResponse.json({ error: 'Cannot book for past dates.' }, { status: 400 });
  }
  if (days > 365) {
    return NextResponse.json({ error: 'Maximum booking is 365 days.' }, { status: 400 });
  }
  ```

### M9. No Idempotency Protection on Booking/Subscription Creation

- **Severity:** MEDIUM
- **Files:**
  - `app/api/bookings/route.ts` POST handler
  - `app/api/subscriptions/route.ts` POST handler
  - `app/api/payfast/checkout/route.ts` POST handler
- **Description:** If a user double-clicks a submit button or retries a failed request, duplicate bookings/subscriptions are created with separate PayFast payment requests. This could result in double charges.
- **Fix:** Add a deduplication check (e.g., reject if the same user+rental+dates combination was created within the last 60 seconds), or implement an idempotency key header.

---

## Low Severity Findings

### L1. Honeypot Field Name is Predictable

- **Severity:** LOW
- **File:** `app/api/contact/route.ts:7-12`
- **Description:** The honeypot field is named `website`, which is a very common honeypot field name that sophisticated bots may know to skip. The protection is basic.
- **Fix:** Consider additional spam prevention: add a time-based check (reject submissions < 2 seconds after page load), or integrate a service like hCaptcha/Turnstile.

### L2. Social Links Point to `#`

- **Severity:** LOW
- **File:** `lib/constants.ts`
- **Description:** All social links in the footer point to `#`. While not a security vulnerability, clicking these results in a page scroll to top, which could be confusing. If a user inspects the link and sees `#`, it looks unprofessional.
- **Fix:** Either set real URLs or remove the social links until they're ready.

### L3. Debug Logging of Sensitive Data

- **Severity:** LOW
- **Files:**
  - `app/api/contact/route.ts:29` - logs full contact form messages
  - `app/api/webhooks/payfast/route.ts:20-23` - logs payment details
- **Description:** Sensitive data (user messages, payment amounts, payment IDs) are logged to console. In production, these logs may be stored in log aggregation services without proper PII handling.
- **Fix:** Reduce logging verbosity in production. Avoid logging PII. Use structured logging with a log level that can be configured per environment.

### L4. `VERCEL_OIDC_TOKEN` in `.env.local`

- **Severity:** LOW
- **File:** `.env.local:24`
- **Description:** The file itself comments "Set in Vercel dashboard, NOT here" but then includes the OIDC token on the next line. While `.env.local` is gitignored, having an expired/stale OIDC token in local env files can cause confusion. The token has a short expiry anyway (based on JWT claims).
- **Fix:** Remove the `VERCEL_OIDC_TOKEN` line from `.env.local`. Use Vercel dashboard to manage it.

### L5. Video Iframe Embeds Lack Sandbox Attribute

- **Severity:** LOW
- **Files:**
  - `app/(platform)/smart-rentals/[category]/[slug]/RentalDetailView.tsx:215-221`
- **Description:** YouTube/Vimeo iframes are embedded with a permissive `allow` attribute (includes `clipboard-write`) but no `sandbox` attribute. While these are trusted providers, defense-in-depth suggests restricting iframe capabilities.
- **Fix:** Add `sandbox="allow-scripts allow-same-origin allow-presentation"` and `referrerpolicy="no-referrer"` to video iframes.

### L6. Supabase Anon Key Exposed in CLAUDE.md (Committed to Repo)

- **Severity:** LOW
- **File:** MEMORY.md references the Supabase URL
- **Description:** The Supabase URL (`https://zbdsqvpxpsygbuqnuekm.supabase.co`) is referenced in committed files. The anon key is designed to be public (used in browser), but combined with the URL, it allows anyone to make requests against your Supabase project (subject to RLS policies). This is by design but worth noting.
- **Fix:** Ensure Row Level Security (RLS) is enabled and properly configured on ALL tables. This is essential since the anon key is public.

---

## Security Checklist

### Passed

- [x] **No hardcoded secrets in source code** - All secrets accessed via `process.env`
- [x] **`.env*` files are gitignored** - `.gitignore` contains `.env*`
- [x] **No `eval()` or `new Function()` usage** - Clean codebase
- [x] **No `dangerouslySetInnerHTML`** in application code (only in playwright report)
- [x] **Supabase client uses anon key, not service role** - Server client correctly uses anon key with cookie-based auth
- [x] **No raw SQL execution** - All queries use Supabase query builder (no `.rpc()`, `.sql()`, or raw queries)
- [x] **Soft delete respected in public queries** - `.is('deleted_at', null)` used consistently
- [x] **PayFast ITN has multi-step validation** - IP check + signature check + server-to-server validation
- [x] **Cloudinary uploads are signed server-side** - API secret never sent to client
- [x] **Admin layout has auth guard** - Redirects to login if no user
- [x] **Dashboard layout has auth guard** - Redirects to login if no user
- [x] **Authenticated API routes check user session** - Bookings, subscriptions, etc.
- [x] **Email HTML output is escaped** - `escapeHtml()` used in `lib/email.ts`
- [x] **Password reset has minimum length validation** - 8 chars minimum enforced
- [x] **Double-booking prevention** - Conflict check before creating bookings

### Fixed (2026-03-10)

- [x] **Middleware/proxy running** - Verified `proxy.ts` is correct for Next.js 16 (C1)
- [x] **Admin role enforcement** - `ADMIN_EMAILS` allowlist in constants + `requireAdmin()` helper (C3)
- [x] **Admin API route authentication** - All `/api/admin/*` routes require admin auth (C2)
- [x] **Cloudinary route authentication** - Sign requires auth, delete requires admin (C4)
- [x] **Gemini route authentication** - Requires auth + 10 req/min rate limit + model allowlist (H1)
- [x] **Search input sanitization** - PostgREST special chars stripped from query (H2)
- [x] **Rate limiting** - Applied to contact (3/min), bookings (5/min), subscriptions (3/min), uploads (20/min), gemini (10/min) (H3)
- [x] **File upload validation** - Cloudinary enforces resource_type allowlist; verifications validate MIME type + file size (H4)
- [x] **PayFast IP validation** - Proper CIDR bit-level matching replaces prefix check (H5)
- [x] **Subscription payment flow** - Status set to `pending` until PayFast ITN confirms (H6)
- [x] **Booking status access control** - Users can only cancel; system handles confirm/active/complete (H7)
- [x] **Timing-safe signature comparison** - `crypto.timingSafeEqual()` for PayFast signatures (H8)
- [x] **Payment redirect validation** - URL hostname validated against PayFast allowlist (H9)
- [x] **Social link URL validation** - Client + server-side protocol validation (H10)

### Still Failing

- [ ] **CSRF protection** - No explicit CSRF tokens (M1)
- [ ] **Security headers** - None configured (M2)
- [ ] **Booking date validation** - Past dates and unbounded duration allowed (M8)
- [ ] **Idempotency protection** - Duplicate bookings/subscriptions possible (M9)

---

## Recommendations for Production Hardening

### Immediate (Before Launch)

1. **Fix admin role verification** (C3) - This is the single most important fix. Without it, any registered user has full admin access.
2. **Add auth to admin API routes** (C2) - Verification documents contain government IDs.
3. **Add auth to Cloudinary routes** (C4) - Prevent unauthorized uploads/deletions.
4. **Add auth to Gemini route** (H1) - Prevent API abuse.
5. **Fix subscription payment flow** (H6) - Change status from `active` to `pending`.
6. **Restrict booking status updates** (H7) - Users shouldn't self-confirm.
7. **Verify middleware is running** (C1) - Critical for session management.

### Before Handling Real Money

8. **Implement proper CIDR matching for PayFast IPs** (H5)
9. **Use timing-safe signature comparison** (H8) - `crypto.timingSafeEqual()`
10. **Validate payment redirect URLs on the client** (H9)
11. **Ensure `NEXT_PUBLIC_APP_URL` is correct in production** (M6)
12. **Add rate limiting to payment and auth endpoints** (H3)
13. **Sanitize search input** (H2)
14. **Add idempotency protection to booking/subscription creation** (M8)

### Before Handling User Data at Scale

15. **Validate social link URLs to prevent javascript: XSS** (H10)
16. **Add security headers** (M2)
17. **Implement file upload validation** (H4)
18. **Validate booking dates are in the future** (M7)
19. **Reduce error message verbosity** (M5)
20. **Configure Supabase RLS on all tables** (L6)
21. **Add CSRF protection to sensitive mutations** (M1)
22. **Implement structured logging with PII redaction** (L3)

### Nice to Have

18. Add Content Security Policy header
19. Implement account lockout after failed login attempts
20. Add audit logging for admin actions
21. Set up automated dependency vulnerability scanning (e.g., `npm audit`, Dependabot)
22. Add Supabase database backups schedule
23. Implement session invalidation on password change

---

## Architecture Notes

- **No service_role key usage detected** - Good. All server-side code uses the anon key with cookie-based auth, which means RLS policies are respected.
- **No SQL injection vectors** - Supabase query builder is used exclusively, with the exception of the search route's `.or()` string interpolation (H2).
- **PayFast integration is well-structured** - 3-step ITN validation (IP, signature, server-to-server) follows PayFast's official documentation.
- **Auth pattern is consistent** - Server components and API routes both use `supabase.auth.getUser()` (not `getSession()` which can be spoofed).

---

*Initial audit: 2026-03-09. Updated 2026-03-10 after fixing all Critical (C1-C4) and all High (H1-H10) findings. Medium and Low findings remain — address before production launch.*
