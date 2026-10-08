# Legal review checklist (Phase 0)

The Terms (`/legal`), Privacy Policy (`/privacy`), Refunds (`/refunds`),
access-request page (`/paia`) and the identity-check notice
(`components/verification/ConsentStep.tsx`) are **drafts**. They were corrected
for accuracy against the code on 2026-10-08. They have **not** been reviewed by
a South African attorney, and nothing in them or in this file is legal advice.

Each item below needs a decision before the pages are treated as final.

Status key:
- **REQUIRES_LEGAL_REVIEW**: an attorney must decide the wording or whether the rule applies.
- **REQUIRES_FOUNDER_APPROVAL**: a business decision only the founder can make.
- **NEEDS_VERIFICATION**: a fact to check outside the code (a dashboard, a contract or a regulator website).
- **CONFIRMED**: established from the code or recorded founder decisions; file evidence is given.

Section references to the Acts are given so the reviewer can find the topic.
The reviewer should confirm them, because the sub-paragraph letters were not checked against the gazetted text.

## A. Electronic Communications and Transactions Act (ECTA) s43 disclosures

| # | Item | Status | Notes / evidence |
|---|---|---|---|
| A1 | Full legal name, legal status, registration number | CONFIRMED | `STUDIO.legal.companyName`, `registrationNumber` (lib/constants.ts). Shown in Terms s2 and s29, Privacy s1, Refunds s13 and /paia. |
| A2 | Names of directors / office bearers | REQUIRES_FOUNDER_APPROVAL + REQUIRES_LEGAL_REVIEW | Not in constants and not published anywhere. Nothing was invented. Supply the names from CIPC and add a constant. |
| A3 | Physical address, and the address for service of legal documents | REQUIRES_FOUNDER_APPROVAL | `STUDIO.legal.registeredAddress` is the founder's own address. It is already rendered in Terms s2/s29, Privacy s1 and Refunds s13 (and the footer) wherever it is non-empty. It was **not** added to /paia or the consent screens. Decide whether it may be published, or set a separate address for service of legal documents. |
| A4 | Telephone number | REQUIRES_LEGAL_REVIEW | The only number takes WhatsApp messages, not calls (`STUDIO.whatsapp`). Confirm a WhatsApp-only number satisfies the disclosure. |
| A5 | Membership of a self-regulatory body / code of conduct / ADR | REQUIRES_LEGAL_REVIEW | None stated. Terms s19 and Refunds s11 point to the National Consumer Commission and the courts. Confirm whether the Consumer Goods and Services Ombud (or another ombud) should be named. |
| A6 | Full price, including delivery and taxes | NEEDS_VERIFICATION | Terms s6 now says the company is not registered for VAT and that no VAT is added. Check that the live checkout total (WS1) matches: no VAT line, and the delivery fee shown before payment. |
| A7 | Description of payment security | REQUIRES_LEGAL_REVIEW | Terms s6 says online card payments go through "our payment provider (currently Paystack)" over encrypted connections, and that full card details are not stored. The provider name is read from `PAYMENT_PROVIDER`. Confirm this is a sufficient description. |
| A8 | How a customer can access and keep a full record of the transaction | REQUIRES_LEGAL_REVIEW + REQUIRES_FOUNDER_APPROVAL | Not stated. The dashboard booking pages and the emails are the record in practice. Add a sentence once confirmed. |
| A9 | Time for delivery / performance | REQUIRES_LEGAL_REVIEW | Hire dates come from the booking. Service bookings have a 30-day "nothing delivered" review (Terms s16). |
| A10 | Return, exchange and refund policy | CONFIRMED (text) / REQUIRES_LEGAL_REVIEW (substance) | /refunds |

## B. Cooling-off (ECTA s44 and s42 exclusions)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | Cooling-off wording | REQUIRES_LEGAL_REVIEW | Refunds s10 offers a full refund within `STUDIO.legal.coolingOffDays` (7) days for "everything you paid online". Most customers now pay by EFT or cash while online payment is off, so the "online" wording may under-promise. It also relies on an s42(2) exclusion once the hire or shoot starts. Confirm the exclusion and that the wording works for EFT and cash payments (lib/rental/cancellation.ts implements it). |

## C. Consumer Protection Act (CPA)

