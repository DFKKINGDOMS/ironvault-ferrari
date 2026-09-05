# PartQuill engineering contract

This repository is the PartQuill seller workspace: an evidence-gated system for researching, drafting, reviewing, and eventually operating OEM and NOS automotive-parts listings. The primary users are specialist parts sellers and their reviewers. Optimize for a trustworthy command-to-listing workflow, not a generic marketplace demo.

## Product priorities

1. Turn a seller instruction into the smallest safe next action: a read-only inventory answer, a held research result, or an evidence-backed draft.
2. Make unknowns, blockers, provenance, ownership, and approval state obvious. Never improve apparent completion by inventing data.
3. Build reusable enterprise foundations: organization-scoped identity, least privilege, tenant isolation, explicit roles, append-only audit history, idempotent mutations, observable background work, and recoverable errors.
4. Prefer working end-to-end behavior over decorative controls or claims that a service is connected when it is not.
5. Keep the experience accessible, responsive, fast, and understandable to a seller who is not a software engineer.

## Non-negotiable safety boundaries

- Keep `EBAY_MODE=mock` and `ALLOW_EBAY_WRITES=false` in production deployment configuration. Do not perform or enable an eBay production write.
- Preserve separate preflight and public approvals. Each must bind to the exact canonical payload hash; public approval must also bind to a fresh fee estimate. Any material edit invalidates earlier approval.
- Never guess identity, brand, part number, taxonomy, fitment, condition, origin, dimensions, weight, price, rights, or safety eligibility. Unknown data remains held and visible.
- Never derive seller pricing from marketplace listings. Third-party marketplace images remain reference-only and cannot enter a listing payload.
- Originals are immutable evidence. AI derivatives cannot prove identity, condition, fitment, provenance, or ownership and must retain source lineage.
- Retain restricted-item, recall, VeRO, watermark, foreground-preservation, and seller-photo gates.
- Do not hard-code a person's name, initials, email address, account ID, credential, or other personal identity into the product UI, fixtures, logs, or documentation.
- Never expose secrets, full VINs, private filesystem paths, internal source identities, or credentials to the browser, logs, generated reports, or model context.
- Treat the PartQuill inventory store as the declared quantity authority. Remote drift requires an explicit audited disposition and is never silently reconciled.
- Do not create new cloud resources or change production networking from application code. Reuse the established Azure resource group and Foundry resource only through reviewed infrastructure workflows.

## Change standard

- Read the relevant domain service, API route, UI state, tests, and safety documentation before changing a workflow.
- Keep business rules on the server and model them as explicit states. Client-side prototypes must be labeled honestly and cannot authorize an external action.
- Validate untrusted input at every boundary. Scope reads and writes by organization/seller, authorize actions server-side, and use idempotency for retryable mutations.
- Add or update focused tests for success, held, unauthorized, invalid, stale, duplicate, and dependency-failure paths when relevant.
- Run `npm run verify:enterprise`, `npm run lint`, `npm test`, `npm run build:server`, and `npm run build:web` before proposing a merge.
- Keep dependencies and changes narrow. Do not replace the architecture wholesale when an incremental, testable improvement is available.
- Update README or operational documentation when behavior, configuration, deployment, or an external gate changes.

## Azure Astra review boundary

The Astra workflow may edit application code and tests in a temporary, credential-free workspace. It may not edit `.github/**`, this file, `.env.example`, `docs/SAFETY_INVARIANTS.md`, `scripts/verify-enterprise-guardrails.mjs`, or bulk catalog data. Its patch is validated in a separate job and opened as a pull request; it is never auto-merged or deployed directly.
