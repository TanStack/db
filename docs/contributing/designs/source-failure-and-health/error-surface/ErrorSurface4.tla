---------------------------- MODULE ErrorSurface4 ---------------------------
(***************************************************************************)
(* Frozen grammar v4 (frozen-grammar.md) as a transition system.           *)
(*                                                                         *)
(* One live query over two sources:                                        *)
(*   P  a persisted, eager source (restores rows from disk, syncs remote)   *)
(*   D  an on-demand, remote-only source (may load after the query ready)   *)
(*                                                                         *)
(* Hidden state says what really happened; the Node*/qStatus projections   *)
(* are what the app sees. RemedyFromObs reads only those; Oracle reads     *)
(* hidden state. Weak holds negative-control weakenings.                   *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Weak

P == "P"
D == "D"
Sources == {P, D}

VARIABLES
  gate,       \* R1: "loading" | "ready" | "error" | "crashed" | "cleaned"
  problem,    \* R4/R5 after-ready node problem: "none" | "failure" | "error"
  rows,       \* the source has readable rows
  known,      \* the source's rows are known to be its data
  reloading,  \* R7: a reload's new run is in flight
  stale,      \* R7: a superseded run may still deliver
  fromStale,  \* hidden: rows came from a superseded run
  restore,    \* R8 (P): "pending" | "synced" | "never" | "failed"
  remoteUp,   \* P's remote has synced in this run
  remoteFail, \* hidden: P's remote is failing and nobody has reported it
  remoteFailedEarly, \* R8: P's remote failed before the restore finished
  qStatus,    \* R3: "loading" | "ready" | "error" | "crashed" | "cleaned-up"
  shown,      \* the query has shown rows in this run
  req,        \* R4 request: "none" | "pending" | "failed"
  missing,    \* hidden: requested data has not arrived
  mounted,    \* the query subscribes to both sources
  errReloaded \* hidden: a reload committed while the query was in 'error'

vars == <<gate, problem, rows, known, reloading, stale, fromStale, restore, remoteUp,
          remoteFail, remoteFailedEarly, qStatus, shown, req, missing, mounted, errReloaded>>

W(x) == x \in Weak

\* R3 and R9. A query's 'error' clears once every source is ready again,
\* which needs a reload's commit (ErrorClearsOnlyByReload); 'crashed' stays.
NewQ(q, g) ==
  IF q \in {"crashed", "cleaned-up"} THEN q
  ELSE IF \E s \in Sources : g[s] \in {"crashed", "cleaned"} THEN "crashed"
  ELSE IF q = "ready" THEN "ready"
  \* F1 decision (b): once no source has a failure, the query leaves 'error' for
  \* 'loading' or 'ready'. A source still reloading keeps its 'error' gate (R7).
  ELSE IF q = "error"
    THEN IF ~W("QueryErrorSticks") /\ \A s \in Sources : g[s] # "error" /\ problem'[s] # "error"
           THEN (IF g[P] = "ready" /\ g[D] \in {"ready", "loading"} THEN "ready" ELSE "loading")
           ELSE "error"
  ELSE IF \E s \in Sources : g[s] = "error" THEN "error"
  ELSE IF g[P] = "ready" /\ g[D] \in {"ready", "loading"} THEN "ready"
  ELSE "loading"

SettleR(g, rl, r) ==
  /\ gate' = g
  /\ reloading' = rl
  /\ qStatus' = IF mounted THEN NewQ(qStatus, g) ELSE qStatus
  /\ shown' = (shown \/ qStatus' = "ready")
  /\ req' = IF qStatus' = "ready" THEN r ELSE "none"
  /\ missing' = IF qStatus' = "ready" THEN missing ELSE FALSE
  /\ errReloaded' = ((qStatus = "error") /\
       (errReloaded \/ \E s \in Sources : reloading[s] /\ ~rl[s] /\ g[s] = "ready"))

Settle(g, rl) == SettleR(g, rl, req)

Init ==
  /\ gate = [s \in Sources |-> "loading"]
  /\ problem = [s \in Sources |-> "none"]
  /\ rows = [s \in Sources |-> FALSE]
  /\ known = [s \in Sources |-> FALSE]
  /\ reloading = [s \in Sources |-> FALSE]
  /\ stale = [s \in Sources |-> FALSE]
  /\ fromStale = FALSE
  /\ restore = "pending"
  /\ remoteUp = FALSE
  /\ remoteFail = FALSE
  /\ remoteFailedEarly = FALSE
  /\ qStatus = "loading"
  /\ shown = FALSE
  /\ req = "none"
  /\ missing = FALSE
  /\ mounted = TRUE
  /\ errReloaded = FALSE

