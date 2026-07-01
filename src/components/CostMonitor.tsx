"use client";

import React, { useState } from "react";
import { estimateCostUsd } from "@/lib/pricing";

const DESIGNER_ID = "sf-designer";
const CLOSING_IDS = new Set(["sf-judge", "sf-scribe", "sf-learner"]);

interface AgentOutput {
  agentId: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface Props {
  agents: AgentOutput[];
  model: string;
  isRunning: boolean;
}

interface PhaseTotals {
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  agentCount: number;
}

function sumAgents(agents: AgentOutput[]): Omit<PhaseTotals, "label"> {
  return agents.reduce(
    (acc, a) => ({
      input:      acc.input      + (a.inputTokens      ?? 0),
      output:     acc.output     + (a.outputTokens     ?? 0),
      cacheRead:  acc.cacheRead  + (a.cacheReadTokens  ?? 0),
      cacheWrite: acc.cacheWrite + (a.cacheWriteTokens ?? 0),
      agentCount: acc.agentCount + 1,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, agentCount: 0 },
  );
}

export function CostMonitor({ agents, model, isRunning }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!isRunning) return null;

  const designerAgents   = agents.filter(a => a.agentId === DESIGNER_ID);
  const specialistAgents = agents.filter(a => a.agentId !== DESIGNER_ID && !CLOSING_IDS.has(a.agentId));
  const closingAgents    = agents.filter(a => CLOSING_IDS.has(a.agentId));

  const phases: PhaseTotals[] = [
    { label: "Designer",    ...sumAgents(designerAgents) },
    { label: "Specialists", ...sumAgents(specialistAgents) },
    { label: "Closing",     ...sumAgents(closingAgents) },
  ].filter(p => p.agentCount > 0);

  const totals = sumAgents(agents);
  const totalCost = estimateCostUsd(totals.input, totals.output, totals.cacheRead, totals.cacheWrite, model);

  return (
    <div style={{
      position:     "fixed",
      bottom:       20,
      right:        20,
      zIndex:       50,
      width:        240,
      background:   "#0f1117",
      border:       "1px solid #2a2d3e",
      borderRadius: 8,
      fontSize:     12,
      color:        "#c8cce0",
      boxShadow:    "0 4px 16px rgba(0,0,0,0.4)",
      fontFamily:   "monospace",
    }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(e => !e)}
        onKeyDown={e => e.key === "Enter" && setExpanded(v => !v)}
        style={{
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "center",
          padding:        "8px 12px",
          cursor:         "pointer",
          userSelect:     "none",
        }}
      >
        <span style={{ color: "#7B8DB0", fontWeight: 500, fontSize: 11, letterSpacing: "0.04em" }}>
          LIVE COST
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#4ade80", fontWeight: 700 }}>
            ${totalCost.toFixed(4)}
          </span>
          <span style={{ color: "#3d4266", fontSize: 9 }}>
            {expanded ? "▲" : "▼"}
          </span>
        </span>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid #1a1d2e", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
          {phases.map(p => {
            const phaseCost = estimateCostUsd(p.input, p.output, p.cacheRead, p.cacheWrite, model);
            return (
              <div key={p.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#5a6080" }}>{p.label}</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: "#3d4266" }}>
                    {(p.input + p.output).toLocaleString()}t
                  </span>
                  <span style={{ color: "#8892b0" }}>${phaseCost.toFixed(4)}</span>
                </span>
              </div>
            );
          })}
          <div style={{
            borderTop:      "1px solid #1a1d2e",
            marginTop:      2,
            paddingTop:     6,
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
          }}>
            <span style={{ color: "#7B8DB0", fontWeight: 600 }}>Total</span>
            <span style={{ display: "flex", gap: 8 }}>
              <span style={{ color: "#3d4266" }}>
                {(totals.input + totals.output).toLocaleString()}t
              </span>
              <span style={{ color: "#4ade80", fontWeight: 700 }}>${totalCost.toFixed(4)}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
