import Anthropic from "@anthropic-ai/sdk";
import type { LLMCompleteRequest, LLMCompleteResponse, LLMStreamRequest, LLMStreamChunk } from "./types";
import type { LLMProvider } from "./LLMProvider";

// Mirrors the SDK's TextBlockParam shape without importing the SDK type by name.
// cache_control allows null per the SDK signature, so we widen here.
type SdkSystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' } | null;
};

function toSdkSystem(
  system: LLMCompleteRequest['system'],
): string | SdkSystemBlock[] | undefined {
  if (system === undefined) return undefined;
  if (typeof system === 'string') return system;
  // LLMSystemBlock is structurally compatible with SdkSystemBlock
  return system as SdkSystemBlock[];
}

export class AnthropicProvider implements LLMProvider {
  async complete(request: LLMCompleteRequest): Promise<LLMCompleteResponse> {
    if (process.env.ANTHROPIC_API_KEY === 'mock') {
      throw new Error('AnthropicProvider: mock API key — handle mock mode above this layer');
    }

    const anthropic = new Anthropic();
    const sysParam = toSdkSystem(request.system);

    const response = await anthropic.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      ...(sysParam !== undefined ? { system: sysParam } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      messages: request.messages as Anthropic.MessageParam[],
    });

    const textBlock = response.content.find(b => b.type === "text");
    return {
      text: textBlock?.type === "text" ? textBlock.text : "",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: (response.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
        cacheWriteTokens: (response.usage as unknown as Record<string, number>).cache_creation_input_tokens ?? 0,
      },
    };
  }

  async *stream(request: LLMStreamRequest): AsyncGenerator<LLMStreamChunk> {
    if (process.env.ANTHROPIC_API_KEY === 'mock') {
      throw new Error('AnthropicProvider: mock API key — handle mock mode above this layer');
    }

    const anthropic = new Anthropic();
    const sysParam = toSdkSystem(request.system);

    const sdkStream = anthropic.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens,
      ...(sysParam !== undefined ? { system: sysParam } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      messages: request.messages as Anthropic.MessageParam[],
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    try {
      for await (const event of sdkStream) {
        if (event.type === "message_start") {
          inputTokens = event.message.usage.input_tokens;
          cacheReadTokens = (event.message.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0;
          cacheWriteTokens = (event.message.usage as unknown as Record<string, number>).cache_creation_input_tokens ?? 0;
        } else if (event.type === "message_delta") {
          outputTokens = event.usage.output_tokens;
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    } catch (err) {
      throw err;
    }

    yield { __usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } };
  }
}
