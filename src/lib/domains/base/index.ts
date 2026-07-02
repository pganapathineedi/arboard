import type { AgentConfig, DomainConfig } from "@/lib/types";

export const BASE_MODEL = "claude-haiku-4-5-20251001";
export const BASE_MAX_TOKENS = 600;
export const SPECIALIST_MAX_TOKENS = 2000;

export function createBaseAgent(partial: Partial<AgentConfig> & Pick<AgentConfig, "id" | "name" | "role" | "sections">): AgentConfig {
  return {
    model: BASE_MODEL,
    maxTokens: BASE_MAX_TOKENS,
    temperature: 0.3,
    ...partial,
  };
}

export function mergeDomain(base: DomainConfig, overrides: Partial<DomainConfig>): DomainConfig {
  return {
    ...base,
    ...overrides,
    agents: overrides.agents ?? base.agents,
    complianceRules: [
      ...base.complianceRules,
      ...(overrides.complianceRules ?? []),
    ],
    contextDefaults: {
      ...base.contextDefaults,
      ...(overrides.contextDefaults ?? {}),
    },
  };
}
