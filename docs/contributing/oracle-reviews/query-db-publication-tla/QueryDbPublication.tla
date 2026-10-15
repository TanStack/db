-------------------------- MODULE QueryDbPublication --------------------------
EXTENDS FiniteSets, TLC

\* One physical Query, two Query DB acquisition leases, and one source row.
\* "active" projects Query DB leases, not Core's logical subset demands.
\* "phase" projects a sync transaction's acceptance and application boundary;
\* it is not Query DB's result-application controller. The provider's old
\* response may arrive after final release, but only an accepted transaction
\* can apply. The combined ReenterAtRelease action projects an acquisition
\* made inside observer-removal cleanup after an already applied result.
\* Collection cleanup can abandon a still-pending accepted receipt; it does
\* not model a new sync run. Persistence, cache reuse, multiple result
\* generations, and source values are outside this bounded publication model.
CONSTANTS WrongEarlyFulfill, WrongDropPeer, WrongDropFirst, WrongLatePublish,
          WrongEarlyPhysicalAbort, WrongAbortAccepted,
          WrongCleanupKeepsAccepted

Owners == {"a", "b"}
Phases == {"none", "unaccepted", "accepted", "applied", "abandoned"}
Outcomes == {"idle", "pending", "fulfilled", "rejected"}

VARIABLES active, callerAborted, rowOwners, phase, outcome,
          fetchOpen, signalConsumed, physicalAborted,
          acceptedEver, appliedEver, cleaned
vars == <<active, callerAborted, rowOwners, phase, outcome,
          fetchOpen, signalConsumed, physicalAborted,
          acceptedEver, appliedEver, cleaned>>

Init ==
  /\ active = {"a"}
  /\ callerAborted = {}
  /\ rowOwners = {}
  /\ phase = "none"
  /\ outcome = [owner \in Owners |->
       IF owner = "a" THEN "pending" ELSE "idle"]
  /\ fetchOpen = TRUE
  /\ signalConsumed = FALSE
  /\ physicalAborted = FALSE
  /\ acceptedEver = FALSE
  /\ appliedEver = FALSE
  /\ cleaned = FALSE

AcquirePeer ==
  /\ "a" \in active
  /\ "b" \notin active
  /\ outcome["b"] = "idle"
  /\ ~physicalAborted
  /\ active' = active \cup {"b"}
  /\ rowOwners' = IF phase = "applied"
                  THEN rowOwners \cup {"b"} ELSE rowOwners
  /\ outcome' = [outcome EXCEPT !["b"] =
       IF phase = "applied" THEN "fulfilled" ELSE "pending"]
  /\ UNCHANGED <<callerAborted, phase, fetchOpen, signalConsumed,
                 physicalAborted, acceptedEver, appliedEver, cleaned>>

ConsumeSignal ==
  /\ fetchOpen
  /\ active # {}
  /\ ~signalConsumed
  /\ signalConsumed' = TRUE
  /\ UNCHANGED <<active, callerAborted, rowOwners, phase, outcome,
                 fetchOpen, physicalAborted, acceptedEver, appliedEver,
                 cleaned>>

ProviderResult ==
  /\ fetchOpen
  /\ ~physicalAborted
  /\ phase = "none"
  /\ phase' = "unaccepted"
  /\ fetchOpen' = FALSE
  /\ UNCHANGED <<active, callerAborted, rowOwners, outcome,
                 signalConsumed, physicalAborted, acceptedEver, appliedEver,
                 cleaned>>

Accept ==
  /\ phase = "unaccepted"
  /\ active # {}
  /\ phase' = "accepted"
  /\ acceptedEver' = TRUE
  /\ outcome' = IF WrongEarlyFulfill
                THEN [owner \in Owners |->
                  IF owner \in active /\ outcome[owner] = "pending"
                  THEN "fulfilled" ELSE outcome[owner]]
                ELSE outcome
  /\ UNCHANGED <<active, callerAborted, rowOwners, fetchOpen,
                 signalConsumed, physicalAborted, appliedEver, cleaned>>

Apply ==
  /\ phase = "accepted"
  /\ ~cleaned
  /\ phase' = "applied"
  /\ appliedEver' = TRUE
  /\ rowOwners' = IF WrongLatePublish /\ active = {}
                  THEN {"a"} ELSE active
  /\ outcome' = [owner \in Owners |->
       IF outcome[owner] = "pending"
       THEN IF owner \in active THEN "fulfilled" ELSE "rejected"
       ELSE outcome[owner]]
  /\ UNCHANGED <<active, callerAborted, fetchOpen, signalConsumed,
                 physicalAborted, acceptedEver, cleaned>>

