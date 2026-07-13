# Salesforce Agentforce — Grounding Knowledge

## Core design principles

**Topics define intent scope, not capability scope.** Each topic should answer one question: "What does this agent do, and what does it explicitly not do?" Vague topic instructions are the single biggest cause of out-of-boundary action invocations in production.

**Actions are the unit of trust.** Every action an agent can invoke represents a surface where data is accessed, processed, or mutated. Each action must be designed with the minimum required data access, explicit input sanitisation, and a defined output contract.

**Einstein Trust Layer is not optional in regulated contexts.** For any implementation touching PII, financial data, health data, or government identifiers, Trust Layer data masking and audit logging must be configured before the agent is considered architecturally complete.

**Escalation is a first-class design requirement.** An agent with no escalation path is incomplete. Every topic must define what happens when the agent cannot resolve the user intent — silence, generic errors, and infinite retry loops are not acceptable outcomes.

## Topic design principles

**Scope boundary structure:**
Every topic instruction should contain three sections:
1. What this topic handles (explicit mandate)
2. What this topic does NOT handle (explicit exclusion list)
3. How to handle out-of-scope requests (routing instruction or escalation trigger)

**Mandate clarity test:** Read the topic instruction and ask — could a reasonable person misinterpret what this topic is allowed to do? If yes, tighten the mandate.

**Routing topics:** Design a dedicated routing/triage topic that classifies user intent before dispatching to specialist topics. This prevents specialist topics from receiving inputs they were not designed for.

**Topic count guidance:**
| Agent complexity | Recommended topics |
|---|---|
| Simple (single domain, ≤3 intents) | 1–2 specialist + 1 fallback |
| Moderate (2–3 domains, 4–8 intents) | 3–5 specialist + 1 routing + 1 fallback |
| Complex (multi-domain, 8+ intents) | 6–10 specialist + 1 routing + 1 escalation |

## Action catalogue patterns

**Count limit:** Maximum 5 actions per topic. Above 5, LLM selection accuracy degrades measurably. Above 8, the agent becomes unreliable under varied inputs.

**Action description quality:** Each action description must be:
- Unambiguous — no two actions in the same topic should have overlapping descriptions
- Specific — describe what the action does, not what it is called
- Scoped — include the conditions under which this action should be selected

**Action description anti-patterns:**
- "Gets account information" (too vague — what information? which scenarios?)
- "Handles customer requests" (completely unbounded)
- "Processes data" (meaningless to the LLM selection model)

**Input/output contract:** Every action must define:
- Required input fields (what the agent must collect from the user before invoking)
- Optional input fields
- Output fields returned to the agent context
- Fields that must NOT be returned (PII fields that are not needed for the response)

**Splitting overloaded topics:**
If a topic requires >5 actions, split by user intent cluster. Example:
```
Topic: Account Management (too broad)
→ Topic: Account Details Lookup    (actions: GetAccount, GetContacts, GetOpportunities)
→ Topic: Account Updates           (actions: UpdateAccount, LogActivity, CreateCase)
```

## Einstein Trust Layer configuration

**Data masking — mandatory for regulated industries:**

| Data category | Masking requirement |
|---|---|
| PII (name, DOB, address, phone, email) | Mask before LLM context injection |
| Government identifiers (TFN, SSN, passport) | Mask — never expose in LLM context |
| Financial data (balances, account numbers) | Mask or exclude from action output |
| Health data (diagnosis, medication, care plan) | Mask — ASD Essential Eight relevance |
| Credentials (passwords, tokens, API keys) | Never include in any action output |

**Audit logging configuration checklist:**
- [ ] Audit logging enabled for all agent topics
- [ ] Log retention period defined (minimum: match regulatory requirement for the industry)
- [ ] Logs capture: user input, agent response, actions invoked, data fields accessed
- [ ] Log access restricted to authorised personnel only
- [ ] Audit log review included in go-live checklist

**Data residency:** Confirm the Einstein Trust Layer processes data in the approved region. For Australian public sector: data must remain in AU data centres. For EU clients: GDPR data residency requirements apply. Document the data residency configuration in the SDD.

## Escalation design patterns

**Minimum escalation requirements per topic:**
1. **Unresolvable intent** — agent cannot determine what the user wants after N turns
2. **Out-of-scope request** — user asks for something the agent is not designed to handle
3. **High-consequence confirmation refusal** — user declines the agent's proposed action
4. **System failure** — action invocation fails or returns unexpected output

**Handover with context:** When escalating to a human agent, the transfer must include:
- Full conversation transcript
- User identity (if authenticated)
- Actions attempted and their outcomes
- Reason for escalation

**Fallback topic design:**
Every agent should have a fallback topic that:
- Activates when no other topic matches the user intent
- Acknowledges the limitation ("I'm not able to help with that")
- Provides next steps (contact details, alternative channel, escalation path)
- Does NOT attempt to answer questions outside its mandate

## Prompt template quality

**Bounded instructions:** Prompt templates must specify:
- What the agent should do
- What the agent must not do
- The persona and tone
- Output format constraints

