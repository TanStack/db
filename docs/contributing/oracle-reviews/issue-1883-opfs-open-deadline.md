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
