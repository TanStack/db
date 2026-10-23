---- MODULE LoaderTable ----
\* Run 3: run 2 plus the transition table (#2194 after a66163f94). It adds a
\* cursor reset by truncate, the replay that settles it, the incarnation each
\* request is issued in, the work and debt coherence invariant, and the table
\* as an action property. A repair chain is identified by its epoch: a new
\* chain needs new debt, and new bounded debt needs an epoch move.
\* Weak names one rule from a fixed bug to re-enable.
EXTENDS Integers, FiniteSets
CONSTANTS MaxEpoch, Ids, Weak
\* Weak \subseteq {"lateStamp", "pendingBlocks", "dropStaged", "stepReleases",
\*   "epochRetire", "noLeaseCollect", "ownSuperseded",
\*   "noAbsorb", "replayKeepsDebt", "chainOwnsAfterFinish", "debtUnderCoverage"}
VARIABLES epoch, debt, work, own, req, pending, staged, settledOnce, fault, coverage,
          gen, replay, truncated
vars == <<epoch, debt, work, own, req, pending, staged, settledOnce, fault, coverage,
          gen, replay, truncated>>

None == 0
Unused == [k |-> "none", ep |-> 0, chain |-> -1, st |-> "unused", sup |-> FALSE, legit |-> FALSE,
           ownFail |-> FALSE, gen |-> 0, replayed |-> FALSE]
Init == /\ epoch = 0 /\ debt = "none" /\ work = [k |-> "idle", ep |-> 0] /\ own = FALSE
        /\ req = [i \in Ids |-> Unused] /\ pending = None
        /\ staged = [k |-> "none", chain |-> -1] /\ settledOnce = FALSE
        /\ fault = TRUE \* one release callback may throw
        /\ coverage = [k |-> "nothing", chain |-> -1]
        /\ gen = 0 /\ replay = FALSE /\ truncated = FALSE

Inflight == {i \in Ids : req[i].st = "inflight"}
Free == {i \in Ids : req[i].st = "unused"}
Quiet == Inflight = {} /\ staged.k = "none"
IsAuth(r) == r.k \in {"prefix", "step", "full"}
\* Authoritative work supersedes in-flight finite requests once issued.
Supersede(r) == [j \in Ids |-> IF r[j].st = "inflight" /\ r[j].k = "finite"
                              THEN [r[j] EXCEPT !.sup = TRUE] ELSE r[j]]
New(k, ep, ch) == [k |-> k, ep |-> ep, chain |-> ch, st |-> "inflight", sup |-> FALSE,
                   legit |-> FALSE, ownFail |-> FALSE, gen |-> gen, replayed |-> FALSE]
Dead(r) == r.gen # gen
\* A chain request owns authority only while its own chain runs.
OwnsChain(r) == work.k = "chain" /\ work.ep = r.chain
\* A chain step's ledger epoch: its chain's, or (reverted rule) its issue epoch.
StepEp(ch) == IF "epochRetire" \in Weak THEN epoch ELSE ch
Stale(r) == ~IsAuth(r) /\ r.ep # epoch
\* Release every settled finite entry outside chain ch (or older than ch's
\* epoch, under the reverted epoch rule).
RetireOutside(r, ch) ==
  [j \in Ids |-> IF r[j].st = "settled" /\ r[j].k # "full"
                    /\ (IF "epochRetire" \in Weak THEN r[j].ep < ch ELSE r[j].chain # ch)
                 THEN [r[j] EXCEPT !.st = "released"] ELSE r[j]]
RetireAllFinite(r) ==
  [j \in Ids |-> IF (r[j].st = "settled" /\ r[j].k # "full")
                    \/ (r[j].st = "failed" /\ r[j].sup /\ "noLeaseCollect" \notin Weak)
                 THEN [r[j] EXCEPT !.st = "released"] ELSE r[j]]

StartAuthority(r) ==
  \* From an idle slot with debt: a bounded chain or a full-source read.
  \E k \in Free :
    /\ IF debt = "bounded"
       THEN /\ req' = [Supersede(r) EXCEPT ![k] = New("prefix", epoch, epoch)]
            /\ work' = [k |-> "chain", ep |-> epoch]
       ELSE /\ req' = [Supersede(r) EXCEPT ![k] = New("full", epoch, -1)]
            /\ work' = [k |-> "fullHeld", ep |-> epoch]
    /\ pending' = IF "pendingBlocks" \in Weak THEN (IF pending = None THEN k ELSE pending) ELSE k

\* An ordinary finite page; optionally its own delivery invalidates ordering.
IssueFinite(selfInvalidates) ==
  /\ ~replay
  /\ work.k = "idle" /\ debt = "none" /\ ~own /\ pending = None /\ staged.k = "none"
  /\ coverage.k # "full"
  /\ (selfInvalidates => epoch < MaxEpoch)
  /\ \E k \in Free :
       /\ req' = [req EXCEPT ![k] = [New("finite",
                    IF selfInvalidates /\ "lateStamp" \in Weak THEN epoch + 1 ELSE epoch, -1)
                    EXCEPT !.legit = TRUE]]
       /\ pending' = k
  /\ epoch' = IF selfInvalidates THEN epoch + 1 ELSE epoch
  /\ debt' = IF selfInvalidates THEN (IF settledOnce THEN "bounded" ELSE "full") ELSE debt
  /\ UNCHANGED <<work, own, staged, settledOnce, fault, coverage, gen, replay, truncated>>

