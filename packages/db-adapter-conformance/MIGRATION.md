# Migrating every collection adapter onto the conformance oracles

Goal (maintainer, 2026-10-29): every collection adapter runs the shared
conformance oracles through its own production driver, not only Neon. An
adapter is migrated when it has a driver for every oracle family whose
capabilities it declares in the law set's section A, and each driver is GREEN
or has a recorded RED with an owner.

Migration does not delete an adapter's existing oracles. An existing owner
keeps its laws until a shared family checks the same law, history, path, and
observation. Then the coverage map moves the law to the shared owner, and the
old test either stays as supplemental coverage or is removed in its own
reviewed change.

## Oracle families

| Family                                | Status                                    | Laws                                                                                                                 |
| ------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Eager live source                     | Built (`src/eager-live-source-oracle.ts`) | READY-2/3/4/8/10, HEALTH-1/2/5, PUB-1/2/3/5/7/9, FID-1/4, LIFE-2/5/10, EVID-1/2/3, RETRY-1 (eager), RECON-1, RENEW-1 |
| Mutations and confirmation            | Built (`src/mutation-oracle.ts`)          | MUT-1/2/4/5/7/10/13, FID-5                                                                                           |
| On-demand loading                     | Needed                                    | DEM-1 to DEM-23, MAP-1 to MAP-4                                                                                      |
| Reload and retry                      | Needed                                    | RELOAD-1 to RELOAD-5; RETRY-1 and HEALTH-2 beyond the eager source's retried failures                                |
| Client cache and refetch              | Needed                                    | CACHE-1 to CACHE-8, REF-1 to REF-7, DIR-1 to DIR-5                                                                   |
| Source shapes                         | Needed                                    | RESET-1, RESUME-1 to RESUME-3, PROG-1, MEMB-1/2, PAGE-1 to PAGE-3, OWN-1/2, META-1                                   |
| Local and shared stores               | Needed                                    | SELF-1 to SELF-3, STORE-1 to STORE-4, PEER-1                                                                         |
| Persistence wrapper and storage hosts | Needed                                    | `P-*`, `S-*`                                                                                                         |

## Adapters

| Adapter           | Families that apply (section A)                                                       | Driver status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neon Realtime     | eager live source, mutations                                                          | Eager: RED (READY-4, HEALTH-1, and LIFE-10 behind them); adapter update pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Electric          | eager live source, mutations, on-demand, source shapes, reload and retry, persistence | Eager: GREEN (2026-10-30) after three fixes, per-batch commits, typed Postgres columns, over the installed client. Driver `electric-db-collection/tests/conformance-driver.ts`, property `adapter-conformance.eager-live-source.electric`. Mutations: GREEN (2026-11-03), no adapter change, `application-handlers`, `log-ordered-echoes`, `held-echoes`. Driver `electric-db-collection/tests/mutation-conformance-driver.ts`, property `adapter-conformance.mutations.electric`. Other families: not started                                                  |
| PowerSync         | eager live source, mutations, on-demand                                               | Eager: GREEN (2026-10-30) after a fix, per-batch commits, over real local SQLite. Driver `powersync-db-collection/tests/conformance-driver.ts`, property `adapter-conformance.eager-live-source.powersync`. Mutations: GREEN (2026-11-03), no adapter change, `undefinedField: 'null'`, `field-updates`. Driver `powersync-db-collection/tests/mutation-conformance-driver.ts`, property `adapter-conformance.mutations.powersync`. On-demand: not started                                                                                                      |
| RxDB              | eager live source, mutations                                                          | Eager: GREEN (2026-10-29) after a fix, per-change commits, `listen-before-fetch`. Driver `rxdb-db-collection/tests/conformance-driver.ts`, property `adapter-conformance.eager-live-source.rxdb`. Mutations: GREEN (2026-11-03) after a fix, `undefinedField: 'absent'`. Driver `rxdb-db-collection/tests/mutation-conformance-driver.ts`, property `adapter-conformance.mutations.rxdb`                                                                                                                                                                        |
| TrailBase         | eager live source, mutations, on-demand                                               | Eager: GREEN (2026-10-29), per-change commits. Driver `trailbase-db-collection/tests/conformance-driver.ts`, property `adapter-conformance.eager-live-source.trailbase`; declares `duplicate-key-delivery` and `source-failure-after-ready`. Mutations: GREEN (2026-11-03) after a fix, `undefinedField: 'null'`, `field-updates`, `held-echoes`. Driver `trailbase-db-collection/tests/mutation-conformance-driver.ts`, property `adapter-conformance.mutations.trailbase`. On-demand: not started                                                             |
| Convex            | eager live source, mutations, on-demand, source shapes                                | Eager: GREEN (2026-11-02) after a fix, per-batch commits, complete results, over the real Convex JavaScript client and a controlled WebSocket. Driver `convex-db-collection/tests/conformance-driver.ts`, property `adapter-conformance.eager-live-source.convex`. Mutations: GREEN (2026-11-03), no adapter change, `application-handlers`, `ordered-answers`, `log-ordered-echoes`, `held-echoes`. Driver `convex-db-collection/tests/mutation-conformance-driver.ts`, property `adapter-conformance.mutations.convex`. On-demand, source shapes: not started |
| query-db          | client cache and refetch, on-demand, mutations, reload and retry, persistence         | Not started; not a push source, so the eager family does not apply                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| local-only        | local and shared stores, mutations                                                    | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| localStorage      | local and shared stores, mutations                                                    | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Persisted wrapper | persistence wrapper                                                                   | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Storage hosts (8) | storage hosts                                                                         | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Suggested order

