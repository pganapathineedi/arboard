export type PricingModelId =
  | "claude-haiku-4-5-20251001"
  | "claude-sonnet-4-6"
  | "claude-opus-4-8";

export interface ModelPricing {
  inputPer1K:      number; // $ per 1,000 tokens
  outputPer1K:     number;
  cacheReadPer1K:  number;
  cacheWritePer1K: number; // 1.25× input — Anthropic standard ratio
}

export const MODEL_PRICING: Record<PricingModelId, ModelPricing> = {
  "claude-haiku-4-5-20251001": {
    inputPer1K:      0.0008,
    outputPer1K:     0.004,
    cacheReadPer1K:  0.00008,
    cacheWritePer1K: 0.001,
  },
  "claude-sonnet-4-6": {
    inputPer1K:      0.003,
    outputPer1K:     0.015,
    cacheReadPer1K:  0.0003,
    cacheWritePer1K: 0.00375,
  },
  "claude-opus-4-8": {
    inputPer1K:      0.015,
    outputPer1K:     0.075,
    cacheReadPer1K:  0.0015,
    cacheWritePer1K: 0.01875,
  },
};

const FALLBACK = MODEL_PRICING["claude-haiku-4-5-20251001"];

export function estimateCostUsd(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  modelId?: string | null,
): number {
  const p = MODEL_PRICING[modelId as PricingModelId] ?? FALLBACK;
  return (
    input      * p.inputPer1K +
    output     * p.outputPer1K +
    cacheRead  * p.cacheReadPer1K +
    cacheWrite * p.cacheWritePer1K
  ) / 1000;
}
