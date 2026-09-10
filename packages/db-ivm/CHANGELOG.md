# @tanstack/db-ivm

## 0.1.20

### Patch Changes

- Fix on-demand load settlement, ordered pagination, and replay to preserve coherent results across cancellation, failure, cleanup, and restart. Preserve subset results and ownership across Electric, PowerSync, Query, and SQLite persistence adapters. Correct live-query grouping, include projections, value identity, and indexed comparisons. D2 hashing now rejects structural cycles and excessive traversal depth or work with an explicit error; Collection handles retain object-reference identity without traversing their mutable contents. ([#1797](https://github.com/TanStack/db/pull/1797))

  Remove the unused public subset-algebra helpers: `isWhereSubset`, `unionWherePredicates`, `minusWherePredicates`, `isOrderBySubset`, `isLimitSubset`, `isOffsetLimitSubset`, `isPredicateSubset`, and `isLoadSubsetRequestSubsumedBy`. Apps that import these helpers must remove those imports; normal queries and adapters are unaffected. `DeduplicatedLoadSubset` remains available and shares only exact demand identities.

  Reject compiled Collection-valued includes as `fn.select()` inputs, including nested descendants, before invoking the callback. Use `toArray()` or `materialize()` in the upstream `.select()` for child-value calculations. To keep live child Collections, use expression `.select()` or perform parent-only functional work before adding the includes. Ordinary Collection-valued includes remain supported.

  Remove proxy `DEBUG` logging and automatic index timing statistics to avoid diagnostic work on reads and writes. Remove `getStats()` and `IndexStats`; use `index.keyCount` for the current entry count, and instrument index methods externally when profiling. Custom index subclasses must remove calls to the retired `trackLookup()` and `updateTimestamp()` helpers.

  Fix mutation drafts so Map/Set `forEach` calls each callback once and read-only iteration reports no changes. Track nested Map `for...of` edits through `collection.update()`. Keep Set entries in place during nested edits, preserving live iteration and usable `has`, `delete`, and `add` handles without duplicate entries or repeated visits. Reverting one entry no longer discards another entry's pending changes.

  Preserve shared values within a row's draft. Newly supplied objects use normal shared references during the update callback, including Map values and Set members; editing through either handle changes the same new object. Copy completed changes at callback return so later caller edits cannot mutate stored data. Existing collection values remain isolated. Copy a new caller-owned value before insertion if it must remain untouched during the callback.

  Keep rejected local-storage mutations out of later successful saves. Stage insert, update, delete, and manual transaction writes before persisting, then promote the shared cache only after storage succeeds.

  Deliver live-query observer publications to peer listeners even when one listener throws. Preserve queued publication order and stop delivery on disposal; report the first listener failure after delivery.

  Wait for PowerSync demands admitted during tracking finalization before reporting them loaded. Preserve untouched object and array key identity when they contain `NaN`. Retire every failed ordered acquisition on explicit retry, while retaining a full-source demand repaired by replay.

  After authoritative ordered recovery succeeds, retire settled page and tie demands so later truncate replay fetches only the full-source replacement. Keep unfinished requests observed until settlement and preserve independent query ownership.

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

## 0.1.19

### Patch Changes

- Rebuild correlated include materialization as one D2 graph, fixing stale or missing nested results across route changes, batching, lazy loading, optimistic updates, and layered queries. Add canonical structural relation keys, abortable subset demand, and coherent publication for Collection-valued includes. Dispose delayed PowerSync subset hooks after cleanup, and prevent released Query Collection cache results from reaching the collection. ([#1740](https://github.com/TanStack/db/pull/1740))

## 0.1.18

### Patch Changes

- Fix Temporal objects breaking live query updates when used with joins. Temporal objects (e.g. `Temporal.PlainDate`) have no enumerable properties, so the structural hash function produced identical hashes for all Temporal values, causing join index updates to be silently swallowed. Also add Temporal support to value normalization for join key matching and to the comparator for correct sort ordering. ([#1370](https://github.com/TanStack/db/pull/1370))

## 0.1.17

### Patch Changes

- Add string support to `min()` and `max()` aggregate functions. These functions now work with strings using lexicographic comparison, matching standard SQL behavior. ([#1120](https://github.com/TanStack/db/pull/1120))

## 0.1.16

### Patch Changes

- Add `groupedOrderByWithFractionalIndex` operator. This operator groups elements by a provided `groupKeyFn` and applies ordering and limits independently to each group. Each group maintains its own sorted collection with independent limit/offset, which is useful for hierarchical data projections where child collections need to enforce limits within each parent's slice of the stream rather than across the entire dataset. ([#997](https://github.com/TanStack/db/pull/997))

## 0.1.15

### Patch Changes

- Adds a GroupedTopKWithFractionalIndexOperator that maintains separate topK windows for each group. ([#993](https://github.com/TanStack/db/pull/993))

## 0.1.14

### Patch Changes

- Use row keys for stable tie-breaking in ORDER BY operations instead of hash-based object IDs. ([#957](https://github.com/TanStack/db/pull/957))

  Previously, when multiple rows had equal ORDER BY values, tie-breaking used `globalObjectIdGenerator.getId(key)` which could produce hash collisions and wasn't stable across page reloads for object references. Now, the row key (which is always `string | number` and unique per row) is used directly for tie-breaking, ensuring deterministic and stable ordering.

  This also simplifies the internal `TaggedValue` type from a 3-tuple `[K, V, Tag]` to a 2-tuple `[K, V]`, removing unnecessary complexity.

## 0.1.13

### Patch Changes

- Fix Uint8Array/Buffer comparison to work by content instead of reference. This enables proper equality checks for binary IDs like ULIDs in WHERE clauses using the `eq` function. ([#779](https://github.com/TanStack/db/pull/779))

- Fix bug with setWindow on ordered queries that have no limit. ([#763](https://github.com/TanStack/db/pull/763))

## 0.1.12

### Patch Changes

- Fix bug with setWindow on ordered queries that have no limit. ([#701](https://github.com/TanStack/db/pull/701))

## 0.1.11

### Patch Changes

- Add `utils.setWindow()` method to live query collections to dynamically change limit and offset on ordered queries. ([#663](https://github.com/TanStack/db/pull/663))

  You can now change the pagination window of an ordered live query without recreating the collection:

  ```ts
  const users = createLiveQueryCollection((q) =>
    q
      .from({ user: usersCollection })
      .orderBy(({ user }) => user.name, 'asc')
      .limit(10)
      .offset(0),
  )

  users.utils.setWindow({ offset: 10, limit: 10 })
  ```

## 0.1.10

### Patch Changes

- Redesign of the join operators with direct algorithms for major performance improvements by replacing composition-based joins (inner+anti) with implementation using mass tracking. Delivers significant performance gains while maintaining full correctness for all join types (inner, left, right, full, anti). ([#571](https://github.com/TanStack/db/pull/571))

## 0.1.9

### Patch Changes

- Add support for Date objects to min/max aggregates and range queries when using an index. ([#428](https://github.com/TanStack/db/pull/428))

## 0.1.8

### Patch Changes

- Fix a bug with distinct operator ([#564](https://github.com/TanStack/db/pull/564))

- Change the ivm indexes to use a three level `key->prefix->hash->value` structure, only falling back to structural hashing when there are multiple values for a single prefix. This removes all hashing during the initial run of a query delivering a 2-3x speedup. ([#549](https://github.com/TanStack/db/pull/549))

## 0.1.7

### Patch Changes

- Fix memory leak that results in linear memory growth with incremental changes over time. Thanks to @sorenbs for finding and fixing this. ([#550](https://github.com/TanStack/db/pull/550))

## 0.1.6

### Patch Changes

- optimise key loading into query graph ([#526](https://github.com/TanStack/db/pull/526))

## 0.1.5

### Patch Changes

- Fix bug where different numbers would hash to the same value. This caused distinct not to work properly. ([#525](https://github.com/TanStack/db/pull/525))

## 0.1.4

### Patch Changes

- Check typeof Buffer before instanceof to avoid ReferenceError in browsers ([#519](https://github.com/TanStack/db/pull/519))

## 0.1.3

### Patch Changes

- fix count aggregate function (evaluate only not null field values like SQL count) ([#453](https://github.com/TanStack/db/pull/453))

- Hybrid index implementation to track values and their multiplicities ([#489](https://github.com/TanStack/db/pull/489))

- Replace JSON.stringify based hash function by structural hashing function. ([#491](https://github.com/TanStack/db/pull/491))

## 0.1.2

### Patch Changes

- Optimize order by to lazily load ordered data if a range index is available on the field that is being ordered on. ([#410](https://github.com/TanStack/db/pull/410))

- Optimize joins to use index on the join key when available. ([#335](https://github.com/TanStack/db/pull/335))

## 0.1.1

### Patch Changes

- Fix bug with orderBy that resulted in query results having less rows than the configured limit. ([#405](https://github.com/TanStack/db/pull/405))

## 0.1.0

### Minor Changes

- 0.1 release - first beta 🎉 ([#332](https://github.com/TanStack/db/pull/332))

### Patch Changes

- We have moved development of the differential dataflow implementation from @electric-sql/d2mini to a new @tanstack/db-ivm package inside the tanstack db monorepo to make development simpler. ([#330](https://github.com/TanStack/db/pull/330))
