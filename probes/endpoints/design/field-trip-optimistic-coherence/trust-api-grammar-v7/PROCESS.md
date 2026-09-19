# Process — TanStack Trust: In Search of Hardness

## Run boundary

- **Instrument:** Design Grammar, run 66.
- **Mode:** exact equivalence.
- **Extraction target:** a lifecycle-wide language for finding, representing and
  composing independently grounded constraints—from product intent through
  production—so Trust can guide agents while preserving the meaning, authority
  and limits of every source.
- **Source freeze:** Field Log through event 1110 plus the local sources in
  `EVIDENCE.md`. HG-E11 arrived after preservation confirmation but before the
  analytical freeze. It refined H1/H3/H7/H8 and required reconstruction and
  ablation to be rerun; it did not add or remove a preserved property.
- **Preservation freeze:** H1–H12, confirmed with “looks good go” at Field Log
  event 1106.
- **Projection constraint:** the primary brief describes the system on its own
  terms and does not answer or narrate previous drafts.

`MODEL.md`, `EVIDENCE.md` and this process record were materialized before the
primary brief.

## Observation and inference ledger

| ID | Kind | Reading | Support |
|---|---|---|---|
| HG-O01 | user requirement | The product aim is to find untapped sources of hardness across the SDLC and feed them back to agents. | Field Log comment 331 |
| HG-O02 | user requirement | The scope includes product requirements through production, not only code. | Field Log comment 332 |
| HG-O03 | user interpretation | A core protocol tells what is real or hard inside its domain because it is backed by what the substrate does or refuses. | Field Log comment 328 |
| HG-O04 | user interpretation | Higher packages may add hardness such as a latency requirement. | Field Log comment 328 |
| HG-O05 | user requirement | A package can ship a model and fast-check setup that tests code against an oracle. | Field Log comment 329 |
| HG-O06 | observation | The Endpoints compiler already produces schema/effect/dependency structures and a three-valued selective-refresh decision. | HG-E06 |
| HG-O07 | observation | The oracle code supplies generated programs/histories, an independent reference, production-path checkpoints and shrinking. | HG-E08/HG-E09 |
| HG-O08 | observation | The evidence kernel preserves arguments, observations, dependencies, challenges and causal replay. | HG-E07 |
| HG-O09 | observation | Six agents could recover v5 semantics but had to invent operation schemas, joins and action routing. | HG-E05 |
| HG-O10 | source claim | Hardness and softness are selective, can be misplaced, and interact with protocol leakiness and emergent traces. | HG-E02 |
| HG-O11 | source claim | Hardness makes specific parts of the future stable enough to support coordination across time. | HG-E11 |
| HG-O12 | source claim | Protocols harness natural grounding as engineered, programmable, dynamic, evolvable and systematically ossifiable hardness. | HG-E11 |
| HG-O13 | source claim | Hardness must be evaluated with complementary softness, purpose-relative sufficiency or excess, timing and pseudo-hardness risk. | HG-E11 |
| HG-O14 | source claim | Reordering actions can create useful hardness even without a stronger component, as when an ATM returns the card before dispensing cash. | HG-E11 |
| HG-O15 | user requirement | Providing guarantees and verifying their continued truth are largely human work today; Trust should automate that work safely. | HG-E04, RFC Field Log event 235 |
| HG-I01 | inference | A backing source and the protocol interpreting it must be separate; otherwise wrappers inherit authority by naming a substrate. | H3, HG-O03, authority constraints |
| HG-I02 | inference | Facts, laws, guarantees and requirements need typed modalities because they answer different questions and carry different authority. | H3/H4/H7/H8 |
| HG-I03 | inference | Oracle and observed hardness are establishment routes, not statement kinds; either may bear on the same requirement. | H5–H8 |
| HG-I04 | inference | Hardness is an active relation among grounding, protocol, qualified statement, coordination purpose, temporal placement and enacted boundary; its dimensions cannot be collapsed into a scalar. | H1/H3/H6/H8, HG-O10–HG-O13 |
| HG-I05 | inference | A lifecycle subject graph is required to propagate relevance without copying evidence or treating a chain of implementation links as equivalence. | H2/H9 |
| HG-I06 | inference | Work traces and agent proposals are necessary to discover new hardness while their separation from admission prevents stigmergic popularity from becoming truth. | H10, HG-O10 |
| HG-I07 | inference | A fact, evidence record, requirement or configured `block` is not yet a hard point; a reliable consumer must make the intended future transition depend on it. | HG-O11–HG-O13, H7/H8 |
| HG-I08 | inference | Applicability, expiry, retained history and decision tokens need separate past, present and future semantics. | HG-O11/HG-O13, H6/H8/H11 |
| HG-I09 | inference | Challenge, fallback, revision and authorized exception are complementary softness rather than failures to model hardness. | HG-O10/HG-O13, H8/H10 |
| HG-I10 | inference | Evidence commit, qualification and token issuance form an ordered hardening protocol; if later stages can precede or bypass earlier ones, the displayed gate is pseudo-hardness. | HG-O14, H7/H11 |

