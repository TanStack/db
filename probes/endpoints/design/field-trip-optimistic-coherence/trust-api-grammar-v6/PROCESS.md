# Process — TanStack Trust API Design Grammar v6

## Run boundary

- **Instrument:** Design Grammar, run 65.
- **Mode:** exact equivalence.
- **Extraction target:** the TypeScript and agent-interface language for the
  layered Trust kernel, PostgreSQL substrate, Endpoints domain, independent
  evidence providers, project requirements/policy and shared interfaces.
- **Source freeze:** Field Log through event 1088 plus the specific local files
  enumerated in `EVIDENCE.md`.
- **Preservation freeze:** the user confirmed P1–P12 with “yes, looks good” at
  Field Log event 1089.

The analytical state in `MODEL.md`, `EVIDENCE.md` and this file was completed
before `BRIEF.md` was drafted.

## Observation and inference ledger

| ID | Kind | Reading | Support |
|---|---|---|---|
| G-O01 | observation | Endpoints already compiles PostgreSQL catalog and TypeScript/Drizzle inputs into statement/effect/dependency structures. | G-E07 |
| G-O02 | observation | `canSkipRefetch` consumes those structures plus runtime authority and returns `skip`, `refresh` or `unknown`. | G-E08 |
| G-O03 | observation | The evidence prototype turns the result into pass/fail/unresolved observations with dependency invalidation and challenge history. | G-E06, G-E08, G-E09 |
| G-O04 | observation | CLI, LSP and MCP currently share one service, although the interfaces are prototype-shaped and incomplete. | G-E06, rerun controls |
| G-O05 | observation | Six v5 simulations recovered semantic distinctions but invented operation schemas, joins, action bindings and authority-bearing fields. | G-E03 |
| G-O06 | user requirement | PostgreSQL should be reusable beneath Endpoints, and Neon should be able to add production evidence over PostgreSQL subjects. | Field Log comments 323–325 |
| G-O07 | user requirement | Checks should remain packageable, easy to enable/disable and easy to write locally, without making lint the semantic center. | Field Log comments 322 and preceding linter discussion |
| G-O08 | user requirement | Agents need editor repair, scheduled renewal, CI, Devtools, scoped deployment downgrade and stricter-policy preview workflows. | Field Log comments 319–325 and v5 workflow files |
| G-I01 | inference | A stable cross-protocol relation is required; nesting or copying PostgreSQL evidence into Endpoints would destroy provider independence. | P2, P4, G-O06 |
| G-I02 | inference | Compiler-published domain facts must be distinct from evidence that satisfies a requirement; otherwise any compiler output becomes self-authorizing. | P3, P5, G-O01–G-O03 |
| G-I03 | inference | A simple check can lower to the v5 proof graph without exposing that graph to ordinary authors. | P9, G-O05, preserved v5 semantics |
| G-I04 | inference | Action descriptors must bind directly to operation descriptors to remove the guessing seen in all six simulations. | G-O05, P11 |
| G-I05 | inference | Source annotations and project config form an active overlap whose safe merge is additive/stricter by default. | P7 and scoped-downgrade use case |

## Candidate admission and rejection

### Admitted candidates

G-P01–G-P10 in `MODEL.md` were admitted because each reconstructs a preserved
relation, changes a legal transformation or blocks a negative case.

### Rejected or demoted candidates

| Candidate | Disposition | Reason |
|---|---|---|
| `Rule` as the central primitive | demoted to authoring bundle | It combines requirement, evidence contract, qualification, messages and actions that have different owners and lifetimes. |
| Claim, premise and route as mandatory public authoring | retained only in lowered IR | Required for exact arguments, but v5 showed that forcing every author through them adds ceremony without preserving more meaning in simple checks. |
| Provider as owner of the target subject | rejected | A Neon method must operate over PostgreSQL subjects without redefining them. |
| Source annotation as a primitive | demoted to config input | Its behavior is fully accounted for by source mapping plus requirement-fragment lowering. |
| Todo as evidence | rejected | It coordinates work but cannot support a requirement; accepting it admits the stigmergic false-positive path. |
| Severity as requirement state | rejected | The same condition may warn in development and block in CI. |
| Trust score | rejected | It erases domain claim, evidence method, applicability and policy differences. |
| Agent as a semantic primitive | rejected | Agents use operations and may produce proposals/evidence, but identity and authority are represented by authenticated capabilities. |
| LSP/MCP/CLI command as separate semantics | rejected | Transport-specific meaning recreates the v5 divergence risk; all project from G-P10. |

