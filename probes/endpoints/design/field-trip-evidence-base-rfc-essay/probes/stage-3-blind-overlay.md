# Stage 3 Blind Cartography overlay

## Sampling record

The independent source map froze before any expectation output was dispatched or read. Three fresh probes then saw only their assigned prompt variant and stratum from [`stage-3-blind-plan.md`](stage-3-blind-plan.md):

| Probe | Prompt variant | Stratum | Raw trace | Hypotheses |
|---|---|---|---|---:|
| `BC-01` | A, direct | system model | [`stage-3-blind-BC-01.md`](stage-3-blind-BC-01.md) | 6 |
| `BC-02` | B, reordered | operational use | [`stage-3-blind-BC-02.md`](stage-3-blind-BC-02.md) | 6 |
| `BC-03` | C, question-led | explanatory form | [`stage-3-blind-BC-03.md`](stage-3-blind-BC-03.md) | 6 |

The 18 hypotheses share model lineage and are correlated. Counts describe what this sampling setup readily reconstructed. They are not probability, public opinion, truth, quality, or historical novelty.

## Expected basins

A hypothesis may belong to more than one semantic basin, so counts do not sum to 18.

| Basin | Exact members | Count and prompt spread | Reading |
|---|---|---|---|
| `B-ARCH` — reusable core and component/extension contracts | `BC-01-A`, `BC-02-E`, `BC-03-A` | 3; A/B/C; all three strata | **Deep groove.** A reusable core separated from storage, domain packages, and interface adapters recurred in every prompt form. |
| `B-SEM` — canonical semantic evidence model | `BC-01-B`, `BC-03-C` | 2; A/C; system and explanatory strata | **Deep groove with narrower spread.** Entities, identities, provenance links, and relations recurred in two prompt forms and strata. |
| `B-AUTH` — authority, provenance, and conflict regime | `BC-01-C`, `BC-02-D`, `BC-03-D` | 3; A/B/C; all three strata | **Deep groove.** Each probe proposed explicit authority/provenance semantics and conflict handling. |
| `B-LIFE` — lifecycle and state transitions | `BC-01-D`, `BC-02-A`, `BC-03-B` | 3; A/B/C; all three strata | **Deep groove.** Intake/change/staleness/supersession/deprecation histories recurred in every prompt form. |
| `B-IFACE` — one semantic core projected across CLI/editor/protocol | `BC-01-E`, `BC-02-B`, `BC-03-A` | 3; A/B/C; all three strata | **Deep groove.** Capability parity plus interface-specific interaction and errors recurred in every prompt form. |
| `B-WORK` — agent workflow journeys | `BC-02-C`, `BC-03-E` | 2; B/C; operational and explanatory strata | **Local groove.** Discovery, inspection, citation, update, reconciliation, and recovery appeared only outside the system-model stratum. |
| `B-DECIDE` — decision inventory and staged implementation | `BC-01-F`, `BC-02-F`, `BC-03-F` | 3; A/B/C; all three strata | **Deep groove.** Each probe produced an open-decision or staged-implementation frame. |
| `B-EXAMPLE` — one domain package as core/extension exercise | `BC-01-F`, `BC-02-E`, `BC-03-A`–`F` | 8; A=1, B=1, C=6 | **Stratum-amplified local groove.** It appears across variants, but six of eight instances come from the explanatory-form assignment, so recurrence is not treated as independent confirmation. |

## Source-backed versions of the basins

