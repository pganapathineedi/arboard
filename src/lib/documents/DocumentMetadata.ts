export interface DocumentMetadata {
  title: string;
  wordCount: number;
  sfComponents: string[];
  sfClouds: string[];
  complianceTerms: string[];
  integrations: string[];
}

const SF_COMPONENTS = [
  "LWC", "Lightning Web Component", "Aura", "Visualforce",
  "Apex", "Trigger", "Batch", "Queueable",
  "Flow", "Record-Triggered Flow", "Screen Flow", "Scheduled Flow",
  "OmniStudio", "OmniScript", "DataRaptor", "FlexCard", "Integration Procedure",
  "Einstein Bot", "Einstein", "Copilot",
  "Platform Event", "Change Data Capture", "Streaming API",
  "SOQL", "SOSL",
  "Community", "Experience Builder",
  "Tableau CRM", "CRM Analytics",
];

const SF_CLOUDS = [
  "Sales Cloud", "Service Cloud", "Experience Cloud", "Marketing Cloud",
  "Commerce Cloud", "Health Cloud", "Financial Services Cloud",
  "Manufacturing Cloud", "Education Cloud", "Nonprofit Cloud",
  "Revenue Cloud", "Net Zero Cloud", "Government Cloud",
];

const COMPLIANCE_TERMS = [
  "GDPR", "HIPAA", "APRA", "SOC 2", "SOC2",
  "ISO 27001", "PCI DSS", "CCPA", "FERPA", "FINRA",
  "FedRAMP", "NIST", "IRAP", "CPS 234",
];

const INTEGRATIONS = [
  "SAP", "MuleSoft", "Jira", "ServiceNow", "Workday",
  "Azure", "AWS", "Google Cloud",
  "Slack", "Teams", "DocuSign", "Twilio",
  "Stripe", "PayPal", "Informatica", "Boomi", "Tibco",
  "Heroku", "Tableau", "Snowflake",
];

function detect(terms: string[], text: string): string[] {
  return terms.filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

export function extractMetadata(text: string, filename: string): DocumentMetadata {
  const words = text.split(/\s+/).filter(Boolean);

  // Best-effort title: first non-trivial line, capped at 120 chars
  const firstLine = text
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 5);
  const title = (firstLine ?? filename).slice(0, 120);

  return {
    title,
    wordCount: words.length,
    sfComponents: detect(SF_COMPONENTS, text),
    sfClouds:     detect(SF_CLOUDS, text),
    complianceTerms: detect(COMPLIANCE_TERMS, text),
    integrations: detect(INTEGRATIONS, text),
  };
}