Invalidate ==
  /\ epoch < MaxEpoch /\ coverage.k # "full"
  /\ epoch' = epoch + 1
  /\ debt' = IF debt = "none" /\ settledOnce /\ work.k = "idle" THEN "bounded"
             ELSE IF debt = "none" THEN "full" ELSE debt
  /\ UNCHANGED <<work, own, req, pending, staged, settledOnce, fault, coverage, gen, replay, truncated>>

\* An ordinary pass: consume a staged step, or start owed authoritative work.
Pass ==
  /\ ~replay /\ ~own
  /\ \/ /\ staged.k = "step"
        /\ IF pending # None /\ "pendingBlocks" \in Weak
           THEN \* the step waits behind a superseded request and is lost
                /\ staged' = [k |-> "none", chain |-> -1]
                /\ UNCHANGED <<req, pending>>
           ELSE \E k \in Free :
                  /\ req' = [req EXCEPT ![k] = New("step", StepEp(staged.chain), staged.chain)]
                  /\ pending' = k
                  /\ staged' = [k |-> "none", chain |-> -1]
        /\ UNCHANGED <<work, debt>>
     \/ /\ staged.k = "none" /\ work.k = "idle" /\ debt # "none" /\ coverage.k # "full"
        /\ StartAuthority(req)
        /\ UNCHANGED <<debt, staged>>
  /\ UNCHANGED <<epoch, own, settledOnce, fault, coverage, gen, replay, truncated>>

\* A repair prefix that answers at once, as an eager source does: its step is
\* staged until a graph turn resumes it.
SyncPrefix ==
  /\ ~replay /\ ~own /\ staged.k = "none" /\ work.k = "idle" /\ debt = "bounded"
  /\ \E k \in Free :
       /\ req' = [Supersede(req) EXCEPT ![k] = [New("prefix", epoch, epoch) EXCEPT !.st = "settled"]]
       /\ work' = [k |-> "chain", ep |-> epoch]
       /\ staged' = [k |-> "step", chain |-> epoch]
       /\ pending' = IF "pendingBlocks" \in Weak THEN pending ELSE None
  /\ UNCHANGED <<epoch, debt, own, settledOnce, fault, coverage, gen, replay, truncated>>

Restart(r) ==
  \* A chain whose epoch moved or whose debt rose to full is replaced.
  IF debt = "full"
  THEN \E k \in Free : /\ req' = [Supersede(r) EXCEPT ![k] = New("full", epoch, -1)]
                       /\ work' = [k |-> "fullHeld", ep |-> epoch] /\ pending' = k
  ELSE \E k \in Free : /\ req' = [Supersede(r) EXCEPT ![k] = New("prefix", epoch, epoch)]
                       /\ work' = [k |-> "chain", ep |-> epoch] /\ pending' = k

