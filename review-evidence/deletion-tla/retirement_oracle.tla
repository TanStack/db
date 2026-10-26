---------------------------- MODULE retirement_oracle ----------------------------
EXTENDS Naturals, Sequences, FiniteSets, TLC

(***************************************************************************
 * What survives closing the shared IndexedDB connection?
 *
 * Each operation owns a Collection (Owner(i)=i). Two operations therefore
 * exercise two Collections sharing one descriptor, NOT two optimistic writes
 * in one Collection. The latter already has an executable optimistic owner.
 * Native transaction admission, native outcome, sync acceptance/application,
 * handler completion, and caller settlement are separate cuts here.
 *
 * NativeKind combines Collection insert/update as put; delete is distinct from
 * clear/import because only replacement confirmation uses truncate. The model
 * judges authority and receipts, not row contents or Collection CRUD admission.
 * A captured read represents initial restore or replacement restore. It cannot
 * publish after connection closure; this is an adapter rule, not core cleanup.
 *
 * Policy=suppress declines NEW confirmations after closure, while preserving
 * already accepted sync work. Policy=finish also confirms committed native
 * writes. Neither policy may invent failure after a native commit.
 *
 * PreserveErrorReplacement is an unimplemented semantic requirement of the
 * finish policy. Existing core truncate does NOT provide it. Fault=truncateReady
 * models that known boundary. A passing model is conditional on realizing this
 * rule, not proof that today's helper implements it.
 ***************************************************************************)

CONSTANTS OpCount, Policy, Fault
Ops == 1..OpCount
Kinds == {"put", "delete", "clear", "import"}
Replacement(k) == k \in {"clear", "import"}

VARIABLE s
vars == <<s>>

Init ==
  \E kinds \in [Ops -> Kinds], readKind \in {"initial", "replacement"}:
    s = [open |-> TRUE,
         retired |-> FALSE,
         closeReason |-> "none",
         status |-> [c \in Ops |-> IF c = 1 /\ readKind = "initial"
                                  THEN "loading" ELSE "ready"],
         kind |-> kinds,
         readKind |-> readKind,
         readPending |-> TRUE,
         readPublishedAfterClose |-> FALSE,
         late |-> "absent",
         decision |-> [i \in Ops |-> "pending"],
         native |-> [i \in Ops |-> "none"],
         nativeQueue |-> <<>>,
         admittedAfterClose |-> {},
         nativeCommits |-> <<>>,
         confirmation |-> [i \in Ops |-> "none"],
         accepted |-> {},
         pendingSync |-> {},
         published |-> {},
         publishedAfterClose |-> {},
         handlerDone |-> {},
         caller |-> [i \in Ops |-> "pending"]]

(** Connection retirement changes admission before exposing error. Core's sync
    run is not cleaned up; already accepted sync obligations remain. **)
Close(reason) ==
  /\ s.open
  /\ reason \in {"upgrade", "delete", "explicit"}
  /\ LET notify == ~(Fault = "explicitClose" /\ reason = "explicit")
     IN s' = [s EXCEPT !.open = FALSE, !.closeReason = reason,
                      !.retired = notify,
                      !.status = IF notify THEN [c \in Ops |-> "error"]
                                 ELSE @]

FinishRead ==
  /\ s.readPending
  /\ LET canPublish == s.open \/ Fault = "lateRead"
     IN s' = [s EXCEPT !.readPending = FALSE,
                      !.readPublishedAfterClose = canPublish /\ ~s.open,
                      !.status[1] = IF canPublish THEN "ready" ELSE @]

RegisterLate ==
  /\ ~s.open
  /\ s.late = "absent"
  /\ s' = [s EXCEPT !.late = "loading"]

FinishLateStartup ==
  /\ s.late = "loading"
  /\ s' = [s EXCEPT !.late = IF Fault = "lateReady" THEN "ready" ELSE "error"]

Decide(i, result) ==
  /\ s.decision[i] = "pending"
  /\ result \in {"accepted", "rejected"}
  /\ s' = [s EXCEPT !.decision[i] = result]

