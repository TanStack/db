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


## Replay error identity CI follow-up (2026-10-30)

The parent is `86510968691e0080a7484881ed7f54ba58f110af`.
This follow-up repairs an oracle scope error, with no production changes.
The earlier production and metadata-oracle fingerprints above remain intact.

**Law and authority.** ARCHITECTURE.md, “Atomic window publication” and
“Replay participants and failure”, assign each subscription its replay's
normalized Error, the earliest failure that still decides it. Subscriptions
share a publication barrier. Their failures do not acquire a common error
order: one replay can fail while a sibling still loads.

**Experiment.** CI failed `replay.ordered-failed-replay` with seed
`1926301329`, path `251:2:1:4:2:2`. Exact replay on unchanged production
failed the identity comparison. The trace holds loads, truncates markers,
requests window 0/1, then fails newest and oldest held loads. It uses an
ascending anti-joined window with inline includes and on-demand markers.
Adapter diagnostics identify failure load 10 with subscription 1 and the
move's rejected load 8 with subscription 2; load 9 of subscription 1 is still
pending. The source-wide comparison incorrectly made load 10 decide the
other subscription's error. This is evidence against the comparison, not a
production error or a new law decision.

The corrected model records subscription identity from adapter request data.
Competing failures and covering replacements belong to the same subscription.
The source-wide retention model stays shared. The exact replay passes.
A 96-history finite grammar crosses two directions, four join forms, three
window widths, root/marker replay and oldest/newest failure order. Each uses
the existing real Collection/live-query driver and every shared comparison.
Declared reach records 52 histories with multiple own-subscription failures
and six with sibling failures, each with minimum five. The normal package
owner run passes all 43 tests, including unchanged fixed/random budgets.
Type checking reports no errors.

**Calibration.** Restoring the source-wide error order fails the finite grammar
at the same marker Error identity assertion. A temporary production mutant
that returns the last replay failure instead of the first fails its root
Error identity assertion. Both reach their intended comparisons, with no type
errors. The original production source is restored byte-for-byte.
These controls distinguish an ownership correction from an unconditional
waiver of replay error order.

**Inference and limits.** The repair preserves the accepted per-subscription
error law and freedom between sibling replay verdicts. Existing retention,
request-error, demand-retirement, readiness, window and convergence checks and
all campaign budgets remain. This bounds evidence to one query, one-level
includes, the existing finite source domain and a controlled adapter in the
real Collection/live-query path. Existing peer exclusions and receiving-provider
and framework limits remain; this is not universal replay closure.

The evidence directory is
`/private/tmp/callback-metadata/ci-monitor/20261030T205752Z`:
`replay-red.*`, `replay-diagnostic.log`, `replay-scope-green.*`,
`replay-matrix-green.*`, `replay-package-green.*`, `source-wide-check.*`,
`last-replay-error.*`, and `replay-control-summary.json`.
The exact replay command is:

```sh
TANSTACK_DB_ORACLE_SEED=1926301329 \
TANSTACK_DB_ORACLE_PATH=251:2:1:4:2:2 \
TANSTACK_DB_ORACLE_PROPERTY=replay.ordered-failed-replay \
pnpm_config_verify_deps_before_run=false pnpm --filter @tanstack/db exec \
  vitest run tests/query/load-subset-replay-refinement-oracle.test.ts \
  -t 'keeps the last publication through a failed replay' \
  --coverage.enabled=false --maxWorkers=1
```

This is an oracle self-review, not independent review. ORC conformance:

