# PartQuill — one-command eBay seller pilot

This repository serves the PartQuill seller workspace and its evidence-gated API from Azure Container Apps, backed by Azure Database for PostgreSQL and private Azure Blob storage. The primary command can be a seller instruction such as `List part 58487514 on eBay for $9.99 now` or a read-only inventory question such as `Give me all 1990 Corvette parts that Vintage Parts has in stock`; the backend routes the intent before it creates any draft. Seller instructions retain two independent approval gates, while questions consume no listing allowance and perform no eBay write.

It is intentionally not a universal visual parts identifier. The default runtime uses a clearly labeled mock eBay gateway, PostgreSQL-compatible storage, and `ALLOW_EBAY_WRITES=false`.

## Implemented now

- Command-first React seller workspace at `/`, with the approved Understand → Resolve → Map → Protect → Assemble → Review flow.
- Public, rate-limited `POST /v1/seller-ui/command-preview` parser for part number or seller description, price, quantity, condition, shipping and no-fitment instructions.
- Read-only Vintage Parts inventory questions in the same command box. A year/model request is filtered through the active Vintage snapshot and exact GM catalog applications, then returned as a sortable, searchable, paginated table with quantity, source unit price, extended source inventory value, catalog evidence links and CSV download. Source value is explicitly quantity × Vintage source price—not resale or eBay market value—and no draft or free-launch allowance is consumed.
- Vintage GM discovery in the same command box: requests such as `Give me 10 rare Vintage GM parts in the database with exact GMPartsWiki evidence` join the active private Vintage feed to exact OEM catalog keys, rank low source stock first, exclude restraint-system candidates, and return held seller-review drafts only. Source scarcity is never presented as eBay-market rarity or value.
- The GM brake/booster repair-kit rule maps to the current official eBay Motors `Brake Boosters` leaf (`174021`) instead of generic `9886`; a stored generic fallback cannot outrank the exact product-family rule.
- GMPartsWiki-backed item identity uses `General Motors` as the catalog brand, defaults the editable relationship to genuine, and selects one compatible vehicle make deterministically from application evidence for a qualified `Fits` title phrase.
- Four publication-gated item specifics are pinned and cannot be renamed or removed: Brand, Manufacturer Part Number, OE/OEM Part Number, and California Prop 65 Warning.
- Seller images can be added from the main listing form, image workbench, or sticky review bar and reordered by drag-and-drop or accessible arrow controls. The first image is always the main eBay image; the maximum remains 24.
- Quantity `0` is a valid out-of-stock draft. Price `0.00` is valid only for an explicitly marked giveaway, and giveaway drafts remain ineligible for an eBay fixed-price offer.
- VIN recovery is hidden when any supported application year predates 1989; no unsupported short/nonstandard VIN lookup is offered.
- Calculated domestic shipping is the default, with USPS, UPS and FedEx choices, an optional free-shipping mode, P1–P17 measured package gates, and clearly labeled ZIP-to-ZIP planning estimates. Fixed shipping remains disabled for a later release.
- The seller-side Shopify discounted-label design is visibly gated: eBay buyer payment never leaves eBay, a paid eBay order must be imported first, an eligible label purchase must be separately confirmed, and carrier/tracking is then returned through eBay Fulfillment.
- The full official USITC `2026HTSRev17` CSV snapshot, checksum metadata, guarded sync script, and weekday sync workflow live under `data/tariff/`. Description rules return customs candidates only; origin and seller/customs review are mandatory before international publication.
- The editor includes an eBay-style draft preview driven by the current ordered images, title, price, stock, shipping, returns, item specifics, fitment and description. It is labeled as a preview because live eBay rendering can vary.
- Automatic three-way routing: catalog-assisted when an MPN is present, photo-first when it is absent, and a restricted safety review for airbag/restraint terminology. Sellers do not choose a workflow.
- No-part-number drafts ask for whole-item, reverse/connector and label/marking photos without inventing identity, category or fitment. The current private pilot stages previews only in the browser; automatic visual identification and durable upload are explicitly not connected.
- Airbag/restraint drafts remain blocked behind current eBay eligibility, ARA, donor-VIN, undeployed/non-recalled condition, required-statement and hazmat-shipping evidence. A typed year/make/model or seller checkbox cannot clear this gate.
- Deterministic SHA-256 preview fingerprints. A material seller edit requires a rebuild before preflight.
- Explicit identity, fitment and media proof states. Unknown parts never receive an invented brand, product type, category, compatibility row or catalog image.
- A clearly labeled `58487514` illustrative adapter fixture for reviewing the fully populated UI. It is not catalog evidence and cannot authorize an eBay claim.
- Seller-photo requirement, explicit physical-part and condition confirmations, green/amber/red fitment legend, VIN recovery entry point, and a visible “Find the correct part” buyer-assistance path.
- Safe “Send to eBay” handoff that opens only `https://www.ebay.com/`; no account sign-in, listing payload or eBay write is performed.
- Existing connected Image Studio preserved at `/image-studio`.
- Azure-backed EPC image pipeline available at `/v1/epc-image/jobs` for the locked Ferrari/Lamborghini/Aston Martin cleanup rule.
- Free community Parts Image Wiki at `/community-images`, with up to 50 JPEG, PNG or WebP images per contribution, an exact part number for every image, owner/permission attestation, a rights-cleared archive license and public contributor credit.
- Community originals remain quarantined in PostgreSQL. Review rejects people, faces, hands, body parts, explicit or illegal material, unrelated scenes, marketplace promotional graphics, watermarks, overlays and visible part-number conflicts before editing.
- The default quota-independent `chatgpt-manual` route gives an authorized owner a two-hour, source-bound handoff code for the connected PartQuill ChatGPT Image Studio. ChatGPT applies the exact Ferrari preservation prompt and returns the finished file directly to private derivative review. The handoff is one-use; returning a file never publishes it.
- A human must compare the quarantined original and returned ChatGPT derivative and reconfirm the content rules. Only then is the derivative normalized onto a 1600×1600 white canvas and assigned the next collision-safe `SKU.png`, `SKU_1.png`, `SKU_2.png` filename. It remains `READY_FOR_ARCHIVE` until the Git publisher succeeds and never enters a seller listing-photo payload automatically.
- The optional `azure-local` route remains available as a conservative fallback. It removes only a border-connected, near-uniform background and rejects complex backgrounds instead of generating or reconstructing part details; it is not the default community editor.
- Exact OEM-keyed eBay Motors visual-reference discovery through the production Browse API. Results are capped at three images, isolated from seller-owned media, cached for no more than six hours, removed before stale refresh, and never enter a listing payload. Permanent archive status is available only after separate ownership or written-permission evidence.
- Authenticated Fastify API with strict Zod request validation.
- Canonical payload hashing and versioned held drafts.
- Append-only evidence, approval and audit records.
- Exception-first seller queue.
- eBay OAuth authorization-code scaffolding with HMAC state and AES-256-GCM token storage.
- Mock eBay catalog/staging/publish/revise/withdraw/reconcile lifecycle.
- Live publish and withdraw adapter endpoints, guarded behind disabled-by-default controls.
- Ten-successful-publishes free allowance.
- Domestic/international origin separation, core terms, unverified-fitment and restricted-item gates.
- Immutable original image retention and explicit derivative lineage.
- Image rights and foreground-preservation contracts.
- PostgreSQL migrations and repeatable Azure deployment workflows.
- EvidencePack JSON export for disputes and audits.
- Does-not-fit feedback that clears compatibility, invalidates approvals and holds the item for evidence review.
- Sibling compatibility quarantine for listings sharing the same sourced evidence edge.
- Explicit seller acknowledgement of Inventory API lifecycle ownership before preflight.
- Audited remote-drift disposition: accept remote state or prepare a local revision; never silently merge.
- Mock catalog responses that cannot be mistaken for an ePID or production eBay evidence.
- Image Studio batch intake for 1–24 seller-owned photographs, with immutable originals and SHA-256 lineage.
- Ferrari-workflow preservation prompt, source-versus-result AI QA, premium hero routing, economical secondary routing and automatic failed-image escalation.
- Batch pricing rather than per-photo retail pricing: the current 24-image pilot quote is $2.49 from prepaid Studio balance, subject to real production telemetry.
- A connected ChatGPT MCP endpoint and embedded Image Studio widget for the free route: upload 1–24 files once, retain their ChatGPT file references, and dispatch the exact preservation job in the same conversation.
- A file-return tool contract that can pair completed ChatGPT image outputs to the protected job without an eBay write. Host-level automatic return remains a live ChatGPT acceptance test, not a completed product claim.
- A read-only Toyota/Lexus/Scion research implementation for exact OEM part numbers. Production invocation is fail-closed while `OEM_DATA_RIGHTS_CONFIRMED=false`; authorized data and image-use rights are a release gate. When enabled in an approved build, results remain dealer-anonymous and reference-only.
- A buyer-facing VIN cross-check in the same card. It decodes a 17-character Toyota/Lexus/Scion VIN, compares year/make/model/engine against the three-path catalog evidence, returns only the VIN's last four characters, stores no VIN and presents an explicit green Fits, amber May fit/not verified, or red Does not fit verdict. Only a specific engine-supported match permits a listing fitment claim.
- Buyer-only red-mismatch recovery. After a confirmed Does not fit verdict, the card offers **Find the correct part** and reuses the in-memory VIN once to search the same part family. It requires one unique VIN-filtered candidate with the same diagram callout/PNC (or one exact normalized family match), then independently exact-matches that part across the anonymous research paths. Multiple, adjacent or incomplete candidates remain amber. The seller item, listing and eBay account are never changed.
- A progressive-disclosure result card. Vehicle verdict, identity and reference media lead; potential applications are grouped by year/make/model; source counts and OEM-source prices remain collapsed seller research. Catalog condition never becomes seller-item condition, and OEM-source quotes are never represented as verified eBay market value.

