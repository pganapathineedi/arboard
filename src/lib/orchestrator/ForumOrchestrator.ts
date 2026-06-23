import { randomUUID } from "crypto";
import type { AgentConfig, ClientContext, DomainConfig, ForumRequest } from "@/lib/types";
import type { OrgContext } from "@/lib/types/salesforce";
import { getDomain } from "@/lib/domains/salesforce";
import { AgentRunner } from "@/lib/agents/AgentRunner";
import type { UsageData } from "@/lib/agents/AgentRunner";
import { ImpactAnalyser } from "@/lib/analysis/ImpactAnalyser";

const DESIGNER_ID = "sf-designer";
const CLOSING_IDS = new Set(["sf-judge", "sf-scribe", "sf-learner"]);

// ── Input builders ────────────────────────────────────────────────────────────

function buildReviewInput(requirement: string, designerOutput: string): string {
  return [
    "## REQUIREMENT",
    requirement,
    "",
    "## PROPOSED SOLUTION DESIGN",
    "(Authored by the Salesforce Solution Designer — review this design from your specialist domain)",
    "",
    designerOutput,
    "",
    "---",
    "Your task: Review the solution design above through your specialist lens. Do NOT re-architect from scratch.",
    "Assess what the designer has proposed, identify gaps or violations specific to your domain, flag any MUST-FIX",
    "issues, and recommend concrete improvements. Reference specific components or decisions from the design.",
  ].join("\n");
}

