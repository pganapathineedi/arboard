# Apex Specialist — Review Checklist

## Bulkification & Governor Limits

- **SOQL inside loops** — every iteration consumes one of the 100-query synchronous limit; a 200-record trigger batch exhausts the limit by the 101st record
- **DML inside loops** — every insert/update/delete inside a loop consumes one of the 150-statement limit; bulk DML from Data Loader or Batch triggers the failure
- **Heap size violations** — accumulating large strings or collections inside loops; 6 MB synchronous, 12 MB async
- **CPU time limit** — complex computation or nested loops on large collections; 10 000 ms synchronous, 60 000 ms async
- **Callout limit** — 100 callouts per synchronous transaction; 50 `@future` calls per transaction
- **Platform Event publish limit** — 150 publish calls per transaction; use `EventBus.publish(List<Event__e>)` for bulk publish
- **Standard bulkification pattern**: collect all Trigger.new record IDs into a Set, execute one SOQL outside the loop, load into Map<Id, SObject>, then O(1) map lookups inside the loop
- **Cross-object rollups in loops** — each formula field traversal in a loop is not a SOQL query, but map-based pre-fetch of related records is still required for correctness

## Trigger Framework

- **One trigger per object** — multiple triggers on the same SObject execute in undefined order; consolidate into a single trigger before adding functionality
- **Handler delegation** — trigger body must contain exactly one dispatching call; no SOQL, DML, or business logic in the trigger file itself
- **before / after context separation** — `before` context: field validation, defaulting, and manipulation on Trigger.new (no query for the same records); `after` context: related-record creation and cross-object updates
- **Recursive prevention** — static Boolean flag or a static recursion counter; flag must be reset correctly for each transaction context
- **Order of execution awareness** — before triggers → system validation → after triggers → assignment rules → workflow → processes → `@future` — design with this sequence in mind when mixing automation types
- **fflib trigger delegation pattern** — `fflib_SObjectDomain.triggerHandler(MyObjects.class)` is the single permitted trigger body line when using Enterprise Patterns (see fflib section below)

## Async Patterns

**Selection criteria — use the right tool:**

| Tool | Use when | Avoid when |
|------|----------|------------|
| `@future` | Single non-chained HTTP callout; no complex state needed | Called inside a loop; called from Batch `execute()`; state must be passed between jobs |
| Queueable | Async processing of 1–200 records; need to chain jobs (max 5 deep); need to pass complex object state | Must iterate millions of records; need Database.Stateful across chunks |
| Batch Apex | Processing millions of records with cursor-based chunking; need `Database.Stateful`; LDV operations | Small-volume async tasks — Batch occupies flex queue slots shared across the org |
| Scheduled | Fire at a time or interval; must call `Database.executeBatch()` or `System.enqueueJob()` from `execute()` | Long-running logic directly in `Schedulable.execute()` — offload to Batch or Queueable instead |

- **Queueable chaining depth** — maximum 5 levels deep synchronously; monitor and cap chain length explicitly
- **Batch scope sizing** — default ≤ 200; for callout-heavy batches ≤ 50; for LDV pure-DML batches up to 2000 with explicit justification
- **`@future` misuse** — cannot make callouts from `Batch execute()` context; cannot call `@future` from inside another `@future`; prefer Queueable for almost all new async code
- **Try/catch in all async contexts** — an unhandled exception in Queueable or Batch `execute()` marks the job failed with no retry; persistent error log is mandatory

## Security: WITH SHARING, CRUD/FLS, and stripInaccessible

**Sharing keyword selection:**

| Layer | Keyword | Rationale |
|-------|---------|-----------|
| Controller (`@AuraEnabled`, `@RestResource`, `@InvocableMethod`) | `with sharing` | Entry point for user-context calls; enforce row-level security here |
| Service / Domain / Selector (fflib layers) | `inherited sharing` | Defer to the caller's sharing context; avoids accidental escalation or restriction |
| Utility / inner class (no keyword set) | Inherits outer class | Acceptable only when explicitly documented; never the default for data-access classes |

- **Missing `with sharing`** on a public-facing class runs queries and DML in system context — bypasses record-level security entirely; external partner can see all records
- **CRUD enforcement**: check `Schema.sObjectType.Account.isCreateable()` / `isAccessible()` / `isUpdateable()` / `isDeletable()` before any DML or SOQL on that object
- **FLS enforcement**: use `Security.stripInaccessible()` rather than per-field `Schema.fields.X.isAccessible()` — handles all fields in a single call

