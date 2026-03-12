# TASK-031: Marketplace - Ranking Algorithm
## Priority: FEATURE | Phase: V3 | Depends on: TASK-030
## Files allowed: lib/ranking/calculate.ts, app/api/admin/recalculate-rankings/route.ts
## Description
Implement ranking score calculation for gear marketplace.
## Acceptance criteria
- [ ] calculateRankingScore() with scoring formula (+100 studio, +50 verified, +20 per 5-star, +15 available, +30 featured, +5 complete profile)
- [ ] Admin route to recalculate all rankings
- [ ] npm run build passes
