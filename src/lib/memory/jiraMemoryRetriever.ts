export interface RetrievedADR {
  jiraKey: string;
  requirement: string;
  verdict: string;
  summary: string;
  labels: string[];
  relevanceScore: number;
}

export interface MemoryContext {
  relevantADRs: RetrievedADR[];
  retrievedAt: string;
}

function buildHeaders(email: string, token: string): Record<string, string> {
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function extractTextFromADF(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { text?: string; content?: unknown[] };
  if (n.text) return n.text;
  if (Array.isArray(n.content)) return n.content.map(extractTextFromADF).join(' ');
  return '';
}

function scoreRelevance(requirement: string, adrText: string): number {
  const reqWords = new Set(
    requirement.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  );
  const adrWords = adrText.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  let hits = 0;
  for (const word of adrWords) {
    if (reqWords.has(word)) hits++;
  }
  return hits;
}

// Extract Salesforce domain keywords from the requirement for targeted Jira JQL filtering
function extractDomainKeywords(requirement: string): string[] {
  const lower = requirement.toLowerCase();
  const keywords: string[] = [];
  if (/\b(apex|trigger|batch|queueable)\b/.test(lower)) keywords.push('apex');
  if (/\b(lwc|lightning|component|aura)\b/.test(lower)) keywords.push('lwc');
  if (/\b(integrat|rest api|soap|webhook|callout|mulesoft)\b/.test(lower)) keywords.push('integration');
  if (/\b(flow|automation|process builder|workflow)\b/.test(lower)) keywords.push('flow');
  if (/\b(omnistudio|omni|vlocity|flexcard|omniscript)\b/.test(lower)) keywords.push('omnistudio');
  if (/\b(experience cloud|community|portal|site)\b/.test(lower)) keywords.push('experience');
  if (/\b(data cloud|data model|schema|object model)\b/.test(lower)) keywords.push('data');
  return keywords;
}

export async function retrieveMemory(
  requirement: string,
  _clientId: string,
  maxADRs = 5,
): Promise<MemoryContext> {
  const domain = process.env.JIRA_DOMAIN;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY ?? 'ARBOARD';

  if (!domain || !email || !token) {
    return { relevantADRs: [], retrievedAt: new Date().toISOString() };
  }

  try {
    const domainKeywords = extractDomainKeywords(requirement);
    const keywordClause = domainKeywords.length > 0
      ? ` AND text ~ "${domainKeywords.slice(0, 3).join(' ')}"`
      : '';
    const jql = encodeURIComponent(
      `project = "${projectKey}" AND labels in ("arboard-adr","arboard-signed")${keywordClause} ORDER BY created DESC`
    );
    const url = `https://${domain}/rest/api/3/search/jql?jql=${jql}&maxResults=10&fields=summary,description,labels,status`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    let data: { issues?: unknown[] };
    try {
      const response = await fetch(url, {
        headers: buildHeaders(email, token),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn(`[memory] Jira search returned ${response.status} — skipping memory retrieval`);
        return { relevantADRs: [], retrievedAt: new Date().toISOString() };
      }
      data = await response.json() as { issues?: unknown[] };
    } finally {
      clearTimeout(timeout);
    }

    const issues = data.issues ?? [];
    const scored: RetrievedADR[] = [];

    for (const issue of issues) {
      const i = issue as {
        key: string;
        fields: { summary: string; description: unknown; labels: string[] };
      };

      const requirementText = i.fields.summary.replace(/^\[ARBoard ADR\]\s*/i, '').trim();
      const descText = extractTextFromADF(i.fields.description);

      let verdict = 'UNKNOWN';
      const verdictMatch = descText.match(
        /\b(APPROVED WITH CONDITIONS|APPROVED|REVISION REQUIRED|REVIEW REQUIRED)\b/i
      );
      if (verdictMatch) verdict = verdictMatch[1].toUpperCase();

      const score = scoreRelevance(requirement, requirementText + ' ' + descText);

      scored.push({
        jiraKey: i.key,
        requirement: requirementText,
        verdict,
        summary: descText.slice(0, 2000),
        labels: i.fields.labels ?? [],
        relevanceScore: score,
      });
    }

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const relevantADRs = scored.slice(0, maxADRs).filter(a => a.relevanceScore > 0);

    console.log(`[memory] Jira query: ${issues.length} fetched (keywords: ${domainKeywords.join(', ') || 'none'}), ${relevantADRs.length} relevant`);
    return { relevantADRs, retrievedAt: new Date().toISOString() };
  } catch (err) {
    console.warn('[memory] Jira memory retrieval failed (non-fatal):', err instanceof Error ? err.message : err);
    return { relevantADRs: [], retrievedAt: new Date().toISOString() };
  }
}
