"use client";

import { useState } from "react";
import type { OrgContext } from "@/lib/types/salesforce";

interface Props {
  orgContext: OrgContext;
}

interface Cell {
  title: string;
  value: string;
  sub: string;
  status: "ok" | "warn" | "critical";
  detail: string[];
}

function storageStatus(used: number, total: number): "ok" | "warn" | "critical" {
  if (total === 0) return "ok";
  const pct = used / total;
  if (pct >= 0.95) return "critical";
  if (pct >= 0.85) return "warn";
  return "ok";
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function OrgHealthPanel({ orgContext }: Props) {
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  const [sharingExpanded, setSharingExpanded] = useState(false);

  const { dataVolumes, limitsSnapshot, automationDetails, installedPackages, sharingModels } = orgContext;

  const topVol = dataVolumes
    .filter(d => d.risk !== "LOW")
    .sort((a, b) => b.recordCount - a.recordCount)[0];

  const accountsCell: Cell = {
    title: "DATA VOLUMES",
    value: topVol
      ? `${(topVol.recordCount / 1_000_000).toFixed(1)}M ${topVol.objectName}`
      : `${dataVolumes.length} objects`,
    sub: topVol?.risk ?? "LOW",
    status: topVol?.risk === "HIGH RISK" ? "critical" : topVol?.risk === "MEDIUM" ? "warn" : "ok",
    detail: dataVolumes
      .filter(d => d.risk !== "LOW")
      .map(d => `${d.objectName}: ${d.recordCount.toLocaleString()} records (${d.risk})`),
  };

  const dataPct = limitsSnapshot.dataStorageMBTotal > 0
    ? Math.round(limitsSnapshot.dataStorageMBUsed / limitsSnapshot.dataStorageMBTotal * 100)
    : 0;
  const storageCell: Cell = {
    title: "STORAGE",
    value: limitsSnapshot.dataStorageMBTotal > 0 ? `${dataPct}% used` : "N/A",
    sub: dataPct >= 95 ? "CRITICAL" : dataPct >= 85 ? "WARNING" : "OK",
    status: storageStatus(limitsSnapshot.dataStorageMBUsed, limitsSnapshot.dataStorageMBTotal),
    detail: [
      limitsSnapshot.dataStorageMBTotal > 0
        ? `Data: ${formatMB(limitsSnapshot.dataStorageMBUsed)} / ${formatMB(limitsSnapshot.dataStorageMBTotal)} (${dataPct}%)`
        : "Data storage: N/A",
      limitsSnapshot.fileStorageMBTotal > 0
        ? `Files: ${formatMB(limitsSnapshot.fileStorageMBUsed)} / ${formatMB(limitsSnapshot.fileStorageMBTotal)}`
        : "File storage: N/A",
      limitsSnapshot.dailyApiCallsTotal > 0
        ? `API calls: ${limitsSnapshot.dailyApiCallsUsed.toLocaleString()} / ${limitsSnapshot.dailyApiCallsTotal.toLocaleString()}`
        : "API limits: N/A",
    ],
  };

  const totalFlows = automationDetails.reduce((s, a) => s + a.flowCount, 0);
  const totalTriggers = automationDetails.reduce((s, a) => s + a.triggerCount, 0);
  const legacyCount = automationDetails.filter(a => a.hasDeprecatedAutomation).length;
  const automationCell: Cell = {
    title: "AUTOMATION",
    value: `${totalFlows} flows`,
    sub: legacyCount > 0 ? `${legacyCount} legacy` : `${totalTriggers} triggers`,
    status: legacyCount > 0 ? "warn" : "ok",
    detail: [
      `${totalFlows} active Flows`,
      `${totalTriggers} Apex Triggers`,
      legacyCount > 0 ? `${legacyCount} objects with deprecated automation (Process Builder/Workflow Rules)` : "No deprecated automation found",
      ...automationDetails
        .filter(a => a.flowCount > 0 || a.triggerCount > 0)
        .slice(0, 5)
        .map(a => `${a.objectName}: ${a.flowCount}F ${a.triggerCount}T${a.hasDeprecatedAutomation ? " ⚠" : ""}`),
    ],
  };

  const topTwoPkgs = installedPackages.slice(0, 2).map(p => p.name.replace(/^Salesforce\s+/i, ""));
  const packagesCell: Cell = {
    title: "PACKAGES",
    value: installedPackages.length === 0 ? "None" : `${installedPackages.length} installed`,
    sub: topTwoPkgs.join(", ") || "—",
    status: "ok",
    detail: installedPackages.length > 0
      ? installedPackages.map(p => `${p.name}${p.version ? ` v${p.version}` : ""}${p.namespace ? ` (${p.namespace})` : ""}`)
      : ["No managed packages installed"],
  };

  const cells: Cell[] = [accountsCell, storageCell, automationCell, packagesCell];

  const statusColor = { ok: "#0fba7a", warn: "#f0a020", critical: "#e84040" };

  return (
    <div style={{
      background: "#0f1420",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 8,
      marginBottom: 12,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "8px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: 1.2, color: "#7B8DB0", textTransform: "uppercase" }}>
          ORG HEALTH SNAPSHOT
        </span>
        <span style={{ fontSize: 10, color: "#4a5568" }}>·</span>
        <span style={{ fontSize: 10, color: "#4a5568", fontFamily: "monospace" }}>
          {orgContext.orgProfile.orgName}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        {cells.map((cell, idx) => {
          const isExpanded = expandedCell === cell.title;
          const color = statusColor[cell.status];
          return (
            <button
              key={cell.title}
              onClick={() => setExpandedCell(isExpanded ? null : cell.title)}
              style={{
                display: "block", textAlign: "left", padding: "10px 14px",
                background: isExpanded ? "rgba(255,255,255,0.03)" : "transparent",
                cursor: "pointer",
                border: "none",
                borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.05)" : "none",
                borderBottom: isExpanded ? `2px solid ${color}` : "2px solid transparent",
              }}
            >
              <div style={{ fontFamily: "monospace", fontSize: 9, letterSpacing: 1.1, color: "#7B8DB0", marginBottom: 4, textTransform: "uppercase" }}>
                {cell.title}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 14, color: "#F0F4FF", fontWeight: 700, marginBottom: 2 }}>
                {cell.value}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 10, color }}>
                {cell.sub}
              </div>
            </button>
          );
        })}
      </div>

      {expandedCell && (() => {
        const cell = cells.find(c => c.title === expandedCell)!;
        const color = statusColor[cell.status];
        return (
          <div style={{ padding: "10px 14px", background: "rgba(0,0,0,0.2)", borderTop: `1px solid ${color}22` }}>
            {cell.detail.map((line, i) => (
              <div key={i} style={{ fontFamily: "monospace", fontSize: 11, color: "#8a9ab8", marginBottom: 3, display: "flex", gap: 8 }}>
                <span style={{ color: `${color}66`, flexShrink: 0 }}>›</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Sharing Model Row ─────────────────────────────────────────────── */}
      {sharingModels.length > 0 && (() => {
        const accountOwd = sharingModels.find(s => s.objectName === "Account")?.owd;
        const contactOwd = sharingModels.find(s => s.objectName === "Contact")?.owd;
        const apexCount  = sharingModels.filter(s => s.hasApexSharing).length;
        const allToShow  = sharingExpanded ? sharingModels : sharingModels.slice(0, 6);
        return (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <button
              onClick={() => setSharingExpanded(v => !v)}
              style={{
                width: "100%", textAlign: "left", padding: "8px 14px",
                background: "transparent", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 12,
              }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 9, letterSpacing: 1.1, color: "#7B8DB0", textTransform: "uppercase", flexShrink: 0 }}>
                Sharing Model
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#8a9ab8" }}>
                {accountOwd && `Account: ${accountOwd}`}
                {accountOwd && contactOwd && "  ·  "}
                {contactOwd && `Contact: ${contactOwd}`}
                {apexCount > 0 && `  ·  ${apexCount} Apex-managed`}
              </span>
              <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 10, color: "#4a5568" }}>
                {sharingExpanded ? "▴" : "▾"}
              </span>
            </button>
            {sharingExpanded && (
              <div style={{ padding: "0 14px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
                {allToShow.map(s => (
                  <div key={s.objectName} style={{ display: "flex", gap: 10, fontFamily: "monospace", fontSize: 11 }}>
                    <span style={{ color: "#7B8DB0", width: 180, flexShrink: 0 }}>{s.objectName}</span>
                    <span style={{ color: "#8a9ab8" }}>
                      OWD: {s.owd}
                      {s.hasApexSharing && <span style={{ color: "#f0a020", marginLeft: 8 }}>Apex sharing</span>}
                      {s.sharingRulesCount > 0 && <span style={{ color: "#7B8DB0", marginLeft: 8 }}>{s.sharingRulesCount} rules</span>}
                    </span>
                  </div>
                ))}
                {!sharingExpanded && sharingModels.length > 6 && (
                  <span style={{ fontFamily: "monospace", fontSize: 10, color: "#4a5568" }}>
                    +{sharingModels.length - 6} more
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ padding: "5px 14px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: "#4a5568" }}>
          Agents will use this data to contextualise their reviews · Click any cell to see detail
        </span>
      </div>
    </div>
  );
}