## Safety model

See [docs/SAFETY_INVARIANTS.md](docs/SAFETY_INVARIANTS.md). The central rule is simple:

```text
unchanged payload
  + preflight approval
  + staged offer
  + fresh fee-bound public approval
  + no exceptions
  + authorization
  + external-write flag
  = eligible to call publish
```

Production eBay writes are refused by configuration in this checkpoint, even if the global write flag is accidentally enabled.

## Local setup

Requirements: Node 22+ and, for durable mode, PostgreSQL.

```bash
cp .env.example .env
npm ci
npm run build
npm test
```

Without `DATABASE_URL`, the app runs with an in-memory repository suitable for tests and API exploration. With PostgreSQL:

```bash
npm run migrate
npm run dev
```

Health endpoints are public:

- `GET /health` — process liveness.
- `GET /ready` — persistence and safety-mode summary.

The seller workspace endpoints are also public and read-only:

- `GET /v1/seller-ui/bootstrap` — sanitized runtime mode and seller defaults.
- `POST /v1/seller-ui/command-preview` — routes a command into a read-only Vintage inventory answer, catalog-held draft, photo-first draft, restricted-safety review, illustrative preview, or Vintage GM shortlist; it performs no eBay write.
- `GET /v1/seller-ui/ebay-reference/:partNumber` — checks only an exact, locally verified catalog key; unrelated categories, partial numbers, conflicting MPNs and conflicting automaker brands fail closed.