| Requirement | Outcome |
| --- | --- |
| 001, 002 | Existing architecture authority; identity from adapter input, no production verdict helper computes expectations. |
| 003 | Contract, model distinction, finite grammar and observation remain explained beside executable code. |
| 004 | Matrix reconstructs the CI trace; removing sibling ownership reproduces the false failure. Finite domains are stated; failure of a load outside a waited replay remains outside the identity premise. |
| 005 | Real Collections and `setWindow` rejection at replay settlement; no missing source-fact hypothesis is needed for this error-identity comparison. |
| 006 | Source-wide comparison control and last-error production mutant fail intended assertions. |
| 007 | Existing fixed/random properties, direct seed/path replay and budgets remain unchanged; finite matrix is bounded enumeration. |
| 008, 009 | Subscription identity distinguishes a sibling failure from one's own; both can share the publication barrier. Mapping is beside the model. |
| 010 | Original and diagnostic traces retained; existing finally cleanup and failure propagation remain. |
| 011 | Shared production/model scope fault was disproved by independent adapter identities and the architecture rule; a second runtime model is unnecessary for this comparison correction. |
| 012 | Parent and source binding, evidence chronology and all applicable outcomes recorded here. |
| 013 | Sibling and same-subscription neighbors distinguish global error order from per-replay order. |
| 014 | Controlled adapter claim only; no real-provider or framework transfer claimed. |
| 015 | Both declared states exceed minimum five, with 52 and six histories respectively. |
| 016 | Matrix supplies histories to the same driver and comparison, with no separate expected error. |

Final SHA-256 binding (the report itself is excluded):

| Source | SHA-256 |
| --- | --- |
| `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts` | `119f75c35a0b5c472d211997a9f677fa0a92e605d99c8bde46aeda8c14a04560` |
| `packages/db/src/collection/subscription.ts` | `315a043966bf03ae7671e1e34338692d93eb91f04223a7c079a7585c4a54860b` |
| `packages/db/src/query/live/collection-config-builder.ts` | `0c00f76f05ecdea1c842e47e7749ed5dafbbb32f5c9f8a0937faf2776b4f474d` |


## Ordered joined dependency review (2026-10-30)

This entry evaluates CodeRabbit review `5718630084`, run
`bbef8b96-93c0-425c-ac82-76ae3c71abec`, reviewed commit
`86510968691e0080a7484881ed7f54ba58f110af`. Its selected file was
`compiler/basic.test.ts`; the behavioral finding was outside that diff and
survived unchanged at repair parent `8464ec97725a14c9df103e170d9367737c9ef41a`.
The earlier metadata, compiler and replay evidence remains historical evidence
for its named source bindings. This entry supersedes the earlier fingerprints
of the files changed here. The final source binding below identifies this
repair without claiming that the external review covered it.

**Law and authority.** The architecture's “Ordered requests, continuation,
and recovery” and “Atomic window publication” require ordered continuation
and publication to wait for required joined demand. Retaining two ordered
plans over one source retains both plans' joined dependencies. An outer
QueryRef that has no join cannot remove its child's dependency. A second join
cannot substitute its own source for the child's. This is enforcement of the
existing complete-window law, with no new product decision.

**Experiment.** The primary `ordered-work-oracle.property.test.ts` owner had
compiler/cache composition coverage and joined receiving coverage separately.
It lacked their intersection: nested ordered plans while joined acquisition
is held. Its new independent judgment filters complete source rows, sorts
and slices using `expectedInstalledWindow`. It never reads the compiler plan
or production publication classifier to compute an expected result.
The supporting `ordered-joined-plan-driver.ts` uses actual live-query
Collections and Effects with controlled source adapters. Adapter request data
selects the marker rows independently through the reference expression judge.
The model's held/partial state abstracts pending acquisition and the preceding
complete public snapshot. The settled state adds the new row and recomputes
membership. Source facts for that row are deliberately unavailable until the
held adapter answers, so the promised early observation is retention, not a
speculative result that needs those missing facts.

Before production edits, 128 finite histories crossed Collection/Effect,
ascending/descending, matched/anti-joined filters, direct/wrapped/two-filter
nested ordering, widths one/two, source answer order and the source that vetoes
new row 4. Each compares initial settled rows and every recorded change-callback
snapshot or Effect `onBatch` snapshot plus the public read at held, partial
and settled cuts. All 256 declared held/settled states reached once, minimum
one, including both receivers separately. Unchanged parent production failed
24 intended publication comparisons (12 Collection and 12 Effect), with 104
passes and no type errors. In a wrapped anti-join, row 4 became visible while
its marker acquisition remained held, then disappeared after settlement.
Direct-query controls retained the preceding result correctly.