QUnchanged == UNCHANGED <<qStatus, shown, req, missing, errReloaded>>

-----------------------------------------------------------------------------
(* Remote sync. *)

\* R1 first ready, R7 a reload's first commit, R8 P's first remote sync.
RemoteReady(s) ==
  /\ \/ gate[s] = "loading"
     \/ reloading[s]
     \/ s = P /\ gate[P] = "ready" /\ ~remoteUp /\ problem[P] # "error"
  /\ problem' = [problem EXCEPT ![s] = IF reloading[s] \/ (s = P /\ ~remoteUp)
                                          THEN "none" ELSE problem[s]]
  /\ rows' = [rows EXCEPT ![s] = TRUE]
  /\ known' = [known EXCEPT ![s] = TRUE]
  /\ remoteUp' = IF s = P THEN TRUE ELSE remoteUp
  /\ remoteFail' = IF s = P THEN FALSE ELSE remoteFail
  /\ Settle([gate EXCEPT ![s] = "ready"], [reloading EXCEPT ![s] = FALSE])
  /\ UNCHANGED <<stale, fromStale, restore, remoteFailedEarly, mounted>>

\* R5 fail(e) before the current run's first commit.
RemoteFailBefore(s) ==
  /\ \/ gate[s] = "loading" /\ ~(s = P /\ remoteFailedEarly)
     \/ reloading[s]
     \/ s = P /\ gate[P] = "ready" /\ ~remoteUp /\ problem[P] # "error"
  /\ CASE reloading[s] ->
          \* R7: nothing visible changes except the node's new error.
          /\ problem' = [problem EXCEPT ![s] = IF gate[s] = "ready" THEN "error" ELSE problem[s]]
          /\ remoteFailedEarly' = remoteFailedEarly
          /\ Settle(IF W("ReloadFailIsLoadingError") /\ gate[s] = "ready"
                      THEN [gate EXCEPT ![s] = "error"] ELSE gate,
                    [reloading EXCEPT ![s] = FALSE])
       [] gate[s] = "ready" ->
          \* R8: P's gate opened from disk; the remote stopped before syncing.
          /\ problem' = [problem EXCEPT ![s] = "error"]
          /\ remoteFailedEarly' = remoteFailedEarly
          /\ Settle(gate, reloading)
       [] s = P /\ restore = "pending" ->
          \* R8: wait for the restore result.
          /\ remoteFailedEarly' = TRUE
          /\ UNCHANGED problem
          /\ Settle(gate, reloading)
       [] OTHER ->
          /\ remoteFailedEarly' = remoteFailedEarly
          /\ UNCHANGED problem
          /\ Settle([gate EXCEPT ![s] = "error"], reloading)
  /\ remoteFail' = IF s = P THEN FALSE ELSE remoteFail
  /\ UNCHANGED <<rows, known, stale, fromStale, restore, remoteUp, mounted>>

\* R8: P's remote has a problem while its gate is open from disk.
RemoteProblemFromDisk ==
  /\ gate[P] = "ready" /\ ~remoteUp /\ ~reloading[P] /\ problem[P] = "none" /\ ~remoteFail
  /\ IF W("SilentFromDisk")
       THEN remoteFail' = TRUE /\ UNCHANGED problem
       ELSE problem' = [problem EXCEPT ![P] = "failure"] /\ UNCHANGED remoteFail
  /\ UNCHANGED <<gate, rows, known, reloading, stale, fromStale, restore, remoteUp,
                 remoteFailedEarly, mounted>>
  /\ QUnchanged

\* R5 reportError / reportHealthy / fail after the current run's first commit.
ReportError(s) ==
  /\ gate[s] = "ready" /\ ~reloading[s] /\ problem[s] = "none"
  /\ problem' = [problem EXCEPT ![s] = "failure"]
  /\ UNCHANGED <<gate, rows, known, reloading, stale, fromStale, restore, remoteUp,
                 remoteFail, remoteFailedEarly, mounted>>
  /\ QUnchanged

ReportHealthy(s) ==
  /\ gate[s] = "ready" /\ ~reloading[s]
  /\ problem[s] = "failure" \/ (W("HealthyClearsError") /\ problem[s] = "error")
  /\ problem' = [problem EXCEPT ![s] = "none"]
  /\ UNCHANGED <<gate, rows, known, reloading, stale, fromStale, restore, remoteUp,
                 remoteFail, remoteFailedEarly, mounted>>
  /\ QUnchanged