## Candidate admission and rejection

### Admitted candidates

HG-P01–HG-P11 were admitted only when they reconstructed a preserved relation,
changed a legal transformation or blocked an out-of-family case.

### Rejected or demoted candidates

| Candidate | Disposition | Reason |
|---|---|---|
| Hardness score | rejected | It erases force, coverage, authority, independence and applicability and creates an unsupported total order. |
| Evidence or constraint as hardness | rejected | It omits purpose, temporal placement and the reliable boundary that makes future behavior dependable. |
| Maximum hardness | rejected | Sufficiency and excess are purpose-relative; extra refusal or ossification can preserve the wrong certainty. |
| Linter rule | demoted to one package/interface form | It cannot represent product intent, deployment, production observation or retained evidence history by itself. |
| Test as evidence primitive | demoted to a method | Tests, model campaigns and production samples share the evidence-record contract but have different establishment routes. |
| Product requirement as fact | rejected | Its authority concerns what should be established, not what the implementation or users currently do. |
| Production metric as requirement | rejected | An observation needs an independently activated threshold and adequacy rule. |
| Protocol as hardness source | split | A protocol harnesses a grounding source; neither one alone is the placed hard point on which a consumer relies. |
| Todo as requirement/evidence | rejected | It is a coordination trace derived from a condition. |
| Agent confidence | rejected | An agent assertion may enter as a proposal or observation but cannot supply admission or semantic adequacy. |
| Environment layer as strict tree | rejected | Product, code, query, build and production evidence overlap through many-to-many relations. |
| Separate semantics per LSP/MCP/CLI | rejected | This reproduces missing joins and inconsistent authority at each transport. |
| Native/derived/oracle/observed/required as ranks | rejected | The forms describe different backing relations and can combine; none is universally stronger. |
| Complementary softness as bypass | rejected | Unknowns, challenges, revisions and exceptions need explicit authority and time; hiding them would make rigidity look like reliability. |

## Reconstruction controls

### HG-R01 — Native PostgreSQL constraint

A catalog adapter publishes a current constraint fact and PostgreSQL protocol
law. The source is PostgreSQL/catalog behavior (HG-P01), the protocol gives the
behavior typed meaning (HG-P02), the table/constraint/operation are subjects
(HG-P03), and the fact/law remain distinct statement modes (HG-P04). A route
combines current catalog evidence with the native refusal law (HG-P05–HG-P07).
The actual PostgreSQL write refusal places the future hard point (HG-P09/HG-P10)
at a transaction boundary. The result can guide an agent before code is run
without claiming complete constraint discovery. The catalog record can expire;
a schema migration is an authorized path for changing the constraint rather
than pretending its old law no longer mattered.

### HG-R02 — Derived Endpoints guarantee

