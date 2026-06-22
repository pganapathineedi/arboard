"use client";

interface Props {
  onClose: () => void;
  onProceed: () => void;
}

const STEPS = [
  {
    num: 1,
    title: "Open Connected App Setup",
    body: "In Salesforce Setup, search for App Manager → click New Connected App",
  },
  {
    num: 2,
    title: "Enable OAuth Settings",
    body: "Check Enable OAuth Settings · Set Callback URL to:\nhttp://localhost:3000/api/salesforce/callback",
  },
  {
    num: 3,
    title: "Add Required Scopes",
    body: "Add these OAuth Scopes:\n· Access the identity URL service (id, profile, email, address, phone)\n· Manage user data via APIs (api)\n· Perform requests at any time (refresh_token, offline_access)",
  },
  {
    num: 4,
    title: "Copy Credentials",
    body: "After saving, copy Consumer Key (Client ID) and Consumer Secret",
  },
  {
    num: 5,
    title: "Add to ARBoard",
    body: "Add to your .env.local file:\nSF_CLIENT_ID=your_consumer_key\nSF_CLIENT_SECRET=your_consumer_secret\nSF_REDIRECT_URI=http://localhost:3000/api/salesforce/callback\nSESSION_SECRET=any-random-32-char-string\n\nThen restart the dev server.",
  },
];

export function ConnectedAppSetupModal({ onClose, onProceed }: Props) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        background: "#0f1420",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 12,
        maxWidth: 540,
        width: "100%",
        overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: "#F0F4FF" }}>
              Salesforce Connected App Setup
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7B8DB0", marginTop: 2 }}>
              One-time setup · Takes ~5 minutes
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#7B8DB0", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}
          >
            ✕
          </button>
        </div>

        {/* Steps */}
        <div style={{ padding: "16px 20px", maxHeight: 420, overflowY: "auto" }}>
          {STEPS.map((step) => (
            <div key={step.num} style={{ display: "flex", gap: 14, marginBottom: 18 }}>
              <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: "rgba(0,200,240,0.12)", border: "1px solid rgba(0,200,240,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#00c8f0" }}>{step.num}</span>
              </div>
              <div>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "#F0F4FF", fontWeight: 700, marginBottom: 4 }}>
                  {step.title}
                </div>
                <div style={{
                  fontFamily: "monospace", fontSize: 11, color: "#7B8DB0", lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                  background: step.body.includes("\n") ? "rgba(255,255,255,0.03)" : "transparent",
                  padding: step.body.includes("\n") ? "8px 10px" : 0,
                  borderRadius: step.body.includes("\n") ? 6 : 0,
                  border: step.body.includes("\n") ? "1px solid rgba(255,255,255,0.05)" : "none",
                }}>
                  {step.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "#0a0e18",
        }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "#4a5568" }}>
            Already configured? Click Connect.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: "6px 14px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#7B8DB0", fontSize: 12, cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={onProceed}
              style={{ padding: "6px 18px", background: "#00c8f0", border: "none", borderRadius: 6, color: "#07090f", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
            >
              Connect Salesforce Org
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