1. **Push adapters on the existing family:** RxDB (done), TrailBase (done), PowerSync (done), Electric (eager mode, done), and Convex (eager mode, done). Each needs only a controlled-provider driver. A RED result is a finding against that adapter.
2. **Retire duplicated adapter tests (separate PR, maintainer decision 2026-11-02).** For each adapter on the eager family, classify its existing eager-mode tests and oracles against what the shared oracle generates and observes: remove a test only when the shared family checks the same law, history, path, and observation; narrow one it covers in part; keep the rest. Known overlap: TrailBase's lifecycle oracle and the shared family both own eager startup failure and stream-end health.
3. **The Neon update, run against its driver.** This shows an adapter moving from RED to GREEN. Publishing the package for drivers outside this repository (a public package, `@tanstack/db` as a peer dependency, an exported reach counter) is deferred (maintainer decision 2026-11-02).
4. **The mutations family (in progress).** It applies to every adapter except the storage hosts.
5. **The other families,** one at a time. Each family's new driver work goes to the adapters that declare it.

## Next slice: mutations and confirmation (started 2026-11-02)

The family checks what an adapter owes when an application writes, through
one shared model and one driver per adapter, as the eager family does. Core
keeps its own owners for laws that no adapter can change: joining a
transaction (MUT-4) and holding synced commits behind pending optimistic
state (MUT-5) stay with `packages/db/tests/optimistic-history-oracle.ts`.

- **Laws, first cut:** MUT-1 (the write is visible until it settles), MUT-2
  (a rejected write rolls back and `isPersisted` rejects with the error),
  MUT-13 and MUT-3 (one handler call per write, with the authored values),
  MUT-10 (writes reach the backend in order per Collection), FID-5 and MUT-8
  (after settlement the backend holds the fold of accepted writes; a rejected
  write leaves no backend effect), and MUT-7 (under confirmation through sync,
  the write stays persisting until its own write arrives in a committed
  batch). Authority: the law set's section 9 and FID-5.
