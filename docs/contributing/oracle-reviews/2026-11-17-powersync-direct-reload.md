# PowerSync Direct eager reload and receipt review: 2026-11-17

Production head: `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`. No production source was changed for this evidence. The test slice is frozen pending final correction reapproval; exact source hashes appear below. This record reports RED instruments and successful neighboring contracts, without claiming GREEN or bug-class closure.

## Laws, authority and repair boundaries

- A complete eager result replaces source membership and values, including omitted rows. Until source entry, reload retains the previous public rows. Authority: the existing shared eager-reload law, glossary reload/snapshot/accepted sync transaction, READY-3/PUB-7, and optimistic-history settlement contract. The existing grammar, seed 2367, budget 80 and comparison are preserved. The added Direct receiver uses truncate replacement rather than the older adapters' snapshot flag.
- A terminal initial-gate failure rejects preload or reload. Reload retains its public rows/status. A new Collection sharing a provider that already reports a terminal stream failure still receives a rejection. Authority: Collection `reload()` API, glossary initial gate/loading error/reload, and the adapter's documented stream-error rejection. A healthy new sync run can recover. The model derives verdicts from the authored source outcome, independently of SDK callbacks or production status.
- Cleanup invalidates a sync run with an initial receipt held or already applied, leaves an empty cleaned-up snapshot, and owns rejection of its receipt continuation. No detached error may escape. Authority: Collection commit/cleanup API, glossary cleanup/applied receipt and lifecycle/optimistic-history contracts. The model deliberately does not require loading while a receipt is held: a persistence wrapper may independently restore rows and become ready.

The terminal failure finding is production's ignored eager `lease.waitForSync()` rejection. Ready reload and a new Collection joining an already-failed shared provider remain pending. The receipt finding is a detached `AbortError` after cleanup rejects a held initial receipt. Same-connection stream-health recovery is a neighboring finding owned by the eager live-source instrument; this report does not substitute new-run recovery for that law.

## Production paths and observation cuts

Direct Node and Chromium receivers use the installed `@powersync/standalone-client` 0.1.1. Controlled NDJSON supplies complete checkpoints and terminal stream descriptions; the real client owns parsing, subscription sharing, waiter rejection, rows, status and adapter callbacks. The eager driver records raw promise outcome, rows, Collection status, health and new sync invocation after the SDK drains the finite response and its promise continuations run. A pending verdict is compared as a value; a timeout is not the RED result.

For a shared-provider history, a ready peer consumes the provider failure before target preload. Raw `sharedFailureBeforeTarget` and actual SDK terminal callbacks/rejections establish that premise. A fresh target joining the same union has no new callback requirement: its lease's rejected waiter still supplies enough information to reject its public preload. Retry histories prepare a healthy source, then record that the target actually starts a new sync run and fulfills ready without errors.

The controlled receipt driver runs in a native child process, holds the actual commit receipt boundary, records actual `unhandledRejection` events, returns `RECEIPT_OBSERVATION`, and exits zero. Worker setup failure, crash or timeout rejects before the oracle comparison and is not counted as a product failure. Chromium eager receivers reuse the same comparison and add captured browser errors as raw receiving observations. Actual persisted receipt receivers are owned and evidenced by the packaging author.

## Commands and outcomes

Runtime `NODE26` below means `/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node`; Node 24 lacks the SDK's required `Map.getOrInsertComputed` and is not a valid test runtime.

From `packages/powersync-direct-collection`:

```sh
$NODE26 ../../node_modules/vitest/vitest.mjs run tests/eager-reload-conformance-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false --reporter=dot
$NODE26 ../../node_modules/vitest/vitest.mjs run tests/initial-receipt-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false --reporter=dot
```

From `packages/browser-db-sqlite-persistence`:

```sh
$NODE26 ../../node_modules/vitest/vitest.mjs run --config vitest.adapter-oracles.config.ts e2e/powersync-direct-eager-oracle.browser.test.ts --reporter=dot
```

