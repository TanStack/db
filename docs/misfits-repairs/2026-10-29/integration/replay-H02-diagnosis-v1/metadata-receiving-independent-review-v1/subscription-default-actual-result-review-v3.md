# Subscription/default: independent actual-result review

Verdict: **accept the exact bounded queued-answer progress RED**, under the previously accepted measured-conflict/completed-enqueue gate. This is not a broad-wall inference. The native selected test failed at the progress judgment after the validated physical conflict and completed resolving enqueue; its full final raw drain contains no answer execution. **No terminal metadata GREEN, metadata-mutant kill, adapter-cleanup credit or whole-class closure is earned.** No further runtime is admitted here.

The governing maintainer decision requires query processing to return control so an already queued backend answer can run, while preserving cached-row ownership and atomic publication; permanently conflicting caches remain outside that decision. The instrument's 1,000 ms observation window bounds this finite witness. It does not make a product time promise or prove universal nontermination.

## Frozen identity and complete read-only audit

Result freeze: `docs/misfits-metadata-subscription-default-result-freeze-v3.json`, SHA256 `4186b8fda8a73a6432b1b50b9bf0a2ff86d472432f1b5c37c24f6268c84c902c`. Exact one-shot admission: `445abcdf4e75996785ecfcbc1352fa5bddde2c372a66884b6efdda76d1defa0b`. Preceding accepted authored classification: `0c941598074238637f54d5e3907b973c3295f6a21a896bc473ceaeeca77e2820`. All match the preserved chain and unchanged V3 binding/source.

Actual outer tool session **62993**, initial chunk `f6ef5f`, terminal chunk `3fa9e1`, and exit **1** were captured from the actual tool values. The launcher identity records the intended subscription/default command/binding and outer PID/PGID 51447. Native output reports **1 failed / 3 skipped**, with the precise failure in `checkQueuedAnswerProgress` rather than a metadata assertion or test-body timeout. The receiving child has exitCode null / SIGKILL, consistent with recorded containment; it did not complete its native test.

The reviewer independently hashed the exact **1,953-asset** file set. All **1,946** copied native files match the preserved original directory and copy-map hashes. Original directory: `/var/folders/zy/zxh2j5n97vq2tt8d8q7_1t5r0000gp/T/h02-progress-51466-def540e9-34ad-4a83-a641-37d2874417ec`. The raw receipt file has **59,552** complete newline-terminated records, sequences 1–59,552 exactly once, totaling 15,790,097 bytes. No parsed record or trailing partial record is excluded. The exclusive regular writer is PID 51470, mode 0600/`wx`. The final native verifier drains all 59,552 without transport failure, and retained supervisor semantic receipts equal their raw counterparts.

The report-only audit `subscription-default-actual-read-audit-v3.py` additionally checks every concrete physical premise/enqueue field and reuses only the hash-bound prior source/retained-code audit block, with explicit observed count changes. It runs no tests, native verifier or process probes. Its JSON result has SHA256 `5ffe72f219e3eb43d70a4402e3964387e37597e9b7c259fde8852dbf316e96f0`.

## Strict gate, field by field

Initial complete root/downstream row4/rank40/markers[] snapshots occur at 109, reload pivot3 at 110, and positive held-provider publication at 165 with four pending answers. Default public entries and own output metadata agree with those complete prior snapshots. Root remains row4 at 184, while the resolving answer is still pending.

The physical conflict at **183** is the actual `held-queryFn-registration` cut:

- Pending Query key/atom is `["h02-progress-markers",2,[3]]`; cached version 4/backendVersion 0 contains row3.
- A distinct sibling key/atom `["h02-progress-markers",1,[3]]` has later version 8/backendVersion 1 containing no rows. Its actual provider answer is recorded at 172.
- The pending Query is active, not aborted, successful but fetching. Its actual update count remains its start count 1. Its scope is [3], owner 2.
- The sibling has the same scope [3], distinct owner 1, successful empty rows and actual count 1 greater than start 0.
- Physical identities are current and distinct: pending/current Query 4, sibling/answer Query 8. The pending provider request for Query 4 is recorded at 181. Neither a cache label nor a modeled ownership guess substitutes for these measured identities.

At **185**, exactly one `resolving-conflict` answer enqueue is complete. Its key/atom matches the pending Query, cachedVersion 4 and emptyVersion 8 match the premise, scheduler is microtask and **enqueueReturned=true**. It follows the measured conflict. The monitor records conflictSequence 183, queuedSequence 185 and a finite parent monotonic queue observation time.