## Reconstruction control

### R1 — Existing Endpoints safe-skip behavior

1. The PostgreSQL-shaped compiler output becomes subjects and facts (G-P02,
   G-P04).
2. Endpoints links its query/mutation/decision subjects to the SQL operations
   (G-P03).
3. The compiler publishes a typed `safe-skip-refetch` evidence record (G-P06).
4. The requirement interprets `skip` as support, `refresh` as contradiction and
   `unknown` as inconclusive (G-P05, G-P07).
5. Dependency revisions determine current applicability (G-P07).
6. Conditions preserve missing, contradicted, unresolved and stale outcomes
   without choosing refresh policy (G-P08).

All seven observed result cases in `EVIDENCE.md` reconstruct without importing
a linter callback or provider-owned policy.

### R2 — Agent repairs an edited query

An LSP overlay publishes a versioned source context. The diagnostic binds its
subject, requirement, condition, snapshot and legal operations. The agent uses
`trust_explain`, lists or claims the associated todo, plans an admitted method,
gathers and atomically submits evidence, then reads the new snapshot. The edit,
todo and successful delivery never become evidence.

### R3 — Daily expiry renewal

Monotonic dependency or clock evaluation makes evidence stale. Trust reactivates
the condition and one deduplicated todo. A scheduled agent queries
`evidence.expired`, obtains a fenced lease, runs the named provider and closes
the work only after requalification. A PR may carry changed artifacts but is
outside the evidence relation.

### R4 — CI gate

`trust check --profile ci` evaluates policy over one pinned report. It performs
no hidden evidence run. The report and exit code derive from the same decision:
allow, valid block or unable to decide.

### R5 — Devtools inspection

Devtools bootstraps one snapshot and consumes cursor changes. It reads subjects,
relations, facts, requirement sources, evidence, qualification, conditions,
todos, admissions, policy and overrides without constructing a second state
model. Mixed snapshots force resynchronization.

### R6 — Temporary endpoint downgrade

The user previews a scoped expiring policy override. The preview returns
affected conditions and authority gaps but no deployment token. Creation changes
only the policy action; evidence and conditions remain visible. Deployment
requires a time- and snapshot-bound decision token.

### R7 — Stricter global level

A sealed config candidate resolves new requirement instances and reuses only
currently applicable evidence. The preview returns new conditions and todos but
does not mutate live histories. Source-local annotations cannot weaken the
candidate's global requirements.

### R8 — Neon production evidence

A PostgreSQL query subject exists independently of Endpoints. The project
activates a production-latency requirement and constrains acceptable evidence
to the admitted Neon method. An authorized plan fixes 30 executions, predicates,
environment, statement, dependencies and stopping rule. The atomic result can
be adequate but stale, current but inadequate, or current and adequate.

### R9 — Agent finds a new proof route

The agent submits a proposal referencing existing protocol subjects and a new
evidence contract or qualification. The proposal may create review work but no
support. Independent admission creates a new definition version; existing
evidence does not automatically map to it.

## Component ablation

| ID | Remove or merge | Reconstruction failure | Decision |
|---|---|---|---|
| G-A01 | remove Protocol | No stable foreign extension or compatibility boundary for PostgreSQL/Endpoints/Neon. | keep G-P01 |
| G-A02 | remove Subject | Evidence and requirements can target only source locations or labels; identity/history fail. | keep G-P02 |
| G-A03 | remove Relation | Endpoints must copy PostgreSQL facts/evidence or Neon must depend on Endpoints. P4 fails. | keep G-P03 |
| G-A04 | merge Fact into Evidence | Compiler knowledge can satisfy requirements merely by being published; P5 fails. | keep G-P04 |
| G-A05 | merge Requirement into Policy | Changing CI severity changes what is semantically established. | keep G-P05 |
| G-A06 | merge evidence contract, method and record | A provider owns the evidence meaning and a schema-valid result implies an authorized run. | keep G-P06 pattern |
| G-A07 | merge adequacy and applicability | Adequate-but-stale and current-but-inadequate become indistinguishable. | keep G-P07 |
| G-A08 | merge Condition and Todo | Work closure or lease state changes the semantic result. | keep their typed overlap inside G-P08 |
| G-A09 | remove retained trace | Daily renewal, causal repair, challenges and agent handoff cannot reconstruct. | keep G-P08 |
| G-A10 | merge Policy with qualification | An override can manufacture support and development/CI cannot share evidence state. | keep G-P09 |
| G-A11 | remove Operation descriptor | Interfaces invent inputs, errors and action routing as in v5 tests. | keep G-P10 |
| G-A12 | split operations per transport | Snapshot and authority semantics can diverge while names appear consistent. | keep one G-P10 registry |
| G-A13 | remove proposal/admission rule | Agent-discovered proofs are either impossible or self-authorizing. | keep G-D07 and G-C01 |
| G-A14 | remove source/config merge constraint | A local annotation can evade a global requirement; P7 fails. | keep G-C06 |

