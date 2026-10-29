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
| Mutations and confirmation            | Needed                                    | MUT-1/2/4/5/7/10/13, FID-5                                                                                           |
| On-demand loading                     | Needed                                    | DEM-1 to DEM-23, MAP-1 to MAP-4                                                                                      |
| Reload and retry                      | Needed                                    | RELOAD-1 to RELOAD-5; RETRY-1 and HEALTH-2 beyond the eager source's retried failures                                |
| Client cache and refetch              | Needed                                    | CACHE-1 to CACHE-8, REF-1 to REF-7, DIR-1 to DIR-5                                                                   |
| Source shapes                         | Needed                                    | RESET-1, RESUME-1 to RESUME-3, PROG-1, MEMB-1/2, PAGE-1 to PAGE-3, OWN-1/2, META-1                                   |
| Local and shared stores               | Needed                                    | SELF-1 to SELF-3, STORE-1 to STORE-4, PEER-1                                                                         |
| Persistence wrapper and storage hosts | Needed                                    | P-_, S-_                                                                                                             |

## Adapters

| Adapter           | Families that apply (section A)                                                       | Driver status                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neon Realtime     | eager live source, mutations                                                          | Eager: RED (READY-4, HEALTH-1, and LIFE-10 behind them); adapter update pending                                                                                                                                                             |
| Electric          | eager live source, mutations, on-demand, source shapes, reload and retry, persistence | Not started                                                                                                                                                                                                                                 |
| PowerSync         | eager live source, mutations, on-demand                                               | Not started                                                                                                                                                                                                                                 |
| RxDB              | eager live source, mutations                                                          | Eager: GREEN (2026-10-29) after a fix, per-change commits, `listen-before-fetch`. Driver `rxdb-db-collection/tests/conformance-driver.ts`, property `adapter-conformance.eager-live-source.rxdb`. Mutations: not started                    |
| TrailBase         | eager live source, mutations, on-demand                                               | Eager: GREEN (2026-10-29), per-change commits. Driver `trailbase-db-collection/tests/conformance-driver.ts`, property `adapter-conformance.eager-live-source.trailbase`; declares no optional capability. Mutations, on-demand: not started |
| Convex            | eager live source, mutations, on-demand, source shapes                                | Not started                                                                                                                                                                                                                                 |
| query-db          | client cache and refetch, on-demand, mutations, reload and retry, persistence         | Not started; not a push source, so the eager family does not apply                                                                                                                                                                          |
| local-only        | local and shared stores, mutations                                                    | Not started                                                                                                                                                                                                                                 |
| localStorage      | local and shared stores, mutations                                                    | Not started                                                                                                                                                                                                                                 |
| Persisted wrapper | persistence wrapper                                                                   | Not started                                                                                                                                                                                                                                 |
| Storage hosts (8) | storage hosts                                                                         | Not started                                                                                                                                                                                                                                 |

## Suggested order

1. **Push adapters on the existing family:** RxDB (done), TrailBase (done), PowerSync, Electric (eager mode), and Convex. Each needs only a controlled-provider driver. A RED result is a finding against that adapter.
2. **The Neon update, run against its driver.** This shows an adapter moving from RED to GREEN.
3. **The mutations family.** It applies to every adapter except the storage hosts.
4. **The other families,** one at a time. Each family's new driver work goes to the adapters that declare it.

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
