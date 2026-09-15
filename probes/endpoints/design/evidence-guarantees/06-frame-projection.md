# Two projections of recoverable guarantees

These maps expose two different questions: **what is still missing after a fact
is known**, and **how much of an execution or history the fact must cover**.
Neither is a ranking or a choice of architecture. A guarantee can span several
regions; the plotted unit is the stated part of a guarantee.

Date: 2026-09-15. Instrument: `frame-projector`, exploratory pass. Research
checkout: `9bbbd08d9388531e0b0d4487f883239304fdaf84`; supplied production baseline:
`9189b4f34`. The general agent evidence system is not implemented. Inputs are the
[brief](BRIEF.md), [survey](02-research-survey.md),
[ground condition](03-ground-condition.md), and [loss audit](04-loss-audit.md),
including its linked source-level records. This is a projection of that bounded
research, not a new primary-source survey or the complete 85-ID categorization.

**Eligibility.** The material has independent variation: knowing a dependency
can save a read, while knowing a validator's behavior can establish an admission
condition; either can concern visible or opaque code. Separately, a law can bind
one boundary or a history, and one logical unit or several participants. These
are plausible second distinctions, so the specimen is not plainly one-dimensional.
Both maps below are conceptual hypotheses, with no measured axes.

**Placement control.** One fresh agent received the frozen specimen without a
preferred map. It formed both candidates in the same context. The candidates
are therefore internally correlated, not two independently generated readings.
The source records are inherited research; only F01/F02 below were checked
against the local implementation in this pass. No runtime experiment ran.

## 1. Phenomenology inventory

The 18 items are a deliberately varied sample, not 18 independently established
Endpoints guarantees. “Source claim” means a contract or finding recorded in the
linked research; “generated example” means the earlier constructed case, not an
executed test. All placements and transfer statements are conceptual inferences.

