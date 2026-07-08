import { z } from "zod";

const FindingSchema = z.object({
  category: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  component: z.string(),
  recommendation: z.string(),
});

export const AgentFindingSchema = z.object({
  agent_name: z.string(),
  findings: z.array(FindingSchema),
  overall_risk: z.enum(["critical", "high", "medium", "low"]),
});

export type AgentFinding = z.infer<typeof AgentFindingSchema>;

export interface ValidationResult {
  agent_name: string;
  valid: boolean;
  data?: AgentFinding;
  errors?: string[];
  raw_text?: string;
}

export function validateAgentOutput(agentName: string, rawText: string): ValidationResult {
  // Extract all ```json blocks, take the last one (the appended findings block)
  const re = /```json\s*([\s\S]*?)```/g;
  let lastGroup: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawText)) !== null) {
    lastGroup = m[1];
  }
  if (lastGroup === null) {
    console.warn(`[validation] no JSON block found for "${agentName}" — last 500 chars:\n`, rawText.slice(-500));
    return { agent_name: agentName, valid: false, errors: ["No JSON block found in agent output"] };
  }
  const cleaned = lastGroup.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { agent_name: agentName, valid: false, errors: ["JSON parse failed"], raw_text: cleaned };
  }

  // Inject agent_name — agents don't self-identify in the JSON block
  if (typeof parsed === "object" && parsed !== null) {
    (parsed as Record<string, unknown>).agent_name = agentName;
  }

  const result = AgentFindingSchema.safeParse(parsed);
  if (result.success) {
    return { agent_name: agentName, valid: true, data: result.data };
  }
  return {
    agent_name: agentName,
    valid: false,
    errors: result.error.issues.map(e => `${e.path.join(".")}: ${e.message}`),
    raw_text: cleaned,
  };
}
