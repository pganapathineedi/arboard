# Flow Specialist — Review Checklist

## Record-Triggered Flow Architecture

**Before Save vs After Save — choose deliberately:**

| Context | Use when | Avoid when |
|---------|---------|------------|
| Before Save (Fast Field Updates) | Defaulting or updating fields on the triggering record — no additional SOQL or DML needed | Any related-record creation, callout, or cross-object update |
| After Save | Creating/updating related records, sending emails, calling subflows, invoking Apex | Updating fields on the triggering record — requires an extra DML operation and an additional trigger execution |

- **Before Save** flows execute in the same transaction as the DML, with no extra DML statement — the cheapest automation path for field updates
- **After Save** flows execute after the record is committed — related-record DML is safe here; updating the triggering record triggers a second save operation and another run of all triggers and automations
- **Entry criteria** must be as restrictive as possible — a flow without entry criteria that checks conditions inside the flow still runs for every DML operation on the object, consuming CPU time in every transaction

**Record-Triggered Flow trigger selection:**
- `A record is created` — entry criteria evaluated on insert only; safest for initialisation logic
- `A record is created or updated` — evaluates on every save; add a condition to prevent unnecessary runs (e.g. `{!$Record.Status} changed` or field comparison)
- `A record is updated` — insert is excluded; use for change-detection logic
- `A record is deleted` — Before Delete context only; no record variable available in After Delete flows

**Recursion risk:**
- An After Save flow that updates the triggering record fires the object's triggers and flows again — can produce a recursion loop
- Prevent with a field-based guard: only run the flow when a specific field has not already been set to the expected value (entry condition: `NewFieldValue IS NULL`)
- Never use a static recursion flag inside a Flow — unlike Apex, there is no reliable per-transaction static state in Flow; the guard must be data-driven

## Flow Bulkification & Governor Limits

**The core rule:** Flow elements that interact with the database (Get Records, Create Records, Update Records, Delete Records) are automatically bulkified when they run outside a loop. Inside a loop, each iteration consumes one SOQL query or one DML statement.

**Governor limits consumed by Flow per transaction:**

| Resource | Limit | Risk pattern |
|----------|-------|-------------|
| SOQL queries | 100 | Get Records inside a loop — one query per iteration |
| DML statements | 150 | Create/Update/Delete Records inside a loop — one DML per iteration |
| CPU time | 10 000 ms | Complex decision logic in loops over large collections |
| Heap | 6 MB | Large Get Records collections stored in loop variables |

**Bulkification pattern — collect, act once:**
- Get Records outside the loop → store in a collection variable
- Loop over the collection in memory
- Accumulate records to update in a separate collection variable
- Update Records outside the loop with the full collection — one DML statement for all records

**The 2000-record interview limit:**
- A single record-triggered Flow interview processes up to 2000 records in a single transaction (bulk DML, Data Loader)
- If the triggered batch contains more than 2000 records, the platform splits them into multiple interviews
- Design entry criteria and collection sizes with this limit in mind; a Get Records inside a loop at 2000 iterations will hit SOQL limits before this boundary

**Subflow governor limit inheritance:**
- Subflows execute in the same transaction as the calling flow — they share the same SOQL, DML, CPU, and heap limits
- A subflow with a Get Records element inside a loop multiplies the SOQL consumption against the parent flow's iteration count — model the combined limit consumption across the full call chain

## Error Handling & Fault Connectors

**Every interaction element needs a fault connector:**

The following Flow element types can fault — every one requires an explicit fault connector wired to an error path:
- Get Records (SOQL failure, timeout)
- Create Records (DML failure, validation rule, duplicate rule, sharing rule)
- Update Records (same as Create)
- Delete Records (same as Create)
- Callout (HTTP timeout, non-2xx response)
- Apex action / Invocable Method (Apex exception)
- Subflow invocation (any exception in the subflow)
- Send Email (messaging failure)

**Fault path options:**

