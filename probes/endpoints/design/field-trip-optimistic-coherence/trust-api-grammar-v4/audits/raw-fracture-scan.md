# Fracture Scan: Trust API grammar v4

Canonical Field Log source: run 62, event 1052, entry 117.

## FS-01 — A disabled rule has no explicit condition state

**Target claim.** A project-wide `off` changes the active obligation set while prior evidence and conditions remain inspectable and every current condition still means that attention is needed.

**Frozen premises and scope.** M03 says configuration determines active obligations and cannot conceal conditions created under earlier revisions. X02 defines a condition as a stable policy-free reason attention is needed. R13 says disabling changes the active obligation set and neither erases prior evidence nor conditions. PC4-06 requires condition lifetime to remain distinct. N02 rejects disappearance from all reports.

**Route and trace.** Internal extension plus a minimal counterexample. Start with an enabled endpoint rule whose missing evidence produces a condition. Apply an authorized permanent `off` configuration revision and change nothing else. If the condition remains in the current attention set, the obligation was not actually deactivated. If it disappears from all reports, the design violates its non-erasure and non-concealment rule. A third result—historical but inactive/superseded condition—is coherent, but that state and its query semantics are not present in the frozen model.

**Preserved insight.** Configuration disablement should remain different from a temporary consumer override, and neither should rewrite evidence. The narrower repair is to separate immutable condition occurrence/history from current active-condition membership, with the originating and superseding configuration revisions visible. CI can query active conditions while Devtools can include inactive history.

**Weakening evidence.** A source-backed rule showing that every X02 is already an immutable occurrence with an explicit active predicate and active-versus-historical query contract would reduce this to wording loss. No such rule appears in the frozen v4 artifacts.

## FS-02 — The editor loop starts after an unmodeled transition

**Target claim.** LSP diagnostics are a side-effect-free projection of the same coherent Trust state used by CLI, MCP, Devtools, and TypeScript, and they react to edited code.

**Frozen premises and scope.** PC4-11, R12, R15, and R16 require side-effect-free reads, transactional commands, one semantic model, and coherent snapshots. M09 recognizes changing context as a command. UC01 begins with the active rule modules for the edited source already resolved, then derives and projects a diagnostic.

**Route and trace.** Minimal counterexample. An agent edits one endpoint so its write set now overlaps an active query, then the editor requests diagnostics before any explicit Trust command. Reading the last committed X06 snapshot reports the old clean state. Running a method or committing the new context inside the diagnostic request turns a read into a command. Computing a private LSP-only condition abandons the shared condition model. The reconstruction therefore assumes, but does not specify, the legal transition from changed buffer/source state to the snapshot it reads.

**Preserved insight.** The query/command split and one shared condition model survive. The grammar needs an explicit editor-context contract: for example, an LSP change notification mapped to a versioned M09 context-ingest command, or a typed ephemeral workspace overlay that derives provisional conditions without pretending they are committed history. It must also say how the overlay reconciles with durable evidence, work, and later snapshots.

**Weakening evidence.** If the intended contract already maps every relevant file or buffer change to a successful M09 context command before diagnostics, and exposes failure/staleness when that transition has not committed, the fracture becomes an omitted UC01 step rather than a new primitive.

## FS-03 — `defineRule()` has no stated component identity rule

**Target claim.** Authors get one straightforward linter-style rule bundle while registration preserves independently addressable claim, route, method, applicability, admission, and presentation identities.

**Frozen premises and scope.** M01 retains definition hashes. M02 is one versioned module containing rules, methods, applicability functions, and messages. M04 and M06 are versioned. M11 can admit presentation as well as semantic roots. R04 requires stored identity and admission at component versions. The example makes the claim version explicit but does not show identity/version inputs for support, applicability, methods, or messages.

**Route and trace.** Internal extension. Change only a rule's diagnostic wording. If the whole module or bundle version is the identity of every lowered component, a harmless presentation edit can churn claim/method admission and invalidate evidence unrelated to the change. If presentation is excluded from identity, its own admitted version and cross-interface diagnostic identity can change without a trace. Per-component structural hashes and dependency closure can avoid the fork, but the frozen grammar neither requires nor defines them. A semantic applicability edit creates the converse under-invalidation risk when an unchanged top-level version is accepted.

**Preserved insight.** `defineRule()` can remain the ergonomic authoring surface. Registration needs a deterministic lowering manifest that assigns separate identities to each semantic and presentation component, records dependencies among them, and states conservative invalidation rules.

**Weakening evidence.** An existing specified lowering algorithm with per-component hashes, explicit version overrides, dependency closure, and tests for presentation-only versus applicability changes would show that the grammar merely omitted implementation detail.

## Screened tension, not an admitted fracture

Easy project-local authoring versus independent admission initially looked self-defeating: a local agent can write and enable a rule but cannot admit its own proposal. The position explicitly distinguishes authoring from authority and records the project-local admission topology as unresolved C05. That makes it a known open design decision, not a hidden internal fracture. It becomes a broken promise only if the later API claims a complete local adoption loop without supplying a non-self-authorizing legal action.

## Controls

- Outside-standard rebuttal rejected: “Linters should be simple stateless callbacks, so the evidence graph is overbuilt.” Conventional linter simplicity is not one of the candidate's binding rules.
- Near-counterexample rejected: a third-party rule package exfiltrates repository secrets during execution. Loader, sandbox, signature, hostile-process, and remote-execution design are explicitly outside the frozen scope, so this remains C10 rather than an internal fracture.

## Limits

These are candidate fractures in a design model, not executed defects. The scan may overstate them by turning underspecification into a vivid either/or failure. No runtime or TypeScript API was exercised, and each candidate includes evidence that could weaken it.
