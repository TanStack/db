# Native browser receiving contexts

Parent: `e3a223de4ff556b81981ba3d2c7d0246d2412b69`. This follow-up changes test
fixtures and their instrumentation. It changes no library production code.

## Experiment and inference

The serial adapter-browser runner received a shutdown signal while native
decoder histories still progressed. After file sharding, receiver shards 2
and 3 also received shutdown signals. Their logs establish infrastructure
termination, without a semantic assertion result. They do not establish the
shutdowns' exact cause.

A separate bounded experiment established fixture accumulation. Twelve complete
native decoder histories left twelve live SharedWorkers, counted through
Chromium's browser-level `Target.getTargets`. Forced page garbage collection
left all twelve. Closing their context removed every worker. Six fresh contexts
then ran the same complete history and each left zero workers after close.

The fixture created a unique default PowerSync browser database per history,
but kept one document alive for the whole file. SDK database disposal closes
its client connection, while the default shared-worker path can outlive that
connection. The fixture owns the remaining document lifetime. This is a fixture
resource defect, not a new promise that SDK `database.close()` must terminate a
SharedWorker or proof of the runner shutdown cause.

## Repair and boundaries

`startAdapterChromium().captureFreshHistory` reuses its Vite server and browser,
but owns a fresh context for one complete history. It captures product output
before context disposal. Cleanup errors travel beside a completed observation;
setup or recording failures remain primary. Browser-error capture includes
context teardown. Context ownership begins before page creation and navigation.

Native decoder/mutation, hook, receipt and union receivers use this method.
The PowerSync saved-demand profile uses it too: its online and offline/reopen
phases remain inside the same context. Cleanup, restart, watcher release,
publication and receipt checkpoints within each history do not move. No SDK
flag, source model, comparison, construction count or existing budget changes.

The constructor inventory found no further generated unique-database route.
The peer/acceptance receivers use Convex. The baseline-lifecycle fixture reuses
one database name, bounding its shared worker count. Finite Playwright witnesses
already dispose their test contexts. The startup witness intentionally reloads
one page and origin; that premise stays unchanged.

## Evidence block

- **Law:** independent native receiving histories release their owned browser
  contexts and SDK workers after recording, preserving the observation and its
  teardown diagnostics. Authority: the fixture's independent database lifetime
  and ORC-010 resource/failure fidelity. This is not a product-policy change.
- **Reach:** `adapter-browser.native-context` generates two or three complete
  native decode histories with 1–6 rows and batch sizes 1–3. Actual SQLite page
  delivery establishes `native-history` and `repeated-history`. Each campaign
  reaches each state in 25 constructed and four random inputs. Five fresh-object
  builders and ten explicitly bound missing-state controls enforce reach.
- **RED:** the new resource comparison on the shared-page helper fails at
  `after history`, under `history resources`. The shrunk input has two histories,
  one row and batch size one. Product and cleanup diagnostics are empty, but
  workers remain. One selected unit fails, 21 others are skipped. No setup
  failure supplies this evidence.
- **GREEN:** the final resource owner passes 30/30 units, including all ten
  explicitly bound reach controls. All three teardown-fidelity controls pass.
  The replay suite passes 124/124, full browser-package TypeScript passes, and
  scoped lint/diff formatting pass. The broader affected receiver campaigns
  are still running locally when this CI follow-up is committed; final merge
  remains gated on the complete CI result.
- **Mutant:** a temporary module transform restores the original shared-page
  callback and prints its load marker. A direct replay with seed `2377`, path
  `0:0:0:0` and unit `random seed: independent native contexts 1` fails at the
  same comparison with one and two workers retained. It fails one selected
  unit and skips the other 29. This is an assertion failure, not a timeout.
- **Limits:** one dedicated receiving browser with no unrelated workers. The
  resource model checks completed valid native decode histories, not every
  SDK-internal resource. The ordinary product oracles still judge their own
  full histories. No conclusion about arbitrary hosted-runner failures follows.

Three additional real-browser controls preserve a completed marker, a late
page error and a close failure, or preserve original setup/recording failures
beside a close failure. All three pass. They are supplemental tests in the
ordinary fixture file. Shared product comparisons still own product answers.

Review caught an initial constructed coordinate outside its declared domain.
That run was 21 passed / 1 failed before the comparison and supplies no GREEN
claim. The builder now stays within 1–20. The corrected run passed 22/22 before
the ten explicitly bound calibration controls replaced the two unbound ones.
Independent review approves the current helper, scope, model and controls.

The dedicated browser config includes the new resource owner; the ordinary
Node/type collector excludes it through the same list as the other real-browser
receivers. Full package TypeScript still checks its source. Actual CLI shard
discovery selects all 35 receiver files exactly once (9, 9, 9 and 8), using the
package script that CI invokes. Its nonmatching test filter is diagnostic only
and is absent from CI. The prior 34-file partition evidence remains historical.

The replay manifest also selects the dedicated browser configuration for this
owner. Registry accounting alone does not execute every owner's host. The
official guarded replay of seed `2377`, path `0:0:0:0` and the first constructed
unit passes one selected unit (29 skipped), with one witnessed execution and
three completed runs for that exact property, seed and path.

## Oracle review and grammar controls

The model is a list of zeros, one per completed history. It does not duplicate
SDK close logic, browser targets or the context helper. Varying authored rows,
batch sizes and coordinates preserves the same independent resource law.
At least two histories distinguish bounded first-use resources from cumulative
retention. Empty source inputs are outside this decode driver's domain; existing
receipt/saved-demand owners retain their empty-result histories.

Removing history repetition loses the accumulation witness. Removing actual
SQLite delivery loses reach. A retained worker fails the resource comparison
even when all source values pass their existing native decoder judgment.
The grammar excludes zero histories and out-of-domain builder coordinates.
The direct replay retains the original failure and its resource observation.

ORC-001–007 and ORC-012–016 apply: the executable file states the authority,
independent model, bounds, actual production driver, comparison, reach and
calibrations. Fixed and fresh campaigns use the same budgets and mechanism.
The real Chromium path supplies the default SDK premise; no controlled worker
implementation stands in for it. ORC-008 does not apply to the stateless list
model. ORC-009 uses browser context in its browser sense, not as a Collection
sync run. ORC-010 is enforced by the retained cleanup wrapper and three actual
fault controls. ORC-011 has no additional shared semantic-fault hypothesis:
authored history boundaries and browser target enumeration are independent
formulations. The source scope and limits above bound the closure claim.

Commands from `packages/browser-db-sqlite-persistence`, with Node 22:

```sh
pnpm exec vitest run --config vitest.adapter-oracles.config.ts tests/native-browser-context-oracle.test.ts
pnpm exec vitest run --config vitest.adapter-oracles.config.ts tests/opfs-fixture-cleanup.test.ts e2e/native-powersync-batch-decode-oracle.browser.test.ts e2e/native-powersync-hooks-oracle.browser.test.ts e2e/native-powersync-initial-receipt-oracle.browser.test.ts e2e/native-powersync-union-oracle.browser.test.ts e2e/adapter-persisted-demand-oracle.browser.test.ts
pnpm exec tsc --noEmit
```