The supervisor's retained **first** trigger is `post-enqueue-window`; reason remains `wall`. The reviewed source stores that trigger only on the first kill attempt and preserves resource/observation reasons with higher precedence. The complete final drain has **zero answer-executed receipts**, zero final publication, zero cleanup-start and zero worker-cleaned. There are no root or downstream public callbacks after reload 110. The raw suffix instead records repeated acquisitions/releases; totals are 5,947 attempts and 5,939 releases. These counts describe this finite observed churn, not an asymptotic bound or proof of an infinite loop.

This combination satisfies the narrow accepted progress gate. A wall label alone, queued intent before enqueue return, unvalidated conflict, partial drain, later execution receipt, resource/instrument/comparison fault or uncertain named cleanup would not satisfy it.

## Native checker, binding and failure separation

The native parent metadata checker compiled/imported and ran the initial and held comparisons, as shown by the direct shared call path and post-comparison reaches. Its ordinary payload checks also ran. There is **no primaryObservationError**, warning, worker-error or metadata mismatch in the retained outcome. The actual native thrown error is `bounded queued-answer progress failure after reached premise`; the all-state reach assertion is not reached after that throw. Do not report the metadata test as passed or its failure as a shared metadata assertion kill.

All **573** source files and **2,544** named own-package regular dependency payload files were independently rehashed. Full prelaunch/postreturn gate records are byte-identical; their unchanged source/link/lock/executable/file-set checks passed. The native source verifier reports **bound**, 29,785 actual-key observations, 3 empty-options callbacks and no failures. Three actual evaluated registry cuts—pre-history, driver-start and conflicting-cache-premise—contain **163 bound modules each**, **489 records** total. Every recorded original-source hash, retained transformed-code hash, matching V8 source containing the full transformed code and sealed startup match was checked. The missing final/after-all cuts receive no credit. There are 1,620 compiled V8 scripts; compilation is not execution coverage. Positive current-source stacks and evaluated registry records supply separate path evidence, with the inspector disconnected before history.

Exact parent compiled-byte attestation remains absent: these V8 inventories describe the receiving child. Parent native initial/held checker invocation is established by its actual direct call path and post-comparison reaches, not child oracle-module evaluation. The dependency claim remains the named own-package payload, not complete transitive/native/host equivalence.

The supervisor sampled maximum group RSS **699,596,800 bytes**, below 1 GiB; heapDiagnostic=false, no RSS/resource reason, no observation error and cleanupErrors=[]. Child stderr is empty. Final supervisor elapsed time is 3,413 ms; the outer selected test duration is 3,419 ms, within its 60 s body timeout. Existing 20 s child, 384 MiB heap, 100 ms sampling, 1,000 ms post-enqueue and 20 s verifier budgets remain unchanged. These samples establish the recorded non-resource termination account; they do not bound unsampled or whole-CLI memory.

## Cleanup and reach accounting

The child was forcibly killed for containment. Final sampled target-group rows are empty. Root's separately preserved absence record reports ESRCH for outer PID/PGID 51447, supervisor-host PID 51466, receiving child PID 51467 and detached **group target 51467**. The outer identity is directly captured. For the child, detached spawn supplies the childPid target basis; no separate initial actual `getpgid` was persisted. Credit is limited to those named original identifiers/target and empty final sampled target rows. No escaped-descendant census, normal worker completion or adapter cleanup is inferred from SIGKILL.

Exactly **9 of 18** declared states reached once: initial root/downstream, nonempty prior, reload start, positive held provider read, held root/downstream, completed enqueue and conflicting-cache premise. All **nine terminal states are zero / UNREACHED**:

- answer-executed;
- callback-root and callback-downstream;
- selected-upstream-metadata;
- messages-root and messages-downstream;
- final-root and final-downstream;
- worker-cleaned.

The bounded RED remains useful progress-bug evidence while terminal metadata stays open. It provides no real receiving update.previousValue, actual metadata hostile-mutant kill, generated-neighbor or alternate-scheduler campaign, terminal subscription publication, ownership repair correctness, framework coverage or universal class closure.

Root must classify this result separately. `subscription-authored-next-source-review-v3.md` gives only the next frozen recipe's source verdict. No retry, next runtime, native process probe, production/oracle change, frozen evidence edit or new admission occurred in this read/hash/report review.
