import type { MiddlewareFn } from "@/lib/types";
import { getClientConfig, getClientAgentOverrides } from "@/lib/clients";

export const injectClientContext: MiddlewareFn = async (ctx, next) => {
  if (!process.env.CLIENT_ID) return next();

  const config = await getClientConfig();
  const overrides = await getClientAgentOverrides(config.clientId);

  const contextPrefix = [
    `== CLIENT CONTEXT ==`,
    `Client: ${config.name} (${config.industry})`,
    `Salesforce clouds in scope: ${config.salesforceClouds.join(', ')}`,
    config.regulatoryOverlays.length > 0
      ? `Regulatory overlays: ${config.regulatoryOverlays.join(', ')}. All recommendations must comply. Flag compliance risks as MUST-FIX.`
      : '',
    `== END CLIENT CONTEXT ==`,
  ].filter(Boolean).join('\n');

  const override = overrides.find(o => o.agentId === ctx.agentId);
  const overrideSuffix = override
    ? Object.entries(override.sections)
        .filter(([, v]) => v)
        .map(([k, v]) => `== CLIENT OVERRIDE: ${k.toUpperCase()} ==\n${v}`)
        .join('\n\n')
    : '';

  ctx.systemPrompt = [contextPrefix, ctx.systemPrompt, overrideSuffix].filter(Boolean).join('\n\n');

  return next();
};