| # | Item | Status | Notes |
|---|---|---|---|
| C1 | s56 implied warranty: does it apply to equipment hire and to services? | REQUIRES_LEGAL_REVIEW | The contradiction ("tell us within 7 days … section 56 … we do not limit it") was removed. Refunds s8 now says: "tell us as soon as you notice the problem. Nothing in this policy limits your rights under the Consumer Protection Act." No six-month warranty is promised for rentals. The attorney decides what, if anything, to promise. |
| C2 | s49 notice of risk and liability clauses | REQUIRES_LEGAL_REVIEW | Risk (Terms s9), damage and loss (s13), loss of earnings (s14), no insurance (s15) and limitation of liability (s26). Only s15 is visibly flagged. Decide whether the checkout checkbox (`components/consent/TermsAcceptance.tsx`) plus the signed handover agreement give enough prominence and a real chance to read. Consider a separate acknowledgement of the risk clauses. |
| C3 | Limitation of liability: gross-negligence carve-out (s51) | REQUIRES_LEGAL_REVIEW | Terms s26 caps liability at the order value and has a general saving clause. It has no explicit carve-out for gross negligence or for liability that cannot lawfully be excluded. |
| C4 | Loss-of-earnings formula (35% of hire value or 10 weeks' hire, whichever is higher) | REQUIRES_LEGAL_REVIEW | Terms s14 (`RENTAL_POLICIES.lossOfEarnings`). Check fairness (s48) and the Conventional Penalties Act. |
| C5 | Cancellation charges as a "reasonable charge" (s17) | REQUIRES_LEGAL_REVIEW | Refunds s5, s6 and s10. |

## D. POPIA: identity check (biometric) and consent

What the code does (evidence):
- The ID image and selfie are uploaded to the private Supabase storage bucket `verifications` (`app/api/verifications/route.ts`, `uploadToStorage`). Uploads are refused without `profiles.popia_consent_at` (same file, POPIA guard).
- The face comparison is `matchFaces()` in `lib/agents/tools/vision.ts`. It uses `@google/generative-ai` with `GEMINI_API_KEY` (lines 1 and 10), and the model `gemma-4-31b-it` is hard-coded, not env-driven (line 9). Both images are sent inline as base64 (lines 75 to 93). The result stored is `{match, confidence, reasoning}` in `profiles.verification_metadata.face_match`.
- A person reviews every submission. The route only sets the status to pending (`submit_verification_request` RPC), and admins approve in `/admin`.
- Images are deleted `STUDIO.legal.popia.retentionDays` (30) days after review by the daily cron (`app/api/cron/daily-maintenance/route.ts`, step 13, about lines 682 to 729). They are deleted at once on a resubmission after a rejection (the verifications route).
- At handover, staff see the selfie through a 15-minute signed URL (`app/api/admin/rentals/[id]/handover/route.ts:40`). In admin review, document links last one hour (`app/api/admin/verifications/[id]/route.ts`).

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | Biometric consent wording (POPIA s26/s27: special personal information) | REQUIRES_LEGAL_REVIEW | `ConsentStep.tsx` now gives a purpose-specific notice, separate from the Terms. It describes an automated comparison by "an AI service provider we use (currently Google)" followed by human review, and explains how to withdraw by email. It records `consent_purpose='biometric'` in `consent_records` and keeps writing `profiles.popia_consent_*`. |
| D2 | Identity of the processor | CONFIRMED (code) / NEEDS_VERIFICATION (contract) | The code shows Google's Gemini API. Confirm which Google account and project holds `GEMINI_API_KEY`, and under which terms. |
| D3 | **Gemini API tier** | REQUIRES_FOUNDER_APPROVAL (urgent) | CLAUDE.md describes the Gemma agents as "free tier". Google's terms for unpaid Gemini API use may allow submitted content to be used to improve its products and to be seen by human reviewers. Check whether this applies to the key in use. If the key is unpaid, ID documents should not be sent until billing is enabled or face matching is switched off. |
| D4 | Cross-border transfer (POPIA s72) for the face comparison | REQUIRES_LEGAL_REVIEW + NEEDS_VERIFICATION | The code cannot show where Google processes the images. The pages now say the images "may be processed outside South Africa" and name no country. Confirm the location and the s72 basis (agreement, binding rules, or consent). |
| D5 | Automated decision-making (s71) | CONFIRMED (code) | The automated result never decides alone: a human approves or rejects. |
| D6 | Withdrawal process | REQUIRES_FOUNDER_APPROVAL | The notice promises that, on an email to `STUDIO.privacyEmail`, "we then stop processing your ID and selfie and delete the images". This is a manual process today, with no self-service. Someone must own it and set a response time. |
| D7 | Earlier claim "all under written processing agreements" | Removed | It could not be verified. See F1. |
| D8 | Lawful basis per purpose | REQUIRES_LEGAL_REVIEW | Documented in the header of `lib/migrations/068-consent-records.sql`: contract acceptance for terms, rental agreement and owner terms; notice acknowledgement for privacy; explicit consent for biometric. |

## E. Consent records (migration 068)

| # | Item | Status | Notes |
|---|---|---|---|
| E1 | Table design | CONFIRMED (local) / NOT RUN on dev | `public.consent_records` is append-only. Clients may insert and select their own rows, with no update or delete. A withdrawal is a new row, and the database stamps `accepted_at` for client roles. Migration 027 (columns on `profiles`) was **not** reused: it is mutable, holds only the latest acceptance and covers one purpose. It is kept for the existing verification guard. The SQL tests in `068-consent-records.test.sql` all passed on a **local Postgres 16 stub** of the Supabase roles and `auth.uid()`. They have **not** been run on the dev Supabase project. |
| E2 | Retention of consent records vs account deletion | REQUIRES_LEGAL_REVIEW | 068 uses `ON DELETE CASCADE` to `auth.users`, as specified. Privacy s4/s8 say consent records are kept for "life of account plus 5 years". These conflict; decide which one is right. |
| E3 | Optional backfill of 027 history | REQUIRES_FOUNDER_APPROVAL | It is written as a commented block at the end of 068, and is not run by default. |
| E4 | Email sign-ups | NEEDS_VERIFICATION | The register form's checkbox is client-only and not recorded. Email users are asked once on `/welcome` (`source='signup'`). Anyone who signs in with a `?next=` destination skips `/welcome`; for hires, the checkout acceptance covers them. |
| E5 | Marketing opt-in | REQUIRES_LEGAL_REVIEW | It is still a boolean on `profiles.marketing_opt_in` (027) with no history. Consider adding a `marketing` purpose. |
| E6 | IP hashing | NEEDS_VERIFICATION | Set `CONSENT_IP_HASH_SECRET` in the environment. Without it the IP hash is unkeyed and could be brute-forced. |

## F. Operators, processors and cross-border transfers (POPIA s20, s21, s72)

| # | Operator | Status | What it processes (from code) |
|---|---|---|---|
| F1 | Operator agreements / DPAs for all of the operators below | NEEDS_VERIFICATION | No agreement is evidenced in the repo. |
| F2 | Supabase | NEEDS_VERIFICATION (region) | Database, auth, `verifications` storage bucket. |
| F3 | Paystack | NEEDS_VERIFICATION | The active provider (`PAYMENT_PROVIDER`, default `paystack`, lib/payments/index.ts). Handles payments, refunds and payouts. |
| F4 | Yoco, PayFast | NEEDS_VERIFICATION | Selectable by env (lib/payments/index.ts). Refunds of Yoco references (`ch_…`) route to Yoco (lib/payments/routing.ts). Confirm whether any Yoco or PayFast payment was ever taken; if so they hold historic data. |
| F5 | Cloudinary | CONFIRMED (code) | Holds user content: avatars, portfolio and gear photos (`app/api/cloudinary/sign`, `components/onboarding/*`). It does not hold verification documents. |
| F6 | Google | NEEDS_VERIFICATION | Gemini API (face match, gear and portfolio tagging, assistant fast tier), Google sign-in, and Gmail as the only implemented email provider (lib/email/index.ts). |
| F7 | AI providers for Ubunye and drafting tools | CONFIRMED (code) / NEEDS_VERIFICATION (which are configured in prod, retention terms) | `lib/ai/registry.ts` can route to Google, Anthropic, OpenAI and Groq (plus a self-hosted endpoint). The fallback chain is env-driven. The pages say "may include". |
| F8 | Vercel (hosting, cookie-free Web Analytics) | NEEDS_VERIFICATION | |
| F9 | Twilio (WhatsApp, not active) and OpenStreetMap Nominatim (address suggestions sent from the browser) | REQUIRES_LEGAL_REVIEW | Is Nominatim an operator, or a third party the user contacts directly? |

## G. Retention

| # | Data | Status | Notes |
|---|---|---|---|
| G1 | ID and selfie images | CONFIRMED (code) | Deleted 30 days after review (cron step 13). Caveat: a submission that is never reviewed (still `pending`) is never deleted. |
| G2 | Selfie needed at handover vs 30-day deletion | REQUIRES_FOUNDER_APPROVAL | The handover screen shows the selfie, but after 30 days it is gone. Decide which rule applies for later hires. |
| G3 | Face-match result, EXIF (including GPS), IP, user agent, document hash | REQUIRES_LEGAL_REVIEW | They are kept indefinitely on `profiles`. Privacy says "kept for longer, for fraud prevention"; set a period. |
| G4 | Ubunye chat history | REQUIRES_FOUNDER_APPROVAL | No retention period is defined. `lib/cron/faq-indexer.ts` mines conversations for FAQs. Privacy says "while they remain useful". |
| G5 | Transaction records (5 years) and banking details | REQUIRES_LEGAL_REVIEW | Check this against the Tax Administration Act. Also verify the claim "full account number not kept" after WS1's banking change. |

## H. PAIA

| # | Item | Status | Notes |
|---|---|---|---|
| H1 | PAIA manual (s51) | REQUIRES_LEGAL_REVIEW | Not published. /paia says "being prepared". Confirm whether an exemption for small private bodies applies, or publish a manual. |
| H2 | Information Officer registration | NEEDS_VERIFICATION | `STUDIO.legal.informationOfficer` names a person. Confirm they are registered with the Information Regulator. |
| H3 | Information Regulator address | NEEDS_VERIFICATION | Constants give "JD House, 27 Stiemens Street, Braamfontein". This may be out of date; check inforegulator.org.za and update `STUDIO.legal.informationRegulator.address` (the integration owner's file). It is shown on /privacy s14 and /paia s6. |
| H4 | Fees and prescribed forms | REQUIRES_LEGAL_REVIEW | /paia says we will say "if a prescribed form or fee applies". Confirm. |

## I. Commercial structure

| # | Item | Status | Notes |
|---|---|---|---|
| I1 | VAT status wording | CONFIRMED (founder decision 2026-10-08) / REQUIRES_LEGAL_REVIEW (wording) | `STUDIO.legal.vatRegistered=false`. All VAT-vendor wording is removed from the Terms, Privacy and Refunds pages: no VAT number, no tax invoices, no "including VAT". A later registration needs a new Terms version. |
| I2 | Rental agreement at handover | REQUIRES_LEGAL_REVIEW | The handover agreement is `lib/rental/agreement.ts` with `AGREEMENT_VERSION = '2026-09-28'`. `STUDIO.legal.documents.rentalAgreement` is version `2026-10-08` and points to Terms Part B (`/legal#equipment-hire`). Reconcile these into one versioned text, and check it states the 25% deposit. |
| I3 | Deposit change to 25% of replacement value | NEEDS_VERIFICATION | Terms s10 and Refunds s2 now say this (`RENTAL_POLICY.depositRateBps`), and existing bookings keep their stored deposit. Confirm the checkout (WS1) charges this before the pages go live. |
| I4 | Owner / creator agreement and IP | REQUIRES_FOUNDER_APPROVAL + REQUIRES_LEGAL_REVIEW | There is no separate agreement. `owner_terms` is versioned with the Terms (Part D). Terms s16 refers to "your production agreement" for rights in deliverables; confirm that agreement exists. The owner share is 80% (`RENTAL_POLICY.ownerShareBps`, Terms s17). |
| I5 | Merchant of record for third-party gear | REQUIRES_LEGAL_REVIEW | Terms s2/s17 make the company the merchant of record and supplier for every order, including community-owned gear. Review the consequences for CPA liability, insurance, tax on owner payouts, and the statement "funds are not held in escrow or in trust". |
| I6 | Response-time promises | CONFIRMED | They are now taken from `STUDIO.responseTime` on the legal pages. |

## J. Integration items (not in WS4's files)

- Add `/paia` to the footer legal links and to `app/sitemap.ts`.
- On `/dashboard/verification`, show `ConsentStep` when `GET /api/consent?context=verification` reports `biometric` missing. Users who accepted only the old POPIA notice otherwise skip the new biometric consent.
- The verifications route (WS2) should refuse uploads without a current `biometric` consent: `checkConsents(supabase, user.id, requiredConsents('verification'))`.
- Wire checkout consent: see `components/consent/TermsAcceptance.tsx` and `recordConsent`.
- Deploy order: **apply migration 068 before deploying this code.** Otherwise `/api/consent` returns 503 and the identity-check consent cannot be saved. `/welcome` deliberately lets people through when the table is missing.
