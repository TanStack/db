# GAP-04 paced-mutation oracle review

## Reviewed state and authority

- Starting head: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
- Initial implementation commit: `1b844588bc18e96a4c18c0de6bb1edadcad85332`.
- Reviewed implementation commit: `ccdeaa5ba61f94e7cf81930987d728769266a1cd`.
- Maintainer-decision implementation commit: `baf6cf27`.
- Owner: `packages/db/tests/paced-mutations-oracle.test.ts`.
- Public authority: strategy option types, `createPacedMutations` reference, and `docs/guides/mutations.md`.

The owner uses finite virtual-clock histories over public `createPacedMutations` and the three real strategy factories. Its independent models use an appointment time, pending mutation IDs, and a plain ordered list. The tests compare immediate public Collection rows, mutation callback times and payloads, returned transaction identity, final transaction state, and `isPersisted.promise` fulfillment with the returned transaction object. A held-write history crosses the queue timer and two pending persistence promises to check serialization.

The maintainer chose the documented pacing behavior: factories preserve caller-owned options, `maxSize` overflow fails the returned transaction and rolls back its optimistic state, and explicit non-leading throttle waits for its first trailing edge. The baseline `maxSize:1` witness returned two completed and two permanently pending transactions after four calls. The baseline explicit non-leading throttle witness started at t=0 rather than the trailing edge. The follow-up oracle encoded both laws and failed on the unchanged production implementation. Omitted leading/trailing defaults remain outside the finite domain.

## Verification on the reviewed commit

- The expanded oracle passed 18 tests. The existing paced-mutation suite passed 13 tests, and the React hook suite passed 6 tests under jsdom.
- The DB package typecheck, changed-file ESLint, Prettier, and `git diff --check` passed.
- Hostile controls for queue extraction, debounce trailing, throttle leading and non-leading timing, ignored capacity, false-green overflow admission, and caller option mutation each failed their intended checker.
- A hostile cleanup control threw after an assertion failure. The result retained the assertion as `cause` and the cleanup error in `AggregateError.errors`. Collection cleanup still ran.
- The permanent capacity, non-leading throttle, and frozen-options tests failed on the unchanged baseline and pass with the repair. Capacity receipts are observed at named virtual-clock cuts so an unsettled promise produces an assertion failure rather than a test timeout.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass for documented queue order and bounded admission, explicit debounce trailing and throttle edges, optimistic rows, and persistence settlement. Omitted defaults, failed writes, and broader generated schedules remain outside this finite owner. |
| ORC-002 independent judgment | Pass. The expected trace is computed from a virtual appointment list, a quiet-period grouping rule, and a leading/trailing window rule. No pacer-lite code or production scheduler enters the model. |
| ORC-003 five responsibilities | Pass. The opening states the law and limits; `queueStarts`, `debounceStarts`, and `throttleStarts` are the model; action arrays are the finite grammar; `runProduction` is the real driver; exact trace and receipt assertions are the refinement check. |
| ORC-004 grammar controls | Bounded enumeration, not an important generated property. It reconstructs all four queue position combinations, zero queue wait, queue capacity zero/one with waiting and in-flight writes, debounce reset, both throttle edge forms, and held queue settlement. Distinct IDs isolate queue admission; a focused same-key witness checks that overflow rollback leaves an admitted update intact through first-write settlement. A deferred custom queue checks the void-return compatibility boundary. Negative waits and broader capacities are outside the claimed grammar. |
| ORC-005 path and observation | Pass. Real strategy instances drive the public manager and Collection; callback times and payloads, public rows, returned transaction identity/state, and persistence receipts are observed at virtual-clock cuts. Rejected receipts carry `QueueCapacityExceededError`; admitted same-key state survives the preceding write's settlement. |
| ORC-006 checker calibration | Pass for hostile queue extraction, disabled debounce trailing, disabled throttle leading, early non-leading throttle, ignored capacity, false-green overflow admission, and caller-option mutation controls. Each reaches and fails its corresponding checker. |
| ORC-007 fixed/random campaigns | Not triggered: this owner is bounded finite enumeration, not an important generated property. |
| ORC-008 model minimality | Pass. The queue's ready-list order distinguishes later extraction; due time distinguishes a call before/after eligibility. Debounce pending IDs and quiet-period due distinguish which transaction persists and when. Throttle pending IDs and next edge distinguish merged trailing output from a fresh leading call. |
| ORC-009 vocabulary mapping | Pass. The opening maps model pending IDs, ready list, and due appointment to production concepts without importing their implementation. It uses the glossary terms optimistic transaction and settlement. |
| ORC-010 failure fidelity | Pass. The driver compares the complete trace before cleanup. `withCleanup` stops strategy timers and cleans the Collection. When comparison and cleanup both fail, it retains the comparison as the cause and reports cleanup errors separately. A hostile cleanup test checks both errors and Collection cleanup. No shrinking or external capture occurs. |
| ORC-011 second formulation | Not triggered for the documented finite schedule laws: the model's appointment/list formulation differs from pacer-lite's timers and promise chain, and no named shared semantic fault has a meaningful second formulation. Broader capacities and schedules remain open. |