FailAfter(s) ==
  /\ gate[s] = "ready" /\ ~reloading[s] /\ problem[s] # "error"
  /\ (s = P => remoteUp)
  /\ problem' = [problem EXCEPT ![s] = "error"]
  /\ UNCHANGED <<gate, rows, known, reloading, stale, fromStale, restore, remoteUp,
                 remoteFail, remoteFailedEarly, mounted>>
  /\ QUnchanged

\* R7: a superseded run delivers late.
StaleCommit(s) ==
  /\ stale[s]
  /\ stale' = [stale EXCEPT ![s] = FALSE]
  /\ IF W("NoRunFence")
       THEN fromStale' = TRUE /\ rows' = [rows EXCEPT ![s] = TRUE]
       ELSE UNCHANGED <<fromStale, rows>>
  /\ UNCHANGED <<gate, problem, known, reloading, restore, remoteUp, remoteFail,
                 remoteFailedEarly, mounted>>
  /\ QUnchanged

-----------------------------------------------------------------------------
(* Local persistence of P. *)

RestoreDone(r) ==
  /\ restore = "pending" /\ gate[P] \in {"loading", "ready", "error"}
  /\ restore' = r
  /\ LET opens == gate[P] = "loading" /\ (r = "synced" \/ W("EmptyRestoreOpens"))
         g == IF opens THEN [gate EXCEPT ![P] = "ready"]
              ELSE IF remoteFailedEarly /\ gate[P] = "loading"
                THEN [gate EXCEPT ![P] = "error"] ELSE gate
     IN /\ rows' = [rows EXCEPT ![P] = rows[P] \/ opens]
        /\ known' = [known EXCEPT ![P] = known[P] \/ r = "synced"]
        /\ problem' = IF opens /\ remoteFailedEarly THEN [problem EXCEPT ![P] = "error"] ELSE problem
        /\ Settle(g, reloading)
  /\ remoteFailedEarly' = FALSE
  /\ UNCHANGED <<stale, fromStale, remoteUp, remoteFail, mounted>>

\* R2/R8 a failed restore, or storage breaking later, is a crash.
StorageBreaks ==
  /\ gate[P] \in {"loading", "ready", "error"}
  /\ restore' = IF restore = "pending" THEN "failed" ELSE restore
  /\ rows' = [rows EXCEPT ![P] = FALSE]
  /\ problem' = [problem EXCEPT ![P] = "none"]
  /\ remoteFail' = FALSE
  /\ Settle([gate EXCEPT ![P] = "crashed"], [reloading EXCEPT ![P] = FALSE])
  /\ UNCHANGED <<known, stale, fromStale, remoteUp, remoteFailedEarly, mounted>>

-----------------------------------------------------------------------------
(* App actions. *)

\* R7. A reload in flight returns its promise (no transition). Crashed throws.
CanReload(s) ==
  /\ ~reloading[s]
  /\ gate[s] \in {"loading", "ready", "error"} \/ (W("ReloadCrashed") /\ gate[s] = "crashed")

StartReload(s, rl, r) ==
  IF gate[s] = "loading"
    THEN \* a new run replaces the loading one
         /\ stale' = [stale EXCEPT ![s] = TRUE]
         /\ restore' = IF s = P THEN "pending" ELSE restore
         /\ remoteUp' = IF s = P THEN FALSE ELSE remoteUp
         /\ remoteFail' = IF s = P THEN FALSE ELSE remoteFail
         /\ remoteFailedEarly' = IF s = P THEN FALSE ELSE remoteFailedEarly
         /\ rows' = rows
         /\ SettleR(gate, rl, r)
  ELSE IF gate[s] = "crashed"
    THEN \* only under Weak "ReloadCrashed"
         /\ stale' = stale
         /\ restore' = IF s = P THEN "pending" ELSE restore
         /\ remoteUp' = IF s = P THEN FALSE ELSE remoteUp
         /\ remoteFail' = IF s = P THEN FALSE ELSE remoteFail
         /\ remoteFailedEarly' = IF s = P THEN FALSE ELSE remoteFailedEarly
         /\ rows' = rows
         /\ SettleR([gate EXCEPT ![s] = "loading"], rl, r)
  ELSE \* ready or error: keep everything visible; the node shows reloading
         /\ stale' = stale
         /\ restore' = restore
         /\ remoteUp' = remoteUp
         /\ remoteFail' = IF s = P THEN FALSE ELSE remoteFail
         /\ remoteFailedEarly' = remoteFailedEarly
         /\ rows' = IF W("ReloadBlanks") THEN [rows EXCEPT ![s] = FALSE] ELSE rows
         /\ IF W("ReloadShowsLoading") /\ gate[s] = "error"
              THEN SettleR([gate EXCEPT ![s] = "loading"], [rl EXCEPT ![s] = FALSE], r)
              ELSE SettleR(gate, [rl EXCEPT ![s] = TRUE], r)

