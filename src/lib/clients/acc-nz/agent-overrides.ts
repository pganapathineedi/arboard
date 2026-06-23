import type { AgentPromptOverride } from '../types';

const overrides: AgentPromptOverride[] = [
  {
    agentId: 'sf-designer',
    sections: {
      extra: `ACC New Zealand context:
- ACC is a NZ Crown entity managing accident compensation for all NZ residents
- Core platform: Service Cloud for claims management, Experience Cloud for claimant self-service portal, Health Cloud for injury and treatment tracking, OmniStudio for guided claim lodgement flows
- All designs must consider high-volume claim processing (ACC handles ~2M claims/year)
- Claimant data is highly sensitive — injury details, medical records, employment information
- Accessibility is mandatory: NZ government digital standards require WCAG 2.1 AA minimum
- Flag any design that stores sensitive health data outside ap-southeast-2 region as a MUST-FIX`,
    },
  },
  {
    agentId: 'sf-integration',
    sections: {
      extra: `ACC New Zealand integration landscape:
- NZ Ministry of Health: HL7 FHIR R4 for health provider and injury/treatment data exchange — mTLS required, Named Credentials mandatory
- NZ Inland Revenue (IRD): employer levy data via secure SFTP — certificate-based auth, no plaintext credentials
- Medical providers: bulk claim submissions via REST API with OAuth 2.0 JWT Bearer flow
- NZ Police: injury verification via REST API — mTLS required
- Employer payroll systems: bulk return-to-work notifications via Bulk API 2.0

Security requirements (all integrations):
- All external endpoints must use Named Credentials — hardcoded endpoints or tokens are MUST-FIX
- mTLS mandatory for Ministry of Health, IRD, and NZ Police connections — anything less is MUST-FIX
- OAuth 2.0 JWT Bearer flow preferred for server-to-server integrations (no user interaction)
- All integration payloads containing NHI numbers, diagnosis codes, or bank details must be encrypted in transit and at rest

Data residency:
- No integration pattern may route claim or health data through infrastructure outside ap-southeast-2 — flag as MUST-FIX
- MuleSoft RTF workers must be deployed to ap-southeast-2 if MuleSoft is in scope

Resilience requirements:
- Platform Events preferred for claim status update fan-out (notify portal, health providers, internal workflows)
- Dead-letter / replay strategy required for all critical claim data flows — absence is MUST-FIX for regulated data
- Correlation IDs mandatory on all integration transactions for NZ Privacy Act audit trail compliance`,
    },
  },
  {
    agentId: 'sf-apex',
    sections: {
      extra: `ACC-specific Apex guardrails:
- Claim records are high-volume — always design for bulk processing, never query inside loops
- Any Apex touching claimant health data must have explicit field-level security checks
- Async processing (Queueable, Batch) preferred for claim status updates
- Flag any synchronous processing of bulk claim updates as a MUST-FIX`,
    },
  },
  {
    agentId: 'sf-omni',
    sections: {
      extra: `ACC OmniStudio context:
- OmniStudio is the primary channel for guided claim lodgement flows
- FlexCards used for claimant self-service views — accessibility (WCAG 2.1 AA) mandatory on all FlexCards
- OmniScripts handle multi-step claim intake — ensure all steps support screen readers
- Integration Procedures used for Ministry of Health and IRD data calls — enforce Named Credentials`,
    },
  },
  {
    agentId: 'sf-patterns',
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
    agentId: 'sf-judge',
    sections: {
      extra: `For ACC New Zealand, automatically escalate to MUST-FIX for:
- Health or personal data stored or routed outside ap-southeast-2
- Missing WCAG 2.1 AA accessibility on any claimant-facing component
- Synchronous bulk processing of claim records
- Hardcoded credentials or endpoints in any integration design
- Missing field-level security on NHI numbers, bank details, or medical diagnosis fields
- Missing mTLS on Ministry of Health, IRD, or NZ Police connections
- Missing dead-letter / replay strategy on critical claim data flows`,
    },
  },
];

export default overrides;
