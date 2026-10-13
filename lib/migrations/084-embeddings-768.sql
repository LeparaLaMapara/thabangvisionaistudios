-- 084: content_embeddings back to 768 dimensions, with an HNSW index.
--
-- Dev and production both ran 001-pgvector-openai.sql (1536 dimensions) while
-- the app embeds with Gemini at 768 (EMBEDDING_PROVIDER=gemini, the default),
-- so every write and every search failed with "expected 1536 dimensions".
-- Found 2026-10-13 when text-embedding-004 (shut down) was replaced by
-- gemini-embedding-2 at 768.
--
-- The rows are derived data (rebuilt by POST /api/admin/reindex), so any rows
-- in the wrong size are deleted. The ivfflat index (lists = 100) is replaced
-- with HNSW: ivfflat built on an empty or small table misses most matches.
--
-- Safe to run more than once. Locally (001-pgvector-gemini.sql, already 768)
-- it only swaps the index. Apply by hand to dev and prod; then reindex.

begin;

do $$
begin
  if to_regclass('public.content_embeddings') is null then
    raise notice '084: no content_embeddings table, nothing to do';
    return;
  end if;

  if format_type(
       (select atttypid from pg_attribute where attrelid = 'public.content_embeddings'::regclass and attname = 'embedding'),
       (select atttypmod from pg_attribute where attrelid = 'public.content_embeddings'::regclass and attname = 'embedding')
     ) not like '%vector(768)' then
    drop index if exists public.content_embeddings_embedding_idx;
    delete from public.content_embeddings;
    alter table public.content_embeddings alter column embedding type extensions.vector(768);
    raise notice '084: content_embeddings.embedding is now vector(768); reindex from /api/admin/reindex';
  end if;

  drop index if exists public.content_embeddings_embedding_idx;
  create index content_embeddings_embedding_idx
    on public.content_embeddings using hnsw (embedding extensions.vector_cosine_ops);
end $$;

commit;