Reload(s) ==
  /\ CanReload(s)
  /\ UNCHANGED <<problem, known, fromStale, mounted>>
  \* R7: a failed request is re-issued by the new run.
  /\ StartReload(s, reloading, IF req = "failed" THEN "pending" ELSE req)

\* R9: reload a live query in 'error': reload each failed source.
QueryReload ==
  /\ mounted /\ qStatus = "error"
  /\ LET failed == {s \in Sources : (gate[s] = "error" \/ problem[s] = "error") /\ ~reloading[s]}
     IN /\ failed # {}
        /\ reloading' = [s \in Sources |-> reloading[s] \/ s \in failed]
  /\ UNCHANGED <<gate, problem, rows, known, stale, fromStale, restore, remoteUp, remoteFail,
                 remoteFailedEarly, qStatus, shown, req, missing, mounted, errReloaded>>

\* cleanup() throws while the query subscribes; a cascade cleans the query first.
CleanupSource(s) ==
  /\ ~mounted \/ W("CleanupWithSubscribers")
  /\ gate[s] # "cleaned"
  /\ rows' = [rows EXCEPT ![s] = FALSE]
  /\ problem' = [problem EXCEPT ![s] = "none"]
  /\ known' = [known EXCEPT ![s] = FALSE]
  /\ Settle([gate EXCEPT ![s] = "cleaned"], [reloading EXCEPT ![s] = FALSE])
  /\ UNCHANGED <<stale, fromStale, restore, remoteUp, remoteFail, remoteFailedEarly, mounted>>

CleanupQuery ==
  /\ mounted
  /\ mounted' = FALSE
  /\ qStatus' = "cleaned-up"
  /\ errReloaded' = FALSE
  /\ req' = "none" /\ missing' = FALSE
  /\ UNCHANGED <<gate, problem, rows, known, reloading, stale, fromStale, restore, remoteUp,
                 remoteFail, remoteFailedEarly, shown>>

\* A cleaned source preloads again: the recreated instance after a crash.
PreloadSource(s) ==
  /\ gate[s] = "cleaned"
  /\ restore' = IF s = P THEN "pending" ELSE restore
  /\ remoteUp' = IF s = P THEN FALSE ELSE remoteUp
  /\ remoteFail' = IF s = P THEN FALSE ELSE remoteFail
  /\ remoteFailedEarly' = IF s = P THEN FALSE ELSE remoteFailedEarly
  /\ UNCHANGED <<problem, rows, known, stale, fromStale, mounted>>
  /\ Settle([gate EXCEPT ![s] = "loading"], reloading)

MountQuery ==
  /\ ~mounted
  /\ \A s \in Sources : gate[s] # "cleaned"
  /\ UNCHANGED problem
  /\ mounted' = TRUE
  /\ qStatus' = NewQ("loading", gate)
  /\ errReloaded' = FALSE
  /\ shown' = (qStatus' = "ready")
  /\ req' = "none" /\ missing' = FALSE
  /\ UNCHANGED <<gate, rows, known, reloading, stale, fromStale, restore, remoteUp,
                 remoteFail, remoteFailedEarly>>

ReqVars == <<gate, problem, rows, known, reloading, stale, fromStale, restore, remoteUp,
             remoteFail, remoteFailedEarly, qStatus, shown, mounted, errReloaded>>
RequestStart == qStatus = "ready" /\ req = "none" /\ req' = "pending" /\ missing' = TRUE /\ UNCHANGED ReqVars
RequestFail == req = "pending" /\ req' = "failed" /\ UNCHANGED <<missing>> /\ UNCHANGED ReqVars
RequestLoad == req = "pending" /\ req' = "none" /\ missing' = FALSE /\ UNCHANGED ReqVars
RequestRetry == req = "failed" /\ req' = "pending" /\ UNCHANGED <<missing>> /\ UNCHANGED ReqVars
RequestRetire == req # "none" /\ req' = "none" /\ missing' = FALSE /\ UNCHANGED ReqVars

Next ==
  \/ \E s \in Sources :
       RemoteReady(s) \/ RemoteFailBefore(s) \/ ReportError(s) \/ ReportHealthy(s)
       \/ FailAfter(s) \/ StaleCommit(s) \/ Reload(s) \/ CleanupSource(s) \/ PreloadSource(s)
  \/ \E r \in {"synced", "never"} : RestoreDone(r)
  \/ RemoteProblemFromDisk \/ StorageBreaks
  \/ QueryReload \/ CleanupQuery \/ MountQuery
  \/ RequestStart \/ RequestFail \/ RequestLoad \/ RequestRetry \/ RequestRetire

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* What the app observes. *)

