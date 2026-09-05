# PartQuill bounded enterprise recovery mission

Act as PartQuill's principal engineer in a recovery attempt after a broader automated pass did not complete. Read `AGENTS.md`, the README, safety invariants, acceptance status, and enough of the server, persistence, HTTP, React, tests, migrations, and deployment code to understand the real seller workflow. Select and implement the strongest coherent enterprise improvement that can be fully completed, tested, and summarized within 35 minutes. Do not return only an audit and do not leave partial edits.

PartQuill helps specialist automotive-parts sellers turn a natural-language command into either a read-only inventory answer or a safe, evidence-backed listing draft. The useful end-to-end path is: understand the instruction, resolve exact identity evidence, map official taxonomy and specifics, expose unknowns and held states, protect against policy/fitment/rights risk, assemble seller-owned media and terms, review the exact payload, obtain two distinct approvals, and operate through one inventory authority.

Prioritize one or two connected vertical improvements that replace demo-only behavior with server-backed state, make held/error/recovery states actionable, strengthen organization/role/tenant boundaries, consolidate business rules, or improve the command-to-listing workflow. Include focused positive and fail-closed tests. Keep the patch narrow and compatible with Azure Container Apps and PostgreSQL.

Hard constraints:

- Never enable or perform production eBay writes. Preserve `EBAY_MODE=mock`, `ALLOW_EBAY_WRITES=false`, and the global refusal for production writes.
- Preserve both independent approvals, exact canonical payload hashes, fresh-fee binding, and material-edit invalidation.
- Never infer unsupported identity, brand, part number, taxonomy, fitment, condition, origin, dimensions, weight, price, rights, or safety eligibility.
- Marketplace content is reference-only and cannot set seller pricing or enter seller-owned listing media.
- Original images remain immutable evidence; an AI derivative cannot prove identity, condition, fitment, provenance, or ownership.
- Preserve restricted-item, recall, VeRO, watermark, foreground-preservation, seller-photo, inventory-authority, and drift-disposition gates.
- Do not expose credentials, complete VINs, private paths, private source identities, or personal identities.
- Do not contact eBay, modify Azure, deploy, commit, push, open a pull request, or perform any external write. Work only in the checked-out repository.
- Do not edit `.github/**`, `AGENTS.md`, `.env.example`, `docs/SAFETY_INVARIANTS.md`, `scripts/verify-enterprise-guardrails.mjs`, or `data/**`.

Before finishing:

- Add or update tests for every material behavior change, including negative and dependency-failure paths.
- Run `npm run verify:enterprise`, `npm run lint`, `npm test`, `npm run build:server`, and `npm run build:web`; fix failures caused by the patch.
- Create or update `docs/astra-enterprise-review.md` with what you inspected, implemented, validated, and deliberately left behind.
- Leave a complete, internally consistent patch. If time becomes tight, stop expanding scope and finish validation and documentation.
