# TASK-004: Security - Cloudinary Route Auth
## Priority: CRITICAL | Phase: V2 | Depends on: none
## Files allowed: app/api/cloudinary/**/route.ts
## Description
Add auth to all Cloudinary routes. Sign = any authenticated user. Delete = admin only.
## Acceptance criteria
- [ ] /api/cloudinary/sign requires valid session
- [ ] /api/cloudinary/delete requires ADMIN_EMAILS
- [ ] /api/cloudinary/destroy-folder requires ADMIN_EMAILS
- [ ] Unauthenticated → 401, non-admin delete → 403
- [ ] npm run build passes
