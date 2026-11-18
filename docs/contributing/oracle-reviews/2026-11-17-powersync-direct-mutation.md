# PowerSync Direct mutation receiving review, 2026-11-17

Production revision: `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`, unchanged when these comparisons ran. This family discovered an integration coverage gap, not an observed production defect. Its result is neighboring GREEN, with no claimed defect RED.

Law: `docs/collections/powersync-direct-collection.md`, Writing Data, promises awaiting explicit confirmation after backend commit and a handoff from optimistic to confirmed rows without flicker. The existing `packages/db/tests/mutation-confirmation-oracle.ts` owns row/handler outcome/source acceptance; its old Query and Electric predictions remain unchanged. A minimal adapter/checkpoint vocabulary extension counts the direct adapter's explicit checkpoint POST. Cancellation separately judges requested versus accepted confirmation under the public signal and cleanup contracts.

Receiving inventory expansion: before any production repair, review requested both eager and on-demand mutation receiving paths. The latter now retains a real live-query Collection and acquisition throughout mutation. No eager result is credited to that path. All 12 mode × CRUD × handler/explicit-transaction paths have randomized constructed witnesses; both checkpoint-response schedules are generated. All eight mode × signal/cleanup × handler/explicit-transaction cancellation paths have their own constructed witnesses. Rows carry generated text and an optional untouched peer.

Node command (cwd packages/powersync-direct-collection):
`/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node ../../node_modules/vitest/vitest.mjs run --coverage.enabled=false tests/mutation-confirmation-oracle.property.test.ts tests/mutation-confirmation-cancellation-oracle.property.test.ts`

Node GREEN after the independent checkpoint review repair: 242 tests, normal fixed-seed 2377 and fresh-seed campaigns, original run budgets 60 confirmation/30 cancellation per campaign, plus declared constructions, missing-state controls, wrong-answer calibrations and determinism. Log: `mutation-two-obligations-node.log`. Each of the 12 mutation receiving paths and eight cancellation paths has at least one constructed history in each campaign, separately from the generated campaign's printed counts.

Chromium command (cwd packages/browser-db-sqlite-persistence):
`/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node ../../node_modules/vitest/vitest.mjs run --config vitest.adapter-oracles.config.ts e2e/powersync-direct-mutation-oracle.browser.test.ts`

Chromium GREEN after that repair: the same 242 tests, history grammar, model, comparison, constructions, calibrations, fixed/fresh budgets, and detached browser-error check. Real Chromium executes the shared pure production driver and real standalone SDK; only the controlled NDJSON service is substituted. Log: `mutation-two-obligations-browser.log`. Browser Error identity is recorded as a same/other relation before JSON transport, then restored for the shared check. The first sandboxed attempt failed at the local listener before running a history; only the subsequent permitted listener run supplies GREEN evidence.

Checker mutants: a prematurely accepted checkpoint at the requested-but-held cut, acceptance after only the HTTP response, acceptance after only source download, and an intervening stale publication each fail `mutation confirmation`; a false successful confirmation after cancellation fails `mutation cancellation`. Bound controls delete each constructed witness's required state and fail the same named law. These are executed wrong-observation calibrations, not production source mutation kills.

Independent review correction: `oracle_diff_paths` found that the earlier driver released both confirmation obligations before making its next pending-state comparison. The repaired response-first path awaits actual SDK consumption of `response.json()` while source delivery stays held, drains the resulting continuations through a task boundary, and checks `checkpoint-response-received`. The checkpoint-first path awaits an actual SDK TableChanges callback while the HTTP response stays held, drains continuations, and checks `checkpoint-downloaded`. Both cuts use the existing shared model's pending `confirmation-requested` prediction. No product expectation changed. Both pending states are declared, constructed, measured, and calibrated. Cancellation also checks the response-consumed/source-held state before canceling. Frozen source hashes are in `mutation-two-obligations-sha256.txt`.

Existing-owner compatibility: the unmodified Query/Electric model calibration suite passes 13 tests (`mutation-existing-calibration.log`). Targeted ESLint after the checkpoint repair passes (`mutation-two-obligations-lint.log`). Repository `scripts/agent-lint-feedback.mjs` also passes after the repair (`mutation-two-obligations-lint-changed.log`). Final `pnpm lint:changed` passes after the review record was added (`mutation-final-lint-changed.log`). Explicit package tsc has no mutation-file errors, but unrelated concurrent decode-refusal and wa-sqlite resolution errors remain in `mutation-typecheck.log`; this is not a clean package typecheck claim.

