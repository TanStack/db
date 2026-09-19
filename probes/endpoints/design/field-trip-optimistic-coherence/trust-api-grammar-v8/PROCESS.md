# Process — TanStack Trust: Protocol Discovery and Engineering

## Run boundary

- **Instrument:** Design Grammar, run 67.
- **Mode:** exact equivalence.
- **Extraction target:** a lifecycle-wide language that helps ordinary projects,
  package authors and agents discover valuable future guarantees, iteratively
  engineer protocols through LLM generation and fast independent verification,
  and lower admitted designs into coherent TypeScript and shared agent/human
  interfaces.
- **Source freeze:** run-66 frozen package plus Field Log through event 1121 and
  the sources in `EVIDENCE.md`; no new outside research or independent range
  case.
- **Preservation freeze:** PE-P01–PE-P12, confirmed by the user at Field Log
  event 1121 and recorded with the run start at event 1123.

`MODEL.md`, `EVIDENCE.md` and this record are the analytical state. The primary
brief may only project their frozen claims.

## Observation and inference ledger

| ID | Kind | Reading | Support |
|---|---|---|---|
| PE-O01 | user interpretation | Protocols create certainty about a future condition people value; design begins by asking what future would be valuable and how to guarantee it now. | PE-E01, Field Log comment 337 |
| PE-O02 | user interpretation | PostgreSQL supplies actual native hardness; a linter predicts its production refusal rather than creating it. | PE-E01, comment 336 |
| PE-O03 | user interpretation | Enforced protocol sequencing creates new hardness, as with ATM card-before-cash ordering or a dev query required to pass a production gate. | PE-E01, comment 336 |
| PE-O04 | user requirement | LLMs should generate many candidate ideas and iterate; a fast high-quality verifier should judge them. | PE-E01, comment 338 |
| PE-O05 | user requirement | LLMs should help find new hardness sources and cloud primitives that agents can operate automatically. | PE-E01, comment 337 |
| PE-O06 | user requirement | The design covers both finding protocols and engineering them in concrete TypeScript APIs. | PE-E01, comment 339 |
| PE-O07 | user requirement | Local systems need help discovering custom hardness, while reusable discoveries should support a broad industry effort. | PE-E01, comment 340 |
| PE-O08 | observation | The Endpoints kernel produces bounded evidence and explicitly does not enact refresh policy. | PE-E03 |
| PE-O09 | observation | Existing oracle code generates cases, compares an independent reference, shrinks failures, replays histories and detects injected faults. | PE-E04 and rerun controls |
| PE-O10 | observation | Current CLI, LSP and MCP adapters share one local service; agents previously invented absent operation schemas and routing. | PE-E05/PE-E06 |
| PE-O11 | source claim | Hardness stabilizes specific future expectations; protocols engineer programmable, evolvable and potentially ossifiable hardness with complementary softness and timing. | PE-E07 |
| PE-I01 | inference | The architecture needs a guarantee target before it needs a check: without explicit value, a verifier can optimize a proxy with no warranted product meaning. | PE-O01/PE-O04 |
| PE-I02 | inference | Protocol discovery and protocol execution need separate authority states joined by an immutable proposal and independent admission. | PE-O04/PE-O06, PE-P02/PE-P10 |
| PE-I03 | inference | A hardness primitive must distinguish observation, simulation, analysis, constraint, control, attestation and refusal so a cloud operation does not inherit authority from its output shape. | PE-O02/PE-O03/PE-O05 |
| PE-I04 | inference | Fast visible verifiers and independent admission verifiers serve different functions; collapsing them lets iterative generators overfit the entire judgment boundary. | PE-O04, PE-P05/PE-P06 |
| PE-I05 | inference | “Great” requires hard predicates plus separately authorized preferences or measurements; an LLM score cannot resolve incomparable tradeoffs. | PE-O01/PE-O04 |
| PE-I06 | inference | Registry publication, installation and project admission are separate transitions because an open discovery ecosystem otherwise becomes a distributed trust root. | PE-O07, PE-P09/PE-P10 |
| PE-I07 | inference | Runtime drift and failed hard points should reopen the discovery loop without allowing the new candidate to rewrite deployed history. | PE-O01/PE-O04, prior lifecycle model |