| Evidence | Result | Interpretation |
| --- | --- | --- |
| `reload-success-neighbor.log` | 103 passed | Direct unchanged successful reload family, including omitted-truncate source mutant and raw wrong-answer controls. |
| `reload-neighbor-rxdb.log` | 103 passed | Existing RxDB grammar, model and checks remain valid. |
| `reload-neighbor-powersync-sqlite.log` | 103 passed | Existing SQLite-backed PowerSync grammar, model and checks remain valid. |
| `reload-fixed-red.log` | 4 failed, 8 passed, 134 skipped | Explicit/default fresh failures reject; reload/shared fixed histories fail at `terminal verdict`. |
| `reload-final-node-red.log` | 30 failed, 140 passed | 22 product-law assertion failures; 8 bound missing-state calibrations cannot obtain a clean reload/shared baseline while production is broken. Those 8 are not mutant kills. |
| `reload-final-chromium-red.log` | 22 failed, 119 passed, 29 skipped | Successful reload families pass; generated/fixed terminal histories fail at the same public verdict. Browser receiving errors are empty. Calibrations were excluded in this command. |
| `receipt-fixed-red.log` | held-receipt fails; applied neighbor passes | Failure is solely `detachedErrors`, containing the observed `AbortError`. |
| `receipt-generated-red.log` | 10 failed, 16 passed | 7 product-law failures solely at `detachedErrors`; 3 bound missing-state calibrations lack a clean baseline and are not kills. |

All listed RED results reach a model comparison. Earlier setup/race investigation in `reload-first-run.log`, the first sandbox EPERM, and the replay attempt without UNIT are excluded from product evidence.

## Grammar controls

Reconstruction: the original reload/shared failure witnesses are fixed histories fed to the same model/driver/comparison as generated runs. The shrunk reload witness is `{entry:'reload', previous:0, source:'explicit', next:0, failure:0, retry:false}`; the receipt witness is `{rows:0, cleanupAt:'held-receipt', reason:0}`. Default stream, shared-provider and held nonempty source witnesses are reconstructible by their respective grammar coordinates.

Ablation: removing fresh loses the passing terminal-rejection neighbor; removing reload loses retained rows and public reload settlement; removing shared loses cached rejection without a second callback; removing source kind loses default stream routing; removing retry loses a new sync run and recovery reach; removing source masks loses empty/overlap/omission states; removing receipt schedule loses the applied-before-cleanup neighbor; removing actual detached-error capture loses the receipt failure. Failure/reason labels distinguish the commanded failure from unrelated errors. Existing successful reload's mutation coordinate protects ordinary-versus-snapshot accepted/applied scheduling.

Range: source masks are 0..7 over three keys, failure/reason labels 0..9, and both cleanup schedules are legal. Gate histories have three entry modes, two source kinds, one terminal outcome and optional one healthy new run. This is bounded lifecycle evidence, not arbitrary concurrency. Exclusion: fresh histories must have previous=0; there is no fresh retained baseline, unbounded retry loop, concurrent mutation grammar or illegal use of a cleaned-up Collection.

## Declared reach and calibration

Successful reload retains 11 declared states. Each has one fresh-identity randomized builder and a missing-state control. Fixed seed2367's 80-run generated campaign reports: changed-overlap17, empty-result14, fresh21, fresh-held14, no-mutation34, omitted-row22, persisting-mutation46, reload-empty28, reload-empty-held13, reload-retained31, reload-retained-held19. The random campaign also reaches every state; exact counts remain in the log. Each named construction reaches its state once, enforcing the campaign minimum1.

Terminal gate declares12 states: every explicit/default × fresh/reload/shared terminal state, plus each corresponding recovery state. Each has a distinct randomized builder and bound missing-state control. On broken production, terminal reload/shared comparisons fail before a complete campaign can establish passing reach. Their raw records prove terminal SDK failure and the shared-provider premise; they do not establish successful recovery. Fresh explicit/default terminal and recovery constructions each report count1 in fixed and random campaigns. Recovery reach requires an actual new target sync invocation and fulfilled ready/error-free observation. All12 successful minima must be re-established after repair; no zero or absent passing count is presented as coverage.

Receipt declares held-receipt, after-application, empty-source and nonempty-source, each with a randomized builder, distinct object identity, generated-output obligation and bound missing-state control. Held-receipt histories reach the actual receipt premise but fail the detached-error comparison. The passing applied construction reports after-application1/nonempty-source1 in both campaigns; random empty-source construction reports empty-source1. The complete passing campaign and all minima remain pending repair.

