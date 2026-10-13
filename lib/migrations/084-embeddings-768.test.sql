-- 084 test: the embedding column takes 768 numbers, refuses 1536, and
-- match_content finds the nearest row. Rolls back.
begin;

do $$
declare
  v768 text := '[' || array_to_string(array_fill(0.01::float, array[768]), ',') || ']';
  v1536 text := '[' || array_to_string(array_fill(0.01::float, array[1536]), ',') || ']';
  hits int;
begin
  insert into public.content_embeddings (content_type, content_id, content_text, embedding)
  values ('rental', gen_random_uuid(), '084 test row', v768::extensions.vector);

  select count(*) into hits
    from public.match_content(v768::extensions.vector, 0.9, 5, array['rental'])
   where content_text = '084 test row';
  if hits <> 1 then raise exception '084 FAIL: match_content did not find the 768 row'; end if;

  begin
    insert into public.content_embeddings (content_type, content_id, content_text, embedding)
    values ('rental', gen_random_uuid(), '084 wrong size', v1536::extensions.vector);
    raise exception '084 FAIL: a 1536-number embedding was accepted';
  exception when data_exception then null;
  end;

  if not exists (select 1 from pg_indexes where indexname = 'content_embeddings_embedding_idx' and indexdef ilike '%hnsw%') then
    raise exception '084 FAIL: embedding index is not HNSW';
  end if;

  raise notice '084 test passed';
end $$;

rollback;