The first draft also asserted atomic ordinary Effect startup callbacks. The
architecture explicitly permits progressive startup, so that assertion was
incorrect. It produced two additional failures. Before production edits, the
comparison was corrected to establish the initial settled baseline and begin
its new publication claim afterward. Both earlier logs remain; they do not
supply the authoritative RED result. The final 128-history RED is
`joined-plan-red-final.{json,log}` in the evidence directory below.

**Repair and calibration.** The compiler stores the union of joined source
IDs when registering ordered plans. Loader continuation, Collection publication
and operation tracking, and Effect publication inspect every dependency.
The new matrix passes all 128 histories. The normal package run passes all
647 tests across the ordered owner and three affected loader/work suites,
including the original 424 owner tests and unchanged fixed/random budgets.
After final type/API-overload and local-name corrections, the same 128-history
matrix passes again. Focused no-emit TypeScript, ESLint (zero errors, five
existing warnings), Prettier, whitespace and changed-file enforcement pass.

Restoring overwrite semantics fails 24 intended comparisons. A last-only
fallback, equivalent to retaining the new dependency when present, fails eight.
A first-only fallback fails eight. Each narrow control loses the source that
vetoes row 4 in the opposite answer-order cell. All failures are the intended
`ordered joined plan publication mismatch`, not timeouts or setup failures.
All temporary mutants were restored. This rejects both the original defect
and plausible repairs that preserve only one source.

**Inference and limits.** The finite evidence closes the reported loss of
joined dependencies and its two-source sibling within these legal histories,
actual core receivers and publication cuts. It preserves direct controls,
settled membership, direction and width, and does not add speculative callbacks.
It covers one inserted head row, at most two joined dependencies, one QueryRef
level, widths one/two and controlled successful acquisition. It does not claim
arbitrary nesting, provider/framework timing, new rejection/cleanup laws,
public window-promise integration or atomic ordinary Effect startup. Other
ordered-work limits and existing static metadata/P11/P12 gaps remain recorded
with their prior owners. No known counterexample remains in this new matrix.

Evidence directory:
`/private/tmp/callback-metadata/ci-monitor/20261030T210918Z`.
It contains the complete raw review/conversation bodies, append-only ledger
references, pre-edit source copies and fingerprints, diagnostic probe,
`joined-plan-red-final.*`, `joined-plan-green.*`, `joined-plan-package-green.*`,
`joined-plan-final-green.*`, three `joined-plan-mutant-*` runs and summary,
`joined-plan-types-final.log`, `joined-plan-eslint-final.log`, formatting and
changed-file enforcement logs. The matrix command is:

```sh
pnpm_config_verify_deps_before_run=false pnpm --filter @tanstack/db exec \
  vitest run tests/query/ordered-work-oracle.property.test.ts \
  -t 'retains every joined dependency' --coverage.enabled=false --maxWorkers=1
```

### Lossless review ledger and reviewer assessment

The raw review, repeated prompt, run metadata, mutable risk prose and footnotes
were rechecked against the final diff. Six source-order items remain distinct.
The two-source sibling is calibration and repair work under item 1.

| ID | Technical verdict and PR action | Durable value and destination |
| --- | --- | --- |
| CR5718630084-1 | **fixed-now**. Dependency loss is real. The review calls it minor; observed transient public membership makes it a correctness defect. Its nullish fallback preserves only one source and fails the wider law. | Nested held-dependency histories in the primary ordered owner, production union and this evidence record. |
| CR5718630084-2 | **duplicate** of 1. The repeated agent prompt proposes the same nullish fallback. | Preserve its exact proposal in the scratch ledger and reject it with the last-only mutant. |
| CR5718630084-3 | **accepted-design**. Optional local CLI review supplies no product requirement and needs no installation. | Existing no-install constraint and explicit oracle calibration remain the authorized verification method. |
| CR5718630084-4 | **accepted-design**. API review commit is 865; one selected test file does not establish fresh review of every production file. The outside-diff finding survives at parent 846. | Keep reviewed commit separate from repair source binding and later CI head. |
| CR5718630084-5 | **duplicate** of 1. Mutable merge-risk prose says to retain the joined dependency. | The receiving oracle now observes the transient public result described by that prose. |
| CR5718630084-6 | **duplicate** of prior review items 5–6. The unchanged 47.37% docstring threshold and optional generated tests do not identify another contract gap. | Preserve repository literate-oracle requirements and review limitations without adding unrelated generated examples. |

