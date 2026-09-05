# Bounded enterprise recovery review

Date: September 5, 2026

## Scope selected

Harden the existing server-backed approval chain and add an actionable fee-recovery
path. The motivating defects were hash-only approval reuse after reverting a
payload, fee expiry not being checked at publish time, and independent persistence
writes that could leave a partial review transition. No browser credential or
tenant-authentication prototype was introduced.

## Inspected

- Engineering contract, README, safety invariants and acceptance status, especially
  A03, A11/A12, A19 and the documented production-write refusal.
- `PartQuillService`: payload replacement, evidence/policy refresh, approvals,
  staging, publishing, inventory ownership, drift and fitment recovery.
- Domain records, canonical hashing, schemas and policy evaluation; mock and live
  gateways, fee estimates, authorization handling and configuration validation.
- Fastify authentication, error handling and item/lifecycle routes.
- Memory/PostgreSQL stores, migration runner and initial item/approval/listing/
  audit schema; inventory ownership and publish-slot migrations.
- React command/draft/review state, local draft persistence and the explicitly
  simulated preflight/public handoff; these are not authenticated server approvals.
- Existing approval, lifecycle, policy, image, HTTP and configuration tests.
- Docker build/startup and Azure Container Apps deployment settings. Deployment
  continues to use `EBAY_MODE=mock` and `ALLOW_EBAY_WRITES=false`.

## Implemented

1. Centralized current-approval, staged-version and usable-fee checks. Both approval
   stages bind to hash **and version**; public approval also binds to the current
   fee identifier. Publishing independently requires current preflight, public
   approval, matching staged version and a fresh, mode-appropriate USD fee.
2. Reevaluate evidence and image policy during review rather than trusting an old
   empty exception array. Restored hashes, missing preflight, malformed/unavailable
   fees, wrong gateway fee sources and legacy unversioned staging fail closed.
3. Added authenticated `POST /v1/items/:itemId/fees/refresh`, guarded by the current
   hash/version/fee snapshot. It refreshes the same offer, preserves preflight and
   the payload, returns to public review and requires a new public approval.
   Missing estimates use an explicit null precondition. Dependency failures are
   sanitized and retryable; authorization loss retains an actionable hold.
4. Added an atomic review-transition store operation. PostgreSQL locks item and
   listing snapshots and commits state, approval and audit on one transaction;
   memory mode mirrors the comparison. Stale completion cannot overwrite a newer
   review. New approvals and refreshed-fee invalidation are audited without
   deleting earlier records.
5. Sequential duplicate approval/staging requests do not append duplicates or stage
   another offer. Stale fee-refresh retries return a reload conflict. Staging and
   fee recovery cannot overwrite a published, withdrawn or drifted listing.

## Compatibility and recovery

- No new dependency, migration, cloud resource or deployment setting is required.
  `stagedPayloadVersion` is additive in the existing listing JSONB record.
- Legacy unversioned staged offers are deliberately held. Replace the draft
  payload through the existing endpoint, then repeat preflight and staging;
  never backfill an assumed approval version.
- Fee recovery does not contact a marketplace in mock mode. It never invokes an
  offer mutation in either mode. Historical approvals remain append-only.
- The current shared bearer credential remains the API security boundary. This
  patch does not claim organization sessions, per-user roles or tenant isolation.

## Validation

Focused tests cover normal review, reverted hashes, independent preflight,
unversioned staging, fee expiry/malformed/source failures, policy holds, sequential
duplicates, competing/stale transitions, same-offer recovery, missing fees,
dependency/authorization failures, authenticated HTTP routing, and PostgreSQL
transaction ordering. A simulated PostgreSQL audit-write failure verifies rollback
and connection release.

Final independent validation after review fixes: enterprise guardrails passed;
the production dependency audit passed its high-severity threshold with one known
moderate `qs` advisory; lint passed; all 207 tests passed; and both server and web
type-check/builds passed.

Real PostgreSQL integration tests are opt-in through
`PARTQUILL_TEST_DATABASE_URL`, against a **disposable local database** initialized
with `migrations/001_initial.sql`. They cover competing transactions, changed
snapshots and rollback after an audit constraint failure. The sandbox prevented
the temporary PostgreSQL server from binding its Unix socket, so those tests
could not run here. The default memory and mocked PostgreSQL protocol tests do run.

## Deliberately left behind

- No UI claims of durable approval: the existing browser demo remains a simulation.
- Organization identity, scoped sessions, server-verified actor roles, inventory
  authority consolidation and durable command drafts require a separate vertical.
- This transaction is limited to review transitions. Other lifecycle mutations
  still need end-to-end concurrency control. External offer creation/publication
  still needs durable idempotency/outbox and uncertain-outcome recovery before any
  live rollout; database rollback cannot undo an external call. Concurrent stage
  attempts can still create unused mock offers before the losing local transition
  is rejected. Live staging remains disabled in the gateway.
- Taxonomy/identity/media evidence, production probes, original-image storage,
  all rights/safety/fitment gates and drift disposition remain unchanged.
- No eBay or Azure calls, deployment, commit, push, pull request or external write
  was performed. Protected repository paths were not edited.
