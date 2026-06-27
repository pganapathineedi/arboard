import { randomUUID } from "crypto";
import type { AgentConfig, ClientContext, DomainConfig, ForumRequest } from "@/lib/types";
import type { OrgContext } from "@/lib/types/salesforce";
import { getDomain } from "@/lib/domains/salesforce";
import { AgentRunner } from "@/lib/agents/AgentRunner";
import type { UsageData } from "@/lib/agents/AgentRunner";
import { ImpactAnalyser } from "@/lib/analysis/ImpactAnalyser";
import { saveADR } from "@/lib/adr/store";
import { retrieveMemory, buildAllAgentMemoryBlocks } from "@/lib/memory";

const DESIGNER_ID = "sf-designer";
const CLOSING_IDS = new Set(["sf-judge", "sf-scribe", "sf-learner"]);

function buildEffectiveAgent(agent: AgentConfig, request: ForumRequest, memoryBlock?: string | null): AgentConfig {
  const overrides: Partial<AgentConfig> = {};
  if (request.modelOverride) overrides.model = request.modelOverride;
  if (request.orgContextStr) overrides.orgContext = request.orgContextStr;
  if (memoryBlock) overrides.memoryBlock = memoryBlock;
  return Object.keys(overrides).length > 0 ? { ...agent, ...overrides } : agent;
}

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

// Revision round: prepend judge feedback so specialists address prior concerns
function buildRevisionInput(requirement: string, round: number, previousFeedback: string): string {
  return [
    `REVISION CONTEXT — Round ${round}: The previous Judge verdict was:`,
    previousFeedback,
    "Address the concerns raised before providing your updated assessment.",
    "",
    "## REQUIREMENT",
    requirement,
  ].join("\n");
}

// Scribe and Learner only need requirement + judge verdict — no full specialist debate
function buildTrimmedClosingInput(requirement: string, judgeOutput: string): string {
  return [
    "## REQUIREMENT",
    requirement,
    "",
    "## ARB JUDGE VERDICT",
    judgeOutput || "(Judge output not yet available)",
  ].join("\n");
}

// ── ADR helpers ───────────────────────────────────────────────────────────────

function parseVerdictForADR(content: string): string {
  const u = content.toUpperCase();
  if (u.includes("APPROVED WITH CONDITIONS") || u.includes("APPROVE WITH CONDITIONS") || u.includes("CONDITIONALLY APPROVED"))
    return "APPROVED WITH CONDITIONS";
  if (u.includes("REVISION REQUIRED") || u.includes("REQUIRES REVISION"))
    return "REVISION REQUIRED";
  if (u.includes("APPROVED"))
    return "APPROVED";
  return "REVIEW REQUIRED";
}

