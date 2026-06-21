import type { MiddlewareContext, MiddlewareFn } from "@/lib/types";
import { PromptBuilder } from "@/lib/prompt/PromptBuilder";

export const injectContext: MiddlewareFn = async (ctx, next) => {
  const contextBlock = PromptBuilder.buildContextBlock(ctx.clientContext);
  ctx.systemPrompt = ctx.systemPrompt + "\n\n" + contextBlock;
  return next();
};