Limits: one handler at a time; real SDK and browser over controlled protocol framing, no remote PowerSync-service authority; no concurrent writers, persistence wrapper, SSR or arbitrary authentication/transport-failure timing. Publication snapshots judge ordinary authored row fields; virtual row metadata is outside the shared mutation owner's law. The full independent review/fix loop is owned by the parent reviewer.

## Frozen independent review

Recorded at 2026-11-17 15:24 UTC against production head `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`. This is an append-only review entry; later changes need a new entry and evidence. The new receiving files were uncommitted at this review, so the SHA-256 manifest below identifies their exact content.

Reviewer `oracle_diff_paths` verified all ten frozen source hashes, independently reran Node (242/242), inspected the Chromium (242/242) log and shared page/runner wiring, and approved the repaired checkpoint/path slice. The reviewer reported no other actionable finding within that scope. This approval concerns the instrument; no mutation production repair was needed or performed.

| SHA-256 | Reviewed source |
| --- | --- |
| `50960eb65ba6ba75adeff901cdee172cff3754f39cc9282e771a2bd18962ab0e` | `packages/powersync-direct-collection/tests/mutation-confirmation-cancellation-oracle.property.test.ts` |
| `1e08a666e1b18eabacba26b481ad5a4212b818e59a7670cf139846bb1da55f51` | `packages/powersync-direct-collection/tests/mutation-confirmation-cancellation-oracle.ts` |
| `0dbff88dea7368c75a4e96f7064a54ef7dd3420fa16b281099188029ba48b0e7` | `packages/powersync-direct-collection/tests/mutation-confirmation-cancellation-registration-oracle.ts` |
| `983a05df2338e704a23454cd2ed8930a1d0cfd4343e6d07e73434a34e4cacc81` | `packages/powersync-direct-collection/tests/mutation-confirmation-driver.ts` |
| `d90eba5ca6746c7fa1ed84159384fd30156c1eb452c091d18bbbb098c11af787` | `packages/powersync-direct-collection/tests/mutation-confirmation-history-oracle.ts` |
| `1e854d7b4f28eeb124490f78f94355dee3a4c76e25a5e803cabebbd6625739fc` | `packages/powersync-direct-collection/tests/mutation-confirmation-oracle.property.test.ts` |
| `011e9c4b4c3eadae462b150f0be5158fc19655eef7e1e87f77f6153c24d021bf` | `packages/powersync-direct-collection/tests/mutation-confirmation-registration-oracle.ts` |
| `a1418777823405331b9628a6d6333713b1caa3d9663449763c5a5122565eb868` | `packages/powersync-direct-collection/tests/mutation-confirmation-service.ts` |
| `5923b7dfc9899becf743c7cd652b14d8c135546d969cd03538ffc8011afd9e54` | `packages/db/tests/mutation-confirmation-oracle.ts` |
| `a76802dfa3d097e20c1b2f6882c559a66c93384421077af88ea15d63a9e1fb1f` | `packages/browser-db-sqlite-persistence/e2e/powersync-direct-mutation-oracle.browser.test.ts` |

## Requirement evidence

