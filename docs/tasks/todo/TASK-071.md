# TASK-071: Search embeddings on EmbeddingGemma 2 (open model)
## Priority: LOW | Parked by the owner on 2026-10-13
## Files allowed: lib/rag/embeddings/*, a new small hosting service, .env.example

## Why
The owner prefers open models. EmbeddingGemma 2 (Google DeepMind, released
2026-10-06, Apache 2.0, built on Gemma 4) embeds text, code, images, video and
audio into one 768-dimension space, so it fits `content_embeddings` (084) as is.

## The catch
It is NOT served by the Gemini API (checked against the live model list on
2026-10-13); it is a download (Hugging Face, Kaggle). Google says Model Garden
hosting is "coming soon". Until then it needs our own host.

## Plan
1. Host it: Cloud Run in the `thabangvision` GCP project (scale to zero), text
   weights only to start (270M). Or Model Garden once listed.
2. Add `lib/rag/embeddings/embeddinggemma.ts` behind `EMBEDDING_PROVIDER=embeddinggemma`.
3. Vectors from different models are not comparable: switch, then reindex
   (POST /api/admin/reindex). Compare search quality on the same questions as the
   2026-10-13 check (wedding camera, studio lights, interview microphone, jobs).

## Today
`gemini-embedding-2` at 768 (lib/rag/embeddings/gemini.ts), working on dev.
