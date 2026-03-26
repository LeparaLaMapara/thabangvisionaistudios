# TASK-001: Security - Middleware Verification
## Priority: CRITICAL | Phase: V2 | Depends on: none
## Files allowed: middleware.ts, proxy.ts
## Description
Ensure middleware.ts exists and runs on all protected routes. If proxy.ts exists, rename to middleware.ts.
## Acceptance criteria
- [ ] middleware.ts exists in project root
- [ ] proxy.ts does not exist
- [ ] Matcher includes /dashboard/:path*, /admin/:path*, /api/admin/:path*
- [ ] Middleware refreshes Supabase session on protected routes
- [ ] npm run build passes
- [ ] npm run test passes
