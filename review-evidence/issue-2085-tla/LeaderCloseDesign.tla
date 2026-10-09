------------------------- MODULE LeaderCloseDesign -------------------------
EXTENDS Naturals, FiniteSets, TLC

(***************************************************************************
The one-Collection design grammar for PR #2088.

Established laws: a durable election term increases before a successor route
is announced; an exact transaction ID acknowledges its original position;
absence authorizes application only when the durable row version and reset
epoch still equal the pre-send anchor; a reconciliation reload repairs a peer
that missed the original notice; a position-only read does not publish rows.

The model has one immutable source transaction X, one same-key peer write Y,
one optional reset, an original owner A, successor B, and passive peer C.
The writer lock is abstracted as one atomic durable action. C is a single
public source-row projection, not a modeled live-query Collection. Notices
may be delayed, reordered, or lost (by never choosing their delivery).
A delivered reset makes its epoch known to C. The grammar does not claim
safety for an old-epoch notice delivered before an unseen reset.
***************************************************************************)

CONSTANTS Scenario, Fault
Nodes == {"A", "B", "C"}
Rows == {"empty", "x", "y"}
NoPosition == [term |-> 0, seq |-> 0, version |-> 0]
Position(t, q, v) == [term |-> t, seq |-> q, version |-> v]
Beat(owner, term) == [owner |-> owner, term |-> term]
Notice(kind, term, seq, version, epoch, row) ==
  [kind |-> kind, term |-> term, seq |-> seq, version |-> version,
   epoch |-> epoch, row |-> row]

VARIABLE s
vars == <<s>>

Init ==
  s = [leader |-> "A", aOpen |-> TRUE, bOpen |-> TRUE,
       durableTerm |-> 1, durableSeq |-> 0, durableVersion |-> 0,
       durableEpoch |-> 0, durableRow |-> "empty", appliedIds |-> {},
       xPosition |-> NoPosition, xApplyCount |-> 0,
       originalApplied |-> FALSE, yDone |-> FALSE,
       originalNoticeLost |-> FALSE, xPruned |-> FALSE,
       prunedAtReconcile |-> FALSE, lostAtReconcile |-> FALSE,
       reloadedAfterLostOriginal |-> FALSE, reconNoticeSent |-> FALSE,
       idPresentAtCut |-> FALSE, sameEpochAtCut |-> FALSE,
       resetDone |-> FALSE, source |-> "idle", receipt |-> "pending",
       anchorVersion |-> 0, anchorEpoch |-> 0,
       reconKind |-> "none", anchorMatchedAtCut |-> FALSE,
       reportedPosition |-> NoPosition, resumePosition |-> NoPosition,
       beats |-> {Beat("A", 1)}, routeC |-> "none", routeTermC |-> 0,
       sawSuccessorBeat |-> FALSE, notices |-> {},
       cPublic |-> "empty", cPublicVersion |-> 0, cEpoch |-> 0,
       cObservedVersion |-> 0, resetKnown |-> FALSE,
       cEvents |-> 0, cChangedDeliveries |-> 0,
       certifiedExpected |-> "unchecked", certifiedActual |-> "unchecked",
       preSignalExpected |-> "unchecked",
       preSignalActual |-> "unchecked",
       observedBefore |-> "unchecked", observedAfter |-> "unchecked"]

SendX ==
  /\ Scenario # "route"
  /\ s.source = "idle"
  /\ s.leader = "A" /\ s.aOpen
  /\ s' = [s EXCEPT !.source = "sent",
                    !.anchorVersion = s.durableVersion,
                    !.anchorEpoch = s.durableEpoch]

OriginalApply ==
  /\ Scenario # "route"
  /\ s.source = "sent" /\ s.aOpen /\ ~s.originalApplied
  /\ "X" \notin s.appliedIds
  /\ s.durableVersion < 2
  /\ LET v == s.durableVersion + 1
         q == s.durableSeq + 1
     IN s' = [s EXCEPT
       !.durableVersion = v, !.durableSeq = q, !.durableRow = "x",
       !.appliedIds = @ \cup {"X"},
       !.xPosition = Position(s.durableTerm, q, v),
       !.xApplyCount = @ + 1, !.originalApplied = TRUE,
       !.notices = @ \cup {Notice("tx", s.durableTerm, q, v,
                                s.durableEpoch, "x")}]

CloseA ==
  /\ s.aOpen /\ s.leader = "A"
  /\ (Scenario = "route" \/ s.source = "sent")
  /\ s' = [s EXCEPT !.aOpen = FALSE,
                    !.source = IF Scenario = "route" THEN @ ELSE "lost"]

