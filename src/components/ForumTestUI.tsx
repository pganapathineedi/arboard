"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { ImpactAnalysis, UploadResult } from "@/lib/types";
import type { OrgContext } from "@/lib/types/salesforce";
import { SalesforceOrgBanner } from "@/components/SalesforceOrgBanner";
import { OrgHealthPanel } from "@/components/OrgHealthPanel";
import { ConnectedAppSetupModal } from "@/components/ConnectedAppSetupModal";
import { ClientContextBanner } from "@/components/ClientContextBanner";
import { EndorsementPanel } from "@/components/EndorsementPanel";

// ── Local Types ───────────────────────────────────────────────────────────────

interface AgentOutput {
  agentId: string;
  agentName: string;
  role: string;
  content: string;
  complete: boolean;
  error?: string;
  startTime: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface SSEEvent {
  type: string;
  sessionId?: string;
  agentId?: string;
  agentName?: string;
  role?: string;
  token?: string;
  error?: string;
  analysis?: ImpactAnalysis;
  agentCount?: number;
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
}

interface PendingEndorsement {
  requirement:          string;
  verdict:              string;
  confidenceLevel:      string;
  humanJudgementPoints: string[];
  scribeNotes:          string;
  mustFixIssues:        string[];
}

interface AppliedCtx {
  clouds: string[];
  compliance: string[];
  integrations: string[];
}

type ModelId = "claude-haiku-4-5-20251001" | "claude-sonnet-4-6" | "claude-opus-4-8";
type ChipStatus = "idle" | "active" | "done" | "warn" | "skipped" | "error";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_CONFIG: Record<ModelId, {
  label: string; icon: string;
  inputPer1K: number; outputPer1K: number; cacheReadPer1K: number; description: string;
}> = {
  "claude-haiku-4-5-20251001": {
    label: "claude-haiku-4-5", icon: "⚡",
    inputPer1K: 0.0008, outputPer1K: 0.004, cacheReadPer1K: 0.00008,
    description: "Fast · Cost-efficient · Good for most reviews",
  },
  "claude-sonnet-4-6": {
    label: "claude-sonnet-4-6", icon: "🧠",
    inputPer1K: 0.003, outputPer1K: 0.015, cacheReadPer1K: 0.0003,
    description: "Balanced · Recommended for complex projects",
  },
  "claude-opus-4-8": {
    label: "claude-opus-4-8", icon: "🚀",
    inputPer1K: 0.015, outputPer1K: 0.075, cacheReadPer1K: 0.0015,
    description: "Maximum depth · Best for high-stakes reviews",
  },
};

const ALL_AGENT_IDS = [
  "sf-designer", "sf-lwc", "sf-omniStudio", "sf-flow",
  "sf-apex", "sf-patterns", "sf-integration", "sf-judge", "sf-scribe", "sf-learner",
];

const AGENT_META: Record<string, {
  icon: string; color: string; badge: string; estSeconds: number; shortName: string;
}> = {
  "sf-designer":   { icon: "🎨", color: "#00c8f0", badge: "SOLUTION ARCH",  estSeconds: 45, shortName: "Designer"   },
  "sf-lwc":        { icon: "⚡", color: "#00c8f0", badge: "UI SPECIALIST",   estSeconds: 28, shortName: "LWC"        },
  "sf-omniStudio": { icon: "🔮", color: "#9f70f5", badge: "OMNI EXPERT",     estSeconds: 32, shortName: "OmniStudio" },
  "sf-flow":       { icon: "🔄", color: "#f0a020", badge: "FLOW BUILDER",    estSeconds: 35, shortName: "Flow"       },
  "sf-apex":       { icon: "⚙️",  color: "#e84040", badge: "APEX EXPERT",    estSeconds: 40, shortName: "Apex"       },
  "sf-patterns":    { icon: "📐", color: "#0fba7a", badge: "PATTERNS",        estSeconds: 35, shortName: "Patterns"    },
  "sf-integration": { icon: "🔗", color: "#00c8f0", badge: "INTEGRATION",     estSeconds: 40, shortName: "Integration" },
  "sf-judge":       { icon: "⚖️",  color: "#f0a020", badge: "JUDGE",          estSeconds: 45, shortName: "Judge"       },
  "sf-scribe":     { icon: "📝", color: "#7B8DB0", badge: "SCRIBE",          estSeconds: 20, shortName: "Scribe"     },
  "sf-learner":    { icon: "🎓", color: "#9f70f5", badge: "LEARNER",         estSeconds: 18, shortName: "Learner"    },
};

const RISK_SEVERITY_COLOR: Record<string, string> = {
  critical: "#e84040", high: "#e84040", medium: "#f0a020", low: "#0fba7a",
};

const PRIORITY_STYLE: Record<string, { bg: string; text: string }> = {
  required:    { bg: "rgba(232,64,64,0.12)",   text: "#e84040" },
  recommended: { bg: "rgba(240,160,32,0.12)",  text: "#f0a020" },
  optional:    { bg: "rgba(90,106,138,0.12)",  text: "#7B8DB0" },
};

const FORMAT_LABELS: Record<string, string> = {
  pdf: "PDF", docx: "DOCX", txt: "TXT", md: "MD", html: "HTML",
};

const DEFAULT_INPUT =
  "Build a Customer 360 self-service portal on Experience Cloud for B2C customers to view real-time SAP order status, submit service cases, and receive Einstein Bot-assisted case deflection. The portal integrates with SAP S/4HANA via MuleSoft Anypoint Platform. Order data (current and 24-month history) must be scoped to the authenticated customer's account only. Einstein Bots should handle initial case triage and deflect common queries before routing to human agents. The solution must support 50,000 active portal users and up to 10 million order records within 24 months of launch.";

const ACCEPTED = ".pdf,.doc,.docx";

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1_048_576).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatAge(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function formatCost(usd: number): string {
  if (usd < 0.001) return `<$0.001`;
  if (usd < 0.01)  return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function estimateSession(inputText: string, agentCount: number, modelId: ModelId) {
  const reqTokens   = Math.ceil(inputText.length / 4);
  const sysTokens   = 450 + 400; // 450 base system prompt + ~400 Well-Architected principles injection per agent
  const inputPerAgent  = reqTokens + sysTokens;
  const outputPerAgent = 600;
  const totalInput  = inputPerAgent * agentCount;
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

function parseConfidence(content: string): number | null {
  const m = content.match(/CONFIDENCE[:\s]+(\d+)\s*\/\s*10/i);
  return m ? Math.min(10, Math.max(1, parseInt(m[1]))) : null;
}

function parseVerdict(content: string): "approved" | "conditional" | "revision" | null {
  const u = content.toUpperCase();
  if (u.includes("APPROVED WITH CONDITIONS") || u.includes("APPROVE WITH CONDITIONS") || u.includes("CONDITIONALLY APPROVED")) return "conditional";
  if (u.includes("REVISION REQUIRED") || u.includes("REQUIRES REVISION"))            return "revision";
  if (u.includes("APPROVED"))                                                          return "approved";
  return null;
}

function parseMustFix(content: string): string[] {
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

function parseJudgeConfidenceLevel(content: string): "High" | "Medium" | "Needs human review" | null {
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

function parseHumanJudgementPoints(content: string): string[] {
  const block = content.match(/##\s+Points Requiring Human Judgement\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (!block) return [];
  return block[1]
    .split("\n")
    .filter(l => /^[-•*]/.test(l.trim()))
    .map(l => l.replace(/^[-•*]+\s*/, "").trim())
    .filter(l => Boolean(l) && !l.toLowerCase().includes("none identified"))
    .slice(0, 10);
}

function getAgentStatus(
  agentId: string,
  agents: AgentOutput[],
  activeAgentIds: Set<string>,
  analysisComplete: boolean,
): ChipStatus {
  const a = agents.find(x => x.agentId === agentId);
  if (a) {
    if (a.error)    return "error";
    if (!a.complete) return "active";
    const conf = parseConfidence(a.content);
    return conf !== null && conf < 5 ? "warn" : "done";
  }
  if (analysisComplete && activeAgentIds.size > 0 && !activeAgentIds.has(agentId)) return "skipped";
  return "idle";
}

// ── Shared style helpers ──────────────────────────────────────────────────────

const S = {
  card: {
    background: "#0f1420",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10,
  } as React.CSSProperties,
  panel: {
    background: "#161d2e",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10,
  } as React.CSSProperties,
  label: {
    fontFamily: "monospace",
    fontSize: 10,
    letterSpacing: 1.2,
    color: "#7B8DB0",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  mono: {
    fontFamily: "monospace",
  } as React.CSSProperties,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Chip({ label, color = "#7B8DB0" }: { label: string; color?: string }) {
  return (
    <span style={{
      fontFamily: "monospace", fontSize: 11,
      padding: "2px 8px", borderRadius: 4,
      border: `1px solid ${color}44`,
      background: `${color}18`,
      color,
    }}>
      {label}
    </span>
  );
}

function ConfidenceBar({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const color = value >= 8 ? "#0fba7a" : value >= 5 ? "#f0a020" : "#e84040";
  const h = size === "sm" ? 3 : 4;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: h, background: "rgba(255,255,255,0.06)", borderRadius: h }}>
        <div style={{
          height: "100%", width: `${value * 10}%`,
          background: color, borderRadius: h,
          transition: "width 0.6s ease",
        }} />
      </div>
      <span style={{ fontFamily: "monospace", fontSize: 10, color, minWidth: 28 }}>
        {value}/10
      </span>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px" }}>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
      <span style={{ ...S.label, fontSize: 11, color: "#7B8DB0" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

// ── EstimatePanel ─────────────────────────────────────────────────────────────

interface EstimatePanelProps {
  agentCount: number;
  totalTokens: number;
  minTokens: number;
  maxTokens: number;
  cost: number;
  minCost: number;
  maxCost: number;
  modelLabel: string;
}

function EstimatePanel(p: EstimatePanelProps) {
  const budgetPct = Math.min(100, (p.cost / 0.5) * 100);
  return (
    <div style={{ ...S.card, padding: "14px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <span style={S.label}>Pre-Session Estimate</span>
        <Chip label={`Model: ${p.modelLabel}`} color="#00c8f0" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 12 }}>
        <div>
          <div style={{ ...S.label, marginBottom: 4 }}>Active Agents</div>
          <div style={{ fontFamily: "monospace", fontSize: 20, color: "#F0F4FF", fontWeight: 700 }}>{p.agentCount}</div>
        </div>
        <div>
          <div style={{ ...S.label, marginBottom: 4 }}>Est. Tokens</div>
          <div style={{ fontFamily: "monospace", fontSize: 16, color: "#F0F4FF", fontWeight: 700 }}>
            ~{(p.totalTokens / 1000).toFixed(0)}k
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
            {(p.minTokens / 1000).toFixed(0)}k–{(p.maxTokens / 1000).toFixed(0)}k range
          </div>
        </div>
        <div>
          <div style={{ ...S.label, marginBottom: 4 }}>Est. Cost</div>
          <div style={{ fontFamily: "monospace", fontSize: 16, color: "#00c8f0", fontWeight: 700 }}>
            ~{formatCost(p.cost)}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
            {formatCost(p.minCost)}–{formatCost(p.maxCost)}
          </div>
        </div>
      </div>
      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
        <div style={{
          height: "100%", width: `${budgetPct}%`,
          background: budgetPct > 80 ? "#e84040" : budgetPct > 50 ? "#f0a020" : "#00c8f0",
          borderRadius: 3, transition: "width 0.4s ease",
        }} />
      </div>
    </div>
  );
}

// ── ModelDropdown ─────────────────────────────────────────────────────────────

function ModelDropdown({
  model, setModel, disabled, estimate,
}: {
  model: ModelId;
  setModel: (m: ModelId) => void;
  disabled: boolean;
  estimate: ReturnType<typeof estimateSession>;
}) {
  const [open, setOpen] = useState(false);
  const cfg = MODEL_CONFIG[model];

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "#161d2e", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6, padding: "5px 10px",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span>{cfg.icon}</span>
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#F0F4FF" }}>{cfg.label}</span>
        <span style={{ color: "#7B8DB0", fontSize: 10, marginLeft: 2 }}>▾</span>
      </button>

      {open && !disabled && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 50,
            background: "#161d2e", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, overflow: "hidden", minWidth: 300,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}>
            {(Object.entries(MODEL_CONFIG) as [ModelId, typeof MODEL_CONFIG[ModelId]][]).map(([id, c]) => {
              const est = estimateSession(estimate.totalTokens > 0 ? "" : DEFAULT_INPUT, estimate.agentCount, id);
              const selected = id === model;
              return (
                <button
                  key={id}
                  onClick={() => { setModel(id); setOpen(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "10px 14px",
                    background: selected ? "rgba(0,200,240,0.07)" : "transparent",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    cursor: "pointer", border: "none",
                    borderLeft: selected ? "2px solid #00c8f0" : "2px solid transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span>{c.icon}</span>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#F0F4FF" }}>{c.label}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 11, color: "#00c8f0" }}>
                      ~{formatCost(est.cost)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#7B8DB0", paddingLeft: 22 }}>{c.description}</div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── AgentSelectorPanel ────────────────────────────────────────────────────────

const ALWAYS_ON_IDS = new Set(["sf-judge", "sf-scribe", "sf-learner"]);

function AgentSelectorPanel({
  analysis, model, input, selectedAgentIds, onToggle, onReset, onRun,
  lastSyncTime, orgConnected, onRefreshOrg,
}: {
  analysis: ImpactAnalysis;
  model: ModelId;
  input: string;
  selectedAgentIds: Set<string>;
  onToggle: (id: string) => void;
  onReset: () => void;
  onRun: () => void;
  lastSyncTime: Date | null;
  orgConnected: boolean;
  onRefreshOrg: () => void;
}) {
  const analysisAgentSet = new Set(analysis.activatedAgents.map(a => a.agentId));
  const addableAgents = ALL_AGENT_IDS.filter(id => !analysisAgentSet.has(id));
  const riskColor = RISK_SEVERITY_COLOR[analysis.overallRisk] ?? "#7B8DB0";
  const est = estimateSession(input, Math.max(1, selectedAgentIds.size), model);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Impact summary */}
      <div style={{ ...S.card, borderLeft: `3px solid ${riskColor}`, padding: "14px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={S.label}>Impact Analysis</span>
          <span style={{
            fontFamily: "monospace", fontSize: 10, padding: "2px 8px", borderRadius: 4,
            border: `1px solid ${riskColor}44`, background: `${riskColor}15`, color: riskColor,
          }}>
            {analysis.overallRisk.toUpperCase()} RISK
          </span>
          <span style={{ ...S.label }}>complexity: {analysis.estimatedComplexity}</span>
          <button
            onClick={onReset}
            style={{
              marginLeft: "auto", fontSize: 11, padding: "3px 10px",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5,
              color: "#7B8DB0", background: "transparent", cursor: "pointer",
            }}
          >
            ← Edit Requirements
          </button>
        </div>
        <p style={{ fontSize: 13, color: "#F0F4FF", lineHeight: 1.6, margin: 0 }}>
          {analysis.summary}
        </p>
      </div>

      {/* Section label */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={S.label}>Select Agents for Forum</span>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a" }}>
          — click to toggle · 🔒 always included
        </span>
      </div>

      {/* Activated agent cards with toggles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginBottom: 14 }}>
        {analysis.activatedAgents.map(a => {
          const meta = AGENT_META[a.agentId];
          const isAlwaysOn = ALWAYS_ON_IDS.has(a.agentId);
          const isSelected = selectedAgentIds.has(a.agentId);
          const pStyle = PRIORITY_STYLE[a.priority] ?? PRIORITY_STYLE.optional;
          return (
            <div
              key={a.agentId}
              onClick={() => !isAlwaysOn && onToggle(a.agentId)}
              style={{
                ...S.card,
                border: isSelected ? `1px solid ${meta?.color ?? "#7B8DB0"}55` : "1px solid rgba(255,255,255,0.04)",
                borderTop: isSelected ? `2px solid ${meta?.color ?? "#7B8DB0"}` : "2px solid rgba(255,255,255,0.08)",
                padding: 14,
                opacity: isSelected ? 1 : 0.45,
                cursor: isAlwaysOn ? "default" : "pointer",
                transition: "opacity 0.2s, border-color 0.2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{meta?.icon ?? "🤖"}</span>
                <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: meta?.color ?? "#F0F4FF" }}>
                  {a.agentName}
                </span>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ ...S.label, fontSize: 9, padding: "1px 6px", borderRadius: 3, background: pStyle.bg, color: pStyle.text }}>
                    {a.priority.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 13, color: isAlwaysOn ? "#5a6a8a" : isSelected ? "#0fba7a" : "#5a6a8a" }}>
                    {isAlwaysOn ? "🔒" : isSelected ? "✓" : "○"}
                  </span>
                </div>
              </div>
              <p style={{ fontSize: 11, color: "#8a9ab8", lineHeight: 1.5, margin: "0 0 8px" }}>
                {a.reason}
              </p>
              {a.sfRisks.slice(0, 2).map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 10, color: "#7B8DB0", marginBottom: 3 }}>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", marginTop: 3, flexShrink: 0, background: i === 0 ? "#e84040" : "#f0a020" }} />
                  {r}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Add-on agents (not triggered by impact analysis) */}
      {addableAgents.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...S.label, marginBottom: 8 }}>Add Agents (not triggered by analysis)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {addableAgents.map(id => {
              const meta = AGENT_META[id];
              const isSelected = selectedAgentIds.has(id);
              return (
                <button
                  key={id}
                  onClick={() => onToggle(id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                    border: `1px solid ${isSelected ? meta.color : "rgba(255,255,255,0.08)"}`,
                    borderRadius: 6,
                    background: isSelected ? `${meta.color}15` : "transparent",
                    color: isSelected ? meta.color : "#7B8DB0",
                    cursor: "pointer", fontFamily: "monospace", fontSize: 11,
                    transition: "all 0.2s",
                  }}
                >
                  {meta.icon} {meta.shortName}
                  <span style={{ opacity: 0.7 }}>{isSelected ? " ✓" : " +"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cross-cutting considerations */}
      {analysis.sfConsiderations.length > 0 && (
        <div style={{ ...S.card, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ ...S.label, marginBottom: 6 }}>Cross-Cutting Considerations</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {analysis.sfConsiderations.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, color: "#8a9ab8" }}>
                <span style={{ color: "#00c8f044", flexShrink: 0 }}>›</span>
                {c}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run bar */}
      <div style={{ paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>

        {/* Org snapshot staleness notice */}
        {orgConnected && (() => {
          if (!lastSyncTime) {
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(240,160,32,0.08)", border: "1px solid rgba(240,160,32,0.25)" }}>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#f0a020" }}>⚠ Org metadata not loaded</span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>— agents will run without real org context</span>
                <button onClick={onRefreshOrg} style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 10, padding: "3px 10px", borderRadius: 4, border: "1px solid rgba(240,160,32,0.4)", background: "transparent", color: "#f0a020", cursor: "pointer" }}>
                  Sync Org
                </button>
              </div>
            );
          }
          const ageMs  = Date.now() - lastSyncTime.getTime();
          const ageMins = Math.floor(ageMs / 60000);
          if (ageMins >= 30) {
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(232,64,64,0.06)", border: "1px solid rgba(232,64,64,0.2)" }}>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#e84040" }}>⚠ Org snapshot is {formatAge(lastSyncTime)}</span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>— org data may have changed since last sync</span>
                <button onClick={onRefreshOrg} style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 10, padding: "3px 10px", borderRadius: 4, border: "1px solid rgba(232,64,64,0.4)", background: "transparent", color: "#e84040", cursor: "pointer" }}>
                  Refresh Now
                </button>
              </div>
            );
          }
          if (ageMins >= 5) {
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "6px 12px", borderRadius: 6, background: "rgba(240,160,32,0.05)", border: "1px solid rgba(240,160,32,0.15)" }}>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#f0a020" }}>Org snapshot {formatAge(lastSyncTime)}</span>
                <button onClick={onRefreshOrg} style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(240,160,32,0.3)", background: "transparent", color: "#f0a020", cursor: "pointer" }}>
                  Refresh
                </button>
              </div>
            );
          }
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#0fba7a", display: "inline-block" }} />
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#0fba7a" }}>Org data fresh · synced {formatAge(lastSyncTime)}</span>
            </div>
          );
        })()}

        {/* Main row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: "monospace", fontSize: 13, color: "#F0F4FF", fontWeight: 700 }}>
              {selectedAgentIds.size} agent{selectedAgentIds.size !== 1 ? "s" : ""} selected
            </span>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "#7B8DB0", marginLeft: 16 }}>
              Est. ~{formatCost(est.cost)} · ~{(est.totalTokens / 1000).toFixed(0)}k tokens
            </span>
          </div>
          <button
            onClick={() => onRun()}
            disabled={selectedAgentIds.size === 0}
            style={{
              padding: "10px 28px", background: "#00c8f0", color: "#07090f",
              fontWeight: 700, fontSize: 14, borderRadius: 8, border: "none",
              cursor: selectedAgentIds.size === 0 ? "not-allowed" : "pointer",
              opacity: selectedAgentIds.size === 0 ? 0.4 : 1,
              transition: "opacity 0.2s",
            }}
          >
            Run Forum → ({selectedAgentIds.size})
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ImpactPanel ───────────────────────────────────────────────────────────────

function ImpactPanel({ analysis, model, input }: {
  analysis: ImpactAnalysis;
  model: ModelId;
  input: string;
}) {
  const riskColor = RISK_SEVERITY_COLOR[analysis.overallRisk] ?? "#7B8DB0";
  return (
    <div style={{ marginBottom: 24 }}>
      {/* Summary header */}
      <div style={{
        ...S.card, padding: "14px 18px", marginBottom: 12,
        borderLeft: `3px solid ${riskColor}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ ...S.label }}>Impact Analysis</span>
          <span style={{
            fontFamily: "monospace", fontSize: 10, padding: "2px 8px", borderRadius: 4,
            border: `1px solid ${riskColor}44`, background: `${riskColor}15`, color: riskColor,
          }}>
            {analysis.overallRisk.toUpperCase()} RISK
          </span>
          <span style={{ ...S.label, marginLeft: "auto" }}>
            complexity: {analysis.estimatedComplexity}
          </span>
        </div>
        <p style={{ fontSize: 13, color: "#F0F4FF", lineHeight: 1.6, margin: 0 }}>
          {analysis.summary}
        </p>
      </div>

      {/* Agent cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
        {analysis.activatedAgents.map(a => {
          const meta = AGENT_META[a.agentId];
          const est = estimateSession(input, 1, model);
          const pStyle = PRIORITY_STYLE[a.priority] ?? PRIORITY_STYLE.optional;
          return (
            <div key={a.agentId} style={{
              ...S.card,
              border: `1px solid ${meta?.color ?? "#7B8DB0"}33`,
              padding: 14,
              borderTop: `2px solid ${meta?.color ?? "#7B8DB0"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{meta?.icon ?? "🤖"}</span>
                <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: meta?.color ?? "#F0F4FF" }}>
                  {a.agentName}
                </span>
                <span style={{ marginLeft: "auto", ...S.label, fontSize: 9, padding: "1px 6px", borderRadius: 3, background: pStyle.bg, color: pStyle.text }}>
                  {a.priority.toUpperCase()}
                </span>
              </div>
              <div style={{ ...S.label, marginBottom: 4 }}>Why Triggered</div>
              <p style={{ fontSize: 12, color: "#8a9ab8", lineHeight: 1.5, margin: "0 0 10px" }}>
                {a.reason}
              </p>
              {a.sfRisks.length > 0 && (
                <>
                  <div style={{ ...S.label, marginBottom: 6 }}>Will Check</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {a.sfRisks.slice(0, 3).map((r, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: "#8a9ab8" }}>
                        <span style={{
                          width: 5, height: 5, borderRadius: "50%", marginTop: 3, flexShrink: 0,
                          background: i === 0 ? "#e84040" : i === 1 ? "#f0a020" : "#0fba7a",
                        }} />
                        {r}
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
                  Est. ~{meta?.estSeconds ?? 30}s
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
                  ~{formatCost(est.cost)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {analysis.sfConsiderations.length > 0 && (
        <div style={{ ...S.card, padding: "12px 16px", marginTop: 10 }}>
          <div style={{ ...S.label, marginBottom: 8 }}>Cross-Cutting Considerations</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {analysis.sfConsiderations.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: "#8a9ab8" }}>
                <span style={{ color: "#00c8f044", flexShrink: 0 }}>›</span>
                {c}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AgentRoster ───────────────────────────────────────────────────────────────

function AgentRoster({ agents, activeAgentIds, analysisComplete }: {
  agents: AgentOutput[];
  activeAgentIds: Set<string>;
  analysisComplete: boolean;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ ...S.label, marginBottom: 8 }}>Agent Roster</div>
      <div className="agent-roster">
        {ALL_AGENT_IDS.map(id => {
          const meta = AGENT_META[id];
          const status = getAgentStatus(id, agents, activeAgentIds, analysisComplete);
          const agent = agents.find(a => a.agentId === id);

          const borderColor =
            status === "active"  ? "#00c8f0" :
            status === "done"    ? "#0fba7a" :
            status === "warn"    ? "#f0a020" :
            status === "error"   ? "#e84040" :
            status === "skipped" ? "transparent" :
            "rgba(255,255,255,0.07)";

          const bgColor =
            status === "active"  ? "rgba(0,200,240,0.05)" :
            status === "done"    ? "rgba(15,186,122,0.05)" :
            status === "warn"    ? "rgba(240,160,32,0.05)" :
            status === "error"   ? "rgba(232,64,64,0.05)" :
            "#0f1420";

          const conf = agent ? parseConfidence(agent.content) : null;

          return (
            <div
              key={id}
              className={status === "active" ? "arboard-glow-pulse" : ""}
              style={{
                background: bgColor,
                border: `1px solid ${borderColor}`,
                borderRadius: 8, padding: "10px 8px",
                textAlign: "center",
                opacity: status === "skipped" ? 0.3 : 1,
                transition: "opacity 0.3s, border-color 0.3s, background 0.3s",
              }}
            >
              <div style={{ fontSize: 18, marginBottom: 4 }}>{meta.icon}</div>
              <div style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#F0F4FF", marginBottom: 2 }}>
                {meta.shortName}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 9, color: "#7B8DB0", marginBottom: 6 }}>
                {meta.badge}
              </div>

              {/* Status */}
              <div style={{ fontFamily: "monospace", fontSize: 9, color:
                status === "active"  ? "#00c8f0" :
                status === "done"    ? "#0fba7a" :
                status === "warn"    ? "#f0a020" :
                status === "error"   ? "#e84040" :
                status === "skipped" ? "#7B8DB0" : "#7B8DB0",
              }}>
                {status === "active"  ? "Speaking…" :
                 status === "done"    ? `✓ ${agent?.durationMs ? formatDuration(agent.durationMs) : "done"}` :
                 status === "warn"    ? `⚠ low conf` :
                 status === "error"   ? "error" :
                 status === "skipped" ? "skipped" :
                 `~${meta.estSeconds}s`}
              </div>

              {/* Confidence bar if done */}
              {conf !== null && (status === "done" || status === "warn") && (
                <div style={{ marginTop: 5 }}>
                  <ConfidenceBar value={conf} size="sm" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── SessionTimeline ───────────────────────────────────────────────────────────

function SessionTimeline({ agents, activeAgentIds, analysisComplete }: {
  agents: AgentOutput[];
  activeAgentIds: Set<string>;
  analysisComplete: boolean;
}) {
  const started = new Set(agents.map(a => a.agentId));
  const pending = ALL_AGENT_IDS.filter(id =>
    (activeAgentIds.has(id) || !analysisComplete) && !started.has(id)
  );

  const items: Array<{ agentId: string; status: ChipStatus; durationMs?: number }> = [
    ...agents.map(a => ({
      agentId: a.agentId,
      status: getAgentStatus(a.agentId, agents, activeAgentIds, analysisComplete),
      durationMs: a.durationMs,
    })),
    ...pending.map(id => ({ agentId: id, status: "idle" as ChipStatus })),
  ];

  return (
    <div className="session-timeline-col" style={{ paddingTop: 4 }}>
      <div style={{ ...S.label, marginBottom: 12 }}>Session Timeline</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {items.map((item, idx) => {
          const meta = AGENT_META[item.agentId];
          const isLast = idx === items.length - 1;
          const dotColor =
            item.status === "done"    ? "#0fba7a" :
            item.status === "active"  ? "#00c8f0" :
            item.status === "warn"    ? "#f0a020" :
            item.status === "error"   ? "#e84040" :
            "#2a3550";

          return (
            <div key={item.agentId} style={{ display: "flex", gap: 10 }}>
              {/* Dot + line column */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 16, flexShrink: 0 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: item.status === "idle" ? "transparent" : dotColor,
                  border: `2px solid ${dotColor}`,
                  flexShrink: 0,
                  boxShadow: item.status === "active" ? `0 0 8px ${dotColor}` : "none",
                  transition: "background 0.3s, border-color 0.3s",
                }} />
                {!isLast && (
                  <div style={{
                    width: 1, flex: 1, minHeight: 20,
                    background: item.status === "done" ? "#0fba7a44" : "rgba(255,255,255,0.08)",
                    margin: "2px 0",
                  }} />
                )}
              </div>

              {/* Label */}
              <div style={{ paddingBottom: isLast ? 0 : 12 }}>
                <div style={{
                  fontFamily: "monospace", fontSize: 11,
                  color: item.status === "idle" ? "#7B8DB0" : "#F0F4FF",
                  fontWeight: item.status === "active" ? 700 : 400,
                }}>
                  {meta?.shortName ?? item.agentId}
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 9, color:
                  item.status === "active" ? "#00c8f0" :
                  item.status === "done"   ? "#0fba7a" :
                  "#7B8DB0",
                }}>
                  {item.status === "done"   && item.durationMs ? `✓ ${formatDuration(item.durationMs)}` :
                   item.status === "active" ? "running..." :
                   item.status === "idle"   ? `~${meta?.estSeconds ?? 30}s est.` :
                   item.status === "warn"   && item.durationMs ? `⚠ ${formatDuration(item.durationMs)}` :
                   ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── DesignerOutput ────────────────────────────────────────────────────────────

function DesignerOutput({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div style={{ fontSize: 13, color: "#F0F4FF", lineHeight: 1.7 }}>
      {lines.map((line, i) => {
        if (line.startsWith("## ")) {
          return (
            <div key={i} style={{
              fontFamily: "monospace", fontSize: 11, fontWeight: 700,
              color: "#00c8f0", letterSpacing: 1, marginTop: 16, marginBottom: 6,
              borderBottom: "1px solid rgba(0,200,240,0.2)", paddingBottom: 4,
            }}>
              {line.replace("## ", "").toUpperCase()}
            </div>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <div key={i} style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#00c8f0", marginBottom: 8 }}>
              {line.replace("# ", "")}
            </div>
          );
        }
        if (line.startsWith("| ")) {
          return (
            <div key={i} style={{
              fontFamily: "monospace", fontSize: 11, color: "#8a9ab8",
              padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}>
              {line}
            </div>
          );
        }
        if (/^\d+\./.test(line.trim())) {
          return (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <span style={{ color: "#00c8f0", fontFamily: "monospace", fontSize: 12, flexShrink: 0 }}>
                {line.match(/^(\d+\.)/)?.[1]}
              </span>
              <span style={{ fontSize: 13, color: "#F0F4FF" }}>
                {line.replace(/^\d+\.\s*/, "")}
              </span>
            </div>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
              <span style={{ color: "#00c8f044" }}>›</span>
              <span style={{ fontSize: 13, color: "#F0F4FF" }}>{line.slice(2)}</span>
            </div>
          );
        }
        return line.trim() ? (
          <p key={i} style={{ margin: "0 0 4px", fontSize: 13, color: "#F0F4FF" }}>{line}</p>
        ) : <div key={i} style={{ height: 6 }} />;
      })}
    </div>
  );
}

// ── AgentCard ─────────────────────────────────────────────────────────────────

function AgentCard({ agent, sectionLabel }: { agent: AgentOutput; sectionLabel?: string }) {
  const meta = AGENT_META[agent.agentId];
  const conf = agent.complete ? parseConfidence(agent.content) : null;
  const isStreaming = !agent.complete && !agent.error;
  const isDesigner = agent.agentId === "sf-designer";

  const borderColor = agent.error
    ? "#e84040"
    : agent.complete
      ? conf !== null && conf < 5 ? "#f0a020" : "#0fba7a"
      : "#00c8f0";

  return (
    <div className="arboard-slide-up" style={{
      ...S.card,
      border: `1px solid ${borderColor}33`,
      borderTop: `2px solid ${borderColor}`,
      overflow: "hidden",
    }}>
      {sectionLabel && <SectionDivider label={sectionLabel} />}

      {/* Card header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "#161d2e",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>{meta?.icon ?? "🤖"}</span>
          <div>
            <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: meta?.color ?? "#F0F4FF" }}>
              {agent.agentName}
            </span>
          </div>
          {meta && (
            <span style={{
              fontFamily: "monospace", fontSize: 9, padding: "2px 7px", borderRadius: 4,
              background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}33`,
            }}>
              {meta.badge}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isStreaming && (
            <span style={{ fontFamily: "monospace", fontSize: 10, color: "#00c8f0" }}
              className="animate-pulse">
              Speaking…
            </span>
          )}
          {agent.durationMs && (
            <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
              {formatDuration(agent.durationMs)}
            </span>
          )}
          {agent.error && <span style={{ fontFamily: "monospace", fontSize: 10, color: "#e84040" }}>Error</span>}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: 16 }}>
        {agent.error ? (
          <span style={{ fontSize: 13, color: "#e84040" }}>{agent.error}</span>
        ) : isDesigner && agent.content ? (
          <DesignerOutput content={agent.content} />
        ) : (
          <div style={{ fontSize: 13, color: "#F0F4FF", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
            {agent.content || <span style={{ color: "#7B8DB0" }}>Waiting…</span>}
            {isStreaming && <span className="arboard-blink" />}
          </div>
        )}

        {/* Confidence + time footer */}
        {agent.complete && !agent.error && (
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            {conf !== null && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ ...S.label, marginBottom: 4 }}>Confidence</div>
                <ConfidenceBar value={conf} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── VerdictBox ────────────────────────────────────────────────────────────────

const ARCHITECT_ROLES = [
  "Lead Architect",
  "Solution Architect",
  "Technical Lead",
  "Client Architecture Lead",
] as const;

function VerdictBox({
  verdict, judgeContent, agents, sessionStartTime,
  sessionId, jiraIssueKey, signOff, onCountersign, matchedPatterns,
  revisionRound, onRevisionRound, hideSignOff, onDownload,
}: {
  verdict: "approved" | "conditional" | "revision";
  judgeContent: string;
  agents: AgentOutput[];
  sessionStartTime: number | null;
  sessionId: string | null;
  jiraIssueKey: string | null;
  signOff: { name: string; role: string; timestamp: string } | null;
  onCountersign: (name: string, role: string) => Promise<void>;
  matchedPatterns: { id: string; title: string; severity: string }[];
  revisionRound: number;
  onRevisionRound: () => void;
  hideSignOff?: boolean;
  onDownload: () => void;
}) {
  const [signerName, setSignerName] = useState("");
  const [showPatterns, setShowPatterns] = useState(false);
  const [signerRole, setSignerRole] = useState<string>(ARCHITECT_ROLES[0]);
  const [submitting, setSubmitting] = useState(false);

  const totalMs = sessionStartTime ? Date.now() - sessionStartTime : null;
  const mustFix = parseMustFix(judgeContent);
  const confidenceLevel = parseJudgeConfidenceLevel(judgeContent);
  const judgementPoints = parseHumanJudgementPoints(judgeContent);

  console.log("[VerdictBox] raw judge output:", judgeContent.slice(0, 500));
  console.log("[VerdictBox] parsed confidenceLevel:", confidenceLevel, "| judgementPoints:", judgementPoints.length, judgementPoints);

  const colors = {
    approved:    { border: "#0fba7a", bg: "rgba(15,186,122,0.06)", icon: "✓", label: "APPROVED",                text: "#0fba7a" },
    conditional: { border: "#f0a020", bg: "rgba(240,160,32,0.06)", icon: "✓", label: "APPROVED WITH CONDITIONS", text: "#f0a020" },
    revision:    { border: "#e84040", bg: "rgba(232,64,64,0.06)",  icon: "↻", label: "REVISION REQUIRED",       text: "#e84040" },
  }[verdict];

  const confidenceConfig = confidenceLevel ? {
    "High":               { bg: "rgba(15,186,122,0.12)",  color: "#0fba7a", border: "rgba(15,186,122,0.3)"  },
    "Medium":             { bg: "rgba(240,160,32,0.12)",  color: "#f0a020", border: "rgba(240,160,32,0.3)"  },
    "Needs human review": { bg: "rgba(232,64,64,0.12)",   color: "#e84040", border: "rgba(232,64,64,0.3)"   },
  }[confidenceLevel] : null;

  const completedAgents = agents.filter(a => a.complete && !a.error);

  const handleSubmit = async () => {
    if (!signerName.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCountersign(signerName.trim(), signerRole);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="arboard-verdict" style={{
      ...S.card,
      border: `2px solid ${colors.border}`,
      background: colors.bg,
      marginTop: 24,
      padding: "20px 24px",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 22, color: colors.text }}>{colors.icon}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0", letterSpacing: 1, textTransform: "uppercase" }}>
            Draft Recommendation
          </span>
          <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: colors.text, letterSpacing: 0.5 }}>
            {colors.label}
          </span>
        </div>
        {confidenceLevel && confidenceConfig && (
          <span style={{
            fontFamily: "monospace", fontSize: 11, padding: "3px 10px", borderRadius: 20,
            background: confidenceConfig.bg, color: confidenceConfig.color,
            border: `1px solid ${confidenceConfig.border}`,
            fontWeight: 600,
          }}>
            {confidenceLevel === "Needs human review" ? "⚠ Needs human review" : `✓ Confidence: ${confidenceLevel}`}
          </span>
        )}
        {matchedPatterns.length > 0 && (
          <button
            onClick={() => setShowPatterns(p => !p)}
            style={{
              fontFamily: "monospace", fontSize: 10, padding: "3px 10px", borderRadius: 20,
              background: "rgba(90,106,138,0.12)", color: "#7B8DB0",
              border: "1px solid rgba(90,106,138,0.3)",
              cursor: "pointer",
            }}
          >
            {matchedPatterns.length} failure pattern{matchedPatterns.length !== 1 ? "s" : ""} matched
          </button>
        )}
        {totalMs && (
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#7B8DB0", marginLeft: "auto" }}>
            Round 1 · {completedAgents.length} agents · {formatDuration(totalMs)} total
          </span>
        )}
      </div>

      {showPatterns && matchedPatterns.length > 0 && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 6, background: "rgba(90,106,138,0.07)", border: "1px solid rgba(90,106,138,0.2)" }}>
          <div style={{ ...S.label, marginBottom: 8, fontSize: 9 }}>Referenced SI Failure Patterns</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {matchedPatterns.map(p => {
              const sevColor = p.severity === "high" ? "#e84040" : p.severity === "medium" ? "#f0a020" : "#0fba7a";
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 10, color: sevColor, flexShrink: 0, minWidth: 52 }}>
                    {p.id}
                  </span>
                  <span style={{ fontSize: 11, color: "#8a9ab8", lineHeight: 1.4 }}>{p.title}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 9, color: sevColor, flexShrink: 0, marginLeft: "auto" }}>
                    {p.severity}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ height: 1, background: `${colors.border}33`, marginBottom: 14 }} />

      {/* Must Fix */}
      {mustFix.length > 0 && (
        <>
          <div style={{ ...S.label, marginBottom: 8 }}>Must Fix</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {mustFix.map((item, i) => (
              <div key={i} style={{
                display: "flex", gap: 10, padding: "8px 12px",
                background: "rgba(232,64,64,0.06)", borderRadius: 6,
                borderLeft: "3px solid #e84040",
              }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#e84040", flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ fontSize: 12, color: "#F0F4FF" }}>{item}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Points requiring human judgement */}
      {judgementPoints.length > 0 && (
        <>
          <div style={{ ...S.label, marginBottom: 8, color: "#f0a020" }}>Points Requiring Human Judgement</div>
          <div style={{
            padding: "12px 14px", borderRadius: 6, marginBottom: 16,
            background: "rgba(240,160,32,0.05)",
            borderLeft: "3px solid #f0a020",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {judgementPoints.map((point, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ color: "#f0a020", flexShrink: 0, marginTop: 1 }}>›</span>
                  <span style={{ fontSize: 12, color: "#F0F4FF", lineHeight: 1.5 }}>{point}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button
          onClick={onDownload}
          style={{
            padding: "8px 18px", background: "#00c8f0", color: "#07090f",
            fontWeight: 700, fontSize: 12, borderRadius: 6, cursor: "pointer", border: "none",
          }}
        >
          ⬇ Download Report
        </button>
        {verdict !== "approved" && (
          <button
            onClick={onRevisionRound}
            disabled={revisionRound >= 3}
            style={{
              padding: "8px 18px", background: "transparent",
              border: `1px solid ${colors.border}66`, color: colors.text,
              fontSize: 12, borderRadius: 6,
              cursor: revisionRound >= 3 ? "not-allowed" : "pointer",
              opacity: revisionRound >= 3 ? 0.4 : 1,
            }}
          >
            ↻ {revisionRound === 0 ? "Revision Round" : `Revision Round ${revisionRound + 1}`}
          </button>
        )}
      </div>

      {/* Human sign-off section — hidden when EndorsementPanel takes over */}
      {!hideSignOff && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ ...S.label, color: "#9f70f5" }}>Human Sign-off</span>
            {!signOff && (
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a" }}>
                — pending countersignature
              </span>
            )}
          </div>

          {signOff ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", borderRadius: 6,
              background: "rgba(15,186,122,0.08)", border: "1px solid rgba(15,186,122,0.3)",
            }}>
              <span style={{ color: "#0fba7a", fontSize: 16 }}>✓</span>
              <div>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "#0fba7a", fontWeight: 700 }}>
                  Countersigned by {signOff.name}, {signOff.role}
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0", marginTop: 2 }}>
                  {new Date(signOff.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ ...S.label, fontSize: 9 }}>Architect Name</span>
                <input
                  type="text"
                  value={signerName}
                  onChange={e => setSignerName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                  style={{
                    background: "#0f1420", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6, padding: "7px 12px", fontSize: 12, color: "#F0F4FF",
                    fontFamily: "system-ui, sans-serif", outline: "none", width: 200,
                  }}
                  onFocus={e => (e.target.style.borderColor = "rgba(159,112,245,0.5)")}
                  onBlur={e  => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ ...S.label, fontSize: 9 }}>Role</span>
                <select
                  value={signerRole}
                  onChange={e => setSignerRole(e.target.value)}
                  style={{
                    background: "#0f1420", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6, padding: "7px 12px", fontSize: 12, color: "#F0F4FF",
                    fontFamily: "system-ui, sans-serif", outline: "none", cursor: "pointer",
                    appearance: "auto",
                  }}
                >
                  {ARCHITECT_ROLES.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleSubmit}
                disabled={!signerName.trim() || submitting}
                style={{
                  padding: "8px 18px",
                  background: signerName.trim() && !submitting ? "#9f70f5" : "rgba(159,112,245,0.3)",
                  color: signerName.trim() && !submitting ? "#fff" : "rgba(255,255,255,0.4)",
                  fontWeight: 700, fontSize: 12, borderRadius: 6, border: "none",
                  cursor: signerName.trim() && !submitting ? "pointer" : "not-allowed",
                  transition: "background 0.2s, color 0.2s",
                }}
              >
                {submitting ? "Signing…" : "Countersign this recommendation"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SessionSummaryDrawer ──────────────────────────────────────────────────────

function SessionSummaryDrawer({
  agents, totalMs, actualTokens, actualCost, estimate, cacheReadTokens, cacheWriteTokens, cacheSavings, onClose,
}: {
  agents: AgentOutput[];
  totalMs: number;
  actualTokens: number;
  actualCost: number;
  estimate: ReturnType<typeof estimateSession>;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheSavings: number;
  onClose: () => void;
}) {
  const tokenDiffPct = Math.round(((actualTokens - estimate.totalTokens) / estimate.totalTokens) * 100);
  const costDiffPct  = Math.round(((actualCost  - estimate.cost)         / estimate.cost)         * 100);
  const accurate = Math.abs(tokenDiffPct) <= 20;

  const useReal = agents.some(a => a.outputTokens !== undefined);
  const maxTokens = Math.max(...agents.map(a =>
    useReal ? (a.outputTokens ?? 0) : Math.ceil(a.content.length / 4)
  ), 1);

  return (
    <div
      className="arboard-drawer"
      style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
        background: "#0f1420", borderTop: "2px solid rgba(0,200,240,0.2)",
        maxHeight: "60vh", overflowY: "auto",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.6)",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#0fba7a" }}>
            ✓ SESSION COMPLETE
          </span>
          <button onClick={onClose} style={{ color: "#7B8DB0", background: "none", border: "none", fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: cacheReadTokens > 0 ? 12 : 20 }}>
          {[
            { label: "Total Time",    value: formatDuration(totalMs),      sub: null,                                        color: "#F0F4FF" },
            { label: "Total Tokens",  value: `${(actualTokens / 1000).toFixed(1)}k`, sub: `est. was ${(estimate.totalTokens / 1000).toFixed(0)}k`, color: "#F0F4FF" },
            { label: "Actual Cost",   value: formatCost(actualCost),       sub: `est. was ${formatCost(estimate.cost)}`,     color: "#00c8f0" },
            { label: "Accuracy",      value: accurate ? "✓ within 20%" : `${tokenDiffPct > 0 ? "+" : ""}${tokenDiffPct}% off`, sub: null,       color: "#F0F4FF" },
          ].map(item => (
            <div key={item.label} style={{ ...S.card, padding: "12px 14px" }}>
              <div style={{ ...S.label, marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}</div>
              {item.sub && <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0", marginTop: 2 }}>{item.sub}</div>}
            </div>
          ))}
        </div>

        {cacheReadTokens > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Cache Reads",  value: `${(cacheReadTokens / 1000).toFixed(1)}k tok`,  sub: "served from cache", color: "#0fba7a" },
              { label: "Cache Writes", value: `${(cacheWriteTokens / 1000).toFixed(1)}k tok`, sub: "written to cache",  color: "#F0F4FF" },
              { label: "Cache Saved",  value: formatCost(cacheSavings),                        sub: "vs full input price", color: "#0fba7a" },
            ].map(item => (
              <div key={item.label} style={{ ...S.card, padding: "12px 14px", borderLeft: "2px solid #0fba7a33" }}>
                <div style={{ ...S.label, marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}</div>
                <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0", marginTop: 2 }}>{item.sub}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ ...S.label, marginBottom: 10 }}>Per-Agent Breakdown</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {agents.filter(a => a.complete && !a.error).map(a => {
            const tokens = useReal
              ? (a.outputTokens ?? Math.ceil(a.content.length / 4))
              : Math.ceil(a.content.length / 4);
            const barPct = Math.round((tokens / maxTokens) * 100);
            const meta = AGENT_META[a.agentId];
            return (
              <div key={a.agentId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#F0F4FF", width: 80, flexShrink: 0 }}>
                  {meta?.shortName ?? a.agentName}
                </span>
                <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                  <div style={{
                    height: "100%", width: `${barPct}%`,
                    background: meta?.color ?? "#00c8f0", borderRadius: 3,
                    transition: "width 0.6s ease",
                  }} />
                </div>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0", width: 70, textAlign: "right", flexShrink: 0 }}>
                  ~{(tokens / 1000).toFixed(1)}k tok
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0", width: 40, textAlign: "right", flexShrink: 0 }}>
                  {a.durationMs ? formatDuration(a.durationMs) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ForumTestUI() {
  const [model, setModel]               = useState<ModelId>("claude-sonnet-4-6");
  const [apiMode, setApiMode]           = useState<"mock" | "real">("mock");
  const [input, setInput]               = useState(DEFAULT_INPUT);
  const [agents, setAgents]             = useState<AgentOutput[]>([]);
  const [running, setRunning]           = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [sessionId, setSessionId]       = useState<string | null>(null);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [sessionEndTime, setSessionEndTime]     = useState<number | null>(null);
  const [analysis, setAnalysis]         = useState<ImpactAnalysis | null>(null);
  const [analysing, setAnalysing]       = useState(false);
  const [activeAgentIds, setActiveAgentIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode]       = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());

  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading]       = useState(false);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const [dragging, setDragging]         = useState(false);
  const [appliedCtx, setAppliedCtx]     = useState<AppliedCtx | null>(null);
  const [ctxApplied, setCtxApplied]     = useState(false);

  const [orgStatus, setOrgStatus]       = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [orgInfo, setOrgInfo]           = useState<{ orgName: string; edition: string; isSandbox: boolean } | null>(null);
  const [orgContext, setOrgContext]      = useState<OrgContext | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [refreshingOrg, setRefreshingOrg] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);

  const [showSummaryDrawer, setShowSummaryDrawer] = useState(false);
  const [jiraIssueKey, setJiraIssueKey] = useState<string | null>(null);
  const [jiraIssueUrl, setJiraIssueUrl] = useState<string | null>(null);
  const [signOff, setSignOff] = useState<{ name: string; role: string; timestamp: string } | null>(null);
  const [patternDetails, setPatternDetails] = useState<{ id: string; title: string; severity: string }[]>([]);

  const [revisionRound, setRevisionRound]             = useState(0);
  const [previousFeedback, setPreviousFeedback]       = useState("");
  const [pendingEndorsement, setPendingEndorsement]   = useState<PendingEndorsement | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const forumRef     = useRef<HTMLDivElement | null>(null);

  // Derived
  const showSessionView = running || agents.length > 0 || sessionComplete;
  const analysisComplete = analysis !== null;
  const judgeAgent = agents.find(a => a.agentId === "sf-judge" && a.complete);
  const verdict    = judgeAgent ? parseVerdict(judgeAgent.content) : null;

  const agentCount = selectionMode && selectedAgentIds.size > 0
    ? selectedAgentIds.size
    : analysis ? analysis.activatedAgents.length : 7;
  const estimate   = useMemo(
    () => estimateSession(input, agentCount, model),
    [input, agentCount, model]
  );

  const totalActualMs = sessionEndTime && sessionStartTime ? sessionEndTime - sessionStartTime : null;
  const completedAgents = agents.filter(a => a.complete && !a.error);

  // Use real API token counts when available; fall back to content-length estimate
  const hasRealTokens = completedAgents.some(a => a.inputTokens !== undefined);
  const totalInputTokens = hasRealTokens
    ? completedAgents.reduce((s, a) => s + (a.inputTokens ?? 0), 0)
    : (Math.ceil(input.length / 4) + 450) * completedAgents.length;
  const totalOutputTokens = hasRealTokens
    ? completedAgents.reduce((s, a) => s + (a.outputTokens ?? 0), 0)
    : agents.reduce((s, a) => s + Math.ceil(a.content.length / 4), 0);

  const actualCost = totalInputTokens / 1000 * MODEL_CONFIG[model].inputPer1K +
                     totalOutputTokens / 1000 * MODEL_CONFIG[model].outputPer1K;

  const totalCacheReadTokens  = completedAgents.reduce((s, a) => s + (a.cacheReadTokens  ?? 0), 0);
  const totalCacheWriteTokens = completedAgents.reduce((s, a) => s + (a.cacheWriteTokens ?? 0), 0);
  const cacheSavings = totalCacheReadTokens / 1000 *
    (MODEL_CONFIG[model].inputPer1K - MODEL_CONFIG[model].cacheReadPer1K);

  const progressPct = agents.length === 0 ? 0
    : (completedAgents.length / Math.max(agents.length, agentCount)) * 100;

  const matchedPatternIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of agents) {
      for (const m of (a.content.match(/FP-\d+/g) ?? [])) ids.add(m);
    }
    return Array.from(ids);
  }, [agents]);

  const matchedPatternIdsRef = useRef<string[]>([]);
  matchedPatternIdsRef.current = matchedPatternIds;

  useEffect(() => {
    if (!sessionComplete) return;
    const ids = matchedPatternIdsRef.current;
    console.log("[patterns] session complete — matched IDs:", ids.length > 0 ? ids : "(none)");
    if (ids.length === 0) return;
    fetch(`/api/patterns?ids=${ids.join(",")}`)
      .then(r => r.json())
      .then((data: { id: string; title: string; severity: string }[]) => {
        console.log("[patterns] resolved details:", data);
        setPatternDetails(data);
      })
      .catch(() => {/* non-fatal */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionComplete]);

  // Capture Judge verdict for revision rounds
  useEffect(() => {
    if (!sessionComplete) return;
    const judge = agents.find(a => a.agentId === "sf-judge" && a.complete);
    if (judge?.content) setPreviousFeedback(judge.content);
  }, [sessionComplete, judgeAgent?.content]);

  // Scroll forum panel to bottom as tokens arrive
  useEffect(() => {
    if (forumRef.current) forumRef.current.scrollTop = forumRef.current.scrollHeight;
  }, [agents]);

  // ── Salesforce Org Connection ───────────────────────────────────────────────

  const checkOrgStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/salesforce/status");
      const data = await res.json() as { connected: boolean; orgName?: string; edition?: string; isSandbox?: boolean };
      if (data.connected) {
        setOrgStatus("connected");
        setOrgInfo({ orgName: data.orgName ?? "Salesforce Org", edition: data.edition ?? "", isSandbox: data.isSandbox ?? false });
      } else {
        setOrgStatus("disconnected");
      }
    } catch {
      setOrgStatus("disconnected");
    }
  }, []);

  const fetchOrgMetadata = useCallback(async () => {
    setRefreshingOrg(true);
    try {
      const res = await fetch("/api/salesforce/metadata");
      if (res.ok) {
        const ctx = await res.json() as OrgContext;
        setOrgContext(ctx);
        setLastSyncTime(new Date());
        if (ctx.orgProfile) {
          setOrgInfo({ orgName: ctx.orgProfile.orgName, edition: ctx.orgProfile.edition, isSandbox: ctx.orgProfile.isSandbox });
        }
      }
    } catch { /* non-fatal */ }
    finally { setRefreshingOrg(false); }
  }, []);

  useEffect(() => {
    checkOrgStatus();
    const handleMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === "sf-connected") {
        setOrgStatus("connected");
        fetchOrgMetadata();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [checkOrgStatus, fetchOrgMetadata]);

  const startConnect = useCallback(() => {
    setOrgStatus("connecting");
    window.open("/api/salesforce/connect", "sf-oauth", "width=620,height=720,left=200,top=100");
    if (typeof window !== "undefined") localStorage.setItem("sf-setup-seen", "1");
  }, []);

  const handleOrgConnect = useCallback(() => {
    const seen = typeof window !== "undefined" && localStorage.getItem("sf-setup-seen");
    if (!seen) { setShowSetupModal(true); } else { startConnect(); }
  }, [startConnect]);

  const handleOrgDisconnect = useCallback(async () => {
    await fetch("/api/salesforce/disconnect", { method: "POST" });
    setOrgStatus("disconnected");
    setOrgContext(null);
    setOrgInfo(null);
    setLastSyncTime(null);
  }, []);

  const handleOrgRefresh = useCallback(() => { fetchOrgMetadata(); }, [fetchOrgMetadata]);

  // ── Upload ──────────────────────────────────────────────────────────────────

  const handleFileUpload = useCallback(async (file: File) => {
    setUploadError(null); setUploading(true); setUploadResult(null);
    setAppliedCtx(null);  setCtxApplied(false);
    const form = new FormData();
    form.append("file", file);
    try {
      const res  = await fetch("/api/upload", { method: "POST", body: form });
      const json = (await res.json()) as UploadResult & { error?: string };
      if (!res.ok || !json.extractedText) { setUploadError(json.error ?? "Upload failed"); return; }
      setInput("");
      setUploadResult(json);
      setInput(json.extractedText);
      analyzeImpact(json.extractedText);
    } catch { setUploadError("Upload failed — network error"); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileUpload(f);
  }, [handleFileUpload]);

  const clearDocument = () => {
    setUploadResult(null); setAppliedCtx(null);
    setCtxApplied(false);  setUploadError(null); setInput("");
  };

  // ── SSE ─────────────────────────────────────────────────────────────────────

  const handleEvent = useCallback((ev: SSEEvent) => {
    switch (ev.type) {
      case "analysis_start":  setAnalysing(true); break;
      case "impact_analysis":
        setAnalysis(ev.analysis ?? null);
        setAnalysing(false);
        if (ev.analysis) setActiveAgentIds(new Set(ev.analysis.activatedAgents.map(a => a.agentId)));
        break;
      case "analysis_error": setAnalysing(false); break;
      case "session_start":
        setSessionId(ev.sessionId ?? null);
        setSessionStartTime(Date.now());
        break;
      case "agent_start":
        setAgents(prev => [...prev, {
          agentId: ev.agentId!, agentName: ev.agentName!, role: ev.role!,
          content: "", complete: false, startTime: Date.now(),
        }]);
        break;
      case "token":
        setAgents(prev => prev.map(a =>
          a.agentId === ev.agentId ? { ...a, content: a.content + ev.token } : a
        ));
        break;
      case "agent_complete":
        setAgents(prev => prev.map(a =>
          a.agentId === ev.agentId
            ? { ...a, complete: true, durationMs: ev.durationMs, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, cacheReadTokens: ev.cacheReadTokens, cacheWriteTokens: ev.cacheWriteTokens }
            : a
        ));
        break;
      case "agent_error":
        setAgents(prev => prev.map(a =>
          a.agentId === ev.agentId ? { ...a, complete: true, error: ev.error, durationMs: ev.durationMs } : a
        ));
        break;
      case "adr_saved":
        if (ev.jiraIssueKey) {
          setJiraIssueKey(ev.jiraIssueKey);
          setJiraIssueUrl(ev.jiraIssueUrl ?? null);
        }
        break;
      case "pending_endorsement":
        setPendingEndorsement({
          requirement:          ev.requirement          ?? "",
          verdict:              ev.verdict              ?? "",
          confidenceLevel:      ev.confidenceLevel      ?? "Medium",
          humanJudgementPoints: ev.humanJudgementPoints ?? [],
          scribeNotes:          ev.scribeNotes          ?? "",
          mustFixIssues:        ev.mustFixIssues        ?? [],
        });
        break;
      case "session_complete":
        setSessionComplete(true);
        setSessionEndTime(Date.now());
        setTimeout(() => setShowSummaryDrawer(true), 900);
        break;
    }
  }, []);

  const analyzeImpact = async (textOverride?: string) => {
    const textToAnalyse = textOverride ?? input;
    if (!textToAnalyse.trim() || analysing) return;
    setAnalysis(null);
    setAnalysing(true);
    setSelectionMode(false);
    setSelectedAgentIds(new Set());

    try {
      const res = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: textToAnalyse }),
      });
      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json() as ImpactAnalysis;
      setAnalysis(data);

      // Pre-select required + recommended + always-on agents
      const preSelected = new Set<string>([
        ...data.activatedAgents
          .filter(a => a.priority !== "optional")
          .map(a => a.agentId),
        ...Array.from(ALWAYS_ON_IDS),
      ]);
      setSelectedAgentIds(preSelected);
      setSelectionMode(true);
    } catch (err) {
      console.error("Impact analysis failed:", err);
    } finally {
      setAnalysing(false);
    }
  };

  const handleToggleAgent = (id: string) => {
    setSelectedAgentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const run = async (revisionOpts?: { revisionRound: number; previousFeedback: string; agentIds?: string[] }) => {
    console.log("[run] called", revisionOpts ? { revisionRound: revisionOpts.revisionRound, hasFeedback: !!revisionOpts.previousFeedback, feedbackLen: revisionOpts.previousFeedback?.length ?? 0 } : "initial");
    if (!input.trim() || running) return;
    setAgents([]); setSessionId(null);
    setSessionComplete(false); setShowSummaryDrawer(false);
    setSessionEndTime(null); setSessionStartTime(null);
    setActiveAgentIds(new Set(selectedAgentIds));
    if (revisionOpts) setRevisionRound(revisionOpts.revisionRound);
    setRunning(true);
    setSelectionMode(false);
    abortRef.current = new AbortController();

    const clientContext = appliedCtx ? {
      existingProducts: appliedCtx.clouds,
      constraints: [...appliedCtx.compliance, ...appliedCtx.integrations],
    } : undefined;

    try {
      const res = await fetch("/api/forum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input, clientContext, modelOverride: model, orgContext: orgContext ?? undefined,
          mode: apiMode,
          documentContent: !!uploadResult,
          // Revision runs skip agent pre-selection — orchestrator handles agent set
          agentIds: revisionOpts ? revisionOpts.agentIds : (selectedAgentIds.size > 0 ? Array.from(selectedAgentIds) : undefined),
          ...(revisionOpts ? { revisionRound: revisionOpts.revisionRound, previousFeedback: revisionOpts.previousFeedback } : {}),
        }),
        signal: abortRef.current.signal,
      });
      const reader  = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try { handleEvent(JSON.parse(line.slice(6)) as SSEEvent); } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") console.error("Stream error:", err);
    } finally {
      setRunning(false);
      setAnalysing(false);
    }
  };

  const stop = () => abortRef.current?.abort();

  const resetSession = () => {
    setAgents([]); setSessionId(null); setAnalysis(null);
    setSessionComplete(false); setShowSummaryDrawer(false);
    setSessionEndTime(null); setSessionStartTime(null);
    setActiveAgentIds(new Set());
    setSelectionMode(false);
    setSelectedAgentIds(new Set());
    setJiraIssueKey(null);
    setJiraIssueUrl(null);
    setSignOff(null);
    setPatternDetails([]);
    setRevisionRound(0);
    setPreviousFeedback("");
    setPendingEndorsement(null);
  };

  const handleCountersign = useCallback(async (name: string, role: string) => {
    const timestamp = new Date().toISOString();
    const res = await fetch("/api/adr/countersign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, jiraIssueKey, architectName: name, architectRole: role, timestamp }),
    });
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      throw new Error(data.error ?? "Sign-off failed");
    }
    setSignOff({ name, role, timestamp });
  }, [sessionId, jiraIssueKey]);

  const handleDownloadReport = useCallback(() => {
    const sessionDate = sessionStartTime
      ? new Date(sessionStartTime).toLocaleString()
      : new Date().toLocaleString();
    const docName = uploadResult?.filename ?? "Inline requirement";
    const judgeAgent = agents.find(a => a.agentId === "sf-judge" && a.complete);
    const judgeVerdict = judgeAgent ? (parseVerdict(judgeAgent.content) ?? "unknown") : "unknown";
    const judgeConfidence = judgeAgent ? (parseJudgeConfidenceLevel(judgeAgent.content) ?? "unknown") : "unknown";
    const judgePoints = judgeAgent ? parseHumanJudgementPoints(judgeAgent.content) : [];

    const lines: string[] = [
      "# ARBoard Forum Report",
      "",
      `**Session Date:** ${sessionDate}`,
      `**Session ID:** ${sessionId ?? "—"}`,
      `**Document:** ${docName}`,
      "",
      "---",
      "",
      "## Requirement",
      "",
      input.trim(),
      "",
      "---",
      "",
      "## Agent Analyses",
      "",
    ];

    for (const agent of agents.filter(a => a.complete && !a.error)) {
      const meta = AGENT_META[agent.agentId];
      lines.push(`### ${meta?.icon ?? "🤖"} ${agent.agentName} (${meta?.badge ?? agent.agentId})`);
      if (agent.durationMs) lines.push(`*Completed in ${formatDuration(agent.durationMs)}*`);
      lines.push("");
      lines.push(agent.content.trim());
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    lines.push("## Judge Verdict");
    lines.push("");
    lines.push(`**Verdict:** ${judgeVerdict.toUpperCase()}`);
    lines.push(`**Confidence Level:** ${judgeConfidence}`);
    if (judgePoints.length > 0) {
      lines.push("");
      lines.push("**Points Requiring Human Judgement:**");
      for (const pt of judgePoints) lines.push(`- ${pt}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("## Endorsement");
    lines.push("");
    if (jiraIssueKey) {
      lines.push(`**Decision:** Endorsed`);
      lines.push(`**Jira Ticket:** ${jiraIssueKey}`);
    } else {
      lines.push("_No endorsement recorded for this session._");
    }
    if (signOff) {
      lines.push("");
      lines.push(`**Countersigned by:** ${signOff.name}, ${signOff.role}`);
      lines.push(`**Timestamp:** ${new Date(signOff.timestamp).toLocaleString()}`);
    }
    lines.push("");

    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ARBoard-Report-${sessionId ?? "session"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [agents, input, jiraIssueKey, sessionId, sessionStartTime, signOff, uploadResult]);

  const hasDetected = uploadResult && (
    uploadResult.detectedContext.clouds.length > 0 ||
    uploadResult.detectedContext.compliance.length > 0 ||
    uploadResult.detectedContext.integrations.length > 0
  );

  // ── Section labels — derived from agent position, not hardcoded IDs ────────
  const CLOSING_AGENT_IDS = new Set(["sf-judge", "sf-scribe", "sf-learner"]);

  function getSectionLabel(agent: AgentOutput, idx: number): string | undefined {
    if (agent.agentId === "sf-designer") return "SOLUTION DESIGN";
    if (agent.agentId === "sf-judge")   return "JUDGE RULING";
    if (agent.agentId === "sf-scribe")  return "SCRIBE & LEARNING";
    // First specialist = first non-designer, non-closing agent in the stream
    const isSpecialist = !CLOSING_AGENT_IDS.has(agent.agentId) && agent.agentId !== "sf-designer";
    const prevIsDesigner = idx > 0 && agents[idx - 1].agentId === "sf-designer";
    if (isSpecialist && prevIsDesigner) return "SPECIALIST REVIEWS";
    return undefined;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#07090f", color: "#F0F4FF", paddingBottom: showSummaryDrawer ? 320 : 40 }}>

      {/* ══ HEADER ════════════════════════════════════════════════════════════ */}
      <header style={{
        background: "#0f1420",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        position: "sticky", top: 0, zIndex: 30,
      }}>
        <div style={{
          maxWidth: 1280, margin: "0 auto", padding: "12px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 18, color: "#00c8f0" }}>
              ⚖ ARBoard
            </span>
            <span style={{ fontSize: 12, color: "#7B8DB0" }}>
              Salesforce Architecture Review Board
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {sessionId && (
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
                {sessionId.slice(0, 8)}
              </span>
            )}

            <ModelDropdown
              model={model}
              setModel={setModel}
              disabled={running}
              estimate={estimate}
            />

            {/* API mode toggle */}
            <div style={{
              display: "flex", alignItems: "center",
              background: "#161d2e", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 20, padding: 2, gap: 1,
            }}>
              <button
                onClick={() => !running && setApiMode("mock")}
                disabled={running}
                style={{
                  padding: "4px 12px", borderRadius: 16, fontSize: 11,
                  fontFamily: "monospace", fontWeight: 600, cursor: running ? "not-allowed" : "pointer",
                  border: "none", transition: "background 0.2s, color 0.2s",
                  background: apiMode === "mock" ? "rgba(90,106,138,0.4)" : "transparent",
                  color: apiMode === "mock" ? "#F0F4FF" : "#7B8DB0",
                }}
              >
                Mock
              </button>
              <button
                onClick={() => !running && setApiMode("real")}
                disabled={running}
                style={{
                  padding: "4px 12px", borderRadius: 16, fontSize: 11,
                  fontFamily: "monospace", fontWeight: 600, cursor: running ? "not-allowed" : "pointer",
                  border: "none", transition: "background 0.2s, color 0.2s",
                  background: apiMode === "real" ? "rgba(232,64,64,0.25)" : "transparent",
                  color: apiMode === "real" ? "#e84040" : "#7B8DB0",
                }}
              >
                {apiMode === "real" ? "⚡ Live API" : "Live"}
              </button>
            </div>

            {(showSessionView && !running || selectionMode) && (
              <button
                onClick={resetSession}
                style={{
                  fontSize: 11, padding: "5px 12px",
                  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
                  color: "#7B8DB0", background: "transparent", cursor: "pointer",
                }}
              >
                ＋ New Session
              </button>
            )}
          </div>
        </div>

        {/* Progress line */}
        <div style={{ height: 2, background: "rgba(255,255,255,0.04)" }}>
          {running && (
            <div style={{
              height: "100%", background: "#00c8f0",
              width: `${progressPct}%`,
              transition: "width 0.6s ease",
              boxShadow: "0 0 6px #00c8f0",
            }} />
          )}
          {sessionComplete && (
            <div style={{ height: "100%", background: "#0fba7a", width: "100%" }} />
          )}
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px 0" }}>

        {/* ══ PRE-SESSION VIEW ═════════════════════════════════════════════════ */}
        {!showSessionView && !selectionMode && !analysing && (
          <>
            {input.trim().length > 0 && <EstimatePanel
              agentCount={estimate.agentCount}
              totalTokens={estimate.totalTokens}
              minTokens={estimate.minTokens}
              maxTokens={estimate.maxTokens}
              cost={estimate.cost}
              minCost={estimate.minCost}
              maxCost={estimate.maxCost}
              modelLabel={MODEL_CONFIG[model].label}
            />}

            {/* Upload zone — hidden once a file is loaded */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => { if (!uploadResult && !uploading) fileInputRef.current?.click(); }}
              style={{
                display: uploadResult ? "none" : "block",
                border: `2px dashed ${dragging ? "#00c8f0" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 8, padding: "12px 16px", marginBottom: 12,
                background: dragging ? "rgba(0,200,240,0.03)" : "transparent",
                transition: "border-color 0.2s",
                cursor: uploading ? "default" : "pointer",
              }}
            >
              <input ref={fileInputRef} type="file" accept={ACCEPTED}
                style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                onClick={e => e.stopPropagation()} />

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  disabled={uploading}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
                    fontSize: 12, color: "#F0F4FF", background: "#161d2e", cursor: "pointer",
                  }}
                >
                  {uploading
                    ? <><span className="animate-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#00c8f0", display: "inline-block" }} /> Extracting…</>
                    : "↑ Upload Document"}
                </button>
                <span style={{ fontSize: 11, color: "#7B8DB0" }}>
                  Drag & drop — PDF · DOC · DOCX
                </span>
                {uploadError && <span style={{ fontSize: 11, color: "#e84040", marginLeft: "auto" }}>{uploadError}</span>}
              </div>
            </div>

            {/* File card — shown after a successful upload */}
            {uploadResult && (
              <div style={{
                border: "2px dashed rgba(255,255,255,0.08)",
                borderRadius: 8, padding: "12px 16px", marginBottom: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Chip
                    label={FORMAT_LABELS[uploadResult.format] ?? uploadResult.format.toUpperCase()}
                    color="#00c8f0"
                  />
                  <span style={{ fontSize: 12, color: "#F0F4FF" }}>{uploadResult.filename}</span>
                  <span style={{ fontSize: 11, color: "#7B8DB0" }}>{formatBytes(uploadResult.fileSize)}</span>
                  {uploadResult.wasChunked && <Chip label="summarised" color="#f0a020" />}
                  <button onClick={clearDocument} style={{
                    marginLeft: "auto", fontSize: 11, color: "#7B8DB0",
                    background: "none", border: "none", cursor: "pointer",
                  }}>Clear ✕</button>
                </div>
                <div style={{ fontSize: 11, color: "#7B8DB0", marginTop: 6 }}>
                  Document extracted — will be used as the review requirement
                </div>
              </div>
            )}

            {/* Detected context */}
            {uploadResult && hasDetected && (
              <div style={{
                border: `1px solid ${ctxApplied ? "rgba(15,186,122,0.3)" : "rgba(0,200,240,0.25)"}`,
                background: ctxApplied ? "rgba(15,186,122,0.04)" : "rgba(0,200,240,0.04)",
                borderRadius: 8, padding: 12, marginBottom: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={S.label}>Detected Context</span>
                  {!ctxApplied ? (
                    <button
                      onClick={() => {
                        setAppliedCtx({
                          clouds: uploadResult.detectedContext.clouds,
                          compliance: uploadResult.detectedContext.compliance,
                          integrations: uploadResult.detectedContext.integrations,
                        });
                        setCtxApplied(true);
                      }}
                      style={{ fontSize: 11, padding: "3px 10px", background: "#00c8f0", color: "#07090f", fontWeight: 700, borderRadius: 4, cursor: "pointer", border: "none" }}
                    >Apply</button>
                  ) : (
                    <span style={{ fontSize: 11, color: "#0fba7a" }}>✓ Applied to session</span>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {uploadResult.detectedContext.clouds.map(c => <Chip key={c} label={c} color="#00c8f0" />)}
                  {uploadResult.detectedContext.compliance.map(c => <Chip key={c} label={c} color="#f0a020" />)}
                  {uploadResult.detectedContext.integrations.map(c => <Chip key={c} label={c} color="#9f70f5" />)}
                </div>
              </div>
            )}

            {/* Client Context Banner */}
            {/* <ClientContextBanner /> */}

            {/* Salesforce Org Connection Banner */}
            <SalesforceOrgBanner
              status={orgStatus}
              orgInfo={orgInfo}
              orgContext={orgContext}
              lastSyncTime={lastSyncTime}
              onConnect={handleOrgConnect}
              onDisconnect={handleOrgDisconnect}
              onRefresh={handleOrgRefresh}
              refreshing={refreshingOrg}
            />

            {/* Org Health Snapshot */}
            {orgStatus === "connected" && orgContext && (
              <OrgHealthPanel orgContext={orgContext} />
            )}

            {/* Textarea — hidden when a document is loaded */}
            {!uploadResult && (
              <div style={{ marginBottom: 12 }}>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Describe your Salesforce architecture challenge or upload a document above…"
                  style={{
                    width: "100%", height: 160, resize: "vertical",
                    background: "#0f1420", border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 8, padding: 16, fontSize: 14, color: "#F0F4FF",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    outline: "none", lineHeight: 1.6,
                    transition: "border-color 0.2s",
                  }}
                  onFocus={e => (e.target.style.borderColor = "rgba(0,200,240,0.4)")}
                  onBlur={e  => (e.target.style.borderColor = "rgba(255,255,255,0.07)")}
                />
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={() => analyzeImpact()}
                disabled={!input.trim()}
                style={{
                  padding: "10px 28px", background: "#00c8f0", color: "#07090f",
                  fontWeight: 700, fontSize: 14, borderRadius: 8,
                  cursor: !input.trim() ? "not-allowed" : "pointer",
                  border: "none", opacity: !input.trim() ? 0.4 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                Analyze Impact
              </button>
              {ctxApplied && (
                <span style={{ fontSize: 12, color: "#0fba7a", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0fba7a", display: "inline-block" }} />
                  Client context applied
                </span>
              )}
            </div>
          </>
        )}

        {/* ══ ANALYSING PHASE ══════════════════════════════════════════════════ */}
        {analysing && !showSessionView && (
          <div style={{ ...S.card, padding: "20px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
            <span className="animate-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#00c8f0", display: "inline-block", flexShrink: 0 }} />
            <div>
              <div style={{ color: "#F0F4FF", fontSize: 13, marginBottom: 4 }}>Running impact analysis…</div>
              <div style={{ color: "#7B8DB0", fontSize: 11 }}>Evaluating requirement against Salesforce architecture patterns</div>
            </div>
          </div>
        )}

        {/* ══ AGENT SELECTION PHASE ════════════════════════════════════════════ */}
        {selectionMode && !showSessionView && analysis && (
          <AgentSelectorPanel
            analysis={analysis}
            model={model}
            input={input}
            selectedAgentIds={selectedAgentIds}
            onToggle={handleToggleAgent}
            onReset={resetSession}
            onRun={run}
            lastSyncTime={lastSyncTime}
            orgConnected={orgStatus === "connected"}
            onRefreshOrg={handleOrgRefresh}
          />
        )}

        {/* ══ SESSION VIEW ══════════════════════════════════════════════════════ */}
        {showSessionView && (
          <>
            {/* Revision round indicator */}
            {revisionRound > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 14px", marginBottom: 12,
                background: "rgba(159,112,245,0.08)",
                border: "1px solid rgba(159,112,245,0.3)",
                borderRadius: 8, fontSize: 12, color: "#9f70f5",
              }}>
                <span>↻</span>
                <span>Revision Round {revisionRound + 1} — Designer phase skipped, addressing prior Judge feedback</span>
              </div>
            )}

            {/* Impact analysis result → agent roster */}
            {analysis && (
              <>
                <ImpactPanel analysis={analysis} model={model} input={input} />
                <AgentRoster
                  agents={agents}
                  activeAgentIds={activeAgentIds}
                  analysisComplete={analysisComplete}
                />
              </>
            )}

            {/* Two-column session layout */}
            {agents.length > 0 && (
              <div className="session-cols">
                {/* LEFT: Timeline */}
                <SessionTimeline
                  agents={agents}
                  activeAgentIds={activeAgentIds}
                  analysisComplete={analysisComplete}
                />

                {/* RIGHT: Forum discussion */}
                <div ref={forumRef} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {agents.map((agent, idx) => {
                    const sectionLabel = getSectionLabel(agent, idx);
                    return (
                      <div key={agent.agentId}>
                        {sectionLabel && <SectionDivider label={sectionLabel} />}
                        <AgentCard agent={agent} />
                        <div style={{ height: 12 }} />
                      </div>
                    );
                  })}

                  {/* Verdict */}
                  {judgeAgent && verdict && (
                    <VerdictBox
                      verdict={verdict}
                      judgeContent={judgeAgent.content}
                      agents={agents}
                      sessionStartTime={sessionStartTime}
                      sessionId={sessionId}
                      jiraIssueKey={jiraIssueKey}
                      signOff={signOff}
                      onCountersign={handleCountersign}
                      matchedPatterns={patternDetails}
                      revisionRound={revisionRound}
                      hideSignOff={!!pendingEndorsement}
                      onDownload={handleDownloadReport}
                      onRevisionRound={() => {
                        const nextRound = revisionRound + 1;
                        setRevisionRound(nextRound);
                        run({ revisionRound: nextRound, previousFeedback, agentIds: Array.from(activeAgentIds) });
                      }}
                    />
                  )}

                  {/* Endorsement Panel */}
                  {sessionComplete && pendingEndorsement && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px" }}>
                        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
                        <span style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: 1.2, color: "#7B8DB0", textTransform: "uppercase" }}>
                          Endorsement Decision
                        </span>
                        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
                      </div>
                      <EndorsementPanel
                        sessionId={sessionId ?? ""}
                        confidence={pendingEndorsement.confidenceLevel}
                        verdictSummary={pendingEndorsement.verdict}
                        humanJudgementPoints={pendingEndorsement.humanJudgementPoints}
                        adrContent={judgeAgent?.content ?? ""}
                        requirement={pendingEndorsement.requirement}
                        verdict={pendingEndorsement.verdict}
                        scribeNotes={pendingEndorsement.scribeNotes}
                        mustFixIssues={pendingEndorsement.mustFixIssues}
                        revisionRound={revisionRound}
                        onEndorsed={(key, url) => {
                          setJiraIssueKey(key);
                          setJiraIssueUrl(url);
                        }}
                      />
                    </>
                  )}

                  {/* Jira ADR banner */}
                  {jiraIssueKey && jiraIssueUrl && (
                    <div style={{
                      marginTop: 12,
                      padding: "10px 16px",
                      border: "1px solid rgba(15,186,122,0.35)",
                      borderRadius: 8,
                      background: "rgba(15,186,122,0.06)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}>
                      <span style={{ color: "#0fba7a", fontSize: 15, lineHeight: 1 }}>✓</span>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "#0fba7a" }}>
                        ADR saved to Jira —
                      </span>
                      <a
                        href={jiraIssueUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          color: "#0fba7a",
                          textDecoration: "underline",
                          textUnderlineOffset: 2,
                        }}
                      >
                        {jiraIssueKey}
                      </a>
                    </div>
                  )}

                  {/* Stop button */}
                  {running && (
                    <button
                      onClick={stop}
                      style={{
                        marginTop: 16, padding: "7px 18px",
                        border: "1px solid rgba(232,64,64,0.3)", borderRadius: 6,
                        color: "#e84040", fontSize: 12, cursor: "pointer",
                        background: "transparent", alignSelf: "flex-start",
                      }}
                    >
                      ■ Stop Session
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Post-session token/cost summary (inline, above drawer) */}
            {sessionComplete && totalActualMs !== null && (
              <div style={{ ...S.card, padding: "14px 18px", marginTop: 24 }}>
                <div style={{ ...S.label, marginBottom: 10 }}>Session Actuals vs Estimate</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: totalCacheReadTokens > 0 ? 14 : 0 }}>
                  <div>
                    <div style={S.label}>Total Time</div>
                    <div style={{ fontFamily: "monospace", fontSize: 14, color: "#0fba7a", fontWeight: 700 }}>
                      {formatDuration(totalActualMs)}
                    </div>
                  </div>
                  <div>
                    <div style={S.label}>Tokens Used</div>
                    <div style={{ fontFamily: "monospace", fontSize: 14, color: "#F0F4FF", fontWeight: 700 }}>
                      {((totalInputTokens + totalOutputTokens) / 1000).toFixed(1)}k
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
                      est. {(estimate.totalTokens / 1000).toFixed(0)}k
                    </div>
                  </div>
                  <div>
                    <div style={S.label}>Actual Cost</div>
                    <div style={{ fontFamily: "monospace", fontSize: 14, color: "#00c8f0", fontWeight: 700 }}>
                      {formatCost(actualCost)}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
                      est. {formatCost(estimate.cost)}
                    </div>
                  </div>
                </div>

                {totalCacheReadTokens > 0 && (
                  <>
                    <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginBottom: 14 }} />
                    <div style={{ ...S.label, marginBottom: 8, color: "#0fba7a" }}>Prompt Cache</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                      <div>
                        <div style={S.label}>Cache Reads</div>
                        <div style={{ fontFamily: "monospace", fontSize: 14, color: "#0fba7a", fontWeight: 700 }}>
                          {(totalCacheReadTokens / 1000).toFixed(1)}k tok
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
                          served from cache
                        </div>
                      </div>
                      <div>
                        <div style={S.label}>Cache Writes</div>
                        <div style={{ fontFamily: "monospace", fontSize: 14, color: "#F0F4FF", fontWeight: 700 }}>
                          {(totalCacheWriteTokens / 1000).toFixed(1)}k tok
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
                          written to cache
                        </div>
                      </div>
                      <div>
                        <div style={S.label}>Saved</div>
                        <div style={{ fontFamily: "monospace", fontSize: 14, color: "#0fba7a", fontWeight: 700 }}>
                          {formatCost(cacheSavings)}
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0" }}>
                          vs full input price
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ SESSION SUMMARY DRAWER ════════════════════════════════════════════ */}
      {showSummaryDrawer && sessionComplete && totalActualMs !== null && (
        <SessionSummaryDrawer
          agents={agents}
          totalMs={totalActualMs}
          actualTokens={totalInputTokens + totalOutputTokens}
          actualCost={actualCost}
          estimate={estimate}
          cacheReadTokens={totalCacheReadTokens}
          cacheWriteTokens={totalCacheWriteTokens}
          cacheSavings={cacheSavings}
          onClose={() => setShowSummaryDrawer(false)}
        />
      )}

      {/* ══ CONNECTED APP SETUP MODAL ═════════════════════════════════════════ */}
      {showSetupModal && (
        <ConnectedAppSetupModal
          onClose={() => setShowSetupModal(false)}
          onProceed={() => { setShowSetupModal(false); startConnect(); }}
        />
      )}
    </div>
  );
}
