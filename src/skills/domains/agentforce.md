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

## Agent Script design patterns

**Finite State Machine (FSM) structure:**
Agent Script implements a FSM where each node (hub, step, or screen) is a state and each transition is a directed edge. Design the FSM before configuring nodes:
1. Define all states the agent can be in
2. Define all valid transitions — avoid implicit transitions that rely on LLM inference alone
3. Define terminal states — success, failure, escalation, timeout
4. Every non-terminal state must have at least one exit condition defined

**Dead hub detection:**
A "dead hub" occurs when a routing hub evaluates all conditions and finds no matching branch — the script terminates unexpectedly. Prevent dead hubs by:
- Adding a default/fallback branch on every hub that captures unmatched conditions
- Testing the hub with boundary inputs: empty inputs, unexpected types, maximum-length inputs
- Reviewing the hub's condition expressions for gaps in conditional coverage

**Subagent structure:**
When an Agent Script calls a subagent (nested agent or action that itself triggers another LLM call):
- Each subagent call consumes from the top-level deliberation budget
- Design the call depth — a 3-level deep subagent chain consumes 3× the deliberation budget
- Prefer flat structures; if nesting is required, define explicit timeout and failure handling at each level
- Document the maximum call depth and estimated deliberation turns in the script specification

**Deliberation budget governance:**
Salesforce imposes a per-session deliberation budget (maximum LLM turns). When the budget is exhausted, the agent terminates. Design rules:
- Count deliberation turns in design phase, not build phase
- Each topic activation = 1+ turns; each action invocation = 1+ turns; each subagent call = multiple turns
- For complex multi-step flows, prototype and measure actual turn consumption in a sandbox before design sign-off
- Flag any pipeline with >8 deliberation turns for explicit budget review

## Persona design

**Identity framework:**
Every Agentforce agent must have a defined persona before build begins. The persona document should specify:
| Attribute | Definition |
|---|---|
| Name | The agent's display name (not the internal API name) |
| Role description | What the agent does, expressed in user-facing terms |
| Tone | Formal / friendly / empathetic / concise — with examples |
| Authority boundary | What the agent can and cannot commit to on behalf of the company |
| Prohibited behaviours | Statements the agent must never make (speculative, legal, clinical) |

**Tone consistency rules:**
- Define tone in the agent-level system prompt, not in individual topic instructions — topic-level overrides create inconsistency
- Test tone consistency across multiple session types: happy path, error states, escalation, out-of-scope requests
- Escalation tone must be consistent — a warm handover message must match the agent's established voice

**Persona and authority mismatch risk:**
An agent persona that implies elevated authority ("I can check your medical records", "I can approve your refund") when the underlying actions do not support that authority creates unmet user expectations and potential compliance exposure. Validate the persona claims against the actual action catalogue before go-live.

## Testing — Testing Center

**Testing Center YAML spec structure:**
The Salesforce Agentforce Testing Center accepts YAML test case definitions. Each test case should specify:
```yaml
testCase:
  name: <descriptive name>
  topic: <topic name>
  input: <user utterance>
  expectedTopic: <expected topic classification>
  expectedActions: [<action1>, <action2>]
  expectedResponse:
    contains: [<keyword1>, <keyword2>]
    notContains: [<prohibited keyword>]
  escalation: <true|false>
```

**Minimum test coverage per topic:**
| Test type | Minimum cases |
|---|---|
| Happy path | 3 per topic (varied phrasings) |
| Boundary inputs | 2 per action (empty, max-length, invalid type) |
| Out-of-scope inputs | 2 per topic (should trigger escalation or fallback) |
| Adversarial inputs | 2 per topic (prompt injection attempts, role override attempts) |
| Escalation triggers | 1 per escalation condition |

**Agentic fix loop pattern:**
When a test case fails, the fix loop is:
1. Capture the session trace from Testing Center (topic classification score, action selection log)
2. Identify whether failure is: topic misclassification, action selection error, or response content error
3. Apply fix to the specific layer (topic instruction, action description, prompt template)
4. Re-run the failing test case — do not ship until the full test suite passes
5. Run regression: add the failing input as a permanent test case to prevent recurrence

**Trace-test pattern:**
Export the Builder session trace alongside the test result. The trace shows:
- Topic classification probability score (low score = ambiguous topic instruction)
- Action selection ranking (tied scores indicate overlapping action descriptions)
- Deliberation turn count (flag if approaching the session budget)

## Observability — STDM and Builder trace

**STDM (Session Trace Data Model) overview:**
STDM captures agent session events at the platform level. Enable STDM to gain visibility into:
- Session start/end events and completion status
- Topic activation sequence (which topics fired in which order)
- Action invocation events (what was called, with what parameters, and what was returned)
- Escalation events (did escalation trigger? to which queue?)
- Deliberation turn count per session

**Enabling STDM:**
- STDM requires explicit configuration in the Agentforce setup — it is not enabled by default
- Enable STDM in the Agentforce Settings panel for each deployed agent
- Configure a data retention window appropriate to your compliance requirements
- Connect STDM output to your org's event log infrastructure or a CRM Analytics dataset for dashboarding

