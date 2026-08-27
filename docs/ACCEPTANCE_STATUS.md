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
| A29 Connected ChatGPT intake | tested-contract | Public stateless MCP endpoint, embedded widget, 1–24 ChatGPT file uploads and exact same-conversation prompt dispatch are covered by automated tests |
| A30 Connected result return | scaffolded | `return_edited_images` binds returned file references to the protected job and forbids eBay writes; live ChatGPT generated-file invocation still requires a two-image acceptance test |
| A31 Free-route separation | tested-contract | Connected ChatGPT Assist needs no PartQuill API key, contains no checkout, and does not call the metered Express worker |
| A32 Toyota/Lexus/Scion exact-number research | tested-live | `research_oem_part` exact-matches three private catalog paths, merges crossover fitment, anonymizes price quotes, proxies images through PartQuill, and fails closed on mismatches or any dealer-identity leakage |
| A33 Marketplace price boundary | tested | MSRP and current anonymous OEM-source prices are labeled reference-only; no eBay list or quick-sale price is treated as verified without sold-market evidence, actual seller condition, shipping, fees and seller cost |
| A34 Catalog image rendering | tested-contract | `research_oem_part` hydrates the inline PartQuill card with widget-only product-photo and diagram bytes, labels diagram callout/PNC, never claims transcript attachments, blocks dealer identity, and marks both reference-only with `primaryEbayImageApproved=false` |
| A35 Buyer VIN cross-check | tested-contract | `verify_oem_part_vin` decodes a 17-character Toyota/Lexus/Scion VIN, intersects the decoded year/make/model/engine with three-path catalog evidence, returns only the last four characters, stores no VIN, and presents explicit green Fits, amber May fit/not verified, or red Does not fit verdicts while failing closed on broad or conflicting evidence |
| A36 Fitment information hierarchy | tested-contract | Part-only research is always amber and VIN-required; raw option-code rows are replaced by grouped year/make/model applications, seller diagnostics are collapsed, and a catalog condition can never establish seller-item condition |
| A37 Buyer correct-part recovery | tested-contract | A red VIN mismatch exposes a buyer-only Find the correct part action. It reuses the VIN once, isolates the original part family by diagram callout/PNC, requires one unique VIN-filtered candidate, independently exact-matches that candidate, returns only the VIN last four, and leaves multiple or adjacent parts amber. Dealer identity, the seller listing and all eBay writes remain blocked. |

Production publishing remains disabled until every P0 gate is proven against one authorized seller and the exact current eBay environment.

## Verification checkpoint

- TypeScript build: pass.
- ESLint: pass.
- Automated tests cover configuration, security, policy, images, Image Studio pricing/routing, MCP inline media, VIN masking, red-mismatch correct-part recovery, ambiguity blocking, multi-catalog research, approvals, HTTP and post-publish lifecycle.
- Live multi-catalog smoke tests: exact parts returned Toyota/Lexus/Scion crossover evidence, anonymous MSRP/current-price comparisons, proxied images, supersession and normalized fitment rows without source identity or contact data.
- Production dependency audit: zero known vulnerabilities at the recorded lockfile revision.
- Render Blueprint: valid YAML and fail-closed environment defaults.
- Local TCP smoke test: not available in the current managed workspace because host socket/interface lookup is blocked; Fastify injection exercises the compiled HTTP contract without a listening socket.
