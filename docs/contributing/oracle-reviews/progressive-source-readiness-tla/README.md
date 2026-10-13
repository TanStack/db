# Initial-readiness design grammar: TLA+ control

This directory holds the bounded TLA+ control for the initial-query readiness
grammar of PR #2115. It checks the internal consequences of the grammar's
transition rules. It does not show that production refines the model. Model D
in `packages/db/tests/query/includes-temporal-oracle.test.ts` and the receiving
witnesses listed in `../progressive-source-readiness.md` own that claim.

## Frozen preservation list

The user confirmed these properties before extraction. S marks a
source-stated property, and I marks an analyst-inferred property.

| ID | Property | Basis |
| --- | --- | --- |
| P1 | A consumer is initially ready exactly when every reachable current demand is settled and every eager source is ready. | S, ARCHITECTURE.md law 10 |
| P2 | A load settles only when its rows are visible or the source owns their absence. | S, law 7 |
| P3 | An obsolete or aborted acquisition neither satisfies nor blocks readiness. A truncate replacement takes over the hold. | S, law 6 and replay rules |
| P4 | Live-query readiness and the end of Effect `skipInitial` suppression happen at the same point. Readers of live-query status (`isReady`, preload, Suspense, `queryOnce`, hydration) inherit it. | I |
| P5 | Initial readiness is monotone across later truncate, rekey, and reset. | I |
| P6 | A real load failure errors a live query and disposes an Effect. It never produces readiness. | S, AGENTS.md |
| P7 | Without a subscriber or preload, nothing is acquired. | S, law 15 |
| P8 | An ordered window stays unpublished until its request chain settles. | S |
| P9 | An eager source gates readiness. A source with no `syncMode` is eager. | S |
| P10 | After `onError` retries a stream error, later loads settle when the stream recovers. | I, from J1 |
| P11 | A source that resumes from complete local rows settles its loads at once. | S, Electric oracle |
| P12 | Freshness after readiness is outside this law. | S, a limit |

## Grammar to model trace

| Grammar item | TLA+ element |
| --- | --- |
| Source mode and Collection readiness (P9) | `RootMode`, `srcReady`, `MarkReadyEager` |
| Acquisition: status, visible rows, current, Effect hold | `acq` records |
| Shared rule `sourcePermitsInitialReadiness` | `RootPermits` |
| The law, independent of both consumer rules (P1) | `Covered` |
| Live-query rule | `LiveRule`, latched by `UpdateConsumers` |
| Effect rule: tracked holds that release on settle or abort | `EffectRule`, `held` |
| G-lazy: lazy demand starts in the graph run that shows root rows | `AddLazy` in `Start`, `DeliverRoot`, `SettleWith`, `MarkReadyEager` |
| G-window: the continuation starts when the first segment settles (P8) | `NeedsContinuation`, `chain` |
| Applied settlement (P2) | `Settle` requires rows, `SettleOnSnapshot` installs rows |
| G-snap: a progressive load outside buffering follows the established snapshot | `SettleOnSnapshot`, `FailOnSnapshot`, `snap` |
| Truncate with replacement takeover (P3) | `Truncate`, `TruncateSrc`, `MustRefetch` |
| Rekey of lazy demand (P3) | `Rekey` |
| Real failures (P6) | `FailLazy`, `StreamError` |
| Retry and renew (P10) | `Retry` |
| Complete resume (P11) | `Resume` in `Init` |
| Deferred acquisition (P7) | `started`, `Start` |
| Cleanup | `Cleanup`, `NoReadyAfterCleanup` |

Properties: `ReadyMeansCovered` and `ReadyWhenCovered` (P1), `RowsAtReady` (P2),
`NoSpuriousFailure` (P3, P10), `ConsumersAgree` (P4), `Monotone` (P5),
`FailureNeverReady` (P6), `DeferredAcquisition` (P7). P8, P9, and P11 enter
through `Covered` and the configurations.

## Boundary matrix and exclusions

Each axis lists the values in the model. Excluded values give a reason and
their owner.