Totals: one fixed-now, two accepted-design, three duplicates, zero
confirmed-open, deferred or design-decision items in this review. The final
loss audit includes prose outside the finding list, optional CLI/tests,
coverage qualification and the mutable summary. No item was removed by a
severity cap. Reviewer recommendation: **hire, with a proposed-fix qualification**.
The review found a real outside-diff composition defect with a precise cause
and useful receiving-test direction. Its priority understated public transient
behavior, and its patch missed two-source composition. The generated policy
footnotes add little new signal. Oracle experiments supply the wider closure.
This assessment does not establish whole-PR readiness or review of the repair.

### Oracle self-review

This is a self-review, not an independent external audit.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Existing ordered/atomic-publication authority, bounded histories and explicit startup/provider limits above. |
| ORC-002 | Complete source truth, ordinary membership and independent sorting/slicing; no plan or gate helper computes expectations. |
| ORC-003 | Law and limits precede the finite grammar; model, named driver and shared comparison stay distinguishable beside executable prose. |
| ORC-004 | Wrapped anti-join reconstructs the finding. Direct placement removes composition and stays green. Two-filter/blocker/answer-order dimensions distinguish first-only and last-only. Directions, widths and polarities preserve rank/membership neighbors. Bounds are finite; the grammar excludes a second blocker for a plan that has only one joined source. |
| ORC-005 | Real Collection reads/change callbacks and Effect onBatch reconstruction at held, partial and settled cuts; held adapters explain missing source facts without excusing speculative publication. |
| ORC-006 | Overwrite, first-only and last-only controls fail intended public comparisons, with counts 24/eight/eight. |
| ORC-007 | New matrix is bounded enumeration, not a random campaign. Existing owner fixed/random campaigns and budgets remain and pass in the 647-test run. |
| ORC-008, ORC-009 | Pending adapter acquisition maps to held/partial cuts; retained public snapshot and settled source truth are separate model observations. No production continuation machine is copied. |
| ORC-010 | Comparison errors retain observation/history traces in AggregateError and cleanup uses withOracleCleanup. Earlier recorder-assumption failures and all mutant diagnostics remain separately available. |
| ORC-011 | No new shared semantic-fault hypothesis requires a second runtime model. Source-complete membership differs structurally from compiler dependency union and publication scheduling. |
| ORC-012 | Parent, chronology, boundaries, source bindings, loss audit and every applicable outcome are recorded here. |
| ORC-013 | No-join outer plan and two distinct joins distinguish absence preservation from union; both blocker sources and answer orders reject narrow fixes. |
| ORC-014 | Actual core receivers supply the receiving boundary; controlled adapters alone supply acquisition timing. No external provider/framework transfer is claimed. |
| ORC-015 | Every one of 128 histories reaches held and settled once: 256 cells, minimum one, per-receiver identity included in each key. |
| ORC-016 | All new cases use the same independent model, named production driver and refinement comparison; no ordinary expected-answer examples are added to the oracle. |

Final SHA-256 binding for this repair (this report is excluded):

| Source | SHA-256 |
| --- | --- |
| `packages/db/src/query/compiler/order-by.ts` | `265c1a8102865e8d0be70bab3b6853e757530800098c8b166545988445b4fab9` |
| `packages/db/src/query/effect.ts` | `a17ed6693a48de79a45b8602bd7803b6a577174d6d796db7038e10c964986220` |
| `packages/db/src/query/live/collection-config-builder.ts` | `fb584c9a49a68faa7775b572ec6d5e0d2ce9f968904d18000c269734c735ab76` |
| `packages/db/src/query/live/collection-subscriber.ts` | `d2e7864f197eaced0323453eda3c70c6967080b956e1ef6df266f1b73234e527` |
| `packages/db/src/query/live/ordered-source-loader.ts` | `3baf426831e184b88656c475be2e6362cd670e6f5fa6e300ea9ec2ed82bf10db` |
| `packages/db/tests/query/ordered-work-oracle.property.test.ts` | `652a1a2378ab882a3e4b0619889020f0581212653507f25051a684b60e8b1d71` |
| `packages/db/tests/query/ordered-joined-plan-driver.ts` | `3a3bb38caef14e649df17ac7cd0eaae312aa483b4801c4d874888b4112c753f9` |
| `packages/db/tests/query/ordered-source-loader-state-oracle.test.ts` | `679449468e358d51469bffe18d159ec62b8557b1c63aeaa3ea4cee2e05628b49` |
| `packages/db/tests/query/ordered-source-loader-state.test.ts` | `23e30afddbfbd5db5979a44f580ac3fc777e5c5ae216584dd7073964080c2925` |
| `packages/db/tests/query/ordered-work.test.ts` | `df0bb6faf5d81f70c1229511dd38180c206d2df0560593550a6220a8e2a2941f` |


