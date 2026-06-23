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
