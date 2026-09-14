# Generated SQL coverage and first loading optimization

The oracle now generates schemas as well as endpoint declarations and operation
histories. It still compares the complete Endpoints path—compiled client/server
code, real RPCs, DB optimism and PGlite—with a separate PostgreSQL reference.
This is the first scalar slice, not full PostgreSQL support.

## What is generated

- Two or three named tables, each with one to three additional integer, text or
  boolean columns. Column count, names, types and nullability vary.
- Optional nullable foreign keys to the first table with `ON DELETE SET NULL`.
  Every table contains both fixture scopes, and different tables share row keys.
- Full-row queries with scalar equality/inequality, integer ranges, AND/OR and
  NULL predicates. Client membership uses DB's evaluator. Ordering stays an
  ascending total order over `createdAt` and `id`.
- CRUD, server text correction, additional writes to another table, rejected
  writes and errors after committed statements. Both sequential sequences and
  concurrent waves use the generated schema.

The generator derives schema-dependent names, rows and expressions after
shrinking its choices, so a shrunk schema cannot leave dangling references.
The SUT renders Drizzle and endpoint code; the reference renders separate DDL/SQL.
PostgreSQL applies reference foreign-key effects. Its optimistic tables omit the
foreign keys because optimism covers direct guesses, not unseen server effects.
A PostgreSQL foreign-key violation can be the expected concurrent handler outcome;
SQL syntax or other model errors still fail the test.

`tests/oracles/sql-manifest.mjs` lists observed cells and their witnesses. It keeps
execution, optimism, conservative affected-collection coverage, full-result
reconciliation, patches and subsets distinct. Unvisited operators stay untested
even when the compiler accepts them. Compiler controls establish that joins and
LIMIT are explicitly rejected; they are not advertised as working fallback.

## Changes to the prototype

The scalar query recognizer replaces its Todo-only predecessor. It preserves
trusted import/auth boundaries, rejects unsupported query chains and response
transforms, and requires matching projections before sharing optimism between
queries of one relation. Server responses retain additional columns. Admission
rejects missing or unexpected selected columns before any collection changes.
That last check has a recorded red/green regression; the former fixed four-column
validator could silently accept a truncated expanded row.

Runtime row types still require the base `id`, `text`, `completed`, `createdAt`
shape; added columns are carried as unknown values. General schema-derived client
TypeScript inference is not implemented. Imported fixture tables, scalar types,
keys and C-style comparison assumptions are trusted rather than proved from
arbitrary application source. Timestamp controls use UTC at millisecond precision.

## Loading experiment

The server can send one pool of complete typed rows plus ordered row indexes for
each query snapshot. It shares only equal complete values; matching ids alone
never establish equality. Empty snapshots, different values under the same key,
dates versus strings, and malformed indexes have explicit checks. Collections
retain separate optimistic ownership after decoding shared objects.

The adaptive encoder skips work for a single snapshot, separate compiler relation
groups, or disjoint row-key sets. It uses the compact form only when its JSON byte
estimate is smaller. Unsupported values retain the full representation. Query
execution, retained-collection coverage and authority admission are unchanged;
this saves repeated response data, not database queries. Concurrent actions still
use the conservative fresh-read path.

The comparison uses small, separate-table, overlapping-view and same-table-disjoint
fixtures. It checks every settled result against PostgreSQL, asserts one mutation
RPC, warms up before sampling, and separates browser action-to-receipt latency
from oracle/gate setup. Response byte counts come from actual Start responses;
gzip counts are offline estimates, not observed compressed HTTP transfer sizes.
Encoder/JSON time is measured separately. These localhost development-server
samples do not establish a general latency win.

Final measurement: `loading-key-overlap-final/report.json`, 12 measured mutations
per strategy per fixture, plus warmups. With 80 rows and three overlapping views,
full responses totaled 3,246,436 bytes versus 1,335,806 bytes with sharing: **58.9%
less decoded response data**. Offline gzip estimates fell by 59.8%. Both paths
used exactly one mutation RPC per operation. Disjoint fixtures had identical
decoded response sizes.

