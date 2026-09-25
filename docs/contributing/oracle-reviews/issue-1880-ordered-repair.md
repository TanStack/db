# Issue #1880 ordered-repair oracle review

## Reviewed state

- Base commit: `4c5a8de61843d6964a2580aded8a2d027b78e135`.
- Reviewed change: the Git tree containing this record and the accompanying
  issue #1880 ordered-repair production, test, and architecture changes.
- Primary executable owner:
  `packages/db/tests/query/pagination-oracle.property.test.ts`.
- Adjacent owners:
  `ordered-work-oracle.property.test.ts`,
  `ordered-source-loader-state.test.ts`, `ordered-default-work.test.ts`, and
  `ordered-demand-retirement.test.ts`.

This state description is intentional: a file cannot contain the hash of a
commit that already contains that file. The eventual commit or pull request
identifies the exact immutable tree; this record fixes its comparison base.

## Claim and limits

The reviewed oracle checks that a settled, expressible ordered window repairs a
visible delete or first-provider-term change with an inherited-predicate,
normalized-order, zero-transport-offset prefix followed by the required tie and
refill requests. It also checks row recomputation, publication, failure upgrade,
and acquisition ownership around that path.

The authority is the Ordered loading and Atomic window publication contract in
`packages/db/src/query/live/ARCHITECTURE.md`. The evidence is bounded to the
test grammar and in-memory on-demand adapter seam. It does not certify backend
query plans, network volume, latency, complete SQL predicate semantics, or every
`requiresFullSource` compiler branch.

## ORC-001 through ORC-011

| Requirement | Outcome | Evidence |
| --- | --- | --- |
| ORC-001: contract authority and limits | Pass | The pagination-oracle header names the architecture authority and its limits. This record narrows the repair claim to the tested grammar and adapter seam. |
| ORC-002: independent judgment | Pass | `referenceWindowRows` filters/sorts/slices plain arrays independently of the ordered loader. Exact request checks use literal normalized paths, directions, field absence, and reference predicate evaluation rather than the production request classifier. |
| ORC-003: distinguishable responsibilities | Pass | The file keeps scenario arbitraries, array recomputation, the real Collection driver, request/publication recorders, and refinement helpers separate. `PendingMutationResult` carries the work observation from the driver to both generated campaigns. |
| ORC-004: generated-history grammar controls | Pass | The bounded grammar crosses insert/update/delete, resolve/reject, before/after settlement, ranks, directions, and limits. Named products reconstruct every mutation/outcome/timing cell; the `[0,1,1,2]` case pins tie plus refill, and missing-row deletion is rejected. Existing fault/ablation cases show the contribution of publication, window, settlement, callback, delete-value, and final-value observations. |
| ORC-005: production path and observation | Pass | The driver uses `createLiveQueryCollection` over a real on-demand Collection. It compares visible rows and callback cuts, and now records the complete post-mutation adapter request sequence, including inherited predicate behavior, normalized order term order/direction, cursor, limit, and transport offset. |
| ORC-006: checker calibration | Pass | `rejects a malformed bounded-repair request trace` supplies the old checker's plausible survivor: missing predicate, wrong same-length order terms, `offset: 99`, and an extra request. The exact trace checker rejects it. Existing captured-history faults calibrate value/publication checks. |
| ORC-007: fixed/random campaigns and replay | Pass | The fixed-seed and random/replayed `pagination.pending-mutation` properties invoke the same arbitrary, `runPendingMutationScenario`, `PendingMutationResult` recorder, request-work checker, and run budget. `oracleRandomParameters` accepts the configured seed and shrink path for direct replay. |
| ORC-008: stateful-model minimality | Not applicable | The repair adds a request-trace result, not new reference-model state, and does not merge or remove model states. |
| ORC-009: vocabulary mapping | Pass | In this record, a repair prefix is an ordered request without a cursor or transport offset; a tie is a predicate-only request for the first provider term; a refill is an ordered cursor request. Full-source recovery omits `orderBy`, `limit`, `cursor`, and `offset`, but still inherits the subscription `where` predicate. The work checker distinguishes a filtered full-source predicate from a tie by evaluating it over distant ranks. `mutationRepairRequests` means adapter requests started after the modeled source mutation, not rows delivered locally. |
| ORC-010: failure fidelity and cleanup | Pass | `PendingMutationTraceAssertionError` retains the violated checkpoint and delivered-row trace. `withHistoryCleanup` preserves the primary failure while settling subscriptions, outstanding requests, the live query, and source cleanup. Partial-write rejection has a direct-loader ownership witness. |
| ORC-011: independent second formulation | Pass | The public pagination history and direct `OrderedSourceLoader` state test distinguish the shared-fault risk that correct final rows could hide a malformed or over-broad provider request. Ordered-work parity separately compares Collection and Effect publication behavior. |

ORC-012 is satisfied by this versioned, base-identified closeout record and its
link from `docs/contributing/oracle-coverage.md`.

## Calibration and known omissions

The hostile trace proves that checking only order-term count, limit, and missing
cursor would accept a semantically wrong request. The capped-provider case
proves the deterministic repair chain `prefix -> tie(rank 1) -> cursor refill ->
tie(rank 2)`. A semantic predicate check distinguishes a repair tie from a
filtered full-source fallback. The partial-write integration witness proves the
next request is exactly full-source; the direct-loader ownership test proves
that lease releases occur in order `[3, 0, 1, 2]` after bounded repair fails.

The complete `requiresFullSource` classifier is documented in architecture but
is not enumerated here branch by branch. Adapter-specific transfer and query
execution remain adapter conformance concerns. Effect failure publication is
covered by source-error disposal plus direct failure ownership evidence; this
review adds the previously missing held-success callback witness.

## Verification

Closeout requires the focused changed owners, both pending-mutation campaigns,
the complete `@tanstack/db` test suite, the package build, changed-file lint and
format checks, and `git diff --check`. Exact final counts belong in the pull
request or issue receipt because they describe the immutable execution, not the
oracle contract.