function buildClosingInput(
  requirement: string,
  designerOutput: string,
  specialistReviews: Array<{ agentName: string; role: string; content: string }>,
): string {
  const reviewsBlock = specialistReviews
    .map(r => `### ${r.agentName} (${r.role})\n${r.content}`)
    .join("\n\n---\n\n");

  return [
    "## REQUIREMENT",
    requirement,
    "",
    "## SOLUTION DESIGN",
    designerOutput,
    "",
    "## SPECIALIST REVIEWS",
    reviewsBlock,
  ].join("\n");
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class ForumOrchestrator {
  static getAgents(domain: DomainConfig, agentIds?: string[]): AgentConfig[] {
    if (!agentIds || agentIds.length === 0) return domain.agents;
    return domain.agents.filter((a) => agentIds.includes(a.id));
  }

  static async *streamForum(request: ForumRequest): AsyncGenerator<string> {
    const sessionId = randomUUID();
    const domainId = request.domainId ?? "salesforce";
    const clientContext: ClientContext = request.clientContext ?? {};
    const orgContext = request.orgContext;
    const domain = getDomain(domainId);

    // ── Impact Analysis ───────────────────────────────────────────────────────
    let selectedAgentIds = request.agentIds;

    if (!selectedAgentIds || selectedAgentIds.length === 0) {
      yield `data: ${JSON.stringify({ type: "analysis_start" })}\n\n`;
      try {
        const analysis = await ImpactAnalyser.analyse(request.input, domainId, orgContext);
        yield `data: ${JSON.stringify({ type: "impact_analysis", analysis })}\n\n`;

        const ALWAYS_ON = ["sf-judge", "sf-scribe", "sf-learner"];
        selectedAgentIds = analysis.activatedAgents
          .filter((a) => a.priority !== "optional" || ALWAYS_ON.includes(a.agentId))
          .map((a) => a.agentId);

        for (const id of ALWAYS_ON) {
          if (!selectedAgentIds.includes(id)) selectedAgentIds.push(id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Analysis failed";
        yield `data: ${JSON.stringify({ type: "analysis_error", error: message })}\n\n`;
        selectedAgentIds = undefined;
      }
    }

    const allAgents = ForumOrchestrator.getAgents(domain, selectedAgentIds);

    // ── Phase split ───────────────────────────────────────────────────────────
    const designer    = allAgents.find(a => a.id === DESIGNER_ID);
    const specialists = allAgents.filter(a => a.id !== DESIGNER_ID && !CLOSING_IDS.has(a.id));
    const closing     = allAgents.filter(a => CLOSING_IDS.has(a.id));

    // If designer is absent, fall back to flat execution (all agents, original input)
    const usePhasedFlow = !!designer;

    yield `data: ${JSON.stringify({ type: "session_start", sessionId, agentCount: allAgents.length })}\n\n`;

    if (!usePhasedFlow) {
      // ── Flat fallback (no designer selected) ─────────────────────────────
      for (const agent of allAgents) {
        yield* ForumOrchestrator.runAgent(agent, request, clientContext, sessionId, domainId, orgContext);
      }
    } else {
      // ── Phase 1: Designer ─────────────────────────────────────────────────
      const effectiveDesigner = request.modelOverride
        ? { ...designer, model: request.modelOverride }
        : designer;

      yield `data: ${JSON.stringify({ type: "agent_start", agentId: designer.id, agentName: designer.name, role: designer.role })}\n\n`;

      let designerOutput = "";
      let designerUsage: UsageData | undefined;
      const designerStart = Date.now();

      try {
        for await (const chunk of AgentRunner.runStream(effectiveDesigner, request.input, clientContext, sessionId, domainId, orgContext)) {
          if (typeof chunk === "string") {
            designerOutput += chunk;
            yield `data: ${JSON.stringify({ type: "token", agentId: designer.id, token: chunk })}\n\n`;
          } else {
            designerUsage = chunk.__usage;
          }
        }
        yield `data: ${JSON.stringify({ type: "agent_complete", agentId: designer.id, durationMs: Date.now() - designerStart, inputTokens: designerUsage?.inputTokens, outputTokens: designerUsage?.outputTokens, cacheReadTokens: designerUsage?.cacheReadTokens, cacheWriteTokens: designerUsage?.cacheWriteTokens })}\n\n`;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        yield `data: ${JSON.stringify({ type: "agent_error", agentId: designer.id, error: message, durationMs: Date.now() - designerStart })}\n\n`;
        // Designer failed — fall back to original input for remaining agents
        designerOutput = request.input;
      }

      // ── Phase 2: Specialist reviews ───────────────────────────────────────
      const reviewInput = buildReviewInput(request.input, designerOutput);
      const specialistOutputs: Array<{ agentName: string; role: string; content: string }> = [];

      for (const agent of specialists) {
        const effectiveAgent = request.modelOverride
          ? { ...agent, model: request.modelOverride }
          : agent;

        yield `data: ${JSON.stringify({ type: "agent_start", agentId: agent.id, agentName: agent.name, role: agent.role })}\n\n`;

        let content = "";
        let usage: UsageData | undefined;
        const agentStart = Date.now();

        try {
          for await (const chunk of AgentRunner.runStream(effectiveAgent, reviewInput, clientContext, sessionId, domainId, orgContext)) {
            if (typeof chunk === "string") {
              content += chunk;
              yield `data: ${JSON.stringify({ type: "token", agentId: agent.id, token: chunk })}\n\n`;
            } else {
              usage = chunk.__usage;
            }
          }
          yield `data: ${JSON.stringify({ type: "agent_complete", agentId: agent.id, durationMs: Date.now() - agentStart, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, cacheReadTokens: usage?.cacheReadTokens, cacheWriteTokens: usage?.cacheWriteTokens })}\n\n`;
          specialistOutputs.push({ agentName: agent.name, role: agent.role, content });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          yield `data: ${JSON.stringify({ type: "agent_error", agentId: agent.id, error: message, durationMs: Date.now() - agentStart })}\n\n`;
        }
      }

      // ── Phase 3: Judge / Scribe / Learner ─────────────────────────────────
      const closingInput = buildClosingInput(request.input, designerOutput, specialistOutputs);

      for (const agent of closing) {
        const effectiveAgent = request.modelOverride
          ? { ...agent, model: request.modelOverride }
          : agent;

        yield `data: ${JSON.stringify({ type: "agent_start", agentId: agent.id, agentName: agent.name, role: agent.role })}\n\n`;

        let usage: UsageData | undefined;
        const agentStart = Date.now();

        try {
          for await (const chunk of AgentRunner.runStream(effectiveAgent, closingInput, clientContext, sessionId, domainId, orgContext)) {
            if (typeof chunk === "string") {
              yield `data: ${JSON.stringify({ type: "token", agentId: agent.id, token: chunk })}\n\n`;
            } else {
              usage = chunk.__usage;
            }
          }
          yield `data: ${JSON.stringify({ type: "agent_complete", agentId: agent.id, durationMs: Date.now() - agentStart, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, cacheReadTokens: usage?.cacheReadTokens, cacheWriteTokens: usage?.cacheWriteTokens })}\n\n`;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          yield `data: ${JSON.stringify({ type: "agent_error", agentId: agent.id, error: message, durationMs: Date.now() - agentStart })}\n\n`;
        }
      }
    }

    yield `data: ${JSON.stringify({ type: "session_complete", sessionId })}\n\n`;
  }

  // Flat agent runner used in non-phased fallback
  private static async *runAgent(
    agent: AgentConfig,
    request: ForumRequest,
    clientContext: ClientContext,
    sessionId: string,
    domainId: string,
    orgContext: OrgContext | undefined,
  ): AsyncGenerator<string> {
    const effectiveAgent = request.modelOverride
      ? { ...agent, model: request.modelOverride }
      : agent;

    yield `data: ${JSON.stringify({ type: "agent_start", agentId: agent.id, agentName: agent.name, role: agent.role })}\n\n`;

    let usage: UsageData | undefined;
    const agentStart = Date.now();

    try {
      for await (const chunk of AgentRunner.runStream(effectiveAgent, request.input, clientContext, sessionId, domainId, orgContext)) {
        if (typeof chunk === "string") {
          yield `data: ${JSON.stringify({ type: "token", agentId: agent.id, token: chunk })}\n\n`;
        } else {
          usage = chunk.__usage;
        }
      }
      yield `data: ${JSON.stringify({ type: "agent_complete", agentId: agent.id, durationMs: Date.now() - agentStart, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, cacheReadTokens: usage?.cacheReadTokens, cacheWriteTokens: usage?.cacheWriteTokens })}\n\n`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      yield `data: ${JSON.stringify({ type: "agent_error", agentId: agent.id, error: message, durationMs: Date.now() - agentStart })}\n\n`;
    }
  }
}
