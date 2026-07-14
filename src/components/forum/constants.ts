import { MODEL_PRICING } from "@/lib/pricing";
import type { ModelId } from "./types";

export const MODEL_CONFIG: Record<ModelId, {
  label: string; icon: string;
  inputPer1K: number; outputPer1K: number; cacheReadPer1K: number; cacheWritePer1K: number;
  description: string;
}> = {
  "claude-haiku-4-5-20251001": {
    label: "claude-haiku-4-5", icon: "⚡",
    ...MODEL_PRICING["claude-haiku-4-5-20251001"],
    description: "Fast · Cost-efficient · Good for most reviews",
  },
  "claude-sonnet-4-6": {
    label: "claude-sonnet-4-6", icon: "🧠",
    ...MODEL_PRICING["claude-sonnet-4-6"],
    description: "Balanced · Recommended for complex projects",
  },
  "claude-opus-4-8": {
    label: "claude-opus-4-8", icon: "🚀",
    ...MODEL_PRICING["claude-opus-4-8"],
    description: "Maximum depth · Best for high-stakes reviews",
  },
};

export const ALL_AGENT_IDS = [
  "sf-designer", "sf-lwc", "sf-omni", "sf-flow",
  "sf-apex", "sf-patterns", "sf-integration", "sf-judge", "sf-scribe", "sf-learner",
];

export const AGENT_META: Record<string, {
  icon: string; color: string; badge: string; estSeconds: number; shortName: string;
}> = {
  "sf-designer":   { icon: "🎨", color: "#00c8f0", badge: "SOLUTION ARCH",  estSeconds: 45, shortName: "Designer"   },
  "sf-lwc":        { icon: "⚡", color: "#00c8f0", badge: "UI SPECIALIST",   estSeconds: 28, shortName: "LWC"        },
  "sf-omni":       { icon: "🔮", color: "#9f70f5", badge: "OMNI EXPERT",     estSeconds: 32, shortName: "OmniStudio" },
  "sf-flow":       { icon: "🔄", color: "#f0a020", badge: "FLOW BUILDER",    estSeconds: 35, shortName: "Flow"       },
  "sf-apex":       { icon: "⚙️",  color: "#e84040", badge: "APEX EXPERT",    estSeconds: 40, shortName: "Apex"       },
  "sf-patterns":    { icon: "📐", color: "#0fba7a", badge: "PATTERNS",        estSeconds: 35, shortName: "Patterns"    },
  "sf-integration": { icon: "🔗", color: "#00c8f0", badge: "INTEGRATION",     estSeconds: 40, shortName: "Integration" },
  "sf-judge":       { icon: "⚖️",  color: "#f0a020", badge: "JUDGE",          estSeconds: 45, shortName: "Judge"       },
  "sf-scribe":     { icon: "📝", color: "#7B8DB0", badge: "SCRIBE",          estSeconds: 20, shortName: "Scribe"     },
  "sf-learner":    { icon: "🎓", color: "#9f70f5", badge: "LEARNER",         estSeconds: 18, shortName: "Learner"    },
};

export const RISK_SEVERITY_COLOR: Record<string, string> = {
  critical: "#e84040", high: "#e84040", medium: "#f0a020", low: "#0fba7a",
};

export const PRIORITY_STYLE: Record<string, { bg: string; text: string }> = {
  required:    { bg: "rgba(232,64,64,0.12)",   text: "#e84040" },
  recommended: { bg: "rgba(240,160,32,0.12)",  text: "#f0a020" },
  optional:    { bg: "rgba(90,106,138,0.12)",  text: "#7B8DB0" },
};

export const FORMAT_LABELS: Record<string, string> = {
  pdf: "PDF", docx: "DOCX", txt: "TXT", md: "MD", html: "HTML",
};

export const DEFAULT_INPUT =
  "NovaPeak Financial Services requires migration of core banking workflows to Salesforce Financial Services Cloud, with a self-service client portal on Experience Cloud for B2C customers to view real-time transaction data, submit service cases, and receive Einstein Bot-assisted case deflection. The portal integrates with NovaPeak's core banking system via MuleSoft Anypoint Platform. Transaction data must be scoped to the authenticated client's account only and comply with APRA-CPS234. Einstein Bots should handle initial case triage and deflect common queries before routing to human agents. The solution must support 50,000 active portal users and up to 10 million transaction records within 24 months of launch.";

export const ACCEPTED = ".pdf,.doc,.docx";

export const ALWAYS_ON_IDS = new Set(["sf-judge", "sf-scribe", "sf-learner"]);

export const CLOSING_AGENT_IDS = new Set(["sf-judge", "sf-scribe", "sf-learner"]);

export const ARCHITECT_ROLES = [
  "Lead Architect",
  "Solution Architect",
  "Technical Lead",
  "Client Architecture Lead",
] as const;
