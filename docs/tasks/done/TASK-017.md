# TASK-017: Ubunye - System Prompt Builder
## Priority: FEATURE | Phase: V3 | Depends on: TASK-008
## Files allowed: lib/ubunye/system-prompt.ts
## Description
Build context-aware system prompt from constants + Supabase data.
## Acceptance criteria
- [ ] Imports STUDIO and PRODUCTION_SERVICES from constants.ts
- [ ] Fetches live data from Supabase (Promise.all)
- [ ] Caches platform data 5 minutes
- [ ] User data always fresh
- [ ] Zero hardcoded values in prompt
- [ ] Includes: about, contact, services, rates, catalogue, productions, creators, press, careers, user context, quoting rules, privacy rules
- [ ] npm run build passes
