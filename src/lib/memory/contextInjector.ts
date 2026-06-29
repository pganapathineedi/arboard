import type { MemoryContext } from './jiraMemoryRetriever';

function buildMemoryBlock(adrs: MemoryContext['relevantADRs']): string {
  const lines = [
    'PRIOR REVIEW CONTEXT — reconciliation required:',
    'The following issues were flagged in a previous ARB review of this design.',
    '',
    'Instructions:',
    '1. Complete your independent assessment of the current design first.',
    '2. Then for each prior ADR below, append a reconciliation line in this format:',
    '   [JIRA-KEY] → RESOLVED | PERSISTS | ESCALATED | NOT APPLICABLE — <one sentence reason>',
    '3. If your current verdict contradicts a prior APPROVED decision, explicitly flag it:',
    '   CONTRADICTION: [JIRA-KEY] — <what changed and why your verdict differs>',
    '',
  ];

  for (const adr of adrs) {
    lines.push(`### [${adr.jiraKey}] ${adr.verdict}`);
    lines.push(`**Requirement:** ${adr.requirement}`);
    if (adr.summary.trim()) {
      lines.push(`**Notes:** ${adr.summary.trim()}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

// All known Salesforce domain agent IDs
const SF_AGENT_IDS = [
  'sf-designer', 'sf-apex', 'sf-lwc', 'sf-integration',
  'sf-flow', 'sf-omniStudio', 'sf-patterns', 'sf-judge', 'sf-scribe', 'sf-learner',
];

export function buildAllAgentMemoryBlocks(
  memory: MemoryContext,
): Record<string, string> {
  if (memory.relevantADRs.length === 0) return {};
  const block = buildMemoryBlock(memory.relevantADRs);
  return Object.fromEntries(SF_AGENT_IDS.map(id => [id, block]));
}
