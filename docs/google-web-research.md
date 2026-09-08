# Live Google part research

The Research view calls Google's public-web grounding tool using the configured Gemini model. The existing catalogue and command workspace continue to use owned evidence. The two actions are separate because Google-grounded answers are for direct display to the requesting user, not automatic ingestion into a shared catalogue or listing.

## Runtime configuration

Set `GOOGLE_RESEARCH_MODE=live` only after provisioning keyless access and deploying this code. Configure `GOOGLE_CLOUD_PROJECT`, `GOOGLE_SEARCH_MODEL=gemini-3.8-flash`, `GOOGLE_WORKLOAD_IDENTITY_AUDIENCE`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_AZURE_TOKEN_RESOURCE` as server environment variables. Azure supplies `IDENTITY_ENDPOINT` and `IDENTITY_HEADER`. Never expose credentials in frontend code.

The Azure managed identity exchanges a token through Google STS and impersonates a service account restricted to model prediction and billing-project usage. Federation must trust only the exact application identity and tenant. No long-lived Google key is required.

`GOOGLE_RESEARCH_DAILY_LIMIT` defaults to 200 new requests per UTC day per running instance; the existing app supports up to two instances. An additional per-visitor limit allows ten requests per hour with two concurrent requests per instance. Limits reset on process restart. A request may execute multiple billable Google searches; model tokens are charged separately. Promotional-credit eligibility is not inferred from an enabled billing account.

## Result handling

The result must include actual Google search queries, source chunks, citation supports, the expected model, and a complete answer. No fallback calls Bing. Missing sources and provider failures remain visible and never establish non-fitment.

The original answer, source links, citations, and supplied Search Suggestions are displayed to the requester. Responses exist only in memory for a fifteen-minute delivery/retry window scoped by an unguessable request ID and visitor hash. There is no shared part cache, source-link crawling, catalogue ingestion, or listing write. Full VINs are rejected before a web request. See [Google grounding terms](https://cloud.google.com/terms/service-terms) and [grounding documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search).

`GET /v1/seller-ui/google-research/status` separates configuration from a successful live search. A verified result is reported only after Google has actually returned cited search output.

## Deployment

Normal pushes and manual deployments now build the exact checked-out commit and update only the existing app image. They preserve environment variables, secret references, ingress, and the app environment. Enterprise checks, lint, tests, and both builds precede deployment. The legacy infrastructure bootstrap is available only through the explicit manual `bootstrap` input; it is not the normal code-deployment path.
