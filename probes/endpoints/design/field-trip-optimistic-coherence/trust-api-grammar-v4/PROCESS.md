# Process — TanStack Trust API Design Grammar v4

## Run provenance

- **Field Log run:** 61
- **Instrument:** Design Grammar
- **Mode:** exact equivalence
- **Frozen preservation:** v4, Field Log event 1044
- **Extraction target:** the TypeScript authoring and lifecycle API for Trust
  inside Endpoints, including code-package/project-local extension and its
  TypeScript, CLI, LSP, MCP, Devtools, and work projections
- **Range:** untested beyond Endpoints
- **Superseded run:** run 60 stopped before analytical extraction because the
  post-freeze rule-extension requirement changed the target

## Candidate admission and rejection

| Candidate | Decision | Reason |
|---|---|---|
| Entity reference/envelope | admit M01 | Required for cross-interface identity, immutable history, and versioning |
| Trust module | admit M02 | Package and project-local definitions must be discoverable as ordinary code |
| Project configuration | admit M03 | Installed, enabled, configured, and admitted are independently variable |
| Claim definition | admit M04 | Obligations must exist before observations |
| Route/use | admit M05 | Preserves alternate routes and joint premises |
| Evidence method | admit M06 | Method identity, coverage, calibration, schema, and admission are independently consequential |
| Observation | admit M07 | Prevents run success, work, or provenance from standing in for evidence |
| Context/use/applicability | admit M08 | One observation can apply differently across uses and revisions |
| Operation record | admit M09 | Commands need transactional delivery, reach, cancellation, validation, and commit semantics |
| Challenge/repair | admit M10 | Preserves counterexamples and causal repair obligations |
| Admission | admit M11 | Proposal, authorship, execution, and authority must remain separate |
| Policy/override | admit M12 | Required for severity, CI action, temporary downgrade, and pure comparison |
| Monolithic stored `Rule` | reject as primitive | Convenient authoring bundle, but erases claim/route/method/admission boundaries |
| `TrustRule` authoring pattern | retain as pattern | Satisfies linter-style extension while lowering to admitted primitives |
| Generic confidence | reject | No lawful cross-method scale; typed probabilities remain method outputs |
| Adapter-specific status models | reject | Duplicate X02 and allow semantic drift |
| Work `validates` edge | reject | Lets a coordination relation masquerade as support |
| Conventional disappearing suppression | reject | Erases condition and authority/expiry trail |
| `passed` compatibility state | reject | Compresses reach, observation, applicability, challenge, and policy |

## Reconstruction

### UC01 — Editor repair loop

1. M03 resolves the active rule modules for the edited source.
2. X01 evaluates M04/M05 using M07/M08/M10/M11 and derives X02.
3. X04 projects the condition into a stable linter-style LSP diagnostic.
4. The diagnostic's typed action opens X01 explanation or X03 work through MCP.
5. The agent claims X03, invokes an admitted M06 through M09, and atomically
   submits M07.
6. A new X06 snapshot recomputes X01/X02 and confirms whether the diagnostic is
   gone, changed, or still blocked.

**Result:** pass. Work closure alone cannot clear the diagnostic.

### UC02 — Scheduled expired-evidence renewal

1. M08 detects a changed dependency/configuration revision or domain expiry.
2. X02 creates an expired/stale condition and X03 exposes claimable work.
3. A daily agent queries ready work, uses versioned claim/lease/note operations,
   runs M06, and commits M07.
4. Remaining repository changes and a PR are external workflow outputs; their
   existence is not evidence.

**Result:** pass. Evidence freshness and work leases use different clocks.

### UC03 — CI gate

1. CLI requests X06 without running hidden checks.
2. X05 evaluates the named M12 profile and active overrides at that snapshot.
3. Human and JSON output retain conditions, evidence limits, config revision,
   override provenance, and a deterministic exit/deployment action.

**Result:** pass. Severity and exit code do not change evidence.

### UC04 — Devtools live state

1. Devtools loads X06 containing definitions, configuration, evidence,
   conditions, work, admission, and policy.
2. It follows the cursor and requests X01 explanations for drill-down.

**Result:** pass. No adapter-specific status model is required.

### UC05 — Temporary endpoint downgrade

1. An authorized M12 override names the endpoint, profile change, rationale,
   authority, start, and expiry.
2. X05 changes deployment action while X01/X02 and M07 remain visible and
   unchanged.

**Result:** pass. A suppression is an action exception, not favorable evidence.

### UC06 — Preview stricter global checks

1. One X06 snapshot is evaluated under current and proposed M03/M12 inputs.
2. The pure comparison returns newly active claims, newly required methods,
   current evidence reuse, new conditions, and resulting work.

