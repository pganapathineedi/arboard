# Solution Designer — Review Checklist

> Grounded in the **Salesforce Well-Architected Framework** three pillars:
> - **Trusted** — secure, compliant, reliable
> - **Easy** — simple, intentional, automated, engaging
> - **Adaptable** — resilient, composable, scalable

## Solution Fit Assessment — Declarative vs Programmatic vs Off-Platform

**The fit hierarchy:**
1. **Out-of-the-box standard features** — use first; zero custom code, full support lifecycle, AppExchange ecosystem
2. **Declarative automation** — Flow, Approval Process, Validation Rules, Formula Fields — no code, admin-maintainable, platformsupported
3. **Low-code/configuration** — Custom Metadata, Permission Sets, Custom Objects, OmniStudio (with licence) — configurable by skilled admins
4. **Custom code (Apex, LWC)** — only when declarative cannot meet the requirement without unacceptable compromise
5. **Off-platform** — external system, middleware, or microservice — only when Salesforce is genuinely not the right runtime

**Declarative vs programmatic decision matrix:**

| Requirement | Declarative path | Programmatic only when |
|-------------|-----------------|----------------------|
| Record field update on condition | Flow record-triggered | Complex branching across 10+ conditions that produce unreadable Flow; bulk volume requiring Apex bulkification |
| Data validation | Validation Rule | Cross-object logic that Validation Rules cannot express; requires callout for real-time external validation |
| Sending email | Flow Email Alert / Email Action | Email template requires dynamic personalisation beyond merge fields; send volume >5k/day |
| Data aggregation / rollup | Rollup Summary Field or DLRS | Non-master-detail relationship; cross-object aggregation from 3+ hops |
| UI customisation | Lightning App Builder, dynamic forms | Complex multi-step workflow, real-time data updates, third-party JS library requirement |
| External system integration | External Services, Flow HTTP Action | Complex transformation, error handling, retry logic, bulk volume |

**Red flags for incorrect fit assessment:**
- Apex trigger written for a field default that Flow could handle in 5 minutes
- Custom Apex REST endpoint built for a query that External Services + Flow could answer without code
- OmniScript built for a simple record creation that a standard quick action would serve
- Custom LWC built for a layout that Dynamic Forms + Visibility Rules would deliver declaratively

## Technical Debt Identification

**Debt categories in SDD and architecture artefacts:**

| Debt type | Signal in the SDD |
|-----------|-------------------|
| Complexity debt | Solution requires a dedicated runbook for simple operations; more than 3 automation tools triggered by a single record change |
| Governor limit debt | Design relies on small data volumes that will grow; no bulk strategy documented; SOQL or DML in loops accepted as "acceptable for now" |
| Coupling debt | Business logic tied to specific record IDs, profile names, or user names instead of Custom Metadata or Permission Sets |
| Test debt | Test strategy section absent or describes only happy-path coverage; no negative or bulk test requirement |
| Documentation debt | Design rationale missing — future maintainers cannot determine why a decision was made |
| Upgrade risk debt | Heavy reliance on undocumented managed-package APIs; custom code overrides managed package behaviour |

**Quantifying technical debt in SDDs:**
- Every debt item must be described with: the decision taken, the known risk, and the remediation plan with an estimated effort
- Unquantified debt ("we'll fix this later") is not acceptable — "later" must have a sprint or release target
- Debt accepted for delivery speed must have explicit sign-off from the solution architect and the client
- A SDD with no technical debt section in a complex implementation is a red flag — either the debt has not been found, or it has been found and not disclosed

**Signals of hidden technical debt:**
- "We're using a workaround for now" with no documented plan to remove it
- Configuration that requires a specific user to exist (e.g. automation runs as a named user, not an integration user)
- Logic spread across multiple automation layers (trigger + flow + process builder) for a single business outcome — "automation spaghetti"
- Hardcoded record IDs, profile names, or role names in any metadata or code

## Scalability Assessment

**Volume is a design input, not a deployment consideration.** Every SDD must state projected record volumes at year 1, year 3, and peak load for every key object. A design without volume projections is incomplete.

**Scalability red flags in SDDs:**

| Red flag | Risk |
|----------|------|
| Object projected to exceed 1M records with no indexing or archival strategy | SOQL timeouts at scale; report failures; storage cost spiral |
| Automation triggered per-record with no bulk consideration | Governor limits at 200-record DML operations; Data Loader failures |
| Integration uses REST API single-record calls for batch loads | Daily API limit exhaustion; trigger execution per call multiplies governor limit consumption |
| Sharing model uses criteria-based sharing rules on a high-volume object | Sharing recalculation jobs block batch processing after bulk updates |
| Append-only objects (logs, events, history) with no archival plan | Storage cost escalates; report and query performance degrades over 18–24 months |
| Platform cache or static variables used as a substitute for proper data architecture | Cache eviction causes unpredictable behaviour at scale; invalidation strategy absent |
| No governor limit analysis for peak transaction scenarios | Triggers, processes, and integrations interact at peak; cumulative governor limit consumption not modelled |

