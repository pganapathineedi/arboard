# Integration Architect — Review Checklist

## Named Credential governance
- Hardcoded endpoint URLs or credentials in Apex code bypassing Named Credentials
- Named Credentials configured with incorrect authentication protocol for the target system
- Single shared Named Credential used across multiple integration contexts — no per-integration isolation
- Integration user assigned System Administrator profile instead of a scoped integration profile (see PERM-008)
- Connected app OAuth scopes set to `full` instead of minimum required API surface

## Callout timeout and retry strategy
- No HTTP callout timeout configured — `HttpRequest.setTimeout()` never called; default is unlimited; external latency blocks the Apex transaction
- No retry logic for transient failures (5xx, network timeout, 429 rate limit)
- Retry logic without idempotency keys — POST/PATCH callouts create duplicate records on retry
- Synchronous callout in a Trigger or Batch `execute()` context — exceeds per-transaction callout limits under bulk load
- No circuit breaker or dead-letter queue for repeated callout failures — silent data loss

## Platform Event ordering and delivery guarantees
- Design assumes in-order delivery of Platform Events — guaranteed at-least-once, not ordered
- No ReplayId checkpointing on CometD subscribers — events replayed from wrong offset after consumer restart
- Single high-volume event channel handling multiple event types with different consumer SLAs — fan-out pattern missing
- No idempotency key on Platform Event payload — duplicate event processing on at-least-once redelivery
- Platform Event `ProcessException` not handled — failed publishes silently dropped instead of routed to error channel

## CDC subscription failure modes
- CDC subscriber not processing within the 3-day event retention window — events permanently lost on gap
- No gap-fill reconciliation mechanism designed — CDC outage leaves downstream system in unknown diverged state
- CDC enabled on high-update-frequency objects without event volume analysis — channel saturation risk
- Changed field list not filtered at subscription — full record payload transmitted even when only one field changed
- CDC and record-triggered Flow both consuming the same object changes — double processing risk

## OAuth token refresh patterns
- Connected app uses short-lived access tokens with no automatic refresh — callouts fail silently after expiry
- Access token stored in Custom Settings, Custom Metadata, or a named field visible to non-admin profiles — credential exposure
- No handling for `invalid_grant` response during token refresh — retry loop without re-authorisation path
- JWT Bearer Flow not used for server-to-server integration where no user context is required
- OAuth token lifetime not confirmed with the target API owner — default may be shorter than assumed

## External Service versioning risk
- External Service registered from a live API without version pinning — upstream schema drift breaks callout silently
- No contract-first (OpenAPI spec) approach — API shape discovered by trial and error in production
- No deprecation monitoring process for third-party API versions in use — sunset dates missed
- External Service action called from Flow without a fault connector — callout failure silently aborts the Flow transaction
- External Service schema regenerated against new spec without reviewing breaking changes in consuming Flows and Apex

## Idempotency on outbound callouts
- POST callouts carry no idempotency key — network timeout retry creates duplicate records in the external system
- Batch integration uses sequential upsert with no deduplication check on failure restart — duplicates on resume
- Outbound Message in Workflow does not guarantee exactly-once delivery — receiver must be idempotent; this is never designed
- Platform Event-triggered callout with no idempotency guard — event replay re-triggers the callout, duplicating the operation
- Upsert operations use record Name instead of External ID — name collisions cause incorrect record merges at scale

## Common failure modes in SI delivery
1. **Hardcoded credentials in Apex** — Named Credentials bypassed; credentials discovered in code review after deployment to production
2. **No callout timeout** — external system degradation causes Apex transactions to hang indefinitely; governor limit hit; entire batch job fails
3. **Platform Event ordering assumed** — consumer processes events as received; out-of-order events corrupt downstream state under load spikes
4. **CDC gap with no reconciliation** — planned maintenance window exceeds 3-day retention; downstream database diverges silently; no alert fired
5. **OAuth token expires mid-session** — access token cached in Custom Settings expires; all callouts return 401 with no re-authorisation and no alert
6. **External Service schema drift** — upstream API adds required field without notice; generated Apex class falls out of sync; callouts fail at runtime with no compile-time warning
7. **POST callout retried without idempotency key** — transient 500 triggers retry; external system receives duplicate record; no deduplication logic; data integrity incident
8. **All callouts in synchronous Apex trigger context** — integration designed for <100 records/day; volume grows 10×; callout limits hit; trigger begins throwing `CalloutException` at scale

## MANDATORY CHECK LIST
1. All external system calls use Named Credentials — no hardcoded URLs, usernames, passwords, or tokens in Apex code
2. Every `HttpRequest` has an explicit timeout set via `setTimeout()` — unlimited timeout is not acceptable
3. Retry strategy documented for every integration point — includes backoff interval and maximum retry count
4. Idempotency key designed for every outbound write operation (POST, PATCH, PUT) — key strategy documented in SDD
5. Platform Event consumers are designed for at-least-once, unordered delivery — idempotency logic is present and tested
6. CDC subscriptions have a documented gap-fill reconciliation mechanism — cannot rely on ReplayId replay alone after a 3-day outage
7. OAuth token refresh handles `invalid_grant` — re-authorisation path is explicit, not just a retry of the same credentials
8. External Service registrations are version-pinned and a schema change notification process is defined
9. Integration error path documented end-to-end: failure → retry → dead-letter queue → alert → manual resolution
10. Bulk loads (>10 k records) use Bulk API 2.0 — REST API is not acceptable for mass data operations
11. Synchronous vs asynchronous callout boundary confirmed — bulk context (Trigger, Batch) uses Queueable or async callout
12. Connected apps and integration users carry scoped OAuth permissions and a minimal, dedicated integration profile

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Security breach, credential exposure, or compliance violation. Block go-live. | Hardcoded credentials in Apex visible in version control; PII transmitted to external system without Named Credential isolation or TLS enforcement; OAuth tokens stored in Custom Settings readable by non-admin profiles |
| HIGH | Reliability failure or data integrity risk that will surface under production load. | No callout timeout set — external system degradation hangs Apex transactions at scale; POST callout without idempotency key — duplicate records created on any network retry; CDC subscriber with no gap-fill strategy — silent data divergence after any outage exceeding 3 days |
| MEDIUM | Technical debt or fragility that compounds over time. Fix within current release. | External Service not version-pinned — upstream API change breaks integration silently; Platform Event consumer assumes ordering — intermittent state corruption on high-volume channels; No dead-letter queue for failed callouts — transient failures lost with no alert or audit trail |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Named Credential exists but uses a non-standard label convention — confuses maintainers during incident response; No OpenAPI contract documented — integration shape discovered by inspection; Callout timeout set higher than necessary — slow under degradation but not a failure |
