# Draft law: persisted demand coverage

Status: implemented in PR #2263, which also contains the oracle, the matching
`ARCHITECTURE.md` and glossary edits, and the review record
(`2026-10-21-persisted-demand-coverage-review.md`). The law revised an
accepted contract; it was not a defect report under the old one. It belongs to
issue #2102, item 1. Later sections record maintainer decisions made during
review, with their dates.

## Question

A user turned on SQLite persistence for an app. `initialRender: { strategy:
'network-first' }` worked for eager Collections but not for progressive
Electric ones. They expected progressive Collections to render from SQLite
without waiting for the network.

Electric reports `progressive` to core as `on-demand`
(`packages/electric-db-collection/src/electric.ts:1216`). The persisted wrapper
rejects network-first for `on-demand`
(`packages/db-sqlite-persistence-core/src/persisted.ts:6833`). Every on-demand
source has this limit, not only Electric.

The product need is offline use. Offline, an on-demand source can serve a query
only from an exact query that was persisted before, unless everything was
synced. Serving everything is one reason to use progressive mode.

## Evidence gathered

Two witness files record current behavior on main at 31dad2dd3. They state no
contract.

`packages/db-sqlite-persistence-core/tests/on-demand-offline-readiness-witness.test.ts`
uses a generic on-demand source:

| Upstream | Local subset | Query rows | Query ready |
| --- | --- | --- | --- |
| never settles | complete | `a1, a2` | no |
| never settles | partial | `a1` | no |
| never settles | empty | none | no |
| settles at once, no write | complete | `a1, a2` | yes |
| settles at once, no write | empty | none | yes |

`packages/electric-db-collection/tests/electric-progressive-offline-readiness-witness.test.ts`
runs two Electric `progressive` sessions over one real `node:sqlite` database.
Session 2 is offline:

| Session 1 | Session 2 resumes stream | Query rows | Query ready |
| --- | --- | --- | --- |
| completed full sync | yes (`10_0`, `shape-1`) | `1, 2` | yes |
| loaded the query subset only | no | `1, 2` | no |
| nothing | no | none | no |

What the evidence establishes, for these histories:

1. Restored rows reach the query before readiness in every on-demand case. Only
   the readiness signal waits.
2. After a completed progressive full sync, Electric resumes and settles loads
   at once. The query is ready on SQLite rows with no network.
3. If the full sync never completed, the persisted subset rows are present, but
   the query waits on the network with no deadline.
4. The wrapper cannot tell a complete subset from a partial or never-loaded
   one. All three read back as rows, or as no rows.

The witnesses do not cover React or Solid Suspense timing, native SQLite hosts,
cache-claim rotation, or a must-refetch during the offline session.

## The law

**Persisted demand coverage.** An opted-in persisted wrapper over an on-demand
source may settle a demand's load from SQLite. It may do this when all of these
hold:

1. The persisted subset restore for the demand has published its rows in the
   current sync run. The rows may be empty.
2. The exact demand has persisted demand coverage in the current persisted
   cache generation.
3. The configured wait has passed since the load started, or the demand's
   upstream load has failed.

All three must hold, in any order of arrival. An upstream failure that
arrives before the persisted subset restore publishes settles the demand
once the restore publishes. Until then, the load waits for the upstream load
as it does today. A demand without coverage never settles from SQLite.

After the load settles from SQLite, its upstream load continues as work that
the wrapper owns. Rows from that load publish as ordinary source writes. A
later upstream failure does not undo the settlement. Releasing the demand, or
cleanup, aborts the upstream load. Coverage survives release: a later load of
the same demand starts its own wait and may settle from SQLite again.
Settling from SQLite does not change Collection readiness.

An upstream load that settles successfully records coverage for its exact
demand. Coverage is written durably with the load's rows or after them, and
records how many rows the demand reads from SQLite at that moment. Three more
rules came from review:

- A load that a reset made obsolete records no coverage (law 6 in
  `ARCHITECTURE.md`).
- A load with `refetch: true` never settles from SQLite. It starts a new
  acquisition that waits for its own applied rows.
- Coverage counts only while the persisted subset restore returns at least as
  many rows as coverage recorded. A row deleted afterwards, by the source or by
  Query DB retention, ends coverage until the demand loads online again
  (maintainer decision, 2026-10-26).

The first draft also let a certified complete resume baseline cover every
demand. No path implemented that, and a source that resumes from a complete
baseline already settles its own loads at once, so the clause was dropped
(maintainer decision, 2026-10-26).

### Terms

These require glossary entries; the draft entry is in
`docs/contributing/glossary.md`.