## Replay retirement scope review (2026-10-30)

CodeRabbit review `5718757637`, run `f8b20e61-196f-44d2-86fa-d7648cfa8d08`,
covered `8464ec977`. Three files were selected, two similar documentation files
were skipped, and the replay oracle was processed. The current production
repair `c33e18fd5` was not reviewed. Automatic reviews are now paused.

**Law.** Each subscription owns its replay verdict (architecture, “Atomic
window publication” and “Replay participants and failure”). A successful
sibling acquisition cannot decide another subscription's replay failure,
even when both request the same source keys. Publication can remain shared.

**Experiment.** The prior oracle repair scoped error comparison and covering
failures, but missed successful retirement in `settleParticipant`. The primary
owner now varies failure followed by successful coverage over 96 histories:
two directions, four join forms, three widths, root/marker replay and both
settlement orders. It uses the existing actual Collection driver and every
shared public comparison. A calibration comparison also requires every sibling
failure identity to survive that account action. Before repairing the account,
it fails with `replay account scope: successful sibling removed another
subscription's replay failure`, with no type errors. The repair adds the same
subscription premise to successful failure retirement. No production code
changes for this finding. The complete normal owner run passes all 44 tests,
including unchanged fixed/random budgets. Four histories reach successful
sibling coverage, minimum one. The prior two-failure matrix retains 52 own
and six sibling error-order histories. The original retirement behavior is
the rejected hostile control. This establishes account sensitivity, not a
new production defect or universal error-order proof.

Evidence: `ci-monitor/20261030T212023Z/replay-retirement-{red,package-green}.*`
under `/private/tmp/callback-metadata`, original oracle copy, source ledger,
ESLint and changed-file enforcement logs. Existing controlled-adapter, peer,
provider and framework limits remain. The publication, convergence and
request-error comparisons remain, without a new waiver.

The six-item raw-body loss audit yields one **fixed-now** (successful retirement
scope), two **accepted-design** (coverage qualification and paused review),
and three **duplicates** (repeated fix prompt, mutable risk prose, docstring
policy and optional generated docs/tests). The docstring percentage changes to
45%, but names no separate missing contract explanation. Optional review
commands supply no coverage and are not executed. No item is deferred or open.
Reviewer recommendation: **hire**. The finding correctly identifies a remaining
oracle-integrity gap and proposes the missing ownership premise. Its scope is
test correctness. It does not establish review of the later production repair.

ORC self-review, not independent audit: 001–003 use the established ownership
law, input identities and literate shared comparison. 004 reconstructs the
failure/success neighbor of the prior failure/failure grammar, with finite
bounds and no peer claim. 005 exercises actual Collections at the existing
cuts and calibrates the oracle account separately. 006 rejects the original
retirement action at its intended assertion. 007 preserves all campaigns and
budgets. 008–009 retain per-subscription failure identities within the shared
publication abstraction. 010 retains the original trace and existing cleanup.
011 names no new shared semantic-fault hypothesis requiring a second runtime
model. 012 records chronology, source and limits here. 013 crosses failure with
success and own with sibling coverage. 014 claims controlled adapters through
real core receivers only. 015 reaches four successful sibling histories against
minimum one. 016 supplies histories to the shared driver and judgments, with
no separate expected Error examples.