The community contribution surface is public and rate limited:

- `GET /community-images` — contributor upload, rights attestation and receipt/status interface.
- `POST /v1/community/submissions` — multipart intake using `images`, a JSON `partNumbers` array, `contributorCredit`, and all three required confirmation fields.
- `GET /v1/community/submissions/:submissionId?token=...` — receipt-protected status; the token is returned only at intake.
- `GET /v1/community-assets/:fileName` — immutable public derivative, available only after automated screening, human approval, editing, source-comparison QA and Git archival.

Review endpoints under `/internal/community-images/` require the normal PartQuill bearer credential. In `chatgpt-manual` mode, approval requires explicit manual safety and exact-part-number confirmations, and the owner downloads the private original before issuing a ChatGPT handoff. Returned derivatives have a separate private preview and final source-comparison approval endpoint. Approved files do not publish unless `COMMUNITY_GITHUB_TOKEN` is configured with narrowly scoped write access to the archive repository; otherwise they remain `READY_FOR_ARCHIVE` and can be retried through the authenticated archive-retry endpoint. The fully managed Azure route remains optional and PartQuill never falls back from Azure to the separately billed OpenAI API. Originals are never exposed by public endpoints.

The connected ChatGPT proof endpoint is also public:

- `POST /mcp` — stateless Streamable HTTP MCP transport.
- `GET /mcp` and `DELETE /mcp` — intentionally return JSON-RPC method-not-allowed responses.

The MCP surface never publishes to eBay, never treats an edited derivative as
identity or fitment evidence, and contains no subscription or credit checkout.
`open_oem_part_finder` opens the inline buyer card. `research_oem_part` accepts an exact
Toyota, Lexus or Scion part number and performs private multi-catalog lookups. Results are
OEM catalog reference evidence—not marketplace sales evidence. Raw trim, option and
production-code strings are withheld from the public card. `verify_oem_part_vin` accepts
the exact part plus a 17-character VIN, returns a masked green/amber/red decision, and
fails closed on broad engine or production-break evidence. Results retain retrieval time
and source counts but never source identity or URLs. If that result is red,
`find_correct_oem_part` can perform a buyer-only search for the same component family.
It returns green only for one unique VIN-filtered exact candidate; ambiguity stays amber,
the full VIN is discarded after the call, and the seller listing remains untouched.

