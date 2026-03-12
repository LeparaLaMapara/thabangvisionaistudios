# TASK-023: RAG - Retrieval
## Priority: FEATURE | Phase: V3 | Depends on: TASK-021
## Files allowed: lib/rag/retrieval.ts
## Description
Search by embedding similarity using Supabase match_content RPC.
## Acceptance criteria
- [ ] searchSimilar() generates query embedding
- [ ] Calls match_content() RPC
- [ ] Returns ranked results with similarity scores
- [ ] npm run build passes
