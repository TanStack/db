# Endpoints full-stack oracle

The [Kitchen test audit](../KITCHEN-TEST-AUDIT.md) maps each former app-specific
assertion to its owner. General parsed-input checks now run in the generated
compiled oracle; the remaining app smoke test lives in Kitchen itself.

The compiled browser campaign exercises both component-bound declarations and
module-level collection/action exports. The latter use an imported shared client
with a deferred scope getter. Both shapes pass through Start RPC and the same
optimistic/settled PGlite comparisons, including strict/strip/passthrough inputs.
Production assets and source maps are scanned for server code in each program.
The runtime lifecycle tests separately cover imports before a session exists,
no reads before demand, synchronous actions, and rejecting scope changes.

The [SQL coverage and loading report](../../../SQL-COVERAGE-RESULTS.md) describes
the new schema-first campaign. It generates 2–3 tables, nullable scalar columns,
foreign keys, predicates and mutations. The same full-stack driver runs against
an independent PGlite reference. Reports list tested, rejected and untested cells;
passing one campaign does not cover every PostgreSQL feature.

```sh
npm run test:oracles:sql
ENDPOINT_ORACLE_SCHEMA=generated npm run test:oracles:concurrent
npm run test:oracles:loading
```

`ENDPOINT_ORACLE_SCENARIOS`, `ENDPOINT_ORACLE_SEQUENCES`, `ENDPOINT_ORACLE_STEPS`
and `ENDPOINT_ORACLE_SEED` control generation. The SQL runner saves each scenario,
its seed, shrink path and final counterexample; replay with `--replay <file>`.
The generated concurrent runner currently uses three operations per wave.

`ENDPOINT_ORACLE_MUTANT=misroute-relations npm run test:oracles:sql` must fail
when an optimistic update crosses into another table. The foreign-key overlap
fixture checks a rejected child update after a parent deletion:

```sh
ENDPOINT_ORACLE_SCHEMA=generated npm run test:oracles:concurrent -- \
  --replay tests/fixtures/sql-foreign-key-overlap.json
```

The loading experiment compares full and adaptive shared-row response encoding,
including disjoint-key and disjoint-relation fast paths. It measures actual Start
response bodies, offline gzip estimates, browser action-to-persistence time, and
encoder/JSON CPU cost. It does not reduce database reads or change authority
admission. `ENDPOINT_ORACLE_SNAPSHOT_ENCODING=full` selects the plain transport in
a disposable fixture. Subset loading and LSN manifests remain deferred.

The [authority coordinator campaign](../../../design/authority-coordinator/README.md)
also keeps the original Todo concurrent waves, notification checks and event-history
replay when `ENDPOINT_ORACLE_SCHEMA` is omitted. Production client artifacts are
checked for server code for every distinct generated program.

The following sections describe the earlier Todo campaigns and their development.

Current audit revision: [fixes and restored constraints](../../../design/representation/audit-fixes.md). Programs now vary repeated lexical names and Unicode keys. Operations independently vary server membership changes, other-row effects, no-ops and post-commit handler errors, crossed with read outcomes. Both tentative and confirmed values still come from the separate PostgreSQL reference. The protocol boundary also has 100 generated malformed-response cases in `tests/runtime-regressions.ts`.

`ENDPOINT_ORACLE_MUTANT=optimistic-recipients-only ENDPOINT_ORACLE_CAMPAIGN=coherence` must fail the fixed independent-effects witness. This checks that reconciliation selection cannot borrow the optimistic recipient set.

Current implementation and receipts: [first coherence draft](../../../design/representation/implementation-draft.md).

The current oracle generates full-row all/completed queries, retained collections without subscribers, server text corrections, and CRUD outcomes. A fixed witness covers GC exclusion. Inline authoritative results replace follow-up client reads. All four current campaigns pass; exhausted reads are checked as an explicit error after a committed write, followed by fresh-load recovery. `ENDPOINT_ORACLE_STRATEGY=client-refetch` selects the correct comparison baseline in a disposable runtime copy. `ENDPOINT_ORACLE_REQUEST_DELAY_MS=50` injects a per-request delay. Reports include decoded body sizes, request counts and instrumented elapsed time.

The sections below preserve the original oracle development and its historical failures; statements that propagation is missing or exhausted-read coherence must fail describe that earlier version.


