# PR 2394: external review of persisted startup

Reviewed head: `deae33c1b7afa554863ced20cbdab63ed9312fd3`.
The external reviewer supplied ten findings and ran no tests. This amendment
records self-review and executable verification. Earlier versioned records
retain their original, narrower campaigns; they do not establish this extension.

## Law, experiment, and inference

A complete source result replaces its persisted baseline in its declared scope.
A scoped Query result removes only its own ownership. A persisting optimistic
transaction can hold application after restore acceptance; that delay does not
remove accepted rows or ownership from the next source result's baseline.
Authority: the glossary's accepted sync transaction and optimistic state laws,
Query's scope-local omission contract, READY-3/PUB-7, and durable acceptance.

The shared [oracle](../../../packages/db-adapter-conformance/tests/persisted-startup-oracle.ts)
keeps the independent set judgment. Its new grammar crosses a disjoint optimistic
insert with restore and the first source result, then settles it before checking
the complete result. The unconfirmed insert drops at settlement. No production
queue or ownership algorithm computes the expected result. Empty saved baselines
also enter the grammar. An empty restore cannot supply deadline fallback, so the
grammar excludes that schedule; the readiness owner retains its loading law.

The production driver waits for a source commit invocation, or source markReady
when a complete empty answer needs no commit, before settling the optimistic
transaction. It waits for applied receipts before comparing that result. The
first public and durable cuts still precede refresh. Refresh fulfillment,
post-refresh storage, local-only reopen, and one-full-row-read comparisons remain.
A restore-first schedule uses the advertised baseline acceptance boundary,
including when restore contains no row. Row nonemptiness is not its witness.

RxDB now proves source commit invocation before releasing restore. PowerSync
uses one-row batches and proves that commits contain every row the fixture's
complete table supplies before releasing restore. Gate release alone establishes
neither premise. Each Node campaign and OPFS adapter has separate enforced reach.

**RED:** Before production edits, the optimistic extension fails on both
controlled storage and real Node SQLite: 32 Query checks fail, 56 pass. The
smallest generated trace is a saved `a`, an empty initial result, and a persisting
optimistic insert while restore is held. After settlement `a` remains. A peer
history instead retains the obsolete source ownership on an omitted peer row.
The real Chromium worker/OPFS run reproduces fourteen Query startup mismatches
before the repair; all six receiving adapters ran. Setup/type errors and an
initial browser timeout are excluded from this evidence.

**Repair:** Query enumerates accepted synced entries when recovering baseline
ownership, matching the metadata API's accepted-transaction view. It no longer
misses a restored row whose application is held. No extra persistence scan,
queue, or lifecycle state is introduced.

**GREEN:** The shared Node campaign passes 440 checks: 392 fixed histories,
24 generated registrations (80 histories each, 1,920 generated histories), and
24 calibrations. The OPFS receiver passes 196 histories: 46 Query and 30 per other
adapter. Surrounding Query ownership/direct-write and TrailBase lifecycle suites
pass another 439 checks. All Node campaigns separately enforce response ordering,
network-first result/fallback, empty result/baseline, overlap, omission, and the
persisting mutation; Query additionally enforces peers and each cache origin.

**Mutants:** Reintroducing applied-row Query ownership and the original
RxDB/PowerSync snapshot selection rejects startup comparisons on both Node hosts
and OPFS. Removing the direct-write wait for earlier commits produces six
comparison failures. These are assertion failures, not setup failures or timeouts.
The prior applied-row Query implementation is the original-defect control for the
new optimistic histories. TrailBase's original validator call rejects both
optional-metadata fixed histories and both generated campaigns before its repair.

**Limits:** Three string keys, numeric values, one disjoint optimistic insert,
one eager source scope and optional Query peer, and local-only reopen. This does
not establish arbitrary overlapping optimistic transactions, on-demand windows,
concurrent tab writers, failed I/O, every intermediate publication, remote RxDB
or PowerSync replication, or deployed TrailBase wire behavior. Existing owners
retain those neighboring contracts. No elapsed-time startup benchmark is claimed.

