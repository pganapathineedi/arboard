// lib/clients/acc-nz/config.ts
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
  regulatoryOverlays: ['GDPR'], // closest proxy — use for NZ Privacy Act 2020 alignment
  dataRegion: 'ap-southeast-2', // Australia/NZ region
  knowledgeBaseId: 'acc-nz',
  monthlyBudgetUSD: 200,
  budgetAlertPct: 80,
  zeroRetention: false,
};

export default config;
