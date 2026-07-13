import fs from 'fs';
import path from 'path';
import { retrieveRelevantChunks } from '../rag/ragRetriever';

const SKILLS_BASE = path.join(process.cwd(), 'src/skills');

// Domain skill — maps agent ID to skill file, always loaded for that agent
const DOMAIN_SKILL_MAP: Record<string, string> = {
  'sf-apex': 'domains/apex.md',
  'sf-lwc': 'domains/lwc.md',
  'sf-flow': 'domains/flow.md',
  'sf-omni': 'domains/omni.md',
  'sf-data': 'domains/data-integration.md',
  'sf-integration': 'domains/data-integration.md',
  'sf-patterns': 'domains/patterns.md', // dedicated SI failure patterns checklist FP-004 to FP-020
};

// Cross-cutting skills — keyword triggered, loaded across multiple agents
const CROSS_CUTTING_SKILLS: { file: string; keywords: string[] }[] = [
  {
    file: 'cross-cutting/ldv-patterns.md',
    keywords: ['large data', 'ldv', 'million records', 'volume', 'archiv', 'skinny table', 'index'],
  },
  {
    file: 'cross-cutting/async-patterns.md',
    keywords: ['callout', 'async', 'queueable', 'batch', 'future method', 'platform event', 'trigger'],
  },
  {
    file: 'cross-cutting/security-model.md',
    keywords: ['guest user', 'sharing', 'fls', 'field level', 'pii', 'encryption', 'shield', 'apra', 'compliance', 'privacy'],
  },
  {
    file: 'cross-cutting/integration-reliability.md',
    keywords: ['integration', 'api', 'callout', 'retry', 'idempoten', 'mulesoft', 'rest', 'soap', 'outbound'],
  },
  {
    file: 'cross-cutting/named-credentials-and-auth.md',
    keywords: ['named credential', 'endpoint', 'api key', 'oauth', 'authentication', 'auth', 'token', 'http callout', 'rest', 'hardcoded'],
  },
  {
    file: 'cross-cutting/error-handling-strategy.md',
    keywords: ['error handling', 'logging', 'retry', 'exception', 'callout failure', 'fault', 'dead letter', 'fp-006', 'fp-009', 'silent fail'],
  },
  {
    file: 'cross-cutting/automation-governance.md',
    keywords: ['trigger', 'flow', 'automation', 'process builder', 'workflow rule', 'record-triggered', 'fp-010', 'mixed automation'],
  },
  {
    file: 'cross-cutting/well-architected-framework.md',
    keywords: ['trusted', 'easy', 'adaptable', 'well-architected', 'secure', 'reliable', 'compliant', 'composable', 'scalable', 'architecture'],
  },
  {
    file: 'cross-cutting/sf-bedrock-patterns.md',
    keywords: ['queueable', 'async', 'platform event', 'eventbus', 'trigger handler', 'retry', 'background', 'scheduled apex', 'future method'],
  },
];

const _fileCache = new Map<string, string>();

function readSkillFile(relativePath: string): string {
  if (_fileCache.has(relativePath)) return _fileCache.get(relativePath)!;
  try {
    const fullPath = path.join(SKILLS_BASE, relativePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    _fileCache.set(relativePath, content);
    return content;
  } catch {
    _fileCache.set(relativePath, '');
    return '';
  }
}

export function loadDomainSkill(agentId: string): string {
  const skillFile = DOMAIN_SKILL_MAP[agentId];
  if (!skillFile) return '';
  const content = readSkillFile(skillFile);
  if (!content) return '';
  return `\n\n## SPECIALIST REVIEW CHECKLIST\n${content}`;
}

export async function loadCrossCuttingSkills(documentText: string): Promise<string> {
  const doc = documentText.toLowerCase();
  const matched: string[] = [];

  for (const skill of CROSS_CUTTING_SKILLS) {
    const triggered = skill.keywords.some(kw => doc.includes(kw));
    if (triggered) {
      const content = readSkillFile(skill.file);
      if (content) matched.push(content);
    }
  }

  const base = matched.length === 0 ? '' : `\n\n## CROSS-CUTTING ARCHITECTURE SKILLS\n${matched.join('\n\n---\n\n')}`;

  const ragChunks = await retrieveRelevantChunks(documentText, 5);
  if (ragChunks.length === 0) return base;

  const ragBlock = ragChunks.map(c => c.chunk_text).join('\n\n---\n\n');
  return base + `\n\n## Semantically Retrieved Grounding\n${ragBlock}`;
}
