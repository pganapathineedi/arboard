import type { AgentConfig, AgentSections, ClientContext } from "@/lib/types";
import type { OrgContext } from "@/lib/types/salesforce";

export class PromptBuilder {
  static buildSystemPrompt(
    agent: AgentConfig,
    clientContext: ClientContext,
    sectionOverrides?: Partial<AgentSections>,
    orgContext?: OrgContext,
  ): string {
    const sections = { ...agent.sections, ...sectionOverrides };

    const contextBlock = PromptBuilder.buildContextBlock(clientContext);
    const orgBlock = orgContext ? PromptBuilder.buildOrgContextBlock(orgContext) : "";

    return [
      `## Role\n${sections.persona}`,
      `## Expertise\n${sections.expertise}`,
      `## Guardrails\n${sections.guardrails}`,
      `## Output Format\n${sections.format}`,
      contextBlock,
      orgBlock,
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

  static buildOrgContextBlock(ctx: OrgContext): string {
    const lines: string[] = [];
    const { orgProfile, dataVolumes, installedPackages, automationDetails, sharingModels, limitsSnapshot, experienceCloudSites } = ctx;

    lines.push("# ORG CONTEXT — This is the ACTUAL state of the customer's Salesforce org. Every recommendation must account for what already exists here.");
    lines.push("");
    lines.push(`Organisation: ${orgProfile.orgName}${orgProfile.isSandbox ? " Sandbox" : " Production Org"}`);
    lines.push(`Edition: ${orgProfile.edition} · API v${orgProfile.apiVersion}`);
    if (limitsSnapshot.licensedUsers > 0) {
      lines.push(`Active users: ${limitsSnapshot.activeUsers.toLocaleString()} of ${limitsSnapshot.licensedUsers.toLocaleString()} licensed`);
    }

    if (dataVolumes.length > 0) {
      lines.push("");
      lines.push("DATA VOLUMES (current):");
      for (const dv of dataVolumes) {
        const flag = dv.risk !== "LOW" ? `  ← ${dv.risk}` : "";
        lines.push(`${dv.objectName.padEnd(20)} ${dv.recordCount.toLocaleString().padStart(14)} records${flag}`);
      }
    }

    if (automationDetails.length > 0) {
      lines.push("");
      lines.push("EXISTING AUTOMATION ON RELEVANT OBJECTS:");
      for (const a of automationDetails.slice(0, 15)) {
        const parts: string[] = [];
        if (a.flowCount > 0) parts.push(`${a.flowCount} active Flow${a.flowCount > 1 ? "s" : ""}`);
        if (a.triggerCount > 0) parts.push(`${a.triggerCount} Apex trigger${a.triggerCount > 1 ? "s" : ""}`);
        if (a.hasDeprecatedAutomation) parts.push("1 Process Builder ← DEPRECATED");
        if (parts.length > 0) lines.push(`${a.objectName}: ${parts.join(", ")}`);
      }
    }

    if (installedPackages.length > 0) {
      lines.push("");
      lines.push("INSTALLED PACKAGES:");
      lines.push(installedPackages.map(p => `${p.name}${p.version ? ` (v${p.version})` : ""}`).join(", "));
    }

    if (sharingModels.length > 0) {
      lines.push("");
      lines.push("SHARING MODEL:");
      for (const s of sharingModels.slice(0, 8)) {
        lines.push(`${s.objectName} OWD: ${s.owd}${s.hasApexSharing ? " (Apex-managed sharing active)" : ""}`);
      }
    }

    const { dailyApiCallsUsed, dailyApiCallsTotal, dataStorageMBUsed, dataStorageMBTotal, fileStorageMBUsed, fileStorageMBTotal } = limitsSnapshot;
    if (dailyApiCallsTotal > 0 || dataStorageMBTotal > 0) {
      lines.push("");
      lines.push("API LIMITS (current usage):");
      if (dailyApiCallsTotal > 0) {
        const apiPct = Math.round((dailyApiCallsUsed / dailyApiCallsTotal) * 100);
        lines.push(`Daily API calls: ${dailyApiCallsUsed.toLocaleString()} of ${dailyApiCallsTotal.toLocaleString()} (${apiPct}%)`);
      }
      if (dataStorageMBTotal > 0) {
        const dataPct = Math.round((dataStorageMBUsed / dataStorageMBTotal) * 100);
        const flag = dataPct >= 85 ? " ← WARNING" : "";
        lines.push(`Data storage: ${(dataStorageMBUsed / 1024).toFixed(1)} GB of ${(dataStorageMBTotal / 1024).toFixed(1)} GB${flag}`);
      }
      if (fileStorageMBTotal > 0) {
        lines.push(`File storage: ${(fileStorageMBUsed / 1024).toFixed(1)} GB of ${(fileStorageMBTotal / 1024).toFixed(1)} GB`);
      }
    }

    if (experienceCloudSites.length > 0) {
      lines.push("");
      lines.push("EXPERIENCE CLOUD SITES:");
      for (const s of experienceCloudSites) {
        lines.push(`${s.name} (${s.templateType} template, ${s.status})`);
      }
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
