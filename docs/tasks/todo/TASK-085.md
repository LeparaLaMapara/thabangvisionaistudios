# TASK-085: Many roles, honest proof (first slice)
## Priority: HIGH | Started 2026-10-14 | Branch feature/roles-and-proof
## Design: docs/processes/roles-and-proof.md

## Goal
Anyone can join ThabangVision as a make-up artist, model, driver with vehicle
or photographer/videographer, without a portfolio or certificate. A guided
profile maker turns their phone photos into a profile; a person reviews it
against published guidelines; clients see one "Verified" mark, the work, a real
job count and a clear price.

## Steps
- [x] 1. Plan: docs/processes/roles-and-proof.md and this file.
- [x] 2. Migration 090: `roles`, `person_roles`, `role_evidence`,
      `role_interest`, private bucket `role-documents`, flag `roles_v1` (off),
      catalogue seed (4 live, 7 coming soon). RLS, column grants, trigger.
      Rollback in scripts/db/rollback/. Test 090-roles-and-proof.test.sql.
- [x] 3. Applied to DEV (thabangvision-dev), test passed, `roles_v1` ON in dev.
      Recorded in docs/database/README.md (dev-applied, prod pending).
- [x] 4. lib/roles: ladder (evidence level, job-size limit), legal
      requirements, age check, proof progress, capture labelling, pricing,
      what clients see, submit check. Unit tests: tests/unit/roles-logic.test.ts.
- [x] 5. Pages: /join, /join/[role] (profile maker), /people, /people/[id],
      /admin/roles (review queue). API: /api/roles/*, /api/admin/roles.
- [x] 6. Nav entry "Join" behind `roles_v1`; admin menu "Role profiles".
- [x] 7. Demo data on dev: scripts/roles/seed-demo.sql, remove-demo.sql.
- [x] 7b. One way in for offering (owner, 2026-10-14): /offer with the
      describe step and the AI match (agent role-match, keyword fallback),
      /offer/[role] profile maker, welcome "Offer something" replaces list and
      supply, /join and /onboarding are deep links into Offer, no separate Join
      nav entry. Finding stays the existing browse pages (no new search box or
      hero). Saved intents map onto find/offer.
- [x] 7c. Existing accounts: profile maker prefills from the profile; old
      portfolio photos carried over as uploaded evidence;
      scripts/roles/backfill-existing.sql (drafts only, never approved). Ran on
      dev: 0 drafts (no creator data there). Not run on production (would touch
      about 1 to 3 people).
- [x] 7d. Stabilised for merge: every roles page and API route answers 404
      with roles_v1 off (no roles table is read), so main can take this code
      before production has migration 090.
- [ ] Next slice (designed, see the design doc "Designed, not built yet"):
      equal chance (blind profiles, reveal on a confirmed paid booking,
      competence-only ranking, the model exception), the 3-screen Offer flow
      (photo, show us your work, price and area) with the profile preview,
      CV extraction with PII stripped (agent profile-extract), profile
      embeddings and matching (migration 091), proof formats, the "Who's
      coming" card and booking requests, the face check, the names (People,
      Rentals, Earn with ThabangVision), "comes with".
- [ ] Later: self-drive vehicle hire as a Rentals listing.
- [ ] Later: Teams (after People is live and we have track records); start
      collecting co-booking pairs, per-booking client ratings and a private
      "would work with them again" now.
- [ ] 8. Owner review on the preview: prices, first roles, guidelines wording
      (see "Decisions for the owner" in the design doc).
- [ ] 9. A few real people try the maker on dev; fix what confuses them.
- [ ] 10. Production: apply 090 (flag stays off), invite by link, review, then
      switch `roles_v1` on.
- [ ] 11. Next slice: booking and held payment for these roles, completed jobs
      written to `role_evidence`, approval and send-back notices.

## Rules kept
- Existing creator onboarding (/onboarding) unchanged; the photographer role
  links to it.
- Business values in lib/constants.ts (`ROLES_POLICY`) or the `roles` table.
- Production untouched: no migration, no env var, flag absent.

## Done when
- The owner has walked /join, one /join/<role>, a demo profile and
  /admin/roles on the preview and made the decisions above.
