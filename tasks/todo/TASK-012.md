# TASK-012: Abstraction - Search Provider Layer
## Priority: FEATURE | Phase: V2 | Depends on: none
## Files allowed: lib/search/*, app/api/search/route.ts
## Description
Create search abstraction layer. Wrap existing Supabase search.
## Acceptance criteria
- [ ] lib/search/types.ts — SearchProvider interface
- [ ] lib/search/supabase.ts — implements using existing code
- [ ] lib/search/index.ts — reads SEARCH_PROVIDER env
- [ ] /api/search uses abstraction
- [ ] npm run build passes
