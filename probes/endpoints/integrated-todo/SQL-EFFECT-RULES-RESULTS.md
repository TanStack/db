# SQL effect kernel: initial executable evidence

The first implementation passes separate value and refetch-obligation checks.
The old analyzer reaches settlement with correct values but fails the precision
law: a SQL function that writes one table causes unrelated collections to read.
The new checker follows that function's body and keeps the specific write set.

This is an **initial kernel and integration oracle**, not the compiler rollout.
`sql-effects.mjs` supplies facts and judgments; the oracle sends its footprints
through the real registry, JSON response envelope, and EndpointRuntime client
collections. Existing endpoint compiler consumers still use the legacy schema
snapshot/analyzer. This turn changes no application auth or handler execution.

## What is implemented

- One build-time catalog snapshot of table events, expressions, foreign keys,
  routines, and the binding environment. Requests perform no catalog inspection.
- SQL body/call closure, including terminating recursive calls. Body effects do
  not disappear because a user routine has an IMMUTABLE or STABLE label. A pure
  SQL body declared VOLATILE need not invent writes.
- A complete conservative union of candidate routine overloads in the recorded
  search path, rather than an assumed exact type binding.
- Separate read/write facts and unresolved effects, with relation/event/routine
  derivations and schema/statement hashes. Defaults, generated expressions,
  checks, indexes and FK actions are considered at their applicable events.
- A named skip-refetch judgment with baseline, optimism and repair gates. These
  kernel gates are also tested separately from the runtime's existing gates.