The initial oracle generates **N endpoint scenarios and X fresh operation
sequences per scenario**. It runs authored endpoint modules through the real
compiler, Start RPC, browser collections, optimistic transactions, Drizzle, and
application PGlite. A separate PGlite database supplies expected values and order.

For every retained non-GCed collection, at each successful-data checkpoint:

```text
collection rows and order = its query over the shared reference PG world
```

The reference world includes pending optimistic effects. After a write commits,
its effects remain in confirmed reference state even if subsequent reads fail.
Each query uses that same world; there are no per-collection stale baselines.

## Run and replay

Use Node 24 with the app's pinned dependencies installed (including fast-check).
The runner currently uses installed macOS Google Chrome, matching the other probe
browser tests. Run from `integrated-todo`:

```sh
ENDPOINT_ORACLE_SCENARIOS=2 ENDPOINT_ORACLE_SEQUENCES=2 \
  ENDPOINT_ORACLE_STEPS=2 npm run test:oracles
```

N applies to each campaign; X is the exact number of reset sequences generated
per scenario. Step counts range from one to the chosen maximum. fast-check stops
and shrinks on failure, so a failing campaign may execute fewer than N original
scenarios and many additional shrink candidates. Reports distinguish configured
budgets from executed builds, sequences, operations, checkpoints, and transitions.
Identical endpoint source shares a build; each changed program gets a fresh dev
server. Each sequence gets fresh browser/client state and reset application and
reference databases. Test gates affect only I/O in the disposable server.

Campaigns use the **same runner and reference**, with these generator settings:

| Campaign | Generated work |
| --- | --- |
| `controls` | One query, insert/edit/toggle/delete, write acceptance or rejection. |
| `read-retry` | One query, committed write, one to three failed reads, then recovery. |
| `coherence` | Two or three active queries; optimism directly changes one collection. |
| `read-failure` | One query, committed write, all four read attempts fail. |

Select one with `ENDPOINT_ORACLE_CAMPAIGN`. Default is `all`. A current correctness failure exits **1** and shrinks; exhausted authoritative reads instead require an explicit client error and separate confirmation that the server write happened.

Reports and shrunk counterexamples go to `evidence/e2e-oracle` by default; set
`ENDPOINT_ORACLE_OUTPUT` to retain separate runs. Each failure saves:

- `endpoint.tsx`: the minimized authored program.
- `replay.json`: complete scenario, sequences, failing sequence index, seed/path,
  and assertion with actual/expected rows.
- `sequence.json`: the failing sequence alone for quick direct replay.

```sh
ENDPOINT_ORACLE_OUTPUT=evidence/replay \
  node tests/oracles/e2e.mjs --replay evidence/e2e-current/coherence/sequence.json
```

Direct replay exits 1 if the fault still exists. For fast-check seed/path replay,
keep N/X/step settings from the report and set `TANSTACK_DB_ORACLE_SEED`,
`TANSTACK_DB_ORACLE_PATH`, and `TANSTACK_DB_ORACLE_PROPERTY` (for example,
`endpoints.e2e.coherence`). The shared `TANSTACK_DB_ORACLE_RUNS_MULTIPLIER` also
applies. `ENDPOINT_ORACLE_DEBUG=1` prints sequences during shrinking;
`ENDPOINT_ORACLE_DEBUG=stop` stops at the first counterexample without shrinking.

## Findings and retry change

The first campaign used N=2, X=2, at most three operations. It built five distinct
programs and ran 25 sequences, 32 operations, and 91 checkpoints including
shrinking. Controls passed. It found:

1. **Missing optimistic propagation between endpoint collections.** Two empty
   queries over the same rows, then one insert into the first collection, leave
   the second collection empty. The reference has the row in both. This shrank
   to one insert and two queries. Endpoints caches these as separate collections
   and tracks directly mutated targets; it does not yet propagate shared row
   intent. Earlier one-collection tests had no assertion over an independent
   active endpoint collection. This is a framework gap, not evidence of a DB bug.
2. **Read failure after server commit.** A committed insert followed by a failed
   refetch rejected the transaction and hid the row. The earlier lifecycle test
   explicitly expected this disappearance, making it false-green against the
   shared-PG law. The oracle keeps committed truth separate from read outcomes.