- **Capabilities:** `adapter-persistence` (the adapter writes to the backend
  itself: RxDB, TrailBase, PowerSync) and `confirm-through-sync` (the
  application's handler writes and returns evidence: Electric, Convex).
- **Model:** the synced rows, the backend rows, and the pending writes in
  author order with their outcome. Visible rows are the synced rows with the
  pending writes folded on; a settled write leaves the fold.
- **Grammar:** single-row inserts, updates, and deletes through the
  Collection; the backend accepts or rejects a write, at once or held; the
  backend's copy arrives through sync, at once or withheld; a commit by
  another client while no write is pending. Manual and multi-mutation
  transactions, and commits by another client while a write is pending
  (MUT-11), are planned grammar extensions, not generated yet.
- **Observations:** visible rows and change events, each transaction's state
  and settlement, the backend rows and the order of backend operations,
  handler calls.
- **Calibration:** a reference adapter for each capability and hostile
  mutants per law.
- **Order:** the family and its reference adapter, then RxDB, TrailBase,
  PowerSync (adapter persistence), then Electric and Convex (confirmation
  through sync).

## Migration log

- **2026-10-29, TrailBase, eager live source.** Both campaigns are GREEN.
  - **Reach:** every declared state reached by at least five histories.
  - **Driver evidence:** a temporary adapter edit, `fail()` only on a closed stream, was rejected with HEALTH-1 by both campaigns, then reverted.
  - **Oracle changes this migration exposed:**
    - PUB-7 replacement is now gated on `complete-snapshot`, because TrailBase lists once per sync run.
    - The check now decides whether a driver supports a step before it moves the model.
  - **Ownership:** `lifecycle-oracle.property.test.ts` keeps its laws. It also checks eager startup failure and stream-end health, so those laws now have two owners until the coverage map moves them.
- **2026-10-29, eager live source, closed limits.** The family now also
  checks PUB-1 publications during each step, LIFE-10 release at failure,
  HEALTH-5 detached failures and console diagnostics, EVID-3 timeouts, and
  retried failures (`retry-policy`: HEALTH-2, RETRY-1). The evidence is in
  `README.md`.
  - **TrailBase** stays GREEN on the stronger check, with `per-change`
    commits. It found no TrailBase defect. It found one checker defect: the
    PUB-1 match took the first equal state, so a batch that returned to an
    earlier state was flagged. The match now searches forward from the last
    matched commit.
  - **Neon** stays RED with READY-4 and HEALTH-1. Two probes, not kept,
    showed what is behind them. With `markError` mapped to `fail`, Neon fails
    LIFE-10: it keeps the raw subscription open after an error state until
    cleanup. With that subscription also released once at the error state,
    300 histories pass. These two changes are the Neon update's scope.
- **2026-10-29, RxDB, eager live source.** Both campaigns are GREEN; it
  found no RxDB defect.
  - **Driver:** a controlled RxCollection with a real `RxSchema`. Its
    `storageInstance.query` answers the adapter's prepared queries with
    RxDB's `getQueryMatcher` and `getSortComparator`, so the adapter's paged
    initial fetch (`syncBatchSize` 2) and `_meta.lwt` cursor run against
    RxDB's query semantics. Each delivery is one bulk write whose documents
    share an `lwt`, as RxDB storage writes do. `$` is an RxJS Observable that
    counts teardowns per subscription.
  - **Driver evidence:** temporary edits of `src/rxdb.ts`, each reverted:
    - no release when the initial fetch fails: LIFE-10 (open provider
      subscriptions), both campaigns;
    - a `$` error ignored: HEALTH-1 (health error cause), both campaigns;
    - the cursor's primary-key tie-break removed: READY-3 (rows), both
      campaigns. The first driver gave each document its own `lwt` and
      missed this; RxDB's bulk writes share one, so the driver was changed;
    - a live event committed without its write: PUB-3/FID-4 (rows), both
      campaigns;
    - the cursor set to a page's first document: survives. It is
      equivalent: the adapter re-reads and re-inserts rows it already holds,
      and the rows are unchanged.
  - **Open (in scope, not generated):** RxDB subscribes to `$` before its
    initial fetch and buffers events until the fetch completes. The eager
    grammar treats a batch before the first ready as illegal, so it never
    sends events during the fetch. That needs a provider-state grammar, in
    which the complete delivery reads the provider's current state and
    earlier events are a consistent log. `rxdb.test.ts` keeps examples for
    it. Owner: this package; witness needed: a generated history with
    events between the subscription and the first ready.
- **2026-10-29, eager live source, `listen-before-fetch` (from the RxDB
  migration).** The RxDB open item became an oracle extension. A driver
  that declares `listen-before-fetch` gets backend state, a seed of rows
  committed before the subscription, a startup burst of batches committed
  during the first fetch, and a read point (`seen`). The model folds the
  buffered batches onto the fetch result at the initial cut; publications
  must be backend states at or after the read point (PUB-5, PUB-9). Every
  driver also gets a check of the rows at the moment status becomes `ready`
  (READY-3, READY-10). Five reference mutants calibrate it, and the reach
  of the three new states is declared. Evidence: `README.md`.
- **2026-10-29, RxDB on `listen-before-fetch`: one RxDB defect.** The
  driver now seeds the backend, answers the initial fetch from its read
  point, and counts queries issued without a live `$` subscription.
  - **RED:** both campaigns failed READY-10 (status `error` where `ready` is
    owed). Shrunk: a document inserted and then updated during the fetch,
    which the read already reflects. RxDB replayed the buffered `INSERT` as
    a sync `insert`, and core rejected it as a duplicate key with a
    different value. A receiving witness on memory storage
    (`rxdb.test.ts`, `becomes ready when the initial read already reflects
a buffered insert and update`) failed the same way.
  - **Fix:** RxDB writes `INSERT` and `UPDATE` events as a sync `update`;
    core inserts an updated key it does not hold. One case less.
  - **GREEN:** the RxDB suite, 22 tests, including both campaigns and the
    witness.
  - **Mutants of `src/rxdb.ts`:** the original insert write (READY-10
    status), fetch before listen (READY-8), buffer dropped (READY-10 rows),
    ready before the buffer applies (READY-10 rows when ready), no release
    on a failed fetch (LIFE-10), a `$` error ignored (HEALTH-1), no cursor
    tie-break (READY-10 rows), a live write dropped (PUB-3/FID-4). Each was
    rejected by both campaigns and reverted.
  - **Oracle change this exposed:** READY-8 is checked before any other
    observation, since a fetch before listening explains what follows.
- **2026-10-29, eager live source, field removal and event fold (from the
  RxDB migration).** A row now has an optional `note`, so a later row can
  remove a field (FID-1); a mismatch only in fields is labeled FID-1, and
  the declared state `field-removed` covers live batches, replacing
  complete deliveries, and the initial cut. The change-event fold now also
  flags an update of a key it does not hold (PUB-2). Drivers share
  `observedView`; TrailBase and Neon, whose backends are SQL, carry an
  absent `note` as `NULL` (`toSqlRow`, `fromSqlRow`).
  - **Calibration:** `merges-updates` (FID-1) and `relabels-inserts`, a
    checker calibration that relabels insert events as updates (PUB-2).
  - **Budgets:** `field-removed` needs a held note and a later row without
    it. At 200 histories TrailBase reached it as few as 2 times; drivers now
    run 400 histories and the reference 600.
  - **TrailBase:** GREEN; no defect. Its records carry every column, so a
    removed note arrives as `NULL` and replaces the old value.
  - **Neon:** still RED on READY-4 and HEALTH-1 only; a probe without
    failure steps passed 300 histories with notes.
  - **RxDB:** RED on FID-1; see the next entry.
- **2026-10-29, RxDB on field removal: a second RxDB defect.** The driver
  stores an absent `note` as an absent document field and uses the shared
  `observedView`.
  - **RED:** both campaigns failed FID-1: a removed `note` stayed (`a/x`
    where `a` is owed). RxDB wrote whole documents as sync `update`s, and
    core's default `partial` row mode merged them over the held row. A
    memory-storage witness (`rxdb.test.ts`, `removes a field that a
document update removes`) failed the same way.
  - **Fix:** the RxDB sync config declares `rowUpdateMode: 'full'`.
  - **GREEN:** RxDB suite 23/23; four repeats of the random campaign pass.
  - **Mutant:** removing `rowUpdateMode` fails FID-1 in both campaigns.
- **2026-10-29, eager live source, typed values (FID-1).** A driver declares
  `valueKinds`, the kinds of its `valueDomain`; rows then carry a `value`
  drawn from edge cases of each kind, compared by an independent strict
  description (`describeValue`). Reach is declared per kind and per path
  (initial load, live change). A `retouch` change re-delivers a held row
  with every zero's sign flipped (`zero-sign-flipped`), or equal when the
  domain has no `-0`.
  - **Calibration:** `dates-as-strings` (live changes), `bigints-as-numbers`
    (initial load), `drops-nulls`, `loses-negative-zero`, each FID-1
    (values). A path ablation shows the change-path states need their own
    deliveries.
  - **Core defect:** a synced update from `-0` to `0` published no change
    event (PUB-2), because core compared rows with `deepEquals`. Maintainer
    decision: `-0` and `0` are distinct row values. The synced commit path
    now uses `sameRowValue`. A fix applied only at a value's top level
    survived until the `retouch` dimension, then failed PUB-2.
  - **Drivers:** RxDB, TrailBase, and Neon declare `jsonValueKinds`. RxDB and
    TrailBase are GREEN; Neon passes 300 failure-free histories with values
    and keeps its READY-4 and HEALTH-1 RED. TrailBase now runs 600 histories
    (`field-removed` fell to 7 at 400).
  - **Open then:** the rejection lane (FID-3, PUB-4), and core's other
    `-0` paths; see the next entry.
- **2026-10-29, core `-0` paths beyond sync (from the typed-value lane).**
  Maintainer decision: `-0` and `0` are distinct for user writes too. Each
  owner was extended first and went RED on the parent:
  - **Draft proxy:** a write of `0` over `-0` recorded no mutation.
    `proxy-oracle` gained `-0` values and deltas (`zero-sign-write` reach);
    the flat change-tracking law "-0 written over 0 is not a change" was
    reversed. Both trackers now compare with `Object.is`.
  - **Optimistic path:** two stacked pending writes, `-0` then `0`, left
    subscribers at `-0`. `optimistic-history-oracle` gained `-0`, a
    `flipZeros` edit, and `zeroSignEditsOverPending` reach; two model rules
    that used `===` (`author`'s no-op test and the unchanged-settlement
    check) now tell the zeros apart. `collectOptimisticChanges` uses
    `sameRowValue`.
  - **Subscription replay and stale reconcile:** a replay replacing `-0`
    with `0` published nothing. The replay and lifecycle publication
    oracles gained `-0` and zero-sign reach, and their models use
    `Object.is`. `createStateDiff` is rejected by generated histories;
    `reconcileStalePublishedChanges` only by a pinned replay, since
    generated histories never reach retained rows (coverage map).
- **2026-10-29, eager live source, rejected deliveries (PUB-4).** A driver
  whose provider can deliver two rows with one key declares
  `duplicate-key-delivery` and the law set's `duplicateInsert` policy. A
  `malformed` step delivers such a complete result. Under `error` the
  model expects PUB-4: no row written, nothing published, earlier rows
  kept, and a sync failure with the adapter's own error. Under `replace` it
  expects PUB-3: the later row wins.
  - **Reference:** `error`; mutants `commits-malformed-prefix` and
    `ignores-malformed` fail PUB-4.
  - **TrailBase:** `replace` (law set); GREEN. A first-row-wins edit of its
    eager load was rejected with PUB-3 (duplicateInsert: replace) by both
    campaigns, then reverted. The first run assumed `error` for every
    driver and failed TrailBase; the law set's policy parameter settled it.
  - **Neon:** the law set declares no `duplicateInsert` for Neon, so its
    driver does not declare the capability.
  - **RxDB:** its storage cannot hold two documents with one key, so the
    capability does not apply.
- **2026-10-30, retained rows in core's publication oracle: held back.**
  A generated failed-replay history (one time in four) reached source writes
  over retained rows. It exposed an open counterexample: after a failed,
  released replay, a write equal to the committed row leaves the subscriber
  stale while a direct read returns the new value. A model change that
  accepted this was wrong under the law that a subscriber equals a direct
  read, and was reverted. Fixing it needs the replay-convergence law settled
  first (ARCHITECTURE.md law 9 says the opposite, and #2294 depends on the
  same rule), so the generator dimension is removed until then and the
  stale reconcile keeps its pinned replays. The shrunk trace and owner are
  in the coverage map.
- **2026-10-30, PowerSync, eager live source: one PowerSync defect.** The
  driver runs the real adapter over a real local PowerSync database
  (SQLite through `@powersync/node`). A complete delivery writes the table
  and then resolves the public `onLoad` hook the eager load awaits; a batch
  is one SQLite write transaction; a failure before ready rejects `onLoad`.
  A release is the abort of the change-watcher registration's signal.
  - **Oracle changes this exposed:** provider steps may be asynchronous, and
    a fixture may declare its propagation step (`settle`, the law set's
    `propagationStep`): PowerSync's changes reach the Collection through a
    throttled watcher. `settle` waits, on the database side, for the initial
    load's diff trigger after a complete delivery and for the watcher's
    callback after a batch. Post-ready `fail` is now a capability
    (`source-failure-after-ready`): the law set gives PowerSync no
    `terminal-source-end`. Without it, histories still fail before ready.
  - **RED:** both campaigns failed LIFE-10 (open provider subscriptions):
    after a failed first load, the run's change watcher stayed registered
    until cleanup. Shrunk: `[fail]`.
  - **Fix:** a failed first load aborts the run's watcher and disposes any
    diff trigger it created.
  - **GREEN:** PowerSync suite 195/195 on four full-suite runs; two
    concurrent campaigns pass. 400 histories; the lowest reach across four
    seeds is 16 (`field-removed`).
  - **Mutants of `src/powersync.ts`:** the original defect (LIFE-10), dropped
    deletes in the diff drain (PUB-3/FID-4), one commit per diff operation
    (PUB-1). Ready before awaiting the initial receipts survives; it is
    equivalent here, since every receipt resolves at once without pending
    optimistic transactions.
  - **Driver lessons:** an initial version waited out a timeout for each
    batch that rewrote a row with its own values (no diff, no callback), and
    hung when cleanup met a still-gated `onLoad`; the driver now expects a
    drain only for a changing write and opens the gate when the adapter
    aborts the run. Under full-suite load, a check ran before a restarted
    run's initial load finished; `settle` now waits for its trigger.
  - **Observed, not yet tested** (for the on-demand and lifecycle families):
    an on-demand startup failure is only logged, with no `fail()` and no
    release; `onLoad` takes no abort signal and cleanup waits for it, so a
    hook that never settles leaves cleanup pending; after ready, an error in
    the eager change handler is only logged.
- **2026-10-30, eager live source, typed fields (FID-1).** A driver declares
  `fieldKinds`, the kinds its backend stores in typed columns; each row then
  carries `typed`, one field per kind, with reach per kind on the load and
  change paths. A driver may declare `excludesValue` for values its backend
  itself cannot store as given. Reference mutant: `typed-booleans-as-numbers`
  (FID-1 values).
  - **PowerSync:** typed columns for string, integer, float, boolean (INTEGER
    0/1), and Date (ISO TEXT), decoded by user `deserializationSchema` and
    validated by `schema`, as an app writes them. GREEN; mutants that skip
    `deserializeSyncRow` on the diff path or on the initial load fail FID-1
    (values) at a change and at the load. No adapter defect.
  - **PowerSync platform limit (excluded, recorded):** its storage keeps a
    number at 15 significant digits. Through its table views
    9007199254740991 reads back as 9007199254740990 and 0.30000000000000004
    as 0.3, and Number.MAX_VALUE is rejected (`powersync_diff: number out of
range`). The Collection shows what the database stored, so this is not
    the adapter's FID-1; the driver excludes such numbers. Worth reporting
    to PowerSync.
- **2026-10-30, Electric, eager live source: three Electric defects.** The
  driver runs the real adapter over the installed `@electric-sql/client`,
  whose `fetchClient` the driver answers with the HTTP shape protocol, as
  `electric-sdk-delivery-oracle` does. A complete delivery answers the
  initial request, or, after ready, a must-refetch (409) and the refetch; a
  batch answers the live request with row messages that carry its txid; a
  failure is an HTTP 400 that the shape's `onError` gives up on; a retried
  failure is an HTTP 503 the client retries or an HTTP 400 that `onError`
  retries. The propagation step waits until the client asks again, or until
  `onError` gave up.
  - **Oracle changes this exposed:** `failureValue: any` for failures whose
    value the client creates. The retried-failure check then owes one to one
    listed failure per attempt, `cause` its newest, and the outage's first
    failure kept until recovery (RETRY-1). `retryReportAfter: k`: a retried
    failure shows only from the `k`th consecutive failed attempt after ready
    (maintainer decision 2026-10-30: no flapping on a blip; Electric
    declares 5), with reach state `transient-failure-below-threshold`.
    `txidEvidence: change`: Electric's
    empty batches carry no txid. The model names EVID-2 for a wait fulfilled
    by a retired run's txid; reference mutant `keeps-retired-evidence`. Two
    generated scenario prefixes (one history in six each) reach EVID-2 and a
    repeated retried failure, with reach states `wait-on-retired-evidence`
    and `transient-failure-repeated`. The `wait-off-by-one` mutant now
    shrinks to a wait for a buffered batch, so that label names
    `EVID-1/READY-10/PUB-9`.
  - **RED 1 (HEALTH-1):** after ready, a retried 503 left health empty.
    Shrunk: `[snapshot [], transient-failure, changes []]`. The same for a
    400 that `onError` retries. After the threshold decision, the first
    fix (report every attempt) went RED in turn: one 503 after ready showed
    a failure where the law owes none.
  - **RED 2 (EVID-2):** after a restart, `awaitTxId` for a txid the retired
    run delivered fulfilled before the new run delivered it. Electric kept
    `seenTxids` for the Collection's life, against its README ("Transaction
    evidence ... belong to one collection lifecycle").
  - **RED 3 (HEALTH-5):** an `onError` that throws was rethrown into the
    client, whose start then rejected unobserved. Shrunk:
    `[fail, restart, fail]`.
  - **Fixes:** the adapter wraps the client's `fetchClient` and counts each
    retried attempt (network error, 429, 5xx) after ready, and each `onError`
    retry decision; the fifth in a row reports the outage once through
    `reportError`. A commit point ends the outage, and `reportHealthy`
    clears its failure once that commit applies. Retirement forgets the run's
    evidence, as scoped recovery already did. A throwing `onError` gives up
    by returning nothing, so the client reports its error to the subscriber.
  - **GREEN:** Electric suite 1242 passed (4 skipped); both campaigns pass
    at 400 histories. Across six seeds the lowest reach is 19
    (`field-removed`).
  - **Mutants of `src/electric.ts`:** no retry reporting (HEALTH-1), no
    count for an `onError` retry (HEALTH-1), a threshold of 4 or 6
    (HEALTH-1), an attempt count that a commit does not reset (HEALTH-1), a
    new failure per attempt that replaces the first (RETRY-1), no recovery
    (HEALTH-2), evidence kept across retirement (EVID-2), a rethrown
    `onError` error (HEALTH-5).
  - **Size:** Electric +223 gzip bytes (+2.3%); the `app` scenario does not
    include Electric. The cost is the `fetchClient` wrapper, which builds a
    `FetchError` with the status and headers an app can read, and one
    attempt counter shared by both retry paths. `onFailedAttempt` was ruled
    out: it carries no error and also fires for a must-refetch 409 and for
    aborts.
  - **Driver lessons:** a retry is part of its run's request chain; only a
    request after an abort or a give-up starts a new run. A float8 column
    holds a scalar `-0` only, and int4 holds 32 bits; both are column
    domains (`excludesValue`). Waiting out a deadline after each give-up
    made histories take 1 s each; the driver now counts the give-ups its
    own `onError` made.
- **2026-10-30, Electric, review round (three oracle reviewers).** The
  reviews found gaps in the previous round's oracle and three more Electric
  defects; the maintainer decided the law questions they raised.
  - **Decisions:** a sync run retires when it fails, so its pending waits
    reject then; a retired run's evidence fulfills a wait once the current
    run is ready (law set v18 EVID-2 said never); "five in a row" restarts
    on any accepted response; a throwing `onError` reports its own error;
    the outage shows the attempt that crossed the threshold; a threshold is
    each adapter's choice (Electric syncs over HTTP, a connection-aware
    source can report at once); recovery clears at once.
  - **Oracle changes:** outages are generated anywhere in a history, with
    lengths below and past the threshold and a recurring outage around a
    live batch; attempt kinds are a generator dimension
    (`transientVariants`); `failureValue: any` is replaced by the driver's
    `matchesFailure` relation, so a stale or replaced value is rejected;
    txids number batches across runs; waits are generated after a failure;
    a field-only publication mismatch names FID-1. New reach states for
    each attempt kind and for an outage reported again, after a batch, and
    in a later run. A reference variant with an outage threshold of 3 and
    client-created values conforms, and its mutants (stale value, replaced
    value, early threshold, count kept across a delivery) are rejected;
    new reference mutants for EVID-2 (retired evidence before ready, never,
    and waits kept after a failure). The on-demand subset lane of
    `electric-sdk-delivery-oracle` gains retried subset attempts, extra
    pausing loads, a live outage, and a source-health check.
  - **RED on 815854815:** EVID-2 at `[fail, wait, snapshot]` (a wait after
    the failure stayed pending); in the on-demand lane, source health
    showed a subset request's five retried 503s (`failures [0,5]`).
    Mutants restoring each earlier behavior were rejected: retired txids
    forgotten (EVID-2), the thrown error not reported (HEALTH-1, health
    error cause), a subset's end ending a live outage (on-demand lane).
  - **Fixes:** the lifecycle keeps retired evidence and counts it after the
    run's ready; a failure rejects pending txid and match waits and later
    unmet ones; the `fetchClient` wrapper skips subset snapshot requests
    (they carry no abort signal), counts every failed shape-log attempt,
    and restarts the count on an accepted response; only an applied
    up-to-date ends an outage; a throwing `onError` fails the run with its
    error.
  - **GREEN:** Electric suite 1242 passed (4 skipped); SDK delivery oracle
    34/34; eager campaigns pass with every declared state reached at least
    15 times across four seeds; reference suite 77/77; TrailBase, RxDB,
    PowerSync pass.
  - **Mutants of `src/electric.ts`, rejected:** retired txids forgotten,
    waits kept after a failure, retired evidence before ready (EVID-2);
    429 or network attempts not counted, threshold 6, thrown error not
    reported (HEALTH-1); subset attempts counted, a subset's end ending the
    outage, aborted requests counted (on-demand lane). Survives: never
    restarting the count on an accepted response, because every accepted
    eager response is also an up-to-date (recorded limit).
  - **Size:** Electric +415 gzip bytes over the merge base (+4.2%), +192
    over the previous round, for the retired-evidence set, failure-time
    wait rejection, and the merged export. The `app` scenario does not
    include Electric.
