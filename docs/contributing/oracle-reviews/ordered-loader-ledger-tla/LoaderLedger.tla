---- MODULE LoaderLedger ----
\* Abstraction of OrderedSourceLoader request authority and acquisition retirement.
\* Grammar trace: debt lattice (I1), staleness classification (I2), ledger retirement (I3).
\* Not modeled: scheduling (I4), cursor memo (O5), tie/refill sub-steps of the chain, window ops.
EXTENDS Naturals, FiniteSets, TLC
CONSTANTS MaxEpoch, Ids, Rules
\* Rules: "current" = the code's patched case rules; "unified" = one normalize step;
\* "oldRetire" | "oldLeak" | "oldRecover" = the three pre-fix rules (weakened controls).
VARIABLES epoch, debt, phase, chainEpoch, failure, coverage, req, settledOnce, coverEpoch
\* coverEpoch: the epoch stamp of the request that established the current coverage.
vars == <<epoch, debt, phase, chainEpoch, failure, coverage, req, settledOnce, coverEpoch>>

Unused == [kind |-> "none", ep |-> 0, st |-> "unused", sup |-> FALSE]
Init == /\ epoch = 0 /\ debt = "none" /\ phase = "idle" /\ chainEpoch = 0
        /\ failure = "none" /\ coverage = "nothing" /\ settledOnce = FALSE
        /\ req = [i \in Ids |-> Unused] /\ coverEpoch = 0

Inflight(k) == {i \in Ids : req[i].st = "inflight" /\ req[i].kind = k}
AnyInflight == \E i \in Ids : req[i].st = "inflight"
Free == {i \in Ids : req[i].st = "unused"}
New(k) == [kind |-> k, ep |-> epoch, st |-> "inflight", sup |-> FALSE]
\* Authoritative work started while a finite request is in flight supersedes it (P8).
Supersede(r) == [j \in Ids |-> IF r[j].st = "inflight" /\ r[j].kind = "finite" THEN [r[j] EXCEPT !.sup = TRUE] ELSE r[j]]

\* Unified rule: in a quiescent coverage state, any settled entry older than the epoch is redundant.
Normalize(r, ph, db, ce) ==
  IF Rules \in {"unified", "unifiedMin"} /\ ph = "idle" /\ db = "none"
  THEN [i \in Ids |-> IF r[i].st = "settled" /\ r[i].ep < ce
                      THEN [r[i] EXCEPT !.st = "released"] ELSE r[i]]
  ELSE r

IssueFinite ==
  /\ phase = "idle" /\ debt = "none" /\ failure = "none" /\ coverage # "full"
  /\ Inflight("finite") = {}
  /\ \E i \in Free : req' = [req EXCEPT ![i] = New("finite")]
  /\ UNCHANGED <<epoch, debt, phase, chainEpoch, failure, coverage, settledOnce, coverEpoch>>

Invalidate ==
  /\ epoch < MaxEpoch /\ coverage # "full"
  /\ epoch' = epoch + 1
  /\ debt' = IF debt = "none" /\ settledOnce /\ phase = "idle" THEN "bounded"
             ELSE IF debt = "none" THEN "full" ELSE debt
  /\ UNCHANGED <<phase, chainEpoch, failure, coverage, req, settledOnce, coverEpoch>>

StartRepair ==
  /\ phase = "idle" /\ debt = "bounded" /\ failure = "none" /\ Inflight("chain") = {}
  /\ \E i \in Free : req' = [Supersede(req) EXCEPT ![i] = New("chain")]
  /\ phase' = "repair" /\ chainEpoch' = epoch
  /\ UNCHANGED <<epoch, debt, failure, coverage, settledOnce, coverEpoch>>

StartFull ==
  /\ phase = "idle" /\ debt = "full" /\ failure = "none" /\ Inflight("full") = {}
  /\ \E i \in Free : req' = [Supersede(req) EXCEPT ![i] = New("full")]
  /\ phase' = "fullheld"
  /\ UNCHANGED <<epoch, debt, chainEpoch, failure, coverage, settledOnce, coverEpoch>>

