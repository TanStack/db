# Issue #1883 OPFS open-deadline review

- Reviewed executable commit: `ad6815812e42aa093c3dd7397a948061988e2a7a`.
- Base: `6e151b0e57d63e2535cdf8e02518690d453214bc`.
- Owners: `packages/browser-db-sqlite-persistence/tests/opfs-page-lifecycle-oracle.test.ts` and `packages/browser-db-sqlite-persistence/e2e/open-timeout.opfs.spec.ts`.

## Contract and evidence

An OPFS open must not wait indefinitely when another tab cannot release the
database. Opening now has a 30-second default deadline, an override with `0`
meaning no deadline, and an optional caller `AbortSignal`. A rejected pending
open terminates its worker. The signal and timer cease to affect the connection
after opening settles.

The fixed unit histories drive the public open function with a silent worker.
They check default and overridden deadlines, caller abort, pre-abort, disabled
deadline, invalid durations, one settlement, listener removal, and a late
worker response. Before the production change, deadline assertions failed and
the signal API was absent. With the change, the package's full unit and type
suite passed: 18 files, 380 runtime tests, and no type errors.

The Chromium fixture holds the exact VFS Web Lock in one tab. The contender's
public open queues on that lock, then rejects with `TimeoutError`. Its queued
lock request disappears before the holder releases the lock. A new open then
reads successfully. All four configured Chromium OPFS tests passed. A temporary
mutant that omitted worker disposal on timeout left the contender's queued
lock request present; the test failed at its `toBe(false)` assertion. The
mutant was removed, and the test passed again. Changed-file ESLint, Prettier,
TypeScript, and `git diff --check` passed.

This is a controlled lock-holder history, not a reproduction of the reported
Chrome 152 CDP freeze. The fixture ran on local Chrome 153. It does not
establish behavior in other browsers, for a frozen contender tab, or for every
OPFSCoopSyncVFS failure. The issue's separate VFS-error-naming request remains
outside this change.

## ORC-001 through ORC-012

| Requirement | Outcome |
| --- | --- |
| ORC-001: authority and limits | Pass. Issue #1883 requests a bounded open and late-open cleanup. The README states the new public option contract. The limits above and the coverage map bound the claim. |
| ORC-002: independent judgment | Pass. The unit expectations come from the timeout and abort contract. The browser check reads Chromium's Web Lock inventory, not the implementation's request map. |
| ORC-003: responsibilities | Pass. The existing lifecycle oracle states the law and fixed histories beside its controlled driver and exact settlement checks. The browser spec states its lock history, real entry point, checkpoints, and limits. |
| ORC-004: generated grammar | Not triggered by this change. The new histories are fixed; the pre-existing generated pagehide grammar is unchanged. |
| ORC-005: path and observation | Pass. Both owners invoke `openBrowserWASQLiteOPFSDatabase`. Unit checks observe exact errors, settlement count, worker termination, and listener ownership. The browser checks the queued native lock before and after rejection, then a successful reopen. |
| ORC-006: calibration | Pass. Omitting timeout disposal left the real browser's queued lock present and failed the intended assertion. The timeout unit histories were red before the production change. |
| ORC-007: fixed/random replay | Not triggered by this change. No new important generated property was introduced. The existing lifecycle campaigns retain their replay controls. |
| ORC-008: model minimality | Not triggered. The change adds no reference-model state. |
| ORC-009: vocabulary | Pass. Open, settlement, abort, worker disposal, and Web Lock refer to their production or browser boundaries; the fixture's state is only an observation holder. |
| ORC-010: failure fidelity | Pass for the bounded fixture. It releases the held lock, closes pages, and retains a primary failure as the cause of an `AggregateError` when cleanup also fails. The unit harness releases held responses and restores globals. |
| ORC-011: second formulation | Pass. The fake silent worker checks the API and resource ownership. The Chromium fixture separately checks the native queued-lock effect that the fake cannot observe. |
| ORC-012: review evidence | This record identifies the exact reviewed executable commit, calibration result, applicable requirements, non-applicable triggers, and remaining limits. |

The bounded repair claim is: default or overridden deadline × silent-init and
held-lock histories × the public browser OPFS open path × rejected open,
worker disposal, and absence of a later queued lock. A signal-abort history is
also covered by the controlled worker. The coverage map owns the remaining
frozen-tab and browser-matrix witness gaps.

## Follow-up review at `b1c615868974273e1b2dfb9bd5e5e0e45b01fc9d`

The external review of PR #1936 raised an untested synchronous-abort cut and a
possible false failure in the Chromium lock fixture. This follow-up changes no
production code. It adds an abort history to the lifecycle oracle, gives the
Chromium fixture a 10-second pending-lock setup window before its 15-second
open deadline, and clarifies the previously unbounded default in the changeset.

The new history aborts a real `AbortSignal` while reading the caller's
`vfsName` option. This happens after the initial signal check and before the
abort listener is installed. A silent init response and `timeoutMs: 0` make a
missed abort observable: the open would remain pending. The oracle checks the
exact rejection, one worker termination, listener removal, one init request,
and no second settlement after a late response. Removing the post-registration
abort check caused an assertion failure at the expected settlement checkpoint
(`[]` instead of the `AbortError` rejection). Restoring it made the focused test
pass.

A controlled Chromium timing probe on the prior fixture queued a lock at 4.6
seconds, before its 5-second open deadline. The 4.5-second pending-lock poll
had already failed, even though the open later rejected with `TimeoutError`.
The revised fixture gives worker startup more room without changing the
timeout, queued-lock disappearance, or successful-reopen assertions. Its new
window reduces this timing risk; it does not establish a maximum worker startup
time on every CI host. The native Chromium fixture passed with the revised
deadlines. The browser package suite passed with 382 runtime tests and no type
errors; changed-file ESLint, Prettier, and `git diff --check` passed.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001: authority and limits | The README's pending-open cancellation contract remains the authority. The added getter history covers a valid synchronous abort; the lock fixture remains one Chromium history. |
| ORC-002: independent judgment | The expected abort reason and resource release come from the public abort contract, not the production request map. |
| ORC-003: responsibilities | The existing lifecycle oracle retains its contract, model, fixed-history grammar, production driver, and settlement/refinement checks. |
| ORC-004: generated grammar | Not triggered. The generated pagehide grammar is unchanged; the new abort history is fixed. |
| ORC-005: path and observation | The new history calls the public opener and observes exact settlement, init reach, worker termination, and late-response behavior. The Chromium fixture still observes the native queued Web Lock and reopen. |
| ORC-006: calibration | Deleting the post-registration abort check failed the new oracle at the intended settlement assertion. The earlier native queued-lock disposal mutant remains recorded above. |
| ORC-007: fixed/random replay | Not triggered by this fixed history. Existing generated campaigns and replay controls are unchanged. |
| ORC-008: model minimality | Not triggered. No reference-model state changed. |
| ORC-009: vocabulary | Abort, open settlement, worker disposal, and queued Web Lock retain their production/browser meanings. |
| ORC-010: failure fidelity | The oracle's cleanup still releases held responses and restores globals. The Chromium fixture still preserves its primary failure and cleanup diagnostics. |
| ORC-011: second formulation | The controlled abort history and native lock fixture judge different boundaries; no new shared semantic fault requires another formulation. |
| ORC-012: review evidence | This addendum ties the focused mutant, suite receipts, and remaining timing limit to the exact executable commit above. |
