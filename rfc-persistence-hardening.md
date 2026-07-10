# RFC: Hardening the SQLite persistence / Electric sync stack

**Status:** Draft
**Scope:** Bug fixes and hardening only. No new public API surface except where
explicitly flagged as an open decision. The larger architectural reframings
that surfaced during this investigation (replica manifest, readiness state
machine, storage broker) are recorded as future direction in the appendix, not
proposed here.

---

## 1. Background

Fifteen open issues cluster around `persistedCollectionOptions` +
`electricCollectionOptions` + the browser/mobile SQLite persistence adapters:
#82, #865, #1415, #1416, #1443, #1453, #1456, #1478, #1486, #1487, #1498,
#1499, #1560, #1567, #1589.

These are not fifteen independent bugs. Every serious one reduces to a small
set of broken invariants, and the worst share a single shape: **the
persistence layer and the sync adapter each own state the other one wipes.**
The terminal user-visible state is always the same — a collection that is
`ready`, empty, and silent — which is why these reports looked random and
data-specific when they are actually deterministic.

Every mechanism below was ground-truthed with a failing test before being
accepted — see `review-claims.test.ts` in
[`db-sqlite-persistence-core/tests`](https://github.com/TanStack/db/blob/explore-persistence-electric-sqlite/packages/db-sqlite-persistence-core/tests/review-claims.test.ts),
[`browser-db-sqlite-persistence/tests`](https://github.com/TanStack/db/blob/explore-persistence-electric-sqlite/packages/browser-db-sqlite-persistence/tests/review-claims.test.ts),
and
[`react-native-db-sqlite-persistence/tests`](https://github.com/TanStack/db/blob/explore-persistence-electric-sqlite/packages/react-native-db-sqlite-persistence/tests/review-claims.test.ts)
on the
[`explore-persistence-electric-sqlite`](https://github.com/TanStack/db/tree/explore-persistence-electric-sqlite)
branch.

## 2. Verified defects

| #   | Defect                                                                                                                                                                                                                                                                                                                                      | Issues                          | Verification                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| D1  | `handleSchemaMismatch` wipes rows/tombstones/`applied_tx` but not `collection_metadata`, so Electric's `electric:resume` offset survives the reset. Next boot resumes "up-to-date" past all the wiped data → permanently empty, silently ready.                                                                                             | #1589 (bug 2)                   | RED test; fixed                                                                                            |
| D2  | `BrowserCollectionCoordinator` has one mutable adapter slot; `createBrowserWASQLitePersistence` overwrites it per `(policy, schemaVersion)`. Collection A's leader-side ops run through collection B's adapter → spurious schema-mismatch reset wipes A.                                                                                    | #1589 (bug 1)                   | RED test reproducing the cross-collection wipe end-to-end; fixed                                           |
| D3  | Follower tabs post raw `LoadSubsetOptions` — including the per-tab `subscription` object holding functions — over BroadcastChannel. `postMessage` throws `DataCloneError`; the ensure queue retries every 50 ms forever → console flood, subset never ensured.                                                                              | #1498                           | RED test (`DataCloneError: () => true could not be cloned`); fixed                                         |
| D4  | `OpSQLiteDriver` doesn't recognize op-sqlite v14 `executeAsync`'s columnar `{rawRows, columnNames}` result; the `rowsAffected` marker makes every SELECT read as zero rows → `UNIQUE constraint failed: collection_registry...` at startup, collection stuck `loading`.                                                                     | #1499                           | RED test (`expected [] to deeply equal [...]`); fixed                                                      |
| D5  | Progressive-mode resume: the initial atomic swap truncates hydrated persisted rows when the resumed stream sends `up-to-date` with no rows.                                                                                                                                                                                                 | #1478                           | Community PR #1493 (root cause matches our independent code analysis; has regression test)                 |
| D6  | Sync-present readiness is gated entirely on the source: if Electric neither reaches `up-to-date` nor raises `onError` (the normal offline retry case), `markReady` never fires even though local hydration completed and the rows are in the collection. Local-only mode already marks ready after hydration — the asymmetry is the defect. | #1416, #1443                    | RED test (`size === 1`, status stuck `loading`); kept as `it.fails`. Community PR #1615 implements the fix |
| D7  | Sync commits are write-behind: the in-memory commit lands, then persistence runs as a `void` promise whose failure is only `console.error`'d. Visible, "committed" data silently vanishes on restart.                                                                                                                                       | (underlies #1456-class reports) | RED test; kept as `it.fails`                                                                               |
| D8  | Sync-present optimistic mutations never reach local storage; only stream echoes persist. Offline writes die on reload.                                                                                                                                                                                                                      | #1456, #82                      | RED test; kept as `it.fails`                                                                               |
| D9  | Expression indexes are stored with inlined JSON paths but runtime queries bind paths as `?` params, so SQLite can never match the index — every indexed query full-scans.                                                                                                                                                                   | #1487                           | Open community PR with `EXPLAIN QUERY PLAN` regressions; code-verified                                     |
| D10 | Web Locks leadership is orthogonal to OPFS exclusive access: each tab spawns its own wa-sqlite worker wanting the exclusive sync access handle; the second tab's worker can't open the file, so it error-loops forever.                                                                                                                     | #1486                           | Code-verified; browser-only, needs e2e infra to test                                                       |
| D11 | Type-level: `PersistedSyncOptionsResult` emits `schema?: TSchema \| undefined`, matching neither `createCollection` overload; spread-composition requires four hand-written generics.                                                                                                                                                       | #1415, #1453, #1560             | Community PRs with analysis                                                                                |
| D12 | No corruption handling anywhere: a truncated/corrupt SQLite file wedges startup (sync-present) or silently readies empty (local-only) on every launch until the user manually deletes the file.                                                                                                                                             | #1567                           | Code-verified (zero `SQLITE_CORRUPT`/`integrity_check` references)                                         |
| D13 | **New finding:** leader-side `handleEnsureRemoteSubset` ignores the request payload and unconditionally replies `ok: true`. Cross-tab subset ensures are a no-op: on-demand follower tabs get whatever is already in SQLite, not the subset they requested.                                                                                 | (latent behind #1498)           | Code-verified                                                                                              |

**Related report outside this layer:** #1662 (failing-test repro) shows the
same "ready with missing rows" family in core `@tanstack/db`: in on-demand
mode, `loadSubset` resolves and the live query marks ready while the fetched
rows are still parked in `pendingSyncedTransactions` behind an in-flight
`persisting` transaction. It violates the spirit of invariant 6 below but
lives in the core commit guard rather than the persistence layer, so it is
tracked there (and in the loadSubset RFC #1657) rather than in this PR
series. Also related and already merged: #1626 fixed stale rows from
query-owner metadata lost on insert (#1618), and #1644 fixed a sibling of D3
(clone-unsafe on-demand query metadata) in `query-db-collection`.

## 3. Invariants to enforce

These become the release-gating tests for this area. Each is small, testable,
and violated today (or was, before the fixes on this branch):

1. **A destructive reset clears the sync resume state atomically with the rows
   it invalidates.** No wipe path may leave `collection_metadata` behind.
2. **A sync adapter must not trust a resume point that outlived its data.**
   Belt-and-braces on top of (1): decline a persisted resume whose collection
   has zero persisted rows but a non-initial offset.
3. **One collection's configuration can never destroy another collection's
   data.** All routing (coordinator RPC, adapter resolution) is keyed by
   collection.
4. **An unknown driver result shape is an error, never an empty result.**
5. **Every value posted over BroadcastChannel/postMessage survives
   `structuredClone()`.** Per-tab objects (subscriptions, callbacks, schema
   objects) never cross the wire.
6. **Locally hydrated persisted data is readable without the network.**
   (Semantics decision required — see Open Decisions.)
7. **A persistence write failure is never silent.** At minimum it surfaces
   through an error channel; visible-but-not-durable state must be
   distinguishable from durable state.

## 4. Proposed PR series

Ordered so that each PR is independently shippable and the highest
data-loss-risk items land first. PRs 1–3 are implemented with tests and
changesets on the
[`explore-persistence-electric-sqlite`](https://github.com/TanStack/db/tree/explore-persistence-electric-sqlite)
branch and can be split out directly — PR 1:
[`4244cbd7`](https://github.com/TanStack/db/commit/4244cbd7), PR 2:
[`875a9894`](https://github.com/TanStack/db/commit/875a9894), PR 3:
[`4ca90715`](https://github.com/TanStack/db/commit/4ca90715).

### PR 1 — core: schema reset clears collection metadata (D1)

- `handleSchemaMismatch` deletes `collection_metadata` for the collection in
  the same transaction that wipes rows/tombstones/`applied_tx`.
- Regression test: rows + `electric:resume` persisted at v1, reopen at v2 →
  rows gone **and** resume gone.
- Risk: low. Any metadata key (`electric:resume`, `queryCollection:gc:*`)
  describes data that no longer exists after the reset.

### PR 2 — browser: coordinator routing + wire safety (D2, D3)

- Per-collection adapter registry: `setAdapter(adapter, collectionId?)` with
  the old single slot as fallback; all five leader-side `requireAdapter` call
  sites resolve by collection; `createBrowserWASQLitePersistence` registers
  per `collectionId` (including on adapter-cache hits).
- `requestEnsureRemoteSubset` strips the per-tab `subscription` before
  posting. (Safe today because of D13; see PR 6 for making the RPC real.)
- Regression tests: end-to-end cross-collection wipe repro (two collections,
  two schemaVersions, leadership acquisition must not destroy rows);
  structured-clone-strict BroadcastChannel mock proving the RPC ships.
- Risk: low-medium. The fallback slot preserves existing single-collection
  behavior exactly.

### PR 3 — react-native: op-sqlite v14 result shape (D4)

- `extractRowsFromStatementResult` recognizes `{rawRows, columnNames}` and
  zips it into row objects, checked before the write-marker fallback.
- Regression test: fake DB exposing only `executeAsync` with columnar
  results; SELECT-after-INSERT round-trips.
- Follow-up in the same PR or PR 7: unknown result shapes should throw
  (invariant 4) rather than fall through to `null`/empty.

### PR 4 — review & land the five waiting community PRs

- #1493 (D5): endorse. Root cause matches independent analysis; minimal fix
  (treat a valid persisted resume as already past the initial swap phase);
  regression test included.
- #1615 (D6): endorse. Independently implements this RFC's PR 6 "local-ready"
  change — `markReady()` after `ensureStarted()` resolves in
  `createWrappedSyncConfig`, skipped in on-demand mode — with regression test
  and changeset. Their trigger case was TanStack Query's
  `networkMode: 'offlineFirst'` rather than Electric, but it is the same
  mechanism. Landing it resolves Open Decision 1 as local-first.
- #1487 (D9): endorse direction. Inlines JSON-path literals so index DDL and
  runtime predicates share SQL shape; keeps values bound; `EXPLAIN QUERY
PLAN` regressions included.
- #1415 + #1453 (D11): the `NormalizeSchema` helper and schema-aware
  overloads. Land together; they overlap.
- #1560 (D11): expo types imported from the vendor package instead of
  redefined. CodeRabbit-reviewed, no actionable comments.

### PR 5 — electric: resume-point hardening (invariant 2)

- `canUsePersistedResume` declines when the persisted row count is zero but
  the stored offset is non-initial, and writes a `reset` record so the next
  start snapshots from scratch.
- This closes the whole "wiped rows, kept cursor" class for any wipe path
  that PR 1 doesn't cover (external file deletion, partial restores, future
  reset paths that forget the metadata).
- Also audit the must-refetch path: it forces `transactionStarted = true`,
  which bypasses progressive buffering; verify with a stream-harness test
  that truncate + refetched snapshot always commit atomically.

### PR 6 — readiness and durability hardening (D6, D7, D13)

Three changes; the first needs the semantics decision below:

- **Local-ready:** in sync-present mode, `markReady()` after local hydration
  completes with persisted rows (matching what local-only mode already does).
  The two `it.fails` tests in `review-claims.test.ts` become the acceptance
  criteria. **Update:** community PR #1615 already implements exactly this;
  reviewing/landing it (PR 4) satisfies this bullet.
- **No silent persistence failure:** the write-through queue tracks failures
  and surfaces them (collection error state or at minimum a structured,
  rate-limited error with the collection id and failed tx). Today it is a
  bare `console.error` in a `void` chain.
- **Un-stub the follower ensure RPC (D13):** leader triggers its own
  `loadSubset` for the requested subset (options are now clone-safe after
  PR 2), or the RPC is removed and the limitation documented. A silent
  `ok: true` placebo is the worst of both.

### PR 7 — driver conformance hardening (invariant 4)

- Extend the existing contract suite
  (`db-sqlite-persistence-core/tests/contracts/`) with: the executeAsync
  columnar shape, unknown-shape-throws, parameter-binding round-trips of all
  tagged types, and SELECT-after-INSERT against a pre-populated registry
  (the #1499 startup path).
- Run the shared suite from every driver package (op-sqlite, expo, wa-sqlite,
  node, tauri, electron, capacitor).

### PR 8 — multi-tab: e2e first, then topology (D10)

- Do **not** attempt further lock-retry patches for #1486.
- Step 1: a Playwright multi-context e2e covering the currently untested
  combinations (Electric + BrowserCollectionCoordinator; two tabs on OPFS).
- Step 2: document the current OPFS multi-tab support honestly (the package
  docstring already says "single-tab wiring" for the default; say so in the
  README and issue a console warning when a second tab hits the exclusive
  handle) — until the topology decision (below) is made.

### PR 9 (decision-gated) — corruption quarantine (D12)

- Detect `SQLITE_CORRUPT*`/`SQLITE_NOTADB` on open/first statement, close the
  handle, rename the file (+`-wal`/`-shm`) to `.corrupt-<timestamp>`, retry
  once, rethrow anything else. #1567 has full acceptance criteria including
  the Windows handle-lifecycle caveat.
- Requires PR 1/PR 5 first: rebuild is only safe when the rebuilt DB cannot
  inherit a stale resume point.
- Flagged as decision-gated because even an internal-default recovery path
  changes observable behavior and may warrant a small option.

## 5. Open decisions (maintainer input needed)

1. **Local-ready semantics (PR 6).** When a sync-present persisted collection
   hydrates rows locally but the source hasn't reached up-to-date: mark ready
   (local-first, recommended — matches local-only mode and the offline-first
   promise) with an opt-out for apps that must never render stale data? Or
   keep remote-gated readiness as the default and add an opt-in? The bug
   reports (#1416, #1443) all wanted local-first, and community PR #1615
   implements local-first — approving that PR settles this decision.
2. **Multi-tab topology (#1486).** SharedWorker-per-origin owning the OPFS
   handle vs. routing all non-leader adapter ops through leader RPC. The
   issue author offered to implement whichever is chosen. This decision also
   determines whether every tab keeps its own Electric ShapeStream or the
   leader syncs for everyone.
3. **Offline outbox (D8).** Persisting pending sync-present mutations is
   genuinely new behavior (the #865 "persisted base + pending delta" design)
   and is out of scope for this hardening series. Decide whether to document
   the current contract loudly ("electric+persistence does not persist
   unconfirmed writes") as an interim step.

## 6. Appendix: deferred architectural direction

Recorded from the external review for future consideration; all are
new-feature scope and intentionally **not** part of this series:
orthogonal replica status (storage/hydration/sync/durability),
a per-collection replica manifest with generation fencing, typed reset
operations replacing generic `truncate()`, a database-level storage broker,
authority classification for recovery (`rebuildable-replica` vs
`local-source-of-truth`), operational APIs (`inspect`/`checkIntegrity`/
`repair`), and `withPersistence`-style typed composition. The invariants in
§3 are chosen so that landing them now does not foreclose any of these
designs later.
