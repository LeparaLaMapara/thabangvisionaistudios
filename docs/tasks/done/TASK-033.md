# TASK-033: Marketplace - Creator Listing Flow
## Priority: FEATURE | Phase: V3 | Depends on: TASK-030
## Files allowed: app/(dashboard)/dashboard/listings/page.tsx, app/api/listings/route.ts
## Description
Verified creators list gear that appears in unified marketplace.
## Acceptance criteria
- [ ] Listings insert into smart_rentals with owner_type='community'
- [ ] owner_id set to user ID
- [ ] Creators edit/delete only their own (owner_id match)
- [ ] Unverified users see "Get verified first"
- [ ] npm run build passes