- **2026-11-02, Electric, open coverage gaps.** Closing the gaps the review
  round left open found one more Electric defect (READY-9).
  - **Partial updates:** the driver now sends an update as Electric's
    default replica mode does, the primary key and the changed columns. A
    mutant that replaces the row with the partial value passed with
    whole-row updates and is now rejected (PUB-3/FID-4). The shared
    `fromSqlRow` shows a row with no `note` column as a field instead of
    throwing, so such a row reaches the comparison.
  - **Accepted response that commits nothing:** new capability and step
    `empty-response` (Electric: HTTP 204 to the live request), with a
    generated element of two below-threshold outages around one, and reach
    `outage-count-reset`. The mutant that never restarts the count on an
    accepted response, which survived last round, is rejected (HEALTH-1 at
    `[snapshot, attempt, empty-response, attempt ×4]`). Reference mutants
    `empty-response-keeps-count` and `empty-response-recovers`.
  - **Give-ups:** by HTTP 400 or by the client's `maxRetries` bound, with
    `onError` returning nothing or throwing; a second campaign runs without
    an app `onError`. A mutant whose no-`onError` path retries is rejected
    (LIFE-10). A mutant that stops logging times out instead: the driver
    detects that give-up from the log (recorded seam).
  - **Evidence across a restart (on-demand lane):** snapshot-boundary
    evidence and imported sync metadata stay pending until the restarted
    run is ready, then fulfill. Mutants: retired snapshots dropped, retired
    txids dropped, retired evidence before ready, each rejected. The lane
    declares reach and runs 40 histories.
  - **READY-9 (retry-decision model):** the model now observes two waits
    and the source's error while ready. RED on e67c4bae9: a give-up while
    the first snapshot's acceptance was pending left a ready Collection with
    no error and pending waits (`[demand, hold-acceptance, up-to-date,
error/sync-give-up, accept]`). Fix: remember that give-up and fail the
    run once acceptance makes it ready, or at once when a truncate commit
    already made it ready (progressive). Mutants removing each half are
    rejected. The controlled driver now reports a give-up decision to the
    subscriber, as the installed client does.
  - **Law set:** `field-trip-adapter-conformance/grammar/v19-laws.md`
    applies the 2026-10-30 decisions (untracked).
  - **GREEN:** Electric 1243 passed (4 skipped); conformance 79/79;
    TrailBase 151, RxDB 23, PowerSync 195.
  - **Size:** Electric +443 gzip bytes over the merge base, +28 for READY-9.
  - **External abort after ready (decided 2026-11-02):** deliberate or
    not, an aborted stream no longer syncs, so it is the source node's
    `error`. The retry-decision model now expects it, also for an abort
    while the first snapshot's acceptance is pending once it is accepted.
    RED on 2dd5f0e75 at `[demand, hold, up-to-date, abort, release]`
    (health none); the adapter now fails the run on an external abort
    after ready.
