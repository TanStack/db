# PowerSync CI fixture repairs: 2026-11-18

These repairs apply to PR #2446 after `4ce044243648d958c1df55d58b2d88b2a42d19e4`.
They change test hosts and provider delivery premises. Production, independent
models, history domains, public comparisons, run budgets and deadlines are
unchanged. They do not repair the deferred standalone SDK checkpoint defect.

## Law and authority

The existing initial-receipt and on-demand-streams contracts remain authoritative
in `packages/db-adapter-conformance/`. A receiving host must load its runtime
prerequisites and deliver authored provider input before recording the specified
cut. Establishing that input must not wait away an application receipt that the
history deliberately holds for comparison.

Three fixture errors violated those premises:

- Receipt subprocesses bypassed Vitest setup. On Node 22 the installed standalone
  SDK therefore lacked the Map methods supplied by the existing test-only setup.
  Both workers now import that setup. This does not establish consumer runtime
  compatibility; that still requires an SDK release.
- The ordinary `FakeService.sync()` fixture delivered its complete answer only
  to the initial request. Query application can replace that request. A successor
  now receives the last complete authored answer. Manual checkpoints, transport
  errors and close clear replay, preserving explicitly controlled histories.
  Oracle users of this class author individual checkpoint/data/completion lines;
  they do not call `sync()`. The cleanup test counts requests after preload so
  it still requires a new cleanup request.
- The persisted on-demand driver classified its confirmed-empty donor, version
  `-1`, as a deliberately held application. The optimistic transaction does not
  exist yet at that point. That donor now drains actual application and storage;
  judged versions `0` and `1` keep their existing held provider cut.

## RED and GREEN evidence

All Node commands used Node 22.23.5. Logs are retained under the task-local
`.review-2377/ci-loop/` directory.

| Boundary | Before repair | After repair |
| --- | --- | --- |
| Receipt workers | Six selected cleanup replays fail on unchanged worker setup; explicitly loading setup is the successful control. `receipt-node22-red-retry.log` | Initial receipt, persisted receipt and cleanup files: **89/89 pass**, 39.05 s. `receipt-node22-green-retry.log` |
| Ordinary collection service | Both on-demand query examples time out before the successor receives a checkpoint. Protocol diagnostics identify the replaced request. | Complete collection file: **14/14 pass**, 1.16 s. `direct-collection-node22-green-retry.log` |
| On-demand input cuts | CI run `44358798135`, job `134994692798`: three confirmed-empty donor setup failures before the shared comparison. Isolated checks passed even before the repair, so they are not independent causal proof. | Node conformance, persisted conformance and delivery helper files: **1,361/1,361 pass**, 28.62 s. `direct-on-demand-node22-green-retry.log` |
| Real Chromium/OPFS | Same saved CI failures above. | Entire persisted Direct on-demand file plus OPFS cleanup calibrations: **455/455 pass**, 206.65 s. `direct-donor-browser-green-retry.log` |

Commands, with the Node 22 binary first on `PATH`:

```sh
pnpm --dir packages/powersync-direct-collection exec vitest run tests/initial-receipt-oracle.property.test.ts tests/persisted-initial-receipt-oracle.property.test.ts tests/persisted-initial-receipt-cleanup.test.ts --coverage.enabled=false --typecheck.enabled=false
pnpm --dir packages/powersync-direct-collection exec vitest run tests/collection.test.ts --coverage.enabled=false --typecheck.enabled=false
pnpm --dir packages/powersync-direct-collection exec vitest run tests/on-demand-streams-conformance-oracle.property.test.ts tests/on-demand-streams-persisted-conformance-oracle.property.test.ts tests/direct-input-receiving.test.ts --coverage.enabled=false --typecheck.enabled=false
pnpm --dir packages/browser-db-sqlite-persistence exec vitest run --config vitest.adapter-oracles.config.ts e2e/powersync-direct-persisted-subsets-oracle.browser.test.ts tests/opfs-fixture-cleanup.test.ts
```

Direct TypeScript, scoped ESLint, `pnpm check:mangle`, `pnpm lint:changed` and
`git diff --check` pass.

The complete package command, `pnpm --dir packages/powersync-direct-collection
test`, subsequently finished on Node 22 with coverage and type checking enabled:
**2,648 passed, 177 failed**, 746.78 s, no type errors. Nineteen files pass. All
177 failures belong to the unchanged eager live-source oracle: twelve HEALTH-2
recovery violations and 165 calibrations unable to obtain a clean trace because
of that defect. The minimized trace is an empty snapshot, delivery error, empty
change batch, then empty snapshot. The old stream error remains after the healthy
checkpoint. This is the deferred SDK defect, not a new fixture regression. The
full log is `direct-full-node22-retry.log`.

## Reach, challenge and review

The full existing generated campaigns and shared checker calibrations passed in
the focused runs above. No new reach or product-defect closure is claimed. The
existing pending-receipt paths remain admitted; only their pre-transaction donor
input now uses an application cut.

The independent oracle reviewer approved the six-file diff with no actionable
findings. An independent Node 22 protocol challenge verified five properties:
successor replay, independent request recording, and replay clearing after a
manual checkpoint, close and transport error. The challenge exited zero. The
reviewer also checked every oracle caller of `FakeService` and the location of
donor delivery relative to optimistic transaction creation.

Restoring the old fixture yields a startup or delivery-premise failure, not a
semantic product mutant kill. Existing shared comparison calibrations remain
the checker challenges. These results must not be presented as new product
mutant evidence.

