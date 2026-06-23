import type { ClientConfig, AgentPromptOverride } from './types';

const configCache: Record<string, ClientConfig> = {};

export async function getClientConfig(): Promise<ClientConfig> {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) throw new Error('CLIENT_ID env var is not set');
  if (configCache[clientId]) return configCache[clientId];
  try {
    const mod = await import(`./${clientId}/config`);
    configCache[clientId] = mod.default as ClientConfig;
    return configCache[clientId];
  } catch {
    throw new Error(`No client config found for CLIENT_ID="${clientId}". Expected: src/lib/clients/${clientId}/config.ts`);
  }
}

export async function getClientAgentOverrides(clientId: string): Promise<AgentPromptOverride[]> {
  try {
    const mod = await import(`./${clientId}/agent-overrides`);
    return mod.default ?? [];
  } catch {
    return [];
  }
}
