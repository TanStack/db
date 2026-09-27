# Issue #1882 custom local collation oracle review

## Reviewed state

- Base commit: `f473a362`.
- Reviewed change: the Git tree containing this record and the accompanying
  issue #1882 custom local collation production, test, and architecture changes.
- Primary executable owner:
  `packages/db/tests/query/pagination-oracle.property.test.ts`.
- Focused supporting owners: `comparison.property.test.ts`,
  `collection-indexes.test.ts`, `cursor.test.ts`,
  `live-query-options.test.ts`, `query/builder/order-by.test.ts`,
  `query/expression-helpers.test.ts`, and
  `query/ir-stable-identity.test.ts`.

This state description is intentional: a file cannot contain the hash of the
commit that already contains it. The eventual commit or pull request identifies
the exact immutable tree; this record fixes its comparison base.

## Claim and limits

The reviewed lane checks that a custom local string comparator is preserved by
collection defaults and per-order configuration, applies only to string pairs,
and orders both scan and auto-index paths in ascending and descending direction.
Comparator-equal rows retain ascending public-key order. Runtime QueryIR,
load-subset demand, live-query config, and local index compatibility use the
exact comparator function reference.

For an on-demand source, any custom order term makes the first acquisition one
filtered full-source request for both bounded and unbounded queries. The request
retains the query predicate and omits `orderBy`, `limit`, `offset`, and cursor.
Hostile provider order cannot become a local ordering authority. Ordinary range
predicates keep their existing lexical meaning, do not call the custom
comparator, and cannot use custom string index range traversal.

The authority is the Ordered requests, continuation, and recovery contract in
`packages/db/src/query/live/ARCHITECTURE.md` and the public
`StringCollationConfig` API. Evidence is bounded to the declared C-01 through
C-09 rows, in-memory on-demand adapter seam, and focused identity/index tests.
It does not establish a stable cross-runtime collation identifier, provider
capability negotiation, custom cursor pagination, comparator-aware ranges,
backend SQL fidelity, function serialization, or comparator exception and
non-finite-result policy.

## ORC-001 through ORC-011

| Requirement | Outcome | Evidence |
| --- | --- | --- |
| ORC-001: contract authority and limits | Pass | The pagination-oracle header and this record name the local custom-order law, architecture authority, exact request shape, and deferred remote/range behavior. |
| ORC-002: independent judgment | Pass | C-01 through C-09 use a declared rank relation and literal expected public-key sequences. They do not use production `makeComparator`, index matching, cursor classification, or loader request classification to compute the expected rows or request shape. |
| ORC-003: distinguishable responsibilities | Pass | The opening oracle prose states the contract and limits; `customCollationRanks` is the reference relation; the nine named bounded/unbounded, single/multi-source, and output-default cells are the fixed input grammar; the Collection/live-query scenarios are the production driver; and their row, path, and exact request assertions are the refinement check. |
| ORC-004: generated-history grammar controls | Not applicable | The new lane is a fixed bounded semantic/path matrix, not a generated-history property. Existing generated pagination campaigns and their grammar are unchanged. |
| ORC-005: production path and observation | Pass | The driver uses `createCollection` and `createLiveQueryCollection`, observes exact ordered public rows after `preload()`, proves scan versus eager auto-index reach, and records every provider request including predicate and omitted window fields. |
| ORC-006: checker calibration | Pass | The hostile provider emits filtered rows in a different physical and tie order. The original RED run reported 11 failures and 487 passes when the five bounded cells exposed legacy locale order (`[3,2,1,4]` ascending and `[4,1,2,3]` descending). A later boundary challenge added C-06 and C-07: both produced the correct local rows but failed because the provider request leaked `orderBy`, preserving an exact 2-failure/5-pass signal. C-08 reproduced the same leak when a later ordered source inherited the leading source's custom default. C-09 then produced the correct local rows but failed its exact request-shape assertion in a targeted run (1 failed, 249 skipped): expected no provider `orderBy`, but received normalized `label` order after the output Collection selected lexical collation. All nine cells pass after provider hint admission was separated from the output Collection's downstream default. |
| ORC-007: fixed/random campaigns and replay | Not applicable | ORC-007 is triggered only by an important generated property. This change adds fixed cells and leaves the existing pagination generated campaigns, seeds, replay interface, recorder, and budgets unchanged. |
| ORC-008: stateful-model minimality | Not applicable | The fixed relation adds no model state and does not combine, split, or remove states in the existing pagination history model. |
| ORC-009: vocabulary mapping | Pass | A custom comparator is the caller's local string/string relation. A filtered full-source acquisition retains `where` but omits provider order/window fields. Comparator identity means exact runtime function reference; it is not a remote collation identity. These terms match the architecture and production boundaries. |
| ORC-010: failure fidelity and cleanup | Pass | The driver asserts rows and request shape before cleanup, then always cleans the live query and source. Existing `cleanupAll` keeps the primary Vitest assertion visible while releasing both resources. The RED receipts preserved both wrong ordered vectors at the public-row checkpoint and leaked provider `orderBy` at the request-shape checkpoint. |
| ORC-011: independent second formulation | Pass | Literal C-cell vectors judge the end-to-end Collection path, while focused comparator, parser, identity, cursor, and index tests independently pin callback dispatch and boundary preservation. Scan and auto-index cells distinguish a false agreement confined to one local ordering path. |

ORC-012 is satisfied by this versioned, base-identified closeout record and its
link from `docs/contributing/oracle-coverage.md`.

## Calibration and omissions

The provider order puts `+3 power` before `3` even though the custom relation
declares them equal, and places `pillow fort` before `pillowfort` despite the
declared custom order. The filtered-out row shares a comparator position with a
kept row. These controls make predicate loss, provider-order trust, comparator
loss, descending tie reversal, duplicate/omitted acquisition, and scan/index
disagreement observable.

Distinct but extensionally equivalent comparator functions are deliberately
different query, demand, config, and index identities. The implementation does
not serialize a function identity or claim cross-runtime reuse. A mutable
closure can invalidate an already-built index, so the API contract requires a
deterministic comparator whose behavior remains immutable for its lifetime.

The final focused GREEN run completed 502 tests across eight files with no type
errors. Exact final full-suite, build, lint, and format receipts belong in the
pull request because they describe an immutable execution rather than this
oracle contract.