PostgreSQL facts identify read/write effects and uncertainty. Endpoints relates
its query/mutation/collection subjects to those operations and publishes the
`canSkipRefetch` derivation with collection authority and build identity. The
existing outcomes reconstruct:

- complete, same-artifact, disjoint effects with current authority → support;
- overlap or missing authority → contradiction;
- incomplete effects or different artifacts → unresolved.

No evidence is copied into Endpoints ownership. The derivation remains evidence.
A future runtime would create the hard point by refusing `skip` unless the
result is supported and current, with authoritative refetch as complementary
softness for contradicted or unknown cases. The current certificate explicitly
does not enact refresh policy, so reconstruction preserves this as a missing
boundary rather than implementation evidence. The result does not choose
deployment policy.

### HG-R03 — Fast-check oracle package

The package defines an oracle establishment route containing an independent
reference model, generated histories, target runner, reach checkpoint,
observation, comparator, shrinking and replay. One campaign creates an immutable
evidence record with versions, seed, generated domain, results, coverage cells,
fault controls, cleanup and omissions. Adequacy can require a particular domain
or mutant kills; applicability binds the campaign to current code/schema/build.
A passing campaign remains bounded and does not become a statistical confidence
claim without HG-C07. It also does not become a hard point until a named CI or
release boundary consumes its qualified result; that consumer is proposed
rather than implemented.

### HG-R04 — Neon production sampling

Neon implements an admitted method over a PostgreSQL query subject it does not
own. A plan fixes the environment, query, predicates, count and stopping rule.
The result records latency samples and attestation. A latency requirement decides
adequacy; SQL/schema/data/environment/age determine applicability; CI policy
supplies intended force. A deployment boundary must enact that decision before
the observation participates in a hard point. Provider, requirement owner,
policy owner and enforcing consumer remain distinct; age and drift supply the
temporal break.

### HG-R05 — Product requirement to production

An authorized product source publishes a requirement about a user journey. Typed
relations connect it to a feature, endpoint, query, build and deployment. The
requirement may need both an acceptance oracle and production-funnel observation.
Each retains separate coverage and authority. A code-edit diagnostic can expose
the chain, but recording the requirement, editing or merging the code does not
make it hard. The hard point exists only at an actual acceptance, merge, rollout
or operating boundary that reliably consumes current qualification. Challenge,
revision and exception preserve complementary softness.

### HG-R06 — Agent editor repair

An LSP overlay identifies the exact changed source version and related lifecycle
subjects. The diagnostic binds statement, condition, current routes, missing
evidence, legal actions and snapshot. MCP explains the requirement, lists/claims
a todo and plans the selected evidence method. Atomic submission triggers fresh
qualification. Neither the edit, todo, run delivery nor agent narrative is
evidence, and the editor diagnostic itself is guidance rather than a hard point.

### HG-R07 — Scheduled evidence renewal

A dependency or age change makes evidence inapplicable, reactivates a condition
and exposes one deduplicated todo. The scheduled agent queries expired evidence,
claims with a fence, runs an admitted method and closes work only after
requalification. A later PR is an external workflow artifact, not proof.

### HG-R08 — CI and deployment gate

CI reads one pinned snapshot and evaluates one named policy profile. It performs
no hidden evidence collection. The report, exit status and decision token share
the same inputs and evaluation instant. The deployment consumer accepts only a
matching current token; token issuance cannot precede evidence commit and
qualification. A valid block, valid allow and inability to decide remain
distinct. If the consumer can bypass or ignore the token, the result is reported
as pseudo-hardness rather than a gate.

### HG-R09 — Human inspection

Devtools reads one snapshot plus cursor changes and shows product requirements,
subjects, relations, source facts, establishment routes, evidence,
qualification, conditions, work, proposals, admission and policy. A cursor gap
or mixed snapshot forces resynchronization rather than constructing a plausible
hybrid state.

### HG-R10 — Temporary exception

An authorized actor previews an exact subject/condition/profile exception. The
preview reports overlap, authority and hypothetical action but has no deployable
token. Creation changes enforcement only; the condition and evidence history
remain. Expiry or changed inputs requires re-evaluation. The exception is
complementary softness with explicit scope, owner and time rather than evidence
against the requirement.