```apex
// Recommended: stripInaccessible removes inaccessible fields before returning to caller
SObjectAccessDecision decision = Security.stripInaccessible(
    AccessType.READABLE, accountList
);
List<Account> safeList = (List<Account>) decision.getRecords();
```

- **stripInaccessible vs manual FLS check** — `stripInaccessible` silently removes fields the user cannot see; manual FLS throws if you try to access a disallowed field; prefer `stripInaccessible` for read paths, CRUD checks for write paths
- **Guest user exposure** — Experience Cloud guest user has no ownership and no record-level access in Private OWD; any class reachable from a guest REST call or `@AuraEnabled` endpoint must use `with sharing` unconditionally

## Platform Cache

- **Org Cache vs Session Cache** — Org cache is shared across all users in the org (TTL up to 172 800 s / 48 h); Session cache is per-user session (TTL up to 28 800 s / 8 h); choose based on whether the data is user-specific
- **Partition required** — a Platform Cache Partition must be configured in Setup before any code can use the cache; always null-check the partition before use
- **Cache-aside pattern** (the standard Apex usage):

```apex
Cache.OrgPartition part = Cache.Org.getPartition('local.MyPartition');
List<Currency__mdt> rates = (List<Currency__mdt>) part.get('currencyRates');
if (rates == null) {
    rates = [SELECT DeveloperName, Rate__c FROM Currency__mdt];
    part.put('currencyRates', rates, 3600); // TTL 1 hour
}
return rates;
```

- **Transactional visibility** — cache writes are not visible to other transactions until the current transaction commits; do not read back a cache value written in the same transaction and expect it to be present
- **Not suitable for**: frequently-updated records, data requiring 100% consistency with the database at all times, sensitive or PII data (eviction is not guaranteed and is not auditable)
- **Ideal for**: Custom Metadata or Custom Setting lookups, expensive multi-object queries used across many requests, reference data (currency rates, country lists, product categories)

## Test Class Standards

- **`@isTest(SeeAllData=false)`** — this is the default since API v24 and must never be overridden; `SeeAllData=true` makes tests depend on org data, fails in scratch orgs and fresh sandboxes, and makes results non-deterministic
- **Standard pricebook in tests** — use `Test.getStandardPricebookId()`, not a hardcoded ID; this is the only permitted way to access the standard pricebook in a test context
- **`@testSetup`** — shared data created once for all test methods in the class; reduces cumulative DML time across the test suite; use for heavyweight data setup that all methods share
- **Test data factories** — create a dedicated `TestDataFactory` or `TestDataBuilder` class that returns fully populated SObjects; single point of maintenance; never duplicate test data creation inline across test classes
- **Assert counts** — every test method must contain at least one `System.assertEquals`, `System.assertNotEquals`, or `System.assert`; assert the business outcome, not just the absence of an exception
- **Bulk test requirement** — at least one test method must invoke the code under test with ≥ 200 records; single-record tests do not validate bulkification
- **Negative tests** — test validation rule violations, CRUD errors, exception paths, and unauthorised-access scenarios; a class that only has happy-path tests has not been tested
- **`System.runAs()`** — always test security-sensitive code with a purpose-built test user to validate WITH SHARING behaviour and FLS enforcement
- **`@TestVisible`** — use on private fields and methods to allow mock injection in test classes without breaking encapsulation; never promote a private member to public purely for test access

## Mixed DML Error Patterns

**Setup objects** (cannot be mixed with non-setup DML in the same transaction): `User`, `Profile`, `PermissionSet`, `PermissionSetGroup`, `RoleOrTerritory`, `Territory2`, `Group`, `GroupMember`

**Non-setup objects**: `Account`, `Contact`, `Case`, all custom objects, most standard objects

- **Rule**: inserting or updating a setup object and a non-setup object in the same Apex transaction throws `System.TypeException: DML operation ... not allowed` — this is a platform constraint that cannot be caught with try/catch; it must be prevented by design
- **Most common occurrence**: test class creates a `User` record then immediately inserts an `Account` or `Contact` in the same test method
- **Fix in test classes**: wrap setup-object DML in `System.runAs(adminUser) { insert testUser; }` — this executes in a separate DML context from the test method's non-setup operations
- **Fix in production code**: split setup-object and non-setup DML across two separate async contexts — first Queueable creates the User; on completion, enqueues a second Queueable to create the linked Contact
- **Platform automation risk**: a record-triggered Flow or Process Builder fired by non-setup DML cannot insert setup objects in the same transaction — design the flow to enqueue a Queueable for that operation

