# TASK-060: Remove test rows from production
## Priority: MEDIUM | Phase: V4 | Depends on: none
## Files allowed: (none — data change, owner decision)
## Description
Two rows are published and publicly visible on production. Flagged repeatedly
on 2026-08-27 and deliberately left alone, because deleting the owner's content
is his call and not the assistant's.

  1. `listings` — a listing titled "testing listing", is_published = true, live
     on the marketplace.
  2. `careers` — two AI Engineer posts are published: a real one with a full
     description, and a stub titled "Ai Engineer" whose body is "Building AI
     Solutions".
## Acceptance criteria
- [ ] "testing listing" unpublished or deleted
- [ ] The duplicate "Ai Engineer" stub unpublished or deleted
- [ ] The real "AI Engineer" post left intact
