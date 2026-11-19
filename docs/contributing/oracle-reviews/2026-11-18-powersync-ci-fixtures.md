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
- Fresh CI and the complete Direct package result are not established by the
  focused runs. CodeRabbit skipped the PR because its file count exceeds the
  service limit; that is not reviewed-head approval.
