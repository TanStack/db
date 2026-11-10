# E03/E04 launcher gaps: lossless independent review

This review records two static launcher findings. No test, listing, source import, launcher, compiler, lint, build, generator, mutant or Git mutation was executed by the reviewer. The findings concern evidence capture and fail-closed finite execution, not production behavior. E3 and E4 remain immutable and unexecuted.

## L01: E3 can lose the structured consumed-invocation result

Exact E3 packet `a0cb506be4a7dc5fb68aecee2989fb5a70274d7979fb1e158942fd74f1956816`; launcher `988c4416b14238f67f5c8a587df76628447677c88831f99cea33aacf30df9329`.

Reviewer finding sent to author:

> Full packet/source/static checks look consistent, but launcher has an admission blocker on requested snapshot/receipt error-path review: post-process after=snapshot() is outside the guarded lifecycle. If HEAD/file read fails, or process.wait/group cleanup raises in finally, it exits without a receipt/batch-stop and leaves active-command.lock. Later launches fail closed, but the consumed invocation has no structured exception/group/source evidence. Please separately freeze a launcher successor that catches/records post-run snapshot/cleanup/parser failures, always emits a tagged failure receipt/batch-stop when a process could start, and releases the lock after safe cleanup (retaining freeze/one-shot reservations). Preserve every exception rather than replacing the primary. No runtime admitted.

Authority is root's finite admission requirement: stop on the first unexpected failure, freeze, and report. This is a missing exception/error-path observation in the launcher. A post-process snapshot exception or cleanup wait exception reaches the gap without a test-law assumption. The existing lock prevents a later launch, but does not replace the consumed invocation's structured evidence.

E4 moved reservation/execution into a guarded lifecycle, tagged each cleanup phase and post-snapshot/parser exception, retained the first exception separately from ordered secondary exceptions, and attempted structured receipt/stop capture. That addresses L01 in source. No injected lifecycle I/O/cleanup fault has been executed; this is static enforcement review.

## L02: E4 releases the only existing guard before artifact commit

Exact E4 packet `f39b58162bce32f1ef5a4fd9326126f9afe91ac219d5b5a4b4fb76ce8e6baf44`; launcher `fc010b85d97fc67b5471e998ffe1e1b6abd90f47b1221d60715e7369f23322c6`.

Reviewer finding sent to author:

> E4 repairs execution/snapshot/parser exception capture, but artifact-write fail-closed ordering remains: lock.unlink happens before receipt/stop/fallback writes. If a receipt is written with acceptedForNext=true but close/write reports failure and all fallback marker writes fail, lock is already gone and the next label can trust the green receipt. Keep a durable in-flight guard/lock until accepted receipt or failure freeze is safely committed; any artifact-write uncertainty must retain an already-existing guard so storage failure cannot require a new successful write to block later launches. Preserve E4 and freeze a launcher-only successor. Source/static remain accepted in direction; no runtime yet.

Authority is the same stop/freeze requirement, now applied to artifact-write uncertainty. The missing transition is the interval after unlock and before reliable result/failure commit. Depending on a new successful fallback write cannot establish fail-closed behavior when the failure itself is artifact storage.

E5 retains its existing exclusive guard through result/stop commits and readbacks. Any artifact uncertainty keeps that guard. Receipt/stop commit uses exclusive create, flush, file fsync, close and exact readback; only successful commits/readbacks plus confirmed group absence enable final unlink. At receipt commit the lock is explicitly still held; final stdout observes actual release. These source changes address L02 without editing production, model, input or static evidence. This review makes no host-crash durability or injected artifact-fault runtime claim.

## Current disposition

E5 packet `f3c19973600c8dd9a3ea49d430abcf8301bd06fba5bcb3e60a298622371e4b84`, launcher `85d5392d753a4e4a74d0f6e4df345ab91a6e2bd20896ef2d93f3a71fb5d81661`, and recipes `54225c44766dbbf6ef41e036552011f3d39a6b30754d4dee24883ce4be90882c` preserve both predecessors. L01 and L02 are addressed by exact source review; semantic/runtime evidence remains separate. The exact finite admission decision is in R03-E05-independent-source-and-finite-admission-v1.md. No generated campaign, production mutation, publication or broad closure follows from these launcher corrections.