ElectB ==
  /\ ~s.aOpen /\ s.leader = "A" /\ s.bOpen
  /\ LET nextTerm == IF Fault = "reuseTerm" THEN 1
                     ELSE s.durableTerm + 1
     IN s' = [s EXCEPT
       !.leader = "B", !.durableTerm = nextTerm, !.durableSeq = 0,
       !.beats = @ \cup {Beat("B", nextTerm)}]

DeliverBeat(m) ==
  /\ m \in s.beats
  /\ LET accept == m.term >= s.routeTermC \/ Fault = "acceptOldBeat"
     IN s' = [s EXCEPT
       !.beats = @ \ {m},
       !.routeC = IF accept THEN m.owner ELSE @,
       !.routeTermC = IF accept THEN m.term ELSE @,
       !.sawSuccessorBeat = @ \/ m.owner = "B"]

\* The position read is deliberately separate from public-row publication.
ObservePosition ==
  /\ Scenario # "route"
  /\ s.cObservedVersion # s.durableVersion
  /\ s' = [s EXCEPT
       !.cObservedVersion = s.durableVersion,
       !.observedBefore = s.cPublic,
       !.observedAfter = IF Fault = "publishOnObserve"
                         THEN s.durableRow ELSE s.cPublic,
       !.cPublic = IF Fault = "publishOnObserve"
                   THEN s.durableRow ELSE @]

PeerWrite ==
  /\ Scenario # "route"
  /\ s.leader = "B" /\ s.bOpen /\ ~s.yDone
  /\ s.durableVersion < 2
  /\ LET v == s.durableVersion + 1
         q == s.durableSeq + 1
     IN s' = [s EXCEPT
       !.durableVersion = v, !.durableSeq = q, !.durableRow = "y",
       !.appliedIds = @ \cup {"Y"}, !.yDone = TRUE,
       !.notices = @ \cup {Notice("tx", s.durableTerm, q, v,
                                s.durableEpoch, "y")}]

Reset ==
  /\ Scenario = "reset"
  /\ s.leader = "B" /\ ~s.resetDone
  /\ s' = [s EXCEPT
       !.durableVersion = 0, !.durableSeq = 0,
       !.durableEpoch = 1, !.durableRow = "empty",
       !.appliedIds = IF Fault = "retainStaleLedger" THEN @ ELSE {},
       !.resetDone = TRUE,
       !.notices = @ \cup {Notice("reset", s.durableTerm, 0, 0,
                                1, "empty")}]

\* Reconciliation is one writer-lock cut. A present ID proves X's old
\* position even if a later write has advanced the durable position.
Reconcile ==
  /\ Scenario # "route"
  /\ s.source = "lost" /\ s.leader = "B" /\ s.bOpen
  /\ s.reconKind = "none"
  /\ LET idStored == "X" \in s.appliedIds
         sameEpoch == s.durableEpoch = s.anchorEpoch
         anchored == s.durableVersion = s.anchorVersion /\ sameEpoch
         present == idStored /\
                    ~(Fault = "anchorFirst" /\ ~anchored)
         applyNow == ~present /\
                     (anchored \/ Fault = "ignoreAnchor" \/
                      (Fault = "ignoreEpoch" /\
                       s.durableVersion = s.anchorVersion))
         certified == present \/ applyNow
         v == IF applyNow THEN s.durableVersion + 1
              ELSE s.durableVersion
         q == IF applyNow THEN s.durableSeq + 1 ELSE s.durableSeq
         pos == IF present THEN s.xPosition
                ELSE Position(s.durableTerm, q, v)
         report == IF present /\ Fault = "latestReceipt"
                   THEN Position(s.xPosition.term, s.xPosition.seq,
                                 s.durableVersion)
                   ELSE pos
     IN s' = [s EXCEPT
       !.durableVersion = v, !.durableSeq = q,
       !.durableRow = IF applyNow THEN "x" ELSE @,
       !.appliedIds = IF applyNow THEN @ \cup {"X"} ELSE @,
       !.xPosition = IF applyNow THEN pos ELSE @,
       !.xApplyCount = IF applyNow THEN @ + 1 ELSE @,
       !.reconKind = IF present THEN "already-applied"
                     ELSE IF applyNow THEN "applied-now" ELSE "unknown",
       !.anchorMatchedAtCut = anchored,
       !.idPresentAtCut = idStored, !.sameEpochAtCut = sameEpoch,
       !.lostAtReconcile = s.originalNoticeLost,
       !.prunedAtReconcile = s.xPruned,
       !.reportedPosition = IF certified THEN report ELSE NoPosition,
       !.reconNoticeSent = certified /\ Fault # "noReconcileNotice",
       !.notices = IF certified /\ Fault # "noReconcileNotice"
                   THEN @ \cup {Notice("reconcile", s.durableTerm, q, v,
                                      s.durableEpoch,
                                      IF applyNow THEN "x" ELSE s.durableRow)}
                   ELSE @]