## Direct-write contract and test integrity (R1, R2)

The documented boundary is earlier source commits, not Query cache success.
`writeUpdate` and `writeDelete` reject before their row is loaded. The same-path
matrix confirms zero source commits and row-not-found rejection while persisted
restore holds the first result. Insert/upsert succeed. Already committed holders
still require positive commit reach and match the unwrapped reference.

A control that lets the first source result commit before restore instead admits
update/delete. The timing change is real, but the contract permits both event
orders. The oracle supplies the recorded commit event order to the unwrapped
reference; it never supplies production's rows or write verdict as the answer.
An unconditional positive-commit assertion on startup would invent a timing
promise. The six failures from removing the earlier-commit wait show that the
comparison still rejects a wrong result under the committed premise.

R1 is accepted under the documented admission contract; its timing consequence
is retained here. R2's model-hacking/quiet-exclusion accusation is not established.
The test's causal-input explanation is clearer, and the mutation evidence is
retained. No contract comparison or budget was weakened for this evaluation.

## Startup work under the snapshot contract (R4, R5)

The same shared comparison and real Node SQLite receiving path record startup
persistence transactions for empty and three-row saved baselines, with a complete
three-row source answer. Original selection sends three source row mutations
without truncate. Current selection sends three source row mutations with
truncate. Seed writes are counted separately. Thus this PR adds a storage-wide
clear and metadata reset; it does not introduce the full N source row writes.
SQLite's truncate branch clears the row and tombstone tables and expected-key
set. Snapshot replacement is allowed to remove old row metadata. Neither RxDB
nor PowerSync consumes a provider resume cursor from this metadata.

PowerSync's snapshot path additionally retains its source batches until commit.
RxDB already begins one transaction before paging and commits after the full
read; attributing that buffering to this PR would be inaccurate. The existing
one-full-wrapper-row-read guarantee remains checked. No throughput or elapsed
startup regression magnitude has been measured.

The glossary's snapshot-transaction contract explicitly permits replacement of
all synced rows. These adapters do not promise bounded startup source batches or
preservation of per-row metadata across that replacement. The previously reviewed
startup budgets still pass: one full wrapper row read, skipped complete setup,
and hydration fairness. The added clear and PowerSync batch retention are real
costs of choosing that existing snapshot path. They remain documented costs,
not evidence that startup latency is unchanged.

No new publication contract is needed to complete this repair. Progressive
publication would be a separate design change, and this amendment does not make
it. R4 and R5 are accepted under the existing snapshot contract, with the work
measurements and unmeasured latency limit preserved. This classification does
not assert that a new user decision approved the costs.

## Repair location (R9)

The wrapper receives explicit snapshot, delta, and scoped transactions. A first
eager commit is not evidence of a complete Collection-wide replacement. Query
has scoped ownership; TrailBase can commit pages before exhaustion; Electric can
resume from delta-only progress. Automatically treating a first commit as a
snapshot would discard legitimate peer or unmentioned rows. The existing
snapshot contract intentionally puts replacement authority at the source.

The accepted-row ownership repair belongs to Query's ownership boundary. A
central helper could reduce repeated adapter code, but the proposed wrapper-only
repair lacks scope/exhaustion information and is not a substitute for these laws.

## Other findings and loss audit

