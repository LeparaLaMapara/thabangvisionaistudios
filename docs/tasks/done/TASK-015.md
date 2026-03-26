# TASK-015: UI - Font Optimization
## Priority: FEATURE | Phase: V2 | Depends on: none
## Files allowed: app/layout.tsx, app/globals.css, tailwind.config.ts
## Description
Switch to next/font/google for consistent fonts on all devices.
## Acceptance criteria
- [ ] Uses next/font/google for Syne and Space Mono
- [ ] Font variables applied to body
- [ ] No @import url('fonts.googleapis.com') in CSS
- [ ] Tailwind config maps font variables
- [ ] npm run build passes
