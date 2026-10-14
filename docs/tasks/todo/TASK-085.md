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