| Requirement | Outcome |
| --- | --- |
| ORC-001, authority and limits | Writing Data supplies confirmation/no-flicker/throw/signal promises. The shared primary model supplies the accepted-source/settlement law. The limits above bound this record. |
| ORC-002, independent judgment | The existing shared mutation rule rebuilds rows from authored inputs. It imports no adapter or SDK semantic machinery. Cancellation projects requested/accepted confirmation and the public abort/cleanup promises separately. |
| ORC-003, literate responsibilities | The history, cancellation and registration companions state the laws, grammar and limits. The production-only driver records public cuts; the named shared model and checks judge them. |
| ORC-004, grammar controls | All reported mutation paths reconstruct through randomized constructions. CRUD changes the legal optimistic/server row shape; outcome changes write/settlement obligations; peer/text expose omission/value loss; entry/mode cross public boundaries; response order separates confirmation prerequisites. Text is bounded to eight generated characters with empty text permitted. Reject-before-write histories cannot request confirmation. Concurrent handlers and malformed protocol frames are excluded and unclaimed. |
| ORC-005, path and observations | Real SDK and actual Collection CRUD handlers or createTransaction run in each host and mode. Full ordinary rows, settlement/waiter snapshots, publications, exact error relations and actual checkpoint POST count reach the comparison. The two repaired cuts prove neither individual prerequisite is enough. |
| ORC-006, calibration | Bound corrupt-trace controls reject early acceptance at all three held cuts, stale publication, successful cancellation and each missing constructed-state observation. These are assertion rejections at the named comparison, not source mutation kills. |
| ORC-007, campaigns and replay | Each important property runs fixed seed 2377 and a fresh seed with equal 60/30 budgets. All four guarded direct replays below executed one requested history with no fixed campaign first. No production defect/failure path was discovered in this family, so no captured production failure replay is claimed. |
| ORC-008, minimality | Existing row equations are unchanged. Requested and accepted confirmation remain distinguishable: canceling the former rejects without an accepted source row, while settling after the latter publishes it. Persisting versus settled distinguishes optimistic rows from the confirmed or initial base. |
| ORC-009, vocabulary | Named cuts separate backend commit, checkpoint POST, SDK response consumption, SDK source download, accepted confirmation and optimistic transaction settlement. Both prerequisite-only cuts project to the shared requested-but-unaccepted confirmation state. |
| ORC-010, failure fidelity | Browser-safe withOracleCleanup retains the primary failure and separate cleanup failures. All SDK/query/Collection resources and pending gates are released. Browser traces preserve exact same/other Error relations before JSON. |
| ORC-011, second formulation | No plausible shared semantic-model fault requiring a meaningfully different formulation was named. The identified fault was in observation timing; the model stayed unchanged. The conditional second-formulation trigger does not apply. |
| ORC-012, review record | This head-bound entry, frozen hashes, observed counts and independent approval retain the applicable outcomes and limits. It makes no universal bug-class closure claim. |
| ORC-013, boundary witnesses | Response-only and download-only pending observations distinguish the conjunction from either premature-confirmation rule. Fulfillment/rejection and confirmation/no-confirmation neighbors distinguish source acceptance from handler success. |
| ORC-014, receiving boundary | Real standalone SDK and Chromium receive the exact shared histories/comparison. NDJSON service behavior is controlled in both hosts. No remote PowerSync service behavior, authentication, arbitrary transport failure or provider authority is established. |
| ORC-015, declared reach | Sixteen confirmation builders and eight cancellation builders return fresh histories. Each fixed/random campaign checks every builder. Shared checks enforce required states on generated outputs; bound controls remove each construction obligation. Counts follow below. |
| ORC-016, law-only files | Properties register through oracleProperty. Fixed constructions and calibrations share the same driver/model/comparison; no ordinary example test or standalone concrete type assertion was added to oracle files. |

## Checked direct replay

All four commands used campaign seed `2377`, shrink path `0`, and unit `random seed: generated`. These are successful replay-path guards, not reproductions of an undiscovered production failure. The private witness channel requires a completed nonzero run for the exact property, seed and path.

From the relevant package directory, use Node 26 and the following form:

```sh
TANSTACK_DB_ORACLE_PROPERTY='<property>' TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated' /Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node --import tsx ../db/tests/oracle-replay.ts <options> <file>
```

| Property | Working directory under packages/ | Options and file | Guard result |
| --- | --- | --- | --- |
| `powersync-direct.mutation-confirmation` | `powersync-direct-collection` | `--coverage.enabled=false tests/mutation-confirmation-oracle.property.test.ts` | exit 0; executions 1; numRuns 1; failed false |
| `powersync-direct.mutation-confirmation-cancellation` | `powersync-direct-collection` | `--coverage.enabled=false tests/mutation-confirmation-cancellation-oracle.property.test.ts` | exit 0; executions 1; numRuns 1; failed false |
| `powersync-direct.mutation-confirmation.chromium` | `browser-db-sqlite-persistence` | `--config vitest.adapter-oracles.config.ts e2e/powersync-direct-mutation-oracle.browser.test.ts` | exit 0; executions 1; numRuns 1; failed false |
| `powersync-direct.mutation-confirmation-cancellation.chromium` | `browser-db-sqlite-persistence` | `--config vitest.adapter-oracles.config.ts e2e/powersync-direct-mutation-oracle.browser.test.ts` | exit 0; executions 1; numRuns 1; failed false |

