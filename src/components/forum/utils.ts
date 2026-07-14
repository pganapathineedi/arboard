import type { ModelId, ChipStatus, AgentOutput, RoiComplexity } from "./types";
import { MODEL_CONFIG, CLOSING_AGENT_IDS } from "./constants";

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1_048_576).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatAge(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

export function formatCost(usd: number): string {
  if (usd < 0.001) return `<$0.001`;
  if (usd < 0.01)  return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function estimateSession(inputText: string, agentCount: number, modelId: ModelId, imageCount = 0) {
  const reqTokens      = Math.ceil(inputText.length / 4 * 0.73);
  const sysTokens      = 450 + 400;
  const outputPerAgent = 800;
  const baseInput      = reqTokens + sysTokens;
  const imageTokens    = imageCount * 1600 * Math.min(2, agentCount);

  const totalInput  = agentCount * baseInput + outputPerAgent * (agentCount * (agentCount - 1) / 2) + imageTokens;
  const totalOutput = outputPerAgent * agentCount;
  const totalTokens = totalInput + totalOutput;
  const cfg  = MODEL_CONFIG[modelId];
  const cost = totalInput / 1000 * cfg.inputPer1K + totalOutput / 1000 * cfg.outputPer1K;
  return {
    agentCount, totalInput, totalOutput, totalTokens, cost,
    minTokens: Math.floor(totalTokens * 0.8),
    maxTokens: Math.floor(totalTokens * 1.2),
    minCost:   cost * 0.8,
    maxCost:   cost * 1.2,
  };
}

export function parseConfidence(content: string): number | null {
  const m = content.match(/CONFIDENCE:\s*(\d+)\/100/i);
  return m ? Math.min(100, Math.max(0, parseInt(m[1]))) : null;
}

export function parseVerdict(content: string): "approved" | "conditional" | "not_approved" | "revision" | null {
  const u = content.toUpperCase();
  if (u.includes("APPROVED WITH CONDITIONS") || u.includes("APPROVE WITH CONDITIONS") || u.includes("CONDITIONALLY APPROVED")) return "conditional";
  if (u.includes("REVISION REQUIRED") || u.includes("REQUIRES REVISION"))            return "revision";
  if (u.includes("NOT APPROVED"))                                                      return "not_approved";
  if (u.includes("APPROVED"))                                                          return "approved";
  return null;
}

export function parseMustFix(content: string): string[] {
  const block = content.match(
    /(?:MUST FIX[:\s]*|##\s+(?:Critical Issues|MUST FIX)[^\n]*\nMUST FIX[:\s]*)([\s\S]+?)(?=\n##|\n[A-Z]{3,}[\s:]|\n\n\n|$)/i
  ) ?? content.match(/MUST FIX[:\s]*\n([\s\S]+?)(?=\n##|\n[A-Z]{3,}[\s:]|\n\n\n|$)/i);
  if (!block) return [];
  return block[1]
    .split("\n")
    .filter(l => /^\d+\./.test(l.trim()))
    .map(l => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

export function parseJudgeConfidenceLevel(content: string): "High" | "Medium" | "Needs human review" | null {
  const sectionMatch = content.match(/##\s+Confidence Level\s*\n\*\*(High|Medium|Needs human review)\*\*/i);
  if (sectionMatch) {
    const v = sectionMatch[1].toLowerCase();
    if (v.includes("needs")) return "Needs human review";
    if (v === "medium") return "Medium";
    if (v === "high") return "High";
  }
  const inlineMatch = content.match(/confidence level[:\s*]+([^\n*\r]+)/i);
  if (inlineMatch) {
    const v = inlineMatch[1].trim().replace(/\*+/g, "").toLowerCase();
    if (v.includes("needs") || v.includes("human")) return "Needs human review";
    if (v.includes("medium")) return "Medium";
    if (v.includes("high")) return "High";
  }
  return null;
}

export function parseHumanJudgementPoints(content: string): string[] {
  const block = content.match(/##\s+Points Requiring Human Judgement\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (!block) return [];
  return block[1]
    .split("\n")
    .filter(l => /^[-•*]/.test(l.trim()))
    .map(l => l.replace(/^[-•*]+\s*/, "").trim())
    .filter(l => Boolean(l) && !l.toLowerCase().includes("none identified"))
    .slice(0, 10);
}

export function stripJsonBlock(content: string): string {
  const match = content.match(/^([\s\S]*)\n---\n[\s\S]*```json[\s\S]*```\s*$/);
  return match ? match[1].trim() : content;
}

export function getAgentStatus(
  agentId: string,
  agents: AgentOutput[],
  activeAgentIds: Set<string>,
  analysisComplete: boolean,
): ChipStatus {
  const a = agents.find(x => x.agentId === agentId);
  if (a) {
    if (a.error)    return "error";
    if (a.skipped)  return "skipped";
    if (!a.complete) return "active";
    const conf = parseConfidence(a.content);
    return conf !== null && conf < 50 ? "warn" : "done";
  }
  if (analysisComplete && activeAgentIds.size > 0 && !activeAgentIds.has(agentId)) return "skipped";
  return "idle";
}

export function computeRoi(rate: number, architects: number, complexity: RoiComplexity, arbCost: number) {
  const mult    = complexity === "high" ? 2 : complexity === "medium" ? 1.5 : 1;
  const rework  = complexity === "high" ? 20000 : complexity === "medium" ? 10000 : 5000;
  const prep    = architects * 3 * rate * mult;
  const meeting = architects * 2 * rate * mult;
  const total   = prep + meeting + rework;
  const saving  = total - arbCost;
  const savingPct     = Math.round((saving / total) * 100);
  const hoursReturned = architects * 3;
  return { prep, meeting, rework, total, saving, savingPct, hoursReturned };
}

export const fmtSavingPct = (pct: number) => pct >= 100 ? ">99%" : `${pct}%`;

export function getSectionLabel(agent: AgentOutput, idx: number, agents: AgentOutput[]): string | undefined {
  if (agent.agentId === "sf-designer") return "SOLUTION DESIGN";
  if (agent.agentId === "sf-judge")   return "JUDGE RULING";
  if (agent.agentId === "sf-scribe")  return "SCRIBE & LEARNING";
  const isSpecialist = !CLOSING_AGENT_IDS.has(agent.agentId) && agent.agentId !== "sf-designer";
  const prevIsDesigner = idx > 0 && agents[idx - 1].agentId === "sf-designer";
  if (isSpecialist && prevIsDesigner) return "SPECIALIST REVIEWS";
  return undefined;
}