\* A retention prune removes X's exact ID without changing rows or version.
\* The altered anchor must still prevent a second application of X.
PruneX ==
  /\ Scenario # "route" /\ ~s.xPruned /\ "X" \in s.appliedIds
  /\ s' = [s EXCEPT !.appliedIds = @ \ {"X"}, !.xPruned = TRUE]

\* The original BroadcastChannel notice can disappear with the closing tab.
DropOriginalNotice(n) ==
  /\ n \in s.notices /\ n.kind = "tx" /\ n.row = "x"
  /\ s' = [s EXCEPT !.notices = @ \ {n},
                    !.originalNoticeLost = TRUE]

SettleReceipt ==
  /\ s.reconKind # "none" /\ s.receipt = "pending"
  /\ s' = [s EXCEPT
       !.receipt = IF s.reconKind = "unknown" THEN "rejected"
                    ELSE "fulfilled",
       !.resumePosition = IF s.reconKind = "unknown"
                           THEN NoPosition ELSE s.reportedPosition]

\* A normal contiguous notice can publish its own delta. A gap or epoch
\* ambiguity reads durable rows. Reconciliation and reset notices certify a
\* full reload at delivery; the observation is the public row at that cut.
DeliverNotice(n) ==
  /\ n \in s.notices
  /\ LET certified == n.kind \in {"reconcile", "reset"} \/
                      (s.resetKnown /\ n.epoch # s.cEpoch)
         drop == Fault = "dropEqualReload" /\
                 n.kind = "reconcile" /\
                 s.cObservedVersion >= n.version
         trust == Fault = "trustStaleNotice" /\
                  n.kind = "tx" /\ n.epoch # s.cEpoch
         gap == n.kind = "tx" /\ n.epoch = s.cEpoch /\
                n.version > s.cPublicVersion + 1
         reload == (certified \/ gap) /\ ~drop /\ ~trust
         delta == n.kind = "tx" /\ ~reload /\
                  (trust \/ (n.epoch = s.cEpoch /\
                             n.version = s.cPublicVersion + 1))
         nextRow == IF reload THEN s.durableRow
                    ELSE IF delta THEN n.row ELSE s.cPublic
         nextVersion == IF reload THEN s.durableVersion
                        ELSE IF delta THEN n.version
                        ELSE s.cPublicVersion
         nextEpoch == IF reload THEN s.durableEpoch
                      ELSE IF trust THEN n.epoch ELSE s.cEpoch
         changed == nextRow # s.cPublic
     IN s' = [s EXCEPT
       !.notices = @ \ {n},
       !.cPublic = nextRow, !.cPublicVersion = nextVersion,
       !.cEpoch = nextEpoch,
       !.cObservedVersion = IF reload THEN s.durableVersion
                            ELSE IF delta THEN
                              (IF s.cObservedVersion > n.version
                              THEN s.cObservedVersion ELSE n.version)
                            ELSE @,
       !.resetKnown = @ \/ n.kind = "reset",
       !.reloadedAfterLostOriginal =
         @ \/ (n.kind = "reconcile" /\ s.lostAtReconcile /\
               s.cPublic = "empty" /\ nextRow = "x"),
       !.cEvents = @ + (IF changed \/ (Fault = "duplicateReloadEvent" /\
                          n.kind = "reconcile") THEN 1 ELSE 0),
       !.cChangedDeliveries = @ + (IF changed THEN 1 ELSE 0),
       !.certifiedExpected = IF certified THEN s.durableRow
                             ELSE "unchecked",
       !.certifiedActual = IF certified THEN nextRow ELSE "unchecked",
       !.preSignalExpected =
         IF n.kind = "tx" /\ n.epoch < s.durableEpoch /\
            ~s.resetKnown /\ s.cPublic = "empty"
         THEN s.durableRow ELSE "unchecked",
       !.preSignalActual =
         IF n.kind = "tx" /\ n.epoch < s.durableEpoch /\
            ~s.resetKnown /\ s.cPublic = "empty"
         THEN nextRow ELSE "unchecked"]

Next ==
  \/ SendX \/ OriginalApply \/ CloseA \/ ElectB
  \/ \E m \in s.beats: DeliverBeat(m)
  \/ ObservePosition \/ PeerWrite \/ Reset \/ PruneX
  \/ Reconcile \/ SettleReceipt
  \/ \E n \in s.notices: DeliverNotice(n)
  \/ \E n \in s.notices: DropOriginalNotice(n)

