# TASK-022: RAG - Indexer
## Priority: FEATURE | Phase: V3 | Depends on: TASK-021
## Files allowed: lib/rag/indexer.ts
## Description
Index content by generating embeddings and storing in Supabase.
## Acceptance criteria
- [ ] buildContentString() for each table type
- [ ] indexItem() generates embedding → stores in Supabase
- [ ] reindexAll() loops all published content
- [ ] Returns { indexed, errors, duration }
- [ ] npm run build passes
