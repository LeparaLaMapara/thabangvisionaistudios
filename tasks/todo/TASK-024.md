# TASK-024: RAG - Admin Reindex Route
## Priority: FEATURE | Phase: V3 | Depends on: TASK-022
## Files allowed: app/api/admin/reindex/route.ts
## Description
Admin-only API route to reindex all content embeddings.
## Acceptance criteria
- [ ] POST handler, admin only (ADMIN_EMAILS check)
- [ ] Calls reindexAll()
- [ ] Returns { success, indexed, errors, duration }
- [ ] npm run build passes
