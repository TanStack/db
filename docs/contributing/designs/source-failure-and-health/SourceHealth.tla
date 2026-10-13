---------------------------- MODULE SourceHealth ----------------------------
(***************************************************************************)
(* The source health channel. Status gates the first ready; health is      *)
(* metadata that a source reports after it. A live query exposes an error  *)
(* tree with one node per collection it depends on. The tree always has    *)
(* the same shape, and each node mirrors its collection's reports.         *)
(*                                                                         *)
(* Topology: sources A and B. Live query L1 reads A. Live query Top reads  *)
(* L1 and B, so A reaches Top only through L1. Properties H1 to H11 are    *)
(* the frozen list in README.md.                                           *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
  HealthFlipsStatus,   \* a post-ready failure changes the gate status (old Electric/PowerSync)
  NestedDoesNotRelay,  \* a nested live query does not pass its sources' health up
  FrameworkClears,     \* the framework clears an error without a source report
  DropHealthyNodes,    \* the tree lists only failing nodes
  FailureClearsRows    \* a post-ready failure discards visible rows

Sources == {"A", "B"}
Nodes == {"A", "B", "L1"}           \* the nodes in Top's error tree

VARIABLES
  status,     \* gate per source: "loading" | "ready" | "error"
  health,     \* per source, after ready: "healthy" | "failed"
  rows,       \* per source: visible rows exist
  tree,       \* Top's error tree: node -> "ok" | "error"; DOMAIN is the shape
  topStatus,  \* Top's gate: "loading" | "ready" | "error"
  topRows,    \* Top's visible rows
  reported    \* per source: the source's latest report was a failure

vars == <<status, health, rows, tree, topStatus, topRows, reported>>

\* What Top's tree must show, derived only from source state (H4, H11).
NodeState(n) ==
  CASE n = "L1" -> IF status["A"] = "error" \/ health["A"] = "failed" THEN "error" ELSE "ok"
    [] OTHER    -> IF status[n] = "error" \/ health[n] = "failed" THEN "error" ELSE "ok"

Relay ==
  [n \in (IF DropHealthyNodes THEN {m \in Nodes : NodeState(m) = "error"} ELSE Nodes) |->
     IF NestedDoesNotRelay /\ n = "L1" THEN "ok" ELSE NodeState(n)]

\* The gate is unchanged from the failure law: Top waits for both inputs.
TopGate ==
  IF \E s \in Sources : status[s] = "error" THEN "error"
  ELSE IF \A s \in Sources : status[s] = "ready" THEN "ready" ELSE "loading"

Propagate(keepGate) ==
  /\ tree' = Relay'
  /\ topStatus' = IF keepGate /\ topStatus = "ready" THEN "ready" ELSE TopGate'
  /\ topRows' = IF topStatus' = "ready" THEN rows'["A"] /\ rows'["B"] ELSE topRows

Init ==
  /\ status = [s \in Sources |-> "loading"]
  /\ health = [s \in Sources |-> "healthy"]
  /\ rows = [s \in Sources |-> FALSE]
  /\ reported = [s \in Sources |-> FALSE]
  /\ tree = [n \in Nodes |-> "ok"]
  /\ topStatus = "loading" /\ topRows = FALSE

\* Before the first ready, the gate decides (H2).
Ready(s) ==
  /\ status[s] = "loading"
  /\ status' = [status EXCEPT ![s] = "ready"] /\ rows' = [rows EXCEPT ![s] = TRUE]
  /\ UNCHANGED <<health, reported>>
  /\ Propagate(TRUE)

InitialFailure(s) ==
  /\ status[s] = "loading"
  /\ status' = [status EXCEPT ![s] = "error"]
  /\ UNCHANGED <<health, rows, reported>>
  /\ Propagate(TRUE)

\* After the first ready, a failure is metadata (H1).
ReportFailure(s) ==
  /\ status[s] = "ready" /\ health[s] = "healthy"
  /\ health' = [health EXCEPT ![s] = "failed"] /\ reported' = [reported EXCEPT ![s] = TRUE]
  /\ status' = IF HealthFlipsStatus THEN [status EXCEPT ![s] = "error"] ELSE status
  /\ rows' = IF FailureClearsRows THEN [rows EXCEPT ![s] = FALSE] ELSE rows
  /\ Propagate(~HealthFlipsStatus)

\* Only the source clears its own failure, by reporting that sync works (H3).
ReportHealthy(s) ==
  /\ health[s] = "failed"
  /\ health' = [health EXCEPT ![s] = "healthy"] /\ reported' = [reported EXCEPT ![s] = FALSE]
  /\ UNCHANGED <<status, rows>>
  /\ Propagate(TRUE)

\* Weakening: the framework clears a failure on its own (H3).
FrameworkClear(s) ==
  /\ FrameworkClears /\ health[s] = "failed"
  /\ health' = [health EXCEPT ![s] = "healthy"]
  /\ UNCHANGED <<status, rows, reported>>
  /\ Propagate(TRUE)

Next == \E s \in Sources :
  Ready(s) \/ InitialFailure(s) \/ ReportFailure(s) \/ ReportHealthy(s) \/ FrameworkClear(s)

Spec == Init /\ [][Next]_vars

---------------------------------------------------------------------------
\* H11: the tree always has the same shape.
StableShape == DOMAIN tree = Nodes
\* H4: every node mirrors its collection, including through the nested live query.
TreeMirrorsSources == \A n \in DOMAIN tree : tree[n] = NodeState(n)
\* H3: a failure shows until its source reports otherwise.
OnlySourceClears == \A s \in Sources : (health[s] = "healthy") => ~reported[s]
\* H1 and H5: after Top's first ready, health never moves its gate or its rows.
GateIgnoresHealth == [][topStatus = "ready" => (topStatus' = "ready" /\ topRows')]_vars
\* H2: the gate's error is explained by a node in the tree.
GateExplained == topStatus = "error" => \E n \in DOMAIN tree : tree[n] = "error"
=============================================================================