The raw guard results are retained in `.review-2377/mutation-{confirmation,cancellation}-replay-{node,browser}.log`. Initial commands with an incorrect sibling path failed module resolution before a test ran; they supply no oracle evidence. Corrected commands above are the checked executions.

## Observed generated reach

The tables record generated-unit counts from the passing normal runs. Constructed-unit reach is separate: each named builder additionally reached every declared obligation in each campaign. Their enforced minimum is one per listed builder; generated counts add sampled neighbors. Confirmation has 28 declared states. Cancellation has 14 declared and four measured states.

### Confirmation

| State | Node fixed | Node fresh | Chromium fixed | Chromium fresh |
| --- | ---: | ---: | ---: | ---: |
| `entry:handler` | 33 | 26 | 33 | 32 |
| `entry:transaction` | 27 | 34 | 27 | 28 |
| `late-confirmation` | 10 | 14 | 10 | 10 |
| `mode:eager` | 40 | 27 | 40 | 29 |
| `mode:on-demand` | 20 | 33 | 20 | 31 |
| `operation:delete` | 15 | 23 | 15 | 24 |
| `operation:insert` | 18 | 19 | 18 | 18 |
| `operation:update` | 27 | 18 | 27 | 18 |
| `order:checkpoint-first` | 8 | 7 | 8 | 6 |
| `order:response-first` | 27 | 31 | 27 | 28 |
| `outcome:fulfilled` | 27 | 38 | 27 | 37 |
| `outcome:reject-after-write` | 18 | 14 | 18 | 7 |
| `outcome:reject-before-write` | 15 | 8 | 15 | 16 |
| `path:eager:delete:handler` | 5 | 3 | 5 | 7 |
| `path:eager:delete:transaction` | 4 | 8 | 4 | 6 |
| `path:eager:insert:handler` | 10 | 6 | 10 | 4 |
| `path:eager:insert:transaction` | 4 | 3 | 4 | 5 |
| `path:eager:update:handler` | 5 | 2 | 5 | 3 |
| `path:eager:update:transaction` | 12 | 5 | 12 | 4 |
| `path:on-demand:delete:handler` | 4 | 6 | 4 | 6 |
| `path:on-demand:delete:transaction` | 2 | 6 | 2 | 5 |
| `path:on-demand:insert:handler` | 3 | 5 | 3 | 5 |
| `path:on-demand:insert:transaction` | 1 | 5 | 1 | 4 |
| `path:on-demand:update:handler` | 6 | 4 | 6 | 7 |
| `path:on-demand:update:transaction` | 4 | 7 | 4 | 4 |
| `pending:checkpoint-downloaded` | 8 | 7 | 8 | 6 |
| `pending:checkpoint-response-received` | 27 | 31 | 27 | 28 |
| `requested-after-backend` | 35 | 38 | 35 | 34 |

### Cancellation

| State | Node fixed | Node fresh | Chromium fixed | Chromium fresh |
| --- | ---: | ---: | ---: | ---: |
| `cancel-path:eager:cleanup:handler` | 5 | 5 | 5 | 5 |
| `cancel-path:eager:cleanup:transaction` | 5 | 3 | 5 | 3 |
| `cancel-path:eager:signal:handler` | 7 | 5 | 7 | 4 |
| `cancel-path:eager:signal:transaction` | 2 | 5 | 2 | 5 |
| `cancel-path:on-demand:cleanup:handler` | 3 | 5 | 3 | 5 |
| `cancel-path:on-demand:cleanup:transaction` | 2 | 3 | 2 | 1 |
| `cancel-path:on-demand:signal:handler` | 4 | 3 | 4 | 4 |
| `cancel-path:on-demand:signal:transaction` | 2 | 1 | 2 | 3 |
| `cancel:cleanup` | 15 | 16 | 15 | 14 |
| `cancel:signal` | 15 | 14 | 15 | 16 |
| `entry:handler` | 19 | 18 | 19 | 18 |
| `entry:transaction` | 11 | 12 | 11 | 12 |
| `mode:eager` | 19 | 18 | 19 | 17 |
| `mode:on-demand` | 11 | 12 | 11 | 13 |
| `operation:delete` | 8 | 9 | 8 | 12 |
| `operation:insert` | 12 | 11 | 12 | 11 |
| `operation:update` | 10 | 10 | 10 | 7 |
| `requested-after-backend` | 30 | 30 | 30 | 30 |

