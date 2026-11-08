# Boundary-only metadata and nested-query performance

This implements the maintainer's 2026-11-05 choice: **intermediate callbacks
and inline results retain authored fields; published Collection rows retain
genuine computed metadata**. It supersedes the October 28/30 callback-view
normalization decisions. The [policy exploration](2026-11-05-metadata-policy-exploration.md)
records those decisions, the issue/PR history, rival predictions and prototype
measurements. This record describes the implementation on base
`8feab6ea3eaae4456f738da39fa93508ddd5cc01`, with the source binding below.
No commit or pull request has been published for this work.

The subsequent [prep-review record](2026-11-05-boundary-only-prep-review.md)
records additional attribution, include-transport and public-type repairs.
Measurements, source hashes and verification below describe this earlier
implementation snapshot; the subsequent record binds the reviewed revision.

## Law, experiment and inference

For an authored intermediate `{ id: 1, $collectionId: 'application' }`,
`fn.select`, `fn.where`, `fn.having`, inline children and Effect output retain
`'application'`. An actual Collection publication supplies genuine row metadata.
Direct source rows already have genuine metadata. Structured source selections
and spreads preserve source attribution; functional selections preserve it
only by returning that source row directly. An explicit override is data before
publication and cannot forge publication attribution. Private compiler state
must remain absent from public callback values, including `$selected` context.
Authority: the explicit maintainer choice and the revised
[live-query architecture](../../../packages/db/src/query/live/ARCHITECTURE.md).

The independent input model predicts values from source facts and authored
syntax. It does not read compiler provenance. The existing grammar retains
all projection/collision combinations, seven recursive/join/union placements,
select/where/having variants, four receivers, shared/separate cache orders and
four Collection timeline cuts. Real Effects additionally check every delivered
value/previousValue, exit/reentry and post-disposal silence. Both Collection
and Effect receivers ran before production edits. Predicate membership now
follows the authored value, so a publication-only repair cannot hide an earlier
wrong input. Nested values remain strict.

The work owner independently expects the authored document and its identity
at preload and two synced replacements. Fourteen direct/correlated paths cross
0–40 blocks; fixed examples cover 0, 1, 20 and 40. Fixed seed 2355 and a fresh
random campaign each run four examples plus eight generated inputs: **336 path
histories and 1,008 public checkpoints**. Both singular and batch descriptor
APIs count visits inside known source payload containers. No comparison
excludes nested reserved application fields. This measures a specific compiler
work budget, not all possible traversals or elapsed latency.

Before production changes, the revised input owner rejected **4,106 of 4,923
checks**. All **20,720 callback**, **594 inline/rejection** and **1,188 compiler**
reach states executed once. Expanded work histories rejected all six initially
added paths, even with empty documents: 2/2/6/12/6/6 scans, expected zero. A
later valid grouped-HAVING witness rejected two scans before its repair. An
initial grouping fixture without `groupKeys()` was a setup failure, not RED.

The implementation transports one authored value per occurrence. A small
namespace sidecar carries source attribution and include routing; source
payloads stay opaque. Materialization compiles resolvers for declared include
paths instead of discovering private state throughout documents. Changed-path
copies preserve descriptors, prototypes and user symbols. Generic manual
adapter callers keep the descriptor-preserving recursive walker.

Compilation retains three cache roles: authored root, published Collection and
intermediate source. Sharing value semantics does not permit sharing movable
windows. Existing ordered-cache tests rejected that accidental sharing before
repair; aggregate QueryRef tests likewise rejected loss of the generated
missing group key. Both neighboring contracts remain enforced.

## Type boundary

The primary public type owner generates native TypeScript consumers from 24
source descriptions. New dimensions cross six reserved-field collision forms,
four QueryRef/join/union paths and structured/functional authoring: **48 new
states**, each reached **24 times**. They judge actual contextual callback,
inline and published Collection types through one independently declared shape
law, including exact keys and readonly/optional modifiers. Eighteen generated
grouping/collision neighbors also reach 24 times each, preserving generated
missing keys while retaining explicit authored keys. Public construction runs
before the compiler comparison to reject illegal query syntax.

