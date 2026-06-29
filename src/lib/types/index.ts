// ─── Agent Config ────────────────────────────────────────────────────────────
export interface AgentSections {
  persona: string;       // Who the agent is
  expertise: string;     // Domain knowledge and skills
  guardrails: string;    // What the agent must NOT do
  format: string;        // How to structure the output
  extra: string;         // Domain/client-specific overrides
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;          // human-readable role label
  sections: AgentSections;
  model: string;
  maxTokens: number;
  temperature?: number;
  orgContext?: string;   // formatted live org context injected at request time
  memoryBlock?: string | null; // past ADR decisions injected before each session
}

// ─── Domain ──────────────────────────────────────────────────────────────────
export interface DomainConfig {
  id: string;
  name: string;
  baseIndustry?: string; // e.g. "salesforce"
  agents: AgentConfig[];
  complianceRules: string[];
  contextDefaults: Record<string, string>;
}

// ─── Session ─────────────────────────────────────────────────────────────────
export type SessionStatus = "pending" | "running" | "complete" | "failed";

export interface Session {
  id: string;
  domainId: string;
  clientContext: ClientContext;
  input: string;
  results: AgentResult[];
  status: SessionStatus;
  createdAt: Date;
  completedAt?: Date;
}

// ─── Client Context ───────────────────────────────────────────────────────────
export interface ClientContext {
  clientName?: string;
  industry?: string;
  sfOrg?: string;          // Salesforce org type: Developer, Enterprise, Unlimited
  sfEdition?: string;
  existingProducts?: string[];
  constraints?: string[];
  learnings?: string[];    // persisted org-level learnings
  metadata?: Record<string, string>;
}

// ─── Agent Result ─────────────────────────────────────────────────────────────
export interface AgentResult {
  agentId: string;
  agentName: string;
  role: string;
  content: string;
  tokensUsed?: number;
  durationMs?: number;
  error?: string;
}

// ─── Impact Result ────────────────────────────────────────────────────────────
export interface ImpactResult {
  severity: "critical" | "high" | "medium" | "low";
  area: string;
  description: string;
  recommendation: string;
}

// ─── Impact Analysis ──────────────────────────────────────────────────────────
export interface AgentActivation {
  agentId: string;
  agentName: string;
  reason: string;
  sfRisks: string[];
  priority: "required" | "recommended" | "optional";
}

export interface ImpactAnalysis {
  summary: string;
  overallRisk: "critical" | "high" | "medium" | "low";
  estimatedComplexity: "low" | "medium" | "high";
  activatedAgents: AgentActivation[];
  sfConsiderations: string[];
}

// ─── Client Profile ───────────────────────────────────────────────────────────
export interface ClientProfile {
  id: string;
  clientName: string;
  context: ClientContext;
  createdAt: string;
  updatedAt: string;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
export interface MiddlewareContext {
  sessionId: string;
  agentId: string;
  domainId: string;
  input: string;
  clientContext: ClientContext;
  systemPrompt: string;
  metadata: Record<string, unknown>;
  orgContext?: import("@/lib/types/salesforce").OrgContext;
}

export type MiddlewareFn = (
  ctx: MiddlewareContext,
  next: () => Promise<MiddlewareContext>
) => Promise<MiddlewareContext>;

// ─── Forum Request ────────────────────────────────────────────────────────────
export interface ForumRequest {
  input: string;
  domainId?: string;        // defaults to "salesforce"
  clientContext?: ClientContext;
  agentIds?: string[];      // optional subset of agents to run
  modelOverride?: string;   // override agent model (e.g. from UI model selector)
  orgContext?: import("@/lib/types/salesforce").OrgContext;
  orgContextStr?: string;   // formatted live org context string, set server-side from MCP
  revisionRound?: number;   // 1, 2, 3 — which iteration this is
  previousFeedback?: string; // Judge's verdict text from the prior round
  documentContent?: boolean; // true when input came from an uploaded document
  priorTicket?: string | null; // prior ADR ticket key for re-submissions (e.g. ARBOARD-17)
  inputMode?: "review" | "greenfield" | "debate";
  debateFocusAreas?: string;
}

// ─── Document Upload ──────────────────────────────────────────────────────────
export interface DocumentMetadata {
  title: string;
  wordCount: number;
  sfComponents: string[];
  sfClouds: string[];
  complianceTerms: string[];
  integrations: string[];
}

export interface DetectedContext {
  sessionName: string;
  clouds: string[];
  compliance: string[];
  integrations: string[];
}

export interface UploadResult {
  extractedText: string;
  metadata: DocumentMetadata;
  detectedContext: DetectedContext;
  preview: string;        // first 500 chars of extracted text
  wasChunked: boolean;
  filename: string;
  fileSize: number;
  format: string;
}