- **2026-11-02, Convex, eager live source: one Convex defect.** The driver
  runs the real Convex JavaScript client over a controlled WebSocket, as
  `sdk.test.ts` does, and answers the sync protocol. Every delivery is the
  query's complete result in one `Transition`; a failure is a
  `QueryFailed`; a release is the adapter's unsubscribe, counted at the
  client boundary.
  - **Oracle changes this exposed:** capability and step `delivery-error`:
    after ready, the source reports an error for its current result and
    keeps its subscription, and the next valid delivery clears it (HEALTH-1,
    HEALTH-2). Parameter `rejectedDelivery: reported` (the law set's default
    `errorMapping`): a delivery the adapter rejects after ready joins
    `failureReason` with the adapter's own error and the run continues.
    Reach states `delivery-error-reported`, `delivery-error-recovered`,
    `rejected-delivery-reported`. Reference mutants
    `delivery-error-is-fatal` and `rejected-delivery-fails`. The FID-1
    relabel of a publication mismatch is narrowed to value-only
    differences: a split batch differing in `note` is PUB-1.
  - **RED:** LIFE-10 at `[fail, changes []]`: after a failed first load,
    the query subscription stayed open until cleanup.
  - **Fix:** a stopping failure releases the subscription once, also when
    the subscription fails while it is being set up.
  - **GREEN:** Convex suite 114/114; 400 histories per campaign, lowest
    reach 13 across four seeds; about 15 seconds per campaign.
  - **Mutants of `src/options.ts`:** the original defect (LIFE-10), a fatal
    post-ready error (HEALTH-1), no recovery on an equal result (HEALTH-2),
    skipped updates (PUB-3/FID-4), accepted duplicates (PUB-4), each
    rejected. Skipping the truncate on a run's first result survives: an
    eager restart already starts empty; it matters for retained rows, which
    this lane does not generate.
  - **Driver lessons:** a real server acknowledges a query removal at once,
    which drops the client's cached result; without that, a restart reused
    the previous run's cached error. A result equal to the one the client
    holds sends no update, but after an error or a rejected result the
    valid result is a change.
  - **Cached error (decided 2026-11-02):** a restart that comes before the
    server acknowledges the previous run's removal receives the client's
    cached result. A cached valid result is accepted client-cache behavior;
    a cached error must not fail the new run, which waits for the server.
    The driver now acknowledges a removal late while the client's result is
    a failure; new shared reach state `restart-after-failure`. RED on
    6aa2671da at `[fail, restart, fail]` (status `error`, law `loading`),
    for both the JavaScript and React clients. Fix: `subscribeQuery` treats
    an error the client holds at subscription as cached, reports no current
    value, and skips the client's replay of it. Mutants that keep the
    replay, or skip the check on the React path, are rejected. A fixed-seed
    campaign now runs the React client.
  - **Size:** convex-db-collection +26 gzip bytes for LIFE-10.
