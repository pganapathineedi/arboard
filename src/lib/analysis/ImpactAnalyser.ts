import Anthropic from "@anthropic-ai/sdk";
import type { AgentActivation, ImpactAnalysis } from "@/lib/types";
import type { OrgContext } from "@/lib/types/salesforce";
import { PromptBuilder } from "@/lib/prompt/PromptBuilder";
import { isMockMode, isMockModeExplicit } from "@/lib/mock/mockMode";

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
- sf-integration: MuleSoft, API-led connectivity, external system integration, event-driven architecture, REST/SOAP APIs
- sf-patterns: Architecture patterns, Well-Architected Framework, scalability, LDV, AppExchange patterns
- sf-data: Data model design, sharing model (OWD/roles/rules), LDV risk, data governance, PII/encryption
- sf-judge: Final ARB verdict — ALWAYS required
- sf-scribe: ADR documentation — ALWAYS required
- sf-learner: Extract session learnings — ALWAYS required

Risk classification:
- critical: data loss, security breach, org corruption, breaking production
- high: significant org-wide impact, governor limit risk, major integration change
- medium: moderate complexity, affects a team or process, new technology introduced
- low: isolated change, low complexity, no cross-system impact

Be concise. Each agent reason must be under 15 words. Each sfRisks entry under 10 words. Maximum 2 sfRisks per agent.

Respond with ONLY a valid JSON object — no markdown fences, no explanation. Use this exact structure:
{
  "summary": "2-3 sentence summary of the requirement and its Salesforce impact",
  "overallRisk": "critical|high|medium|low",
  "estimatedComplexity": "low|medium|high",
  "activatedAgents": [
    {
      "agentId": "sf-designer|sf-lwc|sf-apex|sf-flow|sf-omni|sf-integration|sf-patterns|sf-data|sf-judge|sf-scribe|sf-learner",
      "agentName": "human-readable display name e.g. LWC Specialist, Apex Engineer",
      "priority": "required|recommended|optional",
      "reason": "one line explaining why this agent is needed",
      "sfRisks": ["specific risk 1", "specific risk 2"]
    }
  ],
  "sfConsiderations": ["cross-cutting concern 1", "cross-cutting concern 2"]
}`;


export class ImpactAnalyser {
  static async analyse(input: string, domainId = "salesforce", orgContext?: OrgContext, mode: "real" | "mock" = "mock"): Promise<ImpactAnalysis> {
    if (isMockModeExplicit(mode)) {
      await new Promise((r) => setTimeout(r, 800));
      return {
        summary: "NovaPeak Financial Services requires migration of core banking workflows to Salesforce Financial Services Cloud, with real-time transaction processing via MuleSoft and a self-service client portal on Experience Cloud. This spans FSC data model changes, complex Apex integrations, and regulatory compliance under APRA-CPS234.",
        overallRisk: "high",
        estimatedComplexity: "high",
        activatedAgents: [
          { agentId: "sf-designer",     agentName: "Solution Designer",      reason: "FSC data model design and org strategy for core banking migration",                       sfRisks: ["FSC Account–Person Account model conflicts with existing schema", "Multi-currency data model implications for transaction records"],         priority: "required" },
          { agentId: "sf-apex",         agentName: "Apex Specialist",        reason: "Complex Apex integrations for real-time transaction processing and batch reconciliation", sfRisks: ["Governor limits on high-volume transaction triggers", "Async processing patterns for MuleSoft callback handlers"],                   priority: "required" },
          { agentId: "sf-integration",  agentName: "Integration Architect",  reason: "MuleSoft API-led connectivity for core banking system integration",                       sfRisks: ["Real-time transaction throughput approaching API governor limits", "Error handling and retry patterns for financial-grade reliability"],      priority: "required" },
          { agentId: "sf-patterns",     agentName: "Patterns Architect",     reason: "Large Data Volume patterns for transaction history and compliance archiving",             sfRisks: ["LDV skinny table strategy required for high-volume transaction records", "APRA-CPS234 data retention and archiving pattern selection"],        priority: "required" },
          { agentId: "sf-data",         agentName: "Data Architecture Specialist", reason: "FSC data model, sharing model, and LDV governance for transaction objects",          sfRisks: ["OWD and role hierarchy design for FSC Account/Person Account sharing", "PII field governance required for APRA-CPS234 compliance"],             priority: "required" },
          { agentId: "sf-judge",        agentName: "ARB Judge",              reason: "Final ARB verdict required",                                                              sfRisks: [],                                                                                                                                          priority: "required" },
          { agentId: "sf-scribe",       agentName: "ADR Scribe",             reason: "ADR documentation required",                                                              sfRisks: [],                                                                                                                                          priority: "required" },
          { agentId: "sf-learner",      agentName: "Session Learner",        reason: "Extract session learnings required",                                                       sfRisks: [],                                                                                                                                          priority: "required" },
        ],
        sfConsiderations: [
          "APRA-CPS234 compliance mandates encryption at rest and in transit for all financial transaction data",
          "FSC Actionable Relationship Centre configuration must align with NovaPeak's client relationship hierarchy",
          "Platform Event replay buffer sizing is critical for real-time transaction processing reliability",
        ],
      };
    }

    const anthropic = new Anthropic();
    const orgBlock = orgContext ? PromptBuilder.buildOrgContextBlock(orgContext) : "";
    const userContent = orgBlock
      ? `${orgBlock}\n\nREQUIREMENT TO ANALYSE:\nGiven this requirement AND the actual org state above, identify which agents are needed and what SPECIFIC risks exist given the real data volumes, existing automation, and current limits.\n\n${input}`
      : `Analyse this Salesforce requirement and determine which specialist agents to activate:\n\n${input}`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: ANALYSER_SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text" || !textBlock.text) {
      throw new Error("ImpactAnalyser: no text response returned from Claude");
    }

    const cleaned = textBlock.text.replace(/```json\n?|\n?```/g, "").trim();
    const raw = JSON.parse(cleaned) as {
      summary: string;
      overallRisk: string;
      estimatedComplexity: string;
      activatedAgents: Array<{ agentId: string; agentName: string; priority: string; reason: string; sfRisks: string[] }>;
      sfConsiderations: string[];
    };

    return {
      summary: raw.summary,
      overallRisk: raw.overallRisk as ImpactAnalysis["overallRisk"],
      estimatedComplexity: raw.estimatedComplexity as ImpactAnalysis["estimatedComplexity"],
      activatedAgents: raw.activatedAgents as AgentActivation[],
      sfConsiderations: raw.sfConsiderations,
    };
  }
}