## Exception Handling

- **Try/catch in all async contexts** — Queueable, Batch `execute()`, `@future`: an unhandled exception marks the job failed with no alerting unless you log it
- **Custom exception types** — extend `Exception` per domain (`ContractException`, `IntegrationCalloutException`); enables targeted catch blocks and filtering in production logs
- **Never swallow exceptions** — an empty `catch (Exception e) {}` hides errors silently; at minimum log the exception type, message, and stack trace to a custom log object or Platform Event
- **Rollback strategy** — document whether the caller expects an exception to bubble up (caller rolls back) or a result object indicating failure (caller handles gracefully); Batch and Queueable must return failure state via a result record or Platform Event, not a re-thrown exception

## Common failure modes in Apex delivery

1. **SOQL in trigger loop** — code passes single-record dev test; Data Loader batch of 200 throws "Too many SOQL queries: 101"; entire DML batch rolled back
2. **Logic in trigger body** — second caller (Batch, REST endpoint) cannot reuse the trigger logic; duplicate implementation diverges; bug in one path not fixed in the other
3. **Batch Apex for small-volume async** — Batch occupies flex queue slots; concurrent batch demand queues up; nightly critical batch delayed past its SLA
4. **Missing `with sharing` on REST resource** — passes internal QA (admin user sees all records); external user retrieves another partner's contracts in UAT security review
5. **`SeeAllData=true` in test class** — passes in developer sandbox; fails in CI scratch org where no pricebook or reference data exists; release blocked
6. **Hardcoded record ID** — passes in sandbox where the queue ID is valid; deployed to production where the same queue has a different ID; runtime query returns zero results; cases assigned to null owner
7. **DML inside loop** — single-record smoke test passes; 200-record migration batch hits "Too many DML statements: 151"; 150 records succeed, 50 fail with no partial commit
8. **Mixed DML error** — test creates a User and then an Account in the same method; throws TypeException; blocks the entire test class from running; platform constraint not catchable at runtime

## MANDATORY CHECK LIST

1. No SOQL inside `for`/`while`/`list` iteration loops — collect IDs, query once, use Map for lookups
2. No DML inside `for`/`while`/`list` iteration loops — accumulate in a List, DML once after the loop
3. Single trigger per SObject — no duplicate triggers on the same object
4. Trigger body delegates 100% of logic to a handler class; trigger file contains zero business logic
5. All async methods (Queueable, Batch, `@future`) have try/catch with a persistent error log call
6. No hardcoded record IDs (org IDs, queue IDs, profile IDs, role IDs) — use DeveloperName queries or Custom Metadata at runtime
7. Every test method contains at least one meaningful `System.assert*` call verifying a business outcome
8. At least one test method exercises a bulk scenario with ≥ 200 records
9. `@isTest(SeeAllData=false)` on every test class — `SeeAllData=true` is not acceptable without a documented, approved exception
10. All classes callable from external users (`@AuraEnabled`, `@RestResource`, Experience Cloud) declare `with sharing`; internal service layers use `inherited sharing`
11. CRUD and FLS enforced on all public-facing data access paths — use `stripInaccessible` for reads, `isCreateable()`/`isUpdateable()` for writes
12. No `@future` method called inside a loop — each call counts against the 50-future-per-transaction limit
13. Batch scope ≤ 200 by default; callout-heavy batches ≤ 50 with justification in comments
14. No HTTP callout from a synchronous DML-active context (Trigger, Batch `execute()` without callout=true)
15. Mixed DML patterns (setup + non-setup objects) separated into distinct transaction contexts — test classes use `System.runAs()` for User creation
16. Custom exception types defined per domain; no empty catch blocks that silently swallow exceptions
17. Platform Cache usage null-checks the partition and documents TTL and invalidation strategy

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | SOQL inside a loop in a trigger — guaranteed governor limit failure on any bulk DML, rolling back the full batch with data loss; Missing `with sharing` on a REST resource used by Experience Cloud — external users retrieve other partners' records; Hardcoded production org record ID deployed across orgs — runtime query returns zero results, records assigned to null owner |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | DML inside a loop — passes single-record smoke test, fails on any 200-record bulk operation; Missing try/catch in Queueable or Batch — async job fails silently with no error log or retry; Batch Apex used for small async tasks — occupies flex queue slots, delays critical nightly batch under concurrent load; Mixed DML in production Queueable — throws TypeException at runtime for every execution, not catchable |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | Business logic in trigger body — second caller cannot reuse logic; duplicate implementations diverge; No `@testSetup` — repeated heavy DML in every test method causes slow CI suite; `SeeAllData=true` in test class — test passes in sandbox, fails in scratch org and CI; Inline SOQL outside Selector class (fflib) — violates separation of concerns, blocks mock injection |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Assert-free test method — inflates coverage percentage without proving correctness; Missing custom exception types — all errors surfaced as generic `Exception`, harder to triage in production logs; No Platform Cache partition null-check — throws `Cache.Org.CacheException` on first deploy to a new org; `@future` used where Queueable would allow chaining and state passing |