| ID | Technical verdict and action | Durable value |
| --- | --- | --- |
| R1 | Accepted design: real timing change, no cache-success admission promise. | Preserve pre-commit rejection and committed-source admission witnesses. |
| R2 | Refuted as test-integrity defect; event order is a causal input. | Clarified prose; earlier-commit-wait mutant fails six checks. |
| R3 | Fixed now: accepted restored ownership was absent from the applied-row walk. | Shared optimistic-history dimension on every receiver. |
| R4 | Accepted design under the snapshot contract. Added clear and batch retention are real. | Preserve measured original/current work and the unmeasured latency limit. |
| R5 | Accepted design under the snapshot contract. Added clear is real. Full-read transaction predates PR. | Separate existing N writes from added truncate work. No provider resume cursor is consumed here. |
| R6 | Fixed now: absent optional metadata threw. | Lifecycle grammar crosses metadata presence and absence in both modes. |
| R7 | Fixed now: gate release was weaker than the declared premise. | Semantic commit evidence, multi-batch PowerSync, original-defect controls. |
| R8 | Fixed now as cleanup; external consumer break overstated. | Oracle moved to tests; package is private and root export omits this module. |
| R9 | Refuted as blanket wrapper repair. | Recorded information boundary and scoped/delta counterexamples. |
| R10 | Fixed now: both documentation statements were stale. | README covers six receivers; initialData docs distinguish persisted reconciliation. |

R6 uses the existing TrailBase lifecycle model and comparisons. Its generated
metadata dimension is an omission of the entire optional API, not an incomplete
advertised capability. The validator still rejects a supplied API with a missing
persistence field. Presence/absence reach is separately enforced in fixed and
random 50-history campaigns. The unchanged production RED has four failures and
95 passes; repaired production passes all 99 checks. No test budget was lowered.

R8's actual build emits startup declarations but no references to nonexistent
test imports in those declarations. The private package exports only its root;
the oracle is not a root export. Moving it beside its production driver and
suite prevents test dependencies under src and removes the unused declarations.
The build succeeds after relocation. Current imports, documentation links and
receiving paths follow the new location.

Ten raw items are accounted for: five fixed now, two refuted, and three accepted
designs under existing contracts. No item is silently deferred or dropped. No
additional production defect was established while testing neighboring laws;
the empty-restore scheduling mistakes were repaired in the test driver/grammar.

Reviewer assessment: **hire with reservations**. The accepted/applied ownership
crossing and weak delivery premises were strong findings, and the missing-metadata
case was correct. The review also found real costs and stale documentation.
Its admission-contract, package-consumer, and wrapper-centralization conclusions
were overstated, and running no tests left important distinctions unverified.

The review accounting and authorized repairs are complete. Whole-PR readiness
is not assessed here. The prior gap CLI audit remains incomplete, and the final
amendment still needs CI verification. No elapsed-time performance claim follows
from the work counters.

## Oracle-rubric audit

ORC-001/002: authorities above; unchanged independent set model and differential
reference. ORC-003: contract, grammar, production driver, and cuts remain explained
beside their code. ORC-004: removing mutation loses queued-restore ownership;
removing timing loses the restore race; zero/nonzero baselines distinguish empty
fallback legality; scope peers forbid global replacement. The three-key range
includes empty, overlap, omission and complete membership. Duplicate source keys,
Collection-wide peers and empty deadline fallback are excluded.
ORC-005: all six actual adapter entry points and controlled/Node/OPFS storage
receivers run; first-result durable observations still precede refresh.
ORC-006: original-defect and earlier-commit-wait controls fail comparisons.
ORC-007: existing fixed/random campaigns and 80-history budgets remain; no replay
parser changes. ORC-008: no reference-model state was added. A scheduling axis was added. The optimistic insert drops
before the compared source result, so no model queue is needed.
ORC-009: accepted/visible boundaries follow the glossary; firstSubmission combines
a source commit invocation and an empty source's markReady solely for scheduling.
ORC-010: shared withOracleCleanup retains primary errors and cleanup diagnostics.
ORC-011: no new shared-semantic-fault hypothesis warrants another set model; the
existing unwrapped direct-write differential remains separate.
ORC-012: this record names the reviewed head, limits, ten dispositions and
measured startup costs. ORC-013: empty/nonempty, before/after restore, peers, and
optimistic/no-optimistic histories distinguish the promised conditional laws.
ORC-014: real QueryClient, SDK/provider boundaries, Node SQLite and worker/OPFS
receive the same judgment. ORC-015: each receiving campaign enforces separate
reach. The final measured counts appear below.
ORC-016: fixed histories use the shared model and comparison without their own
expected answers. The work-count experiment also reuses that composition and
judgment; it is diagnostic performance evidence, not a new product oracle law.