### HG-R11 — Stronger requirement preview

A sealed candidate config adds or tightens a requirement. Trust reports affected
lifecycle subjects, reusable evidence, newly missing evidence, conditions and
projected todos without mutating live state. Source-local fragments cannot
weaken higher-authority requirements. The preview also reports which existing
decision boundaries actually enforce the candidate, whether its hardness is
insufficient or excessive for the declared purpose, and any newly exposed
pseudo-hardness.

### HG-R12 — Agent discovers a new hardness route

An agent proposes a source adapter, statement, model, oracle kit, method or
qualification with source trace, tests and limits. The proposal may generate
review work. Only an independent admission operation makes it usable. Existing
evidence does not automatically migrate to the new route, and admission alone
does not place a hard point without a qualified statement and reliable consumer.

## Component ablation

| ID | Remove or merge | Reconstruction failure | Decision |
|---|---|---|---|
| HG-A01 | remove Grounding source | Protocol declarations become self-grounding; PostgreSQL, model, telemetry and product authority are indistinguishable. | keep HG-P01 |
| HG-A02 | merge Source into Protocol | A wrapper inherits substrate authority and source identity/version cannot change independently. | keep HG-P01/HG-P02 split |
| HG-A03 | remove Protocol | Raw tools expose no stable domain semantics, extension point or compatibility contract. | keep HG-P02 |
| HG-A04 | remove Lifecycle subject graph | Product, code, build and production obligations cannot be related or traversed; evidence must be copied. | keep HG-P03 |
| HG-A05 | merge Facts, laws, guarantees and requirements | Product intent can masquerade as runtime fact and a derived result can masquerade as native law. | keep typed modes in HG-P04 |
| HG-A06 | remove Establishment route | Evidence existence alone appears to support a statement; joint premises and alternate methods disappear. | keep HG-P05 |
| HG-A07 | merge Evidence record into Statement | A new run rewrites the claim and provenance/history vanish. | keep HG-P06 |
| HG-A08 | merge Adequacy and Applicability | Adequate-but-stale, current-but-inadequate and unknown-context cases collapse. | keep HG-P07 |
| HG-A09 | merge Condition and Todo | Claiming or closing work changes semantic status. | keep typed overlap in HG-P08 |
| HG-A10 | remove retained Condition/work history | Scheduled renewal, causal repair, challenge retention and agent handoff fail. | keep HG-P08 |
| HG-A11 | merge Enforcement with Requirement | Development and CI cannot apply different actions to one requirement; exception changes meaning. | keep HG-P09 |
| HG-A12 | merge Enforcement with Evidence | A permissive policy creates support and a block implies contradiction. | keep HG-P09 split |
| HG-A13 | remove Operation descriptor | Agents must invent tool routing, inputs and stale recovery as observed in v5 simulations. | keep HG-P11 |
| HG-A14 | split operations by interface | LSP, MCP, CLI and Devtools can disagree while using similar names. | keep shared HG-P11 registry |
| HG-A15 | remove Hard point | Evidence, requirements and configured severity become indistinguishable from reliable coordination boundaries. | keep HG-P10 |
| HG-A16 | remove purpose-relative fit dimensions | “Harder” becomes an unsupported score and excessive or misplaced refusal cannot be represented. | keep HG-P10/HG-C14 |
| HG-A17 | remove temporal placement | Past evidence, present applicability and future refusal collapse; stale records can authorize later transitions. | keep HG-P10/HG-C17 |
| HG-A18 | remove complementary softness | Challenge, revision, fallback and exception become invisible bypasses or impossible operations; protocols cannot evolve honestly. | keep HG-P10/HG-C15 |
| HG-A19 | remove enacted-boundary check | A configured or displayed `block` is treated as hardness even when every consumer can ignore it. | keep HG-P09/HG-P10/HG-C16 |
| HG-A20 | remove ordered token issuance | Deployment can precede evidence commit or qualification and reconstruct a plausible but unwarranted green state. | keep HG-D12/HG-C08/HG-C17 |
| HG-A21 | remove proposal/admission split | New agent-discovered sources are either impossible to add or self-authorizing. | keep HG-D10/HG-C10 |
| HG-A22 | remove statistical contract | Fast-check run counts can be misreported as probability or confidence. | keep HG-C07 |
| HG-A23 | remove local/higher-authority merge law | A source annotation can evade project or product requirements. | keep HG-C11 |