| Option | When to use |
|--------|------------|
| Display custom error message (Screen Flow) | User-facing — explain the failure in plain language and offer a retry or support contact |
| Create a Platform Event (record-triggered) | Operational alerting — publish an error event that an ops subscriber writes to an error log object |
| Create a log record (after-save) | Audit trail — write an Error_Log__c record with flow name, record ID, error message, and timestamp |
| Re-throw via `{!$Flow.FaultMessage}` in subflow | Propagate fault up to the calling flow — never silently absorb the error in a subflow |

**Null handling on Get Records:**
- A Get Records element returns `null` when no records match the filter criteria — it does NOT fault
- Any downstream element that references the collection variable without a null check will produce a null-reference error at runtime
- After every Get Records, add a Decision element: `{!CollectionVar} IS NULL` → route to an explicit zero-results path; `IS NOT NULL` → continue to the main path

**Transaction rollback behaviour:**
- A faulted DML element in a record-triggered flow causes the entire transaction to roll back — no partial saves
- If partial success is acceptable, invoke Apex via an `@InvocableMethod` with `Database.update(records, false)` (allOrNone=false) and handle partial results in Apex
- Screen flows with fault paths do NOT roll back previous DML in the same interview — each DML element commits when it executes; design commit order carefully

## Screen Flow Patterns

**Input validation:**
- Validate all required inputs before executing DML — never let a blank or null value reach a Create/Update Records element
- Use a Decision element after every user-input screen to confirm required fields are populated before proceeding
- For complex validation (uniqueness check, cross-field rule), invoke an Apex action rather than building the validation inside Flow logic
- Display validation errors on the screen using a text component referencing `{!$Flow.FaultMessage}` or a dedicated error message variable

**Navigation and user experience:**
- Multi-page screen flows should enable the Back button on all non-destructive screens — users expect to correct previous inputs
- Do not execute DML before the final confirmation screen — DML executed mid-wizard cannot be rolled back if the user presses Back
- For long-running operations (Apex callout, complex DML), display a loading spinner between screens — Screen Flows do not have a native loading indicator; use a Lightning spinner LWC component embedded in the screen

**LWC in screen flows:**
- LWC components embedded in Screen Flows must implement `FlowAttributeChangeEvent` to communicate user input back to the Flow
- Output attributes from LWC components are available to subsequent Flow elements — map them explicitly in the LWC component property editor
- Components that need to trigger navigation must dispatch `FlowNavigationNextEvent`, `FlowNavigationBackEvent`, or `FlowNavigationFinishEvent` rather than using `NavigationMixin` directly

**Large payload risk:**
- Screen flows that load large collections (>500 records) from Get Records elements into picklist or data table components can cause browser performance issues
- Implement server-side filtering in the Get Records criteria rather than loading all records and filtering client-side in the screen component

## Auto-Launched Flows — Invocation Contexts

**Invocation context determines what is permitted:**

| Invocation context | Callouts allowed | User context | Notes |
|-------------------|-----------------|-------------|-------|
| Record-triggered (Before/After Save) | No | Executing user | Callouts prohibited in the same transaction as DML |
| Apex (`Flow.Interview`) | Yes | Calling Apex context | Callout after `Database.insert` in same tx is still blocked |
| REST API (`/services/data/vX/actions/custom/flow`) | Yes | Authenticated user | Useful for external system triggering |
| Scheduled (Time-based) | Yes | Automated Process | No user context; runs as Automated Process entity |
| Other Flow (subflow) | Inherits parent | Inherits parent | Governor limits shared with parent |
| Process Builder (legacy) | No | Deprecated — migrate to Flow |

**Callout restriction in record-triggered context:**
- External HTTP callouts are never permitted in the same transaction as a DML operation in a record-triggered flow
- To make a callout after a record change, use an After Save flow that invokes an Apex `@InvocableMethod` which enqueues a Queueable job; the Queueable executes the callout in a separate transaction
- Platform Events are the correct decoupled pattern: the record-triggered flow publishes a Platform Event (permitted), and an external subscriber or Flow-triggered-by-event makes the callout in a separate context

**Scheduled flows — runaway risk:**
- A Scheduled Flow with no end condition or record-scope filter runs indefinitely, consuming Apex CPU time in every scheduled execution
- Define the scheduled flow's record scope using filter criteria that return zero records when no action is needed — the flow fires but processes nothing
- Document the expected end date or completion condition for every scheduled flow in the deployment notes