function parseMustFixForADR(content: string): string[] {
  const block = content.match(/MUST FIX[:\s]*\n([\s\S]+?)(?=\n##|\n[A-Z]{3,}[\s:]|\n\n\n|$)/i);
  if (!block) return [];
  return block[1]
    .split("\n")
    .filter(l => /^\d+\./.test(l.trim()))
    .map(l => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function parseConfidenceLevelForADR(content: string): string | undefined {
  const match = content.match(/##\s*Confidence Level\s*\n\*\*([^*]+)\*\*/i);
  return match?.[1]?.trim();
}

function parseHumanJudgementPoints(content: string): string[] {
  const block = content.match(/##\s*Points Requiring Human Judgement\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (!block) return [];
  return block[1]
    .split("\n")
    .filter(l => l.trim().startsWith("-"))
    .map(l => l.replace(/^-\s*/, "").trim())
    .filter(l => Boolean(l) && !/^none identified$/i.test(l) && !/^none$/i.test(l));
}

// Haiku 4.5 pricing: $1.00 input / $5.00 output / $0.10 cache read / $1.25 cache write (per MTok)
function estimateCostUsd(input: number, output: number, cacheRead: number, cacheWrite: number): number {
  return input * 1e-6 + output * 5e-6 + cacheRead * 1e-7 + cacheWrite * 1.25e-6;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class ForumOrchestrator {
  static getAgents(domain: DomainConfig, agentIds?: string[]): AgentConfig[] {
    if (!agentIds || agentIds.length === 0) return domain.agents;
    return domain.agents.filter((a) => agentIds.includes(a.id));
  }

  static async *streamForum(request: ForumRequest): AsyncGenerator<string> {
    const sessionId = randomUUID();
    const sessionStart = Date.now();
    const domainId = request.domainId ?? "salesforce";
    const clientContext: ClientContext = request.clientContext ?? {};
    const orgContext = request.orgContext;
    const domain = getDomain(domainId);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;

    // ── Memory retrieval ──────────────────────────────────────────────────────
    const memory = await retrieveMemory(request.input, process.env.CLIENT_ID ?? 'default');
    const memoryBlocks = buildAllAgentMemoryBlocks(memory);
    if (memory.relevantADRs.length > 0) {
      console.log(`[forum] Loaded ${memory.relevantADRs.length} relevant past ADRs from Jira`);
    }

    // ── Impact Analysis ───────────────────────────────────────────────────────
    const isRevision = !!(request.revisionRound && request.previousFeedback);
    let selectedAgentIds = request.agentIds;

    if (!isRevision && (!selectedAgentIds || selectedAgentIds.length === 0)) {
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
    const designer    = isRevision ? undefined : allAgents.find(a => a.id === DESIGNER_ID);
    const specialists = allAgents.filter(a => a.id !== DESIGNER_ID && !CLOSING_IDS.has(a.id));
    const closing     = allAgents.filter(a => CLOSING_IDS.has(a.id));

    const usePhasedFlow = !!designer || isRevision;

    yield `data: ${JSON.stringify({ type: "session_start", sessionId, agentCount: allAgents.length })}\n\n`;

    if (!usePhasedFlow) {
      // ── Flat fallback (no designer selected) ─────────────────────────────
      for (const agent of allAgents) {
        yield* ForumOrchestrator.runAgent(agent, request, clientContext, sessionId, domainId, orgContext, memoryBlocks[agent.id]);
      }
    } else {
      // ── Phase 1: Designer (skipped in revision rounds) ────────────────────
      let designerOutput = "";

      if (designer) {
        const effectiveDesigner = buildEffectiveAgent(designer, request, memoryBlocks[designer.id]);

        yield `data: ${JSON.stringify({ type: "agent_start", agentId: designer.id, agentName: designer.name, role: designer.role })}\n\n`;

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
          if (designerUsage) {
            totalInputTokens += designerUsage.inputTokens;
            totalOutputTokens += designerUsage.outputTokens;
            totalCacheReadTokens += designerUsage.cacheReadTokens ?? 0;
            totalCacheWriteTokens += designerUsage.cacheWriteTokens ?? 0;
          }
          yield `data: ${JSON.stringify({ type: "agent_complete", agentId: designer.id, durationMs: Date.now() - designerStart, inputTokens: designerUsage?.inputTokens, outputTokens: designerUsage?.outputTokens, cacheReadTokens: designerUsage?.cacheReadTokens, cacheWriteTokens: designerUsage?.cacheWriteTokens })}\n\n`;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          yield `data: ${JSON.stringify({ type: "agent_error", agentId: designer.id, error: message, durationMs: Date.now() - designerStart })}\n\n`;
          designerOutput = request.input;
        }
      } else if (isRevision) {
        designerOutput = `(Revision Round ${request.revisionRound} — Designer phase skipped. Revision context was provided to all specialists.)`;
      }

      // ── Phase 2: Specialist reviews ───────────────────────────────────────
      const reviewInput = isRevision
        ? buildRevisionInput(request.input, request.revisionRound!, request.previousFeedback!)
        : buildReviewInput(request.input, designerOutput);
      const specialistOutputs: Array<{ agentName: string; role: string; content: string }> = [];

      for (const agent of specialists) {
        const effectiveAgent = buildEffectiveAgent(agent, request, memoryBlocks[agent.id]);

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
          if (usage) {
            totalInputTokens += usage.inputTokens;
            totalOutputTokens += usage.outputTokens;
            totalCacheReadTokens += usage.cacheReadTokens ?? 0;
            totalCacheWriteTokens += usage.cacheWriteTokens ?? 0;
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
      const closingOutputs: Record<string, string> = {};

      // Judge runs first with full context; Scribe/Learner get trimmed input (requirement + verdict only)
      const sortedClosing = [
        ...closing.filter(a => a.id === "sf-judge"),
        ...closing.filter(a => a.id !== "sf-judge"),
      ];

      for (const agent of sortedClosing) {
        const effectiveAgent = buildEffectiveAgent(agent, request, memoryBlocks[agent.id]);
        const agentInput = agent.id === "sf-judge"
          ? closingInput
          : buildTrimmedClosingInput(request.input, closingOutputs["sf-judge"] ?? "");

        yield `data: ${JSON.stringify({ type: "agent_start", agentId: agent.id, agentName: agent.name, role: agent.role })}\n\n`;

        let agentContent = "";
        let usage: UsageData | undefined;
        const agentStart = Date.now();

        try {
          for await (const chunk of AgentRunner.runStream(effectiveAgent, agentInput, clientContext, sessionId, domainId, orgContext)) {
            if (typeof chunk === "string") {
              agentContent += chunk;
              yield `data: ${JSON.stringify({ type: "token", agentId: agent.id, token: chunk })}\n\n`;
            } else {
              usage = chunk.__usage;
            }
          }
          closingOutputs[agent.id] = agentContent;
          if (usage) {
            totalInputTokens += usage.inputTokens;
            totalOutputTokens += usage.outputTokens;
            totalCacheReadTokens += usage.cacheReadTokens ?? 0;
            totalCacheWriteTokens += usage.cacheWriteTokens ?? 0;
          }
          yield `data: ${JSON.stringify({ type: "agent_complete", agentId: agent.id, durationMs: Date.now() - agentStart, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, cacheReadTokens: usage?.cacheReadTokens, cacheWriteTokens: usage?.cacheWriteTokens })}\n\n`;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          yield `data: ${JSON.stringify({ type: "agent_error", agentId: agent.id, error: message, durationMs: Date.now() - agentStart })}\n\n`;
        }
      }

      // ── Save session record (no Jira — gated by EndorsementPanel) ────────
      const judgeContent  = closingOutputs["sf-judge"]  ?? "";
      const scribeContent = closingOutputs["sf-scribe"] ?? "";

      const parsedVerdict              = parseVerdictForADR(judgeContent);
      const parsedMustFix              = parseMustFixForADR(judgeContent);
      const parsedConfidenceLevel      = parseConfidenceLevelForADR(judgeContent);
      const parsedHumanJudgementPoints = parseHumanJudgementPoints(judgeContent);

      try {
        await saveADR({
          requirement:          request.input,
          verdict:              parsedVerdict,
          scribeNotes:          scribeContent,
          mustFixIssues:        parsedMustFix,
          humanJudgementPoints: parsedHumanJudgementPoints,
          confidenceLevel:      parsedConfidenceLevel,
          sessionId,
          clientId:             process.env.CLIENT_ID,
          skipJira:             true,
          totalInputTokens,
          totalOutputTokens,
          totalCacheReadTokens,
          totalCacheWriteTokens,
          estimatedCostUsd:     estimateCostUsd(totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheWriteTokens),
          durationSeconds:      (Date.now() - sessionStart) / 1000,
          agentCount:           allAgents.length,
        });
      } catch (err) {
        console.error("[orchestrator] saveADR failed:", err instanceof Error ? err.message : err);
      }

      yield `data: ${JSON.stringify({ type: "adr_saved", jiraIssueKey: null, jiraIssueUrl: null })}\n\n`;
      yield `data: ${JSON.stringify({
        type:                 "pending_endorsement",
        sessionId,
        requirement:          request.input,
        verdict:              parsedVerdict,
        confidenceLevel:      parsedConfidenceLevel ?? "Medium",
        humanJudgementPoints: parsedHumanJudgementPoints,
        scribeNotes:          scribeContent,
        mustFixIssues:        parsedMustFix,
      })}\n\n`;
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
    memoryBlock?: string | null,
  ): AsyncGenerator<string> {
    const effectiveAgent = buildEffectiveAgent(agent, request, memoryBlock);

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