\* An explicit window move retries a recorded failure (P3).
\* The same synchronous call releases the failed acquisitions and starts the
\* full-source read, so nothing settles between them.
ExplicitRetry ==
  /\ failure # "none" /\ phase = "idle" /\ debt = "full" /\ Inflight("full") = {}
  /\ failure' = "none"
  /\ LET cleared == [i \in Ids |-> IF req[i].st = "failed" THEN [req[i] EXCEPT !.st = "released"] ELSE req[i]]
     IN \E k \in {i \in Ids : cleared[i].st \in {"unused", "released"}} :
          req' = [Supersede(cleared) EXCEPT ![k] = New("full")]
  /\ phase' = "fullheld"
  /\ UNCHANGED <<epoch, debt, chainEpoch, coverage, settledOnce, coverEpoch>>

ReleaseAllSettledExcept(r, keep) ==
  [j \in Ids |-> IF j # keep /\ r[j].st = "settled" THEN [r[j] EXCEPT !.st = "released"] ELSE r[j]]

SettleFinite(i) ==
  LET r == req[i]
      current == r.ep = epoch /\ phase = "idle" /\ failure = "none"
      s == [req EXCEPT ![i].st = "settled"]
      finished == phase = "idle" /\ debt = "none"
      self == IF ~current /\ finished /\ Rules \notin {"oldLeak", "unifiedMin", "unifiedMinNoNorm"}
              THEN [s EXCEPT ![i].st = "released"] ELSE s
      \* Pre-fix rule: a stale prefix supersedes every smaller prefix, including the repair's.
      nr == IF ~current /\ Rules = "oldRetire"
            THEN [j \in Ids |-> IF self[j].kind = "chain" /\ self[j].st = "settled"
                                THEN [self[j] EXCEPT !.st = "released"] ELSE self[j]]
            ELSE self
  IN /\ r.st = "inflight" /\ r.kind = "finite"
     /\ coverEpoch' = IF current THEN epoch ELSE coverEpoch
     /\ req' = Normalize(nr, phase, debt, IF current THEN epoch ELSE coverEpoch)
     /\ coverage' = IF current THEN "pages" ELSE coverage
     /\ settledOnce' = (settledOnce \/ current)
     /\ UNCHANGED <<epoch, debt, phase, chainEpoch, failure>>

SettleChain(i) ==
  LET r == req[i] IN
  /\ r.st = "inflight" /\ r.kind = "chain"
  /\ IF chainEpoch # epoch
     THEN \* a newer invalidation: start the replacement chain (P5)
          \E k \in Free :
            /\ req' = [[req EXCEPT ![i].st = "settled"] EXCEPT ![k] = New("chain")]
            /\ chainEpoch' = epoch
            /\ UNCHANGED <<epoch, debt, phase, failure, coverage, settledOnce, coverEpoch>>
     ELSE IF failure # "none" \/ (Rules \in {"unified", "unifiedNoNorm", "unifiedMin", "unifiedMinNoNorm"} /\ debt = "full")
     THEN IF Rules = "oldRecover"
          THEN \* abandon: debt stays full, nothing restarts
               /\ req' = [req EXCEPT ![i].st = "settled"]
               /\ phase' = "idle" /\ debt' = "full"
               /\ UNCHANGED <<epoch, chainEpoch, failure, coverage, settledOnce, coverEpoch>>
          ELSE \* abandon and start the full-source read the overlap replaced
               \E k \in Free :
                 /\ req' = [[req EXCEPT ![i].st = "settled"] EXCEPT ![k] = New("full")]
                 /\ phase' = "fullheld" /\ debt' = "full"
                 /\ UNCHANGED <<epoch, chainEpoch, failure, coverage, settledOnce, coverEpoch>>
     ELSE LET settled == [req EXCEPT ![i].st = "settled"]
              nr == IF Rules \in {"unifiedMin", "unifiedMinNoNorm"} THEN settled ELSE ReleaseAllSettledExcept(settled, i) IN
          /\ req' = Normalize(nr, "idle", "none", epoch)
          /\ phase' = "idle" /\ debt' = "none" /\ coverage' = "chain" /\ settledOnce' = TRUE
          /\ coverEpoch' = epoch
          /\ UNCHANGED <<epoch, chainEpoch, failure>>

SettleFull(i) ==
  /\ req[i].st = "inflight" /\ req[i].kind = "full"
  /\ req' = IF Rules \in {"unifiedMin", "unifiedMinNoNorm"}
           THEN Normalize([req EXCEPT ![i].st = "settled"], "idle", "none", req[i].ep)
           ELSE ReleaseAllSettledExcept([req EXCEPT ![i].st = "settled"], i)
  /\ phase' = "idle" /\ debt' = "none" /\ coverage' = "full" /\ failure' = "none"
  /\ settledOnce' = TRUE /\ coverEpoch' = req[i].ep
  /\ UNCHANGED <<epoch, chainEpoch>>

Fail(i) ==
  LET r == req[i]
      finishedBefore == phase = "idle" /\ debt = "none" /\ failure = "none"
      \* Authoritative work failing is the loader's own failure: it waits for an
      \* explicit or backoff retry, even if a superseded request failed first.
      f == IF r.kind \in {"chain", "full"} THEN "own"
           ELSE IF failure = "none" THEN (IF r.sup THEN "superseded" ELSE "own") ELSE failure
      ph == IF r.kind \in {"chain", "full"} THEN "idle" ELSE phase
      \* Unified: a superseded request's failure blocks nothing. Its partial
      \* writes only raise the debt to full; ordinary loading then recovers.
      upgradeOnly == Rules \in {"unified", "unifiedNoNorm", "unifiedMin", "unifiedMinNoNorm"} /\ r.kind = "finite" /\ r.sup
      recover == ~upgradeOnly /\ r.sup /\ finishedBefore /\ Rules # "oldRecover"
      failedReq == [req EXCEPT ![i].st = "failed"]
  IN /\ r.st = "inflight"
     /\ failure' = IF upgradeOnly THEN failure ELSE f
     /\ debt' = IF upgradeOnly /\ coverage = "full" /\ phase = "idle" /\ debt = "none"
               THEN debt ELSE "full"
     /\ \/ /\ recover
           /\ \E k \in Free : req' = [failedReq EXCEPT ![k] = New("full")]
           /\ phase' = "fullheld"
        \/ /\ ~recover
           /\ req' = failedReq
           /\ phase' = IF upgradeOnly THEN phase ELSE ph
     /\ UNCHANGED <<epoch, chainEpoch, coverage, settledOnce, coverEpoch>>

Next ==
  \/ IssueFinite \/ Invalidate \/ StartRepair \/ StartFull \/ ExplicitRetry
  \/ \E i \in Ids : SettleFinite(i) \/ SettleChain(i) \/ SettleFull(i) \/ Fail(i)

Spec == Init /\ [][Next]_vars

\* P4/P10: a finished repair's own acquisition is still held.
ChainHeld == (phase = "idle" /\ debt = "none" /\ coverage = "chain")
               => \E i \in Ids : req[i].kind = "chain" /\ req[i].ep = coverEpoch /\ req[i].st = "settled"
\* P10: in a quiescent coverage state, nothing older than the coverage epoch is still held.
NoLeak == (phase = "idle" /\ debt = "none" /\ ~AnyInflight)
            => \A i \in Ids : req[i].st = "settled" => req[i].ep >= coverEpoch
\* P3/P8: a request that authoritative work superseded never strands its failure.
\* (A failure of a request nothing superseded may block until an explicit retry: the failure law.)
NoStrandedStaleFailure == (failure = "superseded") => (phase # "idle" \/ AnyInflight)
TypeOK == debt \in {"none", "bounded", "full"} /\ phase \in {"idle", "repair", "fullheld"}
====
