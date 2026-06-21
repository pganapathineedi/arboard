"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { ImpactAnalysis, UploadResult } from "@/lib/types";

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
  inputPer1K: number; outputPer1K: number; description: string;
}> = {
  "claude-haiku-4-5-20251001": {
    label: "claude-haiku-4-5", icon: "⚡",
    inputPer1K: 0.0008, outputPer1K: 0.004,
    description: "Fast · Cost-efficient · Good for most reviews",
  },
  "claude-sonnet-4-6": {
    label: "claude-sonnet-4-6", icon: "🧠",
    inputPer1K: 0.003, outputPer1K: 0.015,
    description: "Balanced · Recommended for complex projects",
  },
  "claude-opus-4-8": {
    label: "claude-opus-4-8", icon: "🚀",
    inputPer1K: 0.015, outputPer1K: 0.075,
    description: "Maximum depth · Best for high-stakes reviews",
  },
};

const ALL_AGENT_IDS = [
  "sf-designer", "sf-lwc", "sf-omniStudio", "sf-flow",
  "sf-apex", "sf-patterns", "sf-judge", "sf-scribe", "sf-learner",
];

const AGENT_META: Record<string, {
  icon: string; color: string; badge: string; estSeconds: number; shortName: string;
}> = {
  "sf-designer":   { icon: "🎨", color: "#00c8f0", badge: "SOLUTION ARCH",  estSeconds: 45, shortName: "Designer"   },
  "sf-lwc":        { icon: "⚡", color: "#00c8f0", badge: "UI SPECIALIST",   estSeconds: 28, shortName: "LWC"        },
  "sf-omniStudio": { icon: "🔮", color: "#9f70f5", badge: "OMNI EXPERT",     estSeconds: 32, shortName: "OmniStudio" },
  "sf-flow":       { icon: "🔄", color: "#f0a020", badge: "FLOW BUILDER",    estSeconds: 35, shortName: "Flow"       },
  "sf-apex":       { icon: "⚙️",  color: "#e84040", badge: "APEX EXPERT",    estSeconds: 40, shortName: "Apex"       },
  "sf-patterns":   { icon: "📐", color: "#0fba7a", badge: "PATTERNS",        estSeconds: 35, shortName: "Patterns"   },
  "sf-judge":      { icon: "⚖️",  color: "#f0a020", badge: "JUDGE",          estSeconds: 45, shortName: "Judge"      },
  "sf-scribe":     { icon: "📝", color: "#5a6a8a", badge: "SCRIBE",          estSeconds: 20, shortName: "Scribe"     },
  "sf-learner":    { icon: "🎓", color: "#9f70f5", badge: "LEARNER",         estSeconds: 18, shortName: "Learner"    },
};

const RISK_SEVERITY_COLOR: Record<string, string> = {
  critical: "#e84040", high: "#e84040", medium: "#f0a020", low: "#0fba7a",
};

const PRIORITY_STYLE: Record<string, { bg: string; text: string }> = {
  required:    { bg: "rgba(232,64,64,0.12)",   text: "#e84040" },
  recommended: { bg: "rgba(240,160,32,0.12)",  text: "#f0a020" },
  optional:    { bg: "rgba(90,106,138,0.12)",  text: "#5a6a8a" },
};

const FORMAT_LABELS: Record<string, string> = {
  pdf: "PDF", docx: "DOCX", txt: "TXT", md: "MD", html: "HTML",
};

const DEFAULT_INPUT =
  "Build a Customer 360 self-service portal on Experience Cloud for B2C customers to view real-time SAP order status, submit service cases, and receive Einstein Bot-assisted case deflection. The portal integrates with SAP S/4HANA via MuleSoft Anypoint Platform. Order data (current and 24-month history) must be scoped to the authenticated customer's account only. Einstein Bots should handle initial case triage and deflect common queries before routing to human agents. The solution must support 50,000 active portal users and up to 10 million order records within 24 months of launch.";

const ACCEPTED = ".pdf,.docx,.txt,.md,.html,.htm";

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