**Governor limit design-time analysis:**
- Model governor limit consumption for the peak transaction scenario (bulk DML + trigger + flow + integration)
- Check: SOQL per transaction (limit: 100), DML per transaction (limit: 150), callouts per transaction (limit: 100), CPU time (10s sync / 60s async), heap size (6MB sync / 12MB async)
- Document the calculated peak consumption in the SDD and confirm headroom
- If any single path consumes >50% of a governor limit at year-one volume, flag it as a scalability risk

**Capacity planning checklist:**
- [ ] Peak concurrent transaction rate documented
- [ ] API call volume per 24 hours calculated against org daily limit
- [ ] Batch job runtime estimated against org Apex CPU budget
- [ ] Storage growth rate projected and compared against org storage allocation
- [ ] Platform Event channel throughput modelled (150 publish per transaction; 250k event delivery per 24h)

## Org Strategy

**Single-org vs multi-org decision:**

| Factor | Single org | Multi-org |
|--------|-----------|-----------|
| Data sovereignty | All data in one tenancy — simpler governance | Separate data tenancies for regulatory isolation |
| Integration complexity | Internal — platform native, lower latency | External — API calls between orgs; latency and error handling |
| Sharing model | One unified sharing model; can become complex at scale | Simpler per-org model; cross-org access requires integration |
| Release management | One release train; cross-team coordination | Independent release per org; integration compatibility management |
| Licence cost | One set of licences (no duplication for shared functions) | Potential licence duplication for shared platform services |

**Org strategy must be documented in every SDD. Missing org strategy is a MUST-FIX.**

**Multi-org architecture considerations:**
- Cross-org data access via REST API, Platform Events, or MuleSoft — document the data flow and ownership for every cross-org entity
- Master data management (MDM) strategy required — which org is the system of record for each entity type?
- Cross-org identity — single SSO provider required; user provisioning strategy for shared services
- Deployment strategy — separate CI/CD pipelines per org; integration layer compatibility tested on every release

**Multi-cloud architecture considerations:**
- Salesforce + external cloud (AWS, Azure, GCP): document authentication model (OAuth, Named Credentials, mTLS)
- Data residency per cloud region must align with regulatory requirements — document instance and region for every system
- Failure modes when external cloud is unavailable — design for graceful degradation, not hard dependency
- Event-driven integration preferred over synchronous for cross-cloud — eliminates tight availability coupling

## Migration Complexity Signals

**Data migration complexity signals:**
- No External ID defined on migration target objects — upsert is impossible; name-match creates duplicates
- Source data quality not assessed — missing required fields, duplicate keys, inconsistent data types
- Migration volume exceeds 10M records without a multi-phase load plan — single load jobs fail or exceed retention window
- No data validation (pre-migration audit query + post-migration reconciliation count)
- No rollback plan — migration is treated as irreversible from design time

**Cutover complexity signals:**
- Cutover window not defined — "we'll figure it out during go-live" is a critical gap
- No freeze period for source system — data changes during migration create discrepancies
- More than 3 dependent external systems requiring cutover coordination — exponential failure surface
- Manual cutover steps not scripted — human error risk under time pressure
- No dry-run migration in a pre-prod environment at production data volume

**Legacy decommission signals:**
- Integration dependencies from the retiring system not fully mapped — a hidden integration surfaces after cutover
- Historical data access not planned — users expect to query legacy data from Salesforce; no archival or read-only access strategy
- Parallel run period not defined — how long both old and new systems coexist and how conflicts are resolved

## Integration Architecture Fit

**Integration pattern selection at design time:**

| Pattern | Best for | Avoid when |
|---------|---------|------------|
| Real-time REST callout (Salesforce-initiated) | Record-triggered external validation; synchronous user-facing confirmation | External system SLA >3s; high-volume trigger paths; bulk DML context |
| Platform Events (outbound) | Decoupled publish of Salesforce state changes to external consumers | Consumer requires ordered delivery; payload >1MB |
| Change Data Capture | External system consuming Salesforce record change history | Consumer cannot process within 3-day retention window without checkpointing |
| Outbound Messaging (legacy) | SOAP-based legacy consumer integration | New integrations — use Platform Events instead |
| External Services + Flow | Low-code declarative integration; OpenAPI-defined external API | Complex transformation, conditional branching, bulk volume |
| MuleSoft / ESB | Multi-system orchestration; complex transformation; error handling; retry/dead-letter | Simple point-to-point integration — adds unnecessary complexity |
| Bulk API 2.0 (inbound) | Any data load >10k records | Real-time single-record updates |

