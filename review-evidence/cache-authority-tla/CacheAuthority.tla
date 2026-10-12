---------------------------- MODULE CacheAuthority ----------------------------
EXTENDS Integers, TLC

(***************************************************************************
 * Exploratory design grammar for one on-demand Collection ID.
 *
 * A and B are distinct sync runs. They initially share one certified
 * persisted cache generation. A run has its own expiring claim and provider
 * session; a source fetch captures both. A pending SQLite read captures a
 * generation but must recheck authority when it finishes. The model has one
 * subset and one public row per run. "certified" means complete durable
 * key-set evidence, not a successful subset snapshot. A fresh subset fetch
 * may write its row without certifying the entire generation.
 *
 * This is an independent authority model, not a translation of the wrapper's
 * mutex, Query observer, Electric stream, or SQLite schema. DeliverFetch
 * abstracts a pre-publication admission cut. A sync transaction that was
 * already public before SQLite discovers claim expiry is outside this model;
 * the documented durability-failure path may then leave that row public.
 * The flags record violations at the modeled publication/settlement cut,
 * which a final row comparison could miss after another rotation or fetch.
 ***************************************************************************
*)

CONSTANTS MaxGen, MaxSession, Fault, Scenario
Runs == {"A", "B"}
ActiveRuns == IF Scenario = "solo" THEN {"A"} ELSE Runs
Jobs == 1..2
Gens == 0..MaxGen
None == -1
Empty == [g |-> None, sess |-> None, source |-> "none"]
Old == [g |-> 0, sess |-> 0, source |-> "cache"]

VARIABLE s
vars == <<s>>

Init ==
  s = [head |-> 0,
       lastGen |-> 0,
       claim |-> [r \in Runs |-> 0],
       live |-> [r \in Runs |-> TRUE],
       resume |-> [r \in Runs |-> TRUE],
       phase |-> [r \in Runs |-> "active"],
       session |-> [r \in Runs |-> 0],
       reason |-> [r \in Runs |-> "none"],
       lossSeq |-> [r \in Runs |-> 0],
       startedSeq |-> [r \in Runs |-> 0],
       lossKind |-> [r \in Runs |-> [i \in 1..MaxSession |-> "none"]],
       owner |-> [r \in Runs |-> TRUE],
       need |-> [r \in Runs |-> FALSE],
       request |-> [r \in Runs |-> "none"],
       public |-> [r \in Runs |-> Old],
       durable |-> [g \in Gens |-> IF g = 0 THEN Old ELSE Empty],
       certified |-> [g \in Gens |-> g = 0],
       read |-> [r \in Runs |-> [g |-> None, state |-> "idle"]],
       job |-> [j \in Jobs |-> [run |-> "none", g |-> None,
                               sess |-> None, state |-> "idle"]],
       badPublic |-> FALSE,
       badDurable |-> FALSE,
       badSuccess |-> FALSE,
       peerLost |-> FALSE,
       expiredHeadAdvanced |-> FALSE]

Peer(r) == IF r = "A" THEN "B" ELSE "A"

Expire(r) ==
  /\ s.live[r]
  /\ s.lossSeq[r] < MaxSession
  /\ s' = [s EXCEPT
       !.live[r] = FALSE,
       !.lossKind[r][s.lossSeq[r] + 1] = "expiry",
       !.lossSeq[r] = @ + 1]

InvalidateResume(r) ==
  /\ s.lossSeq[r] < MaxSession
  /\ s.phase[r] # "failed"
  /\ s' = [s EXCEPT
       !.resume[r] = FALSE,
       !.lossKind[r][s.lossSeq[r] + 1] = "evidence",
       !.lossSeq[r] = @ + 1]

Request(r) ==
  /\ s.request[r] = "none"
  /\ s.owner[r]
  /\ s' = [s EXCEPT
       !.request[r] = IF s.phase[r] = "failed" THEN "error" ELSE "pending",
       !.need[r] = IF s.phase[r] = "failed" THEN @ ELSE
                    ~s.live[r] \/ ~s.resume[r] \/
                    s.public[r].g # s.claim[r] \/
                    ~s.certified[s.claim[r]]]

(** Cached success requires both a live claim and complete cache evidence.
    A valid claim by itself is only permission to access storage. **)