The extended owner failed **24 consumers**, with nine passing controls, before
production type edits. The repair separates authored QueryRef/inline types from
published types and replaces reserved fields on publication instead of
intersecting incompatible authored types into `never`. Grouping context tracks
explicit groupBy and visible aggregate selections. The type changes erase to
identical JavaScript; they do not change the measured runtime.

This is source-public inference evidence. Built declarations are also checked
by the normal package build; installed npm resolution and framework handler
inference are separate paths. Group-key inference from a fully wrapped
aggregate whose expression type erases aggregate provenance is outside this
finite type grammar; the coverage map retains that concrete inference limit.

## Additional recorder gap

A final public probe found `Symbol(rowMetadata)` under a flat union's HAVING
`$selected`. The recorder had ignored symbols and removed that documented
context field before judging source values. It now records symbols at both
known roots before the context omission. These fixtures author no symbols;
user-authored symbol fidelity remains covered by the container/context owners.
The unchanged implementation failed **198 checks**, with 4,725 passing. Cleaning
only the known `$selected` root makes the input/work run pass **4,970 checks**;
it adds no recursive payload discovery. A hostile symbol observation is rejected
by the shared comparison. This was an enforcement gap, not another law change.

## Verification and calibration

From the worktree root, the principal commands are:

```sh
pnpm --dir packages/db exec vitest run --coverage.enabled=false \
  tests/query/virtual-row-fields-input-oracle.test.ts \
  tests/query/includes-work-counter-oracle.test.ts
pnpm --dir packages/db exec vitest run --coverage.enabled=false \
  tests/query/virtual-row-fields-types-oracle.test.ts
pnpm --filter @tanstack/db build
node --test scripts/bench/compare-incremental-update.test.mjs
pnpm lint:changed
```

The broader runtime run includes publication and Effect metadata, context
transport, functional projection/rejection, container copies, aliases, query
shapes, cross-formulation, space, facade publication/rollback, ordered work and
lifecycle, includes state/Collection/optimistic/temporal/publication, and
subquery/aggregate values. The final run passes **9,652 checks in 23 runtime files**, and the native
public-type owner passes **33 checks**. The normal declaration build and a
source-only TypeScript check pass. An extra whole-package `tsc --noEmit` attempt
exhausted Node’s default 4GB heap; it supplies no successful whole-test-tree
typecheck evidence. `pnpm lint:changed` passes, as do the 19 gate CLI checks.

Hostile semantic normalization of intermediate results caused **4,222 assertion
failures / 4,923 checks**. Restoring recursive callback cleanup rejected seed
2355/path `0` on **all fourteen work paths**, with counts
2/2/4/2/2/4/6/6/6/8/10/8/8/10. These are assertion failures at the promised
checkpoints, not timeouts. Sources were restored byte-for-byte after each
mutant. Restoring type enrichment on intermediates fails the shared native shape
constraints on a generated consumer. Removing only the selected-context cleanup
fails **198 of 4,924 input checks**, with 4,726 passing. Both final mutants were
restored byte-for-byte and rejected by assertions, not setup failures.

Scratch evidence is in `/tmp/db-boundary-only-implementation-2026-11-05`:
`red.log`, `work-red-all.log`, `group-red-valid.log`, `type-group-red-valid.log`,
`selected-symbol-red.log`, the GREEN logs and hostile-mutant logs. The earlier
lossless issue ledger and raw issue/proposed diff are in
`/tmp/tanstack-db-perf-2355-2026-11-05`.

## Measurements

The [whole-suite table](../../../scripts/bench/boundary-only-suite-2026-11-05.csv)
and [correlated probe table](../../../scripts/bench/boundary-only-metadata-2026-11-05.csv)
retain every repetition. Sequential runs use Node 24.19.0 on Apple M5 Max,
100 measured writes after 20 warmups, and three fresh fixtures. Pre-2312 DB
sources are `035a5260`, using the same current db-ivm and dependencies. This
isolates DB source behavior; it does not recreate a historical installation.
Final type edits have identical erased JavaScript. The later selected-context
cleanup changes only HAVING callback sanitation, which these timing scenarios
do not use; its work evidence is separate.

Across the full suite, candidate/pre-2312 geometric means are **0.88× writes,
0.91× cold** and the comparator passes. Nested-document query means are
**0.913× writes, 1.019× cold**. At 10,000 documents without manual indexes:

