# Leader-close design grammar for issue #2085

This bounded TLA+ experiment challenges the design behind PR #2088. It checks
protocol laws against legal schedules and deliberately wrong designs. It does
not execute TypeScript, SQLite, Web Locks, BroadcastChannel, Electron, or OPFS.
See [the mapping](mapping.md) for production owners and receiving limits.

## Authority and laws

The coordinator contract in
`packages/db-sqlite-persistence-core/README.md` promises:

1. A new election reserves a greater durable term before announcing the route.
2. An uncertain mutating RPC is not replayed on an unproved route.
3. A source sync transaction with an indeterminate answer can be reconciled by
   exact immutable `txId` under the writer lock. A present ID acknowledges its
   original committed position. An absent ID permits application only when
   both durable row version and reset epoch match the pre-send anchor.
4. A certified reconciliation notifies peers. A peer that missed the original
   notice reloads rows even if it has observed that stream position.
5. A position-only resume read does not publish rows. An unchanged
   reconciliation reload does not emit a duplicate row change.

The glossary distinguishes durable election term, publicly applied row
version, durable anchor, exact-ID reconciliation, and reconciliation reload.
The executable receiving owners and limits are in the coverage map.

A separately challenged candidate law is stronger: an old-epoch notification
must never publish an old row after a durable reset, even before the receiver
has seen a reset signal. No current contract establishes that cut, and the
built-in coordinator does not send `collection:reset`.

## Grammar

The model has one Collection, three tabs, one immutable source transaction X,
one same-key peer write Y, and at most one reset. A is the original owner, B
the successor, and C a passive public-row receiver. Terms are 1 and 2; row
versions and stream sequences are bounded by 2; reset epochs are 0 and 1.
`Scenario` selects route-only, exact-ID, or reset histories.

| Dimension        | Legal choices and order                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X                | X captures a row-version and reset-epoch anchor. A applies it once or closes first. A's answer is lost on close.                                                                                      |
| Election         | B reserves a term after A closes. A's and B's heartbeats may reach C in either order. B begins without a useful in-memory term.                                                                       |
| Competing write  | B may write Y before or after reconciliation. Y overwrites X's key. A committed X may be pruned from the exact-ID ledger without changing rows or row version.                                        |
| Reset            | B may reset before or after reconciliation. Reset clears rows and the ID ledger and starts a new row-version series in the same term. Its signal may be delayed separately from an old commit notice. |
| Peer observation | C may observe a durable position without loading rows. Notices may be delayed or reordered. The original X notice may be lost.                                                                        |
| Settlement       | Reconciliation and applied-receipt settlement are separate. C may process a notice before or after the receipt settles.                                                                               |

The writer-lock cut is atomic. A durable action sends its notice after the
durable change. X cannot be submitted twice by A, a `txId` cannot change
payload, and B cannot lead before A releases leadership. These exclusions
are guards, not conclusions inferred from green checks. An ordinary
contiguous notice may publish its own delta; gaps reload durable rows.
Reconciliation and delivered reset notices certify a durable reload.
The semantic epoch on a model notice is **oracle-only**: production
`tx:committed` does not carry it.

### Public checkpoints

- After C receives B's heartbeat, A's delayed heartbeat cannot switch C's
  route back to A.
- At reconciliation's writer-lock cut, present X acknowledges its original
  position; absent X applies only against the unchanged anchor.
- At receipt settlement, fulfillment means X was durable once.
- At C's reconciliation-reload cut, the public row matches the durable row
  even if C observed only the position. An unchanged reload emits no event.
- After C receives a reset signal, an old-epoch notice cannot republish X.
  A position-only observation never publishes rows.

Safety checks impose no fairness: a message may remain undelivered.
Fair checks assume weak fairness for B's election, reconciliation, receipt
settlement, and delivery of queued messages. This is a conditional local
progress experiment, not a network or crash-recovery promise.

## Reproduce the TLC campaign

Use the pinned TLA+ 1.7.4 JAR (SHA-256 in `toolchain.json`) and Java:

```sh
python3 run_checks.py --java /path/to/java --jar /path/to/tla2tools.jar
```

The runner writes generated configs, complete TLC logs, state files, and
receipts to `/tmp/issue-2085-tlc-results` by default. It rejects a fault
or reachability control that fails for the wrong invariant, a parser error,
a timeout, or a nonzero baseline result. `checks.json` is the case inventory.