## Candidate admission and rejection

PE-M01–PE-M13 were admitted only when they reconstruct a preserved property,
change a legal transformation or block an excluded case.

| Candidate | Disposition | Reason |
|---|---|---|
| LLM judgment | rejected | It conflicts with the selected generator–verifier composition and transfers admission to the candidate producer. |
| Universal quality score | rejected | It collapses hard predicates, preferences, uncertainty, authority and incomparable tradeoffs. |
| Verifier as target owner | rejected | A verifier can test a property but cannot decide what future people should value. |
| Primitive as protocol | rejected | A production sample or feature flag lacks the target, sequence, verifier, enforcement and maintenance relations of a protocol. |
| Inner and admission verifier as one mutable suite | rejected | The generator can overfit or rewrite the entire decision boundary. |
| Search trace as evidence | rejected | Candidate count, token use and repeated attempts establish no domain proposition. |
| Passing candidate as admitted protocol | rejected | Verification and authority answer different questions. |
| Registry as admission | rejected | Publication and popularity would grant third-party code semantic and operational authority. |
| Cloud tool visibility as capability | rejected | Discovery cannot authorize production effects. |
| Todo as semantic status | rejected | Coordination state cannot establish a guarantee or verifier result. |
| Project protocol as universal | rejected | Promotion without retained boundary conditions erases the only range evidence available. |
| TypeScript type as runtime evidence | rejected | Static shape does not establish capability, environment behavior or verifier quality. |

## Reconstruction controls

### PE-R01 — Native PostgreSQL hardness and prediction

PostgreSQL supplies the refusal, catalog/compiler facts identify when it applies,
and a native protocol gives the law typed meaning. An LSP diagnostic predicts a
later production failure but creates no hard point. PE-M02–PE-M04 represent the
subjects, proposition and primitive; PE-M09/PE-M10 preserve current evidence;
PE-M11 points to the actual PostgreSQL boundary.

### PE-R02 — Engineered dev-to-production gate

A valued target requires new queries to execute and remain under one-second p99.
A protocol orders a bounded production sample, verifier and deployment gate.
The observation is evidence; the consumer that refuses release without the
current result creates new engineered hardness. Expiry, feature-flag fallback
and an authorized exception preserve softness. This reconstructs PE-P01,
PE-P03, PE-P07/PE-P08 and PE-P10.

### PE-R03 — LLM protocol search

The search freezes target, palette, verifier contracts and budgets. An untrusted
agent proposes candidates, an inner verifier returns typed counterexamples, and
each revision retains lineage. Passing candidates enter clean admission
verification and then await authority. The generator cannot mutate the target,
verifiers, capabilities or admission. PE-M01/PE-M04–PE-M08 are all required.

### PE-R04 — Verifier overfitting and candidate selection

Visible counterexamples support iteration. Independently maintained admission
cases test whether the candidate merely fit the visible history; runtime
verifiers detect drift. Passing hard predicates yields a set of eligible
candidates. Named measurements produce a Pareto set, and the target's authority
chooses among incomparable results. No model ranking or composite trust score is
introduced.

### PE-R05 — Endpoints oracle as a verifier primitive

The existing Endpoints model, generators, production-shaped runner, checkpoint,
comparison, shrinking, replay and fault controls lower into PE-M06. The current
certificate lowers into PE-M09/PE-M10 but not PE-M11 because it explicitly does
not enact refresh. This reconstructs the honest current boundary and gives a
concrete inner-loop verifier analogue without claiming a general service.

### PE-R06 — Agent repairs a failed candidate

LSP points from changed code to an affected target and latest failed candidate.
MCP explains the violated proposition, obtains the counterexample and replay
operation, and lets the agent claim a fenced todo. The agent revises and submits
a new candidate version. Closing work triggers verification; it does not mark
the verifier passed. PE-M12/PE-M13 preserve the agent workflow.

### PE-R07 — Project-local discovery

A project registers internal subjects, value owners, primitives and verifiers.
Search runs without publishing private sources. Local admission may authorize
the result for exact environments. The same TypeScript structure remains usable
if the project later proposes a package, while provenance, limits and private
capabilities remain distinct.

