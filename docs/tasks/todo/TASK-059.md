# TASK-059: Enable leaked password protection
## Priority: MEDIUM | Phase: V4 | Depends on: none
## Files allowed: (none — Supabase dashboard setting)
## Description
Supabase Auth can check passwords against HaveIBeenPwned and refuse known
compromised ones. Currently disabled on both projects; flagged by the Supabase
security advisor on 2026-08-27.

This is a project setting. It cannot be enabled from SQL or a migration, so it
needs someone in the dashboard: Authentication → Policies → Password strength.
## Acceptance criteria
- [ ] Enabled on prod (zbdsqvpxpsygbuqnuekm)
- [ ] Enabled on dev (bprargrqppufeuewryze)
- [ ] Supabase security advisor no longer reports auth_leaked_password_protection