CachedSuccess(r) ==
  /\ s.request[r] = "pending"
  /\ s.phase[r] = "active"
  /\ LET authorized == ~s.need[r] /\ s.live[r] /\ s.resume[r] /\
                       s.certified[s.claim[r]] /\
                       s.public[r].g = s.claim[r]
     IN /\ authorized \/ (Fault = "reuseCache" /\ s.claim[r] # 0)
        /\ s' = [s EXCEPT
             !.request[r] = "success",
             !.badSuccess = @ \/ ~authorized]

(** Retirement precedes any awaited rotation. Repeating this action models
    overlapping recovery: each call retires the preceding provider session. **)
BeginRecovery(r) ==
  /\ s.phase[r] \in {"active", "rotating"}
  /\ s.session[r] < MaxSession
  /\ s.startedSeq[r] < s.lossSeq[r]
  /\ s' = [s EXCEPT
       !.phase[r] = "rotating",
       !.session[r] = @ + 1,
       !.reason[r] = s.lossKind[r][s.startedSeq[r] + 1],
       !.startedSeq[r] = @ + 1,
       !.need[r] = TRUE]

(** A stale run creates private storage if another run already advanced the
    head. Claim expiry alone never revokes a warm peer's head or public row. **)
FinishRecovery(r) ==
  /\ s.phase[r] = "rotating"
  /\ s.lastGen < MaxGen
  /\ LET fresh == s.lastGen + 1
         advancesHead == (s.live[r] \/ Fault = "expiredHead") /\
                         s.reason[r] = "evidence" /\
                         s.claim[r] = s.head
         p == Peer(r)
         peerWasWarm == s.live[p] /\ s.resume[p] /\
                        s.phase[p] = "active" /\
                        s.public[p].g = s.claim[p]
     IN s' = [s EXCEPT
          !.lastGen = fresh,
          !.head = IF advancesHead THEN fresh ELSE @,
          !.expiredHeadAdvanced = @ \/ (advancesHead /\ ~s.live[r]),
          !.claim[r] = fresh,
          !.live[r] = TRUE,
          !.resume[r] = FALSE,
          !.phase[r] = "active",
          !.reason[r] = "none",
          !.public[r] = Empty,
          !.public[p] = IF Fault = "globalClear" THEN Empty ELSE @,
          !.peerLost = @ \/ (Fault = "globalClear" /\ peerWasWarm),
          !.durable[fresh] = Empty,
          !.certified[fresh] = FALSE]

StartRead(r) ==
  /\ s.phase[r] = "active"
  /\ s.request[r] = "pending"
  /\ s.live[r]
  /\ s.resume[r]
  /\ s.certified[s.claim[r]]
  /\ s.read[r].state = "idle"
  /\ s' = [s EXCEPT
       !.read[r] = [g |-> s.claim[r], state |-> "pending"]]

(** A read may finish after expiry or rotation. A second check decides whether
    its old result may become public; a current generation may be uncertified. **)
FinishRead(r) ==
  /\ s.read[r].state = "pending"
  /\ LET g == s.read[r].g
         authorized == s.live[r] /\ s.resume[r] /\
                       s.phase[r] = "active" /\
                       s.claim[r] = g /\ s.certified[g]
         apply == authorized \/ Fault = "lateRead"
     IN s' = [s EXCEPT
          !.read[r].state = "done",
          !.public[r] = IF apply THEN s.durable[g] ELSE @,
          !.need[r] = IF apply THEN FALSE ELSE TRUE,
          !.badPublic = @ \/ (apply /\ ~authorized)]

StartFetch(r, j) ==
  /\ j \in Jobs
  /\ s.job[j].state = "idle"
  /\ s.owner[r] /\ (s.need[r] \/ s.request[r] = "pending")
  /\ s.phase[r] = "active" /\ s.live[r]
  /\ s.startedSeq[r] = s.lossSeq[r]
  /\ s' = [s EXCEPT
       !.job[j] = [run |-> r, g |-> s.claim[r],
                   sess |-> s.session[r], state |-> "pending"]]

(** A completed source request can still deliver after abort or retirement.
    Only the captured run, claim, and provider session may apply it. **)