---

## fflib Apex Enterprise Patterns

> Source: https://fflib.dev/docs — apply these patterns whenever an SDD, design doc, or code review involves enterprise Apex architecture.

### Architecture Overview

fflib enforces **Separation of Concerns**, **DRY**, **SOLID**, and **Dependency Injection** across four layers. The Application Factory wires everything via Custom Metadata bindings — no hardcoded class references at call sites.

| Layer | Purpose | Naming |
|-------|---------|--------|
| Selector | All SOQL for a given SObject | `AccountSelector.cls` |
| Domain | SObject manipulation + trigger handlers | `Accounts.cls` (plural) |
| Service | Business logic; orchestrates Domain + Selector; owns UnitOfWork | `BillingService.cls` |
| Implementation | Exposes Service to callers (Controller, Batch, REST, Flow) | `AccountController.cls` |

Supporting modules: `fflib-apex-common` (core), `fflib-apex-mocks` (unit test mocking via Stub API), `force-di` (DI library), `at4dx` (advanced SFDX patterns).

---

### Selector Layer

**Purpose:** Centralised SOQL. Reusable field sets. Built-in FLS/CRUD security checks (can be disabled per call). Never write inline SOQL outside a Selector.

**Naming:** `<SObjectName>Selector.cls` — drop `__c`. e.g. `PortalUser__c` → `PortalUserSelector.cls`

**Three required artefacts:** Interface class · Main Selector class · Custom Metadata binding

```apex
/* IPortalUserSelector.cls */
public interface IPortalUserSelector extends IApplicationSObjectSelector {
  List<PortalUser__c> selectById(Set<Id> idSet);
  PortalUser__c selectById(Id recordId);
  List<PortalUser__c> selectAll();
}
```

```apex
/* PortalUserSelector.cls */
public inherited sharing class PortalUserSelector
    extends ApplicationSObjectSelector implements IPortalUserSelector {

  private List<String> additionalSObjectFieldList = new List<String>{
    'Id', 'SSOId__c', 'FirstName__c', 'LastName__c', 'DisplayName__c'
  };

  public static PortalUserSelector newInstance() {
    return (PortalUserSelector) Application.Selector.newInstance(PortalUser__c.SObjectType);
  }
  public Schema.SObjectType getSObjectType() { return PortalUser__c.SObjectType; }
  public fflib_QueryFactory getQueryFactory() { return new fflib_QueryFactory(getSObjectType()); }
  public override List<Schema.SObjectField> getSObjectFieldList() { return new List<Schema.SObjectField>(); }
  public List<String> getSObjectFieldListWithRelatedFields() { return this.additionalSObjectFieldList; }

  public List<PortalUser__c> selectById(Set<Id> idSet) {
    if (idSet.isEmpty()) return new List<PortalUser__c>();
    fflib_QueryFactory qf = getQueryFactory();
    qf.selectFields(getSObjectFieldListWithRelatedFields());
    qf.setCondition('Id IN :idSet');
    return Database.query(qf.toSOQL());
  }

  public PortalUser__c selectById(Id recordId) {
    List<PortalUser__c> records = selectById(new Set<Id>{ recordId });
    return records.isEmpty() ? null : records[0];
  }

  public List<PortalUser__c> selectAll() {
    fflib_QueryFactory qf = getQueryFactory();
    qf.selectFields(getSObjectFieldListWithRelatedFields());
    return Database.query(qf.toSOQL());
  }
}
```