Admit(i) ==
  /\ s.native[i] = "none"
  /\ s.decision[i] # "pending"
  /\ LET admitted == s.decision[i] = "accepted" /\
                      (s.open \/ Fault = "admitClosed")
     IN s' = [s EXCEPT
       !.native[i] = IF admitted THEN "active" ELSE "notAdmitted",
       !.nativeQueue = IF admitted THEN Append(@, i) ELSE @,
       !.admittedAfterClose = IF admitted /\ ~s.open THEN @ \cup {i} ELSE @]

(** Transactions share one store and commit in native admission order. A queued
    transaction may abort before an older admitted transaction completes. A
    request success is not represented as transaction commit. Both commit and
    abort are explicit environment outcomes; close alone selects neither. **)
FinishNative(i, result) ==
  /\ s.native[i] = "active"
  /\ result \in {"committed", "aborted"}
  /\ result = "aborted" \/ Head(s.nativeQueue) = i
  /\ s' = [s EXCEPT !.native[i] = result,
                   !.nativeQueue = SelectSeq(@, LAMBDA j: j # i),
                   !.nativeCommits = IF result = "committed" THEN Append(@, i)
                                    ELSE @]

(** An ordinary confirmation is accepted while its own optimistic handler is
    persisting. A replacement publishes immediately. Receipt/publication sets
    are a projection of per-Collection queues with at most one entry each. **)
Confirm(i) ==
  /\ s.native[i] \in {"committed", "aborted", "notAdmitted"}
  /\ s.confirmation[i] = "none"
  /\ LET accept == s.native[i] = "committed" /\
                   (s.open \/ Policy = "finish")
         immediate == accept /\ Replacement(s.kind[i])
     IN s' = [s EXCEPT
       !.confirmation[i] = IF accept THEN "accepted" ELSE "suppressed",
       !.accepted = IF accept THEN @ \cup {i} ELSE @,
       !.pendingSync = IF accept /\ ~immediate THEN @ \cup {i} ELSE @,
       !.published = IF immediate THEN @ \cup {i} ELSE @,
       !.publishedAfterClose = IF immediate /\ ~s.open THEN @ \cup {i} ELSE @,
       !.status[i] = IF immediate /\ (s.open \/ Fault = "truncateReady")
                    THEN "ready" ELSE @]

(** Core drops optimistic state and applies accepted confirmation in one
    publication. The stop-all fault discards an accepted obligation; it is not
    a permitted interpretation of declining a NEW confirmation. **)
FinishHandler(i) ==
  /\ s.confirmation[i] # "none"
  /\ i \notin s.handlerDone
  /\ LET apply == i \in s.pendingSync /\
                  ~(Fault = "dropAccepted" /\ ~s.open)
     IN s' = [s EXCEPT
       !.handlerDone = @ \cup {i},
       !.pendingSync = @ \ {i},
       !.published = IF apply THEN @ \cup {i} ELSE @,
       !.publishedAfterClose = IF apply /\ ~s.open THEN @ \cup {i} ELSE @]

SettleCaller(i) ==
  /\ i \in s.handlerDone
  /\ s.caller[i] = "pending"
  /\ LET success == s.native[i] = "committed" /\
                    ~(Fault = "rejectCommitted" /\ ~s.open)
     IN s' = [s EXCEPT !.caller[i] = IF success THEN "fulfilled" ELSE "rejected"]

PrematureCaller(i) ==
  /\ Fault = "prematureSuccess"
  /\ s.native[i] = "active"
  /\ s.caller[i] = "pending"
  /\ s' = [s EXCEPT !.caller[i] = "fulfilled"]

