import type { ImpactAnalysis } from "@/lib/types";

export interface DeliveryEstimate {
  dimensions: {
    traditional: { weeks: number; cost: number };
    aiAugmented: { weeks: number; cost: number };
    aiNative:    { weeks: number; cost: number };
  };
  confidence: { range: number };
  phases: Array<{ name: string; traditional: number; aiAugmented: number }>;
}

export interface AgentOutput {
  agentId: string;
  agentName: string;
  role: string;
  content: string;
  complete: boolean;
  skipped?: boolean;
  error?: string;
  startTime: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface DissentAgent {
  name: string;
  risk_level: "HIGH" | "MEDIUM" | "LOW";
  key_concern: string;
  recommendation: string;
  aligns_with_verdict: boolean;
  dissent_reason: string | null;
}

export interface DissentData {
  dissent_summary: string;
  total_dissenting: number;
  agents: DissentAgent[];
}

export interface SSEEvent {
  type: string;
  sessionId?: string;
  agentId?: string;
  agentName?: string;
  role?: string;
  token?: string;
  error?: string;
  analysis?: ImpactAnalysis;
  agentCount?: number;
  status?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  jiraIssueKey?: string | null;
  jiraIssueUrl?: string | null;
  // pending_endorsement fields
  requirement?: string;
  verdict?: string;
  confidenceLevel?: string;
  humanJudgementPoints?: string[];
  scribeNotes?: string;
  mustFixIssues?: string[];
  // dissent_analysis fields
  dissent_summary?: string;
  total_dissenting?: number;
  agents?: DissentAgent[];
  // delivery_estimate fields
  deliveryEstimate?: DeliveryEstimate;
}

export interface PendingEndorsement {
  requirement:          string;
  verdict:              string;
  confidenceLevel:      string;
  humanJudgementPoints: string[];
  scribeNotes:          string;
  mustFixIssues:        string[];
}

export interface AppliedCtx {
  clouds: string[];
  compliance: string[];
  integrations: string[];
}

export interface EstimatePanelProps {
  agentCount: number;
  totalTokens: number;
  minTokens: number;
  maxTokens: number;
  cost: number;
  minCost: number;
  maxCost: number;
  modelLabel: string;
}

export type ModelId = "claude-haiku-4-5-20251001" | "claude-sonnet-4-6" | "claude-opus-4-8";
export type ChipStatus = "idle" | "active" | "done" | "warn" | "skipped" | "error";
export type RoiComplexity = "low" | "medium" | "high";
