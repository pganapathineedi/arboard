# Salesforce Profiles & Permissions — Grounding Knowledge

## Core design principles

**Profiles = baseline minimum.** Every user needs a profile, but profiles should carry only the minimum required for the user type (login hours, page layouts, record types, app visibility). Object CRUD and FLS belong in permission sets.

**Permission Sets + Permission Set Groups = scalable access model.** PSGs bundle related PSs for assignment. Users get PSGs, not individual PSs. This enables clean audits and role-based access reviews.

**OWD drives the floor.** Organisation-Wide Defaults set the sharing baseline. Everything above OWD (sharing rules, role hierarchy, Apex Sharing, manual sharing) must be explicitly designed. A Private OWD with no sharing rules = no access for most users.

**Least privilege always.** Every profile, PS, integration user, and connected app should have the minimum permissions required to perform their function. "View All / Modify All" is an escalation path, not a default.

## Internal vs external user model

| Attribute | Internal Users | External Users (Experience Cloud) |
|-----------|---------------|----------------------------------|
| License | Salesforce / Platform | Customer Community / Partner Community / Experience Cloud |
| Profile base | Standard profiles + custom | Customer Community / Partner Community profiles |
| OWD visibility | Standard org OWD | Controlled by sharing sets, sharing groups |
| Guest user | N/A | Guest profile — most restrictive, no login |
| Data boundary | Full internal org access per permissions | Must be explicitly restricted via OWD + sharing |

## Guest user hardening checklist

- Object permissions: Read only on explicitly required objects. No Create/Edit/Delete.
- Field permissions: FLS Read only on non-sensitive fields. No PII access.
- Sharing: Guest user sharing rules must be explicitly defined. Default = no access.
- Apex: Any Apex classes accessible without login must be reviewed for data exposure.
- Connected apps: Guest sessions must not have API-Enabled permission.
- ASD Essential Eight relevance: Guest user misconfiguration is a common attack vector in public-sector Salesforce implementations.

## Permission set group patterns

**Recommended PSG structure:**
```
PSG: [Role]-Base        → Core object access for the role
PSG: [Role]-Extended    → Additional capabilities (reports, dashboards, exports)
PSG: [Role]-Integration → API/integration permissions (assigned to integration users only)
```

Muting PSs sit outside PSGs and remove permissions that would otherwise be inherited.

## OWD and sharing model matrix

| OWD Setting | Sharing Rule requirement | Role Hierarchy required |
|-------------|--------------------------|------------------------|
| Public Read/Write | Optional | Optional |
| Public Read Only | Sharing rules for write access | Recommended |
| Private | Required for cross-user access | Required for management visibility |
| Controlled by Parent | Inherited from parent OWD | Inherited |

## FLS sensitive field categories (flag if not addressed in SDD)

- PII: Name, DOB, TFN/SSN, Address, Email, Phone
- Financial: Account balance, credit limit, payment details
- Health: Diagnosis, medication, care plan fields
- Identity: Government ID, passport, licence number
- Credentials: Password hints, security questions

## Common failure modes in SI delivery

1. Delivering profiles with object permissions "because it's faster" — creates long-term debt
2. Forgetting to set FLS after adding custom fields — field appears blank to users, reported as bug
3. OWD set to Private for new object without designing sharing rules — data inaccessible at go-live
4. Guest user profile copied from Community User profile — inherits too many permissions
5. Integration user given System Administrator profile — unauditable and insecure
6. No muting PS designed for restricted sub-groups — permissions leak from PSG to all members

## Metadata-grounded review (when org metadata is available)

When current profile XML or permission set XML is provided as context:
1. Identify objects/fields where current state has permissions the design does not address
2. Flag where design proposes permissions not currently granted (change control risk)
3. Confirm OWD settings in metadata match the SDD stated baseline
4. Cross-reference userLicense values against proposed community/experience cloud architecture

## MANDATORY CHECK LIST

Before submitting output, confirm you have checked:
- [ ] Profile count and design philosophy
- [ ] PSG architecture and PS bundling
- [ ] FLS on all sensitive field categories (PII, financial, health)
- [ ] OWD declared for all key objects
- [ ] Sharing rules consistent with OWD
- [ ] Role hierarchy present for Private OWD objects
- [ ] Guest user profile hardening
- [ ] External/internal data boundary
- [ ] Integration user and connected app permissions
- [ ] Muting permission sets where needed

## SEVERITY RUBRIC

| Severity | Criteria |
|----------|----------|
| CRITICAL | Guest user over-permissioning; external user can access internal data; Modify All / View All on non-admin non-integration profiles |
| HIGH | Missing FLS on PII/financial/health fields; OWD declared Private with no sharing model; role hierarchy absent for private objects |
| MEDIUM | Profile-centric design (>5 profiles with object permissions); no PSG architecture documented; integration user over-permissioned |
| LOW | Individual PS assignment without PSG; naming conventions inconsistent; muting PS not considered |