- `B-ARCH`: the source version is not a generic modular platform. `ESS-S01` and `RFC-C01` separate base mechanics, domain semantics, authoring workflows, consumer policy, and adapters while `ESS-TOPO-04` says a stable deployable extension API is still missing.
- `B-SEM`: the source version has six provisional primitives plus AND/OR argument routes, challenge/replay relations, demoted runs/tasks, and explicit unresolved questions (`ESS-S02/S03`, `RFC-C02`). It does not supply deterministic semantic equivalence.
- `B-AUTH`: the source version separates law ownership, source anchoring, runner observation, assessment, persistence, and consumer enforcement (`RFC-C03`) rather than selecting a generic confidence or precedence lattice.
- `B-LIFE`: the source version is observation → challenge → causally later exact replay → historically retained but possibly expired resolution authority (`ESS-S04`, `RFC-C02`), not the generic publication/deprecation lifecycle reconstructed by the blind probes.
- `B-IFACE`: the source version has one shared serialized service and locally tested CLI/LSP/MCP adapters (`ESS-S09`) plus public-contract compression (`RFC-C04`); adapter agreement is explicitly not independent corroboration.
- `B-WORK`: the source supports three draft authoring procedures—design, maintain, repair—and an Oracle portfolio discipline (`ESS-S06/S08`, `RFC-C07`). It does not establish broad agent journey coverage or workflow effectiveness.
- `B-DECIDE`: the source supports an open applicability decision (`RFC-C05`), policy boundaries (`RFC-C08`), conservative implementation choices, and present-state gaps. It does not support a phased roadmap or implementation order.
- `B-EXAMPLE`: the source supplies the bounded Endpoints check and pass/fail/unresolved scene (`RFC-C09/C13`), but explicitly denies that it validates generality or production readiness.

## Candidate overlay

| Candidate | Atlas position | What the overlay shows |
|---|---|---|
| `RFC-C01` | deep groove: `B-ARCH`, with `B-IFACE` overlap | The layered system frame is highly reconstructible. Its source-specific residue is the explicit separation of consumer policy and authoring workflows plus the missing stable extension API. |
| `RFC-C02` | deep groove: `B-LIFE` | Lifecycle is expected; the AND/OR route structure, persistent challenges, invocation-relative exact replay, and expiring resolution authority are source-specific mechanisms at collapse risk. |
| `RFC-C03` | deep groove: `B-AUTH` | Authority/provenance is expected. The accepted-control transition, non-impersonable runner observation, durable contradiction reporting, and real-consumer enforcement boundary are source-specific understory. |
| `RFC-C04` | deep groove: `B-IFACE` | Cross-interface parity is expected. The distinction between invocation, prose visibility, opaque runtime output, and agent-operable grammar objects is source-specific; a generic capability matrix may erase it. |
| `RFC-C05` | **source-specific understory** | No blind probe separated applicability ownership from result cardinality or preserved rule-owned explicit unknown versus base-owned boolean exact matching. |
| `RFC-C06` | **source-specific understory** | No blind probe made Field Log → grammar → implementation → interface reduction loss, status preservation, or same-analyst control the subject. |
| `RFC-C07` | local/deep overlap: `B-WORK`, `B-LIFE` | Workflows are expected, but the Oracle law/domain/reference/path/checkpoint/reach/sensitivity/replay portfolio and the unmeasured agent-efficacy status are source-specific. |
| `RFC-C08` | **source-specific understory** adjacent to `B-AUTH` | Blind authority candidates readily introduce confidence and conflict policy. None preserved the source's three-plane split among support, severity, and permission with all policy values left open. |
| `RFC-C09` | deep/local overlap: `B-IFACE`, `B-EXAMPLE` | A worked package across interfaces is reconstructible. The exact safe-skip law, supplied-summary fixture, three outcomes, one shared service, and consumer-policy stopping point are source-specific. |
| `RFC-C10` | **source-specific understory** | No blind hypothesis chose executable failure witnesses as the organizing form or recovered the four exact freshness/replay/reach counterexamples. |
| `RFC-C11` | **source-specific understory** adjacent to `B-DECIDE` | Blind probes proposed staged plans and lifecycle models, not an architecture explained through witnessed failed rules and repair constraints. |
| `RFC-C12` | **atlas residual / source-specific understory** adjacent to `B-ARCH` | Modular boundaries are expected; a negative-space account that distinguishes principled refusal, conservative prototype boundary, unresolved theory, and unfinished work did not recur. |
| `RFC-C13` | local groove: `B-EXAMPLE` | A worked example is expected and prompt-sensitive. Colocating what the fixture supplied, what the base computed, and what remains unproved is the source-specific boundary discipline. |

