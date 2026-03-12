# TASK-020: Ubunye - Message Limits
## Priority: FEATURE | Phase: V3 | Depends on: TASK-018
## Files allowed: components/ubunye/UbunyeChat.tsx, app/api/ubunye-chat/route.ts
## Description
Limit unauthenticated users to 5 free messages per session.
## Acceptance criteria
- [ ] Not logged in: 5 messages (sessionStorage)
- [ ] After limit: "Sign in to continue" with buttons
- [ ] "X messages remaining" below input
- [ ] Logged in: unlimited
- [ ] API returns 429 when exceeded
- [ ] npm run build passes
