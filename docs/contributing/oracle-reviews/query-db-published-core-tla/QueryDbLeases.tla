---------------------------- MODULE QueryDbLeases ----------------------------
EXTENDS TLC

\* Bounded grammar: one full-source acquisition and two equal filtered
\* acquisitions. The first filter may share the full Query; a later equal
\* filter may use its own Query when full coverage becomes ineligible. This
\* grammar selects that route; a pending demand may instead wait for full.
\* Only Query DB acquisitions participate. A direct Query Core caller is out
\* of scope. This model omits row contents, persistence, and fetch precedence.
CONSTANTS WrongHashRelease, WrongAcquisitionAbort

Owners == {"full", "old", "new"}
Queries == {"none", "full", "exact"}

VARIABLES logical, lease, eligible, exactApplied,
          fullFetchOpen, fullSignalRead, fullSignalAborted
vars == <<logical, lease, eligible, exactApplied,
          fullFetchOpen, fullSignalRead, fullSignalAborted>>

FullObserved == \E owner \in Owners : lease[owner] = "full"
ExactRowPublic == exactApplied /\ lease["new"] = "exact"
ExactRowOwed == exactApplied /\ "new" \in logical /\ lease["new"] = "exact"

Init ==
  /\ logical = {"full"}
  /\ lease = [owner \in Owners |-> IF owner = "full" THEN "full" ELSE "none"]
  /\ eligible = TRUE
  /\ exactApplied = FALSE
  /\ fullFetchOpen = FALSE
  /\ fullSignalRead = FALSE
  /\ fullSignalAborted = FALSE

AcquireOld ==
  /\ "old" \notin logical
  /\ eligible
  /\ "full" \in logical
  /\ logical' = logical \cup {"old"}
  /\ lease' = [lease EXCEPT !["old"] = "full"]
  /\ UNCHANGED <<eligible, exactApplied, fullFetchOpen,
                 fullSignalRead, fullSignalAborted>>

StartFullFetch ==
  /\ FullObserved
  /\ ~fullFetchOpen
  /\ fullFetchOpen' = TRUE
  /\ eligible' = FALSE
  /\ fullSignalRead' = FALSE
  /\ fullSignalAborted' = FALSE
  /\ UNCHANGED <<logical, lease, exactApplied>>

ConsumeFullSignal ==
  /\ fullFetchOpen
  /\ FullObserved
  /\ ~fullSignalRead
  /\ fullSignalRead' = TRUE
  /\ UNCHANGED <<logical, lease, eligible, exactApplied,
                 fullFetchOpen, fullSignalAborted>>

FinishFullFetch ==
  /\ fullFetchOpen
  /\ ~fullSignalAborted
  /\ fullFetchOpen' = FALSE
  /\ eligible' = FullObserved
  /\ UNCHANGED <<logical, lease, exactApplied,
                 fullSignalRead, fullSignalAborted>>

FailFullFetch ==
  /\ fullFetchOpen
  /\ fullFetchOpen' = FALSE
  /\ eligible' = FALSE
  /\ UNCHANGED <<logical, lease, exactApplied,
                 fullSignalRead, fullSignalAborted>>

AcquireNew ==
  /\ "new" \notin logical
  /\ "full" \in logical
  /\ logical' = logical \cup {"new"}
  /\ lease' = [lease EXCEPT !["new"] = IF eligible THEN "full" ELSE "exact"]
  /\ UNCHANGED <<eligible, exactApplied, fullFetchOpen,
                 fullSignalRead, fullSignalAborted>>

ApplyExact ==
  /\ "new" \in logical
  /\ lease["new"] = "exact"
  /\ ~exactApplied
  /\ exactApplied' = TRUE
  /\ UNCHANGED <<logical, lease, eligible, fullFetchOpen,
                 fullSignalRead, fullSignalAborted>>

Release(owner) ==
  /\ owner \in logical
  /\ LET released ==
           IF WrongHashRelease /\ owner = "new" /\
              lease["new"] = "exact" /\ "old" \in logical /\
              lease["old"] = "full"
           THEN "old" ELSE owner
         nextLease == [lease EXCEPT ![released] = "none"]
         nextFullObserved == \E other \in Owners : nextLease[other] = "full"
     IN /\ logical' = logical \ {owner}
        /\ lease' = nextLease
        /\ fullSignalAborted' =
             IF fullFetchOpen /\ fullSignalRead /\
                (WrongAcquisitionAbort \/ ~nextFullObserved)
             THEN TRUE ELSE fullSignalAborted
  /\ UNCHANGED <<eligible, exactApplied,
                 fullFetchOpen, fullSignalRead>>

Next == AcquireOld \/ StartFullFetch \/ ConsumeFullSignal \/
        FinishFullFetch \/ FailFullFetch \/ AcquireNew \/ ApplyExact \/
        (\E owner \in Owners : Release(owner))
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ logical \subseteq Owners
  /\ lease \in [Owners -> Queries]
  /\ eligible \in BOOLEAN
  /\ exactApplied \in BOOLEAN
  /\ fullFetchOpen \in BOOLEAN
  /\ fullSignalRead \in BOOLEAN
  /\ fullSignalAborted \in BOOLEAN

\* Each logical acquisition retains exactly its chosen physical lease.
LeaseAgreement == \A owner \in Owners :
  (owner \in logical) <=> (lease[owner] # "none")

\* Releasing an equal filter cannot leave its sole exact row publicly owned.
ExactRowAgreement == ExactRowPublic <=> ExactRowOwed

\* Query Core aborts a consumed full-Query signal only after its final
\* observer leaves; an ignored signal leaves the fetch free to finish.
NoEarlyFullAbort == fullSignalAborted => ~FullObserved
ConsumedLastReleaseAborts ==
  (fullFetchOpen /\ fullSignalRead /\ ~FullObserved) => fullSignalAborted
IgnoredLastReleaseContinues ==
  (fullFetchOpen /\ ~fullSignalRead /\ ~FullObserved) => ~fullSignalAborted
=============================================================================
