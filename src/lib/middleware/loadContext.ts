import type { MiddlewareFn } from "@/lib/types";
import { ContextStore } from "@/lib/context/ContextStore";

// Loads a stored ClientProfile by clientName and merges it into the request context.
// The request context always wins on direct field conflicts; learnings and constraints are unioned.
export const loadContext: MiddlewareFn = async (ctx, next) => {
  const clientName = ctx.clientContext.clientName;
  if (clientName) {
    const profile = ContextStore.load(clientName);
    if (profile) {
      ctx.clientContext = ContextStore.merge(profile.context, ctx.clientContext);
    }
  }
  return next();
};