## Flow + Apex: Order of Execution & Dual Automation Risk

**Salesforce order of execution (simplified, per save operation):**
1. Before triggers (Apex)
2. System validation (required fields, unique fields, field format)
3. Before Save record-triggered Flows
4. After triggers (Apex)
5. Assignment rules, Auto-response rules
6. After Save record-triggered Flows
7. Escalation rules
8. Processes (Process Builder — deprecated)
9. Workflow Rules field updates (deprecated) → re-triggers before/after triggers if fields changed
10. `@future` methods / Queueable jobs (deferred, new transaction)

**Key consequences:**
- An Apex before-trigger and a Before Save Flow both run in the same transaction — if both set the same field, the last one to execute wins; the order is deterministic but easy to miss
- Workflow Field Updates (deprecated) re-trigger Apex triggers — a flow that causes a field update that matches a Workflow Rule criterion can trigger an unexpected secondary trigger execution
- Any automation that causes a field to change can trigger other automations — map the full trigger/flow/workflow chain before adding a new element

**Dual automation ownership — one operation, one owner:**
- Every field update, record creation, and related-record operation must have a single documented automation owner: either Flow or Apex, never both
- When both Flow and an Apex trigger update the same field in the same transaction, the result is the value set by the last executor in the order of execution — this is undefined from a business perspective
- Maintain an Automation Registry (even a simple spreadsheet) documenting which automation type owns each operation per object

**Migrating from Process Builder and Workflow Rules:**
- Salesforce has announced the retirement of Workflow Rules and Process Builder — all active automations on these platforms should be migrated to Flow in a planned migration sprint
- Do not add new logic to Process Builder or Workflow Rules — all new requirements go to Flow
- Before deploying a new record-triggered Flow on an object, audit all active Process Builder processes and Workflow Rules on the same object for overlap and consolidate

## Flow Versioning & Metadata Hygiene

**Version management rules:**
- Only one active version per flow at any time — Salesforce allows multiple active versions but this creates ambiguity about which version runs
- After UAT sign-off on a new version, deactivate and delete all prior versions — do not archive them in the org; version history is in the source control repository
- Use flow labels and descriptions as documentation — record what changed in each version and why

**Naming convention:**
- Recommended: `[Object]_[Trigger/Type]_[Purpose]` — e.g. `Account_AfterSave_CreateOnboardingCase`, `Contact_Screen_DataCapture`
- Include the automation type in the name so the Automation Registry can be searched and sorted by type and object
- Do not use spaces or special characters — use underscores; flow API names are used in deployments and test references

**Orphaned and unused flows:**
- Deactivated flows accumulate as metadata debt — they do not run but they do consume metadata storage and appear in admin searches
- After a migration sprint (Process Builder → Flow), delete all deactivated Process Builder processes once the replacement Flows have been UAT-signed-off
- A quarterly metadata hygiene review should include: listing all deactivated flows older than 90 days and deleting those with no pending migration work

## Subflows & Reusability

**When to use subflows:**
- Identical logic needed in 3+ flows — extract to a subflow; single point of maintenance
- Complex conditional branching that would make the parent flow hard to read — encapsulate in a subflow with a clear interface (input/output variables)
- Shared error handling pattern — a generic error-logging subflow called from all flows that need error persistence

**Subflow variable passing:**
- Define explicit input and output variables on the subflow — do not use global variables for subflow communication
- Primitive types (Text, Number, Boolean, Date) pass by value; record types (SObject variables) pass by reference — changes to a record variable inside a subflow are visible in the calling flow
- Always map output variables back to calling-flow variables after the subflow returns — unbound output variables are silently discarded

**Fault propagation from subflows:**
- A fault in a subflow that is not caught by the subflow's own fault path terminates the parent flow with a generic error message
- The subflow should either catch its own faults (log + graceful exit) or explicitly re-throw to the parent using the `{!$Flow.FaultMessage}` variable on the fault connector output
- Never design a subflow that silently absorbs errors and returns a success response — the caller cannot distinguish a successful subflow from a silently-failed one

## Common Failure Modes in Flow Delivery

