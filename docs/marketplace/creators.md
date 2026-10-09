# Creators offering services (spec §9.3–9.4)

How a photographer, videographer, editor or sound person goes from signing up
to being bookable, what each step writes, and what makes them bookable.

Target journey: **choose what you offer → add your portfolio and price →
go live**. Verification adds the one check it must (ID). This page records
what the code does today; see "Not done yet" for the gap to that target.

## Entry

`/welcome` asks once. "Offer my services" (`intent: 'supply'`) goes to
creator onboarding (`/onboarding`). Gear owners have their own answer, "List
my gear" (`intent: 'list'`), which goes straight to a photo-first listing
(`/dashboard/listings?new=1`, see `listings.md`) and is never sent through
creator onboarding (`homeFor`, `lib/welcome.ts`).

## Onboarding (`components/onboarding/`)

1. **Portfolio.** Photos are analysed for scene type (`/api/agents/portfolios`).
2. **Skills.** Detected skills are shown; the creator unticks what does not
   apply. Confirmed skills are written to the profile:
   `profiles.specializations` on the shared vocabulary
   (`CREATOR_SPECIALIZATIONS` in `lib/constants.ts`, mapped by
   `mergeSpecializations`, `lib/creators/specializations.ts`; e.g.
   `wedding_photography` → `photography`) and the skill names to
   `profiles.skills`. Creator search filters on `specializations`; before
   this, skills were kept only in `onboarding_progress` and a creator who
   finished onboarding could not be found by skill. The profile page's
   specialisation chips use the same list.
3. **Bio.** The confirmed bio is saved to `profiles.bio` and
   `profiles.crew_bio` (what the public creator profile shows).
4. **Gear** (optional). Saved as draft listings (see `listings.md`).

`POST /api/onboarding/complete` records `onboarding_completed_at` and creates
the creator's (unpublished) studio page. It **does not** switch on
`available_for_hire`: finishing onboarding is not a check. A creator becomes
available when their ID check is approved (the admin approval RPC sets it,
migration 033) and can switch it off and on from the profile page, which
also requires a payout account and a complete portfolio. The daily
auto-publish of creator studio pages (`autoPublishCreatorProductions`) only
publishes pages of verified, non-suspended creators, and the creator
directory (`getPublishedCreatorProfiles`) only lists verified creators.

## Portfolio before verification

`/dashboard/portfolio` and `/api/portfolio` work before the ID check. The
portfolio is saved on the profile but is not shown anywhere until the
creator is verified: every surface that shows creators requires a verified
ID (`lib/supabase/queries/crew.ts`, `getPublishedCreatorProfiles`, the
Ubunye search tools). The old verification check in `/api/portfolio`
protected nothing (the owner can write `portfolio_projects` directly,
migration 067); it only made creators wait. Onboarding photos are not
copied into a portfolio project (they have no stored storage id); the
creator adds portfolio projects on the portfolio page.

## What makes a creator bookable

Shown up front as a checklist on the profile (for anyone with creator
activity) and on the portfolio page (`CreatorBookableChecklist`,
`lib/creators/bookable.ts`). It mirrors the rules, it adds none:

| Item | Rule it reflects |
|---|---|
| ID check passed | booking and every public listing require `verification_status = 'verified'` |
| Portfolio: one project with 3+ photos | `hasCompletePortfolio` (`lib/portfolio/validation.ts`), required by the directory and the availability toggle |
| Payout account added | required by the profile page before switching availability on |
| Available for hire on | booking refuses a creator who switched it off |

## Booking a named creator

`POST /api/service-bookings` now checks the named creator (from the form, or
the one a package names) the same way the Ubunye path does
(`lib/agent/offers.ts`): verified, not switched off, not suspended
(`checkBookableCreator`, `lib/bookings/creator.ts`). A refusal is a 409 with
`code: 'creator_not_bookable'`; a failed read is a 503 (fails closed). No
creator named means the team assigns one, as before. Prices are not changed
by this check: they come from `PRODUCTION_SERVICES` (hourly) or the
package.

## Founder decisions

- **Creator `hourly_rate` vs category pricing.** The profile lets a creator
  set an hourly rate, and `createCreatorProduction` copies it to their studio
  page price, but `POST /api/service-bookings` charges the category rate
  (`getHourlyRate`, from `PRODUCTION_SERVICES`) for hourly bookings, not the
  creator's own rate. A creator's stated rate is therefore not what a client
  pays. Unchanged here; it needs a decision on whose price wins.
- **Payout account for availability.** The profile toggle needs a saved
  payout account, not a validated one (listings need validated). Kept as is.

## Not done yet

- The creator onboarding still starts with portfolio photos and AI skill
  detection, not "choose what you offer"; a service category picker as the
  first step, and a per-service price, are follow-ups.
- `getCrewBySpecializations` (`lib/supabase/queries/crew.ts`) matches
  `PRODUCTION_CATEGORIES[].creatorKeywords` (capitalised, e.g.
  "Photography") against `specializations` (stored lower-case). The overlap
  is case-sensitive, so those category pages may find no creators. Not
  changed here (not this stream's file).
- The welcome email (`lib/greetings/`) does not know the new `list` intent
  yet and treats it as no answer.
