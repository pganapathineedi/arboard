import type { LLMCompleteRequest, LLMCompleteResponse, LLMStreamRequest, LLMStreamChunk } from './types'

export interface LLMProvider {
  complete(request: LLMCompleteRequest): Promise<LLMCompleteResponse>
  stream(request: LLMStreamRequest): AsyncIterable<LLMStreamChunk>
}
