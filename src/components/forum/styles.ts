import type React from "react";

export const S = {
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
    color: "#7B8DB0",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  mono: {
    fontFamily: "monospace",
  } as React.CSSProperties,
};