DeliverAnyBeat == \E m \in s.beats: DeliverBeat(m)
DeliverAnyNotice == \E n \in s.notices: DeliverNotice(n)

Spec == Init /\ [][Next]_vars
FairSpec == Spec /\ WF_vars(ElectB) /\ WF_vars(Reconcile) /\
            WF_vars(SettleReceipt) /\ WF_vars(DeliverAnyBeat) /\
            WF_vars(DeliverAnyNotice)

ReceiptEventuallySettles ==
  (s.source = "lost") ~> (s.receipt # "pending")

SuccessorEventuallyKnown ==
  (s.leader = "B") ~> s.sawSuccessorBeat

CertifiedVisibilityEventually ==
  (s.reconKind \in {"already-applied", "applied-now"} /\
   s.cPublic # s.durableRow) ~> (s.cPublic = s.durableRow)

\* These negated reachability controls make known legal schedules visible
\* as TLC counterexamples instead of trusting that an action name exists.
NoExactAfterPeerWitness ==
  ~(s.reconKind = "already-applied" /\ s.yDone /\
    s.reportedPosition.version < s.durableVersion)
NoAbsentPeerConflictWitness ==
  ~(s.reconKind = "unknown" /\ s.yDone /\ s.xApplyCount = 0)
NoMissedEqualNoticeWitness ==
  ~(s.reconKind = "already-applied" /\ s.lostAtReconcile /\
    s.cPublic = "empty" /\
    s.cObservedVersion >= s.durableVersion /\
    \E n \in s.notices: n.kind = "reconcile")
NoResetOldNoticeWitness ==
  ~(s.resetKnown /\
    \E n \in s.notices: n.kind = "tx" /\ n.epoch = 0)
NoLostNoticeRecoveryWitness ==
  ~s.reloadedAfterLostOriginal
NoPrunedUnknownWitness ==
  ~(s.prunedAtReconcile /\ s.reconKind = "unknown")

\* This proposed stronger law is checked separately as a challenge, not as
\* an established contract: C has not received a reset signal at this cut.
NoOldEpochBeforeResetSignal ==
  s.preSignalExpected = "unchecked" \/
  s.preSignalActual = s.preSignalExpected

TypeOK ==
  /\ s.leader \in {"A", "B"}
  /\ s.routeC \in {"none", "A", "B"}
  /\ s.durableTerm \in 1..2
  /\ s.durableSeq \in 0..2
  /\ s.durableVersion \in 0..2
  /\ s.durableEpoch \in 0..1
  /\ s.durableRow \in Rows /\ s.cPublic \in Rows
  /\ s.appliedIds \subseteq {"X", "Y"}
  /\ s.xApplyCount \in 0..2
  /\ s.cEvents \in 0..4 /\ s.cChangedDeliveries \in 0..4

DurableTermUnique ==
  s.leader = "B" => s.durableTerm > 1

SuccessorRouteStable ==
  s.sawSuccessorBeat => s.routeC = "B"

AtMostOnce ==
  s.xApplyCount <= 1

AbsentApplyNeedsAnchor ==
  s.reconKind = "applied-now" => s.anchorMatchedAtCut

PresentIdAcknowledged ==
  s.reconKind = "none" \/ ~s.idPresentAtCut \/
  ~s.sameEpochAtCut \/ s.reconKind = "already-applied"

AlreadyAppliedSameEpoch ==
  s.reconKind # "already-applied" \/ s.sameEpochAtCut

PrunedOutcomeUnknown ==
  ~s.prunedAtReconcile \/ s.reconKind = "unknown"

CertifiedReloadIssued ==
  s.reconKind \notin {"already-applied", "applied-now"} \/
  s.reconNoticeSent

OriginalPositionReceipt ==
  s.reconKind = "already-applied" =>
    s.reportedPosition = s.xPosition

ReceiptTruth ==
  s.receipt = "fulfilled" =>
    s.reconKind \in {"already-applied", "applied-now"} /\
    s.xApplyCount = 1

CertifiedDelivery ==
  s.certifiedExpected = "unchecked" \/
  s.certifiedActual = s.certifiedExpected

ResetEpochFence ==
  s.resetKnown => s.cEpoch = s.durableEpoch

NoDuplicateEvents ==
  s.cEvents = s.cChangedDeliveries

PositionReadIsNotPublication ==
  s.observedBefore = "unchecked" \/
  s.observedBefore = s.observedAfter

=============================================================================