| Mode | Pre cold / write ms | Boundary-only cold / write ms |
| --- | ---: | ---: |
| Synced | 80.188 / 0.026125 | 87.299 / 0.024250 |
| Optimistic | 69.489 / 0.160791 | 65.747 / 0.145750 |

Ten-child, 200-block correlated probes:

| Path | Pre cold / write ms | Boundary-only cold / write ms |
| --- | ---: | ---: |
| QueryRef predicate | 0.335 / 0.03521 | 0.480 / 0.04088 |
| Correlated inline | 7.586 / 3.9598 | 0.889 / 0.7110 |
| Correlated QueryRef callback | 15.143 / 5.7103 | 5.246 / 1.5084 |

Counting both descriptor APIs at 0/20/200 blocks, correlated inline changes
from **8/408/4008 to 0/0/0**; correlated callbacks from
**16/816/8016 to 0/0/0**. The ordinary QueryRef-predicate pre-2312 and repaired
paths both count zero. Some fixed timing costs remain. These measurements do
not establish that every query is faster or that metadata has zero latency.

The [CI study and gate](../../../scripts/bench/README.md) compare candidate and
base with the exact same harness on one runner. Three repetitions support
per-query +30% write/+50% cold gates and a persistent localized regression gate.
All ten historical same-runtime paired jobs pass the new comparator; its
19 CLI controls pass. Actual remote runs of the new repetition policy remain
unobserved, so future noise calibration is still required.

The final minified comparison against HEAD adds **426 gzip bytes / 384 brotli
bytes** to DB; the typical app adds **16 gzip bytes**, and the includes scenario
adds **361 gzip bytes**. These are shipped-byte comparisons; oracle and report
source growth does not enter the runtime bundle.

## Oracle applicability and limits

ORC-001–003: authority, independent models and literate responsibilities are
in each owner. ORC-004: collision names distinguish ordinary authored data from
genuine publication; path/kind/receiver ablation loses named boundaries; zero
and maximal block counts distinguish fixed work from payload scaling. Legal
examples reconstruct the issue and the newly found QueryRef/correlated paths;
compiled Collection-valued functional inputs remain rejected neighbors.
ORC-005/014: real Collection and Effect receivers supply their own observations;
no provider or framework schedule is inferred. ORC-006/013: hostile originals,
zero/nonempty documents, authored/no-collision and direct-source neighbors
calibrate the relevant comparisons. ORC-007: fixed/fresh campaigns share the
same work property and budget; direct seed/path replay is preserved. The type
and metadata matrices are exhaustive finite grammars. ORC-008/009: the input
model's snapshots abstract a value, not a published row; sidecars/cache roles
are production representation, not independent-model state. ORC-010: reports
accumulate comparisons before cleanup; existing cleanup preserves primary and
secondary failures. ORC-011: no additional shared-semantic-fault hypothesis
requires another model; literal authored expectations and independent native
shape judgments check different boundaries. ORC-012/015/016: this versioned
record binds sources, reach is mandatory and measured, and retained examples
use each owner's shared model/driver/check. Supplemental copy tests remain
ordinary tests.

The bounded claim covers authored intermediate metadata, genuine publication
in the exercised histories, and zero compiler metadata descriptor visits inside
source payloads along fourteen paths. It does not bound hashing, user getters,
proxy traps, arbitrary callback work, provider delivery, framework scheduling,
unbounded recursive query shapes, or every possible traversal algorithm.
Generic/manual adapter traversal remains recursive. No universal throughput or
zero-latency proof follows from these instruments.

## Loss audit and readiness

The raw issue and proposed scan were re-read after implementation. R1–R5 from
the [original audit](2026-11-05-nested-row-performance.md) remain **5 fixed-now**;
their performance, missing benchmark and CI-noise destinations are retained.
The scan's getter/named-array-property defects remain rejected by supplemental
controls. Sibling cache-window, generated-key, static-boundary and
selected-context recorder defects are repaired as described above. The policy
change is **accepted-design**, authorized explicitly by the maintainer.
No issue finding was dropped or deferred. Reviewer assessment remains **hire:
yes** for accurate diagnosis/reproduction; the proposed scan was unsuitable
under the descriptor and payload-work contracts.

Local verification supports review of this working change. Whole-PR readiness
and the unrelated #2312 ordered/replay/framework changes are separate verdicts;
this audit does not approve every law or implementation in that PR. No remote
CI run or merge readiness is claimed.

