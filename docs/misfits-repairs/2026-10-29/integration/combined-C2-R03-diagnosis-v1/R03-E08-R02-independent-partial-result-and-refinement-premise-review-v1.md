# E8 R02 partial result and refinement-premise review

Reviewer: `/root/review_combined_held_cuts`. Date: 2026-10-30.

## Decision

Preserve E8 R02 as two completed finite histories followed by an evaluation
premise failure. Designate the missing-history premise **R03-E8-REFINEMENT01**.
The guard correctly rejects an attempt to fail a window that already completed.
This is not a demonstrated production mismatch or production RED. The failed
history's intended admitted-refinement failure and the fourth selected history
remain unmeasured. E8 R03 did not run. No retry, source correction or later
command is authorized by this review.

The repair belongs in the legal receiving history/fixture: it must leave
required new root rows absent when the operation enters after a genuinely
successful captured source dependency. Keep the distinct-window guard, exact
operation boundary, missing-row/pending-acquisition checks, shared publication
comparison and required reach. The current trace does not justify weakening
those checks or changing production. A concrete successor fixture remains to
be independently reviewed and exercised.

This review read frozen result data and the relevant frozen scenario, history,
adapter and command-handler source. It did not import or execute source, tests,
configuration, collectors, parser, launcher or production. It made no source
edit, admission, retry or process probe. There was no broad source re-audit.

## Exact frozen result

Packet: `r03-source-successor-quiet-e08-v1`.

| Item | SHA-256 |
| --- | --- |
| R02 result freeze, eight members | `1a97bffd13fb9527164f270a55621589eccf2e67e741039a2c570f7ab0c3f705` |
| Raw receipt | `94411dcc14fe509c2f47bf3269fa7bc5d89b930c464eabe7d8fa6504fa271496` |
| Post-return closeout | `3153b2a5296e4b7ec6ab7be95d32eafe0e07e00c39655a060b1b1624406ba4df` |
| Raw log/reporter, 125573 bytes | `0b75b1b3902bee179336140e3ecb75d493a3bfbc2c8ec17730f5691cc68c324b` |
| Payloads | `9c63b8b2a4315d5097efa9234476f4f6510558f0ea9de2c4d7ab73dfe8b28f32` |
| ROOT admission | `0c83745dcacc94387d05275bf6c1c760e87c82a09b25e9c420aaad972c6c76e3` |
| Durable E8 STOP | `495abe4fa17a6b59fd6015632b315cce5dfd4266609d01a58430eff10919f956` |

All eight result members independently match. The result binds packet
`ce10ccb8a9c0e7ced5212278289350057a274f881dc398e81ed44df3af3b3748`,
input freeze
`cacd1a2d27334f726d8c3b755206947d778929b3d6b67c79322fc5925d0df2e5`,
and independent source review
`9dcb396a00cf9ba4bc7ecb33bcc324be9038cbc80deca3ed82cb2dc67e01a8e2`.
Recorded before/after maps match all 1415 frozen inputs. R01 result freeze
`f5d1a4ea8ec3383b5918538519d2979e67088ece092dd0fb5d1dd43eb09da378`
and its seven members remain unchanged.

The raw reporter independently gives `1 failed | 2 passed | 133 skipped (137)`.
There are 136 status lines, because the fourth selected body has no status
after bail. Three payloads reconstruct exactly from the raw log, all with
contiguous observations:

| History | Observations | Result |
| --- | ---: | --- |
| sibling work holds an applied covering response | 202 | completed; all three required reaches one |
| immediately admitted refinement fails | 47 | completed; admitted-refinement-failure one |
| successful replay then admitted refinement fails | 32 | incomplete; replay-success-then-admitted-refinement-failure zero |

`changed source publishes before admitted refinement fails` is unexecuted,
rather than a passing or failing trace. No E8 R03 run files exist. The
launcher's count, inventory and payload violations follow from the first
failure and bail; they do not establish a selector defect.