Every surviving candidate changes reconstruction, a legal transformation or a
negative exclusion. The result is minimal relative to H1–H12, not a claim that
the world contains eleven fundamental parts.

## Dependency and overlap control

| Consumer ↓ / primitive → | Source/protocol | Subject graph | Statements/routes | Evidence/qualification | Hard point | Conditions/work | Enforcement | Operations |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Product package | ✓ | ✓ | ✓ | may provide | proposes purpose | ✓ | policy input | ✓ |
| PostgreSQL adapter | ✓ | ✓ | facts/laws | publishes | exposes refusal |  | substrate | ✓ |
| Endpoints compiler/runtime | uses | ✓ | guarantees | publishes | places optimization boundary |  | runtime choice | ✓ |
| Oracle package | reference | targets | route | publishes | does not place alone |  |  | ✓ |
| Neon provider | observer | targets |  | publishes | does not place alone |  |  | ✓ |
| Project config | authority | selectors | requirements | constrains | declares purpose |  | ✓ | ✓ |
| Agent | discovers | traverses | reads/proposes | gathers | inspects | coordinates | previews | ✓ |
| CI/deployment | reads | traverses | reads | reads | enacts/consumes | reads | evaluates/refuses | ✓ |
| Devtools | reads | traverses | reads | reads | displays fit/time/softness | reads | displays | ✓ |

The nine active overlaps in `MODEL.md` survive because each carries a distinct
cross-owner relation. Turning the matrix into a package tree would copy evidence,
erase product/runtime interactions or transfer authority.

## Rule conflicts

| ID | Conflict | Resolution |
|---|---|---|
| HG-X01 | “The protocol says what is real” may make protocol authors appear to create substrate truth. | Separate backing source from protocol interpretation and require explicit source/dependency boundaries. |
| HG-X02 | “Additional hardness” can mean a derived fact, an empirical observation or an imposed requirement. | Preserve distinct statement modes and establishment forms; do not rank them. |
| HG-X03 | Product requirements belong in the graph but are not empirical facts. | Give them normative authority and accepted evidence routes, not runtime modality. |
| HG-X04 | Fast-check uses randomness, but randomized generation is not automatically statistical inference. | Preserve oracle coverage separately; require HG-C07 before a statistical claim. |
| HG-X05 | Agents should discover proof routes, but proposals can become self-reinforcing traces. | Make proposal/review status queryable while requiring independent admission. |
| HG-X06 | A local annotation should be ergonomic but cannot evade a global requirement. | Allow additive/tighter lowering; route weakening through explicit authority and policy. |
| HG-X07 | A source may constrain or measure reality without creating a stable coordination point. | Separate grounding, protocol interpretation, evidence, qualification and enacted hard point. |
| HG-X08 | Hardness sounds intrinsically desirable, but it can be insufficient, excessive, misplaced or stale. | Evaluate fit only for a declared purpose and retain complementary softness and temporal placement. |
| HG-X09 | A configured gate looks like future refusal even when a consumer can bypass it. | Require a named enforcing boundary and classify unenacted force as pseudo-hardness. |

No unresolved priority was needed for the frozen grammar. The exact institutional
authority topology, public package names, security boundary and statistical
confidence framework remain boundary conditions.

## Range and negative controls

No independently sourced marginal domain was supplied. Range is explicitly
untested. PostgreSQL, Endpoints, product requirements, model oracles, production
sampling and deployment all informed extraction and cannot serve as held-out
cases.

