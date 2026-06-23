export type SalesforceCloud =
  | 'Sales Cloud'
  | 'Service Cloud'
  | 'Experience Cloud'
  | 'Marketing Cloud'
  | 'Data Cloud'
  | 'Commerce Cloud'
  | 'Financial Services Cloud'
  | 'Health Cloud'
  | 'Manufacturing Cloud'
  | 'OmniStudio'
  | 'Revenue Cloud'
  | 'Agentforce';

export type RegulatoryOverlay = 'HIPAA' | 'FSC' | 'GDPR' | 'APRA-CPS234' | 'SOX' | 'PCI-DSS' | 'CCPA';
export type DataRegion = 'us-east-1' | 'eu-west-1' | 'ap-southeast-2' | 'us-west-2';
export type UserRole = 'admin' | 'reviewer' | 'readonly';

export interface JiraConfig {
  enabled: boolean;
  projectKey: string;  // overrides JIRA_PROJECT_KEY env var if set
  epicKey?: string;    // optional — links ADR issues to a specific epic
}

export interface ClientConfig {
  clientId: string;
  name: string;
  industry: string;
  salesforceClouds: SalesforceCloud[];
  regulatoryOverlays: RegulatoryOverlay[];
  dataRegion: DataRegion;
  knowledgeBaseId: string;
  monthlyBudgetUSD: number;
  budgetAlertPct: number;
  alertWebhookUrl?: string;
  zeroRetention: boolean;
  agentOverridesPath?: string;
  jiraConfig?: JiraConfig;
}

export interface AgentPromptOverride {
  agentId: string;
  sections: Partial<{
    persona: string;
    expertise: string;
    guardrails: string;
    format: string;
    extra: string;
  }>;
}
