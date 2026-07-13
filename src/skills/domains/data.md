# Salesforce Data Architecture — Grounding Knowledge

## Core design principles

**Start with volume and ownership.** Before evaluating any data model, two questions must be answered: How many records will this object hold in 3 years? Who owns the record — which user or role? Volume determines indexing and archival strategy. Ownership determines the OWD setting. A design that cannot answer these questions is incomplete.

**Relationships have architectural consequences.** Master-detail vs lookup is not a cosmetic choice — it determines cascade delete behaviour, rollup summary field availability, record ownership inheritance, and sharing model propagation. Choose deliberately, not by default.

**Salesforce is not a relational database.** Normalisation principles from RDBMS design do not translate directly. Over-normalised models (too many junction objects, deep relationship chains) create SOQL complexity and governor limit risk. Under-normalised models (too many formula fields, cross-object rollups) create performance risk at scale. The right balance is Salesforce-idiomatic design, not textbook normalisation.

**The sharing model is a data architecture concern.** OWD, sharing rules, and role hierarchy are not security afterthoughts — they are core to the data model. A Private OWD on a high-volume object with complex sharing rules creates query performance problems that manifest as timeouts at scale.

## Data model design principles

**Object selection — standard vs custom:**
- Always evaluate standard objects first. Standard objects have platform optimisations, AppExchange ecosystem support, and pre-built integrations.
- Create custom objects only when the standard object cannot be made to fit without significant compromise
- Never repurpose standard objects for unintended use cases (e.g. using Task as a generic log object, using Campaign as a product catalogue)

**Relationship selection matrix:**

| Relationship type | Use when | Avoid when |
|---|---|---|
| Master-Detail | Parent ownership required; rollup summaries needed; cascade delete acceptable | Child must survive parent deletion; child owned by different user |
| Lookup | Child has independent lifecycle; child can exist without parent | Rollup summaries required across the relationship |
| External Lookup | Relating to external object in Salesforce Connect | High-volume queries — external lookups cannot be indexed |
| Hierarchical | Self-referential user hierarchy only | Any non-User object hierarchy |
| Junction Object | True many-to-many relationship | One-to-many — a lookup suffices; junction adds unnecessary complexity |

**Field type decisions:**

| Field type | Guidance |
|---|---|
| Formula | Read-only derived values. Avoid cross-object formulas on LDV objects — each formula traverses the relationship at query time |
| Rollup Summary | Master-detail only. High-volume child records cause recalculation delays. Consider async recalculation for >100k child records |
| External ID | Required on any object used as integration key. Enables upsert operations. Index is created automatically |
| Text (Encrypted) | Use for PII where Classic Encryption or Shield is required. Cannot be used in WHERE clauses — plan query strategy accordingly |
| Big Object | Append-only archive storage. No triggers, no workflow, no reports. Use for audit logs and historical records only |

**History tracking:** Maximum 20 tracked fields per object. History tracking adds a child record per change — on LDV objects this multiplies storage and query cost. Select tracked fields deliberately; do not enable tracking by default on all fields.

## Large data volume patterns

**LDV threshold:** Any object projected to exceed 1 million records is an LDV object and requires an explicit indexing and archival strategy documented in the SDD.

**Indexing strategy:**

| Index type | When to use |
|---|---|
| Standard index (auto) | ID, Name, CreatedDate, SystemModstamp, Owner, RecordType — always indexed |
| External ID | Every integration key field — enables fast upsert and lookup |
| Custom index | Any field used in WHERE clauses on LDV objects. Request via Salesforce Support. |
| Skinny table | High-volume SOQL queries against a small set of fields on an LDV object. Request via Salesforce Support. |

**Selective query requirement:** A query on an LDV object is selective if the filter returns <10% of total records (or <333k records, whichever is smaller). Non-selective queries on LDV objects cause full table scans and timeout under load. Identify all query patterns at design time and confirm selectivity.

**Archival strategy options:**

| Option | Best for |
|---|---|
| Big Objects | Append-only audit and history records. No query complexity. |
| Salesforce Archiving (native) | Standard object archival with continued reporting access |
| Third-party archival (Ownbackup, Spanning) | Complex archival with restore requirements |
| External data lake | Long-term retention with analytical access outside Salesforce |

**Report and dashboard performance:** Reports on LDV objects without indexed filters will time out. All report designs on objects >500k records must include a selective filter on an indexed field (e.g. CreatedDate range, RecordType, Owner).

**Async processing triggers:** Objects projected to receive bulk loads (>200 records per transaction) require bulkified trigger logic. Identify peak load scenarios at design time — batch integrations, data migrations, overnight jobs.

## Data quality and integrity

