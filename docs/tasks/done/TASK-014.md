# TASK-014: UI - Dark Mode Lock
## Priority: FEATURE | Phase: V2 | Depends on: none
## Files allowed: app/layout.tsx, app/globals.css, any ThemeProvider config
## Description
Force dark mode everywhere. Remove all theme toggles.
## Acceptance criteria
- [ ] ThemeProvider forcedTheme="dark" defaultTheme="dark"
- [ ] ALL theme toggle components removed
- [ ] No "Switch to Light Mode" text
- [ ] No bg-white, text-black in components
- [ ] npm run build passes