1. **Get Records inside a loop** — 200-record bulk trigger calls Get Records 200 times; SOQL limit hit at 101; entire DML batch rolled back
2. **Missing fault connector on Update Records** — validation rule violation in a batch of 200 causes a silent partial failure; 150 records updated, 50 silently dropped; data inconsistency never detected
3. **Flow and Apex trigger both DMLing the same field** — last writer wins based on order of execution; field value is unpredictable; defect only appears when both automations fire simultaneously under bulk
4. **Get Records with no null check** — record type without any matching children; Flow references the null collection; NullPointerException at runtime; no fault connector; user sees generic error with no support path
5. **Scheduled Flow with no end condition** — runs forever; processes every record in the org every night; consumes Batch Apex flex queue slots; blocks critical nightly batch jobs
6. **Screen flow executes DML mid-wizard** — user presses Back after DML executes; related record already created; data left in inconsistent half-completed state; no rollback
7. **Subflow invoked without fault connector** — subflow throws on a validation rule; parent flow has no fault connector on the subflow element; entire parent flow transaction fails with an unhandled error
8. **5+ stale flow versions not cleaned up** — admin cannot determine which version is active during incident response; stale versions reference decommissioned fields, blocking metadata deployments

## MANDATORY CHECK LIST

1. Every Get Records, Create Records, Update Records, Delete Records, and Apex Action element has a fault connector wired to an explicit error path
2. Every Get Records result has a null check (Decision: `IS NULL` / `IS NOT NULL`) before the collection is referenced downstream
3. No Get Records or DML elements inside loop iterations — collect outside the loop, process in memory, DML once after the loop
4. Sub-flows have a fault connector on the parent — faults propagate up and are not silently swallowed at the subflow boundary
5. Before Save context used for field updates on the triggering record; After Save used for related-record creation — not reversed
6. Flow does not execute DML on the triggering record in an After Save context without explicit governor limit analysis of the secondary save cycle
7. Record-triggered flow entry criteria are as restrictive as possible — no "always runs" flow that filters internally
8. No external HTTP callout in a record-triggered flow context — callouts delegated to Queueable via `@InvocableMethod`
9. Scheduled flows have a finite record scope or documented end condition — no runaway infinite schedule
10. Screen flows validate all required user inputs before DML elements execute — no null/blank DML submission path
11. DML in screen flows is deferred to the final confirmation step — no mid-wizard DML that cannot be reversed if the user navigates back
12. Only one active version per flow at any time — all prior versions deactivated and deleted after UAT sign-off
13. Flow name follows the agreed naming convention — object, trigger type, and purpose present in the name
14. No active Workflow Rules or Process Builder processes on the same object performing the same operation as the new Flow — dual automation ownership eliminated
15. Subflow output variables explicitly bound to calling-flow variables after return — no unbound silently-discarded outputs
16. Flow + Apex automation ownership documented per object per operation in the Automation Registry
17. Record-triggered flow tested with a 200-record bulk DML import — not only single-record UI test

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | Get Records inside a loop in a record-triggered flow — SOQL limit failure on any 200-record bulk DML, full batch rollback; Missing fault connector on Update Records in a financial record update flow — silent partial failure leaves accounts in inconsistent billing state |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | Flow and Apex trigger both performing DML on the same field in the same transaction — last-writer-wins produces unpredictable field values at scale; Scheduled Flow with no end condition or scope filter — consumes Batch Apex flex queue slots, delays critical nightly batch jobs; Subflow invoked without fault connector on parent — unhandled exception terminates the entire parent flow transaction with no error path |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | Get Records with no null-check downstream — fails on any record that has no related children; silent at low volume, surfaces when a new record type is added; Screen flow executes DML before final confirmation — mid-wizard navigation leaves data in inconsistent state; Active Process Builder processes not migrated before new Flow deployed on same object — dual automation ownership with undefined interaction |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | 5+ stale deactivated flow versions not cleaned up — metadata clutter, admin confusion during incident response; Flow name violates naming convention — automation audit is manual and error-prone; Duplicated logic across two auto-launched flows that could be a shared subflow — logic drift accumulates when one copy is updated and the other is not |