### PE-R08 — Package and provider publication

Endpoints publishes domain propositions and oracle verifiers. Neon extends
PostgreSQL subjects with bounded production operations. Registry metadata makes
schemas, effects, tests, compatibility and limits discoverable. Installation
loads code; project admission separately grants definitions and capabilities.
Neither provider redefines foreign truth.

### PE-R09 — Cloud operation safety

An agent requests a pure plan, receives a scoped capability, executes the exact
bounded operation and submits a complete validated result. Partial output,
cleanup failure and indeterminate delivery add no favorable evidence;
reconciliation precedes retry. Production sampling and staged rollout retain
separate observe/control effects even if one provider implements both.

### PE-R10 — CI and deployment

CLI evaluates one pinned snapshot and named policy. It performs no hidden search
or evidence gathering. Clean, policy-blocked and operational-failure exits remain
distinct. A decision token names exact target, protocol, evidence, build,
consumer and instant; only consumption by the deployment boundary creates the
engineered hard point.

### PE-R11 — Scheduled renewal

Age, SQL, schema, data population, deployment or verifier version changes can
make evidence inapplicable and expire a hard point. A deduplicated todo lets an
agent regather evidence or reopen protocol search. Old bytes or an old passing
candidate do not revive the result. A later PR remains workflow output, not
proof.

### PE-R12 — Exception and challenge

An authorized actor previews an exact, expiring exception. Creation changes the
enforced action but retains target, condition and evidence. A challenge records
counterevidence and may start new verification or protocol search. Neither path
rewrites the original hard point or lets the LLM lower the target.

### PE-R13 — Industry hardness atlas

Registries can index targets, primitives, protocols, verifier contracts,
counterexamples, transfers and negative results from many ecosystems. Search
uses these as candidate material with source and range labels. Project admission
remains local; popularity is a discovery signal only. This reconstructs the
industry ambition without inventing universal range evidence.

## Component ablation

| ID | Remove or merge | Reconstruction failure | Decision |
|---|---|---|---|
| PE-A01 | remove Guarantee target | Search can optimize a verifier with no authorized account of future value. | keep PE-M01 |
| PE-A02 | merge Target with Verifier | Whoever writes the test implicitly chooses product value and can redefine success. | keep PE-M01/PE-M06 split |
| PE-A03 | remove Lifecycle graph | Local code cannot connect to product, build, deployment or production obligations. | keep PE-M02 |
| PE-A04 | merge proposition modes | A requirement, measurement, law and guarantee can masquerade as one another. | keep PE-M03 |
| PE-A05 | remove Hardness primitive | Candidate protocols cannot enumerate or type traditional/custom/cloud building blocks and their effects. | keep PE-M04 |
| PE-A06 | merge Primitive with Protocol | One tool invocation appears to contain value, sequencing, verification and enforcement. | keep PE-M04/PE-M05 split |
| PE-A07 | remove Protocol design | A target plus tools has no ordered recipe, maintenance or softness. | keep PE-M05 |
| PE-A08 | remove Verifier | LLM self-judgment or human review must decide every generated candidate. | keep PE-M06 |
| PE-A09 | merge pass/fail/inconclusive | Missing reach or evidence can become a favorable result. | keep PE-M06 result union |
| PE-A10 | remove Search campaign | Iterations, counterexamples, budgets and lineage disappear; agents repeat or cherry-pick attempts. | keep PE-M07 |
| PE-A11 | merge Search history with evidence | Iteration count and model output acquire domain authority. | keep PE-M07/PE-M09 split |
| PE-A12 | merge visible and admission verification | Generator-visible cases exhaust the judgment boundary and overfitting is untestable. | keep verifier portfolio relation |
| PE-A13 | remove Admission decision | A passing or installed package becomes self-authorizing. | keep PE-M08 |
| PE-A14 | merge Admission with Capability | Semantic acceptance grants every production operation the package declares. | keep PE-M08/PE-M13 split |
| PE-A15 | remove Evidence record | Verifier and primitive results lose provenance, immutability and replay. | keep PE-M09 |
| PE-A16 | merge Evidence with Qualification | Adequate-but-stale and current-but-inadequate results collapse. | keep PE-M09/PE-M10 split |
| PE-A17 | remove Hard point | Evidence and configured severity appear equivalent to an enacted future guarantee. | keep PE-M11 |
| PE-A18 | remove enacted consumer | A bypassable CI warning is represented as engineered hardness. | keep PE-M11 consumer relation |
| PE-A19 | remove complementary softness | Protocols cannot adapt honestly; exceptions become hidden bypasses. | keep PE-M11 softness |
| PE-A20 | remove Condition/work/history | Failures, expiry, search residue and multi-agent coordination cannot persist. | keep PE-M12 |
| PE-A21 | merge Todo with semantic state | Claiming or closing work changes evidence or admission. | keep PE-M12 internal split |
| PE-A22 | remove Operation descriptor | Agents invent names, schemas, capabilities and stale-state recovery. | keep PE-M13 |
| PE-A23 | split semantics by interface | TypeScript, LSP, MCP, CLI and Devtools can disagree about the same candidate or hard point. | keep shared PE-M13 registry |
| PE-A24 | merge registry publication, installation and admission | An open ecosystem becomes a distributed trust and capability root. | keep three transitions |
| PE-A25 | merge hard predicates and preferences | “Great” becomes an opaque score and incomparable candidates acquire a false total order. | keep target must/prefer split |
| PE-A26 | remove range/provenance on promotion | A local protocol is published as general after only home-context success. | keep PE-C16 |