| ID | Claim kind and item | Provenance and limit |
| --- | --- | --- |
| F01 | **Code observation:** the registry uses known write dependencies to select retained reads; unknown dependencies select conservatively. | [Registry](../../integrated-todo/src/registry.server.ts), selection callback around lines 149–166. Baseline and optimistic-state conditions can require reads even without intersecting relations. This says nothing about soundness of a producer's supplied set. |
| F02 | **Code observation:** inline analysis records skipped imported calls while returning dependencies from recognized SQL. | [Inline analysis](../../integrated-todo/inline-dependencies.mjs), around 210–217 and 315–324; [G1](03-ground-condition.md). Recording an uninspected call is not a complete footprint or an evidence-admission mechanism. |
| F03 | **Generated example:** an awaited API writes only shopping items, or writes none when `apply=false`; a conservative union still saves unrelated reads. | Survey E1 and ground G1. Branch, database authority, indirect effects, failure paths, and completion are premises. No certificate or conditional consumption exists yet. |
| F04 | **Generated example:** a recipe query uses membership reads hidden inside an access helper. | Survey E2. Complete read dependencies can support refresh selection. External authoritative state would require a separate response mechanism. Auth remains authored. |
| F05 | **Generated example:** an API acknowledges a job before its database effects finish. | Ground G2. A correct write set does not make a read taken before the later write authoritative; success, error, and timeout may have different completion meanings. |
| F06 | **Generated example:** a library either uses the supplied transaction for every relevant write or escapes through a global handle. | Survey E3 and ground G4. Inspection can check an existing participant; isolation and rollback come from the transaction. A forced-failure sample alone does not prove every path. |
| F07 | **Source claim:** a tRPC validator may be an ordinary function that returns accepted values and throws on rejection. | [Language audit L19a/L5a](audits/language.md). Inspecting an installed validator's accepting paths can establish a bounded semantic claim. An unchecked cast does not implement validation. |
| F08 | **Generated example:** converting a large integer key through `Number` collapses distinct identities despite plausible TS types. | Ground G5; survey E4. Injectivity, round trip, output cardinality, and order preservation are different laws; sampling an unbounded domain is not proof. |
| F09 | **Source claim:** Relay composes declared fragments into a request for a view subtree and retains declaration provenance. | [Query audit Q10/Q11](audits/queries.md), survey C6. Component inspection can reveal missing requirements; coalescing and masking need compiler/runtime support. This is not batching arbitrary TS endpoints. |
| F10 | **Source claim:** the historical Links example fetches before filtering/limiting when a predicate is opaque to SQL compilation. | [Language audit L20b](audits/language.md), survey C14. Knowing the predicate's meaning does not implement its lowering. This historical example does not describe present Links generally. |
| F11 | **Source claim:** policy enforcement can constrain executed SQL, prior/resulting rows, every object, and all submitted fields. | [Query audit Q15–Q18](audits/queries.md), survey C10. Inspection can trace coverage of existing checks. The policy and missing enforcement must be authored; the compiler must never insert auth. |
| F12 | **Source claim:** Convex snapshot/transaction contracts depend on its executor and restricted function context. | Survey C4/C5; [query audit Q07](audits/queries.md). Reading handle flow is ordinary analysis where supported; a helper summary cannot create isolation across separate operations. |
| F13 | **Generated example:** the client predicts a reservation from one state while the server sees a competing reservation. | Ground G6 and survey E6; source basis C8. Same-state optimism checks differ from settlement across divergent states. A test oracle needs an authored comparison law. |
| F14 | **Source claim/example:** acknowledgment must correspond to included effects; an Electric example transports and matches write identity before retiring optimism. | [Protocol audit P12b/P17a](audits/protocol.md), survey C11. Inspecting an existing adapter can check its correlation rule. Replication/rebase remain outside scope; a row ID need not identify a unique operation. |
| F15 | **Source claim:** duplicate requests may need an existing deduplication contract; retry tolerance is distinct from no effects. | [Protocol audit P18c/P23d](audits/protocol.md), [query audit Q20](audits/queries.md). Inspect the scope, atomicity, retention, and effect domains of any real implementation. This is not authorization for mutation retries. |
| F16 | **Source claim:** Falcor dereferencing keeps targeting the selected object when its list position changes. | [Query audit Q21](audits/queries.md). Stable object targeting is a history property distinct from preserving a key in one serialization. |
| F17 | **Source claim:** logout/revocation need not refresh permanent connections; LiveView documents an explicit disconnect/revalidation path. | [Protocol audit P26b](audits/protocol.md), survey C18. Identifying a revocation is different from causing active consumers to respond to it. |
| F18 | **Source claim:** a service's code identity differs from a mutable service name, runtime configuration, and storage authority. | Survey C19; [language audit L27b](audits/language.md). Evidence must remain bound to relevant premises. A matching hash alone cannot establish continuing applicability. |

## 2. Candidate clusters, formed before separators

The temporary handles below describe repeated shapes in the inventory. The
second partition changes membership substantially; it does not rename the first.
Overlaps are retained rather than resolved by assigning every guarantee one type.

### Candidate A: what work remains

| Temporary handle | Members and strongest prototype | Cohesion, overlaps, and weak points |
| --- | --- | --- |
| A1: dependency inventories | F01, F02, F03, F04. **Prototype F03.** | A complete description lets a consumer avoid irrelevant reads while retaining authoritative refresh. F02 is an outlier: the current producer's skipped-call gap prevents treating its set as a complete inventory. F04 also carries semantic/auth-sensitive dependencies. |
| A2: known behavior behind a boundary | F06, F07, F08; existing-check parts of F11; existing-contract parts of F15/F18. **Prototype F07.** | The relevant behavior already exists; the open question is whether source/configuration supports the exact law a consumer wants to use. F06 does not belong here if the library actually escapes the transaction. A missing validator/check/codec correction moves the case toward A4. |
| A3: execution-plan capabilities | F09, F10. **Prototype F10.** | Even perfect knowledge of requirements or predicate meaning leaves a compiler/runtime feature to build before redundant work disappears. F09's data masking and provenance checks overlap A4. This is the smallest cluster; its two distinct source mechanisms support it, but neither was tested in Endpoints. |
| A4: coordinated behavior | F05, F11's missing-enforcement case, F12, F13, F14, F15's missing-dedup case, F17, F18's missing-consumer-response case. **Prototype F05.** | The desired result needs an event, check, identity rule, or executor action at the right point. Recognition alone does not cause it. A preexisting, inspectable mechanism moves that part toward A2. F16 straddles A2/A4: inspect existing stable routing or author it if absent. |