The child exited 1 and the launcher exited 2 after 2.023 seconds. The receipt
reports no primary or secondary launcher exception, empty Oracle overrides and
no remaining process group. Its guard-held fields describe the immutable
receipt-commit checkpoint. The separate closeout confirms later guard absence,
durable STOP and PID/initial process group 57336 absent. It records ROOT's
independent ESRCH probe for both, tool chunk `3760ed`. These are frozen/root
process observations; the reviewer did not repeat a probe.

## Actual failure and source account

The failed scenario is ascending, offset 0, limit 1, no peer, no join, no
include, eager markers, rank step 10. Its finite reference relation starts with
rows 1 through 5 ranked 10 through 50. The authored deferred history is:

1. hold loads;
2. truncate the ordered row source;
3. request window offset 1 / limit 3;
4. settle current row-source work successfully;
5. fail the requested-window acquisition;
6. perform the existing recovery truncate and successful settlement.

The trace shows what this history actually reaches:

| Sequence | Frozen observation |
| --- | --- |
| 14 | Window capture records old model/reported window 0/1, requested 1/3, and preceding row 1. |
| 15–20 | Current row replay loads 6/8/10 settle ok; the source publication account empties. |
| 21 | The replay's independent own receipt freezes successfully. |
| 24 | The captured native source wait resolves. |
| 25 | The requested window enters the compiled operation at 1/3. |
| 26 | Rows 2/3/4 publish, the exact ascending reference result for requested window 1/3. |
| 27 | The prior replay acquisition retires. |
| 28–32 | Subsequent authored recovery work runs after the command guard has failed and been retained as an escaped evaluation error. It cannot create the missing earlier failure cut. |

`failRequestedWindow` first proves operation entry and that its recorded
request belongs to the authored move. At line 3992 it then requires that
request to differ from the independent settled `window`. Here both are 1/3,
because the operation's successful settlement already advanced the model.
The guard throws `control uses a distinct requested window`. The history loop
retains that assertion, and the final wrapper at line 4762 reports `escaped
error: only injected faults may surface` with the guard assertion as its cause.
The wrapper is not the causal production error.

The guard precedes the source-completion, fulfilled-dependency, missing-row and
exact pending-refinement-acquisition premises. No requested refinement fault
is injected in this failed history, and its intended failed-operation
publication comparison is not reached. Its zero reach is therefore expected
after this earlier receiving-premise failure, not separate evidence that the
product violated admitted-refinement retention.

## Law and legal repair conditions

Atomic window publication requires a move to wait for relevant replacement
work, then publish its completed chosen window. A required refinement failure
belongs to the operation and retains the prior settled public snapshot. It
does not require a redundant provider refinement when successful authoritative
source replacement already supplies the chosen rows, and it does not allow an
already completed operation to acquire a later failure retroactively.

The current root replay supplied the requested row extent, so successful
admission and completion are allowed. The history title assumed an additional
required acquisition would remain. Its original finite example had not reached
this path before the earlier E6/E7 bail, and the E8 source review preserved the
old grammar without independently challenging this completion premise. The
guard caught that test gap; it must remain.

A narrow legal correction should preserve the old settled root window and a
real fulfilled source wait, while keeping a new required root acquisition held
after compiled operation entry. One candidate is the existing on-demand
marker/include source replay, with the ordered root's finite prior coverage
left intact, rather than truncating the ordered root into complete requested
coverage. This changes the receiving fixture, not the accepted law. It is an
untested path proposal: exact source/grammar review and a positive native-wait,
entry, missing-required-row and pending-root-acquisition witness are necessary
before accepting an implementation of it.

Do not manufacture absence by returning fewer rows than an unbounded provider
request promises, fake a successful wait, fail an unrelated background request,
or move the expected window back after successful settlement. Merely placing
the failure command later cannot fail an operation that already completed.
Preserve the shared comparison and original required state, and express the
fixture correction through the primary grammar so its generated neighbors use
the same mechanism. Any new receiving-boundary limitations must be stated.

The unexecuted changed-source history uses the same root-replay prefix and may
need the same premise correction; this run does not decide its result. Keep that
obligation open. The two completed R02 traces remain bounded finite successes,
the third is a premise failure, and the fourth and all E8 R03 controls remain
unmeasured. No production RED, campaign or broad closure follows.
