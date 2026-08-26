# Pilot acceptance status

Status legend: `implemented`, `tested`, `scaffolded`, `blocked-external`.

| Gate | Status | Current evidence |
|---|---|---|
| A01 Seller authorization | scaffolded | OAuth authorization-code client, signed state, encrypted token vault |
| A02 Authorization-loss freeze | implemented | Missing/invalid connection blocks live writes and sets authorization-required state |
| A03 Inventory API disclosure | tested-contract | Versioned seller acknowledgement is persisted and required before preflight; seller UI must call the endpoint |
| A04 Revise/quantity/withdraw | tested-mock | Full mock lifecycle; live revise remains disabled pending Sandbox mapping |
| A05 Inventory authority | implemented | Exactly one required authority on every item |
| A06 Category accuracy | blocked-external | Needs eBay production taxonomy probes and seller category fixtures |
| A07 Catalog identity | scaffolded | Resolver port and evidence state; live lookup disabled; mock mode cannot emit an ePID or eBay catalog-match state |
| A08 Compatibility integrity | tested | Unsupported compatibility hard-blocks |
| A09 Sandbox honesty | implemented | Mock/Sandbox/production modes are separate and disclosed by readiness endpoint |
| A10 Exception-first review | tested | Seller exception endpoint sorts blocks before holds |
| A11 Preflight approval | tested | Actor, time, payload hash and version retained |
| A12 Public approval | tested | Separate action, exact hash and fee-estimate binding |
| A13 Original retention | tested | Original bytes, media type, rights basis and SHA-256 retained |
| A14 Foreground integrity | tested-contract | Failed preservation blocks; deterministic comparison worker still required |
| A15 Image rights | tested | Suspected third-party watermark removal blocks |
| A16 Domestic/international split | tested | Unknown origin holds international only |
| A17 Restricted inventory | partial | Launch keyword block exists; live eBay policy mapping required |
| A18 CoreLoop | tested-contract | Structured terms required; eBay core workflow remains blocked pending approval |
| A19 External drift | implemented-mock | Remote comparison creates a hold; accept-remote or prepare-local-revision requires an explicit audited disposition |
| A20 Does-not-fit feedback | implemented-contract | Report clears compatibility, changes the hash and quarantines sibling claims sharing the same sourced evidence edge; order ingestion remains pending |
| A21 Free allowance | implemented | Successful public audit events alone consume allowance |
| A22 EvidencePack | implemented | One endpoint exports item, evidence, approvals, image metadata, listing and audit |
| A23 Coverage telemetry | planned | Requires real pilot results |
| A24 WHI case | deferred | No commitment until A23 exists |
| A25 24-image intake | tested | Service accepts 1–24 supported images, rejects duplicates and preserves immutable originals |
| A26 Adaptive AI routing | tested-contract | Premium hero, economical secondary and premium failed-secondary escalation are implemented; live model calls require server activation |
| A27 Image source comparison | tested-contract | Every result must pass source-versus-candidate AI QA; exact production telemetry remains external |
| A28 Image Studio cost gate | tested | Quote is batch-based; current 24-image prepaid-balance pilot quote is $2.49 rather than $9.60 |

Production publishing remains disabled until every P0 gate is proven against one authorized seller and the exact current eBay environment.

## Verification checkpoint

- TypeScript build: pass.
- ESLint: pass.
- Automated tests: 38 pass across configuration, security, policy, images, Image Studio pricing/routing, approvals, HTTP and post-publish lifecycle.
- Production dependency audit: zero known vulnerabilities at the recorded lockfile revision.
- Render Blueprint: valid YAML and fail-closed environment defaults.
- Local TCP smoke test: not available in the current managed workspace because host socket/interface lookup is blocked; Fastify injection exercises the compiled HTTP contract without a listening socket.
