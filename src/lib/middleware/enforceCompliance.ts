import type { MiddlewareContext, MiddlewareFn } from "@/lib/types";
import { getDomain } from "@/lib/domains/salesforce";

export const enforceCompliance: MiddlewareFn = async (ctx, next) => {
  try {
    const domain = getDomain(ctx.domainId);
    if (domain.complianceRules.length > 0) {
      const rulesBlock = `\n\n## Mandatory Compliance Rules\nYou MUST enforce these rules in your review:\n${domain.complianceRules
        .map((r, i) => `${i + 1}. ${r}`)
        .join("\n")}`;
      ctx.systemPrompt = ctx.systemPrompt + rulesBlock;
    }
  } catch {
    // Domain not found — skip compliance injection
  }
  return next();
};