**Validation rules:**
- Define validation rules at the data model layer, not in Flow or Apex, wherever possible — platform enforcement is more reliable than application-layer enforcement
- Document the business rule each validation rule enforces — validation rules without documented business context become unmaintainable
- Test validation rules against bulk DML operations — validation rule errors in bulk context surface differently than in single-record UI context

**Duplicate management:**
- Salesforce native duplicate rules cover standard matching on standard objects. Define duplicate matching rules explicitly for custom objects with identity fields
- For cross-system duplicate detection (MDM scenarios), document the system of record for each entity and the merge/link strategy
- Duplicate rules without a defined merge strategy are incomplete — flag if the SDD defines detection but not resolution

**Data integrity constraints Salesforce does not enforce:**
- Salesforce has no referential integrity on Lookup relationships — a lookup field can be set to null or point to a deleted record. If referential integrity is required, it must be enforced via Apex trigger or validation rule
- Required fields in the UI are not required in the API — integrations can bypass field-level required validation. For critical fields, add a validation rule in addition to the field-level required setting

## External data integration patterns

**Integration pattern selection:**

| Pattern | Best for |
|---|---|
| REST API (standard) | Real-time single-record operations, external system reads |
| Bulk API 2.0 | Batch data loads >10k records. Always use Bulk API 2.0 for data migrations |
| Platform Events | Event-driven decoupled integration, CDC publish |
| Change Data Capture (CDC) | External systems consuming Salesforce record changes |
| Salesforce Connect (OData) | Virtualised access to external data without ETL. Not suitable for LDV — no indexing |
| Streaming API | Legacy. Superseded by Platform Events for new designs |
| MuleSoft / middleware | Complex multi-system orchestration, transformation, error handling |

**ETL design requirements:** Every ETL pipeline must define: error handling strategy, retry logic with idempotency keys, dead-letter queue for failed records, reconciliation report for each load, and rollback criteria for failed loads.

**CDC design considerations:**
- CDC events are retained for 3 days. Consumer must process within the retention window or implement checkpointing
- CDC generates one event per record change regardless of how many fields changed — high-update-frequency objects generate high event volume
- Gaps in CDC event consumption require a reconciliation mechanism — design this at the outset, not as a post-go-live fix

## Regulated data handling

**PII field categories (must be addressed in every SDD touching regulated data):**

| Category | Examples | Salesforce controls |
|---|---|---|
| Direct identifiers | Full name, email, phone, address, DOB | FLS, Encryption (Shield or Classic), masking |
| Government identifiers | TFN, SSN, passport, licence number | Shield Platform Encryption required in most regulated contexts |
| Financial data | Account numbers, balances, credit scores | FLS, encryption, audit trail |
| Health data | Diagnosis, medication, care plan, Medicare number | Highest classification — encryption + audit mandatory |
| Credentials | Passwords, PINs, security questions | Never store in Salesforce — use identity provider |

**Encryption options:**

| Option | Capability | Limitation |
|---|---|---|
| Classic Encryption | Field-level masking | Cannot use encrypted field in WHERE, ORDER BY, or GROUP BY |
| Shield Platform Encryption | Stronger key management, broader field type support | Cannot use encrypted fields in formula fields or rollup summaries |
| Deterministic Encryption (Shield) | Enables exact-match search on encrypted fields | Cannot use range queries on encrypted fields |

**Data retention and right to erasure:**
- Document retention period per data category in the SDD
- Right to erasure (GDPR, Privacy Act) requires a documented deletion process — cascade deletes through related objects, handling of anonymisation vs deletion, audit log of erasure events
- Salesforce does not natively support scheduled deletion — design a Batch Apex or Flow-based retention enforcement mechanism if required
- Shield Data Detect can identify PII fields that have not been secured — include in data governance review

**Data residency:** Salesforce stores data in the instance's region by default. For Australian government and health clients, confirm the org is on AP2 (Sydney) or AP20 (hyperforce AU). For EU clients, confirm GDPR-compliant instance. Document instance and data residency confirmation in the SDD.

## Salesforce data platform

**Data Cloud relevance:**
- Data Cloud (formerly CDP) is appropriate when: unifying data from multiple sources into a single customer profile, enabling real-time segmentation across >10M profiles, or powering Agentforce with grounding data at scale
- Data Cloud requires a separate licence and significant implementation effort — do not recommend it as a default data strategy for standard CRM implementations
- Data Cloud adds latency to data access — real-time transactional systems should continue to use standard Salesforce objects; use Data Cloud for analytical and AI use cases