AbortCaller(owner) ==
  /\ owner \in active
  /\ active' = active \ {owner}
  /\ physicalAborted' =
       (physicalAborted \/
        (fetchOpen /\ signalConsumed /\
         (WrongEarlyPhysicalAbort \/ (active \ {owner}) = {})))
  /\ callerAborted' = callerAborted \cup {owner}
  /\ rowOwners' = rowOwners \ {owner}
  /\ phase' = IF WrongAbortAccepted /\ phase = "accepted"
              THEN "abandoned" ELSE phase
  /\ outcome' = [outcome EXCEPT ![owner] =
       IF @ = "pending" /\ phase # "accepted"
       THEN "rejected" ELSE @]
  /\ UNCHANGED <<fetchOpen, signalConsumed, acceptedEver, appliedEver,
                 cleaned>>

Release(owner) ==
  /\ owner \in active
  /\ active' = active \ {owner}
  /\ physicalAborted' =
       (physicalAborted \/
        (fetchOpen /\ signalConsumed /\
         (WrongEarlyPhysicalAbort \/ (active \ {owner}) = {})))
  /\ rowOwners' =
       IF WrongDropPeer /\ owner = "a" /\ "b" \in active /\
          phase = "applied"
       THEN {}
       ELSE IF WrongDropFirst /\ owner = "b" /\ "a" \in active /\
          phase = "applied"
       THEN {} ELSE rowOwners \ {owner}
  /\ outcome' = [outcome EXCEPT ![owner] =
       IF @ = "pending" /\ phase # "accepted"
       THEN "rejected" ELSE @]
  /\ UNCHANGED <<callerAborted, phase, fetchOpen, signalConsumed,
                 acceptedEver, appliedEver, cleaned>>

ReenterAtRelease ==
  /\ active = {"a"}
  /\ phase = "applied"
  /\ outcome["b"] = "idle"
  /\ active' = {"b"}
  /\ rowOwners' = {"b"}
  /\ outcome' = [outcome EXCEPT !["b"] = "fulfilled"]
  /\ UNCHANGED <<callerAborted, phase, fetchOpen, signalConsumed,
                 physicalAborted, acceptedEver, appliedEver, cleaned>>

\* Cleanup closes this sync run. If the accepted receipt has not applied, Core
\* rejects it and clears its queued writes. This differs from caller abort.
Cleanup ==
  /\ ~cleaned
  /\ cleaned' = TRUE
  /\ active' = {}
  /\ rowOwners' = {}
  /\ phase' = IF WrongCleanupKeepsAccepted /\ phase = "accepted"
              THEN "accepted"
              ELSE IF phase = "applied" THEN phase ELSE "abandoned"
  /\ outcome' = [owner \in Owners |->
       IF outcome[owner] = "pending" THEN "rejected" ELSE outcome[owner]]
  /\ fetchOpen' = FALSE
  /\ physicalAborted' = (physicalAborted \/ (fetchOpen /\ signalConsumed))
  /\ UNCHANGED <<callerAborted, signalConsumed, acceptedEver, appliedEver>>

Next == AcquirePeer \/ ConsumeSignal \/ ProviderResult \/ Accept \/ Apply \/
        ReenterAtRelease \/ Cleanup \/
        (\E owner \in Owners : AbortCaller(owner)) \/
        (\E owner \in Owners : Release(owner))
Spec == Init /\ [][Next]_vars
FairSpec == Spec /\ WF_vars(Apply)

TypeOK ==
  /\ active \subseteq Owners
  /\ callerAborted \subseteq Owners
  /\ rowOwners \subseteq Owners
  /\ phase \in Phases
  /\ outcome \in [Owners -> Outcomes]
  /\ fetchOpen \in BOOLEAN
  /\ signalConsumed \in BOOLEAN
  /\ physicalAborted \in BOOLEAN
  /\ acceptedEver \in BOOLEAN
  /\ appliedEver \in BOOLEAN
  /\ cleaned \in BOOLEAN

\* A departed lease cannot keep a row public, and every live lease keeps its
\* promised row. Quantification covers either release order.
OnlyLiveOwnersPublish == rowOwners \subseteq active
LiveOwnersKeepRow == phase = "applied" =>
  \A owner \in active : owner \in rowOwners

\* A load and a row need an applied receipt. An accepted transaction remains
\* obligated even when its last caller aborts; weak fairness only requires
\* the continuously enabled Apply action to run, not a scheduler deadline.
NoEarlyLoadFulfillment == \A owner \in Owners :
  outcome[owner] = "fulfilled" => appliedEver
NoUnacceptedPublication == rowOwners # {} => phase = "applied"
AcceptedEventuallySettles == acceptedEver ~> (appliedEver \/ cleaned)
CleanupClearsOwners == cleaned => active = {} /\ rowOwners = {}
CleanupAbandonsPendingReceipt == cleaned /\ ~appliedEver =>
  phase = "abandoned" /\ \A owner \in Owners : outcome[owner] # "fulfilled"

\* A consumed Query signal aborts only when no Query DB lease observes it.
NoEarlyPhysicalAbort == physicalAborted => active = {}
=============================================================================