Wrong pending/fulfilled gate outcomes are rejected on a bound clean fresh failure. A synthetic detached error is rejected on the bound clean applied receipt neighbor. The successful reload source mutant omits truncate and is rejected by the row comparison, not setup or timeout. Raw-row, optimistic-overlay, acceptance and reach mutations are also rejected. Existing reload controls retain the framework's transitional candidate-search warning; new gate/receipt controls are explicitly history-bound.

Reviewer correction for ORC-010: a completed receipt observation now carries optional receiving `cleanupErrors`. The shared check judges the product first and retains the original `initial receipt cleanup` law at `after cleanup`, including secondary teardown errors in raw detail. If the product passes, teardown alone reports `receiving cleanup` at its distinct checkpoint. Bound controls inject cleanup alone and a detached receipt rejection plus cleanup; they require the receiving law and original product law/difference respectively. `receipt-cleanup-calibration.log` reports6 passed across controlled Direct and both persisted Node receivers. Setup failures before any raw observation remain setup failures. The original full receipt counts above precede these two additional controls.

## Exact replay

The guarded `packages/db/tests/oracle-replay.ts` ran one nonzero execution for every new property, with PROPERTY/SEED/PATH/UNIT supplied. Node and Chromium reload: seed2367/path0/unit `random seed: generated`, one pass. Node and Chromium gate: seed2377/path `0:0:0:0`/unit `random seed: explicit reload terminal gate`, one `terminal verdict` assertion failure. Controlled receipt: seed2377/path `0:0`/unit `random seed: generated held-receipt`, one `after cleanup` assertion failure on `detachedErrors`. Logs are `reload-replay-node-success.log`, `reload-replay-chromium-success.log`, `reload-replay-node-gate-red.log`, `reload-replay-chromium-gate-red.log` and `reload-replay-receipt-red.log`.

The command form from the respective package is:

```sh
TANSTACK_DB_ORACLE_PROPERTY=PROPERTY TANSTACK_DB_ORACLE_SEED=SEED TANSTACK_DB_ORACLE_PATH=PATH TANSTACK_DB_ORACLE_UNIT=UNIT $NODE26 --import tsx ../db/tests/oracle-replay.ts FILE --coverage.enabled=false --typecheck.enabled=false --reporter=dot
```

Browser commands add `--config vitest.adapter-oracles.config.ts`; they require the local Vite server and native Chromium host. The guard's JSON witness records exact property/seed/path, `numRuns:1`, `executions:1` and the expected failed flag. Supplying no UNIT was correctly rejected before execution and is not replay evidence.

## ORC accounting and limits

| Requirement | Outcome |
| --- | --- |
| 001 authority/limits | Laws, accepted authorities and bounded claims appear beside model and registration and above. No new product design is inferred from current output. |
| 002 independence | Expected verdict/rows/cleanup derive from authored history and set membership; SDK status/error classifiers do not compute the expected answer. |
| 003 literate responsibilities | Pure models/grammars, generic registration/checker, production adapters and host recorders are separate named companions with nearby explanations. |
| 004 grammar | Reconstruction, ablation, range and illegal nearby history are accounted above. |
| 005 path/cut | Real SDK and adapter; exact public verdict/rows/health and actual detached host events; terminal callback/cached rejected waiter reach is recorded. No missing-source-fact hypothesis remains for rejected preload/reload. |
| 006 calibration | Relevant wrong answers and omitted-truncate source mutation fail comparisons; calibration baseline failures are explicitly excluded from kills. |
| 007 campaigns/replay | Same property/driver/model/check/budget fixed and random campaigns; exact guarded replay witnessed for all five IDs. |
| 008 minimality | Stateless recomputations; no stateful reference-machine state is introduced or merged. |
| 009 vocabulary | Initial gate, reload, source receipt, cleanup and retained rows use glossary concepts. `shared` denotes two Collections sharing one SDK client/provider session, not a new Collection state. |
| 010 fidelity | Raw verdicts survive as observations; native receipt recorder exits zero; setup/timeouts remain distinct. Optional receiving cleanup diagnostics preserve the completed product judgment; both cleanup-only and combined-failure controls pass. Packaging supplies matching host preservation. |
| 011 second formulation | No named plausible shared semantic fault requiring a different formulation has been identified. Host agreement is receiving evidence and is not represented as an independent second model. |
| 012 review/closure | This report records each applicable requirement. Production remains RED; no closed-class or GREEN claim. |
| 013 boundary witness | Fresh failure versus reload/shared failure; held receipt cleanup versus applied receipt cleanup; omit truncate versus retained-row replacement. |
| 014 handoff | Same eager grammar/model/check reaches native Chromium. HTTP/service remains controlled. Actual persisted receipt uses the same wrapper under packaging's receiving witnesses. No deployed-service evidence is claimed. |
| 015 reach | Explicit states, fresh builders, generated-output checks and missing-state controls; successful and blocked minima are distinguished above. |
| 016 law-only files | Fixed witnesses are histories to shared law/model/driver/check, without separate expected answers or ordinary unit tests. |

