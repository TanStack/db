# Persistence / Electric / SQLite cluster — design analysis

Synthesis of 15 open issues (#82, #865, #1415, #1416, #1443, #1453, #1456, #1478,
#1486, #1487, #1498, #1499, #1560, #1567, #1589) against the current source.
The cluster is not 15 independent bugs — it decomposes into seven failure classes,
each with a broad fix that resolves multiple issues at once.

---

## Failure class 1 — "Rows wiped, resume cursor kept" (data loss / permanently-empty collections)

**Issues:** #1589, #1478, likely #1456. The single worst class: users end up with a
collection that is `ready` and permanently empty, with nothing logged.

**Mechanism (verified in source):**
- `handleSchemaMismatch` (`db-sqlite-persistence-core/src/sqlite-core-adapter.ts:1982-2049`)
  deletes rows, tombstones, `applied_tx`, and the index registry — but **not
  `collection_metadata`** (where Electric stores `electric:resume` offset+handle,
  written at `electric.ts:1458-1475`) and not `leader_term`.
- On next boot, `canUsePersistedResume` (`electric.ts:1347-1351`) sees a matching
  `shapeId`, opens the ShapeStream at the stale offset (`electric.ts:1408-1417`),
  Electric replies "up-to-date, no rows" → empty forever.
- Progressive-mode reconnect (#1478) is a sibling: must-refetch forces
  `transactionStarted = true` (`electric.ts:1689-1718`), which bypasses the
  progressive atomic-swap branch (`electric.ts:1725-1729`), and follower tabs
  receiving `requiresFullReload` broadcasts do a visible truncate-and-reload
  (`persisted.ts:1964-1980`).

**Broad fix:**
1. **One reset primitive.** Introduce a single `resetCollection()` in the core
   adapter that atomically wipes rows + tombstones + `applied_tx` + index registry
   + **`collection_metadata`** and resets `collection_version`/`leader_term`
   together. Every wipe path (schema mismatch, corruption recovery, explicit
   clear) must go through it. Today each path hand-picks tables to delete.
2. **A cross-layer invariant: resume metadata's lifetime is bound to the row data.**
   Belt-and-braces on the sync side: `canUsePersistedResume` should decline when
   the persisted row count is 0 but the resume record claims a non-initial offset.
3. **Progressive mode must honor its own contract on must-refetch:** buffer the
   refetched snapshot and atomic-swap instead of truncating inside the live
   transaction; suppress the follower-tab full-reload flash by shipping the swap
   as one `tx:committed`.

---

## Failure class 2 — Readiness gated on the network (offline-first is broken by design)

**Issues:** #1416, #1443, and the spirit of #82/#865.

**Mechanism:** in sync-present mode the wrapped `markReady`
(`persisted.ts:2246-2258`) fires **only when Electric calls it** — which happens
only on `up-to-date`/`subset-end` (`electric.ts:1798`) or stream `onError`
(`electric.ts:1425`). Offline, the Electric client silently retries → no error,
no up-to-date → collection stays `loading` forever even though local hydration
(`persisted.ts:1209-1256`) already applied every persisted row. The local-only
branch does the right thing (`persisted.ts:2555-2563`: ready after
`ensureStarted()`); the sync-present branch has no equivalent bridge. Two more
silent asymmetries: the electric branch drops `startSync: true` / `gcTime: 0`
that local-only sets (`persisted.ts:2644-2649` vs `2746-2747`).

**Broad fix:** *local hydration is a first-class ready signal.* After
`ensureStarted()` resolves with persisted rows, call `markReady()` — the
collection is "ready with local data"; Electric catching up later is just more
sync writes. Options: default-on with an opt-out (`readiness: 'remote-first'`)
for apps that must not render stale data, or a tri-state exposed on the
collection (`localReady` / `remoteReady`). Either way, add a **readiness
watchdog**: if a persisted collection is still `loading` after N seconds, log a
diagnostic naming the blocked stage. Four issues in this cluster are silent
hangs; none should be.

---

## Failure class 3 — BrowserCollectionCoordinator: three wrong assumptions

**Issues:** #1443, #1486, #1498, #1589 (bug 1).

Each of the coordinator's core assumptions fails in practice:

| Assumption | Reality | Issue |
|---|---|---|
| One adapter slot serves all collections | `createBrowserWASQLitePersistence` caches adapters per `(policy, schemaVersion)` and each `setAdapter()` call overwrites the slot (`browser-persistence.ts:136-138`) → collection A's RPCs run through B's adapter → spurious schema-mismatch wipes | #1589 |
| Non-leader tabs can run adapter ops locally | Exclusive OPFS `createSyncAccessHandle` means the second tab's worker can't touch the file at all → leadership retry loop floods console, tab never hydrates | #1486 |
| RPC payloads are structured-cloneable | `requestEnsureRemoteSubset` posts raw `LoadSubsetOptions` — containing a `Subscription` class instance and expression objects (`db/src/types.ts:287-314`) — over BroadcastChannel (`browser-coordinator.ts:506-535`); retried every 50 ms forever | #1498 |

**Broad fixes, in order of size:**
1. **Small:** per-collection adapter map on the coordinator instead of a single
   slot (`setAdapter(collectionId, adapter)`).
2. **Small:** define a serializable wire schema for every RPC payload. The
   sanitizer already exists — `normalizeSubsetOptionsForKey`
   (`persisted.ts:703-713`) strips exactly the offending fields but is only used
   to compute dedupe keys. Serialize `where`/`orderBy` as IR JSON (the persisted
   index path already does this: `buildPersistedIndexSpec`,
   `persisted.ts:2141-2152`).
3. **Architectural decision needed:** make DB access topology match OPFS
   reality. Two candidate designs from #1486:
   (a) a SharedWorker per origin owns the OPFS handle, every tab talks to it —
   cleanest, kills the leader/follower split for DB access entirely (Safari
   <16.4 gap); or (b) keep per-tab workers but route **all** adapter ops from
   non-leaders through leader RPC — smaller change, keeps BroadcastChannel as
   the only cross-tab dependency. Related: every tab currently runs its own
   Electric ShapeStream (`persisted.ts:2506-2509` has no leader gate) — leader-
   only sync with `tx:committed` fan-out would halve server load and remove a
   class of races.
4. **Testing:** there is no multi-tab e2e and no Electric+coordinator e2e —
   multiple reporters noted the examples avoid exactly the combination that
   breaks. This combination needs a playwright multi-context test before any of
   the above ships.

---

## Failure class 4 — Offline writes are never persisted (sync-present mode)

**Issues:** #1456, #82.

**Mechanism:** the electric branch of `persistedCollectionOptions` returns the
user's `onInsert/onUpdate/onDelete` **unwrapped** (`persisted.ts:2644-2649`);
only the local-only branch wraps handlers with
`persistAndConfirmCollectionMutations` (`persisted.ts:2671-2717`). So an
optimistic mutation reaches SQLite only after it round-trips through the server
and streams back via the wrapped `commit`. Offline: the write lives only in
memory and dies on reload.

**Broad fix:** decide and document the contract, then implement it. The
principled design (already articulated in #865: *in-memory view = persisted base
+ pending mutation delta*) is to persist the **pending transaction outbox** in
SQLite alongside the synced base — i.e., first-class integration between
`@tanstack/offline-transactions` and the persistence layer, so persisted Electric
collections survive reload with their unsynced writes intact. Short of that,
the docs must state plainly that electric+persistence does not persist
unconfirmed writes — today users discover it by losing data.

---

## Failure class 5 — Driver-boundary fragility

**Issues:** #1499 (op-sqlite `executeAsync` returns columnar
`{rawRows, columnNames}`; `extractRowsFromStatementResult` at
`op-sqlite-driver.ts:153-171` misreads it as a zero-row write → every SELECT
returns `[]` → cascading `UNIQUE constraint failed: collection_registry` →
sync never starts), #1560 (expo-sqlite types redefined loosely instead of
imported → TS2322 on the documented happy path).