The sourced near-negative is ESLint: useful package/config/message/test
mechanisms, but a source callback plus diagnostics cannot reconstruct the
lifecycle graph or evidence/policy distinctions. Conceptual exclusions include
an observability dashboard without requirements, a completed product checklist
treated as runtime proof, a configured-but-unenforced deployment gate, a scalar
agent score and a self-authorizing agent loop.

## Adjacent-form generation

- **HG-G01 — Product requirement adapter:** augmentation adds an external
  authority/source and typed lifecycle links.
- **HG-G02 — Build provenance protocol:** port projects build artifacts and
  reproducibility attestations into the same graph.
- **HG-G03 — Combined oracle and canary requirement:** rule combination joins
  separate model and production clocks without making the evidence equivalent.
- **HG-G04 — Ordered deployment gate:** rule combination makes token issuance
  depend on committed, current qualification and makes deployment consume that
  exact token; an expiring authorized exception is the complementary soft path.

Additional database providers, UI spellings and thresholds were omitted because
they repeat these transformation paths.

## Injected structure and likely distortion

The extraction introduces **Grounding source**, **Hard point**, **Typed
statement** and the five hardness paths as explicit categories. The sources did
not supply one existing runtime object with this exact shape. The model may make
authority, product intent, evidence collection, temporal placement and
complementary softness appear cleaner and more machine-readable than they will
be. It may also privilege mechanisms that emit typed records and underrepresent
negotiation, tacit expertise, qualitative research and gradual protocol
evolution.

The lifecycle graph can suggest causal traceability where only an asserted
relationship exists. The `HardPoint` record can look more definitive than the
actual consumer boundary and can turn a contested value judgment about
sufficiency into a tidy enum. API examples may imply that TypeScript generics,
package security, identity reconciliation and bypass detection are easier than
they are. These are material limits, not missing fields to be filled
speculatively.

## Primary-brief support map

| Brief claim | Model support | Evidence support |
|---|---|---|
| The SDLC contains distributed grounding sources that can become stable coordination points. | central reading, HG-P01–HG-P03/HG-P10 | HG-O01–HG-O05/HG-O11–HG-O14, HG-E02/HG-E06/HG-E08/HG-E11 |
| Trust automates guarantee work while retaining domain and human authority. | central reading, HG-P01–HG-P11, HG-C05/HG-C09/HG-C10 | HG-O15/HG-E04, preservation H8/H10 |
| Trust makes grounding, protocols and placed hard points legible without scoring them. | HardPoint, HG-P01–HG-P11, HG-C01/HG-C02/HG-C14–HG-C17 | preservation H1/H8/H11 and HG-E11 |
| Native, derived, oracle, observed and required paths differ. | HG-FM01–HG-FM05 | HG-R01–HG-R05 and HG-E06/HG-E08/HG-E11 |
| Product-to-production graph matters for agents. | HG-P03, product lifecycle section | user-required H2; implementation absent |
| Agents receive explanations, evidence operations, hard-point state, todos and proposals. | HG-P08/HG-P10/HG-P11 | v5 usability evidence and user workflows |
| Evidence does not supply policy or admission authority. | HG-P05–HG-P09, HG-C05/HG-C09/HG-C10 | RFC/kernel plus preservation H8/H10 |
| Time, complementary softness and enacted sequencing distinguish hardness from rigidity or display. | HG-P10, HG-D07/HG-D12, HG-C14–HG-C17 | HG-O11–HG-O14/HG-E11, HG-R01–HG-R11 |
| Endpoints reconstructs but lifecycle range is untested. | HG-R02, boundary conditions | observed cases, tests and no held-out domain |

## Freeze and projection rule

`MODEL.md`, `EVIDENCE.md` and this file are the analytical state. The primary
brief may order, translate and compress these items but may not add a primitive,
relation, priority, implication, confidence or recommendation. `freeze.json`
binds their hashes after projection.