Reads now default to three retries with TanStack Query's exponential backoff:
1, 2, and 4 seconds. The write RPC is not repeated. A generated transient-read
case failed before the change and passed unchanged afterward. It checked pending
transaction state and optimistic rows at each held retry, successful settlement,
and exactly one server write. The Todo lifecycle regression now requires this
recovery too. See `evidence/e2e-retry-red`, `evidence/e2e-retry-green`, and
`evidence/e2e-retry-browser.json`.

Exhausting the retry budget still exposes the second coherence failure. Retrying
reads fixes transient errors; it does not define how to preserve committed state
when all reads fail. The full oracle retains that failing law for the next change.

The updated campaign (`evidence/e2e-current`) built five distinct programs and
ran 41 sequences, 46 operations, and 190 checkpoints, including shrinking. CRUD
and transient-read campaigns passed; coherence shrank 18 times and exhausted
reads shrank 12 times, each to a single operation. Fresh-process replays are
recorded in `evidence/e2e-coherence-replay` and `evidence/e2e-exhausted-replay`.
The original
`evidence/e2e-oracle` report predates retries. No DB-core bug is established by
these findings.

## Server boundary and sensitivity

Each distinct generated program gets a real production build. The driver scans
client JS, HTML, and source maps for handler/query/database canaries, rejects
embedded source bodies and server modules in client map graphs, and requires the
canaries to exist in server output as positive controls. Browser-delivered scripts
and documents are scanned too, including decoded inline maps. Direct server
module requests and raw/URL requests must return classified errors without
leaking canaries. A retained server-only import rendered by the component must
fail the production build with `ENDPOINT_SERVER_IMPORT_IN_CLIENT`.

Two isolated runtime mutants were rejected at the intended checkpoints:

```sh
ENDPOINT_ORACLE_MUTANT=omit-order ENDPOINT_ORACLE_CAMPAIGN=controls \
  ENDPOINT_ORACLE_OUTPUT=evidence/mutant-order npm run test:oracles
ENDPOINT_ORACLE_MUTANT=early-settlement ENDPOINT_ORACLE_CAMPAIGN=controls \
  ENDPOINT_ORACLE_OUTPUT=evidence/mutant-settlement npm run test:oracles
```

These commands deliberately exit 1. The first fails optimistic row ordering; the
second fails pending settlement while the refetch is held. The driver patches
only its disposable runtime copy and verifies exactly one replacement. Receipts
are in `evidence/e2e-mutant-order` and `evidence/e2e-mutant-settlement`.

## Bounds of this first pass

- Schema is Todo; queries return full rows scoped to Alice or Bob, ordered by
  ascending createdAt/id in either priority. It varies endpoint count and source,
  initial values, empty data, timestamp ties, operation choices, and failure phase.
- Operations within a sequence are sequential. Overlapping optimistic snapshots,
  callback throws, cross-client isolation, and rebinding laws are not generated
  yet; existing focused tests remain useful.
- No generated server predicates beyond scope, projections, joins, pagination,
  or client filter changes yet. Add them as the endpoint grammar supports them.
- Settlement checks currently gate the full-refetch adapter. Future delta/partial
  delivery strategies must preserve the row oracle while replacing those I/O
  gates with their own reconciliation boundary.
- Checks cover invocation, held reads/retries, and settlement; they do not yet
  record every subscription publication between checkpoints.
- Execution uses a dev browser with production artifact checks, not a production
  browser run. Canaries and graph checks prove the tested boundary cases, not
  absence of every possible server-code leak.
- Changing generated source originally used HMR and produced a non-reproducible
  initial-state mismatch. Program changes now restart the server to isolate its
  module graph. That observation is not counted as a DB defect.

## Mutation effects, joins and combined reads

Cross-module query instances have a full-stack campaign:

```sh
npm run test:oracles:registry
ENDPOINT_ORACLE_REGISTRY=1 ENDPOINT_ORACLE_SCENARIOS=3 \
  ENDPOINT_ORACLE_SEQUENCES=3 ENDPOINT_ORACLE_SEED=911034 \
  ENDPOINT_ORACLE_OUTPUT=evidence/registry-concurrent-final npm run test:oracles:concurrent
ENDPOINT_ORACLE_REGISTRY=1 ENDPOINT_ORACLE_EFFECTS=1 \
  ENDPOINT_ORACLE_OUTPUT=evidence/registry-trigger-overlap \
  node tests/oracles/concurrent.mjs --replay tests/fixtures/registry-trigger-overlap.json
```

