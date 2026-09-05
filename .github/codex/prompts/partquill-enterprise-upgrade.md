# PartQuill enterprise upgrade mission

Act as the principal engineer and product architect for PartQuill. Inspect the entire repository before editing: its README, safety invariants, acceptance status, domain services, persistence, HTTP routes, React seller workspace, tests, migrations, and deployment assumptions. Then implement one coherent, high-impact enterprise improvement pass. Do not merely write an audit or redesign the visuals in isolation.

PartQuill helps specialist automotive-parts sellers turn a natural-language instruction into either a read-only inventory answer or a safe, evidence-backed listing draft. The ideal flow is: understand the instruction, resolve exact identity evidence, map official taxonomy and specifics, protect against policy/fitment/rights risk, assemble seller-owned media and terms, review an exact payload, obtain two distinct approvals, and operate the listing through one inventory authority. Today it is a private pilot; make the product more credible, useful, and operationally coherent without pretending unfinished external integrations are live.

Prioritize the strongest improvements you can complete and verify in this run:

1. Replace demo-only or disconnected interactions with real state and server-backed logic where the repository can support it.
2. Make the command-first seller journey coherent across inventory research, evidence capture, held states, draft review, approvals, exceptions, and recovery.
3. Improve organization/user/role readiness, tenant isolation, authorization boundaries, append-only auditability, idempotency, error handling, and dependency health where gaps are present.
4. Give every asynchronous, empty, stale, unavailable, unauthorized, and failed state a truthful and useful next action.
5. Improve accessibility, keyboard behavior, responsive layout, information hierarchy, and plain-language explanations of risk.
6. Consolidate duplicated business rules into explicit server-side domain logic with focused tests.
7. Preserve compatibility with the existing Azure Container Apps deployment and PostgreSQL path. Avoid dependency bloat and broad rewrites.

Hard constraints:

- Never enable or perform production eBay writes. Preserve `EBAY_MODE=mock`, `ALLOW_EBAY_WRITES=false`, and the global configuration refusal for production writes.
- Preserve the two independent approvals, exact canonical payload hash, fresh-fee binding, and material-edit invalidation rules.
- Never infer unsupported identity, brand, MPN, taxonomy, fitment, condition, damage, origin, dimensions, weight, pricing, rights, or safety eligibility.
- Marketplace content is reference-only and must not set seller pricing or enter seller-owned listing media.
- Original images remain immutable; an AI derivative is presentation media, never evidence of identity, condition, fitment, or ownership.
- Preserve restricted-item, recall, VeRO, watermark, foreground-preservation, seller-photo, inventory-authority, and drift-disposition gates.
- Do not expose credentials, complete VINs, private paths, or private source identities.
- Do not contact eBay, modify Azure, deploy, commit, push, open a pull request, or make any other external write. Work only in the checked-out repository.
- Do not edit `.github/**`, `AGENTS.md`, `.env.example`, `docs/SAFETY_INVARIANTS.md`, `scripts/verify-enterprise-guardrails.mjs`, or `data/**`.
- Do not hard-code any person's identity or add fabricated customer, revenue, compliance, catalog, or integration claims.

Before finishing:

- Add or update tests for every material behavior change, including negative/fail-closed paths.
- Run `npm run verify:enterprise`, `npm run lint`, `npm test`, `npm run build:server`, and `npm run build:web`; fix failures caused by your changes.
- Create or update `docs/astra-enterprise-review.md` with a concise description of what you inspected, what you implemented, why it improves the real seller use case, validation results, known risks, and the external gates still required before a real seller or eBay production launch.
- Leave the repository with an internally consistent, reviewable patch. If a desired change cannot be completed safely, document it as a remaining gate rather than simulating it.