Final SHA-256 of `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts`:
`e03f3cee17413016f59c299eb25896fd9098ea3cde88fffbe35f4de58fba366f`. This supersedes that owner's earlier binding only.


## Shipped-size refactor (2026-10-30)

The size request preserves the accepted metadata, cache, ordering and publication
laws. The primary owners, history grammars, comparisons and run budgets do not
change. This is a behavior-preserving refactor, with no new pre-edit RED claim.
Shared FROM/JOIN source compilation and input wrapping replace duplicate paths.
Container copying, include replacement, projection and ordering each use fewer
implementations. Authored output and normalized callback views remain distinct.
Every ordered window and joined dependency remains represented.

`pnpm size:compare --packages db --files` measures production bundles against
merge-base `bfd1da1a7e752d66fd667adfd3cdf54f60732b22`. The repository has no
`size:check` script. Targeted builds use existing dependencies without an install.

| Measurement | Base gzip | Refactor gzip | Gzip delta | Brotli delta |
| --- | ---: | ---: | ---: | ---: |
| Full `@tanstack/db` package | 109,702 B | 109,673 B | −29 B | −13 B |
| Typical app | 96,777 B | 96,743 B | −34 B | −26 B |

These totals do not establish that every feature scenario shrinks. LocalStorage
adds 17 B gzip and 5 B Brotli. Some other scenarios shrink with gzip but grow
with Brotli. The complete scenario table remains in `size-union-key.log`.

The frozen source passes 6,322 normal-package tests across 11 suites, including
both primary owners and the affected compiler, container and include neighbors.
Focused no-emit TypeScript, ESLint (zero errors and warnings), Prettier,
changed-file enforcement and whitespace checks pass. Seven source-bound hostile
controls fail their intended comparisons: lost HAVING view 551, over-normalized
predicates 696, raw-only cache 26, ordered-window overwrite 48, joined-dependency
overwrite 24, joined last-only eight and joined first-only eight. These controls
calibrate the existing laws after refactoring. They do not extend their limits.
Union key encoding also matches the original for 24 representative inputs.

Evidence directory:
`/private/tmp/callback-metadata/ci-monitor/20261030T212503Z/size-reduction`.
The final bindings are `final-green.*`, `final-eslint2.log`, `final-types2.log`,
`final-format.log`, `final-lint-changed.log`, `size-mutant-summary.json` and
`final-fingerprints.json`. Earlier attempts remain separate. The following
bindings supersede earlier bindings for these four refactored files only.

| Source | SHA-256 |
| --- | --- |
| `packages/db/src/query/compiler/index.ts` | `c6074cd82e6755b3d55c9307018fe368cd3e591a719eeb69ab6d7cb2109e75bf` |
| `packages/db/src/query/compiler/joins.ts` | `a5618bb1da3bff18b91fc4d9bf155447712e0bb1b68cd0f66a1cda0662d80450` |
| `packages/db/src/query/compiler/order-by.ts` | `a104d4f4829e9b4ea801fcc60914772c1d97a47d7d46dbfa5e24f49724b12267` |
| `packages/db/src/query/compiler/route-metadata.ts` | `bc6313f715e84949d0a6f8f5b48511bb3bc05ba5fd13a0b5e8a1033f3ee8e4df` |


### Integration with current main and final size

The maintainer approved updating this branch from main. Merge `ce555e739`
incorporates `a2f346596c34faa7e65211134194337bd2e0007d`. The only conflict
was appended coverage-map prose. Both sides remain. This updates the branch
without merging PR #2312.

The final compiler removes two redundant branches. `Object.is` already accepts
two `NaN` values, so its later `Number.isNaN` case cannot change the answer.
Object spread already accepts `undefined`, so parent-context copying needs no
separate empty-object case. Accepted laws, oracle grammars, comparisons and
budgets remain unchanged.

The default `pnpm size:compare --packages db --files` now compares the integrated
tree with current main `a2f346596`, rather than the earlier merge-base.

| Measurement | Main gzip | Final gzip | Gzip delta | Brotli delta |
| --- | ---: | ---: | ---: | ---: |
| Full `@tanstack/db` package | 109,658 B | 109,601 B | −57 B | −48 B |
| Typical app | 96,591 B | 96,529 B | −62 B | −31 B |