All business endpoints require `Authorization: Bearer $PARTQUILL_API_KEY`.

Image Studio supports a separate private pilot credential through
`X-PartQuill-Studio-Token`. The token belongs on a trusted server-side proxy;
it must never be embedded in public browser code.

## Image Studio batch flow

1. `GET /v1/image-studio/quote?count=24`
2. `POST /v1/image-studio/jobs` as multipart form data. Use `images` for 1–24 files and include `sellerId`, `background`, `rightsConfirmed=true`, and `watermarkStatus`.
3. Poll `GET /v1/image-studio/jobs/:jobId`.
4. Retrieve the immutable source or accepted result from each image URL in the job response.
5. Use `POST /v1/image-studio/jobs/:jobId/retry` only for held activation, failed, or review-required jobs.

`IMAGE_STUDIO_MODE=preview` accepts and retains the pilot job but performs no
paid model call. `IMAGE_STUDIO_MODE=live` requires `OPENAI_API_KEY` and a private
pilot token. The API key is server-only and cannot come from a customer's
ChatGPT subscription.

See [docs/IMAGE_STUDIO.md](docs/IMAGE_STUDIO.md) for quality, cost, activation,
and deployment boundaries.

## Connected ChatGPT free route

The free route is designed to run as an installed PartQuill app inside ChatGPT:

1. Open `open_image_studio` in ChatGPT.
2. Select 1–24 seller-owned source photographs in the embedded widget.
3. Confirm the rights and preservation boundary once.
4. PartQuill uploads those files to the current ChatGPT conversation and posts
   the exact protected job automatically—no second tab, Explorer re-selection,
   clipboard prompt, or PartQuill API key.
5. ChatGPT performs the image edit under the preservation contract.
6. When the ChatGPT host supports the return tool for generated files, the
   finished outputs are mapped back to the same PartQuill job for side-by-side
   review. Until that host behavior is proven live, the manual download/import
   route remains the honest fallback.

This route uses the customer's existing ChatGPT access and is subject to that
account's plan and usage limits. It does not make a server-side OpenAI API call.
The optional Express route is separate, automated, and metered through
PartQuill's server-side API credential.

## Principal API flow

1. `POST /v1/items`
2. `POST /v1/items/:itemId/catalog-resolution`
3. Add or correct evidence until the item is `READY_FOR_PREFLIGHT`.
4. `POST /v1/items/:itemId/approvals/preflight`
5. `POST /v1/items/:itemId/stage`
6. Review the exact staged payload and fee estimate.
7. `POST /v1/items/:itemId/approvals/public`
8. `POST /v1/items/:itemId/publish`
9. Operate through `PATCH /v1/items/:itemId/listing`, `/withdraw`, and `/reconcile`.

Any material edit restarts the approval chain.

## What remains before a real seller pilot

- Connect an authorized catalog/eBay product adapter so verified identity, taxonomy, item specifics, fitment and licensed media can replace the illustrative fixture.
- Replace browser-local seller image staging with durable private object storage for originals.
- Register eBay developer keys and RuName; complete one Sandbox OAuth connection.
- Implement Inventory API inventory-item, location, business-policy and offer mapping for the pilot seller.
- Connect the gated seller-side Shopify label-purchase route and eBay Fulfillment tracking write after both account authorizations are proven.
- Run current production Taxonomy/Metadata/catalog read probes. Sandbox alone does not prove Motors catalog behavior.
- Add publicly retrievable image-object storage for eBay image URLs.
- Replace preview filesystem storage with durable private object storage and signed delivery URLs before a multi-seller launch.
- Replace the in-process pilot queue with a durable background queue before production volume.
- Activate the server-side OpenAI credential and record actual per-image telemetry before committing to final retail packs.
- Ingest does-not-fit return feedback and token refresh/revocation lifecycle.
- Complete the Azure owner-pilot acceptance audit and keep live AI activation fail-closed until its server credential is configured.
- Connect the public `/mcp` endpoint in ChatGPT Developer Mode and prove the generated-file return path with a two-image job before claiming unattended free-route round trips.

The current gate-by-gate status is in [docs/ACCEPTANCE_STATUS.md](docs/ACCEPTANCE_STATUS.md).
