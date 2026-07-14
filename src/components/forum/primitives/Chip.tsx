"use client";

import React from "react";

export function Chip({ label, color = "#7B8DB0" }: { label: string; color?: string }) {
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
