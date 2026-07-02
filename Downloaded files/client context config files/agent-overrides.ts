// lib/clients/acc-nz/agent-overrides.ts
import type { AgentPromptOverride } from '../types';

const overrides: AgentPromptOverride[] = [
  {
    agentId: 'designer',
    sections: {
      extra: `
ACC New Zealand context:
- ACC is a New Zealand Crown entity managing accident compensation for all NZ residents
- Core platform: Service Cloud for claims management, Experience Cloud for claimant self-service portal, Health Cloud for injury and treatment tracking, OmniStudio for guided claim lodgement flows
- All designs must consider high-volume claim processing (ACC handles ~2M claims/year)
- Claimant data is highly sensitive — injury details, medical records, employment information
- Accessibility is mandatory: NZ government digital standards require WCAG 2.1 AA minimum
- Integration landscape includes: NZ Ministry of Health, NZ Police, employer payroll systems, medical providers
- Flag any design that stores sensitive health data outside ap-southeast-2 region as a MUST-FIX
      `.trim(),
    },
  },
  {
    agentId: 'apex',
    sections: {
      extra: `
ACC-specific Apex guardrails:
- Claim records are high-volume — always design for bulk processing, never query inside loops
- Any Apex touching claimant health data must have explicit field-level security checks
- Async processing (Queueable, Batch) is preferred for claim status updates to avoid timeout on large claim volumes
- Flag any synchronous processing of bulk claim updates as a MUST-FIX
      `.trim(),
    },
  },
  {
    agentId: 'data',
    sections: {
      extra: `
ACC data model context:
- Core objects: Claim (custom or Case), Claimant (Person Account), Injury, Treatment, Payment, Provider (Account)
- NZ Privacy Act 2020 applies to all personal and health data — equivalent to GDPR principles
- Data must not leave ap-southeast-2 region — flag any cross-region data flow as a MUST-FIX
- Retention policies: claim data retained 10 years minimum per ACC Act requirements
- Field-level encryption required on: NZ National Health Index (NHI) number, bank account details, medical diagnosis codes
      `.trim(),
    },
  },
  {
    agentId: 'integration',
    sections: {
      extra: `
ACC integration landscape:
- NZ Ministry of Health: HL7 FHIR R4 for health provider data exchange
- NZ Inland Revenue (IRD): employer levy and payroll data via secure SFTP
- Medical providers: bulk claim submissions via REST API with OAuth 2.0
- All external integrations must use Named Credentials — no hardcoded endpoints or credentials
- mTLS required for Ministry of Health and IRD connections — flag anything less as a MUST-FIX
      `.trim(),
    },
  },
  {
    agentId: 'judge',
    sections: {
      extra: `
For ACC New Zealand, automatically escalate to MUST-FIX for any of the following:
- Health or personal data stored or processed outside ap-southeast-2
- Missing WCAG 2.1 AA accessibility considerations on any claimant-facing component
- Synchronous bulk processing of claim records
- Hardcoded credentials or endpoints in integration designs
- Missing field-level security on NHI numbers, bank details, or medical diagnosis fields
      `.trim(),
    },
  },
];

export default overrides;
