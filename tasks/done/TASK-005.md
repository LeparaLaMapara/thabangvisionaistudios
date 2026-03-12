# TASK-005: Security - Ubunye Chat Auth + Rate Limiting
## Priority: HIGH | Phase: V2 | Depends on: none
## Files allowed: app/api/gemini/route.ts OR app/api/ubunye-chat/route.ts
## Description
Add authentication and rate limiting to the Ubunye chat endpoint.
## Acceptance criteria
- [ ] Requires valid session
- [ ] In-memory rate limiting: 10 requests/minute per user
- [ ] Returns 429 with retry info when exceeded
- [ ] Unauthenticated → 401
- [ ] npm run build passes
