# PartQuill — one-command eBay seller pilot

This repository serves the PartQuill seller workspace and its evidence-gated API from one Render web service. The primary action is a sentence such as `List part 58487514 on eBay for $9.99 now` or `List a used black dashboard for $49.99`; the backend extracts seller intent, chooses the safest intake path, applies only supportable defaults, fingerprints the exact preview, and preserves two independent approval gates.

It is intentionally not a universal visual parts identifier. The default runtime uses a clearly labeled mock eBay gateway, PostgreSQL-compatible storage, and `ALLOW_EBAY_WRITES=false`.

## Implemented now

- Command-first React seller workspace at `/`, with the approved Understand → Resolve → Map → Protect → Assemble → Review flow.
- Public, rate-limited `POST /v1/seller-ui/command-preview` parser for part number or seller description, price, quantity, condition, shipping and no-fitment instructions.
- Automatic three-way routing: catalog-assisted when an MPN is present, photo-first when it is absent, and a restricted safety review for airbag/restraint terminology. Sellers do not choose a workflow.
- No-part-number drafts ask for whole-item, reverse/connector and label/marking photos without inventing identity, category or fitment. The current private pilot stages previews only in the browser; automatic visual identification and durable upload are explicitly not connected.
- Airbag/restraint drafts remain blocked behind current eBay eligibility, ARA, donor-VIN, undeployed/non-recalled condition, required-statement and hazmat-shipping evidence. A typed year/make/model or seller checkbox cannot clear this gate.
- Deterministic SHA-256 preview fingerprints. A material seller edit requires a rebuild before preflight.
- Explicit identity, fitment and media proof states. Unknown parts never receive an invented brand, product type, category, compatibility row or catalog image.
- A clearly labeled `58487514` illustrative adapter fixture for reviewing the fully populated UI. It is not catalog evidence and cannot authorize an eBay claim.
- Seller-photo requirement, explicit physical-part and condition confirmations, green/amber/red fitment legend, VIN recovery entry point, and a visible “Find the correct part” buyer-assistance path.
- Safe “Send to eBay” handoff that opens only `https://www.ebay.com/`; no account sign-in, listing payload or eBay write is performed.
- Existing connected Image Studio preserved at `/image-studio`.
- Free community Parts Image Wiki at `/community-images`, with up to 50 JPEG, PNG or WebP images per contribution, an exact part number for every image, owner/permission attestation, a rights-cleared archive license and public contributor credit.
- Community originals remain quarantined in PostgreSQL. Automated screening rejects people, faces, hands, body parts, explicit or illegal material, unrelated scenes, marketplace promotional graphics, watermarks, overlays and visible part-number conflicts before a required human review.
- Human-approved contributions use the source-preserving white-background Image Studio workflow and QA. Distinct views are archived atomically to Git as `SKU.png`, `SKU_1.png`, `SKU_2.png`, and so on, mapped back to the reference database, and never enter a seller listing-photo payload automatically.
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
- PostgreSQL migration and Render Blueprint.
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
- `POST /v1/seller-ui/command-preview` — builds a catalog-held, photo-first, restricted-safety, or illustrative preview; it performs no catalog or eBay request.
- `GET /v1/seller-ui/ebay-reference/:partNumber` — checks only an exact, locally verified catalog key; unrelated categories, partial numbers, conflicting MPNs and conflicting automaker brands fail closed.

The community contribution surface is public and rate limited:

- `GET /community-images` — contributor upload, rights attestation and receipt/status interface.
- `POST /v1/community/submissions` — multipart intake using `images`, a JSON `partNumbers` array, `contributorCredit`, and all three required confirmation fields.
- `GET /v1/community/submissions/:submissionId?token=...` — receipt-protected status; the token is returned only at intake.
- `GET /v1/community-assets/:fileName` — immutable public derivative, available only after automated screening, human approval, editing, source-comparison QA and Git archival.

Review endpoints under `/internal/community-images/` require the normal PartQuill bearer credential. Approved files do not publish unless `COMMUNITY_GITHUB_TOKEN` is configured with narrowly scoped write access to the configured archive repository; they remain in `READY_FOR_ARCHIVE` and queue recovery retries them. Automated screening and editing require an explicitly selected `PARTQUILL_AI_PROVIDER`. Azure uses `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and separate review/image deployment names; PartQuill never falls back from Azure to the separately billed OpenAI API. Originals are never exposed by public endpoints.

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
- Add the seller photo upload to the command surface and durable private object storage for originals.
- Register eBay developer keys and RuName; complete one Sandbox OAuth connection.
- Implement Inventory API inventory-item, location, business-policy and offer mapping for the pilot seller.
- Run current production Taxonomy/Metadata/catalog read probes. Sandbox alone does not prove Motors catalog behavior.
- Add publicly retrievable image-object storage for eBay image URLs.
- Replace preview filesystem storage with durable private object storage and signed delivery URLs before a multi-seller launch.
- Replace the in-process pilot queue with a durable background queue before production volume.
- Activate the server-side OpenAI credential and record actual per-image telemetry before committing to final retail packs.
- Ingest does-not-fit return feedback and token refresh/revocation lifecycle.
- Complete the Render owner-pilot deployment and keep live AI activation fail-closed until its server credential is configured.
- Connect the public `/mcp` endpoint in ChatGPT Developer Mode and prove the generated-file return path with a two-image job before claiming unattended free-route round trips.

The current gate-by-gate status is in [docs/ACCEPTANCE_STATUS.md](docs/ACCEPTANCE_STATUS.md).
