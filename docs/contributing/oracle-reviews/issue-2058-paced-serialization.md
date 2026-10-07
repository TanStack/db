# Paced persistence serialization review

Reviewed product commit: `632e46944241e64d91f46fd874de90d70d226cf8`.
Base: `9e8ed997885fb46ac98ec85906f4ca4f662e7cce`. The review record and
changeset follow that product commit. The primary executable owner is
`packages/db/tests/paced-mutations-oracle.test.ts`.

## Contract and result

The paced mutations guide promises at most one pending and one persisting
transaction for debounce and throttle. The queue strategy promises serial
persistence. Issue #2058 demonstrated two concurrent backend handlers for
debounce and throttle. A manual rollback exposed the same overlap in queue:
the public receipt rejected before its active handler returned, so the next
handler started early.

The repair separates admission from persistence. A rejected paced call owns an
isolated transaction, while admitted calls can merge into the one pending
transaction. Debounce and throttle reserve a leading edge before `onMutate`
can reenter. A shared serial pacer waits for actual `Transaction.commit()`
completion, rather than receipt settlement, before it starts another handler.
Queue uses that same completion boundary. A manual rollback still rejects its
public receipt immediately.

## Law, histories, and observation cuts

The independent two-call rule starts the successor only after both its timer
edge and the first handler's release. The oracle enumerates 24 successful
hold/release histories across debounce and throttle. It crosses leading,
non-leading, and omitted-leading options, with release before, at, and after
the edge. The model computes `max(eligibleAt, releaseAt)` without importing
the production scheduler. The immediate handoff is the chosen pacing policy;
the guide's serialization promise alone supplies the lower bound.

The production driver uses real Collections, strategies, and transactions.
It controls handler promises and a virtual clock. At admission, the timer
edge, handler release, and final drain, it checks every handler start, active
handler count, transaction state, receipt outcome and identity, and optimistic
rows. Adjacent histories distinguish a renewed debounce quiet period, throttle
spacing from actual starts, and dropped-call admission isolation. The
settlement grammar crosses both factories, leading modes, same/distinct keys,
first-handler success or rejection, and pending cancellation. Manual rollback
crosses debounce, throttle, and queue. Nested `onMutate` checks one merged
leading write, no stale timer, and a later usable admission.

Original production fails 18 of the 24 held-edge histories at the concurrency
assertion. The six release-before-edge controls pass. Before the final repair,
manual rollback fails at the active-handler assertion for each of the three
strategies. Nested admission fails for debounce and throttle. These are
assertion kills at the promised intermediate cuts, not timeouts. The repaired
owner and ordinary pacing tests pass 136/136 on the reviewed base. Focused
TypeScript, ESLint, Prettier, and the DB package build pass. The build reports
non-fatal missing Expo example configuration warnings.

## Oracle guide audit

| Requirement | Result for this owner |
| --- | --- |
| ORC-001 | The guide supplies serialization and timing authority. The opening oracle prose and coverage map state finite limits. |
| ORC-002 | Expected times come from timer eligibility and handler release, not a production pacer or classifier. |
| ORC-003 | Opening prose states the contract; nearby model, action grammar, production driver, and assertions remain distinct. |
| ORC-004 | The 24-cell matrix is bounded enumeration with explicit release offsets. It does not claim random reach. |
| ORC-005 | Real production entry points reach held handlers. The recorder retains ordered starts and intermediate receipts. |
| ORC-006 | Original overlap, early release after rollback, and duplicate leading starts fail their intended assertions. |
| ORC-007 | No important random property is introduced. Named finite tests provide direct replay. |
| ORC-008 | The two-call expected rule is a prerequisite calculation, not a copied production state machine. |
| ORC-009 | Model `pendingIds` combines optimistic mutations. Handler completion and public receipt settlement stay separate. |
| ORC-010 | Cleanup releases held promises and preserves a primary assertion when cleanup also fails. |
| ORC-011 | A second equivalent formulation is unnecessary for the max-prerequisite rule. The issue's direct two-call probe provides a separate public concurrency observation. |
| ORC-012 | This record states the bounded closure, kills, checks, limits, and each guide outcome for the reviewed product commit. |
| ORC-013 | Edge-before/at/after releases, renewed quiet, delayed actual-start spacing, and nested admission reject nearby wrong designs. |
| ORC-014 | The claim is limited to controlled DB source execution. No real-server, framework, or npm handoff is claimed. |

The repaired source paths have no known reachable counterexample in the named
grammar. The coverage map owns provider echo, cleanup during a held handler,
longer arbitrary bursts, held default options, and multiple-manager histories.
Those gaps limit the evidence; a passing finite suite does not prove every
possible history. Server ordering, framework scheduling, and published npm
behavior require separate receiving witnesses.