The common two-view case (full set plus an incomplete-only view) is recorded in
`loading-two-views/report.json`. Sharing reduced decoded bytes from 1,953,448 to
1,319,930 across 12 mutations: **32.4% less data**, and 33.2% less in the offline
gzip estimate. Browser median latency was 13.7 ms for both strategies. Encoding
cost increased from 0.26 ms to 1.68 ms. This supports a bandwidth benefit without
claiming a localhost latency improvement.

The same-table-disjoint encoder/JSON median was 0.179 ms adaptive versus 0.161 ms
full, after the key scan replaced the previous 1.29 ms adaptive cost. In the overlap
fixture, encoding remained more expensive (2.40 ms versus 0.56 ms in this run).
Browser medians were 18.1 ms adaptive versus 20.7 ms full there, but noisy tails
and inconsistent CPU samples elsewhere preclude a general speed claim. The clear
result is less transferred data with unchanged authority rules and request counts.

For scale only: the gzip estimate saves about 108 kB per overlapping-view mutation.
That corresponds to roughly 86 ms of transfer at 10 Mbit/s or 8.6 ms at 100 Mbit/s,
assuming that compression and a bandwidth-bound response. These are calculated
transfer bounds, not observed end-to-end latency savings.

## Evidence

Receipts live under `integrated-todo/evidence/`:

- `sql-final/report.json`: three generated schema scenarios × three six-operation
  sequences, plus the fixed control: 59 operations, 187 checkpoints, 16 production
  client artifacts inspected.
- `sql-concurrent-final/report.json`: three generated schemas × three concurrent
  waves: 27 operations, 80 notifications, 90 checkpoints, 12 client artifacts.
- `sql-foreign-key-debug/report.json`: the isolated parent-delete/child-edit
  control passes, including the expected PostgreSQL constraint rejection. The
  earlier parallel startup attempt timed out before the probe mounted; it is a
  harness startup failure, not a coherence counterexample.
- `sql-mutant-relations/report.json`: deliberately misrouting optimism across
  tables fails the first optimistic PostgreSQL equality check.
- `sql-projection-red.tap` / `sql-projection-green.tap`: missing selected columns
  must reject before authoritative installation.
- `sql-contracts-final.tap`: compiler, scalar/NULL PostgreSQL comparisons, encoding,
  server refresh and actual runtime regressions.
- `loading-two-views/report.json`: the two-collection case, 24 measured mutations
  plus two warmups, with eight production client artifacts inspected.
- `loading-key-overlap-final/report.json`: final comparison, including the cheap
  disjoint-key fast path; 96 measured mutations plus eight warmups, with PostgreSQL
  state checks and 32 production client artifacts inspected.
- `loading-comparison-final/report.json`: the intermediate experiment exposed
  extra encoding cost for disjoint filters on the same table, motivating the
  subsequent key-overlap fast path.

Subset loading and LSN-based coverage manifests remain deferred. Joins, aggregates,
CTEs, general key/type inference, arbitrary triggers and other PostgreSQL features
remain outside the implemented slice; see [the wider inventory](SQL-COVERAGE-PLAN.md).

## Mutation effects and join/read experiments — September 11

Added a [catalog of mutation effects](MUTATION-EFFECTS-CATALOG.md), covering
trigger chains, constraints, views/rules, functions, partitions, identity,
transaction boundaries, policies, session state, external APIs, delayed workers,
remote databases and replica visibility. It separates same-commit effects from
later work and lists missing generator dimensions. Catalog entries are not
blanket support claims.

The full-stack effect campaign passed **28 operations / 94 checkpoints** across
six controls and one generated schema with two histories. It inspected 28
production client artifacts. The controls execute BEFORE rewrite, suppression,
rejection, AFTER cross-table fanout, transition-table UPDATE and an initially
deferred constraint trigger. The reference uses independent SQL to model their
consequences; the client keeps authored guesses until reconciliation.