Every measured scenario shrinks with gzip. The Effect scenario grows by one
byte with Brotli. The earlier original-base and exact-base diagnostics remain
historical measurements of their named trees.

The frozen integrated source passes 6,533 tests across 16 files, including the
primary owners, restart publication, replay, distinct collisions and include
receivers. Focused no-emit TypeScript and ESLint pass, with zero lint warnings.
Evidence is `/private/tmp/callback-metadata/ci-monitor/size-final-integration`:
`size.log`, `green.*`, `types.log`, `eslint.log` and `final-fingerprints.json`.
The refreshed compiler index binding below supersedes its previous binding.
Other compiler sources retain the previous refactor bindings.

`packages/db/src/query/compiler/index.ts`: `c356929cce3db647ec28f79ff2dd14bead69450ac6567176ec0bb63d6b8d970d`.


All seven controls reject the intended wrong behavior on the frozen integrated
source: HAVING view loss 551, over-normalized predicates 696, raw-only cache 26,
window overwrite 48, joined overwrite 24, joined last-only eight and joined
first-only eight. `size-mutant-summary.json` retains the assertion errors and
source hashes. The missing-dependency setup attempt remains separately in
`setup-failure-1`; it supplies no RED evidence. Existing dependency links
resolved that copied-tree setup. No install or production mutation occurred.
The isolated copies were restored and both trees match the frozen fingerprints.

## Release-blocking loading sibling replay port (2026-10-30)

The release workflow for main `e75f8455a78bc33c43376288218e9912dc2a3f4c` exposed a retention counterexample that also reproduces on callback head `5af7624937288cbe212f19ff23e8ba83caabb74e`. Independent adapter receipts show that a new include demand failed while a sibling replay was still loading. The include had no acquisition at truncate, and its failed demand remained held. This is an enforcement gap in architecture law 9, not evidence of a regression in the compiler removals.

[PR 2318](https://github.com/TanStack/db/pull/2318) carries the main-based repair and its [versioned experiment record](2026-10-30-release-replay-retention.md). The same primary extension ran on unchanged callback production first: `callback-primary-red.json` fails at quiet retention with measured sibling failure 1. The one-condition guard then changed from failed replacement to pending replacement. `callback-primary-green.json` passes all 48 finite histories with reach 44/33/12. The full primary owner passes all 45 tests on this branch. The old guard's pre-edit RED and the main-based original-guard mutant preserve the intended violated comparison.

The SQLite grammar port is byte-identical to the main-based fix. Its two 80-history campaigns and two existing final-delivery controls pass there. This branch's focused TypeScript, ESLint, formatting, whitespace and `pnpm lint:changed` pass. ESLint retains two existing warnings. All 14 compiler source fingerprints from the final size integration remain unchanged. The bounded core/controlled-host claims and historical recovery-reach gate limitation remain as stated in the experiment record.

After the guard port, `pnpm_config_verify_deps_before_run=false pnpm size:compare --packages db --files` reports package gzip 109658 to 109595 bytes (-63), Brotli -47, against merge-base `a2f346596`. Typical app gzip changes from 96591 to 96527 (-64), with Brotli +21. Every measured gzip scenario shrinks. This does not claim every Brotli scenario shrinks. The later release merge changes versions and changelogs rather than these runtime sources.

Scratch evidence is under `/private/tmp/callback-metadata/release-replay-repair`. These SHA256 fingerprints bind the callback port separately from the main-based repair:

| File | SHA256 |
| --- | --- |
| `packages/db/src/query/live/collection-config-builder.ts` | `5ef5db6bde45a6a34aa54706772041653996bd1c3e974d0dcb7104884f12cfb0` |
| `packages/db/src/collection/subscription.ts` | `bd171bdc97b38a79ebbc81d7fb605267787308559ad4c0646dff1e072a43798a` |
| `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts` | `e5ce4a77fe8d16f4b0d26f4c71fdadb53b2779c8e7e8313a7eb32d2de3ebdd38` |
| `packages/browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts` | `67c16d284522417f1a77e0a36efcc552b718f858ea8ec00771f001f001160782` |