No cluster is empty. A3 is thinner than A1/A4, and A2 depends on an explicit
“behavior already exists” premise. Those facts should remain visible; they are
not evidence that one kind of work dominates in production.

### Candidate B: the shape of the law

| Temporary handle | Members and strongest prototype | Cohesion, overlaps, and outliers |
| --- | --- | --- |
| B1: boundary specimens | F07, F08; the local slices of F01/F02. **Prototype F08.** | Examine accepted values, representation, or a returned analysis result at one logical boundary. F08's encode/decode pair still describes one value-transfer relation. Configuration and imported helpers can widen the inspection scope without changing the law's form. |
| B2: combined execution | F03, F04, F06, F09, F10, F11, F12. **Prototype F06.** | One result depends on how several calls, reads, transformations, or participants compose. A per-helper claim can be true while the composition fails. F10 is closer to B1 when the predicate alone is examined, then moves into B2 when filtering, limiting, and SQL placement join the claim. |
| B3: continuity of a logical unit | F15's single-service duplicate handling, F16. **Prototype F16.** | The same logical object or operation must retain its meaning across movement or repetition. F15 drifts toward B4 once a database claim must cover an external charge or other participant. This cluster is comparatively small, but stable target identity and repeat tolerance are distinct positive cases. |
| B4: linked histories | F05, F13, F14, F17, F18. **Prototype F14.** | Events across API/client/storage/session/deployment histories must have a justified relation. A local success, old snapshot, or matching source hash is insufficient. F18 is a meta-level outlier: it concerns the history of a fact's applicability, not only an app's data history. |

The two partitions cross: F06 and F12 share B2 while separating in A when the
former participant exists and the latter executor is absent. F07 and F16 can
both concern inspection of existing behavior in A, but separate into B1/B3.
F09 and F10 form A3 while joining a larger composition cluster in B2.

## 3. Candidate separators

### A: next ingredient × consequence of the unresolved part

- **Horizontal:** a fact can be inspected and bound ↔ behavior must be built or
  enforced. This is the residual work for the stated claim, given its premises.
  It is not “agent versus compiler”: either can establish facts; ordinary
  compiler/catalog work can also build an analysis or lowering feature.
- **Vertical:** conservative extra work ↔ result, admission, or settlement
  changes. A1/A3 concern avoiding work under a correct fallback. A2/A4 concern
  whether a specific semantic condition holds. The top pole does not imply the
  bottom pole is unimportant or free of correctness obligations.
- **Chemistry:** the pair separates knowing what to refresh from knowing when
  refresh is authoritative, and separates opaque-code inspection from a missing
  compiler capability. “More evidence” is not one uniformly useful intervention.
- **Independence:** F03 and F07 put inspectable facts on different vertical
  sides; F10 and F05 put missing behavior on different sides. All four regions
  have positive cases. This is more than a single diagonal.
- **Failure notes:** a conservative fallback must actually exist and be used.
  F02 prevents saying today's opaque-call handling is merely a performance gap.
  Optimizations can also alter semantics: F09 masking/provenance is not reduced
  to fewer requests. Many claims move horizontally after ordinary code changes.
  No distance or numeric threshold on either axis is measured.

### B: unit of obligation × temporal reach

- **Horizontal:** one logical unit ↔ several linked participants. This refers
  to what the law quantifies over, not the number of files read or libraries
  imported. A codec pair can express one value law; transaction participation
  connects handles and effects even inside one process.
