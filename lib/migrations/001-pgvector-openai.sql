-- pgvector setup for OpenAI text-embedding-3-small (1536 dimensions)
-- Run this in Supabase SQL Editor when using EMBEDDING_PROVIDER=openai
--
-- NOTE: If switching from Gemini (768) to OpenAI (1536), you must:
--   1. Drop the existing table
--   2. Run this migration
--   3. Reindex all content via POST /api/admin/reindex

-- Enable pgvector extension
create extension if not exists vector;

-- Content embeddings table (1536 dimensions for OpenAI)
create table if not exists content_embeddings (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,        -- 'rental', 'production', 'press', 'career'
  content_id uuid not null,          -- FK to the source table row
  content_text text,                 -- Truncated text stored for debugging
  embedding vector(1536) not null,   -- OpenAI text-embedding-3-small
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
  query_embedding vector(1536),
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
