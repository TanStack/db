---
'@tanstack/db': minor
'@tanstack/db-ivm': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/query-db-collection': patch
---

Fix on-demand load settlement, ordered pagination, and replay to preserve coherent results across cancellation, failure, cleanup, and restart. Preserve subset results and ownership across Electric, PowerSync, Query, and SQLite persistence adapters. Correct live-query grouping, include projections, value identity, and indexed comparisons. D2 hashing now rejects structural cycles and excessive traversal depth or work with an explicit error; Collection handles retain object-reference identity without traversing their mutable contents.

Remove the unused public subset-algebra helpers: `isWhereSubset`, `unionWherePredicates`, `minusWherePredicates`, `isOrderBySubset`, `isLimitSubset`, `isOffsetLimitSubset`, `isPredicateSubset`, and `isLoadSubsetRequestSubsumedBy`. Apps that import these helpers must remove those imports; normal queries and adapters are unaffected. `DeduplicatedLoadSubset` remains available and shares only exact demand identities.

Reject compiled Collection-valued includes as `fn.select()` inputs, including nested descendants, before invoking the callback. Use `toArray()` or `materialize()` in the upstream `.select()` for child-value calculations. To keep live child Collections, use expression `.select()` or perform parent-only functional work before adding the includes. Ordinary Collection-valued includes remain supported.

Remove proxy `DEBUG` logging and automatic index timing statistics to avoid diagnostic work on reads and writes. Remove `getStats()` and `IndexStats`; use `index.keyCount` for the current entry count, and instrument index methods externally when profiling. Custom index subclasses must remove calls to the retired `trackLookup()` and `updateTimestamp()` helpers.

Fix mutation drafts so Map/Set `forEach` calls each callback once and read-only iteration reports no changes. Track nested Map `for...of` edits through `collection.update()`. Keep Set entries in place during nested edits, preserving live iteration and usable `has`, `delete`, and `add` handles without duplicate entries or repeated visits. Reverting one entry no longer discards another entry's pending changes.

Remove the live-query `utils.getRunCount()` diagnostic and its runtime counter. Apps that call this diagnostic must remove those calls. Query scheduling and results are unchanged.

Remove test-only index inspection getters (`indexedKeysSet`, `valueMapData`, `orderedEntriesArray`, and `orderedEntriesArrayReversed`) and unused scheduler diagnostics. `ReverseIndex` now exposes only the `IndexReader` lookup, range, and forward traversal surface returned by `findIndexForField`; mutate the original index instead. Export `IndexReader` for callers that name this return type. Remove the unused subscription `releaseLoadSubset()` method; request owners use the release callback supplied by `onLoadSubsetResult`. Ordinary query and adapter APIs remain unchanged by these removals.

Remove unused internal helpers and the unused public error classes `WhereClauseConversionError`, `SubscriptionNotFoundError`, and `AggregateNotSupportedError`. These classes have no remaining runtime throw sites; remove any imports of them. Keep the existing query and index behavior and exercise identity/evaluation tests through the production entry points.

Ensure failed mutations roll back even when their rejection value cannot be converted to a string. Preserve ordinary Error instances; report unprintable rejection values as `Unknown error`.

Make reentrant effect disposal share the active cleanup result, including calls from abort listeners or source release callbacks. A release failure reaches every waiting disposer while each source still receives one release attempt.

Reject starting or preloading a collection from inside its active cleanup callbacks with a clear `CollectionStateError`. Nested cleanup cannot admit replacement work that the old teardown would discard. Restart after cleanup completes, or from its final `cleaned-up` status event, remains supported.

Prevent older page or tie-boundary completions from clearing a newer full-source failure or starting redundant loading. Failed window moves retain their settled public snapshot; an explicit retry releases the failed acquisition once and publishes the completed replacement.

Restrict direct subscription `requestLimitedSnapshot()` cursor inputs to one order term and one `minValues` entry. Composite and partial-composite cursor inputs now throw before local delivery or adapter work. Use normal live-query ordering and window APIs for multi-column pagination; those remain supported through prefix-and-tie loading. Existing adapters need no changes.

Treat `LoadSubsetOptions` and their nested request data as immutable from submission onward. Core no longer copies expression trees or mutable constant payloads at the sync and deduplication boundaries. Create a new Date, byte array, membership array, or options object when changing a demand instead of mutating submitted data. Adapters must also leave request data unchanged. Use stable data properties rather than stateful getters. `AbortSignal` cancellation and subscription release remain live.

Replace replay acquisitions sequentially: release the prior physical lease before starting its replacement. The logical demand and last complete public result remain retained. A failed release prevents replacement startup; failed startup leaves demand available for a later authoritative replay. Custom adapters must support a release/load gap and preserve resources still held by other owners; a sole underlying resource may stop and restart.