**Custom Metadata (ApplicationFactory_SelectorBinding):**
| Field | Value |
|-------|-------|
| Binding SObject | `PortalUser__c` |
| To | `PortalUserSelector` |

**Key rules:**
- Use `fflib_QueryFactory` for all queries — enables sub-selects and composability
- `inherited sharing` always — sharing enforcement belongs in the Controller
- Guard against empty input sets before issuing a query

---

### Domain Layer

**Purpose:** SObject manipulation and trigger handler methods, centralised per object. Does NOT persist — pass a `UnitOfWork` in for any DML.

**Naming:** Plural SObject name. e.g. `PortalUser__c` → `PortalUsers.cls`

**Three required artefacts:** Interface · Domain class · Custom Metadata binding

```apex
/* IPortalUsers.cls */
public interface IPortalUsers extends IApplicationSObjectDomain {
  Map<String, Boolean> validateUserSso();
  Map<String, Boolean> validateUserSso(List<PortalUser__c> portalUsers);
}
```

```apex
/* PortalUsers.cls */
public inherited sharing class PortalUsers
    extends ApplicationSObjectDomain implements IPortalUsers {

  // Boilerplate
  public static IPortalUsers newInstance(List<PortalUser__c> records) {
    return (IPortalUsers) Application.Domain.newInstance(records);
  }
  public static IPortalUsers newInstance(Set<Id> recordIds) {
    return (IPortalUsers) Application.Domain.newInstance(recordIds);
  }
  public PortalUsers(List<PortalUser__c> records) { super(records); }
  public class Constructor implements fflib_SObjectDomain.IConstructable {
    public fflib_SObjectDomain construct(List<SObject> sObjectList) {
      return new PortalUsers(sObjectList);
    }
  }

  // Trigger handlers
  public override void onBeforeInsert() { validateUserSso(getRecords()); }
  public override void onBeforeUpdate(Map<Id, SObject> existingRecords) {
    validateUserSso(getChangedRecords(new Set<String>{ 'SSOId__c' }));
  }

  // Domain methods
  public Map<String, Boolean> validateUserSso() {
    return validateUserSso((List<PortalUser__c>) getRecords());
  }
  public Map<String, Boolean> validateUserSso(List<PortalUser__c> portalUsers) {
    Map<String, Boolean> result = new Map<String, Boolean>();
    for (PortalUser__c u : portalUsers) { result.put(u.SSOId__c, u.SSOId__c != null); }
    return result;
  }
}
```

**Custom Metadata (ApplicationFactory_DomainBinding):**
| Field | Value |
|-------|-------|
| Binding SObject | `PortalUser__c` |
| To | `PortalUsers.Constructor` |

**Key rules:**
- `getRecords()` returns the full trigger list; `getChangedRecords(fieldSet)` filters to changed-field records only
- Inner `Constructor` class is mandatory — Application Factory uses it to instantiate the Domain
- DML must go via a `UnitOfWork` passed as a method parameter — never call insert/update/delete directly

---

### Service Layer

**Purpose:** All business logic. Caller agnostic — Controllers, Batch, REST, and Flows all use the same Service methods. Creates and commits `UnitOfWork`.

**Naming:** Suffix `Service`, optional prefix for grouping. e.g. `CommunityPortalService.cls`

**Three required artefacts:** Interface · Service class · Custom Metadata binding

```apex
/* ICommunityPortalService.cls */
public interface ICommunityPortalService {
  List<PortalUser__c> getAllPortalUsers();
  Boolean isUserLoggedIn(String portalUserSsoId);
}
```

```apex
/* CommunityPortalService.cls — no boilerplate, pure methods */
public inherited sharing class CommunityPortalService implements ICommunityPortalService {

  public List<PortalUser__c> getAllPortalUsers() {
    IPortalUserSelector selector = (IPortalUserSelector) Application.Selector.newInstance(
      PortalUser__c.SObjectType
    );
    return selector.selectAll();
  }

  public Boolean isUserLoggedIn(String userId) {
    IPortalUsers domain = (IPortalUsers) Application.Domain.newInstance(new Set<Id>{ userId });
    return domain.validateUserSso().get(userId);
  }
}
```

**Custom Metadata (ApplicationFactory_ServiceBinding):**
| Field | Value |
|-------|-------|
| Binding Interface | `ICommunityPortalService` |
| To | `CommunityPortalService` |

