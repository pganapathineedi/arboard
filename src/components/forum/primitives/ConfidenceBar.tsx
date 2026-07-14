"use client";

import React from "react";

export function ConfidenceBar({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const color = value >= 80 ? "#0fba7a" : value >= 50 ? "#f0a020" : "#e84040";
  const h = size === "sm" ? 3 : 4;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: h, background: "rgba(255,255,255,0.06)", borderRadius: h }}>
        <div style={{
          height: "100%", width: `${value}%`,
          background: color, borderRadius: h,
          transition: "width 0.6s ease",
        }} />
      </div>
      <span style={{ fontFamily: "monospace", fontSize: 10, color, minWidth: 28 }}>
        {value}/100
      </span>
    </div>
  );
}
