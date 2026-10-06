-------------------------- MODULE deletion_queue_oracle --------------------------
EXTENDS Naturals, Sequences, TLC

(***************************************************************************
 * A database name is not a database lifetime.
 *
 * This bounded native connection queue contains delete, recreate/open, delete.
 * Recreate combines consecutive managed and unmanaged opens plus initial
 * restore, with no intervening delete. It does not model intermediate open
 * callbacks. Both opens precede the second delete in the native queue.
 * Both delete invocations can have been made while the original descriptor
 * existed. Selection of the actual target happens at the request's queue turn.
 * The numbers 1 and 2 are GHOST identities used by the checker: no stored
 * identity, broadcast token, or conditional native deletion is proposed.
 *
 * Each lifetime has one managed connection and one unmanaged blocker. The first
 * also has an already admitted transaction. Managed close forbids new work but
 * the existing native transaction and unmanaged blockers delay deletion.
 * Native completion and caller completion are separate. An old native receipt
 * can be delivered after recreation and while its later deletion is blocked.
 ***************************************************************************)

CONSTANT Fault
VARIABLE s
vars == <<s>>
Deletes == {1, 2}

Init == s = [position |-> 1, database |-> 1,
             managed |-> [n \in Deletes |-> n = 1],
             blockers |-> [n \in Deletes |-> TRUE],
             transactionActive |-> TRUE,
             status |-> [n \in Deletes |-> IF n = 1 THEN "ready" ELSE "absent"],
             publicRow |-> [n \in Deletes |-> IF n = 1 THEN "A" ELSE "absent"],
             createdSecond |-> FALSE,
             target |-> [n \in Deletes |-> 0],
             request |-> [n \in Deletes |-> "queued"],
             nativeSuccess |-> {}, callerSuccess |-> {},
             deletedWhileBlocked |-> FALSE]

CurrentDelete == IF s.position = 1 THEN 1 ELSE 2

AnnounceDelete ==
  /\ s.position \in {1, 3}
  /\ LET i == CurrentDelete IN
       /\ s.request[i] = "queued"
       /\ s' = [s EXCEPT !.request[i] = "announced",
                        !.target[i] = s.database,
                        !.managed[s.database] = FALSE,
                        !.status[s.database] = "error"]

FinishOldTransaction ==
  /\ s.transactionActive
  /\ s' = [s EXCEPT !.transactionActive = FALSE]

ReleaseBlocker(n) ==
  /\ s.blockers[n]
  /\ n = 1 \/ s.createdSecond
  /\ s' = [s EXCEPT !.blockers[n] = FALSE]

FinishDelete ==
  /\ s.position \in {1, 3}
  /\ LET i == CurrentDelete
         blocked == s.blockers[s.database] \/
                    (s.database = 1 /\ s.transactionActive)
     IN /\ s.request[i] = "announced"
        /\ ~blocked \/ Fault = "ignoreBlocker"
        /\ s' = [s EXCEPT !.nativeSuccess = @ \cup {i},
                         !.request[i] = "nativeSuccess",
                         !.database = 0,
                         !.deletedWhileBlocked = @ \/ blocked,
                         !.position = @ + 1]

Recreate ==
  /\ s.position = 2
  /\ s.database = 0
  /\ s' = [s EXCEPT !.database = 2, !.createdSecond = TRUE,
                   !.managed[2] = TRUE,
                   !.status[2] = "ready", !.publicRow[2] = "B",
                   !.position = 3]

(** Administrative caller completion has no Collection row-publication
    authority. The negative control models the old connection-scoped deletion
    signal: any retired B connection incorrectly admits A's delayed receipt. **)
DeliverReceipt(i) ==
  /\ i \in s.nativeSuccess
  /\ i \notin s.callerSuccess
  /\ LET stalePublication == Fault = "oldReceipt" /\ i = 1 /\
                             s.createdSecond /\ s.status[2] = "error"
     IN s' = [s EXCEPT !.callerSuccess = @ \cup {i},
                      !.publicRow[2] = IF stalePublication THEN "empty" ELSE @]

PrematureReceipt(i) ==
  /\ Fault = "prematureReceipt"
  /\ s.request[i] = "announced"
  /\ i \notin s.callerSuccess
  /\ s' = [s EXCEPT !.callerSuccess = @ \cup {i}]

Next ==
  \/ AnnounceDelete
  \/ FinishOldTransaction
  \/ \E n \in Deletes: ReleaseBlocker(n)
  \/ FinishDelete
  \/ Recreate
  \/ \E i \in Deletes: DeliverReceipt(i) \/ PrematureReceipt(i)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ s.position \in 1..4
  /\ s.database \in 0..2
  /\ s.managed \in [Deletes -> BOOLEAN]
  /\ s.blockers \in [Deletes -> BOOLEAN]
  /\ s.transactionActive \in BOOLEAN
  /\ s.createdSecond \in BOOLEAN
  /\ s.status \in [Deletes -> {"absent", "ready", "error"}]
  /\ s.publicRow \in [Deletes -> {"absent", "A", "B", "empty"}]
  /\ s.target \in [Deletes -> 0..2]
  /\ s.request \in [Deletes -> {"queued", "announced", "nativeSuccess"}]
  /\ s.nativeSuccess \subseteq Deletes
  /\ s.callerSuccess \subseteq Deletes
  /\ s.deletedWhileBlocked \in BOOLEAN

NativeDeletionWaits == ~s.deletedWhileBlocked
CallerWaitsForNative == s.callerSuccess \subseteq s.nativeSuccess
RecreatedRowsSurviveOldReceipt == s.database = 2 => s.publicRow[2] = "B"
ClosedConnectionsStayErrored ==
  \A n \in Deletes: s.status[n] # "absent" /\ ~s.managed[n]
                    => s.status[n] = "error"

(** Deliberately overstrong: native delete-by-name does not promise this. **)
DeletionIsBoundToOriginalDescriptor == s.target[2] \in {0, 1}
=============================================================================
