import type { MiddlewareContext, MiddlewareFn } from "@/lib/types";

const sessionCallCounts = new Map<string, number>();
const SESSION_LIMIT = 20;

export const rateLimiter: MiddlewareFn = async (ctx, next) => {
  const count = sessionCallCounts.get(ctx.sessionId) ?? 0;
  if (count >= SESSION_LIMIT) {
    throw new Error(`Rate limit exceeded for session ${ctx.sessionId} (max ${SESSION_LIMIT} calls)`);
  }
  sessionCallCounts.set(ctx.sessionId, count + 1);
  return next();
};
