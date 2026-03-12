# TASK-021: RAG - Embedding Pipeline
## Priority: FEATURE | Phase: V3 | Depends on: none
## Prereq: Thabang runs pgvector SQL in Supabase
## Files allowed: lib/rag/embeddings.ts
## Description
Generate vector embeddings using OpenAI text-embedding-3-small.
## Acceptance criteria
- [ ] generateEmbedding(text) returns number[1536]
- [ ] Uses OpenAI text-embedding-3-small
- [ ] Handles missing API key gracefully
- [ ] Truncates input to 8000 tokens
- [ ] npm run build passes