It generates peer query definitions in a separate sibling or nested module,
with false/true instances of each definition. Extra source modules are included
in the build-cache identity and server-code exclusion checks. The independent
PostgreSQL renderer receives query semantics, never the registry or compiler
output. See [registry results and limits](../../../QUERY-REGISTRY-RESULTS.md).

```sh
# Full-stack: six trigger controls plus N generated schemas × X histories.
ENDPOINT_ORACLE_SCENARIOS=1 ENDPOINT_ORACLE_SEQUENCES=2 \
  ENDPOINT_ORACLE_OUTPUT=evidence/sql-effects npm run test:oracles:effects
ENDPOINT_ORACLE_EFFECTS=1 ENDPOINT_ORACLE_SCENARIOS=2 \
  ENDPOINT_ORACLE_SEQUENCES=3 ENDPOINT_ORACLE_SEED=911032 \
  ENDPOINT_ORACLE_OUTPUT=evidence/sql-effects-concurrent npm run test:oracles:concurrent
ENDPOINT_ORACLE_EFFECTS=1 ENDPOINT_ORACLE_OUTPUT=evidence/sql-trigger-overlap \
  node tests/oracles/concurrent.mjs --replay tests/fixtures/trigger-fanout-overlap.json

# Separate experiments; neither expands the compiled endpoint grammar.
npm run test:oracles:joins
npm run test:oracles:combined-reads
```

The effect renderer installs real PostgreSQL triggers. The independent reference
models their stated consequences with SQL, without importing the trigger DDL.
Actual executed effects get witness entries. Generated effect histories exclude
handler cross-writes and recursive trigger effects; unsupported replay inputs
throw rather than receive an incomplete reference result. Deferred triggers use
implicit statement transactions. See [the effect catalog](../../../MUTATION-EFFECTS-CATALOG.md).

The join experiment uses ordinary DB collections and real transactions, checking
synchronous guesses and rollback/commit against PostgreSQL with complete inputs.
It also proves that an inner-join result alone can hide source rows. The combined
read experiment checks ordered tagged results, including empty and joined
results, and records CPU/encoding cost, SQL-call counts, payload size and plans.
Its network break-even figure is a model for a sequential database connection,
not an observed network or browser latency improvement.

Keep the full-stack replay for any future DB finding, then minimize its failing
boundary into the relevant existing core oracle. Do not weaken the shared-state
law merely because a later refetch repairs an earlier wrong publication.

## Baseline proof regressions

The revision-tracking adapter and its dedicated runners were removed because
Endpoints must not modify the user's PostgreSQL database. Generic baseline,
serialization, eviction and client overlap tests remain in `test:contracts`.
Existing SQL/effect oracles still use disposable fixtures to test application
behavior; they do not install framework tracking in user databases. The
[rejected experiment and receipts](../../../REFRESH-PRUNING.md) preserve what was
measured and the design constraint.

## Guide-driven repairs

The [repair results](../../ORACLE-REPAIR-RESULTS.md) record false-green controls
for borrowed baselines, discarded invocation snapshots and IDs-only consumers.
The repaired dependency, compiled, SQL, concurrent and E2E runners use independent
admitted expectations and shared failure/cleanup evidence. The shared driver
compares rendered text and IDs at named checkpoints, not every React commit.

Reports now retain startup source/dependency provenance, named comparisons,
fault applications, cleanup diagnostics and the final verdict. New replay
packets include original and reduced inputs plus failure identity; old replay
inputs remain executable but cannot establish same-failure reproduction. The
outer scenario owns shrinking, so nested sequences cannot swallow the first
failure and continue to a different one.

`ENDPOINT_ORACLE_TEST_FAULT` selects test-only controls (`bad-baseline`,
`immediate-snapshot`, `rendered-text`, or `cleanup`). A survived or unreached
control is a failed control, not evidence of sensitivity. The baseline controls
can use `--controls-only` on the compiled/dependency runners. `--replay` accepts
saved evidence packets. No fault changes the running manual application.