SettleOk(i) ==
  LET r == req[i]
      s == [req EXCEPT ![i].st = "settled"]
      p == IF pending = i THEN None ELSE pending
  IN
  /\ r.st = "inflight"
  /\ UNCHANGED <<gen, replay, truncated>>
  /\ CASE Dead(r) ->
          /\ req' = s /\ pending' = p
          /\ UNCHANGED <<epoch, debt, work, own, staged, settledOnce, fault, coverage>>
       [] r.k = "finite" ->
          /\ IF Stale(r) \/ work.k # "idle" \/ own
             THEN \* proves nothing; once a repair finished it is already superseded
                  \* Full-source coverage retires every settled finite lease.
                  /\ req' = IF (work.k = "idle" /\ debt = "none" /\ Stale(r))
                               \/ work.k = "fullComplete"
                               THEN [s EXCEPT ![i].st = "released"] ELSE s
                  /\ UNCHANGED <<coverage, settledOnce>>
             ELSE /\ coverage' = [k |-> "pages", chain |-> coverage.chain]
                  /\ settledOnce' = TRUE
                  \* A current page continues with its tie at once. Under debt
                  \* that tie is not a refinement of current coverage.
                  /\ \/ req' = s
                     \/ \E k \in Free :
                          req' = [s EXCEPT ![k] = [New("finite", epoch, -1)
                                     EXCEPT !.legit = (debt = "none")]]
          /\ pending' = p
          /\ UNCHANGED <<epoch, debt, work, own, staged, fault>>
       [] r.k \in {"prefix", "step"} ->
          IF work.k # "chain" \/ work.ep # r.chain
          THEN \* Run 3: full coverage retires it, and so does a finished
               \* replacement; the chain that finished keeps its own.
               /\ req' = IF work.k = "fullComplete"
                             \/ (work.k = "idle" /\ debt = "none" /\ coverage.chain # r.chain)
                         THEN [s EXCEPT ![i].st = "released"] ELSE s
               /\ pending' = p
               /\ UNCHANGED <<epoch, debt, work, own, staged, settledOnce, fault, coverage>>
          ELSE IF work.ep # epoch \/ debt = "full"
          THEN /\ Restart(s)
               /\ UNCHANGED <<epoch, debt, own, staged, settledOnce, fault, coverage>>
          ELSE IF r.k = "prefix"
          THEN \E k \in Free :
                 /\ req' = [s EXCEPT ![k] = New("step", StepEp(r.chain), r.chain)]
                 /\ pending' = k
                 /\ UNCHANGED <<epoch, debt, work, own, staged, settledOnce, fault, coverage>>
          ELSE /\ req' = RetireOutside(s, r.chain)
               /\ work' = [k |-> "idle", ep |-> 0] /\ debt' = "none"
               /\ coverage' = [k |-> "chain", chain |-> r.chain]
               /\ settledOnce' = TRUE /\ pending' = p
               /\ UNCHANGED <<epoch, own, staged, fault>>
       [] r.k = "full" ->
          /\ req' = RetireAllFinite(s)
          /\ work' = [k |-> "fullComplete", ep |-> 0] /\ debt' = "none" /\ own' = FALSE
          /\ coverage' = [k |-> "full", chain |-> -1] /\ settledOnce' = TRUE /\ pending' = p
          /\ UNCHANGED <<epoch, staged, fault>>

Covered == work.k = "fullComplete" /\ "debtUnderCoverage" \notin Weak
Pending(i) == IF pending = i THEN None ELSE pending

\* A request from before a cursor reset fails. Its partial writes still raise
\* debt, but it touches nothing staged after the reset.
FailDead(i) ==
  /\ req[i].st = "inflight" /\ Dead(req[i])
  /\ req' = [req EXCEPT ![i].st = "failed"] /\ pending' = Pending(i)
  /\ debt' = IF Covered THEN debt ELSE "full"
  /\ UNCHANGED <<epoch, work, own, staged, settledOnce, fault, coverage, gen, replay, truncated>>

\* A full-source transport fails after a replay reacquired its demand: the
\* coverage, and its lease, stay in place.
FailAbsorbed(i) ==
  /\ req[i].st = "inflight" /\ ~Dead(req[i])
  /\ req[i].k = "full" /\ work.k = "fullComplete" /\ "noAbsorb" \notin Weak
  /\ req' = [req EXCEPT ![i].st = "settled"] /\ pending' = Pending(i)
  /\ UNCHANGED <<epoch, debt, work, own, staged, settledOnce, fault, coverage, gen, replay, truncated>>

FailLive(i) ==
  LET r == req[i]
      f == [req EXCEPT ![i].st = "failed"]
      p == Pending(i)
      superseded == \/ r.k = "finite" /\ r.sup /\ "ownSuperseded" \notin Weak
                    \/ r.k \in {"prefix", "step"} /\ ~OwnsChain(r)
                       /\ "chainOwnsAfterFinish" \notin Weak
  IN
  /\ r.st = "inflight" /\ ~Dead(r)
  /\ ~(r.k = "full" /\ work.k = "fullComplete" /\ "noAbsorb" \notin Weak)
  /\ staged' = IF (r.k = "finite" \/ superseded) /\ "dropStaged" \notin Weak
               THEN staged ELSE [k |-> "none", chain |-> -1]
  /\ debt' = IF Covered THEN debt ELSE "full"
  /\ IF superseded
     THEN /\ own' = own
          /\ IF work.k = "fullComplete" /\ "noLeaseCollect" \notin Weak
             THEN /\ req' = [f EXCEPT ![i].st = "released"] /\ pending' = p /\ UNCHANGED work
             ELSE IF ~own /\ work.k = "idle"
             THEN \E k \in Free : /\ req' = [Supersede(f) EXCEPT ![k] = New("full", epoch, -1)]
                                 /\ work' = [k |-> "fullHeld", ep |-> epoch] /\ pending' = k
             ELSE /\ req' = f /\ pending' = p /\ UNCHANGED work
     ELSE /\ own' = TRUE /\ req' = [f EXCEPT ![i].ownFail = TRUE] /\ pending' = p
          /\ work' = CASE r.k = "full" -> [k |-> "fullFailed", ep |-> 0]
                       [] r.k \in {"prefix", "step"} /\ OwnsChain(r)
                            -> [k |-> "idle", ep |-> 0]
                       [] OTHER -> work
  /\ UNCHANGED <<epoch, settledOnce, fault, coverage, gen, replay, truncated>>

Fail(i) == FailDead(i) \/ FailAbsorbed(i) \/ FailLive(i)

\* An explicit window move. It first resumes a staged repair step; the step
\* runs inside it. Failed leases are released by the retry itself, and a
\* release may throw once: the retry reports it and starts nothing more.
Retry ==
  /\ own \/ \E i \in Ids : req[i].st = "failed"
  /\ \/ /\ staged.k = "step"
        /\ IF "stepReleases" \in Weak /\ fault
           THEN \* the chain step releases failed leases; a throw unwinds it
                /\ req' = [j \in Ids |-> IF req[j].st = "failed" THEN [req[j] EXCEPT !.st = "released"] ELSE req[j]]
                /\ staged' = [k |-> "none", chain |-> -1] /\ fault' = FALSE
                /\ UNCHANGED <<pending, own>>
           ELSE \E k \in Free :
                  /\ req' = [req EXCEPT ![k] = New("step", StepEp(staged.chain), staged.chain)]
                  /\ pending' = k /\ staged' = [k |-> "none", chain |-> -1]
                  /\ UNCHANGED <<own, fault>>
        /\ UNCHANGED <<work, debt>>
     \/ /\ staged.k = "none"
        /\ LET cleared == [j \in Ids |-> IF req[j].st = "failed" THEN [req[j] EXCEPT !.st = "released"] ELSE req[j]]
           IN IF fault
              THEN /\ req' = cleared /\ fault' = FALSE /\ UNCHANGED <<own, work, pending, debt>>
              ELSE /\ own' = FALSE /\ fault' = FALSE
                   /\ LET w == IF work.k = "fullFailed" THEN [k |-> "idle", ep |-> 0] ELSE work IN
                      IF w.k = "idle" /\ debt # "none" /\ coverage.k # "full"
                      THEN \E k \in Free :
                             /\ req' = [Supersede(cleared) EXCEPT ![k] = New("full", epoch, -1)]
                             /\ work' = [k |-> "fullHeld", ep |-> epoch] /\ pending' = k
                             /\ debt' = "full"
                      ELSE /\ req' = cleared /\ work' = w /\ UNCHANGED <<pending, debt>>
        /\ UNCHANGED staged
  /\ UNCHANGED <<epoch, settledOnce, coverage, gen, replay, truncated>>

\* A request that throws while it starts (request() throws synchronously).
\* It is the loader's own failure and supersedes nothing: an authoritative
\* read counts toward supersession only once issued.
FailOnStart ==
  /\ ~replay /\ ~own /\ staged.k = "none"
  /\ \/ /\ work.k = "idle" /\ debt # "none" /\ coverage.k # "full" \* authoritative start
     \/ /\ work.k = "idle" /\ debt = "none" /\ pending = None /\ coverage.k # "full" \* finite start
  /\ \E k \in Free :
       req' = [req EXCEPT ![k] = [New(IF debt # "none" THEN "full" ELSE "finite", epoch, -1)
                 EXCEPT !.st = "failed", !.ownFail = TRUE]]
  /\ own' = TRUE /\ debt' = "full" /\ work' = [k |-> "idle", ep |-> 0]
  /\ UNCHANGED <<epoch, pending, staged, settledOnce, fault, coverage, gen, replay, truncated>>

