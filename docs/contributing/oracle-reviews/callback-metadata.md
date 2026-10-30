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
Three direct-source controls, 66 inline array/materialized histories, 33 compiled
Collection rejections and 17 checker/recorder controls complete 746 tests.

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

A recursive QueryRef or joined subquery exports a source value even when its
consumer is inside an inline include. Those source boundaries now use the
existing source/projection metadata mode. The enclosing include's final value
keeps the existing inline mode. The obsolete `processFrom` mode parameter is
removed. No new metadata registry, state, traversal or public API is added.

All 746 tests pass with all 2,817 reach states at count one. Seven neighboring
suites pass 1,883 tests: root metadata, functional projection/input rejection,
route-context transport, public container copying, include query shapes and
subquery user values. Focused no-emit TypeScript, ESLint and changed-file oracle
lint pass. After integrating #2301 (`bfd1da1a7e752d66fd667adfd3cdf54f60732b22`),
the normal package pnpm configuration also passes all 746 tests and all reach.
No local build or dependency installation ran.

Two deliberately wrong repairs ran in copied source trees, without changing the
reviewed worktree:

| Mutant | Intended wrong design | Result at the shared comparison |
| --- | --- | --- |
| QueryRef-only | Keep the old joined-source mode | 29 failures, 717 passes |
| Sanitize inline | Sanitize every final child instead of preserving authored inline values | 58 failures, 688 passes |

Both mutants reached the intended callback/output comparisons. They are assertion
failures, not timeouts or setup errors. The original 348-failure RED is the
original-defect discriminator. The direct receiver prevents an outer QueryRef
from concealing an unrepaired joined-source boundary.

## Prep review and loss audit

Separate read-only review and simplification passes found no confirmed production
or oracle-enforcement defect. Both found stale opening counts. Those counts are
corrected. The review also required these planned coverage/architecture updates.

A proposed shared-query cache conflict was tested through actual Effects and
live-query Collections. Each receiver reused one projected query through a
QueryRef, then through both union branch orders. All six probes passed: the
nested callback saw no `$collectionId`. The direct Effect branch retained its
authored reserved output, which is separate from downstream callback input.
The initial Collection-union fixture supplied conflicting custom public keys;
using the compiler's union keys corrected the fixture. Those initial failures
establish no product violation.

The probe constructs the following source and nested consumer before selecting
QueryRef-only, `unionAll(projected, consumed)`, or its reverse:

```ts
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

Four retained items reconcile as two fixed documentation items, one duplicate
count correction and one refuted cache hypothesis. Both review passes are useful
for this bounded patch. Neither supplies a whole-library correctness verdict.

## Rubric accounting and limits

ORC-001–005: accepted authority, independent source facts, literate layers,
finite legal grammar, real callback captures and exact derived output cuts.
Removing receiver, path, collision, pending boolean or checkpoint loses a
named source/projection/inline distinction. Both populated union positions and
both typed keys remain represented. Direct-source controls distinguish a
blanket stripping rule. The rejected flat-union form bounds admission.

ORC-006: 17 hostile observation/recorder controls and both production mutants.
ORC-007: exhaustive finite enumeration, so random campaigns and seed replay do
not apply. A valid unrelated `utils.1` seed/path run passes all 746 tests with
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
two mutants distinguish plausible shortcut repairs. ORC-014: the declared
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
| `packages/db/src/query/compiler/index.ts` | `3982fc56163cfc44583a737b9bbf91c5aece9d6c0212324721309646a9eb488e` |
| `packages/db/tests/query/virtual-row-fields-input-oracle.ts` | `99a7357c283731adc7e7552a9e66e4b3d4df0df58576db82f4d9e5f0ef9f9265` |
| `packages/db/tests/query/virtual-row-fields-input-driver.ts` | `31a19f9988ca46b82eba13b434f8d3e1deb5ff972b7fe63df64cbb8898693b79` |
| `packages/db/tests/query/virtual-row-fields-input-oracle.test.ts` | `2d417011231e109a9ed5194f417063bc41ac46cc36ec6405aa61e8b60408cb6b` |