- **Vertical:** one boundary/execution ↔ a history of changes. The lower
  regions compare facts within a call or coordinated execution; the upper
  regions require relationships across repeat calls, changing positions,
  acknowledgments, revocations, or changing premises.
- **Chemistry:** the pair separates a correct local property from the scope of
  the consumer's conclusion. Key preservation is not stable target selection;
  transaction participation is not acknowledgment of an arriving effect.
- **Independence:** F08/F16 show one-unit laws at different temporal scopes;
  F06/F14 show multiple-participant laws at different scopes. Histories often
  add participants, so there is diagonal pull, but the off-diagonal cases are
  substantive rather than impossible by definition.
- **Failure notes:** a transaction is internally a history, and one transfer
  has two ends. The distinction is the claim's observational boundary, not a
  count of events. F15's location changes with its effect domains. F18 widens
  the frame from app behavior to evidence applicability and is marked as such.

Rejected shortcuts: “compiler ↔ agent” confuses producer with claim scope, and
“certain ↔ uncertain” cannot be plotted from this corpus without invented
measurements. Neither is an additional map or a hidden ranking of the candidates.

## 4. Label workshop

All labels are conceptual metaphors for fuzzy prototypes. They are not roles
assigned to an agent, a compiler, or a human, and contain no priority judgment.

| Map / cluster | Candidates | Retained label and fit |
| --- | --- | --- |
| A / A1 | Surveyors; Cartographers; Registrars | **Surveyors:** inventories of relevant reads/writes let an existing consumer limit its work. |
| A / A2 | Inspectors; Examiners; Verifiers | **Inspectors:** scrutiny can establish what an existing validator, codec, or transaction participant actually does. This does not imply inspection is infallible. |
| A / A3 | Machinists; Planners; Builders | **Machinists:** knowing the shape still leaves executable query construction or lowering machinery to supply. |
| A / A4 | Conductors; Coordinators; Stewards | **Conductors:** the required actions must occur with the right coverage, order, and completion relation. No mutation queue is implied. |
| B / B1 | Specimens; Samples; Values | **Specimens:** one boundary's accepted value or representation is the focal unit. “Specimen” does not mean a sampled test establishes the universal law. |
| B / B2 | Assemblies; Ensembles; Compositions | **Assemblies:** the property concerns joined parts within one execution. |
| B / B3 | Threads; Tracks; Continuities | **Threads:** one logical object's or operation's identity is followed through a history. This does not mean an OS thread. |
| B / B4 | Conversations; Exchanges; Handshakes | **Conversations:** several histories need a justified relation, including who knows an effect or revocation has occurred. The label does not imply message delivery is guaranteed. |

A uses role nouns; B uses images of focal units and their relations. The styles
are internally coherent without turning the regions into exclusive types.

## 5. Rendered maps and diagnostic placements

Each map has eight featured cases, at most three in any cell. Every case has a
selection reason, typed provenance, and inventory/source pointer in its JSON,
ASCII placement list, and interactive controls. Other members remain above.
Coordinates are editorial placements on continuous spectra, not scores.
Both maps have occupied cells after searching the inventory and source records;
there is no evidentially earned empty cell to interpret as an opportunity.

### Map A — What is still missing?

[Interactive HTML](frames/next-ingredient.html) · [JSON source](frames/next-ingredient.json)
· [ASCII](frames/next-ingredient.txt) · [SVG fallback](frames/next-ingredient.svg)

