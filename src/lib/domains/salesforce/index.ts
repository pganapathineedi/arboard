import type { AgentConfig, DomainConfig } from "@/lib/types";
import { designerAgent } from "./agents/designer";
import { lwcAgent } from "./agents/lwc";
import { omniStudioAgent } from "./agents/omniStudio";
import { flowAgent } from "./agents/flow";
import { apexAgent } from "./agents/apex";
import { patternsAgent } from "./agents/patterns";
import { judgeAgent } from "./agents/judge";
import { scribeAgent } from "./agents/scribe";
import { learnerAgent } from "./agents/learner";
import { integrationAgent } from "./agents/integration";
import { dataAgent } from "./agents/data";
import { agentforceAgent } from "./agents/agentforce";
import { profilesPermissionsAgent } from "./agents/profiles-permissions";
import { getEnabledAgents } from "@/lib/config/manifestLoader";

const _agentLookup: Record<string, AgentConfig> = {
  designer: designerAgent,
  lwc: lwcAgent,
  omniStudio: omniStudioAgent,
  flow: flowAgent,
  apex: apexAgent,
  patterns: patternsAgent,
  judge: judgeAgent,
  scribe: scribeAgent,
  learner: learnerAgent,
  integration: integrationAgent,
  data: dataAgent,
  agentforce: agentforceAgent,
  "profiles-permissions": profilesPermissionsAgent,
};

export const salesforceDomain: DomainConfig = {
  id: "salesforce",
  name: "Salesforce Architecture Review Board",
  agents: getEnabledAgents()
    .map((entry) => _agentLookup[entry.file])
    .filter((a): a is AgentConfig => Boolean(a)),
  complianceRules: [
    "All Apex code must respect governor limits in bulk scenarios (200+ records)",
    "No hardcoded IDs in code or configuration",
    "Security review required: CRUD/FLS, sharing model, profile/permission set alignment",
    "Declarative-first: custom code only when declarative is insufficient or impractical",
    "All integrations must use Named Credentials — no hardcoded endpoints",
    "Release management: unlocked packages preferred over change sets",
  ],
  contextDefaults: {
    platform: "Salesforce",
    defaultOrgType: "Enterprise Edition",
    apiVersion: "61.0",
    reviewStandard: "Salesforce Well-Architected Framework",
  },
};

export const DOMAIN_REGISTRY: Record<string, DomainConfig> = {
  salesforce: salesforceDomain,
};

export function getDomain(domainId: string): DomainConfig {
  const domain = DOMAIN_REGISTRY[domainId];
  if (!domain) {
    throw new Error(`Unknown domain: ${domainId}. Available: ${Object.keys(DOMAIN_REGISTRY).join(", ")}`);
  }
  return domain;
}
