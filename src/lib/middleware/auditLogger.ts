import type { MiddlewareContext, MiddlewareFn } from "@/lib/types";

export const auditLogger: MiddlewareFn = async (ctx, next) => {
  const start = Date.now();
  console.log(`[AUDIT] session=${ctx.sessionId} agent=${ctx.agentId} domain=${ctx.domainId} inputLen=${ctx.input.length}`);

  const result = await next();

  const duration = Date.now() - start;
  console.log(`[AUDIT] session=${ctx.sessionId} agent=${ctx.agentId} completed in ${duration}ms`);
  ctx.metadata.durationMs = duration;

  return result;
};
