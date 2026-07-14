export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string | LLMContentBlock[]
}

export interface LLMContentBlock {
  type: 'text' | 'image'
  text?: string
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export interface LLMSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export interface LLMCompleteRequest {
  model: string
  system?: string | LLMSystemBlock[]
  messages: LLMMessage[]
  maxTokens: number
  temperature?: number
}

export interface LLMCompleteResponse {
  text: string
  usage: LLMUsage
}

export interface LLMStreamRequest extends LLMCompleteRequest {
  // identical shape — stream vs complete determined by which method is called
}

// String chunk during streaming, or terminal usage sentinel
export type LLMStreamChunk =
  | string
  | { __usage: LLMUsage }

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