**Result:** pass. Preview has no mutation or hidden check execution.

### UC07 — Install, enable, and locally extend rules

1. A package exports M02 with `defineRule` bundles; the project exports another
   M02 from local code.
2. M03 selects both and explicitly enables/configures their rules.
3. M11 determines which semantic versions are admitted; project-local authorship
   does not bypass admission.
4. Capability/schema discovery lets MCP and Devtools show the resolved rule set.

**Result:** pass. Removing M02, M03, or M11 collapses a required distinction.

### UC08 — Typed probabilistic evidence evaluator

1. An admitted M06 declares its decision algebra, schema, evaluator version,
   input contract, calibration record, coverage, omissions, and reach witness.
2. M09 runs it and M07 records the full distribution and exact context.
3. M08 determines applicability; domain semantics in X01 determine what the
   result supports; X05 decides consumer action.
4. A low-confidence or out-of-range result becomes a typed condition or
   unresolved obligation, not malformed prose and not automatic authority.

**Result:** pass. Schema conformance alone cannot support the claim.

## Component ablation

| Removed | Reconstruction or exclusion failure | Disposition |
|---|---|---|
| M01 refs | Adapters, history, diagnostics, config, and work cannot address the same versioned object | keep |
| M02 module | Packaged/local extension and capability discovery disappear | keep |
| M03 config | Installed becomes indistinguishable from enabled; UC06/UC07 fail | keep |
| M04 claim | Evidence can define the obligation it purports to support | keep |
| M05 route/use | AND/OR logic and per-use applicability flatten | keep |
| M06 method | Check/evaluator identity, coverage, calibration, and admission become opaque | keep |
| M07 observation | Operation success or work output must stand in for evidence | keep |
| M08 context/use/applicability | Old or irrelevant evidence stays current across uses and revisions | keep |
| M09 operation | Persistent traces must impersonate command delivery, reach, and commit | keep |
| M10 challenge/repair | Later passes can erase counterexamples without causal repair | keep |
| M11 admission | Agents, package install, or schema validity can authorize semantic roots | keep |
| M12 policy/override | CI action and endpoint downgrade must rewrite evidence or be reimplemented by adapters | keep |
| X01 assessment/explanation | No policy-free account of support and remaining obligations | keep |
| X02 condition | LSP, work, CI, and Devtools invent separate failure taxonomies | keep |
| X03 work | Scheduled multi-agent coordination, leases, notes, blockers, and guarded closure disappear | keep |
| X04 diagnostic | Source-local lint interaction and typed fixes disappear, though semantics survive | keep as projection |
| X05 policy evaluation | Severity, exit, fallback, and compare collapse into assessment | keep |
| X06 snapshot/cursor | CI and Devtools assemble mixed configuration/evidence/policy versions | keep |
| `TrustRule` pattern | Semantic model survives, but easy package/local authoring requirement fails | keep as authoring pattern |

No retained item can be removed without breaking a frozen property, use case,
active overlap, or negative exclusion. `TrustRule` is the sole retained unit
whose necessity is ergonomic rather than semantic; it is labeled as a pattern
and lowers to semantic units.

## Compression

The v4 account adds M02/M03 and promotes M06 because the new requirements make
module distribution, project enablement, and evaluator identity independently
consequential. It removes no v2 semantic distinction. It rejects separate CLI,
LSP, MCP, Devtools, and task status types in favor of X02/X06. It also rejects
a monolithic linter rule as stored truth: the bundle survives only at the
authoring boundary.

Among accounts with equal reconstruction coverage, this is shorter than:

- one semantic state model per adapter;
- one evidence status per linter severity;
- a plugin registry that conflates install, enable, and admission;
- a universal `score` attached to every observation; or
- a task graph whose closure changes claim support.

## Range, dynamics, constraints, and boundary conditions

**Dynamics:** discover modules; resolve project configuration; propose and admit
definitions; run methods; atomically append observations; assess evidence uses;
derive conditions; coordinate work; challenge and repair; evaluate or compare
profiles; activate or expire scoped overrides; read coherent snapshots and
changes.

**Constraints:** R01–R18 in `MODEL.md`.

**Boundary conditions:** Endpoints is the sole implementation and illustrative
consumer; finite local evidence campaigns; current prototype uses repository
files and single-process serialization; no production package loader,
multi-writer coordination, hostile-process security, signatures, sandboxing, or
remote execution has been chosen.

**Range:** untested beyond Endpoints. Linter ecosystems shaped the extension and
presentation requirement and therefore are not held-out range evidence.

## Nearby negative cases

