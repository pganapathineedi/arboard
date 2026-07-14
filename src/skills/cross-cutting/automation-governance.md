# Automation Governance & Conflict Prevention

## Core Rule (FP-010)
Every Salesforce object must have a single documented automation owner. Mixed automation — Apex triggers + Record-Triggered Flows + Workflow Rules + Process Builder on the same object — creates unpredictable execution order, governor limit conflicts, and maintenance nightmares.

## Automation Decision Matrix
1. Record-Triggered Flow — default for declarative automation
   - Before-save for field updates (no DML, fastest)
   - After-save for related record operations
2. Apex Trigger — when Flow cannot handle the requirement
   - Complex logic, external callouts, governor limit management
   - Always use trigger handler pattern
3. Scheduled Flow / Batch Apex — for time-based or bulk operations
4. Never use — Workflow Rules (legacy), Process Builder (legacy)

## One Trigger Per Object
- Single Apex trigger per object — no exceptions
- All trigger logic delegated to handler class
- Trigger body contains zero business logic

## Flow + Apex Coexistence Rules
- Document which automation owns which operation on each object
- Never have Flow and Apex both performing DML on same record in same transaction
- Use Custom Metadata to enable/disable automation for deployment control
- Establish automation registry — document every active automation per object

## Order of Execution Risks
- Before triggers → validation rules → before flows → after triggers → after flows
- Recursive trigger protection — static Boolean flag or TriggerContext pattern
- Bulk operations will expose conflicts invisible in unit tests

## Legacy Automation Migration
- Workflow Rules and Process Builder — migrate to Flow before go-live
- Never go live with active Process Builder and new Flow on same object

## Relevant Agents
- sf-apex, sf-flow, sf-patterns, sf-judge

## MANDATORY CHECK LIST
1. Automation registry exists — every active automation per object documented (Apex trigger, Flow, Workflow Rule, Process Builder)
2. Single Apex trigger per object enforced — no two triggers on the same SObject
3. Trigger body contains zero business logic — 100% delegated to a handler class
4. No active Workflow Rules or Process Builder on objects that have new Record-Triggered Flows — migration complete before go-live
5. No Flow and Apex trigger both performing DML on the same record in the same transaction
6. Recursive trigger protection implemented — static Boolean flag or TriggerContext pattern in place
7. Custom Metadata flag used to disable automation per environment — surgical disable without a code change
8. Order of execution documented per object — which automation fires in which phase (before trigger, validation, before flow, after trigger, after flow)
9. Scheduled flows have a finite record scope or an explicit end condition — no runaway infinite schedule
10. Before-save flows used for field updates instead of after-save — avoids an extra DML record write per trigger execution
11. Automation ownership per object assigned to a single team — no shared dual-ownership causing coordination gaps
12. All record-triggered automations tested with a 200-record bulk import — unit tests alone are insufficient

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | Active Workflow Rule and new Record-Triggered Flow both on the same object — double execution corrupts field values and creates duplicate related records; Two Apex triggers on the same SObject with no guaranteed ordering — race condition on bulk load causes non-deterministic data state |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | No recursive trigger protection — a self-referential field update causes trigger recursion, hitting the CPU governor limit on any update; Process Builder and Apex trigger coexisting on the same object — order of execution is unpredictable and breaks under bulk API load |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | Automation registry not maintained — org accumulates undocumented flows and triggers, future changes cause undetected conflicts; After-save flow used for field updates where before-save would suffice — an extra DML write per record on every trigger execution |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Scheduled flow has no end condition — runs indefinitely against an empty or shrinking record set, consuming processing resources; Custom Metadata disable flag absent — automation cannot be surgically disabled during a deployment without a code push |
