# TASK-011: Abstraction - Email Provider Layer
## Priority: FEATURE | Phase: V2 | Depends on: none
## Files allowed: lib/email/*, app/api/contact/route.ts
## Description
Create email abstraction layer. Wrap existing Nodemailer/Gmail code.
## Acceptance criteria
- [ ] lib/email/types.ts — EmailProvider interface
- [ ] lib/email/gmail.ts — implements using existing Nodemailer
- [ ] lib/email/index.ts — reads EMAIL_PROVIDER env
- [ ] No direct nodemailer imports in app/
- [ ] npm run build passes