- **2026-11-03, mutations family, reference adapter.** The family's oracle
  and reference adapter are GREEN on both campaigns, with every declared
  reach state met, and seven mutants each rejected with their law.
  - **Oracle changes this run exposed:** a publication of unchanged row values
    (core's `$hasPendingWrites` update) is not a change of row values; a
    subscription forwards changes only for keys it sent, so the recorder
    starts from the initial state.
  - **Maintainer decision:** a removed field stays an own `undefined`, the
    documented rule; the core owner `optimistic-history-oracle` now generates
    field removal.
- **2026-11-03, RxDB, mutations.** Both campaigns are GREEN after an
  adapter fix, with every declared reach state met.
  - **Driver:** a real RxDB database on memory storage; the provider wraps
    the storage's `bulkWrite`, stores JSON documents, and rejects with a
    per-row write error. An insert the storage refuses as a conflict, which
    RxDB's `bulkUpsert` sends before it updates, is not a request.
  - **RED on the parent:** 38 of 300 fixed-campaign histories failed MUT-10
    (writes did not wait for the earlier one) and 24 failed MUT-2 (a rejected
    delete rejected with an array). Fix: writes run in author order, and a
    failed delete rejects with RxDB's `RxError`. The parent is the hostile
    mutant for both.
  - **Oracle changes this migration exposed:** a driver declares how its
    provider stores an authored `undefined` field (`undefinedField`, FID-1's
    value domain), and the model holds an accepted write's sync transaction
    while another mutation persists (the glossary's held optimistic row). A
    JSON-provider reference campaign and an eighth mutant calibrate both.
  - **Decided 2026-11-03:** a storage `bulkWrite` that throws wedges the
    incremental write queue of RxDB 17.1.0 to 17.5.0, so `incrementalPatch`
    never settles (pubkey/rxdb#9025, fixed in 17.6.0). The adapter keeps
    `incrementalPatch`; its RxDB dev dependency is now 17.6.0 and its peer
    range `>=17.6.0`. A driver can declare `rejectionKinds`; RxDB declares
    a per-row write error and a thrown storage error. RED on 17.1.0 (both
    campaigns failed HEALTH-5 at a thrown update), GREEN on 17.6.0.
  - **Size:** rxdb-db-collection +43 gzip bytes for MUT-10.
- **2026-11-03, mutations family, server rewrites.** A new capability,
  `server-rewrites`: an accepted insert's or update's plan can rewrite the
  stored row (normalize the title, drop `note`, set `note`), as server
  defaults, triggers, and normalization do. The request still carries the
  authored row; the provider's copy is the row's value. New reach state
  `server-rewrote-copy`, and a grammar arm for updates without `note`.
  - **Calibration:** the reference mutant `writes-back-authored` survives
    without the capability and fails FID-5 with it. RxDB rewrites through
    its `preInsert` and `preSave` hooks; with no-op hooks the fixed campaign
    fails FID-5.
  - **Result:** the reference adapter and RxDB are GREEN, with no
    production change.
- **2026-11-03, mutations family, SQL providers and confirmation through
  sync.** New capabilities `field-updates` (an update sends only its changed
  fields and the provider merges them, the law set's MUT-8 clause) and
  `held-echoes` (the provider answers before its change feed delivers the
  copy; the mutation stays pending until it arrives, MUT-7), a `deliver`
  step, and `undefinedField: 'null'` (a SQL row: a removed field is sent as
  `null`, and a complete row carries every column). A SQL-provider reference
  campaign and three mutants calibrate them (a complete-row update, a dropped
  removal, settling on the answer). Requests now compare by the fields they
  carry. A reach count that credited a rejected write as accepted is fixed.
- **2026-11-03, TrailBase, mutations.** Both campaigns are GREEN after an
  adapter fix, with every declared reach state met.
  - **RED on the parent:** of 300 fixed-campaign histories, 37 failed MUT-8
    (a removed field was sent as an empty patch), 27 failed MUT-10 (writes
    did not wait), and 5 failed MUT-1 (a write was confirmed by an earlier
    event on the same key).
  - **Fix:** a removed field is sent as `null`; writes run in author order;
    a write is confirmed only by an event after it began, recorded only
    while a write is admitted, which removes the periodic cleanup timer.
    A mutant with the old confirmation fails MUT-1. Refined on 2026-11-04:
    same-key histories showed that an earlier write's late event could
    still confirm a later write on the key, so the adapter now counts
    events per key and confirms the n-th answered write on a key by the
    n-th event on it; a late event from an earlier write does not confirm
    a later one.
  - **Size:** trailbase-db-collection −46 gzip bytes.
- **2026-11-03, PowerSync, mutations.** Both campaigns are GREEN after an
  adapter fix, with every declared reach state met.
  - **Driver:** a real local PowerSync database is the provider; each
    adapter statement on the table is a request, a held echo holds the
    change watcher's next callback, and the propagation step waits for
    every write's receipt or, while something is held, for quiet.
  - **RED on the parent:** both campaigns failed MUT-10: a write started
    once the earlier one committed locally, before its diff trigger
    observed it. The law set's "decides" is settlement. Fix: each write
    runs after the earlier one settles. Removals already reach SQLite as
    `NULL`.
  - **Oracle change this migration exposed:** `server-rewrote-copy` counted
    a copy that differs only by the value domain (a removal under `null`),
    so a driver without `server-rewrites` reached an undeclared state. It
    now counts only a plan's rewrite.
  - **Size:** powersync-db-collection +26 gzip bytes for MUT-10.
- **Decided 2026-11-03, MUT-10 under confirmation through sync.** "The
  earlier one decides" is the provider's answer, not the write's
  confirmation through sync: core does not chain independent transactions,
  and an application that needs that chains them itself. Waiting for
  confirmation made a burst of 50 PowerSync inserts take 1.6 s instead of
  31 ms.
  - **Oracle:** an answered write is decided, so the next write's request is
    owed; it stays pending until its copy arrives. The reference SQL adapter
    now starts the next write at the answer and confirms each write by its
    own commit; new mutants `chains-on-confirmation` (MUT-8) and
    `confirms-by-high-water`, which confirms a withheld copy once a later
    one applies (MUT-1).
  - **PowerSync:** the ordering change is reverted; the write lock already
    orders its writes. Its driver no longer declares `held-writes` or
    `held-echoes` (a held statement holds the lock the diff flush needs, and
    one watcher callback applies every write). GREEN with no adapter change;
    a mutant that settles before its diff trigger observes the write fails
    MUT-1.
  - **TrailBase:** a write starts after the earlier one's HTTP response, not
    after its change event. The committed version, which waited for the
    event, fails the fixed campaign.
- **2026-11-03, Electric, mutations.** Both campaigns are GREEN with no
  adapter change, with every declared reach state met.
  - **Driver:** Electric does not persist writes, so the driver supplies
    application handlers that write through a backend API and await
    `awaitTxId`; the real `ShapeStream` reads a shape log that carries each
    commit's txid in commit order.
  - **Oracle changes this migration exposed:** `application-handlers` (the
    application's handlers persist writes, so requests go out when made and
    MUT-10 is the application's), `log-ordered-echoes` (a withheld copy holds
    back later ones), and `ordered-answers` (the provider answers in arrival
    order). Writes that settle at one step settle in an order no law fixes,
    so the check then compares each row's own value sequence. Reference
    campaigns calibrate each: Electric-like and Convex-like providers, and a
    provider that breaks each declaration fails (MUT-7, MUT-8, MUT-13).
  - **Mutant:** a txid evidence check that accepts any txid fails MUT-1.
- **2026-11-03, Convex, mutations.** Both campaigns are GREEN with no
  adapter change, with every declared reach state met.
  - **Driver lessons:** a server answers a `Mutation` after the client
    registers it, and sends the `MutationResponse` before the transition
    that carries the commit: the client completes a mutation only at a later
    transition, and drops a response for a request it is not tracking yet.
  - **Mutants:** an adapter that does not await the handler fails MUT-1. One
    that skips its wait for the source survives these histories; the
    cached-listener path it protects is owned by `tests/collection.test.ts`
    and the ownership oracle, which reject it.
- **Decided 2026-11-03, RxDB updates merge named fields.** Same-key
  histories found that RxDB's `incrementalPatch` keeps a stored field an
  update does not name (seed 371775937). RxDB keeps that behavior: the
  driver declares `merged-updates`, under which an update's stored row is
  its authored row merged into the provider's row. This revises the law
  set's complete-row MUT-8 clause for RxDB. An RxDB that replaces the row
  fails MUT-8.
- **Decided 2026-11-03, RxDB update of a deleted document.** It rejects
  with `UpdateKeyNotFoundError` instead of fulfilling without persisting.
- **Decided 2026-11-03, TrailBase multi-mutation transactions.** Requests
  go out one at a time in mutation order and a rejection ends the
  transaction; generating multi-mutation transactions, and the law for a
  rejection partway through one, are a follow-up for the mutations owner.
