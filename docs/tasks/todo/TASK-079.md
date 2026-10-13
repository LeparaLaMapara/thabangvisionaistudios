# TASK-079: Verified credits
## Priority: MEDIUM | Added by the owner on 2026-10-13
## Files allowed: app/creators/*, lib/credits/*, a new migration

## Why
A profile should show what a person really worked on, proven by the platform,
not just claimed. Credits are the main signal for crew matching (TASK-074).

## Plan
1. A credit is created automatically when a booking finishes: project,
   role, date, client (if the client allows), review.
2. Off-platform work can be added but shows as "claimed" until a
   collaborator on the platform confirms it.
3. Profile shows credits by role, with counts ("12 shoots as gaffer").
4. Crew matching and search rank on verified credits first.
5. Client name and project hidden by default for private work (NDA).