```text
What is still missing?
Conceptual projection of claim slices: supplying a fact versus supplying behavior,
and extra work versus changed semantics. Neither axis is measured; regions overlap.
General agent evidence admission is not implemented. Bind a fact means inspect and
bind an existing behavior claim; implement behavior includes building or enforcing
the missing consumer action.

              Consequence if unresolved: result or settlement changes
                                         ^
+----------------------------------------+----------------------------------------+
|Inspectors                              |Conductors                              |
|[1] F07 Installed validator             |[3] F05 Job acknowledged early          |
|[2] F06 Existing tx participant         |[4] F11 Missing authored check          |
|+ 1 more below                          |                                        |
Next step: bind a fact <- +----------------------------------------+----------------------------------------+ -> Next step: implement behavior
|Surveyors                               |Machinists                              |
|[5] F03 Conditional footprint           |[7] F09 Fragment coalescing             |
|                                        |[8] F10 Predicate lowering              |
|                                        |                                        |
+----------------------------------------+----------------------------------------+
                                         v
                Consequence if unresolved: conservative extra work

Placements (normalized x, y):
[1] F07 Installed validator (0.22, 0.83) - category: Source claim; why plotted: Prototype: inspect existing behavior whose truth controls accepted values.; source claim; F07; 06-frame-projection.md inventory; audits/language.md L19a/L5a - Placement assumes a real validator is installed. An unchecked cast belongs to a missing-behavior case.
[2] F06 Existing tx participant (0.35, 0.64) - category: Generated example; why plotted: Boundary case: inspection can establish use of an existing transaction.; generated example; F06; 02-research-survey.md E3; 03-ground-condition.md G4 - All relevant effects must use the supplied handle and finish before return. An escaping handle moves the claim right.
[3] F05 Job acknowledged early (0.84, 0.82) - category: Generated example; why plotted: Prototype: a correct footprint cannot create a later completion boundary.; generated example; F05; 03-ground-condition.md G2 - A preexisting wait-for-completion contract could make part of the remaining task inspectable.
[4] F11 Missing authored check (0.72, 0.64) - category: Source claim; why plotted: Tests that knowing policy coverage does not implement an absent check.; source claim; F11; audits/queries.md Q15-Q18; 02-research-survey.md C10 - Plots the missing-enforcement transfer slice, inferred from source contracts. Existing checks move left. Auth must remain authored.
[5] F03 Conditional footprint (0.20, 0.21) - category: Generated example; why plotted: Prototype: a broad complete bound can save reads without exact branch precision.; generated example; F03; 02-research-survey.md E1; 03-ground-condition.md G1 - Assumes settled relevant effects and a conservative consumer. General agent evidence admission is still absent.
[6] F02 Skipped opaque calls (0.43, 0.54) - category: Code observation; why plotted: Outlier: a partial producer result breaks the conservative-fallback premise.; code observation; F02; inline-dependencies.mjs around 210-217 and 315-324 - Just above the semantic watershed: current analysis records skipped calls while returning recognized SQL dependencies. Its partial footprint can change correctness, not merely read cost. It remains an outlier from the dependency-inventory cluster.
[7] F09 Fragment coalescing (0.75, 0.20) - category: Source claim; why plotted: Prototype: declaration knowledge still needs query construction machinery.; source claim; F09; audits/queries.md Q10/Q11; 02-research-survey.md C6 - Plots coalescing only. Masking and declaration provenance have semantic obligations above the line.
[8] F10 Predicate lowering (0.84, 0.37) - category: Source claim; why plotted: Separate mechanism: understanding an opaque predicate does not implement SQL lowering.; source claim; F10; audits/language.md L20b; 02-research-survey.md C14 - Historical Links example; not a claim about current Links or an implemented Endpoints feature.

Calibration:
Axis claim type: Conceptual inference from typed source claims, constructed cases, and two code observations; coordinates are editorial, not measured.
Second-axis confidence: Moderate. Extra-work placement requires an actual correct fallback; F02 is a counterpressure. Same fresh agent produced both maps, so they are internally correlated.
Orthogonality: Useful four-region contrast: inspectable semantic facts and missing optimization machinery occupy both off-diagonal regions. A usable fact always presumes a consumer; missing admission machinery is not hidden by the left pole.
```

The F02 point sits just above the semantic watershed: a producer that omits
opaque effects cannot claim the conservative-fallback premise simply because
the registry can handle unknown dependencies. It remains an outlier from the
initial dependency-inventory cluster; its plotted position now reflects the
current correctness risk. F07/F06 are upper-left only under their explicit
existing-behavior premise. F11 plots the missing-check slice; existing authored
checks can instead be inspected. F09 plots coalescing, not all of Relay's contract.