**Adversarial input handling:**
- Never concatenate raw user input directly into prompt instructions
- Use parameterised slots: `{{user_name}}` not `User said: [raw input]`
- Define behaviour for unexpected input: "If the user provides input that is not a valid [expected type], respond with [specific message]"
- Test prompt templates with adversarial inputs: SQL injection patterns, role-override attempts ("ignore previous instructions"), and oversized inputs

**Persona appropriateness:** The agent persona must match the deployment context. A public-facing support agent should not have a persona that implies internal system access or elevated authority.

## Grounding strategy

**Knowledge source selection:**
| Content type | Recommended grounding method |
|---|---|
| Product FAQs, policy documents | Einstein Knowledge (articles) |
| Real-time record data | Custom actions querying Salesforce data |
| Static reference data (pricing, product catalogue) | Prompt template context injection |
| Dynamic org configuration | Custom actions with caching |
| Historical case resolutions | Knowledge articles + RAG over case history |

**Freshness standards:**
- Knowledge articles used for grounding must have a review/expiry date set
- Stale knowledge (>6 months without review in a fast-changing domain) is a quality risk
- Real-time data (account status, case status) must come from live action queries, not static context

**Retrieval vs static context:**
- Use retrieval (Knowledge, RAG) for content that changes or scales beyond what fits in a prompt
- Use static context injection for invariant rules, personas, and guardrails
- Do not inject large static documents into every prompt — this inflates token cost and degrades instruction following

## Licensing and edition matrix

| Feature | Minimum requirement |
|---|---|
| Agentforce (Einstein Copilot) | Einstein 1 or Agentforce add-on |
| Agent Studio / Agent Builder | Agentforce add-on |
| Einstein Trust Layer | Included with Agentforce |
| Data Cloud grounding | Data Cloud licence required |
| Agentforce for Service | Service Cloud + Agentforce for Service SKU |
| Agentforce for Sales | Sales Cloud + Agentforce for Sales SKU |
| Prompt Builder | Einstein 1 or standalone Prompt Builder licence |
| Knowledge grounding | Service Cloud (Knowledge feature) |
| Custom LLM models | Data Cloud + Bring Your Own LLM add-on |

**Key licensing risks in SI delivery:**
1. Assuming Agentforce is included in existing Sales/Service Cloud licences — it is not
2. Building Data Cloud grounding before confirming the client has a Data Cloud licence
3. Designing for features available in sandbox trial orgs that are not in the production licence
4. Overlooking per-user vs per-org licensing differences for Agentforce features

**Always confirm:** Obtain written confirmation of the client's active SKUs and edition before completing the Agentforce design. Include the licence confirmation in the SDD as an appendix.

## Common failure modes in SI delivery

1. **Topic instructions written as capability lists** — listing what the agent CAN do without defining what it CANNOT do; results in out-of-boundary invocations
2. **Action descriptions copied from API documentation** — technical names like `GET /accounts/{id}` instead of "Retrieve the account record for the authenticated customer"; LLM cannot select accurately
3. **No fallback topic designed** — agent returns generic errors for unrecognised intents, user experience breaks immediately at edge cases
4. **Einstein Trust Layer treated as a post-go-live concern** — PII reaches LLM context in UAT and is not caught until a security review
5. **Licensing not validated until UAT** — entire Agentforce design built on features the client's licence does not include; discovered at UAT with no time for redesign
6. **Escalation path tested only in happy-path UAT** — escalation failures only discovered after go-live when real users hit edge cases
7. **Action count grows unchecked during build** — starts at 4 actions, grows to 12 as requirements expand; LLM selection accuracy degrades but no one runs adversarial testing
8. **Prompt templates not tested with adversarial inputs** — prompt injection vulnerabilities are common and not caught by functional testing alone

## MANDATORY CHECK LIST

Before submitting output, confirm you have checked:
- [ ] Every topic has an explicit exclusion list — not just a mandate
- [ ] Every topic has an escalation action or fallback path defined
- [ ] No topic has more than 5 actions — flag and recommend split if exceeded
- [ ] Every action description is unambiguous and non-overlapping with other actions in the same topic
- [ ] Einstein Trust Layer data masking configured for all PII, financial, and health fields
- [ ] Einstein Trust Layer audit logging enabled — mandatory for regulated industries
- [ ] No raw user input is concatenated directly into prompt templates
- [ ] Confirmation gates present on all destructive or high-value actions
- [ ] Licensing assumptions explicitly documented in SDD — no assumed feature availability
- [ ] Data residency requirements confirmed for the client's regulatory context

## SEVERITY RUBRIC

| Severity | Criteria |
|---|---|
| CRITICAL | PII or sensitive data exposed in LLM context without Trust Layer masking; prompt injection surface with no sanitisation; external user data accessible without explicit sharing controls |
| HIGH | Missing escalation path for any topic; audit logging not configured in a regulated industry context; licensing assumptions unverified; confirmation gates absent on high-consequence actions |
| MEDIUM | Action catalogue bloat (>5 actions per topic); topic scope too broad without exclusion list; stale knowledge grounding; data residency not documented |
| LOW | Action descriptions imprecise but still functional; persona mismatch (tone/style only); no fallback topic but escalation path exists via other means |