Reviewed SHA-256 prefixes: collection test `93d8a79b`, FakeService `2c5afd91`,
initial worker `29b2bef8`, on-demand driver `0f0cd013`, persisted worker
`0de0296b`, host setup `075143c9`.

## Follow-up: resolved storage adapters

A repeated native Chromium diagnostic exposed a separate receiving-instrument
defect. All 50 late cuts reported storage revision zero despite durable writes.
The ledger wrapped only the default adapter. Browser persistence lazily resolves
a different adapter for the Collection, bypassing that wrapper. This is a
demonstrated observation defect; it does not by itself establish the cause of
the earlier CI query-readiness mismatch.

The ledger now wraps adapters returned by both persistence resolvers, without
resolving them early. Cached callable proxies preserve the original receiver,
exact returned Promise and callable properties, including
`runInRegularScope.afterQueuedWork`. Scope callbacks retain the original scoped
adapter; their enclosing observed Promise spans all legal nested work. The
observation barrier, including its existing continuation allowance, is unchanged.

The new ordinary helper calibration runs independently from the product oracle.
Before the repair, both resolver routes report pending/revision zero instead of
one, and the callable capability disappears: **three failures, one passing direct
control**. After the repair, all **four pass**. The independent oracle reviewer
reproduced that GREEN result on Node 22 and approved driver SHA-256
`b6ea8870a29fc0db39cc3b975da1fcecee7c7b6a0ff92ae2bb2a2dede7db5e89`,
with no actionable findings. Restoring the old ledger is the instrument fault
injection; no production mutant was introduced.

The complete shared receiving campaigns and their checker calibrations then
pass on unchanged production: **166 Node 22 checks** (150 across five adapters,
12 Convex peer checks and four helper controls), **150 Chromium/OPFS checks**
across the same five adapters, and **12 Chromium/OPFS Convex peer checks**. Every
adapter reaches all 13 declared shared states. Each host reports the per-adapter
state counts in its normal campaign output. TypeScript, ESLint, private-name
checking, `lint:changed` and diff checks pass.

All ten shared adapter/host campaigns report these same history counts:

| Declared state | Histories |
| --- | ---: |
| changed-value late answer supplied after covered reopen | 1 |
| closed and reopened storage | 23 |
| covered load waits for the deadline | 2 |
| first covered applied | 5 |
| first empty applied | 3 |
| first failed acquisition | 3 |
| first never requested | 5 |
| first overlap applied | 4 |
| first pending acquisition | 3 |
| restored source rows before deadline | 2 |
| uncovered load fails with its upstream | 4 |
| uncovered offline | 15 |
| window covered offline | 8 |

```sh
pnpm --dir packages/db-adapter-conformance exec vitest run tests/persisted-demand-storage.test.ts tests/persisted-demand-receiving-oracle.test.ts tests/persisted-demand-peer-oracle.test.ts --coverage.enabled=false
CI=true pnpm --dir packages/browser-db-sqlite-persistence exec vitest run --config vitest.adapter-oracles.config.ts e2e/adapter-persisted-demand-oracle.browser.test.ts
CI=true pnpm --dir packages/browser-db-sqlite-persistence exec vitest run --config vitest.adapter-oracles.config.ts e2e/adapter-persisted-demand-peer-oracle.browser.test.ts
```

The corresponding logs are `demand-storage-red.log`, `demand-storage-green.log`,
`demand-storage-node-receivers-green.log`,
`demand-storage-browser-receivers-green.log` and
`demand-storage-browser-peer-green.log` in the same task-local directory.
The browser receiver uses `SingleProcessCoordinator`, which registers the wrapped
resolved adapter. This repair does not cover `BrowserCollectionCoordinator`'s
separately registered raw adapter route. The 50-run pre-repair diagnostic also
recorded two histories with a different count of first-session sync-start events;
neither reproduced the CI readiness mismatch. A concurrent post-repair stress
attempt stopped at an OPFS worker failure before its first result and supplies
no GREEN evidence.

The subsequent serial run completed all **50** repetitions on bundled Chromium.
Every late cut reports storage revision **34**, no pending storage or receipts,
the same five source events, query status `ready` and fulfilled preload. This
demonstrates actual storage observation and bounded trace stability after the
repair. It does not turn the earlier failure into a causally isolated
reproduction of the CI readiness mismatch. The raw log is
`native-repeat-probe-repaired-serial.log`.

## Open boundaries

- The unchanged-checkpoint recovery defect remains open under the maintainer's
  decision to await the supported SDK event API. See
  [the SDK proposal](2026-11-17-powersync-standalone-checkpoint-api.md).
- Consumer compatibility on maintained Node versions still needs the separate
  SDK Map-method repair; importing test setup does not discharge that obligation.
- CI native PowerSync saved-demand determinism still differs at the late-answer
  cut. An unchanged isolated rerun passes, which does not resolve the failure.
  A second independent reviewer found no justified barrier repair from the
  available trace. Raw provider settlement can precede wrapper coverage work;
  further reproduction needs neutral-work diagnostics, not readiness polling
  or a relaxed comparison.
- The RxDB page-export discovery timeout remains intermittent: the affected
  cleanup file passes unchanged in the focused Chromium run, but a full CI retry
  is still needed. No timeout was increased.
- Fresh CI is pending after fixture commit `fd169ed4b`. CodeRabbit skipped the
  PR because its file count exceeds the service limit; that is not reviewed-head
  approval.


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