Next ==
  \/ \E reason \in {"upgrade", "delete", "explicit"}: Close(reason)
  \/ FinishRead
  \/ RegisterLate
  \/ FinishLateStartup
  \/ \E i \in Ops:
       \/ \E result \in {"accepted", "rejected"}: Decide(i, result)
       \/ Admit(i)
       \/ \E result \in {"committed", "aborted"}: FinishNative(i, result)
       \/ Confirm(i)
       \/ FinishHandler(i)
       \/ SettleCaller(i)
       \/ PrematureCaller(i)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ s.open \in BOOLEAN
  /\ s.retired \in BOOLEAN
  /\ s.closeReason \in {"none", "upgrade", "delete", "explicit"}
  /\ s.kind \in [Ops -> Kinds]
  /\ s.status \in [Ops -> {"loading", "ready", "error"}]
  /\ s.readKind \in {"initial", "replacement"}
  /\ s.readPending \in BOOLEAN
  /\ s.readPublishedAfterClose \in BOOLEAN
  /\ s.late \in {"absent", "loading", "ready", "error"}
  /\ s.decision \in [Ops -> {"pending", "accepted", "rejected"}]
  /\ s.native \in [Ops -> {"none", "active", "committed", "aborted", "notAdmitted"}]
  /\ s.nativeQueue \in Seq(Ops)
  /\ s.nativeCommits \in Seq(Ops)
  /\ s.admittedAfterClose \subseteq Ops
  /\ s.confirmation \in [Ops -> {"none", "accepted", "suppressed"}]
  /\ s.accepted \subseteq Ops
  /\ s.pendingSync \subseteq Ops
  /\ s.published \subseteq Ops
  /\ s.publishedAfterClose \subseteq Ops
  /\ s.handlerDone \subseteq Ops
  /\ s.caller \in [Ops -> {"pending", "fulfilled", "rejected"}]

ClosedConnectionsDoNotBecomeReady ==
  ~s.open => (\A c \in Ops: s.status[c] = "error") /\ s.late # "ready"
ReadAuthority == ~s.readPublishedAfterClose
AdmissionAuthority == s.admittedAfterClose = {}
NativeAdmissionAccounting ==
  /\ {s.nativeQueue[j]: j \in 1..Len(s.nativeQueue)} =
      {i \in Ops: s.native[i] = "active"}
  /\ Len(s.nativeQueue) = Cardinality({i \in Ops: s.native[i] = "active"})
TruthfulSettlement ==
  \A i \in Ops:
    /\ (s.caller[i] = "fulfilled" => s.native[i] = "committed")
    /\ (s.caller[i] = "rejected" => s.native[i] # "committed")
AcceptedWorkIsAccountedFor == s.accepted = s.pendingSync \cup s.published
OnlyCommittedWritesPublish == \A i \in s.published: s.native[i] = "committed"
AcceptedWorkPrecedesCaller ==
  \A i \in s.accepted: s.caller[i] = "fulfilled" => i \in s.published
FinishPolicyConfirms ==
  Policy = "finish" =>
    (\A i \in Ops: s.caller[i] = "fulfilled" => i \in s.published)

(** Suppression's declared cost: this stronger observation cannot remain true
    for all successes if closure discards a not-yet-accepted confirmation. **)
EverySuccessIsConfirmed ==
  \A i \in Ops: s.caller[i] = "fulfilled" => i \in s.published

(** An explicitly challenged stronger claim, not a default invariant. Accepted
    work may publish after closure without restoring Collection readiness. **)
StrictPublicationSilence == s.publishedAfterClose = {}

(** Conditional progress only: application decisions and native outcomes must
    eventually arrive; local enabled continuation steps must be scheduled.
    No fairness requires a user handler or unmanaged blocker in a browser to
    cooperate. This optional configuration states that assumption explicitly. **)
FairSpec == Spec /\
  \A i \in Ops:
    /\ WF_vars(\E r \in {"accepted", "rejected"}: Decide(i, r))
    /\ WF_vars(Admit(i))
    /\ WF_vars(\E r \in {"committed", "aborted"}: FinishNative(i, r))
    /\ WF_vars(Confirm(i))
    /\ WF_vars(FinishHandler(i))
    /\ WF_vars(SettleCaller(i))
CallersEventuallySettle == <>(\A i \in Ops: s.caller[i] # "pending")
=============================================================================
