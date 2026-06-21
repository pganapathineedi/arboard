import { randomUUID } from "crypto";
import type { AgentConfig, ClientContext, DomainConfig, ForumRequest } from "@/lib/types";
import { getDomain } from "@/lib/domains/salesforce";
import { AgentRunner } from "@/lib/agents/AgentRunner";
import type { UsageData } from "@/lib/agents/AgentRunner";
import { ImpactAnalyser } from "@/lib/analysis/ImpactAnalyser";

export class ForumOrchestrator {
  static getAgents(domain: DomainConfig, agentIds?: string[]): AgentConfig[] {
    if (!agentIds || agentIds.length === 0) return domain.agents;
    return domain.agents.filter((a) => agentIds.includes(a.id));
  }

  static async *streamForum(request: ForumRequest): AsyncGenerator<string> {
    const sessionId = randomUUID();
    const domainId = request.domainId ?? "salesforce";
    const clientContext: ClientContext = request.clientContext ?? {};
    const domain = getDomain(domainId);

    // ── Impact Analysis (skip if caller already provided explicit agent list) ──
    let selectedAgentIds = request.agentIds;

    if (!selectedAgentIds || selectedAgentIds.length === 0) {
      yield `data: ${JSON.stringify({ type: "analysis_start" })}\n\n`;
      try {
        const analysis = await ImpactAnalyser.analyse(request.input, domainId);
        yield `data: ${JSON.stringify({ type: "impact_analysis", analysis })}\n\n`;

        // Activate required + recommended agents; always include judge, scribe, learner
        const ALWAYS_ON = ["sf-judge", "sf-scribe", "sf-learner"];
        selectedAgentIds = analysis.activatedAgents
          .filter((a) => a.priority !== "optional" || ALWAYS_ON.includes(a.agentId))
          .map((a) => a.agentId);

        // Ensure always-on agents are present even if analyser omitted them
        for (const id of ALWAYS_ON) {
          if (!selectedAgentIds.includes(id)) selectedAgentIds.push(id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Analysis failed";
        yield `data: ${JSON.stringify({ type: "analysis_error", error: message })}\n\n`;
        // Fall back to all agents
        selectedAgentIds = undefined;
      }
    }

    const agents = ForumOrchestrator.getAgents(domain, selectedAgentIds);

    yield `data: ${JSON.stringify({ type: "session_start", sessionId, agentCount: agents.length })}\n\n`;

    for (const agent of agents) {
      const effectiveAgent = request.modelOverride
        ? { ...agent, model: request.modelOverride }
        : agent;

      yield `data: ${JSON.stringify({ type: "agent_start", agentId: agent.id, agentName: agent.name, role: agent.role })}\n\n`;

      const agentStart = Date.now();
      let usage: UsageData | undefined;
      try {
        for await (const chunk of AgentRunner.runStream(effectiveAgent, request.input, clientContext, sessionId, domainId)) {
          if (typeof chunk === "string") {
            yield `data: ${JSON.stringify({ type: "token", agentId: agent.id, token: chunk })}\n\n`;
          } else {
            usage = chunk.__usage;
          }
        }
        const durationMs = Date.now() - agentStart;
        yield `data: ${JSON.stringify({ type: "agent_complete", agentId: agent.id, durationMs, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens })}\n\n`;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const durationMs = Date.now() - agentStart;
        yield `data: ${JSON.stringify({ type: "agent_error", agentId: agent.id, error: message, durationMs })}\n\n`;
      }
    }

    yield `data: ${JSON.stringify({ type: "session_complete", sessionId })}\n\n`;
  }
}
