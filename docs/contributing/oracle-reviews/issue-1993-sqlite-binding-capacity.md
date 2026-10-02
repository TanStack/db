# SQLite subset binding capacity, issue #1993

Reviewed executable revisions: `51c060aa5` (the initial core and Cloudflare
repairs) and `14c0e4efc` (the CI integration follow-up, including the Node
expression-index oracle repair at `398725d45`). The pre-repair core source was
`ef1e6a4aa`; the Cloudflare transaction driver before its one-line repair was
`cbd9d24de`. This record was updated after the follow-up executable revision.
The subsequent test-file edit only clarifies the oracle's documented scope.

## Contract, model, and boundary

The established 1,200-ID `loadSubset` case promises support for large `IN`
predicates. Issue #1993 adds the statement-wide law: a supported subset request
must return its exact persisted rows without asking its SQLite driver to bind
more parameters than the driver's host allows. The core owner is
`packages/db-sqlite-persistence-core/tests/sqlite-core-adapter.test.ts`; the
Cloudflare receiving owner is
`packages/cloudflare-durable-objects-db-sqlite-persistence/tests/do-replacement-batching.test.ts`.

The core oracle filters two or three declared rows with typed equality and
Boolean clauses. Its result does not come from SQL compilation or SQLite. It
builds corresponding IR predicates, seeds the real core adapter, and records
each attempted prepared statement before the driver calls SQLite. At
`loadSubset` settlement it compares exact keys and decoded values, ordered keys
where requested, the reached predicate SELECT, errors, and each statement's
binding count against a real Node SQLite connection limited to 999 variables.
The Cloudflare witness independently expects only the seeded `target` row from
the named IDs. Its Node SQLite storage seam rejects more than Cloudflare's
documented 100 parameters before execution. It reaches the actual Cloudflare
driver and core adapter through both savepoint and native transaction modes.

The bounded history grammar crosses one/two lists, an optional scalar, nested
`and`/`or`, five value kinds, 998/999/1000-value and 499+500/500+500
edges, direct and `transactionWithDriver` routes, cursor SELECTs, and both
index-definition contexts. An empty `IN` is valid; a scalar equality clause
with no value is excluded by the model-input guard. Cloudflare crosses 100/101
equality and one-item `IN` clauses in both transaction modes. The core's
1,000-scalar control also reaches the final statement-total guard.

## RED, GREEN, and hostile controls

On unchanged core production at `ef1e6a4aa`, the normal targeted package run
had five expected failures and one passing index-definition control. One
1,000-value list attempted 1,000 bindings; two 500-value lists attempted
1,000; the reported two 1,000-value lists attempted 2,000; a 999-value list
plus one scalar attempted 1,000; the nested case attempted 1,001. Both cursor
SELECTs attempted 1,000. The 999 and 499+500 controls passed. SQLite rejected
the over-cap statements with `too many SQL variables` at the predicate SELECT.
The original 900-item OR-chunk compiler is the executed hostile design.

The fixed-seed campaign shrank with `seed=1993999 path=1:0`: both the first and
reduced failures were `capacity@predicate-select`. Direct replay reproduced the
same class and checkpoint before the fix. The seedless campaign independently
shrunk to the same class. The post-repair direct replay passes using:

```sh
TANSTACK_DB_SQLITE_BINDING_SEED=1993999 TANSTACK_DB_SQLITE_BINDING_PATH=1:0 \
pnpm --filter @tanstack/db-sqlite-persistence-core test \
  tests/sqlite-core-adapter-cli-runtime.test.ts \
  -t 'replays the requested binding history directly'
```

The repaired core binds each runtime `IN` list as one JSON table value, keeps
literal `IN` values in both index DDL contexts, and uses the existing in-memory
row evaluator when the final SELECT would exceed the advertised cap. Its
primary targeted run passes all seven oracle checks with no type errors.

