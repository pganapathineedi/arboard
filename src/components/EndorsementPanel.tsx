"use client";

import { useState, useEffect } from "react";
import type { JiraMember } from "@/lib/integrations/jira";

const ARCHITECT_ROLES = [
  "Lead Architect",
  "Solution Architect",
  "Technical Lead",
  "Client Architecture Lead",
] as const;

const S = {
  card: {
    background: "#0f1420",
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
};

interface EndorsementPanelProps {
  sessionId:            string;
  confidence:           string;
  verdictSummary:       string;
  humanJudgementPoints: string[];
  adrContent:           string;
  requirement:          string;
  verdict:              string;
  scribeNotes:          string;
  mustFixIssues:        string[];
  revisionRound?:       number;
  onEndorsed: (jiraKey: string, jiraUrl: string) => void;
}

export function EndorsementPanel({
  sessionId, confidence, humanJudgementPoints,
  requirement, verdict, scribeNotes, mustFixIssues,
  revisionRound,
  onEndorsed,
}: EndorsementPanelProps) {
  const [members, setMembers]                 = useState<JiraMember[]>([]);
  const [membersLoading, setMembersLoading]   = useState(true);
  const [action, setAction]                   = useState<"countersign" | "assign">(
    confidence === "High" ? "countersign" : "assign"
  );
  const [assigneeAccountId, setAssigneeAccountId] = useState("");
  const [architectName, setArchitectName]         = useState("");
  const [architectRole, setArchitectRole]         = useState<string>(ARCHITECT_ROLES[0]);
  const [submitting, setSubmitting]               = useState(false);
  const [error, setError]                         = useState<string | null>(null);
  const [jiraKey, setJiraKey]                     = useState<string | null>(null);
  const [jiraUrl, setJiraUrl]                     = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/jira/members")
      .then(r => r.json())
      .then((data: JiraMember[]) => setMembers(data))
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false));
  }, []);

  const confidenceConfig = (() => {
    const c = confidence.toLowerCase();
    if (c.includes("high"))   return { bg: "rgba(15,186,122,0.12)",  color: "#0fba7a", border: "rgba(15,186,122,0.35)",  label: "High Confidence"        };
    if (c.includes("medium")) return { bg: "rgba(240,160,32,0.12)",  color: "#f0a020", border: "rgba(240,160,32,0.35)",  label: "Medium Confidence"      };
    return                           { bg: "rgba(232,64,64,0.12)",   color: "#e84040", border: "rgba(232,64,64,0.35)",   label: "Needs Human Review"     };
  })();

  const canCountersign = confidence === "High";

  const handleSubmit = async () => {
    if (submitting) return;
    if (action === "countersign" && !architectName.trim()) return;
    if (action === "assign" && !assigneeAccountId) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/forum/endorse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          endorsementType:      action === "countersign" ? "countersigned" : "assigned_for_review",
          assigneeAccountId:    action === "assign" ? assigneeAccountId : undefined,
          architectName:        action === "countersign" ? architectName.trim() : undefined,
          architectRole:        action === "countersign" ? architectRole : undefined,
          humanJudgementPoints,
          requirement,
          verdict,
          scribeNotes,
          mustFixIssues,
          revisionRound,
        }),
      });
      const data = await res.json() as { jiraKey?: string; jiraUrl?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Endorsement failed");
      setJiraKey(data.jiraKey ?? null);
      setJiraUrl(data.jiraUrl ?? null);
      if (data.jiraKey && data.jiraUrl) onEndorsed(data.jiraKey, data.jiraUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Endorsement failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (jiraKey && jiraUrl) {
    return (
      <div style={{
        ...S.card,
        border: "1px solid rgba(15,186,122,0.35)",
        padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{ color: "#0fba7a", fontSize: 18 }}>✓</span>
        <div>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "#0fba7a", fontWeight: 700, marginBottom: 2 }}>
            {revisionRound && revisionRound >= 1 ? "Jira ticket updated" : "Jira ticket created"}
          </div>
          <a
            href={jiraUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: "monospace", fontSize: 12, color: "#0fba7a", textDecoration: "underline", textUnderlineOffset: 2 }}
          >
            {jiraKey}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...S.card, padding: "20px 24px" }}>
      {/* Confidence badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ ...S.label, fontSize: 11 }}>Endorsement Decision</span>
        <span style={{
          fontFamily: "monospace", fontSize: 12, padding: "4px 12px", borderRadius: 20,
          background: confidenceConfig.bg, color: confidenceConfig.color,
          border: `1px solid ${confidenceConfig.border}`, fontWeight: 700,
        }}>
          {confidence === "High" ? "✓" : "⚠"} {confidenceConfig.label}
        </span>
      </div>

      {/* Human judgement points summary */}
      {humanJudgementPoints.length > 0 && (
        <div style={{
          padding: "10px 14px", borderRadius: 6, marginBottom: 16,
          background: "rgba(240,160,32,0.05)", borderLeft: "3px solid #f0a020",
        }}>
          <div style={{ ...S.label, marginBottom: 6, color: "#f0a020" }}>Points Requiring Human Judgement</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {humanJudgementPoints.map((pt, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: "#F0F4FF" }}>
                <span style={{ color: "#f0a020", flexShrink: 0 }}>›</span>
                {pt}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action selector — only for High confidence */}
      {canCountersign ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["countersign", "assign"] as const).map(opt => (
            <button
              key={opt}
              onClick={() => setAction(opt)}
              style={{
                padding: "7px 16px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                fontFamily: "monospace",
                background: action === opt ? "rgba(159,112,245,0.15)" : "transparent",
                border: action === opt ? "1px solid rgba(159,112,245,0.5)" : "1px solid rgba(255,255,255,0.1)",
                color: action === opt ? "#9f70f5" : "#7B8DB0",
                transition: "all 0.2s",
              }}
            >
              {opt === "countersign" ? "Countersign this recommendation" : "Assign to architect for review"}
            </button>
          ))}
        </div>
      ) : (
        <div style={{
          padding: "8px 14px", borderRadius: 6, marginBottom: 16,
          background: "rgba(232,64,64,0.06)", border: "1px solid rgba(232,64,64,0.2)",
          fontFamily: "monospace", fontSize: 12, color: "#e84040",
        }}>
          This recommendation requires human review — assignment only
        </div>
      )}

      {/* Countersign fields */}
      {action === "countersign" && canCountersign && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ ...S.label, fontSize: 9 }}>Architect Name</span>
            <input
              type="text"
              value={architectName}
              onChange={e => setArchitectName(e.target.value)}
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
              value={architectRole}
              onChange={e => setArchitectRole(e.target.value)}
              style={{
                background: "#0f1420", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6, padding: "7px 12px", fontSize: 12, color: "#F0F4FF",
                fontFamily: "system-ui, sans-serif", outline: "none", cursor: "pointer",
                appearance: "auto",
              }}
            >
              {ARCHITECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Assignee picker */}
      {action === "assign" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
          <span style={{ ...S.label, fontSize: 9 }}>Assign to</span>
          {membersLoading ? (
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "#7B8DB0" }}>Loading Jira members…</span>
          ) : members.length === 0 ? (
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "#7B8DB0" }}>No Jira members available</span>
          ) : (
            <select
              value={assigneeAccountId}
              onChange={e => setAssigneeAccountId(e.target.value)}
              style={{
                background: "#0f1420", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6, padding: "7px 12px", fontSize: 12, color: "#F0F4FF",
                fontFamily: "system-ui, sans-serif", outline: "none", cursor: "pointer",
                appearance: "auto", maxWidth: 320,
              }}
            >
              <option value="">— select assignee —</option>
              {members.map(m => (
                <option key={m.accountId} value={m.accountId}>{m.displayName}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && (
        <div style={{ fontFamily: "monospace", fontSize: 12, color: "#e84040", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={
          submitting ||
          (action === "countersign" && !architectName.trim()) ||
          (action === "assign" && !assigneeAccountId)
        }
        style={{
          padding: "9px 22px",
          background: submitting ? "rgba(0,200,240,0.3)" : "#00c8f0",
          color: "#07090f", fontWeight: 700, fontSize: 13, borderRadius: 7,
          border: "none",
          cursor: submitting ? "not-allowed" : "pointer",
          opacity: (
            submitting ||
            (action === "countersign" && !architectName.trim()) ||
            (action === "assign" && !assigneeAccountId)
          ) ? 0.45 : 1,
          transition: "opacity 0.2s",
        }}
      >
        {submitting ? "Creating Jira Ticket…" : "Finalise & Create Jira Ticket"}
      </button>
    </div>
  );
}