ORC-012 is this versioned record, tied to the reviewed implementation commit and the coverage-map owner. The sampled finite histories do not prove every legal schedule.

## Review and loss audit

The original audit accurately found absent queue option coverage and no paced-mutation oracle. It correctly rejected a pacer-lite differential as permanent authority. It missed the pending transaction on queue rejection and the early non-leading throttle start. Hire recommendation: hire for issue discovery with a reproduction and contract-authority gate; good signal and prioritization, incomplete edge/settlement analysis.

The source ledger has six claims. GAP04-1, GAP04-3, and GAP04-4 are fixed for the finite domain described above, including bounded capacity and hostile capacity controls. GAP04-2 has a maintainer decision and a tested implementation. GAP04-5 is accepted and implemented: the copied pacer-lite differential is not the oracle. GAP04-6 is deferred to the proposed MUT-05 replacement. The source claims stay distinct in the task-local ledger.

The follow-up review found two oracle gaps: the same-key witness did not observe the admitted update after the first write settled, and direct receipt awaits could hang before cleanup. Both were fixed by holding writes across a settlement cut and recording receipt outcomes before asserting them. A simplifier removed a duplicate queue transaction reference; a separate non-leading timer remains necessary because pacer-lite 0.2.1 measures its first wait from epoch zero.

The repair adds 37 net production lines across the queue admission result, a named rejection reason, targeted rollback, caller-option cloning, and the trailing-only timer. The tests and contract documents grow separately. Each added production branch supports a public law demonstrated by a RED witness and a GREEN oracle run.

## CodeRabbit review 5345009177

CodeRabbit reviewed `abf7740b921de88589c5b4a1ef53d6ea832a9145` and posted one inline finding. Its claim was accurate: `if (!admitted)` rejected a custom queue strategy that admitted work and returned `void`. The previous `QueueStrategy.execute` contract allowed that return. The new Boolean-only type also broke source compatibility for that strategy.

The permanent deferred-callback witness failed on the reviewed commit at the admission checkpoint: the returned transaction was `failed` instead of `pending`. DB typecheck rejected the void-returning strategy. The repair treats only explicit `false` as rejection and restores the prior void and promise return types. The same witness then passed, and the bounded queue witnesses still rejected overflow. The focused DB suite passed 18 oracle and 13 existing tests. DB typecheck, ESLint, Prettier, and diff checks passed.

The review had one actionable finding and one non-blocking suggestion to run a local CodeRabbit CLI review. The finding is `fixed-now` in the task ledger. The CLI suggestion is `deferred` to the normal CodeRabbit PR re-review after push. No other technical item appeared in the raw review body, inline comments, or footnotes. Loss audit: 2 raw items = 1 fixed-now + 1 deferred. No evidence gap remains.

Reviewer assessment: 1 of 1 actionable findings was correct and specific. The suggested conditional fixes the runtime bug. The reviewer did not mention the related type compatibility break, which the RED typecheck exposed. The review had high signal and a narrow but useful analysis. Hire recommendation: hire for targeted PR review, with an oracle and typecheck gate before accepting fixes.

## PR #1930 batch review follow-up

The review in `pr-1918-1934-review-summary.md` examined HEAD `0654b2aa574b760e8d6935cccafff9ce9d8d208b` and contained five numbered findings plus six contextual claims. The task-local append-only ledger preserves all eleven in source order.

Finding 1 exposed a real omitted-leading throttle gap. Pacer-lite 0.2.1 defaults both edges only when both are absent. With `{ wait: 10, trailing: true }`, `leading` remains undefined; its first trailing timeout subtracts the epoch-based elapsed time and fires at virtual time 0. The new public `createPacedMutations` oracle case failed before the fix: actual starts included `{ at: 0, ids: [1] }` while the independent non-leading model expected `{ at: 10, ids: [1, 2] }`. The same case passed after changing the guard to `leading !== true && trailing === true`. Explicit non-leading, explicit leading, and both-omitted default cases pass alongside it. The pre-fix implementation is the hostile timing control at the exact start-time checkpoint. The repair is one changed production line.

Finding 2 correctly flags a new public error and observable overflow change. It is not a TypeScript source incompatibility: the export is additive and old source still compiles. The old silent drop left an optimistic row and pending persistence receipt, so relying on it as a completed no-op was not a coherent public contract. The prior maintainer decision, patch changeset, guide, and bounded RED/GREEN capacity oracle cover the intended behavioral change.

Finding 3 is accurate. Pacer-lite checks `items.length >= maxSize` before insertion and processing, so zero rejects even the first mutation. The existing public oracle verifies three rejected transactions for `maxSize: 0`; the focused suite passed it. The guide, option type, and reference text now state the zero boundary and rejection semantics.