### Map B — How far must the law reach?

[Interactive HTML](frames/law-scope.html) · [JSON source](frames/law-scope.json)
· [ASCII](frames/law-scope.txt) · [SVG fallback](frames/law-scope.svg)

```text
How far must the law reach?
Conceptual projection by the unit of obligation and its temporal reach. The law,
not file count, determines placement. This tests why a local fact may not entail an
end-to-end conclusion.

                        Temporal reach: history of changes
                                         ^
+----------------------------------------+----------------------------------------+
|Threads                                 |Conversations                           |
|[1] F16 Stable object targeting         |[3] F14 Ack includes effects            |
|[2] F15 Scoped deduplication            |[4] F17 Active-session revocation       |
|                                        |+ 1 more below                          |
Law's unit: one logical unit <- +----------------------------------------+----------------------------------------+ -> Law's unit: linked participants
|Specimens                               |Assemblies                              |
|[6] F08 Lossy key conversion            |[7] F06 Transaction handle flow         |
|                                        |[8] F12 One logical snapshot            |
|                                        |                                        |
+----------------------------------------+----------------------------------------+
                                         v
                     Temporal reach: one boundary or execution

Placements (normalized x, y):
[1] F16 Stable object targeting (0.20, 0.83) - category: Source claim; why plotted: Prototype: same object remains the target while list positions change.; source claim; F16; audits/queries.md Q21 - Stronger temporal claim than preserving a key in one serialized result.
[2] F15 Scoped deduplication (0.43, 0.67) - category: Source claim; why plotted: Boundary case: single-service repeat tolerance can widen into a cross-participant claim.; source claim; F15; audits/protocol.md P18c/P23d; audits/queries.md Q20 - Single-service scope is the plotted transfer hypothesis. Atomicity, retention, and effect domains need evidence. This does not authorize retries.
[3] F14 Ack includes effects (0.84, 0.84) - category: Source claim; why plotted: Prototype: client settlement depends on causal correspondence across histories.; source claim; F14; audits/protocol.md P12b/P17a; 02-research-survey.md C11 - Source contract/example; replication and rebase remain outside Endpoints scope. A row ID may not identify an operation.
[4] F17 Active-session revocation (0.72, 0.66) - category: Source claim; why plotted: Different history law: a later policy change needs a response from active consumers.; source claim; F17; audits/protocol.md P26b; 02-research-survey.md C18 - An entry-time check does not itself create a disconnect or revalidation path.
[5] F18 Deployment applicability (0.54, 0.53) - category: Source claim; why plotted: Meta-level outlier: applicability of evidence has its own changing premises.; source claim; F18; 02-research-survey.md C19; audits/language.md L27b - Near both watersheds. Source hash, mutable name, configuration, and database authority are distinct bindings.
[6] F08 Lossy key conversion (0.21, 0.22) - category: Generated example; why plotted: Prototype: an exact value relation can fail within one transfer.; generated example; F08; 03-ground-condition.md G5; 02-research-survey.md E4 - An encode/decode pair is one logical value law here; injectivity and ordering remain separate requirements.
[7] F06 Transaction handle flow (0.75, 0.20) - category: Generated example; why plotted: Prototype: a local-looking call joins multiple effect participants.; generated example; F06; 03-ground-condition.md G4; 02-research-survey.md E3 - The observation boundary is one transaction execution. Inspection does not add rollback to an escaped participant.
[8] F12 One logical snapshot (0.86, 0.38) - category: Source claim; why plotted: Counterexample to equating composition with missing knowledge: an executor may still be needed.; source claim; F12; 02-research-survey.md C4/C5; audits/queries.md Q07 - The contract joins reads within one logical execution. A transaction contains internal events; this axis is observational scope, not event count.

Calibration:
Axis claim type: Conceptual. Framework contracts and generated cases are distinct provenance categories. Coordinates express claim scope, not measured participant counts or durations.
Second-axis confidence: Moderate. The observational boundary must be explicit: transactions contain histories and transfers have two ends. Both candidate maps share one fresh agent context.
Orthogonality: Useful off-diagonal cases: stable object targeting is a one-unit history; transaction participation joins several parts within one execution. More history often adds participants, creating diagonal pull. F18 deliberately tests the broader evidence-applicability reading.
```

