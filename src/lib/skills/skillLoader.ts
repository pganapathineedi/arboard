import fs from 'fs';
import path from 'path';

const SKILLS_BASE = path.join(process.cwd(), 'src/skills');

// Domain skill — maps agent ID to skill file, always loaded for that agent
const DOMAIN_SKILL_MAP: Record<string, string> = {
  'sf-apex': 'domains/apex.md',
  'sf-lwc': 'domains/lwc.md',
  'sf-flow': 'domains/flow.md',
  'sf-omni': 'domains/omni.md',
  'sf-data': 'domains/data-integration.md',
  'sf-integration': 'domains/data-integration.md',
  'sf-patterns': 'domains/apex.md', // patterns agent benefits from apex checklist
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
];

function readSkillFile(relativePath: string): string {
  try {
    const fullPath = path.join(SKILLS_BASE, relativePath);
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
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

export function loadCrossCuttingSkills(documentText: string): string {
  const doc = documentText.toLowerCase();
  const matched: string[] = [];

  for (const skill of CROSS_CUTTING_SKILLS) {
    const triggered = skill.keywords.some(kw => doc.includes(kw));
    if (triggered) {
      const content = readSkillFile(skill.file);
      if (content) matched.push(content);
    }
  }

  if (matched.length === 0) return '';
  return `\n\n## CROSS-CUTTING ARCHITECTURE SKILLS\n${matched.join('\n\n---\n\n')}`;
}
