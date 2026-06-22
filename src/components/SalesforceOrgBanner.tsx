"use client";

import type { OrgContext, LimitsSnapshot } from "@/lib/types/salesforce";

interface OrgInfo {
  orgName: string;
  edition: string;
  isSandbox: boolean;
}

interface Props {
  status: "disconnected" | "connecting" | "connected";
  orgInfo: OrgInfo | null;
  orgContext: OrgContext | null;
  lastSyncTime: Date | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatSyncTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

function hasWarnings(limits: LimitsSnapshot | undefined): boolean {
  if (!limits) return false;
  if (limits.dataStorageMBTotal > 0 && limits.dataStorageMBUsed / limits.dataStorageMBTotal >= 0.85) return true;
  if (limits.dailyApiCallsTotal > 0 && limits.dailyApiCallsUsed / limits.dataStorageMBTotal >= 0.8) return true;
  return false;
}

const S = {
  banner: {
    borderRadius: 8,
    padding: "10px 14px",
    marginBottom: 12,
    fontFamily: "monospace",
    fontSize: 12,
  } as React.CSSProperties,
  label: {
    fontFamily: "monospace",
    fontSize: 10,
    letterSpacing: 1.2,
    color: "#7B8DB0",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
};

export function SalesforceOrgBanner({ status, orgInfo, orgContext, lastSyncTime, onConnect, onDisconnect, onRefresh, refreshing }: Props) {
  const warnings = hasWarnings(orgContext?.limitsSnapshot);

  if (status === "disconnected") {
    return (
      <div style={{
        ...S.banner,
        background: "#0f1420",
        border: "1px solid rgba(255,255,255,0.07)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, opacity: 0.5 }}>⬡</span>
          <div>
            <span style={{ color: "#7B8DB0" }}>No Salesforce org connected</span>
            <div style={{ fontSize: 10, color: "#4a5568", marginTop: 2 }}>
              Agents will use generic SF knowledge
            </div>
          </div>
        </div>
        <button
          onClick={onConnect}
          style={{
            padding: "5px 14px", background: "transparent",
            border: "1px solid rgba(0,200,240,0.3)", borderRadius: 6,
            color: "#00c8f0", fontSize: 11, cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Connect Salesforce Org
        </button>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div style={{
        ...S.banner,
        background: "#0f1420",
        border: "1px solid rgba(0,200,240,0.15)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span className="animate-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#00c8f0", display: "inline-block", flexShrink: 0 }} />
        <span style={{ color: "#7B8DB0" }}>Connecting to Salesforce…</span>
      </div>
    );
  }

  // Connected
  const limits = orgContext?.limitsSnapshot;
  const accountVol = orgContext?.dataVolumes.find(d => d.objectName === "Account");
  const contactVol = orgContext?.dataVolumes.find(d => d.objectName === "Contact");
  const storageWarn = limits && limits.dataStorageMBTotal > 0 && limits.dataStorageMBUsed / limits.dataStorageMBTotal >= 0.85;

  return (
    <div style={{
      ...S.banner,
      background: warnings ? "rgba(240,160,32,0.04)" : "rgba(15,186,122,0.04)",
      border: `1px solid ${warnings ? "rgba(240,160,32,0.25)" : "rgba(15,186,122,0.25)"}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ color: "#0fba7a", fontSize: 12 }}>✓</span>
            <span style={{ color: "#F0F4FF", fontWeight: 700 }}>
              {orgInfo?.orgName ?? "Salesforce Org"}
              {orgInfo?.isSandbox && (
                <span style={{ marginLeft: 6, padding: "1px 5px", borderRadius: 3, fontSize: 9, background: "rgba(240,160,32,0.15)", color: "#f0a020", border: "1px solid rgba(240,160,32,0.3)" }}>
                  SANDBOX
                </span>
              )}
            </span>
            {warnings && (
              <span style={{ fontSize: 10, color: "#f0a020" }}>⚠ warnings</span>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, color: "#7B8DB0", fontSize: 11 }}>
            {orgInfo?.edition && <span>{orgInfo.edition}</span>}
            {limits != null && limits.licensedUsers > 0 && (
              <span>{limits.activeUsers.toLocaleString()} of {limits.licensedUsers.toLocaleString()} users</span>
            )}
            {accountVol && (
              <span style={{ color: accountVol.risk === "HIGH RISK" ? "#e84040" : accountVol.risk === "MEDIUM" ? "#f0a020" : "#7B8DB0" }}>
                {formatCount(accountVol.recordCount)} Accounts
                {accountVol.risk !== "LOW" && ` · ${accountVol.risk}`}
              </span>
            )}
            {contactVol && (
              <span style={{ color: contactVol.risk === "HIGH RISK" ? "#e84040" : contactVol.risk === "MEDIUM" ? "#f0a020" : "#7B8DB0" }}>
                {formatCount(contactVol.recordCount)} Contacts
              </span>
            )}
            {storageWarn && limits && (
              <span style={{ color: "#f0a020" }}>
                Storage {Math.round(limits.dataStorageMBUsed / limits.dataStorageMBTotal * 100)}% used ⚠
              </span>
            )}
            {lastSyncTime && (
              <span>Last sync {formatSyncTime(lastSyncTime)}</span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            style={{
              padding: "4px 10px", background: "transparent",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5,
              color: "#7B8DB0", fontSize: 11, cursor: refreshing ? "not-allowed" : "pointer",
              opacity: refreshing ? 0.5 : 1,
            }}
          >
            {refreshing ? "…" : "Refresh"}
          </button>
          <button
            onClick={onDisconnect}
            style={{
              padding: "4px 10px", background: "transparent",
              border: "1px solid rgba(232,64,64,0.2)", borderRadius: 5,
              color: "#e84040", fontSize: 11, cursor: "pointer",
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