\* An explicit window move still runs while a replay is pending, and it can
\* start owed authoritative work.
WindowMoveDuringReplay ==
  /\ replay /\ ~own /\ staged.k = "none" /\ work.k = "idle" /\ debt # "none"
  /\ coverage.k # "full"
  /\ StartAuthority(req)
  /\ UNCHANGED <<epoch, debt, own, staged, settledOnce, fault, coverage, gen, replay, truncated>>

\* A truncate resets the cursor: requests in flight become dead, complete
\* coverage is held again, and ordinary loading waits for the replay.
Truncate ==
  /\ ~truncated
  /\ truncated' = TRUE /\ gen' = gen + 1 /\ replay' = TRUE
  /\ work' = IF work.k = "fullComplete" THEN [k |-> "fullHeld", ep |-> 0] ELSE work
  /\ pending' = None /\ staged' = [k |-> "none", chain |-> -1]
  /\ coverage' = [k |-> "nothing", chain |-> -1]
  /\ UNCHANGED <<epoch, debt, own, req, settledOnce, fault>>

\* The replay reacquires every held demand, in-flight ones included. It
\* finishes a running chain, or completes held full-source work.
ReplaySettles ==
  /\ replay
  /\ replay' = FALSE
  /\ LET r == [j \in Ids |-> IF req[j].st = "inflight"
                              THEN [req[j] EXCEPT !.replayed = TRUE] ELSE req[j]] IN
     IF work.k = "chain"
     THEN IF work.ep # epoch \/ debt = "full"
          THEN /\ Restart(r) /\ UNCHANGED <<debt, coverage>>
          ELSE /\ req' = RetireOutside(r, work.ep) /\ pending' = pending
               /\ work' = [k |-> "idle", ep |-> 0] /\ debt' = "none"
               /\ coverage' = [k |-> "chain", chain |-> work.ep]
     ELSE IF work.k # "idle"
     THEN /\ req' = [j \in Ids |-> IF r[j].st = "settled" /\ r[j].k # "full"
                                   THEN [r[j] EXCEPT !.st = "released"] ELSE r[j]]
          /\ work' = [k |-> "fullComplete", ep |-> 0]
          /\ debt' = IF "replayKeepsDebt" \in Weak THEN debt ELSE "none"
          /\ coverage' = [k |-> "full", chain |-> -1] /\ pending' = pending
     ELSE /\ req' = r /\ UNCHANGED <<work, debt, coverage, pending>>
  /\ UNCHANGED <<epoch, own, staged, settledOnce, fault, gen, truncated>>

