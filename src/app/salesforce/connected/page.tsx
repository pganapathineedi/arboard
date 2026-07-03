"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function ConnectedContent() {
  const params = useSearchParams();
  const error = params.get("error");
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (error) return;
    if (typeof window !== "undefined" && window.opener) {
      window.opener.postMessage({ type: "sf-connected" }, "*");
      setTimeout(() => { window.close(); setClosed(true); }, 800);
    }
  }, [error]);

  if (error) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#07090f", color: "#F0F4FF", fontFamily: "monospace", flexDirection: "column", gap: 12 }}>
        <span style={{ fontSize: 32, color: "#e84040" }}>✕</span>
        <span style={{ fontSize: 14 }}>Connection failed</span>
        <span style={{ fontSize: 12, color: "#7B8DB0", maxWidth: 320, textAlign: "center" }}>
          {decodeURIComponent(error)}
        </span>
        <button onClick={() => window.close()} style={{ marginTop: 8, padding: "6px 16px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, color: "#7B8DB0", cursor: "pointer", fontSize: 12 }}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#07090f", color: "#F0F4FF", fontFamily: "monospace", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 32, color: "#0fba7a" }}>✓</span>
      <span style={{ fontSize: 14 }}>Connected to Salesforce</span>
      <span style={{ fontSize: 12, color: "#7B8DB0" }}>
        {closed ? "You can close this window" : "Closing…"}
      </span>
    </div>
  );
}

export default function SalesforceConnected() {
  return (
    <Suspense>
      <ConnectedContent />
    </Suspense>
  );
}
