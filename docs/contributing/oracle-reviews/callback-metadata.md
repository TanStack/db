# Callback metadata runtime repair

The accepted callback-input law applies before user JavaScript derives a value.
Direct source returns and structured whole-source spreads expose genuine
`$key`, `$origin`, `$hasPendingWrites` and `$collectionId`. New projected shapes,
including functional spreads, expose none of these reserved fields to downstream
callbacks. Inline include values retain their authored shape. Compiled
Collection-valued callback inputs reject before user code runs.

Authority: the maintainer's O12 decision from 2026-10-28 and the
[architecture's callback-input boundary](../../../packages/db/src/query/live/ARCHITECTURE.md#route-context-transport).
The original repair enforced the selection-input law. The maintainer extended
it to functional predicates on 2026-10-30, as recorded in the nine-finding
review below. Earlier evidence in this record describes the historical repair.
The [coverage owner](../oracle-coverage.md) retains the separate static type gaps.

## Independent owner and receiving histories

The restored owner consists of the
[model and grammar](../../../packages/db/tests/query/virtual-row-fields-input-oracle.ts),
[production driver](../../../packages/db/tests/query/virtual-row-fields-input-driver.ts)
and [runner and controls](../../../packages/db/tests/query/virtual-row-fields-input-oracle.test.ts).
It derives expectations from authored source facts and projection syntax.
It shares the source metadata law with the existing publication owner.
It imports no compiler metadata classifier for its expected result.

Thirty-three legal shape/collision descriptions cover five projection forms,
no collision, each reserved name, all names, and both authored pending booleans.
Direct source returns admit no authored override. Seven QueryRef/join/union
paths run at root and through a wrapped correlated child: 231 histories each.
Five paths also run directly as the correlated child: 165 histories. Flat union
children have no named source reference for include correlation, so their
supported forms use the wrapper or union-query-ref path. They remain covered.
Three direct-source controls, 132 inline array/materialized histories, 66 compiled
Collection rejections and 19 checker/recorder controls form 847 tests. Inline
values cross direct and QueryRef paths. The QueryRef path correlates each parent
with one typed-key child, so it preserves authored child fields without a child
functional callback. A later low-level compiler receiver adds 132 histories,
bringing the owner to 979 tests. Its separate initial graph-drain cut is
described below.

Each Collection receiving history observes initial readiness, a held optimistic update,
settlement without confirmation, and a later remote update. Source rows have
numeric `1` and string `"1"` keys and distinct labels. Each callback copies its
input immediately, then returns that capture as ordinary output. The comparison
checks every callback against coherent before/after source facts and checks the
complete derived output at each established cut. Retractions may read the old
row. Startup LEFT joins may expose an absent joined side. Neither exception
permits mixed old/new fields or missing peers at the established output cut.

Reserved fields promise readable presence/value, without a descriptor layout.
Ordinary own undefined and authored nested inline properties retain exact shape.
Failures accumulate through later cuts. Cleanup preserves the primary mismatch
and attempts every resource release. The model retains source facts, not a
second compiler or query queue.

## RED before production edits

The production baseline was `c351fc04d7f70dc59bf92ecbed310f899b9511cd`.
The three original owner files were restored from accepted source tree
`db38b4e009146af53e46aeeef3206269f5968af8` before any compiler edit.
The original 580 tests reproduced 203 correlated-child failures and 377 passes.
All 2,153 original reach states reached once.

The direct child receiver was then added on unchanged production. The complete
746-test owner produced 348 comparison failures and 398 passes. Root controls
and inline authored values passed. Wrapped children contributed 203 failures;
direct children contributed 145. All 2,520 callback and 297 inline/rejection
states reached once, including later cuts after the first violation.

Two representative distinguishing traces are retained by the executable grammar:

- `inline-child/query-ref/functional-projection/$collectionId/false`, initial:
  the projected callback input exposed authored `$collectionId: "spoof-$collectionId"`.
  The model requires that field to be absent. The ordinary derived capture
  preserved this earlier violation through final publication.
- `inline-child-direct/joined-source/structured-spread/all/true`, initial:
  the callback input exposed authored pending `true`, origin `local`, and spoofed
  key/Collection ID. The genuine source was remote, pending `false`, with numeric
  key `1` or string key `"1"` and Collection ID `callback-first`.

The first setup attempt lacked `fake-indexeddb/auto` because the new worktree
had no package dependency link. It ran zero tests and supplies no RED evidence.
Early direct flat-union fixtures failed correlation admission. The legal grammar
uses a named QueryRef for those unions. Neither setup failure counts as a defect.
No comparison, reach minimum or run budget was weakened to obtain GREEN.

## Repair and discriminators

The first repair enabled source/projection metadata mode at every recursive
QueryRef and joined source. A neighboring-path probe found that this was too
broad: an inline child with a QueryRef, but no functional callback, lost its
authored reserved fields. The existing inline grammar used direct children only.

Before another production edit, the inline grammar added QueryRef consumption
across all shapes, collisions and materialization forms: 99 more histories.
The first repair then failed 58 shared callback/output comparisons and passed
787 tests. For example, `query-ref/array/structured-projection/$key/false`
lost the child's authored `$key: "spoof-$key"` at the initial callback capture.
The unchanged baseline compiler passes all these inline histories and still
fails the original 348 callback comparisons: 497 passes out of 845 tests.
These runs distinguish both accepted laws before the corrected repair.

The corrected repair requests source/projection metadata mode when the local
query has a functional selection, or when the enclosing query already requires
Collection publication mode. It passes that mode into FROM and joined-source
compilation. An inline-only QueryRef retains its authored selected shape.
Existing mode parameters and propagation remain. That repair changes two
call sites. The later cache repair below separates their compiled results by
mode. Neither adds a metadata registry, traversal or public API.

The pre-review head passed all 845 tests. Every one of the 2,520 callback and 594 inline/rejection
states reaches once. Seven neighboring suites pass 1,883 tests: root metadata,
functional projection/input rejection, route-context transport, public container
copying, include query shapes and subquery user values. Focused no-emit TypeScript,
ESLint and changed-file oracle lint pass. The normal package pnpm configuration
also passes all 845 owner tests after integrating #2301
(`bfd1da1a7e752d66fd667adfd3cdf54f60732b22`). No local build or installation ran.

Three wrong repairs ran sequentially in copied source trees before the
independent review. They did not change the reviewed worktree. These counts use
the 845-test owner at `a30256cfb`, before the two added recorder calibrations:

| Mutant | Intended wrong design | Result at the shared comparison |
| --- | --- | --- |
| QueryRef-only | Keep the old joined-source mode | 58 failures, 787 passes |
| Sanitize inline | Sanitize every final child instead of preserving authored inline values | 116 failures, 729 passes |
| Unconditional sources | First repair, ignoring whether a callback consumes the rows | 58 failures, 787 passes |

Every failure is a `MetadataCallbackOracleFailure` at the intended input/output
comparison. No mutant timed out or failed setup. The original 348-failure RED
rejects the original defect. Direct receivers distinguish an unrepaired joined
source, and the expanded inline paths reject both blanket sanitization repairs.

## Prep review and loss audit

The initial read-only review and simplification passes found stale opening
counts and required coverage/architecture updates. They missed the inline QueryRef
regression found by the later neighboring-path probe. That gap required the
grammar extension and corrected repair described above.

A proposed shared-query cache conflict was tested through actual Effects and
live-query Collections. Each receiver reused one projected query through a
QueryRef, then through both union branch orders. All six probes passed on both repairs: the
nested callback saw no `$collectionId`. The direct Effect branch retained its
authored reserved output, which is separate from downstream callback input.
The initial Collection-union fixture supplied conflicting custom public keys;
using the compiler's union keys corrected the fixture. Those initial failures
establish no product violation.

The probe constructs the following source and nested consumer before selecting
QueryRef-only, `unionAll(projected, consumed)`, or its reverse:

```ts
import { createCollection, localOnlyCollectionOptions, Query } from '@tanstack/db'

const source = createCollection(localOnlyCollectionOptions({
  initialData: [{ id: 1 }],
  getKey: (row: { id: number }) => row.id,
}))
const captures: Array<{ present: boolean; value: unknown }> = []
const projected = new Query().from({ source }).select(({ source }) => ({
  id: source.id,
  $collectionId: 'spoof',
}))
const consumed = new Query().from({ nested: projected }).fn.select(({ nested }) => {
  captures.push({ present: '$collectionId' in nested, value: nested.$collectionId })
  return { id: nested.id, observed: nested.$collectionId }
})
```

Each of the six runs entered the callback once and captured
`{ present: false, value: undefined }`. This refutes that concrete cache
hypothesis. It is no universal cache proof or generated Effect lifecycle claim.
The source-level review distinguished final inline/Effect values from callback
input. Its finite probes supply useful cross-path evidence. The reviewers did
not independently rerun the full owner or mutation campaign.

The initial four review items and the new inline finding reconcile as three
fixed items, one duplicate count correction and one refuted cache hypothesis.
The new finding retains both its first-repair RED and corrected GREEN evidence.
Initial reviewers provided useful documentation and cache analysis, but their
missed inline path limits confidence in their completeness. The final independent
review and simplification pass found no new defect or useful code reduction.
The reviewer also ran two inline LEFT-join controls without a child callback:
one selected QueryRef on FROM, the other on the joined side. Both selected the
whole projected child into `toArray()` and retained authored
`$collectionId: "authored"` after preload. These are supplemental initial-cut
controls, not generated lifecycle coverage. Their repeated documentation notes
link to the original count item, giving seven raw items: three fixed, one
refuted and three duplicates. Neither review supplies a whole-library verdict.

## Independent oracle review after PR creation

Four subagents used the repository oracle-review skill on
`a30256cfbaf99138f274db224362325c37ea1da4`. They independently challenged laws,
grammar/reach, driver/comparisons, and mutation/process evidence.

The law review confirmed a historical process gap: the first pre-edit receiving
inventory omitted inline-only QueryRef preservation. That path was added after
the first production repair. The later baseline run cannot satisfy the initial
gate retrospectively. The corrected production edit did have the expanded RED
before its edit. This record preserves that distinction and claims no complete
initial-gate compliance.

The driver review found a recorder blind spot. `Array.map` copied inline array
entries but dropped named own fields. An ordinary `Object.assign(children,
{ unexpected: "spoof" })`, or its `$collectionId` counterpart, remained publicly
readable but disappeared from capture. Both shared judgments accepted it.
This was a confirmed test-integrity defect, not a reproduced production defect.

Two new calibration cases ran before the recorder edit. Both failed because
both judgments returned false for rejection. Capture now preserves named own
string fields recursively as well as array entries. `Object.defineProperty`
avoids setter traps. The expected model and both judgments are unchanged.
All 847 owner tests pass: the existing 845 plus two recorder calibrations.
All 2,520 callback and 594 inline/rejection states still reach once. Restoring
the old recorder is the demonstrated wrong design: both new calibrations fail.
The reviewer inspected the fix and found that it closes the reported gap.

The mutant reviewer independently omitted only the FROM callback-mode change,
leaving joined-source handling intact. On copied sources at the reviewed head,
290 comparisons fail and 555 tests pass. The first distinguishing history is
`inline-child/query-ref/structured-projection/$key/false`, initial: the callback
reads authored `$key: "spoof-$key"` where the model requires absence. Every
failure is `MetadataCallbackOracleFailure`; an earlier configuration EPERM ran
no tests and supplies no evidence. This supplements the three mutants above.

The grammar review independently reconciled all 845 original tests and the
per-receiver reach matrix. Flattened child output does not prove parent-child
route placement. It retains every child's metadata capture, typed key and
occurrence count; those reviews found no hidden metadata violation from that
flattening. Parent routing remains owned by the separate include oracles.

The review accounts for two findings: one repaired recorder gap and one
historical gate miss preserved above. No current production defect emerged.
The source-only law and grammar reviews supplied useful independent reasoning.
The driver review supplied an executable false-green witness and a reviewed
repair. The mutant review supplied an additional independent discriminator.
These results support the finite runtime boundary, not a whole-library verdict.

CI also rejected this record's query example because its source was untyped.
The example now declares its typed source and capture array. Its focused
snippet typecheck passes without a baseline exclusion. That mechanical docs
repair is separate from the two oracle-review findings.

The full local snippet scan reports 12 failures in unchanged examples and one
stale baseline entry under the reused dependency tree. The earlier CI scan
reported only this record's example as a new failure. No dependency install or
baseline exclusion was used to mask that local environment difference. Full
final-head snippet verification then remained for CI. CI on `9bd623cd5`
subsequently passed its full scan: 805 examples, zero new failures, with the
existing baseline unchanged.

## Shared compiler-cache receiving boundary

CodeRabbit review `5715750975` on `9bd623cd5` identified a missing cache premise.
The exported `compileQuery` accepts raw QueryIR and an optional cache. Existing
`compiler/subquery-caching.test.ts` controls reuse that cache across calls on
one graph. Cache reuse must preserve the accepted callback-input law and the
authored selected output that separate compilations produce.

Reusing a QueryBuilder alone did not reach this premise. Ten Effect/Collection
builder probes and two single-root raw-IR probes passed; placement clones or
optimizer lineage gave them distinct effective raw queries. Two compilations
on the same graph/input streams and exact selected QueryIR do reach it:

| Compilation order with one cache | Wrong public observation | Required observation |
| --- | --- | --- |
| Authored selected root, then downstream callback root | The callback reads `$key: "spoof-$key"` from a structured projection | Reserved fields are absent before the callback |
| Downstream callback root, then authored selected root | The selected output loses authored `$key` | The selected output retains `"spoof-$key"` |

Separate-cache neighbors pass both orders. The defect was reproduced again
without compiler instrumentation. Earlier scratch shape/literal fixture
mistakes and a diagnostic setup error supply no defect evidence.

Before production edits, the primary owner added 132 histories: the existing
33 source/projection/collision descriptions, both compilation orders, and
shared/separate caches. Actual public source rows retain numeric `1` and string
`"1"` peers. The existing independent model judges immutable callback captures,
ordinary derived output and raw authored selected output. Signed-bag recording
retains duplicate contributions and retractions. No expected answer comes from
the separate-cache implementation. All three comparisons run before failure.

Unchanged `9bd623cd5` production gives 953 passes and 26
`MetadataCallbackOracleFailure` comparisons out of 979 tests. All original
847 tests pass. All 396 new compiler states and all 3,114 prior states reach
once. The driver checks initial graph drain only: its authored-output judgment
is a low-level compiler boundary, not a new real inline include or optimistic
lifecycle witness. Two independent source reviews found no additional defect
in the grammar, recorder, comparisons or proposed cache key.

The repair retains a result per publication mode under each raw QueryIR key.
Uncorrelated-only admission and same-mode reuse remain. The graph's shared
value-identity scope remains the same. All 979 owner tests pass afterward,
with every one of the 3,510 reach states reached. The original cache is the
hostile wrong design rejected by the 26 REDs. It can be reconstructed by
restoring `QueryCache = WeakMap<QueryIR, CompilationResult>`, lookup with
`cache.get(rawQuery)`, and storage with `cache.set(rawQuery, compilationResult)`.
No model rule or comparison changes between RED and GREEN.

Normal package configuration passes all 3,170 targeted tests across ten files,
including this owner, the eight compiler-cache controls, the Effect metadata
owner and the seven neighboring suites named above. Focused no-emit TypeScript,
ESLint, formatting and whitespace checks pass. A temporary RED configuration
only redirects Vite's cache around the reused dependency symlink permissions.
Its jsdom setup, source aliases and shared comparisons are unchanged. The
package-configuration setup failure ran no tests and is excluded.

This closes the recorded cache-mode violation within the 132 histories and
their initial cut. Arbitrary raw-IR shapes, independent graphs, later input
updates and construction failure need separate evidence. The historical
initial receiving-inventory miss remains documented above.

## Rubric accounting and limits

ORC-001–005: accepted authority, independent source facts, literate layers,
finite legal grammar, real callback captures and exact derived output cuts.
Removing receiver, callback path, inline path, cache sharing/order, collision, pending boolean or checkpoint loses a
named source/projection/inline distinction. Both populated union positions and
both typed keys remain represented. Direct-source controls distinguish a
blanket stripping rule. The rejected flat-union form bounds admission.

ORC-006: 19 hostile observation/recorder controls, the three recorded production
mutants, the independent FROM-only mutant and the original wrong cache.
ORC-007: exhaustive finite enumeration, so random campaigns and seed replay do
not apply. At the pre-review head, a valid unrelated `utils.1` seed/path run passes all 845 tests with
all reach intact. A calibration-only selection passes 17 controls without
entering a receiver. Selecting only the three direct-source controls fails the
missing-matrix reach assertion. An omitted replay property was a configuration
error with zero tests, not product evidence. ORC-008–009:
source facts distinguish coherent retractions; callback input is distinct from
published row, with that abstraction stated beside the model. ORC-010: all-cut
failure reports and failure-preserving cleanup. ORC-011: builder probes missed
the exact raw-query/cache identity premise. The low-level receiver now reaches
that premise in both orders and rejects the wrong cache. ORC-012: this
versioned record and source fingerprints below.
ORC-013: single/all/no collisions, typed peers, source/new/inline forms and the
three mutants distinguish plausible shortcut repairs. ORC-014: the declared
boundary is core runtime compilation, with no real-provider/framework timing
claim. ORC-015: every named callback, inline/rejection and compiler state reaches once.
ORC-016: all histories and controls use the shared independent judgments.

The runtime evidence is finite: flat inline children, at most two QueryRefs,
one LEFT join, two typed-key peers, one held successful mutation, and four cuts.
The separate low-level cache receiver uses one graph and initial graph drain.
Arbitrary descriptors/prototypes, deeper recursion, same-key overlapping writes,
other join kinds, truncate, framework/provider scheduling and construction-failure
cleanup remain outside it. The deferred static metadata receivers and literal
value/type defects remain open in the [retained record](2026-10-29-pr-2171-deferred-oracles.md).
This runtime repair does not claim complete static or P11/P12 closure.

## Reproduction and reviewed sources

From the repository root, run this targeted owner without a build or install:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 pnpm_config_verify_deps_before_run=false \
  pnpm --dir packages/db exec vitest run --maxWorkers=2 \
  --coverage.enabled=false --typecheck.enabled=false \
  tests/query/virtual-row-fields-input-oracle.test.ts
```

The source fingerprints identify the reviewed implementation independently of
later prose edits. The parent baseline and exact legal grammar reproduce the
original failures without temporary log files.

| Source | SHA256 |
| --- | --- |
| `packages/db/src/query/compiler/index.ts` | `a00931f51624d31b4ee749a741fdea30289344a63309b5e2b48b44ee00b913c2` |
| `packages/db/src/query/compiler/types.ts` | `7a8244358fea67f64dac84215adcc079aba4188977b2eb628673632b15c40be6` |
| `packages/db/tests/query/virtual-row-fields-input-oracle.ts` | `d0d526479dda63a01906bcb377675120386e02fe26720ebc7b2c3b7b6e57e658` |
| `packages/db/tests/query/virtual-row-fields-input-driver.ts` | `b24f421e3f5126078d7103ba6ba6a9d7bdd90251c1b4b69ca55e57c020e10292` |
| `packages/db/tests/query/virtual-row-fields-input-oracle.test.ts` | `22f075260e1ff8be769409a12b39ce51436c19936d47324d9f866260ab40cfcc` |

## Nine-finding review and predicate extension (2026-10-30)

Reviewed production: `5ba869f0fc8398243a45a923828b717f0050f40a`.
The implementation and executable evidence below supersede the historical
selection-only counts and source bindings above. The raw nine-item review and
append-only working ledger remain in
`/private/tmp/callback-metadata/nine-issue-review-2312/`.

### Law, experiment and inference

The original O12 decision named fn.select. Later architecture prose claimed
functional callbacks generally. The maintainer resolved that conflict on
2026-10-30: extend the input law to select, where and having, while preserving
authored inline output. This is an explicit contract extension. The earlier
selection owner enforced its narrower law but could not generate predicates.

Direct source rows and structured whole-row source spreads retain genuine
reserved metadata at each source-input callback. A projection with its own
shape exposes none. Callback evaluation must not rewrite the authored result
that an inline child exports. The callback owner derives both views from
independent source facts and projection syntax. Functional predicates actually
derive membership from their captured input, so a spoof can change output.
Predicate-with-selection controls distinguish placement from callback syntax.
Grouped HAVING evaluates its selected group context rather than a local source
namespace; this extension does not revise group attribution or arbitrary
user-created selected-context semantics.

The extended finite owner has 4,923 tests: 4,290 receiving histories, 20 direct
source controls, 198 inline/rejection histories, 396 compiler histories and 19
checker controls. The receiving paths are root Collection, wrapped inline
child, direct inline child and real Effect. Each checks initial readiness,
held mutation, settlement and remote next use. Effects also check exit,
reentry, both event channels, every value/previousValue, event continuity and
post-disposal silence. LEFT-join absence has its own model observation.

The final pre-edit predicate gate produced 1,102 MetadataCallbackOracleFailure
comparisons and 3,821 passes. All 20,720 callback, 594 inline/rejection and 1,188
compiler states reached once. Initial recorder attempts incorrectly framed
absence and the flat union's `$selected` context. Those setup/evaluation errors
are retained separately and do not supply production RED. Reach now records
callback/host-cut entry independently of output correctness; comparisons remain
strict. Production had only mechanical flag/cache edits and the separately
gated ordered repair before this predicate RED. The callback boundary itself
remained unrepaired.

The production repair carries a normalized callback view with each row
occurrence beside its authored selected value. FROM, JOIN and union adapters
transport it. Functional callbacks consume that view, then the existing walker
removes private state. Output also removes private state, including for raw
Effect roots. No global object-to-provenance registry merges distinct row
occurrences. Inline output keeps authored values. Selected-row normalization
has an explicit name; its two cache slots replace the per-query boolean Map.
The existing single source-mode expression serves FROM and JOIN.

The compiler receiver now checks raw selected output by a shared-cache versus
separate-cache relation. It no longer borrows an inline-include attribution
rule for an exported compiler root. Both executions independently check
callback input and derived output, so their agreement cannot excuse a shared
spoof. Its 396 histories cross both orders and all three consuming paths.
Original-key counters distinguish actual FROM/JOIN reuse from optimizer-cloned
union branches. Union coverage establishes propagation/transparency, not an
original-key cache hit.

A second law requires every ordered window to receive the source rows it
needs. The original source-plan assignment orphaned an earlier top-K: widening
its window from one to three left output `[1]`, while reversed compilation
order produced `[1,2,3]`. The probe recorded two registrations and 15 graph
operators. These are measured work facts, not a universal pipeline budget.
The ordered-work owner now crosses compilation order, cache sharing, FROM/JOIN/
union placement, projection form, order direction and three window moves:
144 histories and 432 initial/moved/returned states. Its independent existing
installed-window model checks signed output bags. Before the order-by repair,
48 histories failed and 376 tests passed; all old 280 histories passed.
Registration now combines live window bounds and data-needed judgments. It
requires the full source when orders differ. Individual top-K windows and
setters remain independent. All 424 ordered owner tests pass.

This ordered receiver uses a real source Collection and OrderedSourceLoader
with a controlled subscription/provider seam. It claims the compiler/loader
cut, not public window-promise integration. The existing owner separately
retains its real Collection/Effect lifecycle coverage.

### Enforcement evidence

Scratch root: `/private/tmp/callback-metadata/nine-issue-review-2312`.
Commands run with `pnpm_config_verify_deps_before_run=false`, without installs,
builds or lockfile changes, and with at most two Vitest workers.

| Experiment | Result and evidence |
| --- | --- |
| Unchanged callback production, extended predicate owner | 1,102 failed / 3,821 passed, `predicate-owner-red-corrected.{json,log}` |
| Repaired callback owner | 4,923 passed, `boundary-attempt3.{json,log}` |
| Actual PR base `bfd1da1a7e752d66fd667adfd3cdf54f60732b22` with new Effect receiver | 203 Effect comparisons failed, `pr-base-owner.{json,log}` |
| Original ordered source registration | 48 failed / 376 passed, `ordered-owner-red.{json,log}` |
| Repaired ordered owner | 424 passed, `ordered-owner-green.{json,log}` |
| Normal package configuration, eight neighboring suites | 5,912 passed, `final-package-green.{json,log}` |
| WHERE-only callback repair | 551 HAVING comparisons failed, `final-where-only.{json,log}` |
| Normalize every predicate's source pipeline | 696 authored-output comparisons failed, `final-sanitize-all-predicates.{json,log}` |
| Lose selected-row cache mode | 26 compiler comparisons failed, `final-raw-only-cache.{json,log}` |
| Restore source-plan overwrite | 48 ordered comparisons failed, `final-overwrite-window.{json,log}` |
| Earlier FROM/JOIN/union mode omissions | 112 compiler comparisons failed per path, `mutant-summary.json` |

The final mutants ran against copied final sources and final tests. They failed
at the intended comparisons, rather than during setup. Their source edits and
full failure traces remain in `run-final-mutants.py`, `final-mutant-baseline/`
and `final-mutant-summary.json`. The original predicate RED also rejects the
reviewed implementation as a hostile wrong design. No comparison, reach
minimum or run budget was lowered.

### Lossless item audit

| ID | Technical verdict | Action and durable value |
| --- | --- | --- |
| EXT2312-01 | Confirmed predicate input spoof for WHERE and HAVING, including real Effects and inline children. The original select-only authority required the maintainer's resolved extension. | fixed-now: occurrence callback view plus callback-kind grammar, membership and authored-output checks. |
| EXT2312-02 | Confirmed broad prose exceeded the implemented and generated select-only promise. No predicate comparison existed to enforce it. | fixed-now: approved law, executable grammar and current architecture/coverage claims agree. Historical initial-gate gaps remain explicit. |
| EXT2312-03 | Confirmed real Effect receiver was missing. Its actual PR-base run rejects 203 metadata comparisons. | fixed-now: shared-model Effect lifecycle receiver and corrected changeset. New evidence does not retroactively repair the original pre-edit process. |
| EXT2312-04 | Confirmed absolute raw-root judgment lacked an independent attribution authority. | fixed-now: differential raw-output law, retaining independent input/output checks in both executions. |
| EXT2312-05 | Confirmed two mode pipelines and the orphaned ordered plan, with an actual underfilled result. Pipeline duplication alone violates no stated resource law. | fixed-now: primary ordered owner plus live aggregate source plan. Separate top-Ks remain permitted. No unsupported one-pipeline or speed claim. |
| EXT2312-06 | Confirmed duplicate expression at FROM/JOIN. | fixed-now: compute the expression once. Path-specific mutation evidence preserves the reason. |
| EXT2312-07 | Confirmed ambiguous publication name. The cited branches normalize selected metadata rather than performing Collection publication. | fixed-now: rename to sanitizeSelectedMetadata and separate callback view transport. No independent root-only behavior defect follows from the old name. |
| EXT2312-08 | Confirmed a Map represented only two slots. No heap or bundle measurement supported the claimed magnitude. | fixed-now: typed two-slot tuple. Claim only the removed Map structure, not measured bytes or speed. |
| EXT2312-09 | Confirmed FROM-only cache grammar omitted JOIN and union. | fixed-now: three-path grammar and path-specific mutant sensitivity. Preserve the union optimizer-cloning limit. |

All nine raw items have separate IDs, claims, proposed repairs, evidence and
dispositions in the append-only ledger. Total: nine fixed-now, zero deferred,
zero unresolved product decisions. The ordered-loader counterexample is the
confirmed consequence of item 5, rather than an extra invented raw item.
The initial repair attempt exposed private callback-view state in raw Effect
output; final result cleanup removes it, and Effect continuity rejects that
attempt. This collateral attempt is retained as implementation feedback.

The reviewer earns a strong hire recommendation. The predicate probes identified
a real placement-dependent leak, and source analysis predicted the ordered-plan
failure that execution confirmed. The differential and path-dimension proposals
improve test integrity. The flag and allocation comments are useful cleanup,
with lower severity than the correctness findings. The review did not establish
a performance budget or an original-key union cache hit. Those qualifications
limit the claims without discarding the findings.

### Guide audit and limits

ORC-001–003: the approved law, limits, independent model, grammar, real receivers
and comparisons remain beside their executable definitions. ORC-004: existing
33 legal descriptions retain all single/all/no collisions and typed peers;
callback-kind ablation loses predicates, selection controls lose placement
independence, and path ablation loses a distinct transport boundary. Compiled
Collection inputs and direct-return overrides remain excluded by admission.
ORC-005: each receiving cut and every delivered Effect value is compared.
ORC-006: the recorded original and final mutants fail their intended judgments.
ORC-007: callback/cache additions exhaust finite grammars, so seed campaigns do
not apply; existing ordered generated campaigns keep fixed/random parity.
ORC-008–009: source facts distinguish retractions, callback snapshots differ
from Collection rows, and the controlled ordered seam has an explicit mapping.
ORC-010: all-cut reports and cleanup preserve primary failures. ORC-011:
cache transparency uses two executions while independent input truth prevents
a shared false green. ORC-012: this versioned record binds the final source
hashes below. ORC-013: WHERE-only and over-sanitizing repairs demonstrate the
neighboring consequences. ORC-014: actual Collection/Effect receivers supply
core lifecycle evidence; ordered provider and framework claims stay bounded.
ORC-015: all 22,502 metadata and 432 ordered added states reach once.
ORC-016: all added histories use shared judgments, without pinned expected
answers or unit tests inside oracle files.

The finite metadata grammar bounds recursion at two QueryRefs, joins at one
LEFT join, sources at two typed-key peers, and mutations at one held successful
update. It does not establish arbitrary descriptors/prototypes, deeper
recursion, overlapping same-key mutations, other join kinds, truncate,
provider scheduling, framework timing or construction-failure cleanup.
Grouped selected-context attribution is a separate judgment from the local
source-input predicate law. The existing aggregate and materialization owners
remain responsible for those semantics. Static metadata and P11/P12 literal/
type gaps stay open in the retained deferred record. No universal runtime or
static closure follows from the finite evidence here.

### Final source binding and verification

The final package run passes all 5,912 tests across eight suites. Focused
TypeScript passes with no diagnostics. Explicit ESLint passes with zero errors
and four existing no-shadow warnings in the ordered owner. Formatting,
whitespace and changed-file oracle enforcement pass. The final four mutants
were refreshed from these exact compiler and test sources and again rejected
551, 696, 26 and 48 intended comparisons respectively. Their logs retain all
failure messages. These results supersede intermediate repair attempts.

Run both owners under the normal package configuration:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 pnpm_config_verify_deps_before_run=false \
  pnpm --dir packages/db exec vitest run --maxWorkers=2 \
  --coverage.enabled=false --typecheck.enabled=false \
  tests/query/virtual-row-fields-input-oracle.test.ts \
  tests/query/ordered-work-oracle.property.test.ts
```

The predicate RED command used the extended tests and the pre-edit compiler
binding in `predicate-gate-fingerprints.json`:

```sh
pnpm_config_verify_deps_before_run=false pnpm exec vitest run \
  --config /private/tmp/callback-metadata/nine-issue-review-2312/owner.config.mjs \
  --reporter=json \
  --outputFile=/private/tmp/callback-metadata/nine-issue-review-2312/predicate-owner-red-corrected.json
```

The ordered RED used the extended ordered owner and the pre-edit binding in
`ordered-gate-fingerprints.json`, with `ordered-original.config.mjs`. The final
hostile calibrations are reproducible through `run-final-mutants.py`. The
normal eight-suite command adds the existing Effect metadata, cache-control,
functional projection/input boundary, public-container-copy and context
transport suites to the two-owner command above. No full build or dependency
installation supplied this evidence.

These SHA-256 fingerprints bind the final behavioral sources without making
the report hash itself refer to its own contents:

| Source | SHA-256 |
| --- | --- |
| `packages/db/src/query/compiler/index.ts` | `c566eccd683862fb3235a84e841fafca32fb8c5a43491570b2fa65a3c1874487` |
| `packages/db/src/query/compiler/joins.ts` | `1c3642f632a10b25ac784d5728e680803d657452969496a4e21b1a8213f44fcd` |
| `packages/db/src/query/compiler/order-by.ts` | `384d8a132c86265f4bb4e12ec4ed5200f062a182e35402dcd38b4d546828d0d2` |
| `packages/db/src/query/compiler/parent-routes.ts` | `5f8caf4504d70639bcd9b109da28ddb6880ebc81b1e4489e0ae8de2e7151cf42` |
| `packages/db/src/query/compiler/route-metadata.ts` | `ba0c42104288720ff221b516298d39da9e7201d68984f8101adb7df20f286cb1` |
| `packages/db/src/query/compiler/types.ts` | `e06dbdf363cc1878226692de890650680e1c84bf35f17424fd23dad09313c27d` |
| `packages/db/tests/query/virtual-row-fields-input-oracle.ts` | `7b7c5055fe58dd701ad10db9620f516d1ab4b0127a95e17bee629310b3b5450a` |
| `packages/db/tests/query/virtual-row-fields-input-driver.ts` | `3d157039ec6c7aead891865738346e4e52c3747fe199fca44fce0224ed4998ad` |
| `packages/db/tests/query/virtual-row-fields-input-oracle.test.ts` | `58ae2e54947145220a8b78a28cadc37456e3d11d507ce36846843f002d79550d` |
| `packages/db/tests/query/ordered-compiler-cache-driver.ts` | `ba7b244250754d9a5d8480847562c26907edf192c8a028973dca0de32e6c43e6` |
| `packages/db/tests/query/ordered-work-oracle.property.test.ts` | `a8e2f5884570f0659764ad0b7be7398c432b411fcf796dd007ddd3f4bb9d5e68` |
