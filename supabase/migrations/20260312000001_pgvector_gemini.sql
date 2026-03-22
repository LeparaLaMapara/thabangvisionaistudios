-- pgvector setup for Gemini text-embedding-004 (768 dimensions)
-- Run this in Supabase SQL Editor when using EMBEDDING_PROVIDER=gemini
--
-- NOTE: If switching from OpenAI (1536) to Gemini (768), you must:
--   1. Drop the existing table
--   2. Run this migration
--   3. Reindex all content via POST /api/admin/reindex

-- Enable pgvector extension
create extension if not exists vector;

-- Content embeddings table (768 dimensions for Gemini)
create table if not exists content_embeddings (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,        -- 'rental', 'production', 'press', 'career'
  content_id uuid not null,          -- FK to the source table row
  content_text text,                 -- Truncated text stored for debugging
  embedding vector(768) not null,    -- Gemini text-embedding-004
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(content_type, content_id)
);

-- Index for fast similarity search
create index if not exists content_embeddings_embedding_idx
  on content_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Index for filtering by content type
create index if not exists content_embeddings_type_idx
  on content_embeddings (content_type);

-- RPC function for similarity search
create or replace function match_content(
  query_embedding vector(768),
  match_threshold float default 0.5,
  match_count int default 5,
  filter_types text[] default null
)
returns table (
  content_type text,
  content_id uuid,
  content_text text,
  similarity float
)
language plpgsql
as $$
begin
  return query
    select
      ce.content_type,
      ce.content_id,
      ce.content_text,
      1 - (ce.embedding <=> query_embedding) as similarity
    from content_embeddings ce
    where
      (filter_types is null or ce.content_type = any(filter_types))
      and 1 - (ce.embedding <=> query_embedding) > match_threshold
    order by ce.embedding <=> query_embedding
    limit match_count;
end;
$$;
