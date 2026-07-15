import type { LLMProvider } from './LLMProvider'
import { AnthropicProvider } from './AnthropicProvider'
import { BedrockProvider } from './BedrockProvider'

export function getLLMProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  switch (provider) {
    case 'bedrock':   return new BedrockProvider()
    case 'anthropic': return new AnthropicProvider()
    default:          return new AnthropicProvider()
  }
}

export type { LLMProvider } from './LLMProvider'
export type { LLMCompleteRequest, LLMCompleteResponse, LLMStreamRequest, LLMStreamChunk, LLMUsage, LLMMessage, LLMContentBlock, LLMSystemBlock } from './types'
