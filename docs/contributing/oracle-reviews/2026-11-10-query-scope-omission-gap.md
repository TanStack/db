# Query scope omission and retained-cache next use

Reviewed base HEAD: `0e86c1fdae85520aff142f141f71ccf46a8ee8bd`, with the current
uncommitted Query source SHA-256
`1a794774e60d3c1dbacd515d0350b048557714adf80d6e3b9d42e7250841754b`.
Integrated oracle SHA-256: `13834157b4318778b0600890f20c015511583212377d9c658c4482e0eae602dc`.
This additive coverage experiment changes no production source. It does not
replace the original delta audit's immutable 24-kill/11-survivor result.

## Law and ownership

The primary owner is Query's ownership-lifecycle oracle. Its receiving extension
[scope-omission-reacquisition-oracle.ts](../../../packages/query-db-collection/tests/scope-omission-reacquisition-oracle.ts)
uses the existing independent direct/fetch overlay judgment.
Authority is [Direct Writes and Query Sync](../../collections/query-collection.md#direct-writes-and-query-sync):
a later successful complete unbounded matching response can remove an ownerless
direct row; that absence belongs only to its scope. A distinct retained Query
remains available under normal stale/gc rules. Acquiring it after the direct row
was removed starts a new row lifetime from that retained result. If A returns
x instead, A's later physical fetch supplies the continuously owned value.

The model predicts rows from authored successful responses and accepted writes.
It contains no direct-write positions, generation counters, cache classifiers,
or production transition helpers. Cache order changes the legal history, not
its expected terminal answer.

## Grammar, path and cuts

A distinct real peer Collection retains scope B (`id == x`) with a successful
Query result. The tested Collection accepts ownerless `writeInsert` or
`writeUpsert`. Scope A (`category == shared`) later completes and returns or
omits x, optionally alongside y. Then the tested Collection acquires B without
a new fetch. Raw arrays and a derived `edges[].node` projection, B fetch before
or after the write, and independent integer values from -10 through 10 are
generated. A is a proper scoped predicate, so full-source reuse cannot bypass
B's distinct cache entry. No `setQueryData` seeds the retained premise.

The same production driver and check run with controlled persistence, native
Node SQLite, and real Chromium worker/OPFS persistence. Public and durable rows
are compared after the direct write, after A, and after acquiring B. The peer's
retained values and exact provider request count (two) are also compared.
Durable observations use the wrapping capability's `scanPersistedRows`, which
addresses the actual managed on-demand cache generation.

Every campaign has 30 arbitrary histories and eight randomized constructed
histories. Each builder makes a fresh object and records its obligation in a
WeakMap. Both seeded and generated builder outputs must contain their required
actual reach fact. Eight missing-state calibrations and a separate control
that feeds generated inputs through every builder and the real receiving path
reject omitted facts. The latter runs on each of the three hosts.

The eight states are measured from actual cache shape, accepted write rows,
queryFn/write event order, A's delivered rows and the observed row cuts. In the
normal integrated fixed-seed campaign, each host recorded:

| State | Histories |
| --- | ---: |
| raw | 23 |
| derived | 15 |
| insert | 20 |
| upsert | 18 |
| old-cache-after-omission | 13 |
| new-cache-after-omission | 11 |
| returned-direct-key | 14 |
| nonempty-omission | 17 |

The fresh integrated campaigns recorded these counts in the same order:
controlled `[19,19,22,16,11,13,14,10]`, native SQLite
`[21,17,16,22,14,8,16,13]`, Chromium OPFS
`[19,19,25,13,10,10,18,9]`. Each required state has an enforced minimum of one
randomized construction per host/campaign; fixed histories supply none of it.

Grammar controls: the minimized reported omission witness is reconstructible
with raw/insert/before-write/omitted/empty and zero values. Removing either
cache order misses a causal position; removing either shape misses a cache
projection path; removing insert/upsert misses an admission path. Returned x
opposes an unconditional reacquisition overwrite; sibling y opposes clearing
all A rows. Empty and nonempty responses, equal and unequal values, and both
integer endpoints are in the bounded domain. A limited/cursor response is not
in this grammar because it cannot establish complete matching omission.

## Executed results

Normal repository commands passed:

```sh
node node_modules/vitest/vitest.mjs run --config packages/query-db-collection/vitest.config.ts packages/query-db-collection/tests/scope-omission-reacquisition-oracle.test.ts
# 36 passed, including both campaigns and generated-construction controls per Node host
node node_modules/vitest/vitest.mjs run --config packages/browser-db-sqlite-persistence/vitest.adapter-oracles.config.ts packages/browser-db-sqlite-persistence/e2e/query-scope-omission-oracle.browser.test.ts
# 18 passed, including fixed/fresh campaigns and generated-construction control
```

Both Node hosts and Chromium use the same grammar, model and check. The normal
browser host disables HMR and file watching. Mutation browser runs additionally
use an immutable source transform whose plugin/cache identity includes candidate
SHA-256; they require a positive transform and zero watched paths before any
history. Source and original-span guards reject drift before mutation.

The exact replay coordinates are seed `1313`, path `0:0:0:0:0:0`:

```json
{"shape":"raw","operation":"insert","cacheOrder":"before-write","includesDirect":false,"sibling":false,"bValue":0,"directValue":0,"sourceValue":0,"siblingValue":0}
```

M1313 returns undefined instead of reading the direct position in complete-scope
omission cleanup (line 2742, stable anchor
`src/query.ts#applySuccessfulResult:value-undefined:const directPosition = unownedDirectWritePositions . get ( key )`).
The global-selection identity adds `~2`; this delta report identity does not.
The exact SHA/span/operator, rather than that suffix alone, identifies it.
M1315 makes the cleanup guard false; M1316 changes its inequality to equality;
M1317 removes the settled-position registration. Each produced **two assertion
failures**, one per Node host, at `acquired`: expected `{x:0}`, observed `{}`.
M1313 additionally produced **one assertion failure on real Chromium OPFS** at
the same cut. Browser claims for M1315/16/17 were not executed.

| Operator | Frozen candidate SHA-256 |
| --- | --- |
| M1313 | `35b2b4e1a974530e73051e65f15cb6bbc86c318cf0084280b0b0b9fbb1162b7f` |
| M1315 | `fcbe54b7e59bce34228227e31530846d6e9971d96505de2831e3bcefa24b1bbc` |
| M1316 | `ed4ccb39f1ab4c489bd274cad3a510c65e29544dd35b9abbeb6fb9acc800016b` |
| M1317 | `b53d34ec12a0da52a6cdafa23ec19d9208de2303a11981f216961ed4625ac100` |

Exact clean replay counterparts passed (two Node, one Chromium). These are
assertion kills at the intended next-use checkpoint. They are not timeout,
bootstrap, cleanup, or runtime-error classifications. Temporary mutation command:

```sh
QUERY_SCOPE_MUTANT=query.ts:M1313 TANSTACK_DB_ORACLE_PROPERTY=query.scope-omission-reacquisition TANSTACK_DB_ORACLE_SEED=1313 TANSTACK_DB_ORACLE_PATH=0:0:0:0:0:0 node node_modules/vitest/vitest.mjs run --config /private/tmp/tanstack-db-2394-scope-omission/integrated.config.ts
# Chromium: property suffix .chromium-opfs and browser.config.ts
# Omit QUERY_SCOPE_MUTANT for the exact clean counterpart.
```

Scoped TypeScript, typed ESLint and branch-wide
`pnpm --config.verifyDepsBeforeRun=false lint:changed` passed. The integrated wrappers expose the
shared check inline for oracle lint; no rule is disabled. An independent
instrument reviewer cleared the bounded law/model/path and inspected the
isolated Chromium mutant/clean logs.

## Calibration and discarded diagnoses

The shared check compares recorded product facts before diagnosing missing
later cuts, false completion, a missing browser marker or detached browser
errors. Controls reject wrong rows in a truncated prefix, wrong rows followed
by false completion, wrong rows without the browser marker, missing durable
observations, missing constructed reach, and loss of the reacquired row.
Browser diagnostics remain secondary beside an earlier product violation.
Cleanup uses the shared failure-preserving helpers and verifies OPFS removal.

Early scratch histories used `{}` for A. That is the full-source path, which can
legally satisfy B without B's distinct cached result. Their failures were
wrong-path diagnoses and are not product bugs or closure evidence. The final
scoped A predicate fixes the premise. Earlier browser runs used the copied host
without its later HMR/watch fences; they are superseded by the isolated rerun.
After central registration, two scratch browser replay attempts refused during
setup because the overlay appended the newly registered IDs twice. Their
zero-test failures are setup failures. Deduplicating that scratch registry
restored the exact clean GREEN and M1313 assertion RED on the final shared
module; those failures are not mutation kills.

A three-cache M1327 proposal asked one old cached value to overwrite another
old cached value acquired during a later row lifetime. Clean production did not
do that. The guide's later-fetch precedence covers continuous ownership, and
does not clearly order these pre-lifetime cached acquisitions. That proposal
remains an unaccepted stronger law in scratch; its failures are not product
bugs, and the model was not changed to match them. M1314's always-true guard
remains a separate allowance question, not a kill from this experiment.

## Rubric and limits

ORC-001–007: contract/limits, independent overlay judgment, literate layers,
grammar controls, three real receiving paths/cuts, calibrations/mutation results,
and identical fixed/fresh campaigns with tested direct replay are above.
ORC-008: no new stateful model; stateless authored-response projection is enough.
ORC-009: A/B are exact subset demands and `acquired` is load applied settlement;
row lifetime is the guide's ownership interval, not an internal generation.
ORC-010: prefix/secondary-error calibrations plus shared cleanup preserve failure.
ORC-011: no named shared semantic-fault hypothesis required another formulation;
the M1327 competing proposal is explicitly unresolved contract design.
ORC-012–015: versioned source/receiving boundary, returned-versus-omitted and
old-versus-new-cache witnesses, real-host handoff, actual constructed reach and
per-host generated-output controls are recorded. ORC-016: ordinary examples
are absent; all comparisons and controls invoke the same declared check.

This closes four concrete cleanup-family mutant gaps on the two Node receiving
paths and M1313 on Chromium OPFS. It does not close every ownership or source
ordering law. Limits are successful I/O; one same-run direct row; two fixed
matching exact predicates in the stated A/B order; raw/one derived encoding;
numeric values; no stale refetch, window/cursor, external cache edit, concurrent
writer, arbitrary schedule, multi-cache conflict policy, service or wire claim.
Those broader ownership histories remain with the primary ownership oracle;
no new exclusion or maintainer allowance is created here.

## Final package integration

The normal Query oracle command now includes this receiver. Its first full run
passed 1,663 runtime/type checks and reported one skipped collector artifact.
A targeted JSON report identified that artifact as the type collector's
unexpanded `host` registration of the generated-construction calibration.
Both actual controlled/SQLite registrations passed, as did all 36 runtime
checks in the targeted run.

The two Query configs now exclude this runtime registration file from the
type-test collector, as they do the other `oracleProperty` wrappers. The file
remains in the TypeScript program. The final normal command
`pnpm --config.verifyDepsBeforeRun=false test:oracles --maxWorkers=1` passes
**1,663/1,663 checks**, with no skipped checks or type errors, in 66.25 seconds.
No product history, comparison, calibration or run budget was removed.
