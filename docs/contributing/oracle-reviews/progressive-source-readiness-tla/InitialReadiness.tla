---------------------------- MODULE InitialReadiness ----------------------------
(***************************************************************************)
(* Initial-query readiness over one root source and an optional lazy      *)
(* source (ARCHITECTURE.md law 10, with laws 6 and 7).                     *)
(*                                                                         *)
(* The model checks the frozen design grammar for PR #2115. Every element  *)
(* names the frozen preservation property (P1..P12) or grammar rule (G-name) *)
(* that it encodes. See README.md for the trace table and the exclusions.  *)
(*                                                                         *)
(* Two consumers compute readiness by their own rules: the live query      *)
(* (read by isReady, preload, Suspense, queryOnce, and hydration) and a    *)
(* skipInitial Effect. Each rule runs atomically after every step, as the  *)
(* graph run does in production. The law itself is `Covered`, which is     *)
(* stated independently of both rules.                                     *)
(*                                                                         *)
(* Weakening flags each encode one plausible wrong design. The safe        *)
(* configurations set every flag to FALSE.                                 *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
  RootMode,        \* "eager" or "onDemand" (P9: a source with no syncMode is eager)
  HasLazy,         \* the query has a lazy-join or include child source
  Ordered,         \* the root demand is an ordered window with one continuation (P8)
  Resume,          \* the root resumes from complete local rows (P11)
  MaxAcq,          \* bound on acquisitions
  MaxDisturb,      \* bound on truncates, rekeys, and must-refetches
  \* Weakenings (each one plausible wrong design)
  OldRule,         \* gate a non-lazy on-demand root on Collection readiness
  IgnoreEager,     \* never gate on Collection readiness
  EffectNoTakeover,\* Effect releases a truncated hold without adopting the replacement
  EffectAbortLatch,\* Effect treats an aborted hold as a failure (shared latch)
  AbortIsFailure,  \* live query fails lazy demand that a truncate aborted
  SettleWithoutRows,\* progressive load settles during a reset without rows
  RetryNoRenew,    \* a retried stream keeps the rejected snapshot
  Recompute,       \* readiness is recomputed instead of latched
  WindowEarly      \* the window continuation is issued after a readiness pass

ASSUME RootMode \in {"eager", "onDemand"}

Ids == 1..MaxAcq
Status == {"none", "pending", "settled", "aborted", "failed"}
Cause == {"none", "real", "stale"}
Phase == {"buffering", "resetting", "established", "errored"}

VARIABLES
  started,      \* a subscriber or preload exists (P7)
  acq,          \* acquisitions: source, status, rows visible, current, Effect hold
  nextId,
  chain,        \* number of window continuations issued for the current root demand
  phase,        \* progressive producer phase (onDemand root only)
  snap,         \* the established-snapshot deferred: "pending" | "resolved" | "rejected"
  srcReady,     \* root Collection readiness (markReady)
  liveCause,    \* why the live query errored, if it did
  effCause,     \* why the Effect was disposed by failure, if it was
  disposed,     \* cleanup of the consumers' owner
  liveReady, effectReady,
  coveredAtReady, rowsAtReady, \* history: law and soundness at the live transition
  disturb, errors

vars == <<started, acq, nextId, chain, phase, snap, srcReady, liveCause, effCause,
          disposed, liveReady, effectReady, coveredAtReady, rowsAtReady, disturb, errors>>

Empty == [src |-> "root", st |-> "none", rows |-> FALSE, cur |-> FALSE, held |-> FALSE]
Pending(s, h) == [src |-> s, st |-> "pending", rows |-> FALSE, cur |-> TRUE, held |-> h]

HasCur(a, s) == \E i \in Ids : a[i].cur /\ a[i].src = s
RootRowsVisible(a, ready) ==
  IF RootMode = "eager" THEN ready
  ELSE \E i \in Ids : a[i].cur /\ a[i].src = "root" /\ a[i].rows

\* G-lazy: lazy demand is issued in the same graph run that makes root rows visible.
NeedsLazy(a, ready) == HasLazy /\ RootRowsVisible(a, ready) /\ ~HasCur(a, "lazy")
AddLazy(a, n, ready) == IF NeedsLazy(a, ready) THEN [a EXCEPT ![n] = Pending("lazy", TRUE)] ELSE a
AfterLazy(a, n, ready) == IF NeedsLazy(a, ready) THEN n + 1 ELSE n
CanAlloc(k) == nextId + k - 1 <= MaxAcq

---------------------------------------------------------------------------
(* The law (P1), stated without either consumer's rule.                    *)
Covered ==
  /\ started /\ ~disposed
  /\ RootMode = "eager" => srcReady
  /\ RootMode = "onDemand" => HasCur(acq, "root")
  /\ (HasLazy /\ RootRowsVisible(acq, srcReady)) => HasCur(acq, "lazy")
  /\ (Ordered /\ RootMode = "onDemand") => chain = 1
  /\ \A i \in Ids : acq[i].cur => acq[i].st = "settled"

\* Evidence soundness (P2): every current settled acquisition shows its rows.
RowsVisible == \A i \in Ids : (acq[i].cur /\ acq[i].st = "settled") => acq[i].rows

\* The shared helper sourcePermitsInitialReadiness (G-permit), and its weakenings.
RootPermits ==
  IF OldRule THEN srcReady
  ELSE RootMode = "onDemand" \/ IgnoreEager \/ srcReady

LiveRule ==
  /\ started /\ ~disposed /\ liveCause = "none"
  /\ RootPermits
  /\ \A i \in Ids : acq[i].cur => acq[i].st = "settled"

\* Effect: its holds are tracked promises; an aborted hold releases (G-hold).
EffectRule ==
  /\ started /\ ~disposed /\ effCause = "none"
  /\ RootPermits
  /\ \A i \in Ids : acq[i].held => acq[i].st \in {"settled", "aborted"}

UpdateConsumers ==
  /\ liveReady' = IF Recompute THEN LiveRule' ELSE (liveReady \/ LiveRule')
  /\ effectReady' = IF Recompute THEN EffectRule' ELSE (effectReady \/ EffectRule')
  /\ coveredAtReady' = IF ~liveReady /\ liveReady' THEN Covered' ELSE coveredAtReady
  /\ rowsAtReady' = IF ~liveReady /\ liveReady' THEN RowsVisible' ELSE rowsAtReady

---------------------------------------------------------------------------
Init ==
  /\ started = FALSE
  /\ acq = [i \in Ids |-> Empty]
  /\ nextId = 1
  /\ chain = 0
  /\ phase = IF Resume THEN "established" ELSE "buffering"
  /\ snap = IF Resume THEN "resolved" ELSE "pending"
  /\ srcReady = (Resume /\ RootMode = "onDemand")
  /\ liveCause = "none" /\ effCause = "none"
  /\ disposed = FALSE
  /\ liveReady = FALSE /\ effectReady = FALSE
  /\ coveredAtReady = TRUE /\ rowsAtReady = TRUE
  /\ disturb = 0 /\ errors = 0

\* P7: acquisition starts only with a subscriber.
Start ==
  /\ ~started /\ CanAlloc(2)
  /\ started' = TRUE
  /\ LET a1 == IF RootMode = "onDemand"
                 THEN [acq EXCEPT ![nextId] = Pending("root", TRUE)] ELSE acq
         n1 == IF RootMode = "onDemand" THEN nextId + 1 ELSE nextId
     IN /\ acq' = AddLazy(a1, n1, srcReady)
        /\ nextId' = AfterLazy(a1, n1, srcReady)
  /\ UNCHANGED <<chain, phase, snap, srcReady, liveCause, effCause, disposed, disturb, errors>>
  /\ UpdateConsumers

\* Buffered initial sync: fetchSnapshot installs rows for a root load.
DeliverRoot(i) ==
  /\ started /\ ~disposed /\ RootMode = "onDemand" /\ phase = "buffering"
  /\ acq[i].cur /\ acq[i].src = "root" /\ acq[i].st = "pending" /\ ~acq[i].rows
  /\ CanAlloc(1)
  /\ LET a1 == [acq EXCEPT ![i].rows = TRUE]
     IN /\ acq' = AddLazy(a1, nextId, srcReady)
        /\ nextId' = AfterLazy(a1, nextId, srcReady)
  /\ UNCHANGED <<started, chain, phase, snap, srcReady, liveCause, effCause, disposed, disturb, errors>>
  /\ UpdateConsumers

DeliverLazy(i) ==
  /\ started /\ ~disposed
  /\ acq[i].cur /\ acq[i].src = "lazy" /\ acq[i].st = "pending" /\ ~acq[i].rows
  /\ acq' = [acq EXCEPT ![i].rows = TRUE]
  /\ UNCHANGED <<started, nextId, chain, phase, snap, srcReady, liveCause, effCause, disposed, disturb, errors>>
  /\ UpdateConsumers

\* Applied settlement (P2): a load settles after its rows are visible. A
\* settled first window segment issues its continuation in the same run (P8).
NeedsContinuation(i) ==
  Ordered /\ acq[i].src = "root" /\ chain = 0 /\ ~WindowEarly

SettleWith(i, a0) ==
  LET a1 == [a0 EXCEPT ![i].st = "settled", ![i].rows = TRUE]
      cont == NeedsContinuation(i)
      a2 == IF cont THEN [a1 EXCEPT ![nextId] = Pending("root", TRUE)] ELSE a1
      n2 == IF cont THEN nextId + 1 ELSE nextId
  IN /\ acq' = AddLazy(a2, n2, srcReady)
     /\ nextId' = AfterLazy(a2, n2, srcReady)
     /\ chain' = IF cont THEN 1 ELSE chain

Settle(i) ==
  /\ started /\ ~disposed /\ CanAlloc(2)
  /\ acq[i].cur /\ acq[i].st = "pending" /\ acq[i].rows
  /\ SettleWith(i, acq)
  /\ UNCHANGED <<started, phase, snap, srcReady, liveCause, effCause, disposed, disturb, errors>>
  /\ UpdateConsumers

\* Outside buffering, a progressive load follows the established snapshot (G-snap).
SettleOnSnapshot(i) ==
  /\ started /\ ~disposed /\ RootMode = "onDemand" /\ CanAlloc(2)
  /\ phase # "buffering" /\ snap = "resolved"
  /\ acq[i].cur /\ acq[i].src = "root" /\ acq[i].st = "pending"
  /\ SettleWith(i, acq)
  /\ UNCHANGED <<started, phase, snap, srcReady, liveCause, effCause, disposed, disturb, errors>>
  /\ UpdateConsumers

\* Weakening: the pre-fix Electric reset path resolved without rows.
SettleEarly(i) ==
  /\ SettleWithoutRows
  /\ started /\ ~disposed /\ RootMode = "onDemand" /\ phase = "resetting"
  /\ acq[i].cur /\ acq[i].src = "root" /\ acq[i].st = "pending"
  /\ acq' = [acq EXCEPT ![i].st = "settled"]
  /\ UNCHANGED <<started, nextId, chain, phase, snap, srcReady, liveCause, effCause, disposed, disturb, errors>>
  /\ UpdateConsumers

\* A rejected snapshot fails its waiting load. The failure is real only if
\* the stream is errored now (P6); otherwise it is stale (P10).
FailOnSnapshot(i) ==
  /\ started /\ ~disposed /\ RootMode = "onDemand"
  /\ phase # "buffering" /\ snap = "rejected"
  /\ acq[i].cur /\ acq[i].src = "root" /\ acq[i].st = "pending"
  /\ acq' = [acq EXCEPT ![i].st = "failed"]
  /\ LET c == IF phase = "errored" THEN "real" ELSE "stale"
     IN /\ liveCause' = IF liveCause = "none" THEN c ELSE liveCause
        /\ effCause' = IF effCause = "none" /\ acq[i].held THEN c ELSE effCause
  /\ UNCHANGED <<started, nextId, chain, phase, snap, srcReady, disposed, disturb, errors>>
  /\ UpdateConsumers

WindowContinuation ==
  /\ WindowEarly /\ Ordered /\ chain = 0 /\ CanAlloc(1) /\ ~disposed
  /\ \E i \in Ids : acq[i].cur /\ acq[i].src = "root" /\ acq[i].st = "settled"
  /\ acq' = [acq EXCEPT ![nextId] = Pending("root", TRUE)]
  /\ nextId' = nextId + 1 /\ chain' = 1
  /\ UNCHANGED <<started, phase, snap, srcReady, liveCause, effCause, disposed, disturb, errors>>
  /\ UpdateConsumers

\* A real lazy load failure (P6).
FailLazy(i) ==
  /\ started /\ ~disposed
  /\ acq[i].cur /\ acq[i].src = "lazy" /\ acq[i].st = "pending"
  /\ acq' = [acq EXCEPT ![i].st = "failed"]
  /\ liveCause' = IF liveCause = "none" THEN "real" ELSE liveCause
  /\ effCause' = IF effCause = "none" THEN "real" ELSE effCause
  /\ UNCHANGED <<started, nextId, chain, phase, snap, srcReady, disposed, disturb, errors>>
  /\ UpdateConsumers

\* P3: a truncate aborts the current acquisition of a source; the replacement
\* takes over its hold. Root truncate also restarts the window chain.
Obsolete(a, s) ==
  [i \in Ids |-> IF a[i].cur /\ a[i].src = s
                 THEN [a[i] EXCEPT !.cur = FALSE, !.rows = FALSE,
                                   !.st = IF a[i].st = "pending" THEN "aborted" ELSE a[i].st]
                 ELSE a[i]]
AbortedPending(s) == \E i \in Ids : acq[i].cur /\ acq[i].src = s /\ acq[i].st = "pending"
AbortedHeld(s) == \E i \in Ids : acq[i].cur /\ acq[i].src = s /\ acq[i].st = "pending" /\ acq[i].held

TruncateSrc(s, held) ==
  /\ acq' = [Obsolete(acq, s) EXCEPT ![nextId] = Pending(s, held)]
  /\ nextId' = nextId + 1
  /\ chain' = IF s = "root" THEN 0 ELSE chain
  /\ liveCause' = IF AbortIsFailure /\ s = "lazy" /\ AbortedPending(s) /\ liveCause = "none"
                  THEN "stale" ELSE liveCause
  /\ effCause' = IF EffectAbortLatch /\ AbortedHeld(s) /\ effCause = "none"
                 THEN "stale" ELSE effCause

Truncate(s) ==
  /\ started /\ ~disposed /\ disturb < MaxDisturb /\ CanAlloc(1)
  /\ HasCur(acq, s)
  /\ s = "root" => RootMode = "onDemand"
  /\ TruncateSrc(s, ~EffectNoTakeover)
  /\ disturb' = disturb + 1
  /\ UNCHANGED <<started, phase, snap, srcReady, disposed, errors>>
  /\ UpdateConsumers

\* Lazy join keys change: the old demand is obsolete; new demand is a new hold.
Rekey ==
  /\ HasLazy /\ started /\ ~disposed /\ disturb < MaxDisturb /\ CanAlloc(1)
  /\ HasCur(acq, "lazy")
  /\ acq' = [Obsolete(acq, "lazy") EXCEPT ![nextId] = Pending("lazy", TRUE)]
  /\ nextId' = nextId + 1
  /\ effCause' = IF EffectAbortLatch /\ AbortedHeld("lazy") /\ effCause = "none"
                 THEN "stale" ELSE effCause
  /\ disturb' = disturb + 1
  /\ UNCHANGED <<started, chain, phase, snap, srcReady, liveCause, disposed, errors>>
  /\ UpdateConsumers

---------------------------------------------------------------------------
(* Progressive producer (onDemand root).                                  *)
MustRefetch ==
  /\ RootMode = "onDemand" /\ phase \in {"buffering", "resetting"} /\ ~srcReady
  /\ disturb < MaxDisturb /\ CanAlloc(1)
  /\ phase' = "resetting" /\ snap' = "pending"
  /\ IF started /\ ~disposed /\ HasCur(acq, "root")
     THEN TruncateSrc("root", ~EffectNoTakeover)
     ELSE UNCHANGED <<acq, nextId, chain, liveCause, effCause>>
  /\ disturb' = disturb + 1
  /\ UNCHANGED <<started, srcReady, disposed, errors>>
  /\ UpdateConsumers

\* Up-to-date: the full sync swaps in and the Collection becomes ready.
UpToDate ==
  /\ RootMode = "onDemand" /\ phase \in {"buffering", "resetting"}
  /\ phase' = "established" /\ snap' = "resolved" /\ srcReady' = TRUE
  /\ UNCHANGED <<started, acq, nextId, chain, liveCause, effCause, disposed, disturb, errors>>
  /\ UpdateConsumers

\* A stream error rejects the snapshot and every load waiting on it.
StreamError ==
  /\ RootMode = "onDemand" /\ phase # "errored" /\ errors < 1
  /\ phase' = "errored" /\ snap' = "rejected"
  /\ LET waiting(i) == started /\ ~disposed /\ phase # "buffering" /\ acq[i].cur
                       /\ acq[i].src = "root" /\ acq[i].st = "pending"
     IN /\ acq' = [i \in Ids |-> IF waiting(i) THEN [acq[i] EXCEPT !.st = "failed"] ELSE acq[i]]
        /\ liveCause' = IF (\E i \in Ids : waiting(i)) /\ liveCause = "none" THEN "real" ELSE liveCause
        /\ effCause' = IF (\E i \in Ids : waiting(i) /\ acq[i].held) /\ effCause = "none"
                       THEN "real" ELSE effCause
  /\ errors' = errors + 1
  /\ UNCHANGED <<started, nextId, chain, srcReady, disposed, disturb>>
  /\ UpdateConsumers

\* onError retries: the stream recovers and the snapshot is renewed (P10).
Retry ==
  /\ phase = "errored"
  /\ phase' = IF srcReady THEN "established" ELSE "resetting"
  /\ snap' = IF RetryNoRenew THEN snap ELSE IF srcReady THEN "resolved" ELSE "pending"
  /\ UNCHANGED <<started, acq, nextId, chain, srcReady, liveCause, effCause, disposed, disturb, errors>>
  /\ UpdateConsumers

\* Eager root: markReady after the full dataset applies (P9).
MarkReadyEager ==
  /\ RootMode = "eager" /\ ~srcReady /\ CanAlloc(1)
  /\ srcReady' = TRUE
  /\ IF started /\ ~disposed
     THEN /\ acq' = AddLazy(acq, nextId, TRUE)
          /\ nextId' = AfterLazy(acq, nextId, TRUE)
     ELSE UNCHANGED <<acq, nextId>>
  /\ UNCHANGED <<started, chain, phase, snap, liveCause, effCause, disposed, disturb, errors>>
  /\ UpdateConsumers

\* Cleanup aborts every pending acquisition and runs no first-ready callback.
Cleanup ==
  /\ started /\ ~disposed
  /\ disposed' = TRUE
  /\ acq' = [i \in Ids |-> IF acq[i].st = "pending" THEN [acq[i] EXCEPT !.st = "aborted"] ELSE acq[i]]
  /\ UNCHANGED <<started, nextId, chain, phase, snap, srcReady, liveCause, effCause, disturb, errors>>
  /\ UpdateConsumers

Next ==
  \/ Start \/ Rekey \/ MustRefetch \/ UpToDate \/ StreamError \/ Retry
  \/ MarkReadyEager \/ Cleanup \/ WindowContinuation
  \/ \E i \in Ids : DeliverRoot(i) \/ DeliverLazy(i) \/ Settle(i) \/ SettleOnSnapshot(i)
                    \/ SettleEarly(i) \/ FailOnSnapshot(i) \/ FailLazy(i)
  \/ \E s \in {"root", "lazy"} : Truncate(s)

Spec == Init /\ [][Next]_vars

---------------------------------------------------------------------------
(* Properties                                                             *)
TypeOK ==
  /\ acq \in [Ids -> [src : {"root", "lazy"}, st : Status, rows : BOOLEAN,
                      cur : BOOLEAN, held : BOOLEAN]]
  /\ phase \in Phase /\ snap \in {"pending", "resolved", "rejected"}
  /\ liveCause \in Cause /\ effCause \in Cause

\* P1 (only if): the live query becomes ready only when the law holds.
ReadyMeansCovered == liveReady => coveredAtReady
\* P1 (if): when the law holds and nothing failed, the live query is ready.
ReadyWhenCovered == (Covered /\ liveCause = "none") => liveReady
\* P2: at the readiness transition, settled demand shows its rows.
RowsAtReady == liveReady => rowsAtReady
\* P4: both consumer rules agree while neither has failed.
ConsumersAgree ==
  (liveCause = "none" /\ effCause = "none" /\ ~disposed) => (liveReady = effectReady)
\* P3, P10: an obsolete acquisition or a stale snapshot never causes failure.
NoSpuriousFailure == liveCause # "stale" /\ effCause # "stale"
\* P6: a failed consumer never becomes ready after its failure.
FailureNeverReady ==
  [][/\ (~liveReady /\ liveReady') => liveCause' = "none"
     /\ (~effectReady /\ effectReady') => effCause' = "none"]_vars
\* P7: nothing is acquired and nothing is ready before a subscriber.
DeferredAcquisition == ~started => (nextId = 1 /\ ~liveReady /\ ~effectReady)

\* P5: readiness is monotone. Cleanup adds no first-ready transition.
Monotone == [][/\ liveReady => liveReady'
               /\ effectReady => effectReady']_vars
NoReadyAfterCleanup == [][disposed => (/\ liveReady' = liveReady
                                       /\ effectReady' = effectReady)]_vars
=============================================================================