NodeFailureReason(s) == problem[s] = "failure"
NodeError(s) ==
  IF W("OneErrorField") THEN problem[s] # "none" \/ gate[s] = "error"
  ELSE problem[s] = "error" \/ gate[s] = "error"
NodeReloading(s) == ~W("ReloadHidden") /\ reloading[s]

RemedyFromObs ==
  CASE ~mounted -> {}
    [] qStatus = "crashed" -> {"recreate"}
    [] qStatus = "error" ->
         IF \E s \in Sources : NodeError(s) /\ ~NodeReloading(s) THEN {"reload"} ELSE {"wait"}
    [] qStatus = "loading" -> {}
    [] OTHER ->
         {r \in {"wait", "reload"} :
            \E s \in Sources :
              \/ r = "wait" /\ (NodeReloading(s)
                                \/ (NodeFailureReason(s) /\ ~NodeError(s)))
              \/ r = "reload" /\ NodeError(s) /\ ~NodeReloading(s)}
         \cup (IF req = "failed" THEN {"retry-action"} ELSE {})

Oracle ==
  CASE ~mounted -> {}
    [] qStatus = "crashed" -> {"recreate"}
    [] qStatus = "error" ->
         IF \E s \in Sources : (gate[s] = "error" \/ problem[s] = "error") /\ ~reloading[s]
           THEN {"reload"} ELSE {"wait"}
    [] qStatus = "loading" -> {}
    [] OTHER ->
         {r \in {"wait", "reload"} :
            \E s \in Sources :
              \/ r = "wait" /\ (reloading[s] \/ problem[s] = "failure"
                                \/ (s = P /\ remoteFail))
              \/ r = "reload" /\ ~reloading[s] /\ (problem[s] = "error" \/ gate[s] = "error")}
         \cup (IF req = "failed" THEN {"retry-action"} ELSE {})

-----------------------------------------------------------------------------
(* Invariants. *)

I1_LoadingErrorNeverAfterData == (mounted /\ qStatus = "error") => ~shown
I2_AfterReadyOnlyCrash == (mounted /\ shown) => qStatus \in {"ready", "crashed"}
I3_ReadyShowsRows == (mounted /\ qStatus = "ready") => rows[P]
I4_RemedyDecodable == RemedyFromObs = Oracle
I6_NoCleanupUnderQuery == mounted => \A s \in Sources : gate[s] # "cleaned"
I7_NoStaleRows == ~fromStale
I8_ReadyMeansKnown == gate[P] = "ready" => known[P]
NoSilentMissing == (qStatus = "ready" /\ missing) => req \in {"pending", "failed"}
LocalRowsNotHidden == restore = "synced" => gate[P] # "error"

ErrorClearsOnlyByReload ==
  [][\A s \in Sources :
       ((problem[s] = "error" /\ problem'[s] = "none" /\ gate'[s] = "ready")
          => reloading[s])
     /\ ((gate[s] = "error" /\ gate'[s] = "ready") => reloading[s])]_vars
QueryErrorClearsOnlyByReload ==
  [][(qStatus = "error" /\ qStatus' = "ready") =>
       (errReloaded \/ \E s \in Sources : reloading[s])]_vars
\* A query in 'error' can always get out: some source is failed (reload it) or reloading.
QueryErrorHasAWayOut ==
  (mounted /\ qStatus = "error") =>
    \E s \in Sources : reloading[s] \/ gate[s] \in {"error", "loading"} \/ problem[s] = "error"
\* Finding F1 (run 4): a query can sit in 'error' with no failed source while another
\* source is still loading its first ready. Recorded by this invariant:
QueryErrorNamesAFailure ==
  (mounted /\ qStatus = "error") =>
    \E s \in Sources : reloading[s] \/ gate[s] = "error" \/ problem[s] = "error"
\* Nothing recovers a crash in place: only cleanup leaves 'crashed', and a later
\* PreloadSource starts from 'cleaned' as a fresh Collection would.
CrashPermanentForInstance ==
  [][\A s \in Sources : gate[s] = "crashed" => gate'[s] \in {"crashed", "cleaned"}]_vars
ReloadNeverShowsLoading ==
  [][\A s \in Sources : (gate[s] = "error" /\ gate'[s] = "loading") => FALSE]_vars
=============================================================================
