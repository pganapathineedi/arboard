import { getLLMProvider } from "@/lib/llm";

// ~4000 tokens ≈ 16 000 chars. Docs under this threshold go straight through.
const PASS_THROUGH_CHARS = 16_000;
// Each chunk ≈ 3000 tokens so Haiku can produce a 600-token summary comfortably.
const CHUNK_SIZE = 12_000;

async function summariseChunk(chunk: string, index: number, total: number): Promise<string> {
  const provider = getLLMProvider();
  const { text } = await provider.complete({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 600,
    messages: [
      {
        role: "user",
        content:
          `You are summarising section ${index + 1} of ${total} from a solution design or requirements document.\n` +
          `Preserve every technical decision, Salesforce component, integration, constraint, data volume, ` +
          `compliance requirement, and architecture choice. Write in present tense, bullet-point style.\n\n` +
          `SECTION:\n${chunk}`,
      },
    ],
  });
  return text;
}

async function finalMerge(summaries: string[]): Promise<string> {
  const combined = summaries.join("\n\n---\n\n");
  const provider = getLLMProvider();
  const { text } = await provider.complete({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2000,
    messages: [
      {
        role: "user",
        content:
          `Merge these section summaries of a solution design document into a single coherent technical brief.\n` +
          `Preserve all Salesforce architecture decisions, components, integrations, risks, data volumes, ` +
          `and compliance requirements. Remove duplication but keep every unique technical detail.\n\n` +
          `SUMMARIES:\n${combined}`,
      },
    ],
  });
  return text || combined;
}

export async function maybeSummarise(text: string): Promise<{ text: string; wasChunked: boolean }> {
  if (text.length <= PASS_THROUGH_CHARS) {
    return { text, wasChunked: false };
  }

  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  const summaries = await Promise.all(chunks.map((c, i) => summariseChunk(c, i, chunks.length)));
  const combined = summaries.join("\n\n---\n\n");

  const finalText =
    combined.length > PASS_THROUGH_CHARS ? await finalMerge(summaries) : combined;

  return { text: finalText, wasChunked: true };
}
