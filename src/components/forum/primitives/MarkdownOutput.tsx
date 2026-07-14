"use client";

import React from "react";

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} style={{ color: "#F0F4FF", fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`"))
      return <code key={i} style={{ fontFamily: "monospace", fontSize: 11, background: "rgba(255,255,255,0.08)", padding: "1px 5px", borderRadius: 3, color: "#00c8f0" }}>{p.slice(1, -1)}</code>;
    return p;
  });
}

function renderTable(rows: string[]): React.ReactNode {
  const dataRows = rows.filter(r => !/^\|[-:\s|]+\|$/.test(r));
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, margin: "8px 0 12px" }}>
      <tbody>
        {dataRows.map((row, ri) => {
          const cells = row.split("|").slice(1, -1);
          return (
            <tr key={ri}>
              {cells.map((cell, ci) =>
                ri === 0
                  ? <th key={ci} style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid rgba(0,200,240,0.3)", color: "#00c8f0", fontFamily: "monospace", fontWeight: 700 }}>{cell.trim()}</th>
                  : <td key={ci} style={{ padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.04)", color: "#c8d8f0" }}>{renderInline(cell.trim())}</td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function MarkdownOutput({ content }: { content: string }) {
  const segments = content.split(/(```[\s\S]*?```)/);
  return (
    <div style={{ fontSize: 13, color: "#F0F4FF", lineHeight: 1.7, overflowWrap: "break-word", wordBreak: "break-word" }}>
      {segments.map((seg, si) => {
        if (seg.startsWith("```")) {
          const match = seg.match(/^```\w*\n?([\s\S]*?)```$/);
          return (
            <pre key={si} style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "10px 14px", fontFamily: "monospace", fontSize: 11, color: "#a8d8ea", overflowX: "auto", margin: "8px 0" }}>
              <code>{(match?.[1] ?? seg.slice(3, -3)).trim()}</code>
            </pre>
          );
        }
        const lines = seg.split("\n");
        const out: React.ReactNode[] = [];
        let i = 0;
        while (i < lines.length) {
          const line = lines[i];
          if (line.startsWith("| ")) {
            const tableLines: string[] = [];
            while (i < lines.length && lines[i].startsWith("|")) { tableLines.push(lines[i]); i++; }
            out.push(<React.Fragment key={`t${i}`}>{renderTable(tableLines)}</React.Fragment>);
            continue;
          }
          if (line.startsWith("## ")) {
            out.push(<div key={i} style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#00c8f0", letterSpacing: 1, marginTop: 16, marginBottom: 6, borderBottom: "1px solid rgba(0,200,240,0.2)", paddingBottom: 4 }}>{line.slice(3).toUpperCase()}</div>);
          } else if (line.startsWith("### ")) {
            out.push(<div key={i} style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#7ec8e3", marginTop: 10, marginBottom: 4 }}>{renderInline(line.slice(4))}</div>);
          } else if (line.startsWith("# ")) {
            out.push(<div key={i} style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#00c8f0", marginBottom: 8 }}>{renderInline(line.slice(2))}</div>);
          } else if (/^\d+\./.test(line.trim())) {
            out.push(<div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}><span style={{ color: "#00c8f0", fontFamily: "monospace", fontSize: 12, flexShrink: 0 }}>{line.match(/^(\d+\.)/)?.[1]}</span><span>{renderInline(line.replace(/^\d+\.\s*/, ""))}</span></div>);
          } else if (line.startsWith("- ") || line.startsWith("* ")) {
            out.push(<div key={i} style={{ display: "flex", gap: 8, marginBottom: 3 }}><span style={{ color: "#00c8f044" }}>›</span><span>{renderInline(line.slice(2))}</span></div>);
          } else if (line.trim()) {
            out.push(<p key={i} style={{ margin: "0 0 4px" }}>{renderInline(line)}</p>);
          } else {
            out.push(<div key={i} style={{ height: 6 }} />);
          }
          i++;
        }
        return <React.Fragment key={si}>{out}</React.Fragment>;
      })}
    </div>
  );
}