With the new Cloudflare receiving witness and the old transaction driver,
both 101-clause kinds rejected with `host parameter limit exceeded` at
`loadSubsetInternal`; the transaction driver had omitted the root driver's
100-binding cap. The one-line propagation repair passes all 100/101 cases in
both transaction modes. The host-limit test file passes all seven runtime cases
with no type errors.
The SQLite CLI contract file passes 40/40. Both packages build and their
changed files pass ESLint. A full core package run under two concurrent test
threads passed 684 tests but timed out on three existing long-running cases;
the affected CLI and lifecycle files passed in isolation (40/40 and 4/4).

## Oracle guide audit

| Requirement | Outcome for this executable revision |
| --- | --- |
| ORC-001 authority and limits | Pass for the bounded subset law above: the prior large-list contract and #1993 authorize exact rows and a statement-wide cap. Native host and broader value limits are below. |
| ORC-002 independent judgment | Pass. The model computes typed row matches without production SQL, the compiler's classifier, or SQLite results. The Cloudflare expected key comes from named IDs, independent of the adapter. |
| ORC-003 distinguishable responsibilities | Pass. The core owner's opening names contract, model, grammar, driver, and refinement; its fixed/generated cases implement them. The Cloudflare file names its controlled host premise and public check. |
| ORC-004 grammar controls | Pass within the stated domain. Fixed cases reconstruct one large list, two small lists whose total crosses the cap, mixed scalar/list, nested, empty, typed, ordered two-hit, cursor, and index contexts. Removing list count or length loses a capacity shape; removing kind/connective loses a semantic-compatibility challenge. 998/999/1000 and 499+500/500+500 are margins. A no-value scalar clause is rejected; null, nonfinite, containers, and out-of-range BigInt are excluded. |
| ORC-005 production path and observation | Pass. Real core adapter plus prepared Node SQLite reaches the SELECT and checks exact public rows at `loadSubset` settlement, with attempted binding counts recorded before failure. The Cloudflare witness reaches the real Cloudflare driver through both transaction APIs and checks returned rows and host counts. |
| ORC-006 checker calibration | Pass. The unchanged 900-item OR-chunk compiler and the Cloudflare transaction driver without its cap both fail at the intended query checkpoint. These are assertion failures from real over-cap attempts, not timeouts or setup failures. |
| ORC-007 campaigns and replay | Pass. The normal core package test registers separate matching 12-run fixed-seed and seedless-random campaigns. The replay variables select only the requested property/seed/shrink path; the captured RED path failed directly and passes after repair. |
| ORC-008 state minimality | Not applicable. The reference recomputes a result from one immutable specification and has no transition state to combine or split. |
| ORC-009 vocabulary mapping | Pass. A `Spec` is model-only input; each clause maps to one IR predicate. Binding attempts map to driver query/run calls, and the observation checkpoint is `loadSubset` settlement. Shared subset and transaction terms retain production meanings. |
| ORC-010 failure fidelity and cleanup | Bounded pass. Generated failures preserve first and reduced kind/checkpoint; the core observation closes its Node database and records a secondary close error separately from the query error. No close failure occurred in the recorded campaigns. A setup failure with a simultaneous close failure, or a close failure during the cursor/index fixed controls, has no demonstrated separate diagnostic; this harness gap remains with the core owner. |
| ORC-011 independent second formulation | No second product-level formulation is claimed. The plausible shared fault is typed JSON conversion; the independent typed row model plus string, boolean, Date, and signed-64-bit BigInt controls distinguish the implemented lowering from a blanket numeric cast. Null, nonfinite, and structural values still need a separate equivalence law. |
| ORC-012 review evidence | This versioned record gives the outcome of ORC-001–014, exact executable revision, hostile RED and repaired GREEN, limits, and unresolved owners. It claims only the bounded contract × history × path × observation cells above. |
| ORC-013 boundary witness | Pass. 999 succeeds and 1,000 failed on the original core; 499+500 succeeds while 500+500 failed. Cloudflare's 100/101 pair reaches the nested-driver cap. A conservative early fallback is allowed, so the claim is no over-cap statement plus exact rows, not a precise fallback threshold. |
| ORC-014 controlled-premise handoff | Pass for Node's real configured 999-variable SQLite connection. Cloudflare's 100 cap is a documented limit enforced by controlled storage; actual Worker delivery of that premise remains open under the Cloudflare runtime owner. |