All thirteen candidates survive. The result is minimal relative to PE-P01–PE-P12,
not a claim that every protocol system needs thirteen public objects.

## Dependency and overlap control

| Consumer ↓ / candidate → | Target/subjects | Primitive/protocol | Verifier/search | Admission | Evidence/qualification | Hard point/work | Operations |
|---|---:|---:|---:|---:|---:|---:|---:|
| Project config | defines/selects | composes | chooses portfolio | authorizes scope | constrains | sets policy | uses |
| LLM generator | reads | proposes | receives public feedback | none | reads | claims work | bounded calls |
| PostgreSQL package | subjects | native primitives | may provide | requests | publishes | exposes refusal | describes |
| Endpoints package | relates | derived protocols | oracle verifier | requests | publishes | future runtime | describes |
| Neon provider | targets foreign | cloud primitives | integrity verifiers | requests capability | publishes | may control | implements |
| Registry | indexes | indexes | indexes results/limits | none | no authority | no enforcement | discovery only |
| Reviewer/authority | owns value | inspects | consumes admission result | decides | no manufacture | grants policy/exception | authorized commands |
| CI/deployment | pins | executes admitted | runtime checks | reads | reads | evaluates/consumes | executes |
| Devtools | displays | displays | displays lineage | displays | displays | displays | read operations |

The ten active overlaps in `MODEL.md` have distinct functions. A package tree
would erase cross-owner subjects, generator/verifier separation, local/public
promotion and observation/control authority.

## Rule conflicts

| ID | Conflict | Resolution |
|---|---|---|
| PE-X01 | “Protocols create hardness” may erase hardness already supplied by PostgreSQL. | Preserve native exposure, prediction and engineered sequencing as different relations. |
| PE-X02 | “Endless iteration” may imply guaranteed convergence. | Bound campaigns, retain residue and say only declared verifier properties have passed. |
| PE-X03 | Fast verification may encourage weak verification. | Treat latency as a budget while retaining domain, reach, reference, replay, faults and limits. |
| PE-X04 | Counterexamples improve candidates but expose the test surface. | Separate inner-loop feedback from independently maintained admission verification. |
| PE-X05 | An open industry ecosystem needs easy reuse, but reuse cannot grant trust. | Separate publication, installation, semantic admission and operational capability. |
| PE-X06 | Local protocols contain valuable specificity, while publication seeks generality. | Preserve source, boundary conditions and negative-transfer limits during promotion. |
| PE-X07 | A cloud provider can observe and control the same system. | Type effects and capabilities separately; observation does not authorize control or vice versa. |
| PE-X08 | TypeScript ergonomics favors compact helpers, while the kernel needs explicit authority and provenance. | Provide layered constructors that lower into the complete typed graph. |

