# TASK-007: Security - Social Link XSS Prevention
## Priority: HIGH | Phase: V2 | Depends on: none
## Files allowed: app/(platform)/creators/[id]/CreatorProfileClient.tsx
## Description
Validate social link URLs to prevent javascript: and data: protocol XSS.
## Acceptance criteria
- [ ] isSafeUrl() only allows https: and http:
- [ ] javascript: and data: URLs blocked
- [ ] Links only render if isSafeUrl() returns true
- [ ] npm run build passes