The controlled service does not establish real PowerSync service authorization, network retry semantics, deployments or remote durability. Three-key masks do not establish arbitrary schemas, IDs or writes. Receipt cleanup here does not establish every browser/storage crash cut. Terminal recovery here is one newly started sync run, not same-connection stream recovery. Full GREEN campaigns, bound calibration kills whose baselines are currently broken, and passing12-state gate/4-state receipt reach remain required after production repair. The parent owns full-diff lint; scoped authored-file lint has no errors and four require-await warnings.

## Pre-edit inventory and scope amendment

Reviewed production head: `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`.
Recorded before editing the oracle or production source. Production remains unchanged.

## Laws and authorities

1. Complete eager results replace source membership and values, with the retained rows visible before the next sync run supplies its result. The glossary's reload/snapshot law and existing `db-adapter-conformance/tests/eager-reload-oracle.ts` own this judgment.
2. A terminal source failure before an eager initial gate opens rejects preload; during reload it rejects reload and retains the previous public rows and status. Authority: Collection `reload()` API documentation (`packages/db/src/collection/index.ts`) and glossary initial gate, loading error and reload; direct adapter's documented stream-rejection behavior.
3. A new Collection using a provider session that already reports a terminal stream failure still receives its own initial-gate verdict. Provider sharing cannot turn rejection into an indefinitely pending preload. This is the same law as 2 at a shared-provider receiving path.
4. A source receipt may settle asynchronously. Cleanup invalidates the sync run, cancels its receipt, and owns its asynchronous continuation. That continuation must not create an unhandled rejection. Authority: `SyncAppliedReceipt`/commit contract, glossary cleanup and applied receipt, Collection lifecycle and optimistic-history oracle contracts. The controlled receipt witness claims this sync-boundary law only.

## Receiving paths and observation cuts

| Path | Controlled premise | Public observation cuts | Required before production changes |
| --- | --- | --- | --- |
| Direct eager adapter, explicit stream, real installed standalone SDK | NDJSON complete checkpoints, empty/nonempty source and omission/change | before source entry, preload/reload fulfillment, mutation settlement and source receipt application | shared existing success model with direct receiving driver |
| Direct eager adapter, explicit or default stream, real SDK | terminal stream rejection on fresh load or reload | after SDK consumes terminal checkpoint: promise verdict, exact retained rows/status, node error | shared eager initial-gate failure grammar/model/driver |
| Two direct eager Collections on one real SDK client | ready first Collection retains a rejected stream, second joins the unchanged provider subscription union | provider failure consumed before second preload; second promise verdict and status after propagation | same shared gate model, with shared-provider grammar entry |
| Direct eager adapter through controlled asynchronous commit boundary | first complete source transaction's receipt held, then fulfilled/rejected/cancelled by cleanup | while receipt held, after fulfillment/failure/cleanup, process detached rejection recorder | separate generated controlled-receipt law and actual Node subprocess receiving recorder |
| Existing unwrapped RxDB and SQLite-backed PowerSync | real local SDK successful complete results | existing success-family cuts | preserve exact grammar, comparisons, seed, budget and existing registrations; rerun available neighbors |
| Actual SQLite persistence wrapper or Chromium/OPFS | real durable step and native host cancellation | durable acceptance/application and browser page errors | **not established here**; no persistence function or existing persistence receiving witness is changed; controlled receipt does not claim these paths |
| Real PowerSync network service or browser host | native auth, transport and service protocol | real-service/browser delivery and detached errors | **not established here**; real SDK plus controlled NDJSON remains the named boundary |