- **Consumers:** live query, `skipInitial` Effect. Status readers are not
  separate rules. They read live-query status, and the exposure witnesses
  check them in each framework. `toArrayWhenReady` and `stateWhenReady`
  resolve through `preload()`. The audit found that they resolved on first
  data, and the user chose to make them follow readiness.
- **Source modes:** an eager root; an on-demand root that buffers
  progressively; an on-demand root that resumes from complete rows; an
  on-demand lazy source. Excluded: an eager lazy source, whose readiness is
  the eager rule (Model D eager shapes).
- **Shapes:** direct, ordered window with one continuation, lazy child.
  Excluded: two on-demand roots (#2117), and include children as distinct
  from lazy joins. Both use the same `AddLazy` rule in this abstraction.
- **Lifecycle events:** start, delivery, settle, truncate, rekey,
  must-refetch, up-to-date, stream error, retry, real lazy failure, and
  cleanup. At most two disturbances and one stream error. Excluded: unload
  and restart (cleanup and restart oracle), and changes after readiness
  (P12).
- **Checkpoints:** the readiness transition (history variables) and every
  state (invariants).

## Runs

TLC 2.19 (rev 5a47802) through the Field Lab container, with `-deadlock`:

| Configuration | Result |
| --- | --- |
| `safe-progressive-lazy` | no error, 11,426 distinct states |
| `safe-progressive-ordered` | no error, 1,713 distinct states |
| `safe-eager-lazy` | no error, 135 distinct states |
| `safe-resume-lazy` | no error, 1,679 distinct states |

Each weakened configuration turns on one wrong design and checks only its
target property:

| Configuration | Wrong design | Counterexample | Violated |
| --- | --- | --- | --- |
| `weak-old-rule` | gate an on-demand root on Collection readiness (#2113) | Start, DeliverRoot, Settle | `ReadyWhenCovered` |
| `weak-ignore-eager` | never gate on Collection readiness | Start | `ReadyMeansCovered` |
| `weak-effect-no-takeover` | Effect releases a truncated hold without its replacement | Start, MustRefetch | `ConsumersAgree` |
| `weak-effect-abort-latch` | Effect treats an aborted hold as a failure | Start, MustRefetch | `NoSpuriousFailure` |
| `weak-abort-is-failure` | live query fails truncated lazy demand (on `main`) | UpToDate, Start, SettleOnSnapshot, Truncate | `NoSpuriousFailure` |
| `weak-settle-without-rows` | a progressive load settles during a reset without rows | MustRefetch, Start, SettleEarly | `RowsAtReady` |
| `weak-retry-no-renew` | a retry keeps the rejected snapshot (J1) | Start, StreamError, Retry, FailOnSnapshot | `NoSpuriousFailure` |
| `weak-recompute` | readiness is recomputed, not latched | Start, UpToDate, SettleOnSnapshot, Cleanup | `Monotone` |
| `weak-window-early` | the continuation starts after a readiness pass | Start, UpToDate, SettleOnSnapshot | `ReadyMeansCovered` |

## Encoding receipt

The first safe run found a counterexample to `ReadyMeansCovered` in
`safe-progressive-lazy` and `safe-resume-lazy`: Start, SettleOnSnapshot. The
model made root rows visible at settlement but did not issue their lazy
demand. That broke G-lazy, so it was an encoding failure, not a grammar
failure. `SettleWith` now calls `AddLazy`. The failed run also ablates G-lazy:
without it, the law fails.

## Limits

- The model has one root and one lazy source, at most seven acquisitions,
  and at most two disturbances.
- `Monotone` latches readiness through cleanup. In production, cleanup
  moves the status to `cleaned-up`. The property claims only that cleanup
  adds no first-ready transition.
- A load that is waiting when a stream error arrives fails, even if
  `onError` later retries. The model and production agree on this. Whether
  such a failure is real under P6 is a product decision.
- The model has no fairness and no liveness property.

## Run

```sh
~/.claude/skills/field-lab/scripts/tlc . -deadlock -config safe-progressive-lazy.cfg InitialReadiness
```