## Final receiving evidence

The following counts come from the final repaired run. Each generated
registration executes 80 histories and enforces its own reach. Columns count
response-before-restore, restore-before-response, a persisting optimistic
transaction, an empty saved baseline, and network-first deadline fallback.
Counts overlap because one history can reach several states.

| Adapter, host, campaign | Before | After | Mutation | Empty baseline | Fallback |
| --- | ---: | ---: | ---: | ---: | ---: |
| convex.controlled.fixed | 37 | 43 | 38 | 39 | 5 |
| convex.controlled.random | 37 | 43 | 40 | 36 | 7 |
| convex.node-sqlite.fixed | 37 | 43 | 38 | 39 | 5 |
| convex.node-sqlite.random | 33 | 47 | 42 | 40 | 8 |
| electric.controlled.fixed | 37 | 43 | 38 | 39 | 5 |
| electric.controlled.random | 29 | 51 | 41 | 40 | 15 |
| electric.node-sqlite.fixed | 37 | 43 | 38 | 39 | 5 |
| electric.node-sqlite.random | 33 | 47 | 38 | 40 | 10 |
| powersync.controlled.fixed | 37 | 43 | 38 | 39 | 5 |
| powersync.controlled.random | 36 | 44 | 43 | 42 | 10 |
| powersync.node-sqlite.fixed | 37 | 43 | 38 | 39 | 5 |
| powersync.node-sqlite.random | 35 | 45 | 37 | 41 | 12 |
| query.controlled.fixed | 54 | 26 | 38 | 41 | 10 |
| query.controlled.random | 63 | 17 | 41 | 43 | 5 |
| query.node-sqlite.fixed | 54 | 26 | 38 | 41 | 10 |
| query.node-sqlite.random | 56 | 24 | 41 | 36 | 7 |
| rxdb.controlled.fixed | 37 | 43 | 38 | 39 | 5 |
| rxdb.controlled.random | 37 | 43 | 44 | 40 | 10 |
| rxdb.node-sqlite.fixed | 37 | 43 | 38 | 39 | 5 |
| rxdb.node-sqlite.random | 26 | 54 | 33 | 43 | 9 |
| trailbase.controlled.fixed | 37 | 43 | 38 | 39 | 5 |
| trailbase.controlled.random | 37 | 43 | 45 | 37 | 12 |
| trailbase.node-sqlite.fixed | 37 | 43 | 38 | 39 | 5 |
| trailbase.node-sqlite.random | 26 | 54 | 38 | 40 | 11 |

Chromium uses the same fixed histories, production driver and comparison.
Its browser-local counters enforce each receiving path independently, without
importing the Node runner's AsyncLocalStorage dependency.

| OPFS receiver | Histories | Before | After | Mutation | Empty baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| Query | 46 | 34 | 12 | 23 | 6 |
| Convex | 30 | 18 | 12 | 15 | 6 |
| Electric | 30 | 18 | 12 | 15 | 6 |
| TrailBase | 30 | 18 | 12 | 15 | 6 |
| RxDB | 30 | 18 | 12 | 15 | 6 |
| PowerSync | 30 | 18 | 12 | 15 | 6 |

Original-defect controls reject 112 of 236 Node checks across Query, RxDB and
PowerSync. Their Chromium run reaches every adapter's declared states and rejects
the same shared startup comparison. The repaired Node run passes all 440 checks.
The repaired Chromium run passes all 196 histories.

The diagnostic work experiment uses `observePersistedStartup` with the Node
SQLite host, wraps `applyCommittedTx` to record `truncate` and mutation count,
and reports at the startup cut. It uses `next: 7`, `peer: false`, and
`response: 'before-restore'`, once with `previous: 0` and once with `previous: 7`.
Each receiver passes the same shared comparison under both original and current
snapshot selection. A nonempty baseline has a separate three-write seed
transaction. The source transaction counts are:

| Receiver | Saved rows | Original row writes / truncate | Current row writes / truncate |
| --- | ---: | --- | --- |
| RxDB | 0 | 3 / false | 3 / true |
| RxDB | 3 | 3 / false | 3 / true |
| PowerSync | 0 | 3 / false | 3 / true |
| PowerSync | 3 | 3 / false | 3 / true |

## Commands and validation limits

The six-adapter Node run uses source aliases to avoid mixing built and source
copies of Collection transactions. This local test plumbing does not ship.
Save this config at the checkout root as `startup-review.config.ts`:

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
const root = import.meta.dirname
export default defineConfig({
  root,
  resolve: {
    alias: {
      '@tanstack/db': resolve(root, 'packages/db/src'),
      '@tanstack/db-ivm': resolve(root, 'packages/db-ivm/src'),
      '@tanstack/db-sqlite-persistence-core': resolve(root, 'packages/db-sqlite-persistence-core/src'),
    },
  },
  test: {
    environment: 'jsdom',
    typecheck: { enabled: false },
    coverage: { enabled: false },
    testTimeout: 30000,
  },
})
```

Run from the checkout root, then remove the temporary config:

```sh
pnpm exec vitest run --config startup-review.config.ts --maxWorkers=2 \
  packages/query-db-collection/tests/persisted-startup-conformance-oracle.test.ts \
  packages/convex-db-collection/tests/persisted-startup-conformance-oracle.property.test.ts \
  packages/electric-db-collection/tests/persisted-startup-conformance-oracle.property.test.ts \
  packages/trailbase-db-collection/tests/persisted-startup-conformance-oracle.property.test.ts \
  packages/rxdb-db-collection/tests/persisted-startup-conformance-oracle.property.test.ts \
  packages/powersync-db-collection/tests/persisted-startup-conformance-oracle.property.test.ts

pnpm --filter @tanstack/browser-db-sqlite-persistence exec playwright test \
  --config playwright.opfs.config.ts persisted-startup-conformance-oracle.opfs.spec.ts
```

For the Query RED/control, change the accepted ownership enumeration back to
`collection._state.syncedData.keys()` and destructure its key directly. For the
RxDB and PowerSync controls, remove `!!params.metadata?.persistence ||` from
snapshot selection. Run the same comparisons, then restore production and run
GREEN. For the TrailBase RED, remove the `params.metadata === undefined` guard.
For direct-write calibration, remove `ctx.earlierCommits?.()` in `manual-sync.ts`.
Its comparison rejects six histories instead of accepting collateral corruption.

Surrounding validation runs Query's `ownership-lifecycle.oracle.test.ts`,
`persisted-direct-write-window.oracle.test.ts`, `persisted-direct-write.test.ts`,
and TrailBase's `lifecycle-oracle.property.test.ts` and `lifecycle.test.ts` through
the same source-aliased config: 439 checks pass. All seven affected package
`tsc --noEmit` commands pass. The conformance package build passes after the
move and no longer emits the unused startup declaration.

Local registry recovery selects `@tanstack/query-core` 5.106.0 instead of
5.107.1, `fake-indexeddb` 6.2.7 instead of 6.2.8, and `@tailwindcss/postcss`
4.3.4 instead of 4.3.5 after HTTP 403 responses. Overrides and lockfile churn
remain uncommitted. The exact locked versions remain untested locally.


The ordinary RxDB package command exposed a separate receiving setup gap:
its Vite runner combined the built Collection with the shared driver's source
transaction stack. The first optimistic fixed histories timed out before their
checkpoint, and later fixture construction reported leaked RxDB instances.
These failures are not production RED evidence. Explicit test aliases in the
RxDB Vite config make DB, IVM and persistence core resolve to the same workspace
sources as the shared drivers. This changes test resolution only. The repaired normal package startup command
passes all 68 checks. The full normal RxDB suite passes all 89 checks across
three files. Its package typecheck also passes after the runner change.


Final staged validation: `pnpm lint:changed`, ESLint on every changed TypeScript
file, and `git diff --cached --check` pass. No run budget was lowered or removed.
