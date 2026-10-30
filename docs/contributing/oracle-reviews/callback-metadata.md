# Callback metadata runtime repair

The accepted callback-input law applies before user JavaScript derives a value.
Direct source returns and structured whole-source spreads expose genuine
`$key`, `$origin`, `$hasPendingWrites` and `$collectionId`. New projected shapes,
including functional spreads, expose none of these reserved fields to downstream
callbacks. Inline include values retain their authored shape. Compiled
Collection-valued callback inputs reject before user code runs.

Authority: the maintainer's O12 decision from 2026-10-28 and the
[architecture's callback-input boundary](../../../packages/db/src/query/live/ARCHITECTURE.md#route-context-transport).
This repair enforces that existing runtime law. It revises no product contract.
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
Collection rejections and 19 checker/recorder controls complete 847 tests. Inline
values cross direct and QueryRef paths. The QueryRef path correlates each parent
with one typed-key child, so it preserves authored child fields without a child
functional callback.

Every receiving history observes initial readiness, a held optimistic update,
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
Existing mode parameters and propagation remain. The production diff changes
two call sites. It adds no metadata registry, state, traversal or public API.

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
final-head snippet verification remains for CI; the changed example passes its
focused local check.

## Rubric accounting and limits

ORC-001–005: accepted authority, independent source facts, literate layers,
finite legal grammar, real callback captures and exact derived output cuts.
Removing receiver, callback path, inline path, collision, pending boolean or checkpoint loses a
named source/projection/inline distinction. Both populated union positions and
both typed keys remain represented. Direct-source controls distinguish a
blanket stripping rule. The rejected flat-union form bounds admission.

ORC-006: 19 hostile observation/recorder controls, the three recorded production
mutants and the independent FROM-only mutant.
ORC-007: exhaustive finite enumeration, so random campaigns and seed replay do
not apply. A valid unrelated `utils.1` seed/path run passes all 845 tests with
all reach intact. A calibration-only selection passes 17 controls without
entering a receiver. Selecting only the three direct-source controls fails the
missing-matrix reach assertion. An omitted replay property was a configuration
error with zero tests, not product evidence. ORC-008–009:
source facts distinguish coherent retractions; callback input is distinct from
published row, with that abstraction stated beside the model. ORC-010: all-cut
failure reports and failure-preserving cleanup. ORC-011: the concrete shared-cache
hypothesis has six same-path probes; no remaining shared-model hypothesis was
identified. ORC-012: this versioned record and source fingerprints below.
ORC-013: single/all/no collisions, typed peers, source/new/inline forms and the
three mutants distinguish plausible shortcut repairs. ORC-014: the declared
boundary is core runtime compilation, with no real-provider/framework timing
claim. ORC-015: every named callback and inline/rejection state reaches once.
ORC-016: all histories and controls use the shared independent judgments.

The runtime evidence is finite: flat inline children, at most two QueryRefs,
one LEFT join, two typed-key peers, one held successful mutation, and four cuts.
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
| `packages/db/src/query/compiler/index.ts` | `07c93e178ddf176af57f85b86479a3f2a762fd96b726f31755e7ed13eafc2fa3` |
| `packages/db/tests/query/virtual-row-fields-input-oracle.ts` | `25f729a6444f7e35526a499aefd7c624acba06348d18f4c31b9d3c2f5d7259a6` |
| `packages/db/tests/query/virtual-row-fields-input-driver.ts` | `c84cf4330e17590b3f9fc55bb449b489a3160e975966823f9ebb4fb4675f18ff` |
| `packages/db/tests/query/virtual-row-fields-input-oracle.test.ts` | `948e84d4f3400ebf8b4e867252580a613dc98e3ebb7eef0811e95727f3624337` |
