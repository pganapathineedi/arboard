import type { AgentConfig, AgentSections, ClientContext } from "@/lib/types";

export class PromptBuilder {
  static buildSystemPrompt(
    agent: AgentConfig,
    clientContext: ClientContext,
    sectionOverrides?: Partial<AgentSections>
  ): string {
    const sections = { ...agent.sections, ...sectionOverrides };

    const contextBlock = PromptBuilder.buildContextBlock(clientContext);

    return [
      `## Role\n${sections.persona}`,
      `## Expertise\n${sections.expertise}`,
      `## Guardrails\n${sections.guardrails}`,
      `## Output Format\n${sections.format}`,
      contextBlock,
      sections.extra ? `## Additional Context\n${sections.extra}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  static buildContextBlock(ctx: ClientContext): string {
    const lines: string[] = ["## Client Context"];

    if (ctx.clientName) lines.push(`- Client: ${ctx.clientName}`);
    if (ctx.industry) lines.push(`- Industry: ${ctx.industry}`);
    if (ctx.sfOrg) lines.push(`- Salesforce Org: ${ctx.sfOrg}`);
    if (ctx.sfEdition) lines.push(`- Edition: ${ctx.sfEdition}`);
    if (ctx.existingProducts?.length) {
      lines.push(`- Existing Products: ${ctx.existingProducts.join(", ")}`);
    }
    if (ctx.constraints?.length) {
      lines.push(`- Known Constraints:\n${ctx.constraints.map((c) => `  - ${c}`).join("\n")}`);
    }
    if (ctx.learnings?.length) {
      lines.push(`- Org Learnings:\n${ctx.learnings.map((l) => `  - ${l}`).join("\n")}`);
    }

    return lines.join("\n");
  }

  static overrideSection(
    agent: AgentConfig,
    section: keyof AgentSections,
    override: string
  ): AgentConfig {
    return {
      ...agent,
      sections: { ...agent.sections, [section]: override },
    };
  }
}