## Grammar controls and independence

The existing success grammar remains unchanged. Its three-key masks cover empty, disjoint, overlapping and omitted results with/without a held disjoint optimistic insert. New terminal-gate histories vary fresh/reload/shared-provider entry, explicit/default stream, baseline membership and failure label. Fresh starts cannot claim retained rows. A complete result and a terminal failure are distinct outcomes; the model does not derive a verdict from the adapter's status or callback choice.

The receipt grammar varies source membership and held receipt outcome: fulfill, reject, cleanup. Its model predicts from the authored outcome; it never imports adapter control flow. The subprocess reports raw public status, rows, receipt cancellation and actual `unhandledRejection` events. It exits normally even when it records a detached rejection so the shared comparison supplies the RED result.

Every added generated law will register through `oracleProperty`, retain fixed regressions as histories, construct required states from randomized coordinates, check generated construction reach independently, and calibrate a wrong raw observation. No production repair is authorized until independent oracle review approves the entire test diff and RED results reach these comparisons.

## Scope amendment before production repair

The receiving scope expanded during test authoring, while production remained at the head above. Chromium now runs the exact shared eager-reload and eager-gate grammars, models, comparisons, constructions and calibrations through the real SDK, with native browser error recording. The final receipt grammar isolates cleanup while the receipt is held and cleanup after application; it does not claim a standalone source-rejection schedule. The packaging author separately supplies actual SQLite and Chromium/OPFS receipt receivers using the same receipt law and registration. Those receivers establish their own storage premises; the controlled receipt driver does not establish them by analogy.

## Exact reviewed test source hashes

SHA-256, after the ORC-010 correction and before any production repair:

```text
b2da97adf243bc7e4fc54d5ec60e2cdbcbe886fab12d49ea3bb8d909f1e4334c  packages/db-adapter-conformance/tests/eager-reload-oracle.ts
176f39c9257282404dc2b7a953381bbbfcc64d80923732a0f2c42531f70279f8  packages/db-adapter-conformance/tests/eager-reload-driver.ts
a0a536dccaccb73b1cda216702aa5ce476fb14ef8cba07722af34aa303e20b81  packages/db-adapter-conformance/tests/eager-reload-oracle-suite.ts
b174157440cf9012c15cbc6957bf8d9c3b2e74cdafbbaead93c081fd12213368  packages/powersync-direct-collection/tests/eager-protocol-service.ts
5136994d409a31bb0b29dd58e4fef373c06a15f5ee516f53cefe1b3e8caae002  packages/powersync-direct-collection/tests/eager-reload-driver.ts
f7a4a829fd56fb944beb04beb1b4836a32fde2437ab03bcd05276040e5736118  packages/powersync-direct-collection/tests/eager-reload-conformance-oracle.property.test.ts
ed6594285727f700a4df0bb75a96554f01b231a2d003ce632f924ce23ec68200  packages/powersync-direct-collection/tests/initial-receipt-oracle.ts
cdf79c9983fbe94930f53520f2720cc9e23bf85178c1ba2a6d9e8ac3409d08f6  packages/powersync-direct-collection/tests/initial-receipt-driver.ts
0c815ad1e5fbce157f769e050b6bfdc5a124fc6b0b656e032ff7ad5d4d04d66a  packages/powersync-direct-collection/tests/initial-receipt-worker.ts
9e13747e0bbc4ea94ae16ad5e00f749e1e802349c6ce4c5a887b8ddf97373a11  packages/powersync-direct-collection/tests/initial-receipt-oracle-suite.ts
8ad353d9b6508d65603d70f4f07cd62c2b8e39462f60105e727fea2183f780d3  packages/powersync-direct-collection/tests/initial-receipt-oracle.property.test.ts
9dee10ec0b1db87a791dfbac21aca8134b59f48b5a1f0f86252dad27e25efa49  packages/browser-db-sqlite-persistence/e2e/powersync-direct-eager-oracle.browser.test.ts
```

The parent reported independent source-slice approval before the ORC-010 correction. The correction changes only optional receiving cleanup diagnostics and two bound calibrations; reapproval is pending at this record revision. The five guarded exact replays above each recorded one execution. The original production head remains unchanged. Full portfolio approval is a separate gate.