The recorded run exhausted these bounded graphs with no invariant or fair
progress error:

| Baseline | Distinct states | Terminal queue |
| -------- | --------------: | -------------: |
| Route    |               8 |              0 |
| Exact-ID |           2,866 |              0 |
| Reset    |          22,746 |              0 |

Thirteen wrong-design checks failed at their named law:

| Wrong design                                                       | Rejected law                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| Reuse A's term; accept a lower heartbeat                           | `DurableTermUnique`, then `SuccessorRouteStable` at C |
| Apply absent X after a peer write or reset without the full anchor | `AbsentApplyNeedsAnchor`                              |
| Check the anchor before a present exact ID                         | `PresentIdAcknowledged`                               |
| Retain and trust X's old ledger entry after reset                  | `AlreadyAppliedSameEpoch`                             |
| Report a later row version as X's own commit                       | `OriginalPositionReceipt`                             |
| Skip an equal-position reconciliation reload                       | `CertifiedDelivery`                                   |
| Trust an old-epoch payload after receiving reset                   | `CertifiedDelivery`                                   |
| Publish rows on a position-only read                               | `PositionReadIsNotPublication`                        |
| Emit a duplicate event for an unchanged reload                     | `NoDuplicateEvents`                                   |
| Omit the reconciliation reload notice                              | `CertifiedReloadIssued`                               |

Six negated reachability controls were killed by lawful histories: present X
followed by Y still acknowledges X's old position; absent X after Y is
unknown; a lost X notice plus equal position can leave C stale; an
old-epoch notice can remain pending after a reset signal; a genuinely lost
X notice can be repaired by a later reconciliation reload; and a pruned X
becomes unknown. They prevent green invariants from hiding unreachable paths.

A first draft of the lost-notice control was false-green: it allowed the
original notice to be marked lost _after_ C had already reloaded. The retained
control records loss at reconciliation and then a later reload. Pruning also
exposed an illegal generator path where A could apply the original request
again after its ID was pruned. `originalApplied` now excludes that path.
These are repairs to the experiment, not production findings.

## A law boundary exposed by the grammar

The separate `challenge-pre-signal-reset` run tests the stronger candidate
law above. TLC gives a seven-state counterexample:

1. A applies X at term 1, row version 1, but C has not received X's notice.
2. A closes; B reserves term 2 and resets storage to epoch 1, empty row,
   row version 0.
3. Before C receives the reset signal, the delayed X notice arrives.
4. C still knows epoch 0 and public row version 0. The old notice looks
   contiguous, so it publishes X. Durable storage is empty.

A peer that has not learned of a reset cannot infer the new epoch from an
epoch-free old notice. The built-in coordinator has no `collection:reset`
sender, so this is a challenge to a _proposed_ cross-tab reset law, not a
demonstrated production failure on PR #2088. The established post-signal
law passes; a `trustStaleNotice` fault fails at that checkpoint. If a reset
sender is added, the receiving owner needs a decision about the pre-signal
cut and a real Browser/OPFS witness. Adding an epoch field alone does not
inform a peer about an unseen future reset.

## Evidence and limits

The model's finite states satisfy the stated laws under this grammar, and
its invariants distinguish the wrong designs above. This shows the _design
account_ is coherent and nonvacuous. It does not prove production refinement.
The existing SQLite, persisted-wrapper, Browser coordinator, Electron, and
OPFS oracles supply separate receiving evidence.

A controlled persisted-wrapper witness now composes X's original-position
acknowledgment after same-key Y with the owned resume-evidence check. It
observes a fulfilled source receipt, public X row, durable Y row and cursor,
and incompatible resume evidence. A temporary wrong latest-position response
makes that last assertion fail by returning consistent evidence. Real SQLite's
exact-ID decision and that wrapper receiving path are still separate tests;
one joined real-adapter wrapper history remains open.

Other receiving histories still open are:

- One real Browser/OPFS run joining a missed original notice, a no-write
  term reservation, and C's later public rows.
- A built-in reset sender and pre-signal cross-tab reset contract, if that
  behavior becomes supported.

The model also excludes two concurrent source transactions, multiple
Collections, arbitrary pruning windows, cross-version peers, SQLite crash
durability, Electron IPC reply loss, and provider-specific cursor semantics.
Passing these bounded checks makes no claim about those paths.
