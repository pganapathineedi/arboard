import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, AgentResult, ClientContext, MiddlewareContext } from "@/lib/types";
import { PromptBuilder } from "@/lib/prompt/PromptBuilder";
import { defaultPipeline } from "@/lib/middleware";
import { isMockMode, mockStream, getMockResponse } from "@/lib/mock/mockMode";

const anthropic = new Anthropic();

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
}

// StreamChunk is either a text token or a terminal usage marker
export type StreamChunk = string | { __usage: UsageData };

export class AgentRunner {
  static async *runStream(
    agent: AgentConfig,
    input: string,
    clientContext: ClientContext,
    sessionId: string,
    domainId: string
  ): AsyncGenerator<StreamChunk> {
    if (isMockMode()) {
      yield* mockStream(getMockResponse(agent.id));
      return;
    }

    const systemPrompt = PromptBuilder.buildSystemPrompt(agent, clientContext);

    const middlewareCtx: MiddlewareContext = {
      sessionId, agentId: agent.id, domainId,
      input, clientContext, systemPrompt, metadata: {},
    };

    const finalCtx = await defaultPipeline(middlewareCtx, async () => middlewareCtx);

    const stream = anthropic.messages.stream({
      model: agent.model,
      max_tokens: agent.maxTokens,
      temperature: agent.temperature ?? 0.3,
      system: finalCtx.systemPrompt,
      messages: [{ role: "user", content: finalCtx.input }],
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream) {
      if (event.type === "message_start") {
        inputTokens = event.message.usage.input_tokens;
      } else if (event.type === "message_delta") {
        outputTokens = event.usage.output_tokens;
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }

    yield { __usage: { inputTokens, outputTokens } };
  }

  static async run(
    agent: AgentConfig,
    input: string,
    clientContext: ClientContext,
    sessionId: string,
    domainId: string
  ): Promise<AgentResult> {
    const start = Date.now();
    let content = "";

    for await (const chunk of AgentRunner.runStream(agent, input, clientContext, sessionId, domainId)) {
      if (typeof chunk === "string") content += chunk;
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      content,
      durationMs: Date.now() - start,
    };
  }
}
