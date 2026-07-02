# CLAUDE CODE PROMPT — paste this verbatim into Claude Code

I need to add ACC New Zealand client context to ARBoard so the agents are aware of ACC's Salesforce landscape, data requirements, and regulatory context during every forum session.

## Step 1 — install Supabase client (needed later, install now)

```
npm install @supabase/supabase-js
```

## Step 2 — create these files exactly as shown below

---

### lib/clients/types.ts

```typescript
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
```

---

### lib/clients/index.ts

```typescript
import type { ClientConfig, AgentPromptOverride } from './types';

const configCache: Record<string, ClientConfig> = {};

export async function getClientConfig(): Promise<ClientConfig> {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) throw new Error('CLIENT_ID env var is not set');
  if (configCache[clientId]) return configCache[clientId];
  try {
    const mod = await import(`./${clientId}/config`);
    configCache[clientId] = mod.default as ClientConfig;
    return configCache[clientId];
  } catch {
    throw new Error(`No client config found for CLIENT_ID="${clientId}". Expected: lib/clients/${clientId}/config.ts`);
  }
}

export async function getClientAgentOverrides(clientId: string): Promise<AgentPromptOverride[]> {
  try {
    const mod = await import(`./${clientId}/agent-overrides`);
    return mod.default ?? [];
  } catch {
    return [];
  }
}
```

---

### lib/clients/acc-nz/config.ts

```typescript
import type { ClientConfig } from '../types';

const config: ClientConfig = {
  clientId: 'acc-nz',
  name: 'ACC New Zealand',
  industry: 'Public Sector — Accident Compensation',
  salesforceClouds: [
    'Service Cloud',
    'Experience Cloud',
    'Health Cloud',
    'OmniStudio',
    'Agentforce',
  ],
  regulatoryOverlays: ['GDPR'],
  dataRegion: 'ap-southeast-2',
  knowledgeBaseId: 'acc-nz',
  monthlyBudgetUSD: 200,
  budgetAlertPct: 80,
  zeroRetention: false,
};

export default config;
```

---

### lib/clients/acc-nz/agent-overrides.ts

```typescript
import type { AgentPromptOverride } from '../types';

const overrides: AgentPromptOverride[] = [
  {
    agentId: 'designer',
    sections: {
      extra: `ACC New Zealand context:
- ACC is a NZ Crown entity managing accident compensation for all NZ residents
- Core platform: Service Cloud for claims management, Experience Cloud for claimant self-service portal, Health Cloud for injury and treatment tracking, OmniStudio for guided claim lodgement flows
- All designs must consider high-volume claim processing (ACC handles ~2M claims/year)
- Claimant data is highly sensitive — injury details, medical records, employment information
- Accessibility is mandatory: NZ government digital standards require WCAG 2.1 AA minimum
- Integration landscape: NZ Ministry of Health, NZ Police, employer payroll systems, medical providers
- Flag any design that stores sensitive health data outside ap-southeast-2 region as a MUST-FIX`,
    },
  },
  {
    agentId: 'apex',
    sections: {
      extra: `ACC-specific Apex guardrails:
- Claim records are high-volume — always design for bulk processing, never query inside loops
- Any Apex touching claimant health data must have explicit field-level security checks
- Async processing (Queueable, Batch) preferred for claim status updates
- Flag any synchronous processing of bulk claim updates as a MUST-FIX`,
    },
  },
  {
    agentId: 'data',
    sections: {
      extra: `ACC data model context:
- Core objects: Claim (custom or Case), Claimant (Person Account), Injury, Treatment, Payment, Provider
- NZ Privacy Act 2020 applies to all personal and health data
- Data must not leave ap-southeast-2 region — flag any cross-region data flow as a MUST-FIX
- Retention: claim data retained 10 years minimum per ACC Act
- Field-level encryption required on: NHI number, bank account details, medical diagnosis codes`,
    },
  },
  {
    agentId: 'integration',
    sections: {
      extra: `ACC integration landscape:
- NZ Ministry of Health: HL7 FHIR R4 for health provider data exchange
- NZ Inland Revenue: employer levy data via secure SFTP
- Medical providers: bulk claim submissions via REST API with OAuth 2.0
- All external integrations must use Named Credentials — no hardcoded endpoints
- mTLS required for Ministry of Health and IRD connections — flag anything less as a MUST-FIX`,
    },
  },
  {
    agentId: 'judge',
    sections: {
      extra: `For ACC New Zealand, automatically escalate to MUST-FIX for:
- Health or personal data stored outside ap-southeast-2
- Missing WCAG 2.1 AA accessibility on any claimant-facing component
- Synchronous bulk processing of claim records
- Hardcoded credentials or endpoints in integration designs
- Missing field-level security on NHI numbers, bank details, or medical diagnosis fields`,
    },
  },
];

export default overrides;
```

---

### lib/middleware/injectClientContext.ts

```typescript
import { getClientConfig, getClientAgentOverrides } from '../clients';
import type { AgentPromptOverride } from '../clients/types';

interface MiddlewareInput {
  agentId: string;
  systemPrompt: string;
}

export async function injectClientContext(input: MiddlewareInput): Promise<MiddlewareInput> {
  const config = await getClientConfig();
  const overrides: AgentPromptOverride[] = await getClientAgentOverrides(config.clientId);

  const contextPrefix = [
    `== CLIENT CONTEXT ==`,
    `Client: ${config.name} (${config.industry})`,
    `Salesforce clouds in scope: ${config.salesforceClouds.join(', ')}`,
    config.regulatoryOverlays.length > 0
      ? `Regulatory overlays: ${config.regulatoryOverlays.join(', ')}. All recommendations must comply. Flag compliance risks as MUST-FIX.`
      : '',
    `== END CLIENT CONTEXT ==`,
  ].filter(Boolean).join('\n');

  const override = overrides.find(o => o.agentId === input.agentId);
  const overrideSuffix = override
    ? Object.entries(override.sections)
        .filter(([, v]) => v)
        .map(([k, v]) => `== CLIENT OVERRIDE: ${k.toUpperCase()} ==\n${v}`)
        .join('\n\n')
    : '';

  return {
    ...input,
    systemPrompt: [contextPrefix, input.systemPrompt, overrideSuffix].filter(Boolean).join('\n\n'),
  };
}
```

---

## Step 3 — wire injectClientContext into the agent runner

Find the file where agent system prompts are assembled and sent to the Anthropic API (likely `lib/agents/runner.ts`, `lib/orchestrator/forum.ts`, or similar). 

Find the line that looks like:
```typescript
messages: [{ role: 'user', content: ... }],
system: agent.systemPrompt,   // or however the system prompt is passed
```

Replace it with:
```typescript
import { injectClientContext } from '../middleware/injectClientContext';

const enriched = await injectClientContext({
  agentId: agent.id,
  systemPrompt: agent.systemPrompt,  // or however it's currently named
});

// then use enriched.systemPrompt instead of agent.systemPrompt
```

Show me the relevant file first before making changes so I can confirm the right insertion point.

## Step 4 — add CLIENT_ID to .env.local

Add this line to .env.local:
```
CLIENT_ID=acc-nz
```

## Step 5 — verify

Run `npm run dev` — confirm it starts cleanly.
Then run a test forum session and confirm the agent outputs mention ACC, Health Cloud, or NZ-specific context in their responses.
