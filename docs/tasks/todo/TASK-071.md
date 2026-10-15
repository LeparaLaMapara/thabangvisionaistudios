# TASK-071: Search embeddings on EmbeddingGemma 2 (open model), starting with search by photo
## Priority: LOW | Parked by the owner on 2026-10-13, scope set 2026-10-15
## Files allowed: lib/rag/embeddings/*, a new small hosting service, a photo-search route and page section, .env.example

## Why
The owner prefers open models. EmbeddingGemma 2 (Google DeepMind, released
2026-10-06, Apache 2.0, 740M parameters, built on Gemma 4) embeds text, code,
images, video and audio into one 768-dimension space, so it fits
`content_embeddings` (084) as is.

What only it gives us: one space for words AND pictures. So:
- search by photo: a customer uploads a picture of a camera and gets that gear
  or similar gear from our listings;
- creators matched to a brief by their portfolio photos, not only their words;
- duplicate listings (the same item twice) found by photo.

## The catch
It is NOT served by the Gemini API (checked 2026-10-13 and again 2026-10-15:
the Gemma 4 models there are chat models). Google says Model Garden hosting is
"coming soon", no date. Until then it needs our own host.

## Owner decisions (2026-10-15)
- Keep `gemini-embedding-2` for text search now: it works and costs almost
  nothing at our size. Do not switch everything yet.
- First try photo search on the TEST site (develop / nonprod) only.
- Pay for hosting from the Google for Startups Cloud credits (applied for on
  2026-10-14/15, billing account 011F7E-B271DD-E43B64). Start once they arrive,
  or once Google hosts the model.

## Plan
1. Host it on Cloud Run in the `thabangvision` GCP project, scale to zero
   (free monthly allowance; credits cover the rest). Ollama or the Hugging Face
   weights. CPU first: text is quick; a photo may take a second or two; the
   first request after a quiet spell waits a few seconds while it wakes.
2. Add `lib/rag/embeddings/embeddinggemma.ts` behind `EMBEDDING_PROVIDER=embeddinggemma`,
   with an image input as well as text.
3. Photo search on the test site: embed each listing's first photo into its
   own index (vectors from different models are not comparable, so it never
   mixes with the gemini-embedding-2 text index), then an upload box that
   returns the closest listings.
4. Judge it with the owner on real photos (a camera, a lens, a light, a mic)
   against our 25 listings. If it is useful, put it on the live site.
5. Only then consider moving text search too: switch, reindex
   (POST /api/admin/reindex), compare on the same questions as the 2026-10-13
   check (wedding camera, studio lights, interview microphone, jobs).

## Today
`gemini-embedding-2` at 768 (lib/rag/embeddings/gemini.ts). Smart search box
(components/search/GlobalSearch.tsx) built but not on any page; RAG_ENABLED is
off. Switching that on is a separate, cheaper step and does not wait for this task.
