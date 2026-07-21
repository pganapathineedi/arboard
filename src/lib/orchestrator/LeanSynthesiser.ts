import { getLLMProvider } from '@/lib/llm'

export interface LeanRiskItem {
  id: string
  title: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  domain: string
  effort_impact: string
}

export interface DomainSignal {
  risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  key_concerns: string[]
  effort_impact: string
}

export interface LeanReviewResponse {
  mode: 'lean'
  complexity_tier: 'simple' | 'moderate' | 'complex' | 'highly_complex'
  risk_register: LeanRiskItem[]
  effort_flags: string[]
  domain_signals: Record<string, DomainSignal>
  agents_activated: string[]
  confidence: number
  processing_time_ms: number
}

function deriveComplexityTier(
  specialistCount: number,
  riskRegister: LeanRiskItem[],
): LeanReviewResponse['complexity_tier'] {
  const criticalCount = riskRegister.filter(r => r.severity === 'CRITICAL').length
  const highCount = riskRegister.filter(r => r.severity === 'HIGH').length

  // highly_complex: 4 specialists OR multiple CRITICAL OR cross-domain CRITICAL combinations
  if (specialistCount >= 4 || criticalCount >= 2) return 'highly_complex'
  // complex: 3 specialists OR any CRITICAL OR 3+ HIGH
  if (specialistCount >= 3 || criticalCount >= 1 || highCount >= 3) return 'complex'
  // moderate: 2 specialists OR any HIGH
  if (specialistCount >= 2 || highCount >= 1) return 'moderate'
  return 'simple'
}

export class LeanSynthesiser {
  static async synthesise(params: {
    designerOutput: string
    domainSignals: Record<string, DomainSignal>
    agentsActivated: string[]
    startTimeMs: number
  }): Promise<LeanReviewResponse> {
    const { designerOutput, domainSignals, agentsActivated, startTimeMs } = params

    const signalsBlock = Object.entries(domainSignals)
      .map(([id, sig]) =>
        [
          `### ${id}`,
          `Risk Level: ${sig.risk_level}`,
          `Key Concerns: ${sig.key_concerns.join('; ')}`,
          `Effort Impact: ${sig.effort_impact}`,
        ].join('\n'),
      )
      .join('\n\n')

    const { text } = await getLLMProvider().complete({
      model: 'claude-sonnet-4-6',
      maxTokens: 2000,
      system:
        'You are an ARBoard lean synthesiser. Given solution designer output and domain specialist signals, produce a consolidated risk register and effort flags. Return ONLY valid JSON — no markdown fences, no explanation.',
      messages: [
        {
          role: 'user',
          content: [
            '## DESIGNER OUTPUT',
            designerOutput,
            '',
            '## DOMAIN SPECIALIST SIGNALS',
            signalsBlock || '(no specialist signals)',
            '',
            'Produce a JSON object with this exact shape:',
            '{',
            '  "risk_register": [',
            '    { "id": "R-001", "title": "...", "severity": "CRITICAL|HIGH|MEDIUM|LOW", "domain": "agentId", "effort_impact": "one line" }',
            '  ],',
            '  "effort_flags": ["cross-cutting delivery risk or effort amplifier"],',
            '  "confidence": 0.0',
            '}',
            '',
            'risk_register: consolidated concrete risks from all signals. severity MUST be CRITICAL, HIGH, MEDIUM, or LOW.',
            'effort_flags: cross-cutting delivery risks and effort amplifiers (max 5 items).',
            'confidence: your confidence in this assessment, 0.0 to 1.0.',
          ].join('\n'),
        },
      ],
    })

    const raw = (text ?? '{}').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    let parsed: { risk_register?: LeanRiskItem[]; effort_flags?: string[]; confidence?: number } = {}
    try {
      parsed = JSON.parse(raw)
    } catch {
      // fallback to empty
    }

    const riskRegister = parsed.risk_register ?? []
    const specialistCount = Object.keys(domainSignals).length

    return {
      mode: 'lean',
      complexity_tier: deriveComplexityTier(specialistCount, riskRegister),
      risk_register: riskRegister,
      effort_flags: parsed.effort_flags ?? [],
      domain_signals: domainSignals,
      agents_activated: agentsActivated,
      confidence: parsed.confidence ?? 0.7,
      processing_time_ms: Date.now() - startTimeMs,
    }
  }
}
