# TASK-025: RAG - Auto-Index on Content Change
## Priority: FEATURE | Phase: V3 | Depends on: TASK-022
## Files allowed: app/api/admin/rentals/route.ts, app/api/admin/productions/route.ts, app/api/admin/press/route.ts, app/api/admin/careers/route.ts
## Description
Auto-generate embeddings when admin creates or updates content.
## Acceptance criteria
- [ ] After save, calls indexItem() for the content
- [ ] Wrapped in try/catch (indexing failure doesn't block save)
- [ ] Only runs if RAG_ENABLED=true
- [ ] npm run build passes
