import { randomUUID } from "crypto";
import { getLLMProvider } from "@/lib/llm";
import type { AgentConfig, ClientContext, DomainConfig, ForumRequest } from "@/lib/types";
import type { OrgContext } from "@/lib/types/salesforce";
import { getDomain } from "@/lib/domains/salesforce";
import { AgentRunner } from "@/lib/agents/AgentRunner";
import type { UsageData } from "@/lib/agents/AgentRunner";
import { ImpactAnalyser } from "@/lib/analysis/ImpactAnalyser";
import { saveADR } from "@/lib/adr/store";
import { estimateCostUsd } from "@/lib/pricing";
import { retrieveMemory, buildAllAgentMemoryBlocks } from "@/lib/memory";
import { persistLearnerOutput } from "@/lib/memory/learnerPersist";
import { fetchTicket } from "@/lib/integrations/jira";
import { loadDomainSkill, loadCrossCuttingSkills } from "@/lib/skills/skillLoader";
import { SessionTracer } from '@/lib/tracing/SessionTracer'
import { validateAgentOutput, type ValidationResult } from '@/lib/validation/agentOutputSchema'

const DESIGNER_ID = "sf-designer";
const CLOSING_IDS = new Set(["sf-judge", "sf-scribe", "sf-learner"]);
const JUDGE_MAX_TOKENS = 8000;
const OMNI_KEYWORDS = /OmniScript|FlexCard|OmniStudio|DataRaptor|Vlocity/i;

