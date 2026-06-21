import type { MiddlewareContext, MiddlewareFn } from "@/lib/types";
import { validateInput } from "./validateInput";
import { loadContext } from "./loadContext";
import { injectContext } from "./injectContext";
import { injectLearnings } from "./injectLearnings";
import { enforceCompliance } from "./enforceCompliance";
import { rateLimiter } from "./rateLimiter";
import { auditLogger } from "./auditLogger";

export { validateInput, loadContext, injectContext, injectLearnings, enforceCompliance, rateLimiter, auditLogger };

export function buildPipeline(...fns: MiddlewareFn[]): MiddlewareFn {
  return async (ctx: MiddlewareContext, next: () => Promise<MiddlewareContext>) => {
    let index = 0;

    const dispatch = async (): Promise<MiddlewareContext> => {
      if (index < fns.length) {
        const fn = fns[index++];
        return fn(ctx, dispatch);
      }
      return next();
    };

    return dispatch();
  };
}

export const defaultPipeline = buildPipeline(
  auditLogger,
  validateInput,
  loadContext,      // enrich clientContext from stored profile before prompt assembly
  injectContext,
  injectLearnings,
  enforceCompliance,
  rateLimiter
);
