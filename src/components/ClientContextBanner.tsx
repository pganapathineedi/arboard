"use client";

import { useEffect, useState } from "react";
import type { ClientConfig } from "@/lib/clients/types";

type ClientContextData = ClientConfig & { active: true; overrideCount: number };
type FetchState = "loading" | "inactive" | "active" | "error";

const CLOUD_COLOR: Record<string, string> = {
  "Service Cloud":      "#00c8f0",
  "Experience Cloud":   "#00c8f0",
  "Health Cloud":       "#0fba7a",
  "OmniStudio":         "#9f70f5",
  "Agentforce":         "#f0a020",
  "Sales Cloud":        "#00c8f0",
  "Data Cloud":         "#00c8f0",
  "Marketing Cloud":    "#00c8f0",
  "Financial Services Cloud": "#0fba7a",
  "Manufacturing Cloud": "#0fba7a",
  "Commerce Cloud":     "#00c8f0",
  "Revenue Cloud":      "#f0a020",
};

const REGION_LABEL: Record<string, string> = {
  "ap-southeast-2": "Sydney (ap-southeast-2)",
  "us-east-1":      "US East (us-east-1)",
  "us-west-2":      "US West (us-west-2)",
  "eu-west-1":      "EU West (eu-west-1)",
};

const S = {
  label: {
    fontFamily: "monospace",
    fontSize: 10,
    letterSpacing: 1.2,
    color: "#7B8DB0",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
};

function CloudChip({ label }: { label: string }) {
  const color = CLOUD_COLOR[label] ?? "#7B8DB0";
  return (
    <span style={{
      fontFamily: "monospace", fontSize: 10,
      padding: "2px 8px", borderRadius: 4,
      border: `1px solid ${color}44`,
      background: `${color}14`,
      color,
    }}>
      {label}
    </span>
  );
}

function RegChip({ label }: { label: string }) {
  return (
    <span style={{
      fontFamily: "monospace", fontSize: 10,
      padding: "2px 8px", borderRadius: 4,
      border: "1px solid rgba(240,160,32,0.4)",
      background: "rgba(240,160,32,0.1)",
      color: "#f0a020",
    }}>
      {label}
    </span>
  );
}

export function ClientContextBanner() {
  const [state, setState] = useState<FetchState>("loading");
  const [data, setData]   = useState<ClientContextData | null>(null);
  const [open, setOpen]   = useState(true);

  useEffect(() => {
    fetch("/api/client-context")
      .then(r => r.json())
      .then((json: { active: boolean } & Partial<ClientContextData>) => {
        if (json.active) {
          setData(json as ClientContextData);
          setState("active");
        } else {
          setState("inactive");
        }
      })
      .catch(() => setState("error"));
  }, []);

  if (state === "loading" || state === "inactive" || state === "error") return null;
  if (!data) return null;

  const budgetUsedPct = 0; // runtime tracking not wired yet — placeholder
  const regionLabel = REGION_LABEL[data.dataRegion] ?? data.dataRegion;

  return (
    <div style={{
      borderRadius: 8,
      border: "1px solid rgba(15,186,122,0.3)",
      background: "rgba(15,186,122,0.04)",
      marginBottom: 12,
      overflow: "hidden",
      fontFamily: "monospace",
    }}>
      {/* ── Header row ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px",
        borderBottom: open ? "1px solid rgba(255,255,255,0.05)" : "none",
      }}>
        {/* Live dot */}
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: "#0fba7a",
          boxShadow: "0 0 6px #0fba7a",
          flexShrink: 0,
          display: "inline-block",
        }} />

        <span style={{ fontSize: 12, fontWeight: 700, color: "#0fba7a" }}>
          CLIENT CONTEXT ACTIVE
        </span>

        <span style={{ fontSize: 12, color: "#F0F4FF", marginLeft: 4 }}>
          — {data.name}
        </span>

        <span style={{
          fontSize: 10, color: "#7B8DB0",
          padding: "1px 7px", borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          marginLeft: 4,
        }}>
          {data.industry}
        </span>

        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, color: "#7B8DB0" }}>
            {data.overrideCount} agent override{data.overrideCount !== 1 ? "s" : ""} loaded
          </span>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#7B8DB0", fontSize: 12, padding: "0 2px",
              lineHeight: 1,
            }}
            title={open ? "Collapse" : "Expand"}
          >
            {open ? "▲" : "▼"}
          </button>
        </span>
      </div>

      {/* ── Detail rows ── */}
      {open && (
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Clouds */}
          <div>
            <div style={{ ...S.label, marginBottom: 6 }}>Salesforce clouds in scope</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {data.salesforceClouds.map(c => <CloudChip key={c} label={c} />)}
            </div>
          </div>

          {/* Regulatory + region row */}
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            {data.regulatoryOverlays.length > 0 && (
              <div>
                <div style={{ ...S.label, marginBottom: 6 }}>Regulatory overlays</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {data.regulatoryOverlays.map(r => <RegChip key={r} label={r} />)}
                </div>
              </div>
            )}

            <div>
              <div style={{ ...S.label, marginBottom: 6 }}>Data region</div>
              <span style={{
                fontSize: 11, color: "#F0F4FF",
                padding: "2px 8px", borderRadius: 4,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.04)",
              }}>
                {regionLabel}
              </span>
            </div>

            <div>
              <div style={{ ...S.label, marginBottom: 6 }}>Zero retention</div>
              <span style={{
                fontSize: 11,
                color: data.zeroRetention ? "#0fba7a" : "#7B8DB0",
              }}>
                {data.zeroRetention ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>

          {/* Budget bar */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={S.label}>Monthly budget</span>
              <span style={{ fontSize: 10, color: "#7B8DB0" }}>
                ${data.monthlyBudgetUSD} / month · alert at {data.budgetAlertPct}%
              </span>
            </div>
            <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
              <div style={{
                height: "100%",
                width: `${budgetUsedPct}%`,
                background: budgetUsedPct > data.budgetAlertPct ? "#e84040" : "#0fba7a",
                borderRadius: 3,
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>

          {/* Guard rail callout */}
          <div style={{
            fontSize: 10, color: "#7B8DB0",
            paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.04)",
          }}>
            All agent responses will include NovaPeak guardrails. Violations of data residency, accessibility, or security rules will be escalated as <span style={{ color: "#e84040" }}>MUST-FIX</span>.
          </div>
        </div>
      )}
    </div>
  );
}
