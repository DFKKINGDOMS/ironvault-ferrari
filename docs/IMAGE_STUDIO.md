# PartQuill Image Studio — 24-image adaptive pilot

## Launch contract

Image Studio accepts up to 24 seller-owned automotive-part photographs in one
batch. It keeps every source unchanged, creates separate presentation
derivatives, compares each derivative against its source, and holds any result
that cannot pass the preservation contract.

It is not a browser background-removal filter. It uses the same core production
pattern proven in the Ferrari workflow:

- exact preservation prompt;
- no invented, removed, repaired, reshaped, recolored or polished-away product detail;
- clean white, transparent or light-gray catalog background;
- complete uncropped object with comfortable margins;
- immutable source plus source/result hashes;
- source-versus-result AI QA;
- exception escalation rather than silent acceptance;
- watermark rights gate before processing.

An edited derivative is presentation evidence only. Identity, condition and
fitment continue to come from the original photograph and verified listing
evidence.

## Adaptive processing plan

| Image | First route | Automatic next action |
|---|---|---|
| Primary/hero | `gpt-image-2`, high quality | Hold for review if source comparison fails |
| Secondary 2–24 | `gpt-image-1-mini`, high quality | Escalate once to `gpt-image-2`, medium quality when QA fails |
| Every accepted result | `gpt-5.4-mini` source comparison | Reject changes to geometry, labels, wear, piece count, crop, color or detail |

This is how the batch remains economical without treating a weak local cutout as
the final product. The premium model is always used for the hero and whenever a
secondary fails its first quality check.

## Pilot pricing

The quote engine uses a conservative operating estimate:

- one premium hero allowance;
- one economical high-fidelity allowance per secondary;
- one AI QA comparison per image;
- storage and queue allowance;
- 12% retry reserve.

Current prepaid-balance quotes are:

| Batch | Pilot quote |
|---|---:|
| 1–5 images | $0.99 |
| 6–12 images | $1.49 |
| 13–24 images | $2.49 |

For 24 images, the current conservative direct-cost estimate is returned by
`GET /v1/image-studio/quote?count=24`. It is an engineering estimate, not a
guaranteed OpenAI invoice. Final packs must be set from real API, storage,
retry, moderation, support and payment telemetry. The $2.49 price assumes a
prepaid balance or subscription; a separate one-off card charge may need a
higher checkout price because of fixed payment fees.

OpenAI does not provide PartQuill an automatic commission on a customer's
ChatGPT or API credit purchase. PartQuill earns its contribution margin by
selling its own Studio balance and paying the server-side processing cost.

## Rights and watermark boundary

- `NONE`: no watermark removal is requested.
- `OWNED_OR_AUTHORIZED`: seller confirms ownership or written authorization;
  background watermarking may be removed, but physical product markings must
  remain.
- `SUSPECTED_THIRD_PARTY`: the job is blocked before a model call.

## Pilot runtime boundaries

The current service is deliberately split into two modes:

- `preview`: validates, quotes and securely retains a job, but does not spend an
  OpenAI credit. The job remains `AWAITING_ACTIVATION`.
- `live`: executes the adaptive model and QA routes. It requires a server-side
  `OPENAI_API_KEY` and a private `IMAGE_STUDIO_ACCESS_TOKEN`.

There is also a separate free ChatGPT-assisted route. It does not depend on
`IMAGE_STUDIO_MODE` and does not use PartQuill's OpenAI API key. The connected
ChatGPT app widget uploads the seller's 1–24 originals once, retains their
ChatGPT file references, and posts the protected Ferrari-style preservation
job in the same conversation. The customer still reviews every derivative.

The MCP contract includes a `return_edited_images` tool so finished ChatGPT
files can be attached to the same protected job. That proves the application
contract; it does not by itself prove that every current ChatGPT image-generation
host will invoke the tool with generated-file references. A live two-image
Developer Mode test is required before the product promises an automatic free
round trip. If the host does not return those references, the existing manual
download/import fallback remains available and is disclosed before processing.

### Free ChatGPT Assist versus Express Auto

| Boundary | Free ChatGPT Assist | Express Auto |
|---|---|---|
| Separate PartQuill image charge | None | Uses prepaid PartQuill Studio balance |
| OpenAI API key | Not required | Required on PartQuill's server |
| Where editing runs | Customer's ChatGPT conversation | PartQuill background job |
| Source selection | Once inside the connected widget | Once inside PartQuill |
| Prompt handling | Automatically posted in the same conversation | Server-managed |
| Timing | Subject to ChatGPT plan, limits and interactive processing | Queue-managed |
| Result return | Tool-assisted path must pass live host acceptance | Automatic after QA |
| Best fit | Occasional users who accept variable wait and review | Repeat-volume sellers who value unattended processing |

Neither route can change product geometry, repair or conceal damage, remove a
third party's watermark, or use the derivative as identity/fitment evidence.

The Azure owner-pilot checkpoint may use container-local preview storage and an
in-process queue so the contract can be tested end to end. Before a real
multi-seller launch, replace those with private object storage, signed result
URLs, a durable queue, job cancellation, retention/deletion policy, malware
scanning, seller-scoped authentication, metering and refunds.

When the temporary owner preview has no database binding, it must set
`PILOT_EPHEMERAL_MODE=true`. Configuration accepts that flag only with the mock
eBay adapter and all eBay writes disabled. `/ready` reports the ephemeral state;
it is never presented as durable production storage.

## Acceptance criteria

1. Accept 1–24 JPEG, PNG or WebP files, maximum 12 MB per file and 120 MB per batch.
2. Reject duplicate sources within one batch.
3. Reject missing rights confirmation.
4. Block suspected third-party watermark removal before processing.
5. Preserve each source byte-for-byte and store its SHA-256.
6. Process the first image through the premium hero route.
7. Process secondary images through the economical high-fidelity route.
8. Compare every result to its source.
9. Escalate a failed secondary exactly once before human review.
10. Never expose filesystem paths or the OpenAI API key to a browser response.
11. Never treat a generated derivative as identity or fitment evidence.
12. Return an honest activation state through `/ready` and the job record.
13. Expose a public stateless `/mcp` transport whose Image Studio widget accepts 1–24 files without an API key.
14. Store uploaded ChatGPT file IDs in widget state and automatically send the exact preservation prompt in the same conversation.
15. Return completed file references only to the matching job and state `eBay_write_performed=false`.
16. Keep automatic free-route result return labeled test-required until a live ChatGPT host completes the two-image round trip.