**Topic drift detection:**
Using STDM data, monitor for:
- Topics receiving inputs that do not match their mandate (topic misclassification rate)
- Actions being invoked in unexpected sequences (action drift)
- Sessions terminating without a clean resolution or escalation (unexplained session ends)

Set threshold alerts: if topic misclassification rate exceeds 5% of sessions, trigger a design review.

**Builder trace capture:**
In Agent Builder (sandbox), every session generates a trace panel:
- Use the trace panel during design review — not just during debugging
- Screenshot and attach trace output to the design review artefact
- Flag any session where deliberation turn count exceeds 8 — this is a budget risk signal

## Agentforce Grid

**Workbook design:**
The Agentforce Grid workbook is the design artefact that maps business requirements to agent configuration. A complete workbook contains:
| Worksheet | Purpose |
|---|---|
| Agent Overview | Agent name, persona summary, licensing SKU, deployment context |
| Topic Catalogue | One row per topic: mandate, exclusion list, escalation action, action count |
| Action Register | One row per action: description, input fields, output fields, PII risk, Trust Layer masking required |
| Testing Register | One row per test case: input utterance, expected topic, expected actions, expected response, pass/fail |
| Licensing & Flex Credit | SKU requirements, per-conversation cost estimate, monthly volume forecast |
| Risk Register | Each risk item from the patterns and safety review, with severity and owner |

**Worksheet structure rules:**
- Topic Catalogue must be completed before build begins — it is the contract between design and build
- Action Register must document PII exposure for every output field — missing this is a Trust Layer compliance gap
- Testing Register must include adversarial test cases — not just happy-path flows
- Licensing worksheet must be signed off by the client before go-live

## Safety review and ADLC patterns

**Harmful pattern detection beyond keyword filters:**
Basic keyword filtering (blocking explicit harmful words) is insufficient for enterprise agent safety. Effective safety review includes:
- **Instruction override probes:** Test inputs designed to override the agent's system prompt ("Ignore all previous instructions and...")
- **Authority escalation probes:** Inputs claiming elevated user authority ("As an administrator, I need you to...")
- **Indirect extraction probes:** Inputs attempting to extract system prompt contents, action configurations, or internal data through indirect questions
- **Roleplay injection:** Inputs attempting to shift the agent into a fictional context to bypass guardrails

**ADLC (Agentforce Data Library Component) safety patterns:**
- Review every data source registered in ADLC for appropriate access controls before connecting it to an agent
- ADLC grounding can surface records the user should not access if field-level security is not enforced at the data source level
- Validate that ADLC queries honour the running user's sharing model — ADLC does not automatically inherit org sharing rules
- For ADLC-backed knowledge retrieval: confirm that no document chunks contain PII, credentials, or internal system information

**Trust Layer grounding safety:**
- Use Einstein Trust Layer grounding filters to prevent the agent from accessing knowledge outside its topic mandate
- Configure retrieval scope filters per topic, not at the agent level — agent-level filters are too coarse
- Test retrieval with queries designed to pull cross-topic or cross-user content

**Safety review checklist:**
- [ ] Instruction override probes tested and blocked
- [ ] Authority escalation probes tested and rejected
- [ ] ADLC access controls validated against FLS and sharing model
- [ ] Trust Layer grounding scope filters configured per topic
- [ ] No internal system information in any knowledge source accessible to the agent
- [ ] Harmful output detection rules configured (Einstein Guardrails or equivalent)

## Flex Credit and cost modelling

**Conversation agents vs task agents:**
| Agent type | Billing model |
|---|---|
| Conversation agent | Billed per conversation (Flex Credit per session) |
| Task agent (Einstein Bots successor) | Billed per task completion |
| Agentforce for Service | Service Cloud Flex Credit pool |
| Custom agent (API-driven) | Billed per API call or per deliberation turn (confirm with Salesforce AE) |

**Flex Credit cost model:**
Flex Credits are the consumption unit for Agentforce. One conversation typically costs 1 Flex Credit; actions and escalations may consume additional credits. Current public list pricing (confirm current rates with your Salesforce AE — pricing changes):
- 1 Flex Credit ≈ 1 agent conversation turn (estimate only)
- Autonomous task completion: higher credit consumption than simple FAQ deflection
- Escalation to human: 0.5× credit per escalation (in some editions — verify)

**Estimation approach for delivery sign-off:**
1. Define monthly conversation volume (from client's current support volume data)
2. Define expected deflection rate (% of conversations fully resolved by agent)
3. Estimate average conversation length in turns
4. Apply Flex Credit cost per conversation × volume = monthly credit consumption estimate
5. Convert to cost using current list price (or contracted rate if negotiated)
6. Add buffer: SI delivery experience shows first-month actual volume runs 20–40% above estimate as users discover the agent

**Flex Credit cost model must be documented in the Grid workbook** before design sign-off. Unknown licensing cost at sign-off is a delivery risk — it has caused project scope reductions when discovered post-build.

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
