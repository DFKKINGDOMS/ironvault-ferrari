# PartQuill pilot safety invariants

These are executable product boundaries, not marketing guidance.

1. Public publishing requires a preflight approval and a different public-approval action.
2. Both approvals bind to the exact canonical SHA-256 hash and payload version.
3. Public approval also binds to the staged offer's current fee-estimate identifier.
4. Any payload replacement creates a new version and makes earlier approvals unusable.
5. `ALLOW_EBAY_WRITES=false` is a global kill switch checked at every external mutation.
6. Production eBay writes are refused by configuration validation in this pilot release.
7. A compatibility row without permitted eBay compatibility evidence blocks publishing.
8. Unknown origin normally holds international eligibility, not a domestic draft.
9. Safety-critical keywords hard-block the launch pilot.
10. Remanufactured core inventory requires structured core terms and remains policy-gated.
11. The original image is retained with its byte hash before a derivative is accepted.
12. A derivative cannot exist without its original image record.
13. Suspected third-party watermark removal is blocked.
14. A used-part derivative that fails foreground preservation is blocked.
15. Blocked, rejected and failed publishes do not consume the ten-listing free allowance.
16. Revise and withdraw use the same Inventory API ownership path as publish.
17. Remote differences create a drift exception and are never silently overwritten.
18. Every external write and rejection creates an append-only audit event.
19. Mock mode never produces an ePID or an `EBAY_CATALOG_MATCH` evidence state.
20. Preflight requires both `READY_FOR_PREFLIGHT` and the versioned seller acknowledgement of Inventory API lifecycle ownership.
21. A does-not-fit report quarantines sibling claims that share the same sourced compatibility edge.
22. Remote drift remains held until the seller explicitly accepts the remote state, prepares a local revision, or withdraws the offer.
23. Image Studio never overwrites a source and never exposes its filesystem path.
24. Every AI derivative must pass source-versus-result QA; a failed secondary may escalate once, while an unresolved failure requires review.
25. Suspected third-party watermark removal is blocked before an image-model call.
26. A ChatGPT subscription is never represented as an embeddable PartQuill API credential.
27. A generated image derivative can improve presentation but cannot prove part identity, condition or fitment.

## Deliberately unavailable

- Universal photograph-only part identification.
- Exact photo-derived weight or package dimensions.
- Marketplace-comp pricing from eBay content.
- Production eBay writes.
- Live catalog claims without a production-probe evidence record.
- Generative repair, damage removal or geometry changes to a used part.