- **persisted subset restore**: the wrapper's read of one demand's request data
  from the current persisted cache generation, and publication of those rows to
  the Collection, in the current sync run. The result may be empty.
- **persisted demand coverage**: a record, in one persisted cache generation,
  that a load of one exact demand reached applied settlement with its rows
  durably committed.

### Why coverage matches by exact demand

Coverage matches by the canonical demand key (`getLoadSubsetDemandKey`). The
law never infers that one demand covers a different
one. #1797 made the same choice for request deduplication. It removed subset
algebra after it treated "requests as established coverage." Law 7 in
`ARCHITECTURE.md` already says settlement proves no broader extent than the
exact request.

Without coverage, an empty or partial local result is not evidence. The
witnesses show the wrapper cannot tell "no matching rows" from "never loaded."
A fallback on such a demand would render a false empty or partial result.

Coverage records completeness at the time of the covered load. It says
nothing about freshness, just as an eager restore can be stale.

### What follows without new rules

The live-query architecture routes every readiness consumer through demand
settlement. Settling a covered load therefore reaches all of them:

- initial-query readiness and `preload()`;
- React and Solid Suspense, which follow initial-query readiness;
- `queryOnce`;
- `skipInitial` Effects;
- atomic ordered-window publication, so a covered next page publishes offline;
- demand added after the first render, such as includes children and new
  filters.

`ARCHITECTURE.md` already states that a source resuming from complete local
rows settles its loads at once. This law applies the same idea to one demand
instead of the whole Collection. The live query adds one query-level signal,
described next.

### Queries over several sources

The sources combine. A query may render from local data when every source
permits it:

- an eager source, after its persisted restore completes in the current sync
  run;
- an on-demand source, after every demand the query reaches on it has settled,
  from SQLite or from the network.

This is initial-query readiness with one substitution: an eager source's
persisted restore stands in for its Collection readiness. A query over only
on-demand sources needs no substitution, because its readiness already follows
its loads. The eager network-first law in `persisted-readiness-oracle.test.ts`
is unchanged for a query over only eager sources.

Today the observer's network-first gate runs only when every source registers a
`PersistedReadinessSource` (`collectPersistedReadinessSources` in
`packages/db/src/live-query-observer.ts`). That interface reports one state per
Collection, but demand settlement differs by query: two queries over the same
on-demand source can be in different states. An opted-in on-demand source
therefore registers only that it opted in, with no settlement state. The gate
reads settlement from the live query itself: the query's own initial
readiness, with each eager source's persisted restore standing in for that
source's Collection readiness. An opt-in alone never permits fallback; that
would release a join before the on-demand side's covered rows are visible.

The live query does not expose that signal today. `preloadForInitialRender`
combines the network `preload()` with per-Collection persisted snapshots; it
cannot ask whether the query's own demands have settled independently of
eager Collection readiness. The implementation must add that query-level
signal: initial readiness with each eager source's persisted restore in place
of its Collection readiness.

### The wait

The wait reuses the network-first option and its default. #1955 set that
default to 3 seconds (`DEFAULT_NETWORK_TIMEOUT_MS`), and 0 is valid. The wait
is a preference for fresher data while online, not a correctness condition:
removing it breaks no property above. At 0, a covered demand behaves like a
demand on a completed progressive resume today.

Each load measures its wait from its own start. Only that load's own upstream
failure ends the wait early.

### Invalidation

Coverage belongs to one persisted cache generation. It ends with that
generation and with any reset that replaces the durable rows: truncate,
must-refetch, schema reset, or cache-claim rotation. A record that memory still
holds after a rotation in the same sync run does not count. A crash between
writing the rows and writing the coverage must not leave coverage without rows.
Coverage also ends when the restore returns fewer rows than it recorded.

### Limits

- **Coverage lifetime after release.** After a demand is released, its source
  stops sending changes for it. Coverage stays valid until its generation ends
  or a later load of the same demand settles. An expiry option, like Query DB's
  `persistedGcTime`, is tracked as a separate issue and is not implemented.
- **Keys that depend on other rows.** Cursor pages and includes children build
  demand keys from other rows' values. If restored rows differ from the
  previous session, the key differs too. That demand is then uncovered and
  waits for the network.
- **Uncovered demand while offline.** It waits indefinitely. The in-progress
  error-reporting work owns how that condition is reported.
- **A failure after a settlement from SQLite.** The query stays ready and the
  failure does not reach it, so the application cannot tell that a refresh
  failed. The in-progress error-reporting work owns whether such a failure is
  reported elsewhere; the guides must state the behavior.
- **Optimistic writes while offline.** An optimistic mutation that touches a
  covered demand's rows is outside this law. Optimistic overlay rules apply as
  usual, and this proposal has no witness for them.