## Source binding

Base HEAD: `8feab6ea3eaae4456f738da39fa93508ddd5cc01`. The 22 changed
production/test/harness/workflow files below bind the final verification.
The SHA-256 of this sorted map, serialized as compact JSON, is
`529c1a9150e1749d6443f56f1aed02e7507236829c4ae012d530df8fb5955c18`. Documentation and measurement CSVs are versioned alongside it.

```json
{
  ".github/workflows/benchmark.yml": "d2afcf4978c6207359330a8e415cacc283e73dab053eb4ed4128052f8bfe0cfe",
  "packages/db/src/query/builder/index.ts": "2714cebb29ba8ef5539878f2af031d2b19e463beb1ed7e12ace0442f1c8592c8",
  "packages/db/src/query/builder/types.ts": "5b3cb8e4a6ca8f62698ef9df02aab7f2edec791a3075961afae0a8be6656c422",
  "packages/db/src/query/compiler/group-by.ts": "a0aa4b061811b1fbdbf7409b156869e987504814ddfa838c6537f513db94adcb",
  "packages/db/src/query/compiler/index.ts": "b1365ff05f8db1702b4d9f1ca6f82aee9c3c85a5207dff5dbc9551c403f2e6d6",
  "packages/db/src/query/compiler/joins.ts": "2b09980feb7f1ef6cbdcd85ed1fb0d618ec8a0120beffa86a2c636c516d8f252",
  "packages/db/src/query/compiler/route-metadata.ts": "ff527255b91c1e2d4edcec3395170d728b6fd7ce8207175d472dd3668f32fec1",
  "packages/db/src/query/compiler/types.ts": "922a89c5eba805130f2c082e934c0829593b31c335a4cb2a4983aa1559447ad5",
  "packages/db/src/query/live/bucket-facade-adapter.ts": "fe1023e2558711161f4625d6e8b57f12419816f471b0c4e0b4c3cb6a6ae22c2d",
  "packages/db/src/query/live/collection-config-builder.ts": "0f90dd5d33fa58a7aedd42e1e6e40427d8c22a614849cb8e6df05c3ef8b91cc2",
  "packages/db/src/query/live/materialized-pipeline.ts": "d1f957fbd8c6a367eb885e3c1210b8ad700c24b5846be84550d0099009acdb84",
  "packages/db/src/virtual-props.ts": "b06e07f9fe58b1ef94b4b02b4903562cd6cbb4798f1f0789c2ffe607fb501368",
  "packages/db/tests/oracle-config.ts": "aaeb58ca13be9fb4a0797a3caacb8d79441b00fdd692f2993987d0a8770f9e9b",
  "packages/db/tests/query/includes-work-counter-oracle.test.ts": "9f1315d81e6512c14e1dda80ae751e6f41fff33f0f86e053649de14388d6db1e",
  "packages/db/tests/query/public-container-copy.test.ts": "71f24aeb92a8f7345e7be5d5989f55deccf8b07571eb71960709ee73e2210a8a",
  "packages/db/tests/query/virtual-row-fields-input-driver.ts": "caac0baded4371fee584da840bc1fe29333df55676cd3cf5b0d431fe1e08b366",
  "packages/db/tests/query/virtual-row-fields-input-oracle.test.ts": "a9afe03de7d604011ef29bbae8d54cceb8c0ae3f65a9ae5c1691beb914231603",
  "packages/db/tests/query/virtual-row-fields-input-oracle.ts": "64c0e1c0746fd26fc546977bba86c0edc5321311d1be87c636beb5c038336604",
  "packages/db/tests/query/virtual-row-fields-types-oracle.test.ts": "5b5e275da1431c804347f42970bfafa7e4230c68d7294963b84953fecb1b7e1b",
  "scripts/bench/compare-incremental-update.test.mjs": "87870408b5df7f822d93bfafe61b4e4aba54da53b1a86f5494c75b657c629e31",
  "scripts/bench/compare-incremental-update.ts": "69b8a1515801bc99d13f5dfff9ac9f3569d4dda2b5678e57a787d703708320dd",
  "scripts/bench/incremental-update.ts": "3f50520ad800f861b585175c32f04a267a875ff9ca71595af7d1ff863b74dad2"
}
```