DeliverFetch(j) ==
  /\ s.job[j].state = "pending"
  /\ LET r == s.job[j].run
         g == s.job[j].g
         authorized == s.owner[r] /\ s.live[r] /\
                       s.phase[r] = "active" /\
                       s.claim[r] = g /\
                       s.session[r] = s.job[j].sess /\
                       s.startedSeq[r] = s.lossSeq[r]
         apply == authorized \/
                  (Fault = "lateFetch" /\ s.claim[r] # g) \/
                  (Fault = "gapBeforeRetire" /\
                   s.live[r] /\ ~s.resume[r] /\
                   s.startedSeq[r] < s.lossSeq[r])
         target == IF authorized THEN g ELSE s.claim[r]
         value == [g |-> g, sess |-> s.job[j].sess,
                   source |-> "fetch"]
     IN s' = [s EXCEPT
          !.job[j].state = IF apply THEN "applied" ELSE "ignored",
          !.public[r] = IF apply THEN value ELSE @,
          !.durable[target] = IF apply THEN value ELSE @,
          !.need[r] = IF apply THEN FALSE ELSE @,
          !.request[r] = IF apply /\ @ = "pending" THEN "success" ELSE @,
          !.badPublic = @ \/ (apply /\ ~authorized),
          !.badDurable = @ \/ (apply /\ (~authorized \/ target # g)),
          !.badSuccess = @ \/ (apply /\ ~authorized /\
                               s.request[r] = "pending"),
          !.certified[target] = IF apply /\ Fault = "certifyPartial"
                                 THEN TRUE ELSE @]

Abort(r) ==
  /\ s.request[r] = "pending"
  /\ s' = [s EXCEPT !.request[r] = "aborted", !.owner[r] = FALSE]

FailRestart(r) ==
  /\ s.phase[r] = "rotating"
  /\ s' = [s EXCEPT
       !.phase[r] = "failed",
       !.request[r] = IF @ = "pending" /\ Fault # "pendingOnFailure"
                       THEN "error" ELSE @]

Next ==
  \/ \E r \in ActiveRuns: Expire(r) \/ InvalidateResume(r) \/ Request(r) \/
                    CachedSuccess(r) \/ StartRead(r) \/ FinishRead(r) \/
                    Abort(r) \/ FailRestart(r)
  \/ \E r \in ActiveRuns: BeginRecovery(r)
  \/ \E r \in ActiveRuns: FinishRecovery(r)
  \/ \E r \in ActiveRuns, j \in Jobs: StartFetch(r, j)
  \/ \E j \in Jobs: DeliverFetch(j)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ s.head \in Gens /\ s.lastGen \in Gens
  /\ s.claim \in [Runs -> Gens]
  /\ s.live \in [Runs -> BOOLEAN]
  /\ s.resume \in [Runs -> BOOLEAN]
  /\ s.session \in [Runs -> 0..MaxSession]
  /\ s.lossSeq \in [Runs -> 0..MaxSession]
  /\ s.startedSeq \in [Runs -> 0..MaxSession]
  /\ s.phase \in [Runs -> {"active", "rotating", "failed"}]
  /\ s.need \in [Runs -> BOOLEAN]
  /\ s.request \in [Runs -> {"none", "pending", "success", "error", "aborted"}]
  /\ s.certified \in [Gens -> BOOLEAN]
  /\ s.badPublic \in BOOLEAN /\ s.badDurable \in BOOLEAN
  /\ s.badSuccess \in BOOLEAN /\ s.peerLost \in BOOLEAN
  /\ s.expiredHeadAdvanced \in BOOLEAN

NoStalePublication == ~s.badPublic
NoStaleDurableWrite == ~s.badDurable
SuccessfulDemandHasEvidence == ~s.badSuccess
WarmPeerSurvivesPrivateRecovery == ~s.peerLost
ExpiredClaimCannotAdvanceHead == ~s.expiredHeadAdvanced
FailedRestartSettlesDemand ==
  \A r \in Runs: s.phase[r] = "failed" => s.request[r] # "pending"
PartialSubsetDoesNotCertifyGeneration ==
  \A g \in 1..s.lastGen: ~s.certified[g]

MiddleSessionCallbackReached ==
  ~\E j \in Jobs: s.job[j].run = "A" /\
                 s.job[j].sess = 1 /\
                 s.job[j].state = "ignored" /\
                 s.session["A"] = 2 /\ s.claim["A"] = 2

=============================================================================