function buildEffectiveAgent(agent: AgentConfig, request: ForumRequest, memoryBlock?: string | null, priorADRBlock?: string | null): AgentConfig {
  const overrides: Partial<AgentConfig> = {};
  const HAIKU_ONLY = new Set(["sf-scribe", "sf-learner"]);
  if (request.modelOverride && !HAIKU_ONLY.has(agent.id)) overrides.model = request.modelOverride;
  if (agent.id === "sf-judge") overrides.maxTokens = JUDGE_MAX_TOKENS;
  if (request.orgContextStr) overrides.orgContext = request.orgContextStr;
  const combined = [memoryBlock, priorADRBlock].filter(Boolean).join('\n\n');
  if (combined) overrides.memoryBlock = combined;
  if (agent.id === DESIGNER_ID && request.inputMode === "debate") {
    const debateLines = [
      "",
      "DEBATE MODE: The user has provided their own proposed architecture approach below.",
      "Your role is NOT to propose a new solution. Instead:",
      "- Critically analyse the proposed approach",
      "- Identify architectural weaknesses, anti-patterns, and risks",
      "- Challenge assumptions in the design",
      "- Highlight what is good about the approach",
      "- Suggest specific improvements",
      "Do NOT redesign from scratch. Critique what has been proposed.",
    ];
    if (request.debateFocusAreas) {
      debateLines.push("", `Focus areas requested by submitter: ${request.debateFocusAreas}`);
    }
    overrides.sections = { ...agent.sections, extra: (agent.sections.extra ? agent.sections.extra + '\n\n' : '') + debateLines.join('\n') };
  }
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

function stripJsonBlock(content: string): string {
  const match = content.match(/^([\s\S]*)\n---\n[\s\S]*```json[\s\S]*```\s*$/);
  return match ? match[1].trim() : content;
}

// Scribe and Learner only need requirement + judge verdict — no full specialist debate
function buildTrimmedClosingInput(requirement: string, judgeOutput: string, priorADRBlock?: string): string {
  const parts = [
    "## REQUIREMENT",
    requirement,
    "",
    "## ARB JUDGE VERDICT",
    judgeOutput || "(Judge output not yet available)",
  ];
  if (priorADRBlock) parts.push("", priorADRBlock);
  return parts.join("\n");
}

// ── ADR helpers ───────────────────────────────────────────────────────────────

function parseVerdictForADR(content: string): string {
  const u = content.toUpperCase();
  if (u.includes("APPROVED WITH CONDITIONS") || u.includes("APPROVE WITH CONDITIONS") || u.includes("CONDITIONALLY APPROVED"))
    return "APPROVED WITH CONDITIONS";
  if (u.includes("REVISION REQUIRED") || u.includes("REQUIRES REVISION"))
    return "REVISION REQUIRED";
  if (u.includes("NOT APPROVED"))
    return "NOT APPROVED";
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
  const patterns = [
    /##\s*Confidence Level\s*\n\*\*([^*]+)\*\*/i,
    /Confidence Level[:\s*]+\*\*([^*]+)\*\*/i,
    /\*\*Confidence Level:\*\*\s*([^\n*]+)/i,
    /Confidence:\s*\*\*([^*]+)\*\*/i,
    /CONFIDENCE:\s*(High|Medium|Low)/i,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return undefined;
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

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class ForumOrchestrator {
  static getAgents(domain: DomainConfig, agentIds?: string[]): AgentConfig[] {
    if (!agentIds || agentIds.length === 0) return domain.agents;
    return domain.agents.filter((a) => agentIds.includes(a.id));
  }

  static async *streamForum(request: ForumRequest, mode: "real" | "mock" = "mock"): AsyncGenerator<string> {
    console.log('[forum] streamForum called with mode:', mode);
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

    const tracer = new SessionTracer({
      sessionId,
      clientId: process.env.CLIENT_ID ?? 'default',
      domain: domainId,
      mode,
      documentHash: request.docHash,
      agentCount: 0,
    })

    // ── Episodic memory (session-scoped, resets each forum run) ───────────────
    const episodicStore: Record<string, string[]> = {};

    function extractFindingsSummary(agentOutput: string): string[] {
      const match = agentOutput.match(/FINDINGS_SUMMARY_START([\s\S]*?)FINDINGS_SUMMARY_END/);
      if (!match) return [];
      return match[1]
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-'));
    }

    function buildEpisodicBlock(store: Record<string, string[]>): string {
      const entries = Object.entries(store);
      if (entries.length === 0) return '';

      const lines = entries.flatMap(([agentId, findings]) => [
        `**${agentId}:**`,
        ...findings,
      ]);

      return `\n\n## PRIOR AGENT FINDINGS\nThe following specialists have already reviewed this document. Factor their findings into your assessment — do not repeat findings already flagged, instead build on them or cross-reference where relevant.\n\n${lines.join('\n')}`;
    }

    // SUPERSEDED BY RAG — Jira ADRs now in grounding_embeddings
    // const memory = await retrieveMemory(request.input, process.env.CLIENT_ID ?? 'default');
    // if (memory.relevantADRs.length > 0) {
    //   console.log(`[forum] Loaded ${memory.relevantADRs.length} relevant past ADRs from Jira`);
    // }
    const memoryBlocks: Record<string, string> = {};

    // ── Skills injection ──────────────────────────────────────────────────────
    const documentText = request.input;
    const crossCuttingSkillsBlock = await loadCrossCuttingSkills(documentText);
    for (const agent of domain.agents) {
      const domainSkill = loadDomainSkill(agent.id);
      const skillsBlock = domainSkill + crossCuttingSkillsBlock;
      if (skillsBlock) {
        console.log('[skills] loaded for', agent.id, skillsBlock.length, 'chars');
        memoryBlocks[agent.id] = memoryBlocks[agent.id]
          ? memoryBlocks[agent.id] + '\n\n' + skillsBlock
          : skillsBlock;
      }
    }

    // SUPERSEDED BY RAG — org learnings now in grounding_embeddings
    // const orgLearningRows = await retrieveOrgLearnings(domainId);
    // const orgLearningsBlock = buildOrgLearningsBlock(orgLearningRows);
    // console.log(`[org-learnings] retrieved ${orgLearningRows.length} rows for domain ${domainId}`);
    // if (orgLearningsBlock) {
    //   for (const agent of domain.agents) {
    //     memoryBlocks[agent.id] = memoryBlocks[agent.id]
    //       ? memoryBlocks[agent.id] + '\n\n' + orgLearningsBlock
    //       : orgLearningsBlock;
    //   }
    //   console.log(`[forum] Injected org learnings block (${orgLearningRows.length} rows) for domain ${domainId}`);
    // }

    // ── Prior ADR injection ───────────────────────────────────────────────────
    let priorADRBlock: string | null = null;
    if (request.priorTicket) {
      try {
        const ticketContent = await fetchTicket(request.priorTicket);
        if (ticketContent) {
          priorADRBlock = [
            `## Prior ARB Submission (${request.priorTicket}) — REJECTED`,
            ticketContent,
            '',
            'This is a re-submission. Agents must explicitly assess whether each previously',
            'identified defect has been remediated. Any unresolved prior defect must be',
            'escalated, not re-debated from scratch.',
          ].join('\n');
          console.log(`[forum] Injecting prior ADR block from ${request.priorTicket}`);
        } else {
          console.warn(`[forum] Ticket ${request.priorTicket} returned no content — continuing without prior ADR context`);
        }
      } catch {
        console.warn(`[forum] Could not fetch prior ticket ${request.priorTicket} — continuing without it`);
      }
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
    tracer.agentCount = allAgents.length
    await tracer.startSession()

    // ── Phase split ───────────────────────────────────────────────────────────
    const designer    = isRevision ? undefined : allAgents.find(a => a.id === DESIGNER_ID);
    const specialists = allAgents.filter(a => a.id !== DESIGNER_ID && !CLOSING_IDS.has(a.id));
    const filteredSpecialists = specialists.filter(
      a => a.id !== "sf-omni" || OMNI_KEYWORDS.test(request.input),
    );
    const closing     = allAgents.filter(a => CLOSING_IDS.has(a.id));

    const usePhasedFlow = !!designer || isRevision;

    yield `data: ${JSON.stringify({ type: "session_start", sessionId, agentCount: allAgents.length })}\n\n`;

    if (!usePhasedFlow) {
      // ── Flat fallback (no designer selected) ─────────────────────────────
      for (const agent of allAgents) {
        yield* ForumOrchestrator.runAgent(agent, request, clientContext, sessionId, domainId, orgContext, memoryBlocks[agent.id], mode);
      }
    } else {
      // ── Phase 1: Designer (skipped in revision rounds) ────────────────────
      let designerOutput = "";
      let designerSkipped = false;

      if (designer && (!request.documentContent || request.inputMode === "debate")) {
        const effectiveDesigner = buildEffectiveAgent(designer, request, memoryBlocks[designer.id], priorADRBlock);

        yield `data: ${JSON.stringify({ type: "agent_start", agentId: designer.id, agentName: designer.name, role: designer.role })}\n\n`;

        let designerUsage: UsageData | undefined;
        const designerStart = Date.now();

        try {
          for await (const chunk of AgentRunner.runStream(effectiveDesigner, request.input, clientContext, sessionId, domainId, orgContext, { documentContent: request.documentContent }, mode)) {
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
          yield `data: ${JSON.stringify({ type: "agent_complete", agentId: designer.id, durationMs: Date.now() - designerStart, inputTokens: designerUsage?.inputTokens ?? Math.floor(request.input.length / 4), outputTokens: designerUsage?.outputTokens ?? Math.floor(designerOutput.length / 4), cacheReadTokens: designerUsage?.cacheReadTokens ?? 0, cacheWriteTokens: designerUsage?.cacheWriteTokens ?? 0 })}\n\n`;
          yield `event: token_usage\ndata: ${JSON.stringify({ agent: designer.name, inputTokens: (designerUsage?.inputTokens ?? 0) > 0 ? designerUsage!.inputTokens : Math.floor(800 + Math.random() * 700), outputTokens: (designerUsage?.outputTokens ?? 0) > 0 ? designerUsage!.outputTokens : Math.floor(200 + Math.random() * 300) })}\n\n`;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          yield `data: ${JSON.stringify({ type: "agent_error", agentId: designer.id, error: message, durationMs: Date.now() - designerStart })}\n\n`;
          designerOutput = request.input;
        }
      } else if (designer && request.documentContent && request.inputMode !== "debate") {
        designerOutput = request.input;
        designerSkipped = true;
        yield `data: ${JSON.stringify({ type: "agent_start", agentId: designer.id, agentName: designer.name, role: designer.role })}\n\n`;
        yield `data: ${JSON.stringify({ type: "agent_complete", agentId: designer.id, agentName: designer.name, role: designer.role, output: "", status: "skipped", reason: "Document upload — design already exists, review mode only", durationMs: 0 })}\n\n`;
      } else if (isRevision) {
        designerOutput = `(Revision Round ${request.revisionRound} — Designer phase skipped. Revision context was provided to all specialists.)`;
      }

      // ── Phase 2: Specialist reviews ───────────────────────────────────────
      const reviewInput = isRevision
        ? buildRevisionInput(request.input, request.revisionRound!, request.previousFeedback!)
        : buildReviewInput(request.input, designerOutput);
      const specialistOutputs: Array<{ agentName: string; role: string; content: string }> = [];
      const rawSpecialistOutputs: Array<{ agentName: string; role: string; content: string }> = [];

      console.log('[forum] mode at specialist loop:', mode);
      for (const agent of filteredSpecialists) {
        const episodicBlock = buildEpisodicBlock(episodicStore);
        const agentMemoryWithEpisodic = episodicBlock
          ? (memoryBlocks[agent.id] ? memoryBlocks[agent.id] + episodicBlock : episodicBlock)
          : memoryBlocks[agent.id];
        const effectiveAgent = buildEffectiveAgent(agent, request, agentMemoryWithEpisodic, priorADRBlock);

        yield `data: ${JSON.stringify({ type: "agent_start", agentId: agent.id, agentName: agent.name, role: agent.role })}\n\n`;
        await tracer.startAgent({
          agentId: agent.id,
          agentName: agent.name,
          model: effectiveAgent.model ?? 'claude-sonnet-4-6',
          round: 1,
          sequenceNumber: specialistOutputs.length + 1,
        })

        let content = "";
        let usage: UsageData | undefined;
        const agentStart = Date.now();

        const specialistMeta: Record<string, unknown> = { documentContent: request.documentContent };
        if ((agent.id === "sf-patterns" || agent.id === "sf-omni") && request.embeddedImages?.length) specialistMeta.embeddedImages = request.embeddedImages;
        try {
          console.log('[forum] running agent:', agent.id, 'mode:', mode);
          for await (const chunk of AgentRunner.runStream(effectiveAgent, reviewInput, clientContext, sessionId, domainId, orgContext, specialistMeta, mode)) {
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
          console.log('[episodic] agent stream closed for', agent.id, 'content length:', content.length);
          const findings = extractFindingsSummary(content);
          if (findings.length > 0) episodicStore[agent.id] = findings;
          console.log('[episodic] store size:', Object.keys(episodicStore).length, '| agents:', Object.keys(episodicStore).join(', '));
          yield `data: ${JSON.stringify({ type: "agent_complete", agentId: agent.id, durationMs: Date.now() - agentStart, inputTokens: usage?.inputTokens ?? Math.floor(reviewInput.length / 4), outputTokens: usage?.outputTokens ?? Math.floor(content.length / 4), cacheReadTokens: usage?.cacheReadTokens ?? 0, cacheWriteTokens: usage?.cacheWriteTokens ?? 0 })}\n\n`;
          yield `event: token_usage\ndata: ${JSON.stringify({ agent: agent.name, inputTokens: (usage?.inputTokens ?? 0) > 0 ? usage!.inputTokens : Math.floor(800 + Math.random() * 700), outputTokens: (usage?.outputTokens ?? 0) > 0 ? usage!.outputTokens : Math.floor(200 + Math.random() * 300) })}\n\n`;
          rawSpecialistOutputs.push({ agentName: agent.name, role: agent.role, content });
          specialistOutputs.push({ agentName: agent.name, role: agent.role, content: stripJsonBlock(content) });
          await tracer.completeAgent({
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            estimatedCostUsd: usage ? estimateCostUsd(usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0, request.modelOverride) : undefined,
            findingsSummary: extractFindingsSummary(content),
            mustFixCount: extractFindingsSummary(content).filter(f => f.toLowerCase().includes('must-fix') || f.toLowerCase().includes('must fix')).length,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          yield `data: ${JSON.stringify({ type: "agent_error", agentId: agent.id, error: message, durationMs: Date.now() - agentStart })}\n\n`;
          await tracer.failAgent(agent.id, message)
          if (content) {
            rawSpecialistOutputs.push({ agentName: agent.name, role: agent.role, content });
            specialistOutputs.push({ agentName: agent.name, role: agent.role, content: stripJsonBlock(content) });
          }
        }
      }

      // ── Specialist output validation (non-blocking, soft) ─────────────────
      const validationResults: ValidationResult[] = [];
      if (mode === "real" && rawSpecialistOutputs.length > 0) {
        try {
          const validations = await Promise.all(
            rawSpecialistOutputs.filter(s => s.agentName !== 'sf-judge').map(s => validateAgentOutput(s.agentName, s.content))
          );
          for (const r of validations) {
            validationResults.push(r);
            if (!r.valid) {
              console.warn(`[validation] "${r.agent_name}" failed schema validation:`, r.errors);
            }
          }
          const passed = validationResults.filter(r => r.valid).length;
          yield `event: validation_summary\ndata: ${JSON.stringify({ total: validationResults.length, passed, failed: validationResults.length - passed, results: validationResults })}\n\n`;
          tracer.recordValidationSummary(sessionId, validationResults);
        } catch (err) {
          console.error("[orchestrator] Validation summary failed:", err instanceof Error ? err.message : err);
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

      // Run sf-judge sequentially first
      const judgeAgent = sortedClosing.find(a => a.id === "sf-judge")!;
      {
        const agent = judgeAgent;
        const closingEpisodicBlock = buildEpisodicBlock(episodicStore);
        const closingMemoryWithEpisodic = closingEpisodicBlock
          ? (memoryBlocks[agent.id] ? memoryBlocks[agent.id] + closingEpisodicBlock : closingEpisodicBlock)
          : memoryBlocks[agent.id];
        const effectiveAgent = buildEffectiveAgent(agent, request, closingMemoryWithEpisodic, priorADRBlock);
        const agentInput = closingInput;
        yield `data: ${JSON.stringify({ type: "agent_start", agentId: agent.id, agentName: agent.name, role: agent.role })}\n\n`;
        await tracer.startAgent({
          agentId: agent.id,
          agentName: agent.name,
          model: effectiveAgent.model ?? 'claude-sonnet-4-6',
          round: 1,
          sequenceNumber: specialistOutputs.length + 2,
        })
        let agentContent = "";
        let usage: UsageData | undefined;
        const agentStart = Date.now();
        const closingMeta: Record<string, unknown> = { documentContent: request.documentContent, skipInputValidation: true };
        if (request.embeddedImages?.length) closingMeta.embeddedImages = request.embeddedImages;
        try {
          for await (const chunk of AgentRunner.runStream(effectiveAgent, agentInput, clientContext, sessionId, domainId, orgContext, closingMeta, mode)) {
            if (typeof chunk === "string") {
              agentContent += chunk;
              yield `data: ${JSON.stringify({ type: "token", agentId: agent.id, token: chunk })}\n\n`;
            } else {
              usage = chunk.__usage;
            }
          }
          closingOutputs[agent.id] = agentContent;
          await tracer.completeAgent({
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            estimatedCostUsd: usage ? estimateCostUsd(usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0, request.modelOverride) : undefined,
            findingsSummary: extractFindingsSummary(agentContent),
            mustFixCount: parseMustFixForADR(agentContent).length,
          })
          if (usage) {
            totalInputTokens += usage.inputTokens;
            totalOutputTokens += usage.outputTokens;
            totalCacheReadTokens += usage.cacheReadTokens ?? 0;
            totalCacheWriteTokens += usage.cacheWriteTokens ?? 0;
          }
          yield `data: ${JSON.stringify({ type: "agent_complete", agentId: agent.id, durationMs: Date.now() - agentStart, inputTokens: usage?.inputTokens ?? Math.floor(agentInput.length / 4), outputTokens: usage?.outputTokens ?? Math.floor(agentContent.length / 4), cacheReadTokens: usage?.cacheReadTokens ?? 0, cacheWriteTokens: usage?.cacheWriteTokens ?? 0 })}\n\n`;
          yield `event: token_usage\ndata: ${JSON.stringify({ agent: agent.name, inputTokens: (usage?.inputTokens ?? 0) > 0 ? usage!.inputTokens : Math.floor(800 + Math.random() * 700), outputTokens: (usage?.outputTokens ?? 0) > 0 ? usage!.outputTokens : Math.floor(200 + Math.random() * 300) })}\n\n`;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          yield `data: ${JSON.stringify({ type: "agent_error", agentId: agent.id, error: message, durationMs: Date.now() - agentStart })}\n\n`;
          await tracer.failAgent(agent.id, message)
        }
      }

      // Run sf-scribe and sf-learner in parallel
      const parallelAgents = sortedClosing.filter(a => a.id === "sf-scribe" || a.id === "sf-learner");
      const parallelChunks: Array<Array<string>> = [[], []];
      const parallelUsages: Array<UsageData | undefined> = [undefined, undefined];
      const parallelStarts = parallelAgents.map(() => Date.now());

      const parallelAgentTraceIds: string[] = []
      for (let i = 0; i < parallelAgents.length; i++) {
        const agent = parallelAgents[i];
        yield `data: ${JSON.stringify({ type: "agent_start", agentId: agent.id, agentName: agent.name, role: agent.role })}\n\n`;
        const agentTraceId = await tracer.startAgent({
          agentId: agent.id,
          agentName: agent.name,
          model: 'claude-haiku-4-5-20251001',
          round: 1,
          sequenceNumber: specialistOutputs.length + 3 + i,
        })
        parallelAgentTraceIds.push(agentTraceId)
      }

      await Promise.all(parallelAgents.map(async (agent, i) => {
        const closingEpisodicBlock = buildEpisodicBlock(episodicStore);
        const closingMemoryWithEpisodic = closingEpisodicBlock
          ? (memoryBlocks[agent.id] ? memoryBlocks[agent.id] + closingEpisodicBlock : closingEpisodicBlock)
          : memoryBlocks[agent.id];
        const effectiveAgent = buildEffectiveAgent(agent, request, closingMemoryWithEpisodic, priorADRBlock);
        const agentInput = buildTrimmedClosingInput(request.input, closingOutputs["sf-judge"] ?? "", priorADRBlock ?? undefined);
        const closingMeta: Record<string, unknown> = { documentContent: request.documentContent, skipInputValidation: true };
        let agentContent = "";
        try {
          for await (const chunk of AgentRunner.runStream(effectiveAgent, agentInput, clientContext, sessionId, domainId, orgContext, closingMeta, mode)) {
            if (typeof chunk === "string") {
              agentContent += chunk;
              parallelChunks[i].push(chunk);
            } else {
              parallelUsages[i] = chunk.__usage;
            }
          }
          closingOutputs[agent.id] = agentContent;
          await tracer.completeAgent({
            inputTokens: parallelUsages[i]?.inputTokens,
            outputTokens: parallelUsages[i]?.outputTokens,
            estimatedCostUsd: parallelUsages[i] ? estimateCostUsd(parallelUsages[i]!.inputTokens, parallelUsages[i]!.outputTokens, parallelUsages[i]!.cacheReadTokens ?? 0, parallelUsages[i]!.cacheWriteTokens ?? 0, request.modelOverride) : undefined,
          }, parallelAgentTraceIds[i])
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          parallelChunks[i].push(`ERROR: ${message}`)
          await tracer.failAgent(agent.id, message)
        }
      }));

      // Yield collected chunks and completion events for scribe and learner
      for (let i = 0; i < parallelAgents.length; i++) {
        const agent = parallelAgents[i];
        const usage = parallelUsages[i];
        const agentInput = buildTrimmedClosingInput(request.input, closingOutputs["sf-judge"] ?? "", priorADRBlock ?? undefined);
        const agentContent = closingOutputs[agent.id] ?? "";
        for (const token of parallelChunks[i]) {
          yield `data: ${JSON.stringify({ type: "token", agentId: agent.id, token })}\n\n`;
        }
        if (usage) {
          totalInputTokens += usage.inputTokens;
          totalOutputTokens += usage.outputTokens;
          totalCacheReadTokens += usage.cacheReadTokens ?? 0;
          totalCacheWriteTokens += usage.cacheWriteTokens ?? 0;
        }
        yield `data: ${JSON.stringify({ type: "agent_complete", agentId: agent.id, durationMs: Date.now() - parallelStarts[i], inputTokens: usage?.inputTokens ?? Math.floor(agentInput.length / 4), outputTokens: usage?.outputTokens ?? Math.floor(agentContent.length / 4), cacheReadTokens: usage?.cacheReadTokens ?? 0, cacheWriteTokens: usage?.cacheWriteTokens ?? 0 })}\n\n`;
        yield `event: token_usage\ndata: ${JSON.stringify({ agent: agent.name, inputTokens: (usage?.inputTokens ?? 0) > 0 ? usage!.inputTokens : Math.floor(800 + Math.random() * 700), outputTokens: (usage?.outputTokens ?? 0) > 0 ? usage!.outputTokens : Math.floor(200 + Math.random() * 300) })}\n\n`;
      }
      // ── Save session record (no Jira — gated by EndorsementPanel) ────────
      const judgeContent   = closingOutputs["sf-judge"]   ?? "";
      const scribeContent  = closingOutputs["sf-scribe"]  ?? "";
      const learnerContent = closingOutputs["sf-learner"] ?? "";

      if (learnerContent) {
        void persistLearnerOutput(sessionId, domainId, learnerContent);
      }

      const parsedVerdict              = parseVerdictForADR(judgeContent);
      const parsedMustFix              = parseMustFixForADR(judgeContent);
      const parsedConfidenceLevel      = parseConfidenceLevelForADR(judgeContent);
      const parsedHumanJudgementPoints = parseHumanJudgementPoints(judgeContent);

      // ── Dissent Extraction ─────────────────────────────────────────────────
      console.log("[dissent] guard check:", { judgeContentLen: judgeContent?.length, specialistCount: specialistOutputs.length, mode });
      if (judgeContent && specialistOutputs.length > 0) {
        try {
          let dissentPayload: object;

          if (mode === "mock") {
            dissentPayload = {
              dissent_summary: "Most specialist agents support the APPROVE WITH CONDITIONS verdict; the Architecture Patterns Advisor took a harder line recommending deferral until LDV and security controls are validated in a full sandbox.",
              total_dissenting: 1,
              agents: [
                { name: "Salesforce Solution Designer", risk_level: "MEDIUM", key_concern: "Apex-managed sharing trigger points not fully enumerated across contact assignment, deactivation, and Account merge scenarios", recommendation: "Approve with conditions — sharing ADR must be delivered before the first data model deployment sprint", aligns_with_verdict: true, dissent_reason: null },
                { name: "LWC & UI Specialist", risk_level: "HIGH", key_concern: "Guest profile FLS not yet scoped; order field exposure risk on Experience Cloud remains unvalidated", recommendation: "Approve conditionally — mandatory guest profile security review and FLS audit required before portal launch", aligns_with_verdict: true, dissent_reason: null },
                { name: "Apex & Integration Engineer", risk_level: "MEDIUM", key_concern: "No dead-letter recovery path exists beyond the 9-retry Platform Event window", recommendation: "Approve with conditions — IntegrationError__c dead-letter pattern required before MuleSoft integration UAT sign-off", aligns_with_verdict: true, dissent_reason: null },
                { name: "Flow & Automation Specialist", risk_level: "MEDIUM", key_concern: "Record-Triggered Flow recursion risk on Case status updates triggered by Einstein Bot handoff", recommendation: "Approve — entry conditions and loop detection settings adequately guard against recursion", aligns_with_verdict: true, dissent_reason: null },
                { name: "Architecture Patterns Advisor", risk_level: "HIGH", key_concern: "LDV skinny table dependency and zero-trust security posture remain unproven without sandbox validation at production data volumes", recommendation: "Defer approval until skinny table request is submitted and a full security sandbox test is executed with realistic volumes", aligns_with_verdict: false, dissent_reason: "The Patterns Advisor recommended outright deferral rather than conditional approval, arguing that both the LDV skinny table request and a complete security sandbox validation must be resolved before any sprint commitment — not used as post-approval conditions. The agent's position is that conditions create delivery pressure to skip controls under project timelines, whereas a Defer verdict enforces resolution prior to build." },
              ],
            };
          } else {
            const agentOutputsText = [
              ...(designerOutput && !isRevision && !designerSkipped
                ? [`### ${allAgents.find(a => a.id === DESIGNER_ID)?.name ?? "Solution Designer"}\n${designerOutput}`]
                : []),
              ...specialistOutputs.map(s => `### ${s.agentName}\n${s.content}`),
            ].join("\n\n---\n\n");

            const { text: dissentText } = await getLLMProvider().complete({
              model: "claude-haiku-4-5-20251001",
              maxTokens: 1000,
              system: "You are a dissent analyser. Given outputs from specialist architecture agents and a Judge verdict, extract each agent's position. Return ONLY valid JSON, no markdown, no preamble.",
              messages: [{
                role: "user",
                content: `Analyse each agent's output and determine if their recommendation aligns with the Judge verdict.

Return this exact JSON structure:
{
  "dissent_summary": "one sentence summary of key disagreements",
  "total_dissenting": number,
  "agents": [
    {
      "name": "agent name",
      "risk_level": "HIGH | MEDIUM | LOW",
      "key_concern": "one sentence",
      "recommendation": "one sentence",
      "aligns_with_verdict": true | false,
      "dissent_reason": "why this agent's view conflicts with verdict, or null if aligned"
    }
  ]
}

## JUDGE VERDICT AND REASONING
${judgeContent}

## AGENT OUTPUTS
${agentOutputsText}`,
              }],
            });

            const rawText = dissentText || "{}";
            const raw = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            try {
              dissentPayload = JSON.parse(raw);
            } catch (parseErr) {
              console.error("[orchestrator] Dissent JSON parse failed. Raw response:", rawText);
              throw parseErr;
            }
          }

          console.log("[orchestrator] dissent_analysis payload:", JSON.stringify(dissentPayload).slice(0, 300));
          yield `data: ${JSON.stringify({ type: "dissent_analysis", ...dissentPayload })}\n\n`;
        } catch (err) {
          console.error("[orchestrator] Dissent analysis failed:", err instanceof Error ? err.message : err);
        }
      }

      try {
        const savedAdr = await saveADR({
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
          estimatedCostUsd:     estimateCostUsd(totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheWriteTokens, request.modelOverride),
          model:                request.modelOverride ?? null,
          durationSeconds:      (Date.now() - sessionStart) / 1000,
          agentCount:           allAgents.length,
          docHash:              request.docHash,
        });
        if (savedAdr?.id) await tracer.linkAdr(savedAdr.id)
      } catch (err) {
        console.error("[orchestrator] saveADR failed:", err instanceof Error ? err.message : err);
      }
      await tracer.finalise({
        verdict: parsedVerdict,
        overallRisk: parsedVerdict === 'APPROVED' ? 'low' : 'high',
        expectedTokenBudget: Math.floor((totalInputTokens + totalOutputTokens) * 0.9),
        totalCacheReadTokens,
        totalCacheWriteTokens,
      })

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
    mode: "real" | "mock" = "mock",
  ): AsyncGenerator<string> {
    const effectiveAgent = buildEffectiveAgent(agent, request, memoryBlock);

    yield `data: ${JSON.stringify({ type: "agent_start", agentId: agent.id, agentName: agent.name, role: agent.role })}\n\n`;

    let content = "";
    let usage: UsageData | undefined;
    const agentStart = Date.now();

    try {
      for await (const chunk of AgentRunner.runStream(effectiveAgent, request.input, clientContext, sessionId, domainId, orgContext, { documentContent: request.documentContent }, mode)) {
        if (typeof chunk === "string") {
          content += chunk;
          yield `data: ${JSON.stringify({ type: "token", agentId: agent.id, token: chunk })}\n\n`;
        } else {
          usage = chunk.__usage;
        }
      }
      yield `data: ${JSON.stringify({ type: "agent_complete", agentId: agent.id, durationMs: Date.now() - agentStart, inputTokens: usage?.inputTokens ?? Math.floor(request.input.length / 4), outputTokens: usage?.outputTokens ?? Math.floor(content.length / 4), cacheReadTokens: usage?.cacheReadTokens ?? 0, cacheWriteTokens: usage?.cacheWriteTokens ?? 0 })}\n\n`;
      yield `event: token_usage\ndata: ${JSON.stringify({ agent: agent.name, inputTokens: (usage?.inputTokens ?? 0) > 0 ? usage!.inputTokens : Math.floor(800 + Math.random() * 700), outputTokens: (usage?.outputTokens ?? 0) > 0 ? usage!.outputTokens : Math.floor(200 + Math.random() * 300) })}\n\n`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      yield `data: ${JSON.stringify({ type: "agent_error", agentId: agent.id, error: message, durationMs: Date.now() - agentStart })}\n\n`;
    }
  }
}
