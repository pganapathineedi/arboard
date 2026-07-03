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