**Integration error strategy — must be defined at design level:**
- Every integration must document: retry strategy, idempotency mechanism, dead-letter queue, alerting on failure, and reconciliation process
- A design that says "errors will be handled by the middleware" without specifying the mechanism is incomplete
- Synchronous callout failure: user-facing error message + error log record; no silent failure
- Async event failure (Platform Event `ProcessException`): routed to an error channel; operations team alerted
- Batch integration failure: failed records written to a dead-letter object; reconciliation report produced after each run

**Sharing model design as a cross-cutting concern:**
- OWD and sharing rules must be designed alongside the data model — not retrofitted after go-live
- A Private OWD on a high-volume object requires sharing rule analysis for query performance impact
- Every integration user must have a scoped profile — not System Administrator
- Field-level security must be reviewed for every field exposed to an integration endpoint

## MANDATORY CHECK LIST

Before submitting a design review, confirm all items are addressed:

**Solution fit:**
- [ ] Declarative-first analysis documented — any custom code must justify why declarative cannot meet the requirement
- [ ] Technology selection rationale present — why this tool and not a simpler alternative
- [ ] Off-platform components justified — Salesforce capability evaluated before recommending external systems

**Org and architecture strategy:**
- [ ] Org strategy stated (single-org / multi-org) — if multi-org, cross-org data flow and MDM strategy documented
- [ ] Multi-cloud components identified — authentication, data residency, and failure mode documented per component

**Scalability and capacity:**
- [ ] Volume projections documented for all key objects at year 1, year 3, and peak load
- [ ] Governor limit consumption modelled for the peak transaction scenario
- [ ] Append-only objects have an archival strategy
- [ ] High-volume integration loads specify Bulk API 2.0 (not REST API)

**Sharing model and security:**
- [ ] OWD stated for every key object — not left as default or undocumented
- [ ] Sharing rule strategy aligned with OWD and data volume projections
- [ ] Integration users assigned scoped profiles — not System Administrator
- [ ] FLS reviewed for every field exposed to external users or integration endpoints

**Integration architecture:**
- [ ] Error handling strategy defined per integration (retry, dead-letter, alerting, reconciliation)
- [ ] Idempotency mechanism specified for any create/update integration operation
- [ ] External ID defined on every object receiving data from an external system

**Migration:**
- [ ] External ID strategy defined before migration design — upsert key explicitly named
- [ ] Cutover window and freeze period documented
- [ ] Rollback plan defined
- [ ] Post-migration reconciliation process documented

**Technical debt:**
- [ ] Technical debt section present — accepted debt items quantified with remediation plan and target sprint
- [ ] No hardcoded record IDs, profile names, or user names in any artefact
- [ ] Future extensibility assessed — solution does not require fundamental redesign for the next anticipated requirement

**Non-functional requirements (NFRs):**
- [ ] Performance SLAs defined for all user-facing operations
- [ ] Availability requirements stated — downtime tolerance during maintenance and failures
- [ ] Data retention periods documented per data category
- [ ] Regulatory and compliance requirements mapped to specific design controls

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Design cannot go live without this being addressed. Causes data loss, security breach, compliance violation, or guaranteed production failure at launch. | No org strategy documented and integration design assumes a single-org topology that does not match the client's multi-org landscape — integration architecture must be redesigned; No sharing model design on objects that hold regulated PII — default Public Read/Write OWD exposes health or financial data to all internal users; No External ID on integration target object — migration will create duplicates at scale with no reliable upsert path |
| HIGH | Will cause significant production impact under load or growth. Must be resolved before go-live. | No scalability assessment for objects projected to exceed 1M records — SOQL timeouts and report failures emerge in production year 2; No integration error strategy — silent data loss on any external system failure; No data retention or archival strategy for append-only log or event objects — unbounded storage growth and degraded query performance within 12 months; Governor limit consumption not modelled for peak transactions — limit breaches emerge after go-live under production load |
| MEDIUM | Technical debt or architectural drift. Will compound over time. Fix within current sprint or release. | Technical debt accepted without quantification or remediation plan — debt accumulates invisibly; Solution designed for current state with no extensibility assessment — next anticipated requirement requires fundamental redesign; Custom Apex or LWC built for a requirement declarative tools could meet — unnecessary code debt introduced; Integration pattern chosen for familiarity rather than fit — REST API for bulk loads, synchronous callout on trigger path |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Non-functional requirements not fully documented — performance SLAs and availability requirements missing; Technology selection rationale absent but choice is otherwise sound; Cutover plan documented at a high level without scripted runbook — risk to execution under time pressure |
