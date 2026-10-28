---------------------------- MODULE SourceFailure ----------------------------
(***************************************************************************)
(* The source failure law: a source either keeps trying (loading), becomes *)
(* ready, or reports a final error for its sync attempt. The framework     *)
(* never heals an attempt; the app recovers by starting a fresh attempt    *)
(* (cleanup, then preload). Each element names the frozen property (F1 to  *)
(* F12) that it encodes; README.md holds the trace table.                  *)
(*                                                                         *)
(* One source serves a readiness wait (preload, stateWhenReady,            *)
(* toArrayWhenReady, queryOnce), a direct live query, a live query over a  *)
(* lazy join or include, and a skipInitial Effect. Consumers react in the  *)
(* same step as the source signal, as their status listeners do.           *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
  MaxAttempts,
  \* Weakenings: each encodes one plausible wrong design.
  HealOnReady,      \* the source may mark ready after its final error (old #1751 healing)
  RejectOnRetry,    \* a transient error fails consumers while the source retries
  LazyTerminal,     \* lazy demand fails for good while the root follows status
  DetachWaits,      \* waiting loads detach for recovery instead of rejecting
  SilentGiveUp,     \* the SDK gives up without the adapter reporting markError
  StaleApplies,     \* a callback from a cleaned attempt reaches the new one
  PoisonSource,     \* a request-specific failure marks the source failed
  FrameworkRetry,   \* the framework restarts a failed attempt by itself
  ClearOnLateFail   \* a failure after ready discards the visible snapshot

Consumers == {"root", "lazy"}

VARIABLES
  attempt,      \* current sync attempt number (F7)
  status,       \* "idle" | "loading" | "ready" | "error"
  retrying,     \* the source reported a transient error and is retrying (F1, F9)
  alive,        \* the source is still trying in this attempt (F10)
  finalFailed,  \* the source reported a final error in this attempt (F2)
  rows,         \* a usable snapshot is visible (F5, F6)
  wait,         \* readiness wait: "none" | "pending" | "resolved" | "rejected" | "aborted"
  live,         \* live query state per consumer: "loading" | "ready" | "error"
  effect,       \* "active" | "disposed"
  reqFailed,    \* the root query's own request failed on a healthy source (F12)
  byApp         \* the last attempt change came from the app (F3, F9)

vars == <<attempt, status, retrying, alive, finalFailed, rows, wait, live, effect,
          reqFailed, byApp>>

Init ==
  /\ attempt = 0 /\ status = "idle" /\ retrying = FALSE /\ alive = FALSE
  /\ finalFailed = FALSE /\ rows = FALSE /\ wait = "none"
  /\ live = [c \in Consumers |-> "loading"] /\ effect = "active"
  /\ reqFailed = FALSE /\ byApp = TRUE

\* A fresh attempt: all demand is requested again and every wait is new (F3).
FreshAttempt(app) ==
  /\ attempt' = attempt + 1 /\ status' = "loading" /\ alive' = TRUE
  /\ retrying' = FALSE /\ finalFailed' = FALSE /\ rows' = FALSE
  /\ wait' = "pending" /\ live' = [c \in Consumers |-> "loading"]
  /\ effect' = "active" /\ reqFailed' = FALSE /\ byApp' = app

Start == attempt = 0 /\ FreshAttempt(TRUE)

\* The source keeps trying: a transient error with a retry (F1).
TransientError ==
  /\ status = "loading" /\ alive /\ ~retrying
  /\ retrying' = TRUE
  /\ IF RejectOnRetry
     THEN /\ wait' = IF wait = "pending" THEN "rejected" ELSE wait
          /\ live' = [c \in Consumers |-> "error"] /\ effect' = "disposed"
     ELSE UNCHANGED <<wait, live, effect>>
  /\ UNCHANGED <<attempt, status, alive, finalFailed, rows, reqFailed, byApp>>

RetrySucceeds ==
  /\ retrying /\ alive
  /\ retrying' = FALSE
  /\ UNCHANGED <<attempt, status, alive, finalFailed, rows, wait, live, effect, reqFailed, byApp>>

\* The source establishes a usable snapshot (F5).
SourceReady ==
  /\ alive /\ ~retrying
  /\ (status = "loading") \/ (HealOnReady /\ status = "error")
  /\ status' = "ready" /\ rows' = TRUE
  /\ wait' = IF wait = "pending" THEN "resolved" ELSE wait
  /\ live' = [c \in Consumers |->
               IF (c = "root" /\ reqFailed) \/ (LazyTerminal /\ live[c] = "error" /\ c = "lazy")
               THEN live[c] ELSE "ready"]
  /\ UNCHANGED <<attempt, retrying, alive, finalFailed, effect, reqFailed, byApp>>

\* A final error reaches every consumer with its cause (F2, F4).
FinalError ==
  /\ alive /\ status \in {"loading", "ready"}
  /\ status' = "error" /\ finalFailed' = TRUE /\ retrying' = FALSE
  /\ alive' = HealOnReady
  /\ wait' = IF wait = "pending" /\ ~DetachWaits THEN "rejected" ELSE wait
  /\ live' = [c \in Consumers |-> "error"] /\ effect' = "disposed"
  /\ UNCHANGED <<attempt, rows, reqFailed, byApp>>

\* The SDK gives up inside the source; the adapter must report it (F10).
SdkGivesUp ==
  /\ alive /\ status = "loading"
  /\ IF SilentGiveUp
     THEN /\ alive' = FALSE /\ retrying' = FALSE
          /\ UNCHANGED <<status, finalFailed, wait, live, effect>>
     ELSE /\ status' = "error" /\ finalFailed' = TRUE /\ alive' = FALSE
          /\ retrying' = FALSE
          /\ wait' = IF wait = "pending" /\ ~DetachWaits THEN "rejected" ELSE wait
          /\ live' = [c \in Consumers |-> "error"] /\ effect' = "disposed"
  /\ UNCHANGED <<attempt, rows, reqFailed, byApp>>

\* A later refresh failure after ready keeps the snapshot (F6).
LateFailure ==
  /\ status = "ready" /\ alive
  /\ rows' = ~ClearOnLateFail
  /\ UNCHANGED <<attempt, status, retrying, alive, finalFailed, wait, live, effect, reqFailed, byApp>>

\* One request fails while its source is healthy (F12).
RequestFails ==
  /\ status \in {"loading", "ready"} /\ alive /\ ~reqFailed
  /\ reqFailed' = TRUE
  /\ IF PoisonSource
     THEN /\ status' = "error" /\ alive' = FALSE
          /\ wait' = IF wait = "pending" THEN "rejected" ELSE wait
          /\ effect' = "disposed" /\ live' = [c \in Consumers |-> "error"]
     ELSE /\ live' = [live EXCEPT !["root"] = "error"]
          /\ UNCHANGED <<status, alive, wait, effect>>
  /\ UNCHANGED <<attempt, retrying, finalFailed, rows, byApp>>

\* A callback from the cleaned previous attempt arrives (F7).
StaleCallback ==
  /\ attempt > 1 /\ status = "loading"
  /\ IF StaleApplies
     THEN /\ status' = "error" /\ live' = [c \in Consumers |-> "error"]
          /\ wait' = IF wait = "pending" THEN "rejected" ELSE wait
          /\ effect' = "disposed"
     ELSE UNCHANGED <<status, live, wait, effect>>
  /\ UNCHANGED <<attempt, retrying, alive, finalFailed, rows, reqFailed, byApp>>

\* The app recovers: cleanup ends the old waits quietly, then a fresh attempt (F3).
AppRestart ==
  /\ attempt > 0 /\ attempt < MaxAttempts
  /\ FreshAttempt(TRUE)

\* Weakening: the framework restarts a failed attempt by itself (F9).
AutoRestart ==
  /\ FrameworkRetry /\ status = "error" /\ attempt < MaxAttempts
  /\ FreshAttempt(FALSE)

Next ==
  \/ Start \/ TransientError \/ RetrySucceeds \/ SourceReady \/ FinalError
  \/ SdkGivesUp \/ LateFailure \/ RequestFails \/ StaleCallback
  \/ AppRestart \/ AutoRestart

Spec == Init /\ [][Next]_vars

---------------------------------------------------------------------------
TypeOK ==
  /\ status \in {"idle", "loading", "ready", "error"}
  /\ wait \in {"none", "pending", "resolved", "rejected", "aborted"}
  /\ live \in [Consumers -> {"loading", "ready", "error"}]
  /\ effect \in {"active", "disposed"}

\* F1: while the source retries, nothing reports failure.
RetryIsNotFailure ==
  retrying => /\ status = "loading" /\ wait # "rejected" /\ effect = "active"
              /\ live["lazy"] # "error"
\* F2: a final error is final for its attempt.
NoHeal == finalFailed => status = "error"
\* F4 and F8: a final error reaches every consumer, and no wait is left pending.
PassThrough ==
  status = "error" => /\ wait # "pending" /\ effect = "disposed"
                      /\ \A c \in Consumers : live[c] = "error"
\* F5 and F6: ready means a usable snapshot is visible.
ReadyMeansRows == status = "ready" => rows
\* F10: a source that stopped trying has reported ready or a final error.
StoppedSourceReported == (status = "loading" /\ attempt > 0) => alive
\* F7: an error in the current attempt is that attempt's own final failure.
ErrorIsOwn == status = "error" => finalFailed
\* F11: consumers agree when no request-specific failure happened.
ConsumersAgree == ~reqFailed => live["root"] = live["lazy"]
\* F12: a request-specific failure leaves a healthy source healthy.
RequestFailureIsLocal == (reqFailed /\ ~finalFailed) => status # "error"
\* F3 and F9: only the app starts a new attempt.
OnlyAppRestarts == byApp
=============================================================================
