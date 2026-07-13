import { getSupabaseClient } from '@/lib/supabase/client';

export interface RagChunk {
  chunk_text: string;
  metadata: any;
  similarity: number;
}

export async function retrieveRelevantChunks(inputText: string, topK: number = 5): Promise<RagChunk[]> {
  try {
    const embeddingRes = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'voyage-code-3', input: [inputText] }),
    });

    if (!embeddingRes.ok) {
      console.warn('[ragRetriever] Voyage API error:', embeddingRes.status);
      return [];
    }

    const embeddingData: { data: { embedding: number[] }[] } = await embeddingRes.json();
    const embedding = embeddingData.data[0].embedding;

    const sb = getSupabaseClient();
    if (!sb) return [];

    const { data, error } = await sb.rpc('match_grounding_chunks', {
      query_embedding: embedding,
      match_count: topK,
    });

    if (error || !data) {
      console.warn('[ragRetriever] Supabase query failed:', error?.message);
      return [];
    }

    const chunks = (data as RagChunk[]).map(row => ({
      chunk_text: row.chunk_text,
      metadata: row.metadata,
      similarity: row.similarity,
    }));
    console.log(`[RAG] Retrieved ${chunks.length} chunks, top similarity: ${chunks[0]?.similarity?.toFixed(3)}`);
    return chunks;
  } catch (err) {
    console.error('[ragRetriever] unexpected error:', err);
    return [];
  }
}
