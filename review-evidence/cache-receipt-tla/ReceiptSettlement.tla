-------------------------- MODULE ReceiptSettlement --------------------------
EXTENDS TLC

(***************************************************************************
 * Exploratory v1 projection of the accepted-versus-visible boundary during
 * on-demand scoped recovery. One optimistic transaction is persisting, one
 * ordinary source sync transaction may precede a recovery truncate, and one
 * demanded source sync transaction may follow it. The handler may wait for
 * recovery or, in a separate negative case, for its own subset demand.
 *
 * "pre", "truncate", and "fresh" are sync transactions. "accepted" is a
 * model phase; the production accepted sync transaction is an event, not a
 * durable state. A fulfilled receipt means visible application. The Boolean
 * accepted signal models whenSyncAccepted(receipt). "base" represents the
 * exposed authoritative base beneath any optimistic overlay; it does not
 * model that overlay's row value or Collection event batches.
 *
 * The model intentionally does not copy Collection's queue, persistence
 * mutex, or receipt implementation. It asks whether a scoped recovery can
 * release its waiting handler and whether a subset success has applied
 * evidence at its settlement cut. No scheduling fairness is assumed.
 ***************************************************************************
*)

CONSTANTS HoldTruncate, WaitForVisibility, EarlyDemandSuccess,
          DelayAcceptanceSignal, FaultEarlyAcceptanceSignal,
          FaultRetainPreOnTruncate, FaultSkipFreshApply,
          InitiallyPersisting, DemandCaller

VARIABLE s
vars == <<s>>

Init ==
  s = [optimistic |-> IF InitiallyPersisting THEN "persisting" ELSE "settled",
       handler |-> IF InitiallyPersisting THEN "running" ELSE "returned",
       pre |-> "none",
       preAccepted |-> FALSE,
       preReceipt |-> "none",
       truncate |-> "none",
       truncateAccepted |-> FALSE,
       truncateReceipt |-> "none",
       fresh |-> "none",
       freshAccepted |-> FALSE,
       freshReceipt |-> "none",
       recovery |-> "idle",
       demand |-> "none",
       base |-> "old"]

(** A pending ordinary write has no accepted signal. This separate interval
    lets the checker reject a wrapper that reports acceptance before its
    durable/core boundary. **)
BeginPre ==
  /\ s.pre = "none"
  /\ s.recovery = "idle"
  /\ s' = [s EXCEPT
       !.pre = "pending",
       !.preAccepted = FaultEarlyAcceptanceSignal]

(** An ordinary sync transaction may be accepted while an optimistic
    transaction persists. Its applied receipt remains pending until the
    optimistic state drops, but whenSyncAccepted may already settle. **)
AcceptPre ==
  /\ s.pre = "pending"
  /\ s.truncate = "none"
  /\ LET held == s.optimistic = "persisting"
     IN s' = [s EXCEPT
          !.pre = IF held THEN "accepted" ELSE "visible",
          !.preAccepted = ~DelayAcceptanceSignal,
          !.preReceipt = IF held THEN "pending" ELSE "fulfilled",
          !.base = IF held THEN @ ELSE "pre"]

(** The handler may call and await scoped recovery. Recovery begins before
    the truncate; it does not itself confer public or durable evidence. **)
StartRecovery ==
  /\ s.recovery = "idle"
  /\ s' = [s EXCEPT
       !.recovery = "waiting",
       !.handler = IF s.optimistic = "persisting" /\ @ = "running"
                    THEN "waitingRecovery" ELSE @]

(** Core's truncate is an immediate authoritative replacement. It applies
    any earlier accepted sync transaction first, then exposes the empty base.
    HoldTruncate is a deliberately wrong design that queues the truncate. **)
AcceptTruncate ==
  /\ s.recovery = "waiting"
  /\ s.truncate = "none"
  /\ s.pre # "pending"
  /\ LET held == HoldTruncate /\ s.optimistic = "persisting"
     IN s' = [s EXCEPT
          !.truncate = IF held THEN "accepted" ELSE "visible",
          !.truncateAccepted = ~DelayAcceptanceSignal,
          !.truncateReceipt = IF held THEN "pending" ELSE "fulfilled",
          !.pre = IF ~held /\ @ = "accepted" THEN "visible" ELSE @,
          !.preReceipt = IF ~held /\ s.pre = "accepted"
                           THEN "fulfilled" ELSE @,
          !.base = IF held THEN @
                    ELSE IF FaultRetainPreOnTruncate /\ s.pre # "none"
                         THEN "pre" ELSE "empty"]

(** The persisted wrapper normally waits for acceptance. Waiting for
    visibility is observationally equivalent for an immediate truncate, but
    becomes a cycle if a different implementation holds that truncate behind
    the same optimistic handler that awaits recovery. **)
FinishRecovery ==
  /\ s.recovery = "waiting"
  /\ IF WaitForVisibility
       THEN s.truncateReceipt = "fulfilled"
       ELSE s.truncateAccepted
  /\ s' = [s EXCEPT
       !.recovery = "done",
       !.handler = IF @ = "waitingRecovery" THEN "running" ELSE @]

