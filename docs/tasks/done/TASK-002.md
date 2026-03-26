# TASK-002: Security - Admin Route Authentication
## Priority: CRITICAL | Phase: V2 | Depends on: TASK-001
## Files allowed: app/api/admin/**/route.ts, lib/auth/admin.ts (create)
## Description
Add auth checks to ALL /api/admin/* routes. Create shared requireAdmin() helper.
## Acceptance criteria
- [ ] lib/auth/admin.ts exports requireAdmin()
- [ ] Every app/api/admin/ route calls requireAdmin()
- [ ] Unauthenticated → 401
- [ ] Non-admin authenticated → 403
- [ ] Admin authenticated → proceeds normally
- [ ] npm run build passes
