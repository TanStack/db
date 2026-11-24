# Shared-client receiving evidence

Reviewed production: `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`.
No production edits preceded these runs. This family closes a portfolio gap;
it found no additional production defect.

## Pre-edit receiving inventory

Before the first test edit, the review identified two concrete missing public
receiving paths: a no-stream/defaults-false cached Collection joining an already
synced donor, and two same-table source Collections with distinct explicit
streams and independent cleanup. Existing eager/reload models required a fresh
empty loading target before delivery, so they could not truthfully receive the
cached-start promise. This inventory and the proposal for an additive shared
composition rule were sent to the parent before implementation; the parent
approved the smallest new shared judgment and reserved both IDs. No artificial
preload gate or production edit preceded the original test runs.

The inventory intentionally excluded service deployment, OS/framework matrices
and a duplicate SDK bucket-state model. It included real SDK execution in Node
and actual Chromium, using the same row judgment, histories and comparison.

## Law, paths and independent judgment

The Direct adapter's public `table` documentation and
`docs/collections/powersync-direct-collection.md` promise every synced row of a
table in each same-table Collection. The public `streams` option permits an
empty array when another Collection syncs the rows. Such a passive Collection
can preload the already-synced table without another remote checkpoint.
The glossary's cleanup law ends one sync run and releases its resources.

The existing eager owner assumes a fresh target without cached rows before
delivery. Its READY-2 model cannot receive passive cached startup by delaying
preload behind a fixture gate. The additive shared composition owner explicitly
states that different premise and reuses `startupRows` for independent complete
source membership. It computes the table union from authored masks. It contains
no copy of SDK stream caches, bucket state, connection logic or listener logic.

The production driver uses two public source Collections on one installed SDK
client/table. HTTP checkpoint input is controlled. The donor syncs first; the
peer joins with either no streams/defaults or a distinct explicit stream.
The driver records joined state before supplying another checkpoint, both
Collections after the complete union, cleanup settlement, and the survivor
after a later complete checkpoint. It forwards and attributes each real SDK
listener/lease allocation at synchronous sync entry and counts exact releases.
Neither expected rows nor artificial readiness gates enter production.

Active peers vary equal, partially overlapping and disjoint row support.
Either active peer can retire. A passive peer can retire while its donor
survives. Retiring the only remote stream owner supplies no later remote-update
premise and is deliberately excluded. The later complete checkpoint can remove
old rows or be empty. Retirement itself does not assert remote row deletion;
the later checkpoint authoritatively omits the retired bucket.

## Original GREEN and calibration RED

Node and actual Chromium each passed **47/47** on unchanged production.
Each uses fixed seed 2377 and a fresh campaign, the same 40-history run budget,
nine randomized construction builders, the same fixed regression and judgment.
The framework's property/seed/path/unit replay applies unchanged.

From `packages/powersync-direct-collection`:

`node ../../node_modules/vitest/vitest.mjs run --coverage.enabled=false --typecheck.enabled=false tests/shared-client-conformance-oracle.property.test.ts`

From `packages/browser-db-sqlite-persistence`:

`node ../../node_modules/vitest/vitest.mjs run --config vitest.adapter-oracles.config.ts --coverage.enabled=false --typecheck.enabled=false e2e/powersync-direct-shared-client-oracle.browser.test.ts`

Both commands used native Node 26.13.1 at
`/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node`.
Logs: `shared-client-node-original.log`, `shared-client-chromium-original.log`.
The first sandboxed Chromium run failed during local-server setup with EPERM
and ran no histories. The authorized local-server rerun passed.

Bound corrupted observations were rejected at `same-table composition`:
passive cached preload still pending, missing peer rows in the table union,
the survivor missing the later checkpoint, and cleanup releasing survivor
resources. These are assertion kills at the intended checkpoint. Nine bound
missing-state controls reject omission under `constructed builder reach`.
No production RED or repair GREEN is claimed for this neighboring family.

## Reach

Minimum one per declared state is enforced by one randomized builder per state.
Each builder returns a fresh object; a WeakMap carries its named obligation
through generated invocations, with one bound missing-state calibration each.
Counts below sum constructed and generated units; fixed histories are excluded.

| State | Node fixed | Node fresh | Chromium fixed | Chromium fresh |
| --- | ---: | ---: | ---: | ---: |
| active-join | 24 | 30 | 24 | 31 |
| disjoint-support | 6 | 10 | 6 | 10 |
| equal-support | 3 | 2 | 3 | 9 |
| first-retired | 10 | 18 | 10 | 16 |
| later-empty | 14 | 12 | 14 | 12 |
| later-omission | 42 | 39 | 42 | 35 |
| partial-support | 15 | 18 | 15 | 12 |
| passive-cached-join | 25 | 19 | 25 | 18 |
| second-retired | 39 | 31 | 39 | 33 |

## Oracle guide account and limits

- ORC-001–003: public authority, independent membership computation and literate
  contract/model/grammar/production driver/comparison reside in named modules.
- ORC-004: the cached peer witness is reconstructed. Removing join loses cached
  readiness; removing retirement order loses first-owner cleanup; removing
  support relation loses union/overlap; removing next mask loses omissions.
  Masks range over three keys including empty later results. Passive donor
  retirement and unknown join kinds are excluded by the grammar.
- ORC-005/006: actual SDK request stream names, sync-run resources and completed
  checkpoint cuts witness the path. Exact row/status/settlement comparisons and
  bound wrong observations establish sensitivity. No source-information gap is
  identified: the cache/checkpoints provide the compared source membership.
