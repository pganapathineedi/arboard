import fs from "fs";
import path from "path";
import { createBaseAgent } from "@/lib/domains/base";
import type { AgentConfig } from "@/lib/types";

const _raw = fs.readFileSync(path.join(process.cwd(), "src/prompts/agents/sf-integration.md"), "utf-8");
const _sec = (h: string): string => {
  const re = new RegExp(`## ${h}\\n([\\s\\S]*?)(?=\\n## (?:Role|Expertise|Guardrails|Output Format|Additional Context)|$)`);
  return _raw.match(re)?.[1]?.trim() ?? "";
};

export const integrationAgent: AgentConfig = createBaseAgent({
  id: "sf-integration",
  name: "Integration Architect",
  role: "Integration Architect",
  sections: {
    persona: _sec("Role"),
    expertise: _sec("Expertise"),
    guardrails: _sec("Guardrails"),
    format: _sec("Output Format"),
    extra: _sec("Additional Context"),
  },
});
