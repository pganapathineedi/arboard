import type { MiddlewareContext, MiddlewareFn } from "@/lib/types";

export const injectLearnings: MiddlewareFn = async (ctx, next) => {
  const learnings = ctx.clientContext.learnings;
  if (learnings && learnings.length > 0) {
    const block = `\n\n## Previous Session Learnings\nApply these org-specific insights:\n${learnings
      .map((l, i) => `${i + 1}. ${l}`)
      .join("\n")}`;
    ctx.systemPrompt = ctx.systemPrompt + block;
  }
  return next();
};