## Collapse risks exposed by the overlay

1. `RFC-C02` can collapse into a generic intake/validation/deprecation state machine, losing argument routes, challenge retention, exact replay causality, and current-versus-historical authority.
2. `RFC-C03` can collapse into a confidence or authority lattice, transferring judgment to the base and obscuring runner, accepted-control, and real-consumer boundaries.
3. `RFC-C04` can collapse into transport-parity documentation, hiding shared-path correlation and the difference between named, opaque, and manipulable semantics.
4. `RFC-C05` can collapse into generic identity or freshness configuration, erasing the separate ownership/cardinality question and explicit unknown.
5. `RFC-C06` can disappear into a conventional implementation-state table, losing the audit of what each reduction erased.
6. `RFC-C07` can collapse into happy-path agent journeys, losing oracle reach, sensitivity, replay, failure provenance, and unmeasured efficacy.
7. `RFC-C08` can collapse into generic confidence/conflict policy, contrary to the source's separation and unresolved policy.
8. `RFC-C11` can collapse into a staged roadmap, replacing witnessed repair causality with a forward implementation sequence the sources do not supply.
9. `RFC-C12` can collapse into clean modularity, making unfinished work look like deliberate refusal.
10. `RFC-C13` can turn the worked package into the normative extension contract or generality evidence.

## Atlas-induced residuals

The overlay prompted a bounded re-scan of the already frozen input ledger and source map; it did not reopen source research.

- `AIR-01` — **source-backed semantic-model form outside the frozen candidate count:** `ESS-S02/S03` could support a standalone concept-led account of the six primitives, five relations, ten rules, overlaps, and demotions. `B-SEM` made the absence visible. This is not added to `RFC-C01`–`C13`; a later map expansion would be required.
- `AIR-02` — **source-backed gap rather than candidate:** `B-ARCH` and `BC-02-E` assume an extension contract, while `ESS-TOPO-04` says no stable packaged extension API currently makes the ownership layers deployable. The gap cannot support a positive “extensible platform” candidate.
- `AIR-03` — **atlas-only roadmap move:** `B-DECIDE` repeatedly proposes phased delivery, but the frozen corpus supplies present state, open decisions, and tests—not an authorized implementation sequence. It remains an expectation basin, not source-backed content.

## Borders, holes, and stop

- The border between `B-SEM` and `B-ARCH` could change with another system-model replicate; the initial map may undercount a standalone semantic-core form.
- The border between `B-WORK` and `B-LIFE` could change with another operational replicate; the current sample cannot show whether workflow journeys recur independently of lifecycle framing.
- `B-EXAMPLE` is highly sensitive to the explanatory-form assignment, so its count cannot support a general recurrence claim.
- No probe sampled a secondary audience, publication target, alternative model family, exact-prompt replicate, human-versus-agent reader, hostile environment, large graph, or concurrent-writer stratum.
- A further probe could refine recurrence labels but would not change source support or validate a candidate. The initial predeclared three-probe budget therefore stops here.

## Controls, distortion, and unmeasured remainder

Prompt variants preserved task, reader, evidence standard, and output fields, while coordinate assignments changed the intended stratum. No adaptive prompt was introduced. Shared model lineage, one probe per variant, and stratum-induced emphasis prevent independence or population claims. The neutral label itself foregrounded three interfaces and one worked package, increasing the chance of `B-IFACE` and `B-EXAMPLE`. The overlay may favor source candidates that differ from model defaults and give rarity an unwarranted value; no atlas label is a recommendation or novelty result.

The source map remains frozen at 13 candidates. `AIR-01`–`AIR-03` are overlay residuals only. No candidate has been ranked, validated, selected, or rejected by recurrence.
