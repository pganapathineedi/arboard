import manifest from "@/config/agentManifest.json";

export interface AgentManifestEntry {
  id: string;
  name: string;
  file: string;
  promptFile: string;
  keywords: string[];
  enabled: boolean;
  alwaysInclude?: boolean;
}

const _manifest = manifest as { agents: AgentManifestEntry[] };

export function getEnabledAgents(): AgentManifestEntry[] {
  return _manifest.agents.filter((a) => a.enabled);
}

export function getKeywordMap(): Record<string, string[]> {
  return Object.fromEntries(
    getEnabledAgents()
      .filter((a) => !a.alwaysInclude)
      .map((a) => [a.id, a.keywords])
  );
}

export function getAlwaysIncludeAgents(): AgentManifestEntry[] {
  return getEnabledAgents().filter((a) => a.alwaysInclude);
}