**Broad fix:**
1. **A driver conformance test kit** exported from
   `db-sqlite-persistence-core` (or a `-test-utils` package): one suite that
   every driver package runs against its real driver — round-trip of all tagged
   types, SELECT-after-INSERT, transaction semantics, result-shape extraction,
   registry bootstrap on a pre-populated DB. #1499's bug class (silent
   empty-SELECT) is exactly what a conformance kit catches and unit tests don't.
2. **Fail loud on unrecognized result shapes.** `extractRowsFromStatementResult`
   guessing "presence of rowsAffected ⇒ empty read" converts an unknown shape
   into silent data loss; unknown shapes should throw.
3. Import driver types from the vendor package (expo) rather than redefining
   them (#1560's fix).

---

## Failure class 6 — No corruption recovery

**Issue:** #1567 (Electron app bricked by a truncated SQLite file until manual
deletion).

**Mechanism:** verified — no `integrity_check`/`quick_check`, no
`SQLITE_CORRUPT` handling anywhere in the persistence packages. Corruption
surfaces as a generic `INTERNAL` worker error; sync-present collections wedge
forever (class 2), local-only ones silently "ready" empty.

**Broad fix:** the persistence layer is by design a rebuildable cache — so
wipe-and-resync on corruption is *safe*, and this is precisely why the class-1
reset primitive must clear resume metadata: "quarantine + rebuild" is only
correct if the rebuilt DB doesn't inherit a stale resume point. Implement
`openWithRecovery` in core: detect `SQLITE_CORRUPT*`/`SQLITE_NOTADB` on open or
first statement, close handle, rename file (+`-wal`/`-shm`) to
`.corrupt-<timestamp>`, retry once, rethrow anything else. #1567 contains full
acceptance criteria, including the Windows handle-lifecycle caveat.

