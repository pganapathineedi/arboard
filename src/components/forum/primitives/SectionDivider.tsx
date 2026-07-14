"use client";

import React from "react";
import { S } from "../styles";

export function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px" }}>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
      <span style={{ ...S.label, fontSize: 11, color: "#7B8DB0" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}
