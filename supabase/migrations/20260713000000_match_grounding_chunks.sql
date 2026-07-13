create or replace function match_grounding_chunks(
  query_embedding vector(1024),
  match_count int default 5
)
returns table (
  chunk_text text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    chunk_text,
    metadata,
    1 - (embedding <=> query_embedding) as similarity
  from grounding_embeddings
  order by embedding <=> query_embedding
  limit match_count;
$$;