Finding 4 accurately identifies a separate timer path. It does not show a second behavioral fault or a safe local root fix: pacer-lite owns a private epoch-based clock, and this branch has no public way to reset it. Keep the narrow trailing-only timer until an upstream pacer-lite repair can provide the same documented schedule; the oracle's explicit and omitted-leading cases are the migration checks. This maintenance idea is deferred here, not dropped.

Finding 5 is partly imprecise: the comment said “captured transaction” rather than the literal removed identifier `capturedTx`, and the concept was still correct. Naming `txToReturn` directly makes the comment match the code; that one-line comment edit is complete.

The scoreboard, opening attention note, and cross-PR observation correctly call this a production behavior change with a new public API. The three named changes are bounded queue rejection and rollback, explicit trailing throttle timing, and caller-options immutability. The omitted-leading correction closes one adjacent configuration. These claims are recorded in the changeset, guide, oracle, and this review record. The PR remains a narrow bug-fix release despite exceeding the batch's test-only shape.

Reviewer assessment: the key omitted-leading finding was precise, reproducible, and paired with the correct one-line classifier fix. The capacity and stale-reference notes identified useful documentation cleanup. The compatibility note overstates source breakage, and the timer note is a design preference without a concrete alternative. Signal-to-noise is good; prioritization is sound. Hire recommendation: hire for focused review, with a public oracle and compatibility terminology check.

Verification after the fix: DB paced oracle 20/20, existing paced tests 13/13, React paced hook 6/6, DB typecheck, changed-file ESLint, Prettier, and diff whitespace checks. Loss audit of the raw review: 11 claims = 3 fixed-now (findings 1, 3, 5) + 6 already documented contextual claims + 1 refuted as phrased (source incompatibility) + 1 deferred maintenance idea (upstream timer repair). No item lacks evidence. Other edge combinations, failed persistence, broader capacities, and generated schedules remain outside this finite oracle owner.

## CodeRabbit review 5345661866: queue cleanup

CodeRabbit reviewed `bad0a0091e6914ba60d67e9875f640a05e9e7238` and posted one inline finding at `docs/guides/mutations.md:1231-1232`. Its claim was accurate: `queueStrategy.cleanup()` stopped the timer and cleared admitted waiting callbacks. Their optimistic transactions stayed pending, their persistence receipts did not settle, and their optimistic rows stayed visible. This behavior predates the PR. The guide promised that every admitted queue mutation is attempted before and after the PR.

A controlled public probe held the first write and called cleanup while the next item waited. After 20ms, the second write had not started, its transaction and receipt stayed pending, and its optimistic row remained visible. The permanent FIFO oracle case failed on the reviewed commit at its start-order checkpoint: actual `[1]`, expected `[1, 2]`. The owner previously ran cleanup only after every admitted call settled, which explains the false-green coverage.

The repair stops new admission and lets the existing LiteQueuer timer drain admitted callbacks at the configured wait interval. Cleanup still returns synchronously. The held first write gates later starts. FIFO and LIFO oracle histories check exact start order, transaction and receipt settlement, a repeated cleanup call, and direct strategy rejection of a new callback after cleanup. An additional public clock history checks two immediate writes: starts remain `[0]` at the first cut and become `[0, 10]` after the wait. All three histories pass. The prior stop-and-clear implementation failed the drain checker. A `stop(); flush()` candidate passed settlement but failed the timing checker with starts `[0, 0]`. Both are hostile controls at their intended checkpoints.

The reviewer suggested weakening the guide to say cleanup can discard admitted work. That would contradict the documented admission guarantee. The guide and changeset instead describe a graceful drain. The repair adds one disposal flag and keeps the existing timer until the queue empties. It adds no second timer or recovery path. A separate public probe called `mutate()` after cleanup. Its transaction failed and its receipt rejected with `QueueCapacityExceededError`. That error reason is inaccurate for disposal. The direct strategy test only asserts no new callback is admitted. A future owner must decide and witness the public post-cleanup call contract before changing its error path. The coverage map records this limit.

Verification on the repaired worktree: DB paced oracle 23/23, existing paced tests 13/13, React paced hook 6/6, DB and React typechecks, changed-file ESLint, Prettier, and diff checks. The raw review had one finding and one optional local CodeRabbit CLI suggestion. Loss audit: 2 items = 1 fixed-now + 1 deferred to automatic PR re-review. No review item lacks evidence.

Reviewer assessment: the single actionable finding was technically accurate and found a real lifecycle gap. The proposed documentation-only fix would preserve stranded optimistic transactions and weaken a public promise. The reviewer did not check the prior guide or the transaction receipt contract. Signal was high, analysis depth and fix quality were mixed. Hire recommendation: hire for defect discovery with contract review and public-path RED/GREEN gates.