Next ==
  \/ IssueFinite(FALSE) \/ IssueFinite(TRUE) \/ Invalidate \/ Pass \/ SyncPrefix \/ Retry
  \/ FailOnStart \/ Truncate \/ ReplaySettles \/ WindowMoveDuringReplay
  \/ \E i \in Ids : SettleOk(i) \/ Fail(i)

Spec == Init /\ [][Next]_vars

TypeOK == debt \in {"none", "bounded", "full"}
          /\ work.k \in {"idle", "chain", "fullHeld", "fullComplete", "fullFailed"}

\* P6: a finished repair still holds its own chain.
ChainHeld == (work.k = "idle" /\ debt = "none" /\ coverage.k = "chain")
               => \A i \in Ids : (req[i].chain = coverage.chain /\ req[i].k \in {"prefix", "step"}
                                  /\ req[i].st # "unused" /\ req[i].st # "failed"
                                  /\ ~(req[i].st = "inflight" /\ req[i].replayed) /\ ~Dead(req[i]))
                                 => req[i].st = "settled"
\* P6/P7: quiet loading holds nothing a covering read superseded.
NoLeak == (Quiet /\ ~replay /\ ~own /\ debt = "none" /\ work.k \in {"idle", "fullComplete"})
            => \A i \in Ids : Dead(req[i]) \/
                 /\ (req[i].st = "settled" /\ req[i].k # "full" /\ coverage.k \in {"chain", "pages"})
                      => (req[i].chain = coverage.chain
                          \/ (req[i].k = "finite" /\ req[i].ep = epoch /\ req[i].legit))
                 /\ (req[i].st = "settled" /\ req[i].k # "full" /\ coverage.k = "full") => FALSE
                 /\ (req[i].st = "failed" /\ req[i].sup /\ coverage.k = "full") => FALSE
\* P10: no stall. A held repair with nothing in flight and nothing staged
\* has no step that could resume it.
\* Run 3: a pending replay finishes the chain itself.
NoStall == ~(work.k = "chain" /\ Quiet /\ ~replay)
\* P5: a superseded failure never becomes the loader's own failure on its
\* own; an own failure needs an own failed request.
\* Run 3: nor can a request whose demand a replay reacquired.
OwnIsGrounded == own => \E i \in Ids : req[i].ownFail /\ ~(req[i].k = "finite" /\ req[i].sup)
                                       /\ ~req[i].replayed

\* The work and debt pairs the table allows.
Coherence == /\ work.k = "fullComplete" => debt = "none"
             /\ work.k = "chain" => debt # "none"
             /\ work.k = "fullFailed" => debt = "full"

\* The transition table as an action property. A step may keep its state, or
\* make one of these moves (a restart or retry leaves and re-enters idle).
Moves == {<<"idle", "chain">>, <<"idle", "fullHeld">>, <<"chain", "idle">>,
          <<"chain", "chain">>, <<"chain", "fullHeld">>, <<"fullHeld", "fullComplete">>,
          <<"fullHeld", "fullFailed">>, <<"fullFailed", "fullComplete">>,
          <<"fullFailed", "idle">>, <<"fullFailed", "fullHeld">>,
          <<"fullComplete", "fullHeld">>, <<"fullHeld", "idle">>}
TableLegal == work'.k = work.k \/ <<work.k, work'.k>> \in Moves
Table == [][TableLegal]_vars
====