function formatCost(usd: number): string {
  if (usd < 0.001) return `<$0.001`;
  if (usd < 0.01)  return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function estimateSession(inputText: string, agentCount: number, modelId: ModelId) {
  const reqTokens   = Math.ceil(inputText.length / 4);
  const sysTokens   = 450;
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
  if (u.includes("APPROVED WITH CONDITIONS") || u.includes("CONDITIONALLY APPROVED")) return "conditional";
  if (u.includes("REVISION REQUIRED") || u.includes("REQUIRES REVISION"))            return "revision";
  if (u.includes("APPROVED"))                                                          return "approved";
  return null;
}

function parseMustFix(content: string): string[] {
  const block = content.match(/MUST FIX[:\s]*\n([\s\S]+?)(?=\n##|\n[A-Z]{3,}[\s:]|\n\n\n|$)/i);
  if (!block) return [];
  return block[1]
    .split("\n")
    .filter(l => /^\d+\./.test(l.trim()))
    .map(l => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
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
    color: "#5a6a8a",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  mono: {
    fontFamily: "monospace",
  } as React.CSSProperties,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Chip({ label, color = "#5a6a8a" }: { label: string; color?: string }) {
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
      <span style={{ ...S.label, fontSize: 11, color: "#5a6a8a" }}>{label}</span>
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
          <div style={{ fontFamily: "monospace", fontSize: 20, color: "#dde2f0", fontWeight: 700 }}>{p.agentCount}</div>
        </div>
        <div>
          <div style={{ ...S.label, marginBottom: 4 }}>Est. Tokens</div>
          <div style={{ fontFamily: "monospace", fontSize: 16, color: "#dde2f0", fontWeight: 700 }}>
            ~{(p.totalTokens / 1000).toFixed(0)}k
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a" }}>
            {(p.minTokens / 1000).toFixed(0)}k–{(p.maxTokens / 1000).toFixed(0)}k range
          </div>
        </div>
        <div>
          <div style={{ ...S.label, marginBottom: 4 }}>Est. Cost</div>
          <div style={{ fontFamily: "monospace", fontSize: 16, color: "#00c8f0", fontWeight: 700 }}>
            ~{formatCost(p.cost)}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a" }}>
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
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#dde2f0" }}>{cfg.label}</span>
        <span style={{ color: "#5a6a8a", fontSize: 10, marginLeft: 2 }}>▾</span>
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
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#dde2f0" }}>{c.label}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 11, color: "#00c8f0" }}>
                      ~{formatCost(est.cost)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#5a6a8a", paddingLeft: 22 }}>{c.description}</div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── ImpactPanel ───────────────────────────────────────────────────────────────

function ImpactPanel({ analysis, model, input }: {
  analysis: ImpactAnalysis;
  model: ModelId;
  input: string;
}) {
  const riskColor = RISK_SEVERITY_COLOR[analysis.overallRisk] ?? "#5a6a8a";
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
        <p style={{ fontSize: 13, color: "#dde2f0", lineHeight: 1.6, margin: 0 }}>
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
              border: `1px solid ${meta?.color ?? "#5a6a8a"}33`,
              padding: 14,
              borderTop: `2px solid ${meta?.color ?? "#5a6a8a"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{meta?.icon ?? "🤖"}</span>
                <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: meta?.color ?? "#dde2f0" }}>
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
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a" }}>
                  Est. ~{meta?.estSeconds ?? 30}s
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a" }}>
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
              <div style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#dde2f0", marginBottom: 2 }}>
                {meta.shortName}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 9, color: "#5a6a8a", marginBottom: 6 }}>
                {meta.badge}
              </div>

              {/* Status */}
              <div style={{ fontFamily: "monospace", fontSize: 9, color:
                status === "active"  ? "#00c8f0" :
                status === "done"    ? "#0fba7a" :
                status === "warn"    ? "#f0a020" :
                status === "error"   ? "#e84040" :
                status === "skipped" ? "#5a6a8a" : "#5a6a8a",
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
                  color: item.status === "idle" ? "#5a6a8a" : "#dde2f0",
                  fontWeight: item.status === "active" ? 700 : 400,
                }}>
                  {meta?.shortName ?? item.agentId}
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 9, color:
                  item.status === "active" ? "#00c8f0" :
                  item.status === "done"   ? "#0fba7a" :
                  "#5a6a8a",
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
    <div style={{ fontSize: 13, color: "#dde2f0", lineHeight: 1.7 }}>
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
              <span style={{ fontSize: 13, color: "#dde2f0" }}>
                {line.replace(/^\d+\.\s*/, "")}
              </span>
            </div>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
              <span style={{ color: "#00c8f044" }}>›</span>
              <span style={{ fontSize: 13, color: "#dde2f0" }}>{line.slice(2)}</span>
            </div>
          );
        }
        return line.trim() ? (
          <p key={i} style={{ margin: "0 0 4px", fontSize: 13, color: "#dde2f0" }}>{line}</p>
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
            <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: meta?.color ?? "#dde2f0" }}>
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
            <span style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a" }}>
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
          <div style={{ fontSize: 13, color: "#dde2f0", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
            {agent.content || <span style={{ color: "#5a6a8a" }}>Waiting…</span>}
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

function VerdictBox({
  verdict, judgeContent, agents, sessionStartTime,
}: {
  verdict: "approved" | "conditional" | "revision";
  judgeContent: string;
  agents: AgentOutput[];
  sessionStartTime: number | null;
}) {
  const totalMs = sessionStartTime ? Date.now() - sessionStartTime : null;
  const mustFix = parseMustFix(judgeContent);

  const colors = {
    approved:    { border: "#0fba7a", bg: "rgba(15,186,122,0.06)", icon: "✓", label: "APPROVED",                text: "#0fba7a" },
    conditional: { border: "#f0a020", bg: "rgba(240,160,32,0.06)", icon: "✓", label: "APPROVED WITH CONDITIONS", text: "#f0a020" },
    revision:    { border: "#e84040", bg: "rgba(232,64,64,0.06)",  icon: "↻", label: "REVISION REQUIRED",       text: "#e84040" },
  }[verdict];

  const completedAgents = agents.filter(a => a.complete && !a.error);

  return (
    <div className="arboard-verdict" style={{
      ...S.card,
      border: `2px solid ${colors.border}`,
      background: colors.bg,
      marginTop: 24,
      padding: "20px 24px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 22, color: colors.text }}>{colors.icon}</span>
        <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: colors.text, letterSpacing: 0.5 }}>
          {colors.label}
        </span>
        {totalMs && (
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#5a6a8a", marginLeft: "auto" }}>
            Round 1 · {completedAgents.length} agents · {formatDuration(totalMs)} total
          </span>
        )}
      </div>

      <div style={{ height: 1, background: `${colors.border}33`, marginBottom: 14 }} />

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
                <span style={{ fontSize: 12, color: "#dde2f0" }}>{item}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button style={{
          padding: "8px 18px", background: "#00c8f0", color: "#07090f",
          fontWeight: 700, fontSize: 12, borderRadius: 6, cursor: "pointer", border: "none",
        }}>
          ⬇ Download Report
        </button>
        {verdict !== "approved" && (
          <button style={{
            padding: "8px 18px", background: "transparent",
            border: `1px solid ${colors.border}66`, color: colors.text,
            fontSize: 12, borderRadius: 6, cursor: "pointer",
          }}>
            ↻ Revision Round
          </button>
        )}
      </div>
    </div>
  );
}

// ── SessionSummaryDrawer ──────────────────────────────────────────────────────

function SessionSummaryDrawer({
  agents, totalMs, actualTokens, actualCost, estimate, onClose,
}: {
  agents: AgentOutput[];
  totalMs: number;
  actualTokens: number;
  actualCost: number;
  estimate: ReturnType<typeof estimateSession>;
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
          <button onClick={onClose} style={{ color: "#5a6a8a", background: "none", border: "none", fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
          {[
            { label: "Total Time",    value: formatDuration(totalMs),      sub: null },
            { label: "Total Tokens",  value: `${(actualTokens / 1000).toFixed(1)}k`, sub: `est. was ${(estimate.totalTokens / 1000).toFixed(0)}k` },
            { label: "Actual Cost",   value: formatCost(actualCost),       sub: `est. was ${formatCost(estimate.cost)}` },
            { label: "Accuracy",      value: accurate ? "✓ within 20%" : `${tokenDiffPct > 0 ? "+" : ""}${tokenDiffPct}% off`, sub: null },
          ].map(item => (
            <div key={item.label} style={{ ...S.card, padding: "12px 14px" }}>
              <div style={{ ...S.label, marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: "#dde2f0" }}>{item.value}</div>
              {item.sub && <div style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a", marginTop: 2 }}>{item.sub}</div>}
            </div>
          ))}
        </div>

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
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#dde2f0", width: 80, flexShrink: 0 }}>
                  {meta?.shortName ?? a.agentName}
                </span>
                <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                  <div style={{
                    height: "100%", width: `${barPct}%`,
                    background: meta?.color ?? "#00c8f0", borderRadius: 3,
                    transition: "width 0.6s ease",
                  }} />
                </div>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a", width: 70, textAlign: "right", flexShrink: 0 }}>
                  ~{(tokens / 1000).toFixed(1)}k tok
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a", width: 40, textAlign: "right", flexShrink: 0 }}>
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
  const [model, setModel]               = useState<ModelId>("claude-haiku-4-5-20251001");
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

  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading]       = useState(false);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const [dragging, setDragging]         = useState(false);
  const [appliedCtx, setAppliedCtx]     = useState<AppliedCtx | null>(null);
  const [ctxApplied, setCtxApplied]     = useState(false);

  const [showSummaryDrawer, setShowSummaryDrawer] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const forumRef     = useRef<HTMLDivElement | null>(null);

  // Derived
  const showSessionView = running || analysing || agents.length > 0 || sessionComplete;
  const analysisComplete = analysis !== null;
  const judgeAgent = agents.find(a => a.agentId === "sf-judge" && a.complete);
  const verdict    = judgeAgent ? parseVerdict(judgeAgent.content) : null;

  const agentCount = analysis ? analysis.activatedAgents.length : 7;
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

  const progressPct = agents.length === 0 ? 0
    : (completedAgents.length / Math.max(agents.length, agentCount)) * 100;

  // Scroll forum panel to bottom as tokens arrive
  useEffect(() => {
    if (forumRef.current) forumRef.current.scrollTop = forumRef.current.scrollHeight;
  }, [agents]);

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
      setUploadResult(json);
      setInput(json.extractedText);
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
            ? { ...a, complete: true, durationMs: ev.durationMs, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens }
            : a
        ));
        break;
      case "agent_error":
        setAgents(prev => prev.map(a =>
          a.agentId === ev.agentId ? { ...a, complete: true, error: ev.error, durationMs: ev.durationMs } : a
        ));
        break;
      case "session_complete":
        setSessionComplete(true);
        setSessionEndTime(Date.now());
        setTimeout(() => setShowSummaryDrawer(true), 900);
        break;
    }
  }, []);

  const run = async () => {
    if (!input.trim() || running) return;
    setAgents([]); setSessionId(null); setAnalysis(null);
    setSessionComplete(false); setShowSummaryDrawer(false);
    setSessionEndTime(null); setSessionStartTime(null);
    setActiveAgentIds(new Set());
    setRunning(true); setAnalysing(true);
    abortRef.current = new AbortController();

    const clientContext = appliedCtx ? {
      existingProducts: appliedCtx.clouds,
      constraints: [...appliedCtx.compliance, ...appliedCtx.integrations],
    } : undefined;

    try {
      const res = await fetch("/api/forum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, clientContext, modelOverride: model }),
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
  };

  const hasDetected = uploadResult && (
    uploadResult.detectedContext.clouds.length > 0 ||
    uploadResult.detectedContext.compliance.length > 0 ||
    uploadResult.detectedContext.integrations.length > 0
  );

  // ── Section labels for forum discussion ────────────────────────────────────
  const SECTION_LABELS: Record<string, string> = {
    "sf-designer":   "SOLUTION DESIGN",
    "sf-lwc":        "SPECIALIST REVIEWS",
    "sf-judge":      "JUDGE RULING",
    "sf-scribe":     "SCRIBE & LEARNING",
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#07090f", color: "#dde2f0", paddingBottom: showSummaryDrawer ? 320 : 40 }}>

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
            <span style={{ fontSize: 12, color: "#5a6a8a" }}>
              Salesforce Architecture Review Board
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {sessionId && (
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a" }}>
                {sessionId.slice(0, 8)}
              </span>
            )}

            <ModelDropdown
              model={model}
              setModel={setModel}
              disabled={running}
              estimate={estimate}
            />

            {showSessionView && !running && (
              <button
                onClick={resetSession}
                style={{
                  fontSize: 11, padding: "5px 12px",
                  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
                  color: "#5a6a8a", background: "transparent", cursor: "pointer",
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
        {!showSessionView && (
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

            {/* Upload zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              style={{
                border: `2px dashed ${dragging ? "#00c8f0" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 8, padding: "12px 16px", marginBottom: 12,
                background: dragging ? "rgba(0,200,240,0.03)" : "transparent",
                transition: "border-color 0.2s",
              }}
            >
              <input ref={fileInputRef} type="file" accept={ACCEPTED} className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                disabled={uploading} />

              {uploadResult ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Chip
                    label={FORMAT_LABELS[uploadResult.format] ?? uploadResult.format.toUpperCase()}
                    color="#00c8f0"
                  />
                  <span style={{ fontSize: 12, color: "#dde2f0" }}>{uploadResult.filename}</span>
                  <span style={{ fontSize: 11, color: "#5a6a8a" }}>{formatBytes(uploadResult.fileSize)}</span>
                  {uploadResult.wasChunked && <Chip label="summarised" color="#f0a020" />}
                  <button onClick={clearDocument} style={{
                    marginLeft: "auto", fontSize: 11, color: "#5a6a8a",
                    background: "none", border: "none", cursor: "pointer",
                  }}>Clear ✕</button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
                      border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
                      fontSize: 12, color: "#dde2f0", background: "#161d2e", cursor: "pointer",
                    }}
                  >
                    {uploading
                      ? <><span className="animate-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#00c8f0", display: "inline-block" }} /> Extracting…</>
                      : "↑ Upload Document"}
                  </button>
                  <span style={{ fontSize: 11, color: "#5a6a8a" }}>
                    Drag & drop — PDF · DOCX · TXT · MD · HTML (Confluence)
                  </span>
                  {uploadError && <span style={{ fontSize: 11, color: "#e84040", marginLeft: "auto" }}>{uploadError}</span>}
                </div>
              )}
            </div>

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

            {/* Textarea */}
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Describe your Salesforce architecture challenge or upload a document above…"
                style={{
                  width: "100%", height: 160, resize: "vertical",
                  background: "#0f1420", border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 8, padding: 16, fontSize: 14, color: "#dde2f0",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  outline: "none", lineHeight: 1.6,
                  transition: "border-color 0.2s",
                }}
                onFocus={e => (e.target.style.borderColor = "rgba(0,200,240,0.4)")}
                onBlur={e  => (e.target.style.borderColor = "rgba(255,255,255,0.07)")}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={run}
                disabled={!input.trim()}
                style={{
                  padding: "10px 28px", background: "#00c8f0", color: "#07090f",
                  fontWeight: 700, fontSize: 14, borderRadius: 8,
                  cursor: !input.trim() ? "not-allowed" : "pointer",
                  border: "none", opacity: !input.trim() ? 0.4 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                Start ARB Session
              </button>
              {ctxApplied && (
                <span style={{ fontSize: 12, color: "#0fba7a", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0fba7a", display: "inline-block" }} />
                  Client context applied
                </span>
              )}
            </div>

            {/* Impact Analysis panel (pre-session, if ran previously) */}
            {analysis && (
              <div style={{ marginTop: 24 }}>
                <ImpactPanel analysis={analysis} model={model} input={input} />
              </div>
            )}
          </>
        )}

        {/* ══ SESSION VIEW ══════════════════════════════════════════════════════ */}
        {showSessionView && (
          <>
            {/* Analysing state */}
            {analysing && !analysis && (
              <div style={{
                ...S.card, padding: "14px 18px", marginBottom: 16,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span className="animate-pulse" style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: "#00c8f0", display: "inline-block",
                }} />
                <span style={{ color: "#5a6a8a", fontSize: 13 }}>
                  Analysing requirement · selecting agents…
                </span>
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
                    const sectionLabel = SECTION_LABELS[agent.agentId];
                    const prevAgentId  = idx > 0 ? agents[idx - 1].agentId : null;
                    const showDivider  = sectionLabel && prevAgentId !== agent.agentId;
                    return (
                      <div key={agent.agentId}>
                        {showDivider && sectionLabel && (
                          <SectionDivider label={sectionLabel} />
                        )}
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
                    />
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                  <div>
                    <div style={S.label}>Total Time</div>
                    <div style={{ fontFamily: "monospace", fontSize: 14, color: "#0fba7a", fontWeight: 700 }}>
                      {formatDuration(totalActualMs)}
                    </div>
                  </div>
                  <div>
                    <div style={S.label}>Tokens Used</div>
                    <div style={{ fontFamily: "monospace", fontSize: 14, color: "#dde2f0", fontWeight: 700 }}>
                      {((totalInputTokens + totalOutputTokens) / 1000).toFixed(1)}k
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a" }}>
                      est. {(estimate.totalTokens / 1000).toFixed(0)}k
                    </div>
                  </div>
                  <div>
                    <div style={S.label}>Actual Cost</div>
                    <div style={{ fontFamily: "monospace", fontSize: 14, color: "#00c8f0", fontWeight: 700 }}>
                      {formatCost(actualCost)}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#5a6a8a" }}>
                      est. {formatCost(estimate.cost)}
                    </div>
                  </div>
                </div>
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
          onClose={() => setShowSummaryDrawer(false)}
        />
      )}
    </div>
  );
}
