import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { LLMCompleteRequest, LLMCompleteResponse, LLMStreamRequest, LLMStreamChunk, LLMUsage } from './types';
import type { LLMProvider } from './LLMProvider';

const MODEL_MAP: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-sonnet-4-6':         'anthropic.claude-sonnet-4-6-20250514-v1:0',
  'claude-haiku-4-5':          'anthropic.claude-haiku-4-5-20251001-v1:0',
};

function toBedrockModelId(model: string): string {
  return MODEL_MAP[model] ?? model;
}

function makeClient(): BedrockRuntimeClient {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'BedrockProvider: AWS credentials not configured — set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY',
    );
  }

  return new BedrockRuntimeClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function buildRequestBody(request: LLMCompleteRequest): Record<string, unknown> {
  // Strip cache_control — Bedrock has its own caching mechanism
  const system = request.system === undefined
    ? undefined
    : typeof request.system === 'string'
      ? request.system
      : request.system.map(({ type, text }) => ({ type, text }));

  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: request.maxTokens,
    ...(system !== undefined ? { system } : {}),
    messages: request.messages,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
  };
}

export class BedrockProvider implements LLMProvider {
  async complete(request: LLMCompleteRequest): Promise<LLMCompleteResponse> {
    const client = makeClient();
    const body = JSON.stringify(buildRequestBody(request));

    const command = new InvokeModelCommand({
      modelId: toBedrockModelId(request.model),
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await client.send(command);
    const decoded = JSON.parse(new TextDecoder().decode(response.body)) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const textBlock = decoded.content.find(b => b.type === 'text');
    return {
      text: textBlock?.text ?? '',
      usage: {
        inputTokens: decoded.usage.input_tokens,
        outputTokens: decoded.usage.output_tokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }

  async *stream(request: LLMStreamRequest): AsyncGenerator<LLMStreamChunk> {
    const client = makeClient();
    const body = JSON.stringify(buildRequestBody(request));

    const command = new InvokeModelWithResponseStreamCommand({
      modelId: toBedrockModelId(request.model),
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await client.send(command);
    const usage: LLMUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

    if (!response.body) {
      yield { __usage: usage };
      return;
    }

    for await (const event of response.body) {
      if (!event.chunk?.bytes) continue;

      const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes)) as {
        type: string;
        delta?: { type: string; text?: string };
        message?: { usage: { input_tokens: number; output_tokens: number } };
        usage?: { output_tokens: number };
      };

      if (chunk.type === 'message_start' && chunk.message?.usage) {
        usage.inputTokens = chunk.message.usage.input_tokens;
      } else if (chunk.type === 'message_delta' && chunk.usage) {
        usage.outputTokens = chunk.usage.output_tokens;
      } else if (
        chunk.type === 'content_block_delta' &&
        chunk.delta?.type === 'text_delta' &&
        chunk.delta.text
      ) {
        yield chunk.delta.text;
      }
    }

    yield { __usage: usage };
  }
}