**Key rules:**
- `UnitOfWork` is created and `commitWork()` called here — pass down to Domain methods as needed
- Services may call other Services; never call a Controller from a Service
- `inherited sharing` — sharing enforced at the Controller level only

---

### Implementation Layer (Controllers)

**Purpose:** Thin translation layer between callers and Services. Zero business logic.

```apex
public with sharing class PortalUserController {
  @TestVisible
  private static ICommunityPortalService communityPortalService =
    (ICommunityPortalService) Application.Service.newInstance(ICommunityPortalService.class);

  @AuraEnabled(Cacheable=true)
  public static List<PortalUser__c> getAllPortalUsers() {
    return communityPortalService.getAllPortalUsers();
  }
}
```

**Implementation types:** Apex Controller (`@AuraEnabled`), Batch (`Database.Batchable`), Scheduled (`Schedulable`), REST (`@RestResource`), Flow (`@InvocableMethod`).

**Key rules:**
- `with sharing` — Controllers are the only layer where sharing is explicitly enforced
- Mark the static service instance `@TestVisible` so test classes can inject a mock
- `@AuraEnabled(Cacheable=true)` for reads; omit `Cacheable` for DML operations

---

### Triggers

**Pattern:** One trigger per SObject, one line of logic — delegate immediately to the Domain.

```apex
trigger PortalUserTrigger on PortalUser__c (before insert, before update) {
  fflib_SObjectDomain.triggerHandler(PortalUsers.class);
}
```

**Naming:** `<SObjectName>Trigger.trigger` e.g. `PortalUserTrigger.trigger`

Trigger testing is handled by Domain layer test classes — exercise insert, update, and delete paths there.

---

### Unit Of Work

Manages all DML in a single bulkified transaction. Created and committed in the Service layer; passed down to Domain methods.

```apex
// Service layer
fflib_ISObjectUnitOfWork uow = Application.UnitOfWork.newInstance();
domain.someMethodThatRegistersDml(uow);   // Domain registers records
uow.commitWork();                          // Single DML commit point
```

- Register SObjects in parent-before-child order — insert sequence follows registration order
- `uow.registerNew()` / `uow.registerDirty()` / `uow.registerDeleted()` are the only DML primitives
- `commitWork()` called exactly once at the end of the Service method

---

### fflib-Specific Failure Patterns

| ID | Pattern | Severity | Fix |
|----|---------|----------|-----|
| FP-FFLIB-001 | Inline SOQL outside a Selector class | CRITICAL | Move to Selector using `fflib_QueryFactory` |
| FP-FFLIB-002 | DML called directly in Domain or Service (not via UoW) | CRITICAL | Use `uow.registerNew/Dirty/Deleted()`; call `commitWork()` in Service |
| FP-FFLIB-003 | Business logic inside `@AuraEnabled` Controller method | HIGH | Extract to Service method; Controller translates input only |
| FP-FFLIB-004 | Missing interface class for Selector / Domain / Service | HIGH | Create `I***` interface extending the appropriate fflib base interface |
| FP-FFLIB-005 | Missing Custom Metadata binding | CRITICAL | Add `ApplicationFactory_*Binding` record in the target org |
| FP-FFLIB-006 | Logic inside trigger body | HIGH | Move to Domain trigger handler methods (`onBeforeInsert`, etc.) |
| FP-FFLIB-007 | Domain class using `with sharing` instead of `inherited sharing` | MEDIUM | Domain and Service use `inherited sharing`; only Controllers use `with sharing` |
| FP-FFLIB-008 | Constructor inner class missing from Domain | CRITICAL | Application Factory cannot instantiate the Domain without it |

---

### New SObject Full Stack Checklist

| Artefact | Name pattern |
|----------|-------------|
| Selector interface | `IMyObjectSelector.cls` |
| Selector class | `MyObjectSelector.cls` |
| Domain interface | `IMyObjects.cls` |
| Domain class | `MyObjects.cls` |
| Service interface | `IMyObjectService.cls` |
| Service class | `MyObjectService.cls` |
| Controller | `MyObjectController.cls` |
| Trigger | `MyObjectTrigger.trigger` |
| ApplicationFactory_SelectorBinding | SObjectType → Selector class |
| ApplicationFactory_DomainBinding | SObjectType → Domain.Constructor |
| ApplicationFactory_ServiceBinding | Interface → Service class |