StartDemand ==
  /\ s.recovery = "done"
  /\ s.demand = "none"
  /\ (DemandCaller = "external" \/ s.handler = "running")
  /\ s' = [s EXCEPT
       !.demand = "pending",
       !.handler = IF DemandCaller = "handler"
                    THEN "waitingDemand" ELSE @]

(** A fresh source transaction can be accepted yet held by the optimistic
    transaction. Its demand must not report success until its receipt is
    fulfilled at visibility, even if whenSyncAccepted already settled. **)
AcceptFresh ==
  /\ s.demand = "pending"
  /\ s.fresh = "none"
  /\ LET held == s.optimistic = "persisting"
     IN s' = [s EXCEPT
          !.fresh = IF held THEN "accepted" ELSE "visible",
          !.freshAccepted = ~DelayAcceptanceSignal,
          !.freshReceipt = IF held THEN "pending" ELSE "fulfilled",
          !.base = IF held \/ FaultSkipFreshApply THEN @ ELSE "fresh"]

SettleDemand ==
  /\ s.demand = "pending"
  /\ s.fresh # "none"
  /\ (s.freshReceipt = "fulfilled" \/ EarlyDemandSuccess)
  /\ s' = [s EXCEPT
       !.demand = "success",
       !.handler = IF @ = "waitingDemand" THEN "running" ELSE @]

(** Dropping the optimistic state and draining all accepted sync transactions
    is one publication. Their order is pre, truncate, then fresh. **)
HandlerReturn ==
  /\ s.optimistic = "persisting"
  /\ s.handler = "running"
  /\ s' = [s EXCEPT
       !.optimistic = "settled",
       !.handler = "returned",
       !.pre = IF @ = "accepted" THEN "visible" ELSE @,
       !.preReceipt = IF s.pre = "accepted" THEN "fulfilled" ELSE @,
       !.truncate = IF @ = "accepted" THEN "visible" ELSE @,
       !.truncateReceipt = IF s.truncate = "accepted"
                             THEN "fulfilled" ELSE @,
       !.fresh = IF @ = "accepted" THEN "visible" ELSE @,
       !.freshReceipt = IF s.fresh = "accepted" THEN "fulfilled" ELSE @,
       !.base = IF s.fresh = "accepted" /\ ~FaultSkipFreshApply
                 THEN "fresh"
                 ELSE IF s.truncate = "accepted" THEN "empty"
                 ELSE IF s.pre = "accepted" THEN "pre"
                 ELSE @]

Next == BeginPre \/ AcceptPre \/ StartRecovery \/ AcceptTruncate \/ FinishRecovery \/
        StartDemand \/ AcceptFresh \/ SettleDemand \/ HandlerReturn
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ s.optimistic \in {"persisting", "settled"}
  /\ s.handler \in {"running", "waitingRecovery", "waitingDemand", "returned"}
  /\ s.pre \in {"none", "pending", "accepted", "visible"}
  /\ s.truncate \in {"none", "accepted", "visible"}
  /\ s.fresh \in {"none", "accepted", "visible"}
  /\ s.preAccepted \in BOOLEAN
  /\ s.truncateAccepted \in BOOLEAN
  /\ s.freshAccepted \in BOOLEAN
  /\ s.preReceipt \in {"none", "pending", "fulfilled"}
  /\ s.truncateReceipt \in {"none", "pending", "fulfilled"}
  /\ s.freshReceipt \in {"none", "pending", "fulfilled"}
  /\ s.recovery \in {"idle", "waiting", "done"}
  /\ s.demand \in {"none", "pending", "success"}
  /\ s.base \in {"old", "pre", "empty", "fresh"}

AcceptedSignalFollowsAcceptance ==
  /\ ((s.pre \in {"accepted", "visible"}) <=> s.preAccepted)
  /\ ((s.truncate # "none") <=> s.truncateAccepted)
  /\ ((s.fresh # "none") <=> s.freshAccepted)

AppliedReceiptsFollowVisibility ==
  /\ (s.preReceipt = "fulfilled") <=> (s.pre = "visible")
  /\ (s.truncateReceipt = "fulfilled") <=> (s.truncate = "visible")
  /\ (s.freshReceipt = "fulfilled") <=> (s.fresh = "visible")

TruncateVisibleOnAcceptance == s.truncate # "accepted"

RecoveryCanFinishAfterTruncate ==
  (s.recovery = "waiting" /\ s.truncate # "none") =>
    ENABLED FinishRecovery

DemandSuccessHasAppliedEvidence ==
  s.demand = "success" => s.freshReceipt = "fulfilled"

QueuedPreDrainedByTruncate ==
  s.truncate = "visible" => s.pre # "accepted"

VisibleBaseFollowsLatest ==
  s.base = IF s.fresh = "visible" THEN "fresh"
           ELSE IF s.truncate = "visible" THEN "empty"
           ELSE IF s.pre = "visible" THEN "pre"
           ELSE "old"

(** A negative reachability probe: a handler that awaits its own demand can
    hold that demand's accepted source transaction indefinitely. This is the
    documented self-wait, not a scoped-recovery failure. **)
SelfDemandCycleUnreachable ==
  ~(s.handler = "waitingDemand" /\
    s.optimistic = "persisting" /\
    s.fresh = "accepted" /\
    s.demand = "pending")

=============================================================================
