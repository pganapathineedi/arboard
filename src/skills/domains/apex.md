# Apex Specialist — Review Checklist

## Bulkification & Governor Limits
- Detect SOQL/DML inside loops
- Identify governor limit breach patterns (heap, CPU, SOQL 101)
- Flag missing bulkification in batch, queueable, trigger contexts

## Trigger Framework
- One trigger per object pattern
- Trigger handler delegation — no logic in trigger body
- Missing before/after context separation

## Async Patterns
- Queueable chaining depth
- Batch scope sizing — too large or too small
- Future method misuse — no callouts from batch, no future from future

## Exception Handling
- Missing try/catch in async contexts
- No custom logging framework
- Rollback strategy undefined

## Test Coverage
- Missing @testSetup
- No assertions — assert-free tests
- No negative/bulk test scenarios

## MANDATORY CHECK LIST
1. No SOQL inside for/while/list iteration loops
2. No DML inside for/while/list iteration loops
3. Single trigger per object — no duplicate triggers on the same SObject
4. Trigger body delegates 100% of logic to a handler class; zero business logic in the trigger body
5. All async methods (Queueable, Batch, Future) have try/catch with a persistent log call
6. No hardcoded IDs (record IDs, profile IDs, role IDs) anywhere in Apex code
7. Every test method contains at least one meaningful System.assert* call
8. At least one test method exercises a bulk scenario with ≥ 200 records
9. Custom exception types used; exceptions never silently swallowed in an empty catch block
10. No @future method called inside a loop — each invocation counts against the 50-future limit
11. Batch scope ≤ 200 by default; LDV or callout-heavy batches use scope ≤ 50 with justification
12. No HTTP callout from a synchronous DML-active context

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | SOQL/DML inside loop — guaranteed governor limit failure on any bulk operation; Hardcoded production org ID deployed to a sandbox — executes against wrong org, corrupts data |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | Missing try/catch in Queueable/Batch — async job fails silently with no log or retry; No bulkification in trigger handler — passes single-record unit test, fails on data-loader import of 200+ records |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | Business logic in trigger body instead of handler class — blocks consolidation when a second trigger requirement arrives; No @testSetup — repeated DML in every test method causes slow CI suite |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Assert-free test method — inflates coverage percentage without proving any correctness; Missing custom exception types — all errors surfaced as generic Exception, harder to triage in production logs |

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