## Remaining scope and code weight

This closes the bounded prepared-Node and controlled Cloudflare transaction
paths, not every SQLite host. The core coverage map owns null, nonfinite,
container, and structured-value equivalence, 50,582-ID stress, JSON-function
availability, arbitrary predicate depth, concurrency, and row-read work during
fallback. The Cloudflare runtime bridge owns a Worker receiving witness for
JSON support and the real 100-binding premise. Browser, mobile, Tauri, and
native-device drivers each need their own receiving execution. A reachable
in-scope counterexample would keep the broader class open.

Production diff against `origin/main` at `14c0e4efc`: SQLite core `+18/-37`
lines; Cloudflare driver `+1/-0`; combined `+19/-37`, net **18 fewer**
production lines. Test and documentation growth is reported separately in the
branch diff.

## CI integration follow-up at `14c0e4efc`

The first PR CI run found four stale observations in the Node expression-index
oracle. Two fixed BigInt cases still expected two or 901 scalar bindings; two
hostile controls checked those old counts and stopped before changing the SQL.
The runtime query now binds one JSON numeric array through `json_each(?)`.
At `398725d45`, the fixed cases compare the exact unquoted numeric JSON text,
and the hostile controls alter the first or last number inside that one bound
array. The unchanged production failed four of 68 checks before this oracle
repair. Afterward all 68 passed with no type errors. The oracle still compares
exact adapter and direct SQL rows and the named expression-index plan. The
controls reach the query and fail on wrong rows, not on an unreached guard.

CodeRabbit review `5393828482` found a missing production path: a root driver
can declare a host cap while `transactionWithDriver` returns a distinct driver
without that property. The old oracle reused the root driver for its transaction
route, so it could not see this omission. A new fixed witness uses a real Node
SQLite connection capped at 100 variables, a root driver that advertises 100,
and a distinct transaction driver that omits the cap. Its 100-equality control
binds 100 and returns the exact rows. With unchanged production at `398725d45`,
the 101-equality case submitted 101 bindings at the predicate SELECT and
rejected with `too many SQL variables`: `capacity@predicate-select`, not a setup
failure. At `14c0e4efc`, the transparent scheduling wrapper forwards the root
cap, and subset queries fall back to that cap when the transaction driver omits
one. The 101-equality case now makes an unbound SELECT, returns the exact rows,
and passes the same 100-cap refinement check.

The guide outcomes above carry forward for ORC-002, ORC-003, ORC-007 through
ORC-009, and ORC-011. ORC-001 and ORC-004 now include the omitted-cap
transaction path and the 100/101 boundary. ORC-005 observes the real prepared
Node query and exact returned rows on that path. ORC-006 has the reached RED
failure and repaired GREEN at the same predicate checkpoint. ORC-010 retains
the original primary error separately from any close error. ORC-012 is bounded
to the declared root-cap, distinct-driver history and exact-row plus binding
observations; drivers that misreport their actual host limit remain outside it.
ORC-013 distinguishes 100 from 101 and checks that 101 falls back before
prepare. ORC-014 uses an actual Node SQLite variable limit of 100; other hosts
still own their receiving witnesses.

The focused follow-up checks passed: 41 SQLite core CLI and binding tests, 68
Node expression-index tests, and 21 Cloudflare driver and host-limit tests, all
with no type errors. Changed production and oracle files passed ESLint and
Prettier.