- ORC-007: normal fixed/fresh campaigns share all machinery and budgets; direct
  property/seed/path/unit replay is supplied by oracleProperty. No commands.
- ORC-008/009: this is a stateless composition. Join/retirement are authored
  lifecycle actions; row masks are model-only membership encodings, not SDK
  bucket state. The peer mode distinction changes the promised pre-delivery cut.
- ORC-010: withOracleCleanup preserves primary/secondary cleanup diagnostics;
  primitive row/resource observations are copied before final cleanup.
- ORC-011: no concrete shared-fault hypothesis calls for a second formulation;
  independent authored membership directly judges the public table promise.
- ORC-012/013: this record bounds evidence; passive/active joins and
  equal/partial/disjoint support distinguish plausible wrong readiness and
  per-stream filtering policies. Later delivery tests next use after cleanup.
- ORC-014: Node and actual Chromium share the oracle. HTTP is controlled; this
  establishes no deployed PowerSync service, network, worker, OPFS or framework
  claim. The installed SDK supplies all receiving semantics.
- ORC-015/016: nine generated constructions enforce actual-path state reach;
  all nine bound omission controls pass. Only oracleProperty registers tests.
  No ordinary expected-answer examples appear in oracle files.

Other limits: two eager Collections, one table, distinct explicit stream names,
three finite numeric keys, one retirement, one subsequent full checkpoint.
No errors, subsets, arbitrary connection schedules, persistence or mutations.
Exact same-stream lease sharing is already received by the eager gate family;
this family tests different source Collections and cached passive startup.

Scoped TypeScript check and scoped ESLint passed with zero diagnostics.
The parent task owns the coverage-map update and independent frozen review.

## Independent review correction

The first review found an unjustified expectation of exactly one resource of
each SDK kind per owner. The law now quantifies over actually acquired
resources, preserving implementation freedom in allocation kind and count.
Each resource must release exactly once by final cleanup. A second review
refined the cross-owner cut: resources released before peer cleanup are legal.
The driver now records allocation identities and release counts immediately
before that action, and the check requires survivor counts unchanged across it. SDK requests and public table results
supply the positive receiving-path witness. Node and Chromium reruns both pass
47/47, including the same bound resource-release control. `pnpm lint:changed`
also passes. Frozen reviewed files are listed in `shared-client-frozen.sha256`.

## Checked direct guarded replays

Both replay manifest routes executed one exact asynchronous witness, rather
than merely selecting or skipping the file. Native Node 26.13.1 was used for
the guard and its child. From `packages/powersync-direct-collection`:

```sh
TANSTACK_DB_ORACLE_PROPERTY=adapter.powersync-direct.shared-client TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated' node --import tsx ../db/tests/oracle-replay.ts tests/shared-client-conformance-oracle.property.test.ts
```

From `packages/browser-db-sqlite-persistence`:

```sh
TANSTACK_DB_ORACLE_PROPERTY=adapter.powersync-direct.shared-client.chromium TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated' node --import tsx ../db/tests/oracle-replay.ts --config vitest.adapter-oracles.config.ts e2e/powersync-direct-shared-client-oracle.browser.test.ts
```

Each exited 0, with one passed and 46 skipped, and reported the exact property,
seed `2377`, path `0`, `numRuns: 1`, `failed: false`, and `executions: 1` in
asynchronous witness mode. Raw outputs are retained in task artifacts
`.review-2377/shared-client-node-replay.log` and
`.review-2377/shared-client-chromium-replay.log`. Chromium used its authorized
local Vite listener and real host. This is a direct replay at known coordinates,
not a claimed reproduction of a newly found production defect.

## Frozen instrument snapshot

The independent receiving-path reviewer approved this five-file snapshot on
2026-11-17 after verifying every hash and independently passing Node 47/47.
Both resource-law refinements preserve public cleanup/isolation while allowing
allocation freedom. No additional supported path/checkpoint finding remained
inside the declared scope.
Production remains the unchanged reviewed head. The shared page binding is
owned and frozen in the parent portfolio snapshot.

```text
c609e5decc3fc9aca9293855b492156571f13553dcff40c633bb1deac2f278b0  packages/db-adapter-conformance/tests/shared-client-oracle.ts
570282c4516ba5111294dc6366239dbbebd0802a9c81f78d6f14266980055df8  packages/db-adapter-conformance/tests/shared-client-oracle-suite.ts
d9c67665a752a8eae9d4a428b488113c89a4af60b771489455a8469780df4fe0  packages/powersync-direct-collection/tests/shared-client-driver.ts
1c4e87e9220997a5c0cac245c2cc9405bf3735a022dd31cef3f98a6b8f969beb  packages/powersync-direct-collection/tests/shared-client-conformance-oracle.property.test.ts
6c3c64b0107214f90730e756414dc2e234c10533dc1b96ad1db3c255ebb33c21  packages/browser-db-sqlite-persistence/e2e/powersync-direct-shared-client-oracle.browser.test.ts
```


## 2026-11-23 correction: request-scoped subscription results

The [request-fixture review](2026-11-23-powersync-request-fixtures.md) supersedes
this record's same-response subscription-error and SDK checkpoint-event
dependency claims. The real service resolves subscription arguments once per
HTTP request. Transient delivery failure interrupts transport, and SDK 0.1.1
already exposes recovery on an unchanged empty successor checkpoint. Historical
commands and verdicts above retain their original scope and premises; they do
not establish a missing SDK event for a legal service history. The corrected
eager and shared-client receivers preserve recovery and distinct-error checks
through actual successor requests. Node Map compatibility remains a separate
SDK concern.