No surviving item could be removed, merged or demoted without breaking a frozen
property, reconstruction, legal transformation or negative case. This is a
minimum-description pruning result for this target, not a claim that reality
contains ten fundamental objects.

## Rule conflicts

| ID | Conflict | Resolution in this run |
|---|---|---|
| G-X01 | “Checks are ordinary packages” can suggest executable callbacks at read time, while domain compilers should publish structured output. | Package checks as definitions and compiler/method producers; pure reads consume persisted qualification. |
| G-X02 | A source-local requirement may be intended as ergonomic policy, but global requirements must not be weakened. | Source fragments may add or tighten; loosening requires a separately authorized policy/requirement exception. |
| G-X03 | Providers need freedom to add proof methods but cannot redefine foreign domain truth. | Providers implement typed evidence contracts; new contracts/qualifications enter as separately admitted extensions. |
| G-X04 | Models should discover proofs, yet self-admission is prohibited. | Proposals are first-class and queryable; admission remains an independent command. |

No unresolved rule priority was needed to generate the model. Exact authority
provider, security topology and package names remain boundary conditions rather
than unstated design choices.

## Range and negative controls

No independently sourced marginal domain was supplied. Range is therefore
untested. Standalone PostgreSQL and Neon cannot be used as range cases because
they helped form the grammar.

The sourced near-negative is ESLint. The grammar does not generate an ordinary
lint rule that directly emits severity/fixes without evidence history,
applicability or policy separation. Two conceptual negatives—a universal agent
score and a self-authorizing proof loop—are also excluded, but they are not
empirical range tests.

## Adjacent-form generation

- **G-F01** uses modular substitution: swap the SQL-library adapter while
  preserving PostgreSQL contracts.
- **G-F02** uses modular augmentation: add another execution-profile provider.
- **G-F03** uses pattern unfolding: discover, propose and independently admit a
  new proof route.

The three forms exercise different boundaries. Cosmetic config-field variants
and additional providers with the same transformation were omitted.

## Injected structure and likely distortion

The extraction introduces the names **Protocol**, **Fact**, **Requirement** and
**Qualification** and makes a ten-part model from code and prose that did not
already expose those exact boundaries. The protocol graph may over-regularize
what will initially be one Endpoints implementation. The clean lowering story
may hide difficult TypeScript inference, version migration and provider
security. Treating model proposals as a supported path may also make future
proof discovery appear more orderly than it will be in practice.

Conversely, using compiler batches as the center may understate interactive,
long-running or institutionally reviewed evidence that is not naturally
compiler-shaped. These distortions are retained as limits, not patched with new
primitives.

## Brief support map

| Brief claim | Model support | Evidence support |
|---|---|---|
| Trust is a protocol runtime around domain compilers rather than a linter engine. | G-P01–G-P07, G-X01 | G-E01, G-E04, G-E07, G-E10 |
| PostgreSQL facts can be reused by Endpoints and foreign providers. | G-P03/G-P04, overlap 1 | G-E07 plus user requirement G-O06 |
| Requirements and evidence remain independently owned. | G-P05–G-P07, G-C01–G-C05 | G-E04, G-E06, G-E08 |
| Todos are the stigmergic coordination surface but not proof. | G-P08, G-C04/G-C10 | G-E03, G-E05, user workflow |
| Interfaces project one operation model. | G-P10, G-C08/G-C09 | G-E03, G-E06 |
| Endpoints safe-skip reconstructs. | R1 | observed table and rerun controls |
| Neon production evidence is proposed. | R8, boundary conditions | user requirement only; no implementation |
| Range is untested. | boundary conditions | no independent second domain |

## Freeze and projection rule

`MODEL.md`, `EVIDENCE.md` and this file form the frozen analysis. `BRIEF.md` may
select, order, translate and compress them. It may not add a primitive, rule,
priority, implication, confidence or recommendation. `freeze.json` records the
content hashes after projection.