---

## Failure class 7 — Composition API and typing

**Issues:** #1415, #1453; also the root of much of #1416/#1456 confusion.

**Mechanism:** the spread-merge pattern
(`persistedCollectionOptions({...electricCollectionOptions({...}), persistence})`)
erases the inferred types, forcing four hand-written generic params (see
`examples/react-native/shopping-list/src/db/collections.ts:149-193`), and
`PersistedSyncOptionsResult` emits `schema?: TSchema | undefined`, which matches
neither `createCollection` overload group. `TSchema` is threaded but never used
for inference; utils typing diverges between the two modes.

**Broad fix:** merge the two waiting community PRs (#1415 `NormalizeSchema`,
#1453 schema-aware overloads) as the near-term patch, then consider a
first-class composition surface that preserves inference — e.g. a two-argument
form `persistedCollectionOptions(electricOptions, { persistence, schemaVersion })`
where the first argument's full type (including utils) flows through, or a
`persistence` option accepted directly by `electricCollectionOptions`. The
current shape makes the *type-level* composition the user's problem and the
*behavior-level* divergences (classes 2 and 4) invisible.

---

## Process observations

- Four community PRs with complete analyses are unreviewed: #1415, #1453
  (types), #1487 (expression-index JSON-path inlining — index exists but is
  unmatchable because runtime queries bind JSON paths as `?` params; fix
  inlines path literals and adds `EXPLAIN QUERY PLAN` regression), #1560 (expo
  types). All four are merge-candidates with low risk.
- #1486's author explicitly asked for architectural direction before writing
  code (SharedWorker vs leader-RPC) and got no reply — the class-3 decision
  above unblocks them.
- No contribution docs (#1415 mentions this), no multi-tab or
  Electric+coordinator e2e coverage.

## Suggested priority order

1. **Class 1** — reset primitive + resume invariant (small, fixes the worst
   data-loss class: #1589, #1478 partially, likely #1456).
2. **Class 2** — local-ready semantics + watchdog (small-medium, unlocks the
   headline offline-first value: #1416, #1443).
3. **Class 3 quick fixes** — per-collection adapter map + RPC payload
   serialization (#1589 bug 1, #1498), then decide SharedWorker vs leader-RPC
   for #1486, with a multi-tab e2e first.
4. **Merge the four community PRs** (#1415, #1453, #1487, #1560).
5. **Class 5** — driver conformance kit (#1499 fix + prevents recurrence).
6. **Class 6** — corruption recovery (#1567), after class 1 lands.
7. **Class 4 / 7** — outbox persistence for sync-present writes and the
   composition API redesign (biggest design efforts; overlap with
   offline-transactions roadmap and #865).

---

## Ground-truth addendum (red/green verification)

External-review claims were verified with failing tests before acceptance.
Verification tests live in `review-claims.test.ts` in each of:
`db-sqlite-persistence-core/tests`, `browser-db-sqlite-persistence/tests`,
`react-native-db-sqlite-persistence/tests`.

**Confirmed RED and fixed (GREEN) in this branch:**
1. Schema-mismatch reset left `electric:resume` behind → `handleSchemaMismatch`
   now deletes `collection_metadata` in the same transaction (#1589 bug 2).
2. op-sqlite v14 `executeAsync` columnar results read as zero rows → driver now
   zips `rawRows`+`columnNames` into row objects (#1499).
3. Raw `LoadSubsetOptions.subscription` posted over BroadcastChannel →
   DataCloneError flood; RPC payload now strips the per-tab subscription (#1498).
4. Coordinator single adapter slot cross-wired collections with different
   schemaVersions, wiping rows → per-collection adapter registry;
   `browser-persistence` registers per collectionId (#1589 bug 1).

**Confirmed RED, fix deferred to RFC (kept as `it.fails` tests):**
- Sync-present collection stays `loading` forever when the source never
  signals, despite hydrated local rows (#1416/#1443).
- Sync commits are write-behind: a failed disk write is only logged; visible
  data silently vanishes on restart.
- Sync-present optimistic mutations never reach local storage before the
  stream echo (#1456) — needs the outbox design decision.

**Confirmed by inspection only (not red/green):** must-refetch bypasses
progressive atomic swap (`transactionStarted=true` skips the swap branch);
expression-index JSON-path bind mismatch (open PR #1487 carries regressions);
OPFS exclusive-handle vs Web Locks mismatch (#1486, needs real browser e2e).

**New finding beyond the review:** the leader-side `handleEnsureRemoteSubset`
ignores the request payload entirely and replies `ok: true` — cross-tab
subset ensures are currently a no-op placebo for on-demand collections.
