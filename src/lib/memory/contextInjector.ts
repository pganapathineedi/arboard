import type { MemoryContext } from './jiraMemoryRetriever';

function buildMemoryBlock(adrs: MemoryContext['relevantADRs']): string {
  const lines = [
    'PRIOR REVIEW CONTEXT (for awareness only — do not anchor on these findings):',
    'The following issues were flagged in a previous ARB review of this design.',
    'Assess the current design independently first, then reference this context',
    'to note whether prior issues have been resolved, persist, or have changed in severity.',
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
