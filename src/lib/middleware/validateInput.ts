import type { MiddlewareContext, MiddlewareFn } from "@/lib/types";

const MAX_INPUT_LENGTH = 32000;
const MIN_INPUT_LENGTH = 10;

export const validateInput: MiddlewareFn = async (ctx, next) => {
  if (!ctx.input || ctx.input.trim().length === 0) {
    throw new Error("Input cannot be empty");
  }
  if (ctx.input.length < MIN_INPUT_LENGTH) {
    throw new Error(`Input too short (minimum ${MIN_INPUT_LENGTH} characters)`);
  }
  if (ctx.input.length > MAX_INPUT_LENGTH) {
    throw new Error(`Input too long (maximum ${MAX_INPUT_LENGTH} characters)`);
  }
  return next();
};