PostgreSQL documents why labels alone are insufficient: functions can read
tables even when marked IMMUTABLE, and calls resolve through overload and search
path rules. See [volatility](https://www.postgresql.org/docs/current/xfunc-volatility.html)
and [function resolution](https://www.postgresql.org/docs/current/typeconv-func.html).

## Oracle contract and independence

`tests/oracles/sql-effect-rules.mjs` creates N schema/function programs and runs
X histories per program. Each history starts with fresh clients and reset
databases. One PGlite executes the actual SQL and user function bodies. A second
PGlite computes expected rows using separate SQL: an explicit join replaces a
hidden-read function, and direct updates replace write functions. Only base DDL
is shared. Expected dependency sets come from the fixture's relational meaning,
never from the analyzer. Expected optimistic rows start from the independent
reference baseline, never from client rows.

The generated dimensions are four index variants, three pure-function volatility
labels, call-chain depths 0–3, four mutation families, signed values, and direct
optimistic edits to any of five retained collections. The fixed index variants
run the same history. Assertions observe baseline rows, captured same-turn
optimism, settled rows, exact result-read counts, and each kernel judgment.

All five collections are preloaded. Wrong guesses can target a collection outside
the actual write set. Cold baselines and repair obligations are kernel controls;
this runner does not claim to exercise those client lifecycle transitions.
The generated tables contain one row each, so this is no new evidence about SQL
bags, multirow ordering, windows, pagination or publication atomicity.

## Receipts

Seed `9142601`, Node `v24.5.0`, fast-check `3.23.2`, PGlite `0.3.14`.
Each new report records source hashes, dependency versions, per-law witnesses,
actual writes and delivered envelopes. Counts include fixed controls where noted.

| Run | Observed result |
| --- | --- |
| [Legacy red](evidence/sql-effect-rules-red/report.json) | Two writes and responses reached; settled rows agreed; refetch obligation failed on the function write. |
| [Green campaign](evidence/sql-effect-rules-green/report.json) | 12 generated programs × 3 histories plus four fixed histories: 40 histories, 137 mutations. 137 immediate, 137 settled, 137 refetch-count comparisons; 371 result reads and 314 skips. 16 build catalog calls, zero runtime catalog calls. |
| [Hidden-read mutant](evidence/sql-effect-rules-mutant-read/report.json) | Removing the called body's table dependency reaches a stale-value mismatch after a function write. |
| [Needless-fallback mutant](evidence/sql-effect-rules-mutant-fallback/report.json) | Forcing unknown writes for an expression-index variant preserves values but fails the exact read-count law. |
| [Generated shrinking](evidence/sql-effect-rules-shrink/report.json) | The first generated case fails on stale values; ten successful shrinks retain that law/checkpoint/collection/operation family. Six attempted drifts into a read-count failure are rejected. Original and reduced histories are saved. |
| [Fault replay](evidence/sql-effect-rules-replay-red/report.json) | The saved reduced history reproduces the same stale-value violation with the fault enabled. |
| [Repair replay](evidence/sql-effect-rules-replay-green/report.json) | The same reduced history passes without the fault, including all three subsequent operation checks. |
| [Contract suite](evidence/sql-effect-rules-contracts.tap) | 17 tests pass: six new boundary tests plus existing schema, compiler-dependency and matcher contracts. |

The six boundary tests execute PG routines and schema events: recursion with a
hidden read, default selection including positional omission and upsert DEFAULT,
FK cascade/set-null/set-default on update versus delete, a zero-row statement
trigger, stored generated/check/index expressions, and overload unions. Their
fault/failure sensitivity is not separately measured; the executed mutants cover
hidden-read omission and needless fallback through the client path.

Commands run from this directory:

```sh
npm run test:oracles:sql-effects
ENDPOINT_EFFECT_CHECKER=legacy ENDPOINT_ORACLE_OUTPUT=evidence/sql-effect-rules-red node tests/oracles/sql-effect-rules.mjs
ENDPOINT_EFFECT_MUTANT=omit-body-read ENDPOINT_ORACLE_OUTPUT=evidence/sql-effect-rules-mutant-read node tests/oracles/sql-effect-rules.mjs
ENDPOINT_EFFECT_MUTANT=needless-index-fallback ENDPOINT_ORACLE_OUTPUT=evidence/sql-effect-rules-mutant-fallback node tests/oracles/sql-effect-rules.mjs
ENDPOINT_EFFECT_MUTANT=omit-body-read ENDPOINT_ORACLE_SCENARIOS=3 ENDPOINT_ORACLE_SEQUENCES=1 ENDPOINT_ORACLE_OUTPUT=evidence/sql-effect-rules-shrink node tests/oracles/sql-effect-rules.mjs --generated-only
ENDPOINT_EFFECT_MUTANT=omit-body-read ENDPOINT_ORACLE_OUTPUT=evidence/sql-effect-rules-replay-red node tests/oracles/sql-effect-rules.mjs --replay evidence/sql-effect-rules-shrink/replay.json
ENDPOINT_ORACLE_OUTPUT=evidence/sql-effect-rules-replay-green node tests/oracles/sql-effect-rules.mjs --replay evidence/sql-effect-rules-shrink/replay.json
node --test --test-reporter=tap tests/sql-effects.test.mjs tests/schema-snapshot.test.mjs tests/compiled-dependencies.test.mjs tests/dependencies.test.mjs
```

## Audit disposition

This table records the disposition at the first kernel run. The subsequent
[older-oracle repair](ORACLE-REPAIR-RESULTS.md) implements the listed harness
repairs and supplies their red/green receipts; it states the remaining observation
limits separately.

The [fresh loss audit](../design/field-trip-optimistic-coherence/oracle-guide-loss-audit/AUDIT.md)
is frozen separately from these implementation decisions. It found test gaps,
not demonstrated production bugs.

| Loss | This implementation | Remaining portfolio work |
| --- | --- | --- |
| LA-01: failure drift | New runner preserves failure identity; an actual drifting shrink was rejected and the retained failure replayed. | Older runners still need this change. |
| LA-02: teardown evidence | New runner freezes mismatch evidence, attempts every release, retains cleanup diagnostics, and writes its final report after cleanup. | Inject cleanup faults to test those branches; repair older runner teardown. |
| LA-03: borrowed optimism | New baseline and optimistic expectations come from separate reference PG state. | Fix the older compiled/dependency runners using independent admitted baselines. |
| LA-04: discarded immediate snapshot | New runner captures and compares same-turn values before awaiting. | The existing concurrent browser runner still discards its invocation snapshot. |
| LA-05: IDs-only consumers | No browser consumer claim is made for this new runner. | Add rendered values and define render checkpoints in the browser oracle. |
| LA-06: generic mutant red | Reports retain named comparisons, cells, fault applications, actual execution/delivery counts, failure classification and replay verdicts. | Extend these receipts to other laws and older runners. |

## Boundaries before rollout

The parser remains `pgsql-ast-parser`, not PostgreSQL's binder. Valid PostgreSQL
syntax can remain unknown: for example its lexer rejects the compact recursive
argument `$1-1`, while the spaced `$1 - 1` form passes. No text rewrite hides
that limitation. Routine defaults, variadics, SQL-standard parsed bodies,
PL/pgSQL/dynamic SQL, trigger record bodies, views/rules/RLS, inheritance,
custom type/operator/cast bindings, and changed execution contexts remain open.
The checker reports an unresolved operation instead of an empty effect set.

Some unknowns are intentionally broader than the desired final binder: native
column types are the initial fragment, and an application-defined cast currently
leaves expression binding unresolved. These are implementation gaps, not claims
that relational algebra forbids optimization. They must not become permanent
table eligibility rules. The new checker has not replaced Kitchen's compiler
path on this evidence alone.

Derivations identify statements, relations, events and routine OIDs; exact AST
source spans remain to be added. Evidence assumes matching schema/search path
and application scope at execution. Deployment agreement and richer non-table
context summaries are not established by these tests. A constant query's kernel
proof against unknown writes is tested directly; that refinement is not wired
into the legacy registry's null-footprint matching.

This campaign measures read counts, not latency or wire compression. It adds no
new HTTP/browser, client bundle exclusion, overlapping-response, or full
PostgreSQL-generation evidence. Existing tests for those promises retain only
their own coverage credit.