- **Ordered windows.** A window settles from SQLite only while its restore
  holds the rows it held when it settled (maintainer decision, 2026-10-26). The tie-boundary load's key comes
  from the restored boundary row, so a window that lost, gained, or replaced
  a row asks for a key that no load covered.
- **Expired cache claims.** A coverage read under an expired claim proves
  nothing. The wrapper then starts claim recovery: it records no coverage, and
  a load that would settle from SQLite waits for the network. Neither path
  fails a load whose rows applied.
- **Source settlement.** Coverage counts the rows that SQLite holds when the
  load settles. It relies on the source settling a load only after its rows
  are durable (law 7 in `ARCHITECTURE.md`).
- **Multi-tab coordinators.** By maintainer decision (2026-10-26), the law
  covers only the default `SingleProcessCoordinator`. Under a Browser or
  Electron multi-tab coordinator, demand routes through the coordinator, so a
  covered demand neither settles from SQLite nor records coverage; it waits
  for the network as before.
- **Electric's own load.** Electric's upstream load may stay pending after the
  wrapper settles from SQLite. Its release and abort ownership need a receiving
  test.

## Oracle design

**Owner.** `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`
owns this law. It sits beside the eager network-first owner,
`persisted-readiness-oracle.test.ts`, under the same coverage-map section.
The live-query consequences listed above stay with their existing owners. A
receiving witness is needed for the window-publication case.

**Independent model.** For each demand, the model records the local restore
(`pending`, `done`, or `error`) and the coverage (`covered`, `uncovered`, or
`baseline`). It also records the upstream state (`pending`, `settled`, or
`failed`) and whether the wait has passed. From these it computes whether the
load may settle and which rows are visible at settlement. It shares no code
with the wrapper.

**History grammar.** Session 1 produces coverage through real loads, not seeded
metadata. Seeded metadata would make the model's coverage and the production
coverage the same assumption. Session 2 steps then arrive in any legal order:

- the local restore settles or fails;
- the upstream load settles or fails;
- the wait passes;
- a reset or rotation happens;
- the demand is released;
- a second demand starts.

**Production driver.** The real persisted wrapper over
`SQLiteCorePersistenceAdapter` and `node:sqlite`, with a generic on-demand
source. Receiving witnesses cover Electric `progressive` (full-sync resume and
subset-only) and Query DB.

**Observations.** After each step: load settlement, query rows, `isReady()`,
whether `preload()` has settled, whether the network-first wait has released,
and, for an ordered query, the published window. A joined history pairs an
eager source with an on-demand source.

The glossary's persisted readiness and network-first initial render entries
follow this combining rule (edited in this worktree).

**Wrong designs the oracle must reject.** Each needs a demonstrated failure:

1. Removing the on-demand guard and using startup readiness. This settles
   before the subset restore, with no rows.
2. Treating any completed local restore as evidence. This fails "offline,
   empty, uncovered" and "offline, partial, uncovered."
3. Treating nonempty rows as coverage. This fails "covered and genuinely
   empty."
4. Writing coverage before the rows commit durably. This fails a crash between
   the two writes.
5. Keeping coverage across reset or rotation.
6. Matching a different demand key, such as `limit 10` coverage for `limit 20`.
7. Aborting the upstream load when the wrapper settles from SQLite. Fresh rows
   then never arrive.
8. Leaving a covered next page unpublished after the wait.
9. An on-demand opt-in that permits fallback on its own. The gate then releases
   a join before the on-demand side's covered rows are visible.
10. Coverage keyed by filter only, or ignoring order while honoring limit.
11. A wait measured from the sync run instead of the load, or coverage cleared
    on release.
12. A late upstream failure that undoes a settlement from SQLite.

## Documents that change with the law

- Persisted-readiness oracle: prose, model, grammar, driver, and checks.
- `packages/db/src/query/live/ARCHITECTURE.md`: source settlement and the
  initial-readiness limits (edited in this worktree).
- `docs/contributing/glossary.md`: new persisted subset restore and persisted
  demand coverage entries; revised persisted readiness and network-first
  initial render entries (edited in this worktree).
- `docs/guides/sqlite-persistence.md` ("Render after SQLite restore") and
  `docs/guides/live-queries.md`. They must say that a covered result, including
  an empty one, is complete as of the load that covered it, not fresh, and that
  the wait changes when a query is ready, not how fresh its rows are. Rows from
  the network can still arrive after a query is ready.
- `docs/contributing/oracle-coverage.md`, "Persisted readiness and network-first
  initial rendering."
- `docs/contributing/oracle-reviews/issue-2056-cache-eviction-design.md`, per
  issue #2102's completion criteria.