**Data streams and harmonisation:**
- Data streams ingest data from external sources into Data Cloud. Each stream maps to a Data Model Object (DMO) in the Salesforce CIM schema
- Harmonisation — mapping source fields to the canonical CIM schema — is the highest-effort, highest-risk activity in a Data Cloud implementation. It requires deep knowledge of both source data and the CIM
- Identity resolution rules (match-and-merge) must be designed carefully — overly aggressive matching creates false unification; overly conservative matching misses legitimate matches

**When NOT to use Data Cloud:** Standard Salesforce reporting and dashboards, single-system CRM data, operational record management, implementations below ~1M profile records. Recommending Data Cloud for these scenarios adds cost and complexity with no benefit.

## SOQL performance

**Selectivity rules:**
- A WHERE clause is selective if it returns <10% of total object records, or <333,000 records
- Filters on indexed fields (ID, External ID, custom index) are always selective
- Filters on non-indexed fields (standard text fields, picklists without custom index) are non-selective on LDV objects
- `LIKE '%value%'` (leading wildcard) is never selective — avoid on LDV objects

**Query anti-patterns:**
- `SELECT * FROM Object__c` — never use in production code; retrieve only needed fields
- Filter on formula fields — formula fields cannot be indexed; always non-selective
- Filter on long text area fields — not indexable
- Ordering by non-indexed fields on LDV objects — causes full sort on unindexed data
- Cross-object SOQL in loops — execute parent query once, use Map for lookup

**Query plan analysis:** Use the Salesforce Query Plan tool (Developer Console) to confirm query selectivity before deploying to production. A query plan showing a "TableScan" on an LDV object is a production risk.

**SOSL vs SOQL:** Use SOSL for text search across multiple objects. SOSL uses the search index and is more efficient than multiple SOQL LIKE queries. Do not use SOQL LIKE for full-text search scenarios.

## Common failure modes in SI delivery

1. **Volume not assessed at design time** — object projected at "a few thousand records" grows to 5M in year two; no index strategy, no archival plan; SOQL timeouts at scale
2. **Lookup used where master-detail was needed** — rollup summaries hand-rolled in Apex trigger instead; technical debt and performance risk
3. **PII fields added without FLS review** — custom field added to intake form, appears in all profiles including external community users; discovered in security review after go-live
4. **No external ID on integration objects** — every integration load uses Name match instead of external ID; duplicate records accumulate; upsert becomes unreliable
5. **Sharing model set to Public Read/Write for speed** — object made public to avoid building sharing rules; violates least-privilege; discovered in audit
6. **History tracking enabled on all fields by default** — 20-field limit hit immediately when more tracking is needed; HistoryTracking child records inflate storage on LDV objects
7. **No archival strategy for append-only objects** — activity object, log object, or event object grows unbounded; storage cost escalates; report performance degrades
8. **Encrypted fields used in SOQL filters** — design calls for searching on encrypted field; Classic Encryption makes the field unsearchable; redesign required after build
9. **CDC consumer has no gap-fill strategy** — 3-day retention window exceeded during an outage; records missed with no reconciliation mechanism; data inconsistency in downstream system
10. **Data Cloud recommended without licence confirmation** — entire data strategy built on Data Cloud; client has no licence; discovered at architecture sign-off

## MANDATORY CHECK LIST

Before submitting output, confirm you have checked:
- [ ] Expected data volumes stated for all key objects — flag any projected to exceed 1M records
- [ ] Indexing strategy documented for every LDV object (external ID + custom index plan)
- [ ] Archival strategy documented for every append-only or time-series object
- [ ] Master-detail vs lookup selection justified for every parent-child relationship
- [ ] OWD setting stated for every key object — flag if not explicitly declared
- [ ] Sharing model (sharing rules + role hierarchy) consistent with OWD settings
- [ ] PII and sensitive fields identified — FLS, encryption, and masking addressed
- [ ] Data residency requirement confirmed and Salesforce instance documented
- [ ] All integration patterns identified — external ID, error handling, and retry strategy present
- [ ] SOQL selectivity confirmed for all query patterns on objects >100k records

## SEVERITY RUBRIC

| Severity | Criteria |
|---|---|
| CRITICAL | PII or government identifiers stored without encryption or FLS control; data residency requirement violated; no external ID on integration object causing duplicate accumulation at scale |
| HIGH | LDV object (>1M records) with no indexing or archival strategy; OWD more permissive than requirement demands; CDC consumer with no gap-fill strategy; encrypted field used in SOQL filter (design cannot be implemented as specified) |
| MEDIUM | Missing history tracking plan; no duplicate management strategy for objects with identity fields; Salesforce Connect used for LDV external data; Data Cloud recommended without licence confirmation |
| LOW | Standard object repurposed for minor use case; formula field used where a stored field would be more efficient; history tracking enabled on low-value fields consuming the 20-field limit |