No unresolved priority is needed for the extracted grammar. Exact public names,
registry governance, verifier secrecy policy, institutional admission and cloud
capability security remain boundary conditions.

## Range and negative controls

No independently sourced marginal domain was supplied. Range is untested.
PostgreSQL, Endpoints, Neon, product requirements, model oracles, ESLint,
Protocols Institute work and cloud operations all informed extraction.

The negative exclusions are a self-authorizing LLM, mutable verifier loop,
benchmark-as-quality, registry-as-authority, visible-tool-as-capability,
bypassable gate, home-fixture universality and purpose-free maximum hardness.
The candidate grammar rejects each through PE-C01–PE-C16.

## Adjacent-form generation

- **PE-G01 — Project-local protocol workshop:** augmentation adds private
  targets, primitives and verifiers while preserving local admission.
- **PE-G02 — Provider hardness marketplace:** port exposes cloud operations over
  foreign subjects while preserving domain ownership and capabilities.
- **PE-G03 — Continuous protocol evolution:** rule combination turns runtime
  drift into a new search without rewriting the deployed protocol's history.
- **PE-G04 — Industry hardness atlas:** augmentation indexes reusable and
  negative results without granting project authority.

The four forms use different transformation paths or boundaries. Additional
provider names, UI spellings and verifier algorithms were omitted as cosmetic or
implementation variants.

## Executable controls

At repository commit `4ad19815b44be533ac10f90b62aca4377f5138d2`,
all 21 evidence-base tests passed, all eight hostile mutants were detected, and
TypeScript typechecking passed. These controls preserve the finite evidence,
counterexample, replay, dependency and shared-interface substrate. They do not
execute PE-M01–PE-M08, the cloud/registry paths or engineered deployment gate.

## Injected structure and likely distortion

The extraction introduces **Guarantee target**, **Hardness primitive**,
**Protocol search**, a three-part **Verifier portfolio** and the
publication/installation/admission sequence. No source supplied one existing
system with this exact decomposition. It may make target formation and verifier
quality look easier and more formal than they are.

The generator–verifier loop privileges properties that can produce fast machine
feedback. This may underrepresent qualitative product value, long-horizon
effects, rare failures, tacit expertise and social legitimacy. Sealed cases can
create false confidence, and repeated optimization can intensify Goodhart
pressure. A registry may turn source-traced experiments into status rankings
despite the explicit rule against it. These are material limits, not missing
fields that the grammar can fill automatically.

## Primary-brief support map

| Brief claim | Model support | Evidence support |
|---|---|---|
| Trust works backward from a valued future to a guarantee created now. | PE-M01/PE-M05, target section | PE-O01/PE-E01, PE-P01 |
| LLMs generate and fast independent verifiers judge. | PE-M06/PE-M07, portfolio/search sections | PE-O04/PE-E04, PE-P04–PE-P06 |
| Native, predictive and engineered hardness differ. | hardness primitive/protocol examples, PE-M11 | PE-O02/PE-O03, PE-E03/PE-E07 |
| Discovery proposals and admitted TypeScript protocols are separate levels. | two-level and layered API sections, PE-M05/PE-M08 | PE-O06, PE-P02/PE-P11 |
| Traditional and new cloud primitives can be composed. | PE-M04 and cloud/package APIs | PE-O05, PE-P07/PE-P08 |
| Local discovery can feed an open ecosystem without transferring authority. | ecosystem section, PE-M08/PE-C09/PE-C16 | PE-O07, PE-P09/PE-P10 |
| Agents share operations and structured counterexamples across interfaces. | failure feedback, PE-M12/PE-M13 | PE-O10/PE-E06, PE-P11 |
| Passing verifiers does not equal general greatness. | must/prefer split, PE-C03–PE-C07, decomposition loss | PE-I04/PE-I05, PE-P06 |
| The implementation range remains Endpoints-only and incomplete. | boundary conditions | PE-E03–PE-E05, PE-P12 |

## Freeze and projection rule

`MODEL.md`, `EVIDENCE.md` and this file must freeze before `BRIEF.md` is drafted.
Projection may order, translate and compress them but may not add a primitive,
rule, implication, priority, confidence or recommendation. `freeze.json` binds
the final hashes and layer-reconstruction result.
