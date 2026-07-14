import type { AgentConfig, AgentResult, ClientContext, MiddlewareContext } from "@/lib/types";
import type { OrgContext } from "@/lib/types/salesforce";
import { getLLMProvider } from "@/lib/llm";
import type { LLMMessage } from "@/lib/llm";
import { PromptBuilder } from "@/lib/prompt/PromptBuilder";
import { defaultPipeline } from "@/lib/middleware";
import { mockStream, getMockResponse } from "@/lib/mock/mockMode";
import { getRelevantPatterns, formatPatternBlock } from "@/lib/patternRetrieval";
import { WELL_ARCHITECTED_BY_AGENT } from "@/lib/prompt/wellArchitectedPrinciples";

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// StreamChunk is either a text token or a terminal usage marker
export type StreamChunk = string | { __usage: UsageData };

export class AgentRunner {
  static async *runStream(
    agent: AgentConfig,
    input: string,
    clientContext: ClientContext,
    sessionId: string,
    domainId: string,
    orgContext?: OrgContext,
    metadata?: Record<string, unknown>,
    mode: "real" | "mock" = "mock",
  ): AsyncGenerator<StreamChunk> {
    if (mode === "mock") {
      console.log(`[patterns] MOCK MODE — skipping injection for agent ${agent.name}`);
      yield* mockStream(getMockResponse(agent.id));
      return;
    }

    let systemPrompt = PromptBuilder.buildSystemPrompt(agent, clientContext, undefined, orgContext);

    const patterns = await getRelevantPatterns(agent.id);
    console.log(`[patterns] injecting for agent ${agent.name}: ${patterns.map(p => p.id).join(", ") || "none"}`);
    const patternBlock = formatPatternBlock(patterns);
    if (patternBlock) systemPrompt = `${systemPrompt}\n\n${patternBlock}`;

    if (agent.memoryBlock) systemPrompt = `${systemPrompt}\n\n${agent.memoryBlock}`;

    const agentKey = agent.id.replace(/^sf-/, "");
    const waPrinciples = WELL_ARCHITECTED_BY_AGENT[agentKey];
    if (waPrinciples) systemPrompt = `${systemPrompt}\n\n${waPrinciples}`;

    const middlewareCtx: MiddlewareContext = {
      sessionId, agentId: agent.id, domainId,
      input, clientContext, systemPrompt, metadata: metadata ?? {}, orgContext,
      skipInputValidation: (metadata?.skipInputValidation as boolean | undefined) ?? false,
    };

    const finalCtx = await defaultPipeline(middlewareCtx, async () => middlewareCtx);

    const visionImages = finalCtx.metadata.embeddedImages as Array<{ name: string; mediaType: string; base64: string }> | undefined;
    const userContent: LLMMessage["content"] = visionImages?.length
      ? [
          ...visionImages.map(img => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
          })),
          { type: "text" as const, text: "The above are architecture diagrams embedded in the submitted design document. Review them for correctness and flag any inconsistencies with the text design." },
          { type: "text" as const, text: finalCtx.input },
        ]
      : finalCtx.input;

    console.log('[agent] model:', agent.model, 'maxTokens:', agent.maxTokens);
    console.log('[agent] systemPrompt length:', finalCtx.systemPrompt?.length);

    try {
      for await (const chunk of getLLMProvider().stream({
        model: agent.model,
        maxTokens: agent.maxTokens,
        temperature: agent.temperature ?? 0.3,
        system: [{ type: "text", text: finalCtx.systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      })) {
        yield chunk;
      }
    } catch (err) {
      console.error('[agent] stream error for', agent.id, ':', err);
      throw err;
    }
  }

  static async run(
    agent: AgentConfig,
    input: string,
    clientContext: ClientContext,
    sessionId: string,
    domainId: string,
    orgContext?: OrgContext,
    mode: "real" | "mock" = "mock",
  ): Promise<AgentResult> {
    const start = Date.now();
    let content = "";

    for await (const chunk of AgentRunner.runStream(agent, input, clientContext, sessionId, domainId, orgContext, undefined, mode)) {
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
