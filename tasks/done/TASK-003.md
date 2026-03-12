# TASK-003: Security - Admin Role Verification
## Priority: CRITICAL | Phase: V2 | Depends on: TASK-002
## Files allowed: app/(admin)/layout.tsx
## Description
Admin layout must check ADMIN_EMAILS from constants.ts, not just "is logged in".
## Acceptance criteria
- [ ] Imports ADMIN_EMAILS from lib/constants.ts
- [ ] Checks user email against ADMIN_EMAILS
- [ ] Non-admin logged-in users get 403 or redirect
- [ ] npm run build passes