Two generated concurrent scenarios passed **18 operations / 48 notifications /
60 checkpoints**. Only rejection acquired a trigger witness in that random
campaign; do not infer that all six effects were exercised concurrently. An
additional deterministic fanout/peer-edit overlap passed **3 operations / 12
notifications / 10 checkpoints** with differing write and response order.

An external-write control proved that a write committed after settlement stays
unseen without a new signal, then verified repair after explicit refetch. This
does not implement an external API, worker or notification transport. The
`optimistic-recipients-only` mutant failed immediately after the first server
fanout: recipient collections retained old rows. Thus these checks detect
precisely the unsafe pruning that the new catalog warns about.

The joint model experiment passed **500 changes / 1,025 checkpoints** against
PGlite. It uses DB inner/left joins, a DB query for parent scope, normal
collections, and synchronous optimistic transactions with commit/rollback.
Inputs are complete, parent keys unique, child foreign keys nullable, and both
scopes present. It is not a compiled Endpoints join test. A counterexample proves
why that distinction matters: two databases can both yield an empty inner join,
yet inserting the same parent reveals hidden children in only one. Result rows
alone cannot prove sufficient input coverage for joined optimism. The endpoint
compiler still rejects joins; joined write mapping and coverage remain open.

The combined-read experiment compared separate reads with one read-only SQL
statement containing tagged, ordered JSON aggregates. Every result matched,
including descending order, NULL parents, joins and empty results. Each fixture
had 30 measured samples per strategy after warmup, with alternating run order.

| Rows | Query set | Separate median | Combined median | Calls | Result bytes |
| ---: | --- | ---: | ---: | --- | ---: |
| 10 | Two overlapping | 0.63 ms | 0.66 ms | 2 → 1 | 4,392 unchanged |
| 10 | Three with joins | 0.94 ms | 0.81 ms | 3 → 1 | 6,749 unchanged |
| 1,000 | Two overlapping | 5.75 ms | 7.29 ms | 2 → 1 | 441,346 unchanged |
| 1,000 | Three with joins | 8.77 ms | 11.13 ms | 3 → 1 | 638,339 unchanged |
| 1,000 | Empty + disjoint | 4.21 ms | 5.21 ms | 3 → 1 | 294,401 unchanged |

These are in-process PGlite query/decoding/JSON costs, not browser measurements.
For a sequential database connection, the larger two-query fixture would need
roughly 1.54 ms of saved database round-trip latency to offset this measured
extra cost. Concurrent reads over a pool have a different cost model. Both
approaches can already fit inside one mutation RPC; SQL batching does not remove
another browser round trip. The candidate stays experimental. Typed Date/exact
numeric decoding, locks, side-effecting reads and external concurrency are not
covered by this experiment.

Receipts under `integrated-todo/evidence/`:

- `sql-effects/report.json`: six effect controls, generated histories and the
  delayed-write boundary.
- `sql-effects-concurrent/report.json` and `sql-trigger-overlap/report.json`:
  generated overlap and the explicit trigger fanout witness.
- `sql-effects-mutant/report.json`: expected failure from unsafe pruning.
- `join-model/report.json`: DB/PGlite model and insufficient-input witness.
- `combined-reads/report.json`: all six fixture sizes/shapes and query plans.
- `sql-effects-contracts.tap`: 26 passing top-level compiler/runtime/SQL tests.
  Application and join-model TypeScript checks also passed.

At the end of this experiment, the next implementation boundary was to replace the module-local server read map with a
build-wide definition registry and send all retained query-instance descriptors
with each mutation. Parameterized instances, late registration, GC/recreation,
authorization and cross-module/lazy definitions need explicit tests before
affected-set pruning. That protocol sent retained IDs, but only supported
empty inputs and definitions in the mutation's module. No production runtime or
compiler optimization was enabled by these experiments.

That registry and required scalar parameters are now implemented and tested.
See [query registry results](./QUERY-REGISTRY-RESULTS.md) for the current API,
cross-module oracle receipts, and remaining discovery and authorization limits.