F15 is near the participant watershed because single-service duplicate handling
and a claim including a remote effect have different premises. F18 sits near
both lines because one pinned implementation can become a changing deployment
relationship; its meta-level role tests whether the map has stretched too far.
F06 and F12 share a region although different amounts of machinery may be missing.

## 6. Calibration and controls

**Source limits and confidence.** This pass reuses bounded primary-source
research and constructed cases. Vendor contracts, historical language results,
adapter examples, local source observations, and transfer hypotheses have not
been merged into one evidential grade. Confidence is moderate in each second
axis as an explanatory distinction; neither estimates guarantee prevalence,
certification accuracy, implementation effort, or production safety.

**Continuity, overlap, and movement.** Regions are centers of gravity. F06 moves
from inspectable participation to missing behavior when its global connection
is discovered; adding an authored transaction participant can move it back.
F03 becomes temporally wider when the API returns a job acknowledgment. F15's
unit widens when the claimed domains include external effects. F18's applicability
changes when code, configuration, hooks, authority, or deployment routing change.
Movement reflects a changed claim or premise, not an agent making a property true
by asserting it.

**Orthogonality.** A has four positive cases but hides a dependency: a useful
fact always needs a consumer. Its left pole presumes that consumer behavior
already exists or separately names the remaining admission work. B has useful
off-diagonal cases but participant count and history length can grow together.
Neither map establishes statistical independence or an exhaustive ontology.

**Missing dimensions.** Both omit evidence method (source trace, deterministic
check, finite exhaustive check, sampled test, manual certification); assumption
closure and invalidation; effect domain and database authority; relational
upper bound versus exact semantic equality; policy intent; soundness of the
consumer; support/coverage of SQL and TS syntax; production data and concurrency;
reversibility and cost of a wrong claim; and priority for the current product.
Those dimensions belong in the detailed catalog and eventual claim records,
not implicitly in a point's location. Unrelated external writes and new sync
engines remain outside scope.

**Compiler and agent control.** Ordinary TS/SQL analysis should establish facts
it can derive, including available build-time PostgreSQL catalog/EXPLAIN facts.
Nothing in these maps makes a visible SQL relation or supported handle-flow
analysis an agent-only task. Opaque helper/remote behavior may need further
source access, a deterministic check, or scoped manual certification. A remote
name or generic HTTP signature is not that evidence. The current skipped-call
gap and the absent general admission/invalidation system remain explicit.

**Consumer control.** Auth is always authored. Evidence may inspect a policy's
coverage, input provenance, or placement, but the compiler must never insert it.
PG-no-write facts cannot authorize repeating charges or messages. No mutation
queue, blind mutation retry, or new replication protocol follows from any cell.
A broad complete footprint can be useful without an exact branch theorem;
completion and failure behavior still need their own claims. Sampled optimism
checks remain tests under an explicit state/input/comparison law.

**Judging tests.** Cluster precedence is recorded above; both partitions were
formed from the inventory before their separators and final names. All four
regions in each map have concrete diagnostic cases. Labels retain concrete
members without special pleading only when the plotted claim slice is kept
visible. The maps clarify two sources of the argument—missing knowledge versus
missing behavior, and local facts versus wider conclusions—but do not settle
the evidence design or choose guarantees to implement. No winner is selected.

**Stop condition.** This bounded pass stops after two controlled projections.
The frames expose useful probe shapes without running them: hold the effect
set fixed while varying completion; hold a helper's local law fixed while
changing its consumer scope. These are instrument readouts, not a new work plan.
