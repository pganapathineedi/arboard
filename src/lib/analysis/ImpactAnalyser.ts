import Anthropic from "@anthropic-ai/sdk";
import type { AgentActivation, ImpactAnalysis } from "@/lib/types";
import type { OrgContext } from "@/lib/types/salesforce";
import { PromptBuilder } from "@/lib/prompt/PromptBuilder";
import { isMockMode, getMockImpactAnalysis } from "@/lib/mock/mockMode";

const anthropic = new Anthropic();

const ANALYSER_SYSTEM = `You are a Salesforce Architecture Impact Analyser for an Architecture Review Board.
You will receive either a SHORT REQUIREMENT (1-3 paragraphs) or a FULL SOLUTION DESIGN DOCUMENT.

For a SHORT REQUIREMENT: analyse it directly to determine agent coverage and risks.
For a FULL SOLUTION DESIGN DOCUMENT: first extract the key architecture decisions, proposed Salesforce components, integration patterns, and stated risks — then map these to the specialist agents who must review them.

Available agents and their scope:
- sf-designer: Solution architecture, data model design, org strategy, integration architecture, multi-cloud
- sf-lwc: Lightning Web Components, LWC lifecycle, SLDS, Experience Cloud, LMS, Aura migration
- sf-omni: OmniStudio, OmniScript, DataRaptor, FlexCards, Integration Procedures, Industry Cloud
- sf-flow: Flow automation, Record-Triggered Flow, Screen Flow, Scheduled Flow, Process Builder migration
- sf-apex: Apex code, triggers, batch jobs, queueable chains, REST/SOAP integrations
- sf-patterns: Architecture patterns, Well-Architected Framework, scalability, LDV, AppExchange patterns
- sf-judge: Final ARB verdict — ALWAYS required
- sf-scribe: ADR documentation — ALWAYS required
- sf-learner: Extract session learnings — ALWAYS required

Risk classification:
- critical: data loss, security breach, org corruption, breaking production
- high: significant org-wide impact, governor limit risk, major integration change
- medium: moderate complexity, affects a team or process, new technology introduced
- low: isolated change, low complexity, no cross-system impact`;

const ANALYSE_TOOL: Anthropic.Tool = {
  name: "report_impact_analysis",
  description: "Report the full impact analysis for an architecture review",
  input_schema: {
    type: "object" as const,
    required: ["summary", "overallRisk", "estimatedComplexity", "activatedAgents", "sfConsiderations"],
    properties: {
      summary: {
        type: "string",
        description: "2-3 sentence summary of the requirement and its Salesforce impact",
      },
      overallRisk: {
        type: "string",
        enum: ["critical", "high", "medium", "low"],
        description: "Overall risk level for this requirement",
      },
      estimatedComplexity: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Implementation complexity estimate",
      },
      activatedAgents: {
        type: "array",
        description: "Agents that must review this requirement",
        items: {
          type: "object",
          required: ["agentId", "agentName", "reason", "sfRisks", "priority"],
          properties: {
            agentId: { type: "string" },
            agentName: { type: "string" },
            reason: {
              type: "string",
              description: "Why this agent specifically needs to review this requirement",
            },
            sfRisks: {
              type: "array",
              items: { type: "string" },
              description: "2-3 specific Salesforce risks this agent must address",
            },
            priority: {
              type: "string",
              enum: ["required", "recommended", "optional"],
            },
          },
        },
      },
      sfConsiderations: {
        type: "array",
        items: { type: "string" },
        description: "Cross-cutting Salesforce concerns that apply to the whole session",
      },
    },
  },
};

export class ImpactAnalyser {
  static async analyse(input: string, domainId = "salesforce", orgContext?: OrgContext): Promise<ImpactAnalysis> {
    if (isMockMode()) {
      await new Promise((r) => setTimeout(r, 800));
      return getMockImpactAnalysis();
    }

    const orgBlock = orgContext ? PromptBuilder.buildOrgContextBlock(orgContext) : "";
    const userContent = orgBlock
      ? `${orgBlock}\n\nREQUIREMENT TO ANALYSE:\nGiven this requirement AND the actual org state above, identify which agents are needed and what SPECIFIC risks exist given the real data volumes, existing automation, and current limits.\n\n${input}`
      : `Analyse this Salesforce requirement and determine which specialist agents to activate:\n\n${input}`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: ANALYSER_SYSTEM,
      tools: [ANALYSE_TOOL],
      tool_choice: { type: "any" },
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("ImpactAnalyser: no tool_use block returned from Claude");
    }

    const raw = toolUse.input as {
      summary: string;
      overallRisk: string;
      estimatedComplexity: string;
      activatedAgents: AgentActivation[];
      sfConsiderations: string[];
    };

    return {
      summary: raw.summary,
      overallRisk: raw.overallRisk as ImpactAnalysis["overallRisk"],
      estimatedComplexity: raw.estimatedComplexity as ImpactAnalysis["estimatedComplexity"],
      activatedAgents: raw.activatedAgents,
      sfConsiderations: raw.sfConsiderations,
    };
  }
}