- **N01 — Task tracker as evidence:** closing or upvoting a work item causes a
  claim to become supported. Rejected by R11 and X03's guarded closure.
- **N02 — Disappearing lint suppression:** an inline disable removes a condition
  from all reports and allows “clean” without an authority, rationale, scope, or
  expiry record. Rejected by R13 and M12.
- **N03 — Self-authorizing model judge:** a schema-valid probabilistic evaluator
  declares its own calibration and admission and converts its score directly to
  semantic support. Rejected by M11 and R02/R08.

The donor negative controls remain active: durable traces do not replace
synchronous command transactions, and similar output does not prove the
authority path that produced it.

## Generation record

| Form | Transformation | Fixed interface/invariant | New option | Cost/loss |
|---|---|---|---|---|
| F01 linter-first facade | augment module/config surface | Lowering to M01–M12; R01–R18 | Easy package and local rule authoring | Can conceal semantic parts and mutation boundary |
| F02 resource service | split query from command and group resources | X01/X02/X06 semantics and receipts | Idiomatic typed lifecycle access | Verbose for rule authors |
| F03 operation protocol | substitute discriminated wire schema | Same operation and result algebra | Generated agents/adapters and capability negotiation | Least idiomatic direct TS surface |

No additional form survived. Variants that only renamed `rules` as `checks`,
split one method into more fields, or changed the config file syntax were merged
as cosmetic.

## Unresolved rule conflicts

- **C01:** Applicability may be entirely domain-owned or combine a Trust
  structural matcher with domain hooks.
- **C02:** Project configuration may activate already admitted definitions
  directly or require a project-scoped admission record.
- **C03:** A rule-wide `off` is clearly configuration and a deployment exception
  is policy; the exact classification of a source-local suppression remains open.
- **C04:** Domain adequacy thresholds and consumer action thresholds may both
  consume probabilities; their exact boundary needs explicit examples.
- **C05:** Admission may use code review, signed manifests, a local authority
  file, or another project-owned mechanism.
- **C06:** Operational failures must remain discoverable, but their durable home
  relative to the evidence ledger remains open.
- **C07:** Change delivery may use polling, subscription, or an event stream if
  snapshot/cursor semantics hold.
- **C08:** F01, F02, and F03 may be alternatives or layers; no priority is selected.
- **C09:** Endpoints must still choose named rule levels, required claim sets,
  downgrade authority, and default expiry/review rules.
- **C10:** The loader/sandbox boundary for third-party executable methods is
  outside this grammar but becomes security-critical before extraction from the
  Endpoints repository.

No priority was invented for these conflicts.

## Injected structure and decomposition loss

The analyst introduced `TrustModule`, `ProjectTrustConfig`, first-class
`EvidenceMethod`, lowering from an authored `TrustRule`, and the distinction
between project disablement and scoped policy suppression. Reconstruction and
ablation support them, but they remain proposed design structure.

Decomposition loses the RFC's narrative texture, exact prototype storage
schema, current CLI spellings, present MCP tool count, LSP severity defaults,
canonical JSON algorithm, bundler/loader implementation, config syntax,
admission topology, calibration metric, queue implementation, and UI layout.
It also loses the biological and institutional particulars of the donors. Those
sources constrain relations and failures; their forms are not copied.

## Frozen analysis

Model, Evidence, and Process version `trust-api-grammar-v4.analysis-1` freezes
M01–M12, X01–X06, O01–O09, R01–R18, F01–F03, N01–N03, UC01–UC08, C01–C10,
the source map, and the stated losses. The primary brief may select, order, and
translate these items but may not add new structure or choose an unresolved
priority.

## Brief support map

| Brief claim | Frozen support |
|---|---|
| Trust is linter-shaped without reducing trust to a lint result | M02–M12, `TrustRule`, R01–R05, E-O07, E-I02 |
| Authored rules lower into independently identifiable semantic units | M04–M06, O02, R04, UC07 |
| One policy-free condition projects across every adapter | X02–X06, O05–O09, R14–R16, E-I04 |
| Installed, enabled, admitted, and action-permitted are separate | M02/M03/M11/M12, O01, R02/R03, UC07 |
| Check execution is a command while report and comparison are queries | M09, X05/X06, R12/R16, E-I06 |
| Typed model output remains method-specific evidence, not truth or authority | M06–M08/M11, R07/R08, UC08, N03 |
| Disablement and temporary suppression cannot rewrite evidence | M03/M12, R13, UC05, N02 |
| Three API forms remain unranked and range remains Endpoints-only | F01–F03, C08, range record |
| Editor, daily renewal, CI, and downgrade examples are reconstructable | UC01–UC06 |
