# TASK-018: Ubunye - Streaming Responses
## Priority: FEATURE | Phase: V3 | Depends on: TASK-017
## Files allowed: app/api/ubunye-chat/route.ts, components/ubunye/UbunyeChat.tsx
## Description
Add streaming to Ubunye chat so responses appear token by token.
## Acceptance criteria
- [ ] export const maxDuration = 30
- [ ] Uses ai.streamMessage() from abstraction
- [ ] Returns text/event-stream response
- [ ] Frontend reads stream progressively
- [ ] Works on Vercel without timeout
- [ ] npm run build passes
