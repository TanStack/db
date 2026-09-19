# Model — TanStack Trust: In Search of Hardness

## Central reading

Hardness is a dependable point across time that makes a specific part of the
future certain enough for people or agents to coordinate around. Software
development contains many possible grounding sources for such points:
databases that refuse invalid writes, compilers that reject impossible
programs, independent models that falsify behavior, production systems that
record what happened, and institutions that can authorize a requirement.
These sources are scattered across product systems, code, builds, deployment
infrastructure and production operations. Coding agents usually encounter only
the fragments visible in their immediate tool context.

Today, engineers do much of the work of connecting those fragments by hand:
deciding which guarantees matter, gathering evidence, checking that it still
applies, enforcing the result and repairing it when the world changes. The
product opportunity is to automate that guarantee work safely, while keeping
domain meaning, authority and the right to revise a protocol outside the coding
agent's control.

TanStack Trust is a protocol system for exposing these sources of hardness as a
connected, typed and inspectable environment. A protocol harnesses a grounding
source, gives it domain meaning and places the resulting hard point at a useful
decision boundary. Trust lets an agent ask what must be true, what can be relied
upon now, why that reliance is warranted, when it expires, what remains soft,
and what authorized action can close or deliberately relax a gap.

```text
 product intent ──► feature ──► code/API ──► database operation
       │                │           │                │
       │                └───────────┼───────┐        │
       ▼                            ▼       ▼        ▼
 acceptance model              build artifact   deployment
       │                            │               │
       └──────────────► Trust subject graph ◄──────┘
                              │
          native laws ────────┤
          derivations ─────────┤
          oracle campaigns ────┤──► qualification ─► placed hard points
          runtime observations ┤                         │       │
          requirements ────────┘                         │       ▼
                                                   conditions  enacted refusal
                                                     /todos    or commitment
```

## From grounding sources to hard points

A mechanism is a candidate grounding source when it supplies something
independent of the coding agent's assertion and can resist, test or authorize a
claim in a declared domain. It may:

- constrain the states or transitions the system accepts;
- produce an attributable fact about a subject;
- derive a checkable consequence from admitted facts or laws;
- falsify behavior against an independent reference;
- measure behavior under a declared observation process; or
- authoritatively require evidence or refuse an action.

These properties make a mechanism useful for hardness engineering; they do not
make every emitted fact, measurement or requirement a hard point. Evidence can
support a proposition without making future behavior dependable. A policy can
say `block` without being connected to anything that must obey it. A protocol
creates a usable hard point only when it connects a grounded statement to a
specific coordination purpose and an enacted decision boundary.

Hardness is therefore a relation, not a scalar score or intrinsic label on one
record. Trust preserves its separate dimensions:

```ts
interface HardPoint {
  statement: StatementRef
  groundedBy: readonly GroundingRef[]
  protocol: ProtocolRef
  qualification: QualificationRef

  purpose: CoordinationPurpose
  reliedUponBy: readonly DecisionBoundaryRef[]
  basis: readonly (
    | 'native'
    | 'derived'
    | 'oracle'
    | 'observed'
    | 'required'
  )[]
  effect: 'record' | 'commit' | 'refuse' | 'gate'
  coverage: 'exact' | 'bounded' | 'enumerated' | 'sampled' | 'heuristic' | 'human'
  independence: IndependenceBoundary
  authority: AuthorityBoundary
  dependencies: DependencyContract
  time: TemporalPlacement
  evolution: 'dynamic' | 'evolvable' | 'ossifying' | 'ossified'
  softness: SoftnessContract
  fit: {
    status: 'insufficient' | 'fitted' | 'excessive' | 'unknown'
    forPurpose: CoordinationPurpose
    pseudoHardnessRisks: readonly Risk[]
  }
  omissions: readonly Limit[]
}
```

A database constraint may have strong refusal force but a narrow subject. A
property campaign may have broad generated coverage but no permission to deploy.
A product requirement may have organizational authority without establishing
runtime behavior. A CI report may say `block` while a deploy system ignores its
exit status. Trust preserves these distinctions instead of combining them into
one confidence number.

`TemporalPlacement` distinguishes the past record that warranted a decision,
the present context in which it still applies, and the future transition the
system promises to accept or refuse. `SoftnessContract` records unknowns,
fallbacks, challenges, revision paths and authorized exceptions. This is not a
loophole field: hardness without complementary softness can preserve the wrong
certainty after its grounds or purpose have changed. Hardness fit is always
relative to a purpose. More hardness is not automatically better.

## Candidate primitives

| ID | Candidate | Job | Must not imply |
|---|---|---|---|
| HG-P01 | **Grounding source** | Identifies the substrate, reference, observer or authority that can resist, test or authorize a claim | truth or hardness outside its declared boundary |
| HG-P02 | **Protocol** | Projects one domain's subjects, statements, methods and limits into stable, versioned contracts | ownership of consumer policy or foreign domains |
| HG-P03 | **Lifecycle subject graph** | Gives durable identity and typed relationships to product, code, build, deployment and runtime objects | equality merely because objects are related |
| HG-P04 | **Typed statement** | Distinguishes current facts, native laws, derived guarantees and normative requirements | that every registered statement is established |
| HG-P05 | **Establishment route** | States how a particular statement may be supported, contradicted or left unresolved | that one route replaces joint premises or alternatives |
| HG-P06 | **Evidence record** | Preserves one immutable derivation, campaign, observation, refusal or admission result with provenance | authority from schema shape, successful delivery or popularity |
| HG-P07 | **Qualification** | Decides separately whether evidence is adequate and whether it applies to the current use | deployment permission |
| HG-P08 | **Condition and work trace** | Retains missing, contradicted, stale or challenged statements and coordinates repair | that task completion is evidence |
| HG-P09 | **Enforcement decision** | Maps a coherent condition snapshot to visibility, fallback, gate or refusal | changing the underlying facts or evidence |
| HG-P10 | **Hard point** | Places qualified grounding at a decision boundary for a declared purpose, time and reliance set, with complementary softness | that evidence, intent or configured severity alone makes the future dependable |
| HG-P11 | **Operation descriptor** | Gives agents, humans and automation one typed read/command meaning across interfaces | a transport-specific semantic fork |

## Grounding source and protocol

A grounding source is the backing mechanism. A protocol is the maintained
interpretation and harness for that mechanism in a domain. A hard point is the
resulting coordination structure, not another name for either one. Keeping the
three separate allows the same PostgreSQL server to support several protocol
versions and prevents a TypeScript wrapper from inheriting PostgreSQL's
authority merely by naming it.

```ts
export const postgres = defineProtocol({
  meta: {
    name: '@tanstack/trust-postgres',
    version: '0.1.0',
    trustApi: '^0.1.0',
  },

  sources: {
    server: defineGroundingSource({
      kind: 'substrate',
      identity: postgresServerIdentity,
    }),
    catalog: defineGroundingSource({
      kind: 'observer',
      identity: catalogSnapshotIdentity,
    }),
  },

  subjects: {
    schema: defineSubject(postgresSchemaSchema),
    constraint: defineSubject(postgresConstraintSchema),
    operation: defineSubject(postgresOperationSchema),
    query: defineSubject(postgresQuerySchema, { extends: 'operation' }),
    mutation: defineSubject(postgresMutationSchema, { extends: 'operation' }),
  },

  facts: {
    statement: defineFact(postgresStatementSchema),
    effects: defineFact(sqlEffectsSchema),
    source: defineFact(sourceMappingSchema),
  },

  laws: {
    uniqueConstraint: defineLaw({
      on: 'constraint',
      backedBy: postgres.sources.server.refusal({ sqlState: '23505' }),
      requires: postgres.facts.catalogConstraint,
    }),
  },
})
```

The catalog fact says that a particular unique constraint exists in a captured
schema. The law says what PostgreSQL does when that constraint applies. Their
combination can establish a current guarantee about one operation. Neither says
that an adapter discovered every relevant constraint.

An adapter publishes a source-bound batch:

```ts
export const drizzle = postgres.defineAdapter({
  meta: { name: '@tanstack/trust-postgres-drizzle', version: '0.1.0' },
  compile(project, ctx) {
    return ctx.publish({
      subjects: discoverOperations(project),
      facts: extractStatementsEffectsAndSources(project),
      dependencies: captureCompilerInputs(project),
      unsupported: collectUnsupportedConstructs(project),
    })
  },
})
```

Unknown or unsupported analysis is part of the batch. Publication is atomic and
versioned. Recompilation supersedes current facts without deleting evidence
history.

## Lifecycle subject graph

Protocols connect their subjects through typed, versioned relations:

```ts
const implementsRequirement = defineRelation({
  from: product.subjects.requirement,
  to: product.subjects.feature,
  cardinality: 'many',
})

const servedByEndpoint = defineRelation({
  from: product.subjects.feature,
  to: endpoints.subjects.endpoint,
  cardinality: 'many',
})

const executesOperation = defineRelation({
  from: endpoints.subjects.query,
  to: postgres.subjects.operation,
  cardinality: 'one',
})

const presentInDeployment = defineRelation({
  from: build.subjects.artifact,
  to: deploy.subjects.release,
  cardinality: 'many',
})
```

Relationships do not copy evidence and are not logical equivalence. Each edge
records its producer, source context, confidence or explicit unknown, version
and compatibility contract. This permits an agent editing one query to traverse
outward to the product requirement, deployment and production SLOs that may be
affected.

## Typed statements

`HG-P04` retains four modalities:

| Statement | Meaning | Example |
|---|---|---|
| **Fact** | Snapshot-relative description reported by a source | query reads `recipes` under analyzer version X |
| **Law** | Behavior a substrate enforces or refuses in a declared domain | PostgreSQL rejects a duplicate covered by a unique constraint |
| **Guarantee** | Consequence derived from facts, laws and domain semantics | this mutation cannot affect this retained query result |
| **Requirement** | Authorized statement that must be established for a use | new production queries require p99 below one second |

A requirement may exist before any evidence. A guarantee may be proposed before
its establishment route is admitted. A fact can be accurate without satisfying
any requirement. The statement kind never derives from message severity.

## Establishment routes

A statement may have alternate routes, while each route may require joint
premises. The public authoring API supplies compact constructors; the lowered
argument graph remains available when needed.

```ts
const productionLatency = postgres.defineRequirement({
  code: 'production-latency',
  on: postgres.subjects.query,
  options: schema.object({
    p99Ms: schema.number(),
    minSamples: schema.number().int(),
    maxAge: durationSchema,
  }),
  establishedBy: oneOf(
    evidence(postgres.evidence.executionProfile),
    guarantee(postgres.guarantees.certifiedLatencyBound),
  ),
})
```

An establishment route identifies its expected evidence contract, joint
premises, accepted producers, coverage, omissions, dependency selectors and
qualification functions. Installing a package does not admit its routes.

## Five paths to hardness

The forms below are reusable paths composed from HG-P01–HG-P10. They are not
ranks and may overlap in one hard point. Native refusal can directly make a
future transition dependable. A derivation, oracle result, observation or
requirement usually remains a candidate ground until qualification and an
enacted boundary make it safe to rely upon.

### HG-FM01 — Native hardness

**Context:** a substrate already constrains accepted behavior. **Response:** a
protocol exposes its law or refusal plus the current facts needed to apply it.
**Example:** PostgreSQL catalog state plus SQLSTATE behavior establishes how a
unique constraint affects an insert. **Limit:** the protocol still depends on
correct discovery, current schema identity and the declared PostgreSQL scope.
The hard point is PostgreSQL's actual refusal at the write boundary, not the
catalog row or Trust declaration by itself. Schema migration is the
complementary path for changing that constraint.

### HG-FM02 — Derived hardness

**Context:** no single substrate states the desired guarantee, but admitted
facts and laws support a deterministic derivation. **Response:** a higher-level
protocol publishes the derivation and its inputs. **Example:** Endpoints combines
PostgreSQL read/write effects with collection authority to derive when a refetch
may be skipped. **Limit:** correctness depends on the analyzer, derivation and
the completeness of every premise. The derivation would become a hard point
only when the runtime refuses the optimized path unless the qualifying result
is current; the current prototype certificate explicitly does not enact that
policy.

```ts
const safeSkipRefetch = endpoints.defineGuarantee({
  code: 'safe-skip-refetch',
  on: endpoints.subjects.refreshDecision,
  from: [
    postgres.facts.effects,
    endpoints.facts.collectionAuthority,
    endpoints.facts.buildIdentity,
  ],
  derive({ query, mutation, authority }) {
    return interpretSkipVerdict(canSkipRefetch(query, mutation, authority))
  },
})
```

The compiler publishes the derivation result and input refs in one batch. Trust
does not execute arbitrary derivation code during a read.

### HG-FM03 — Oracle hardness

**Context:** expected behavior can be modeled independently and compared against
the production path over generated histories. **Response:** a package supplies
the model, generators, runner, checkpoint, observation, comparator, shrinker and
replay contract.

```ts
export const selectiveRefreshOracle = endpoints.defineOracle({
  code: 'selective-refresh-equivalence',
  target: endpoints.runtime.selectiveRefresh,
  model: authoritativeRefetchModel,
  histories: fc.array(endpointHistoryArbitrary),
  execute: runProductionEndpointHistory,
  checkpoint: mutationPublicationCheckpoint,
  observe: observableCollectionState,
  compare: exactCollectionEquivalence,
  shrink: preserveFailureSignature,
  evidence: endpoints.evidence.oracleCampaign,
  dependencies: endpointOracleDependencies,
})
```

One campaign records model/generator/runner/comparator versions, seed, run count,
generated dimensions, coverage cells, checkpoint reach, mismatches, shrunk
replays, hostile mutants, cleanup and known omissions. No counterexample in N
histories is bounded evidence, not proof outside the campaign. The record can
help establish a CI or release hard point, but the campaign alone does not
create one.

### HG-FM04 — Observed hardness

**Context:** a property depends on behavior in an environment that static
analysis or a finite model does not fully capture. **Response:** an admitted
provider produces a bounded, attributable observation.

```ts
export const neon = postgres.defineEvidenceProvider({
  meta: { name: '@neondatabase/tanstack-trust', version: '0.1.0' },
  methods: {
    productionSample: postgres.evidence.executionProfile.method({
      input: schema.object({
        samples: schema.number().int().min(1),
        predicates: predicateSamplingSchema,
      }),
      plan({ query, input }) {
        return {
          query,
          environment: 'production',
          executions: input.samples,
          predicates: input.predicates,
          readOnly: true,
          stoppingRule: { kind: 'count', value: input.samples },
        }
      },
      run: runNeonProductionSample,
      dependencies: postgresDependencies.statementSchemaDataAndEnvironment,
      attest: neonRunAttestation,
    }),
  },
})
```

Calling the result statistical evidence requires more than randomized inputs.
The contract must state the population, sampling distribution, dependence among
observations, stopping rule, estimator, uncertainty or confidence semantics,
calibration and drift boundary.

The observation is still evidence rather than hardness in isolation. A hard
point appears only when a current, adequate observation is connected to a
reliable consumer—such as a deployment service that refuses a release lacking
the required latency result.

### HG-FM05 — Required hardness

**Context:** an authorized product, security or engineering owner decides that a
statement must be established before an action. **Response:** configuration
activates the requirement, names acceptable routes and assigns enforcement.

```ts
export default defineTrustConfig({
  use: [product, postgres, drizzle, endpoints, neon],
  require: [
    postgres.queries().require(
      postgres.requirements.productionLatency({
        p99Ms: 1_000,
        minSamples: 30,
        maxAge: days(7),
        evidence: neon.methods.productionSample,
      }),
    ),
  ],
  policy: {
    development: { unmet: 'warn' },
    ci: { unmet: 'block' },
  },
})
```

The requirement's authority comes from its admitted owner and scope. Evidence
establishes or defeats it. Policy supplies the practical force. These are three
separate relations. Even together they create only pseudo-hardness if the
purported gate can be bypassed or its result is ignored. Required hardness is
realized at the boundary that reliably accepts, refuses or commits the future
transition.

## Qualification

Every use of evidence produces two inspectable decisions:

```ts
interface QualificationDecision {
  statement: StatementRef
  evidence: EvidenceRef
  adequacy:
    | { status: 'supports'; reasons: Reason[] }
    | { status: 'contradicts'; reasons: Reason[] }
    | { status: 'inconclusive'; reasons: Reason[] }
  applicability:
    | { status: 'current'; captured: DependencySlice }
    | { status: 'stale'; changed: DependencyDelta[] }
    | { status: 'unknown'; missing: DependencyNeed[] }
}
```

Adequacy asks whether the result bears enough weight for the statement: for
example, whether a campaign covered the required histories or a latency profile
meets the requested sample count and threshold. Applicability asks whether the
result concerns the current subject and context: for example, the same SQL,
schema, build, deployment, data population and freshness window.

Exact dependency matching and age limits have simple derived defaults. A domain
may supply a versioned custom decision when equivalence or scope subsumption is
needed. The function runs only in a bounded command over frozen inputs.

Qualification determines whether evidence may participate in a hard point; it
does not place that hard point. Placement additionally names the coordination
purpose, validity interval, downstream decision boundary, durability and legal
ways to challenge, revise or except it.

## Product requirements through production

A product protocol can give product intent the same traceability without
pretending it has database or runtime authority:

```ts
export const product = defineProtocol({
  meta: { name: '@acme/trust-product', version: '1.0.0' },
  sources: {
    owners: defineGroundingSource({ kind: 'authority' }),
    research: defineGroundingSource({ kind: 'observer' }),
  },
  subjects: {
    requirement: defineSubject(productRequirementSchema),
    journey: defineSubject(userJourneySchema),
  },
  requirements: {
    checkoutCompletes: defineRequirement({
      on: 'journey',
      establishedBy: allOf(
        evidence(product.evidence.acceptanceOracle),
        evidence(product.evidence.productionFunnel),
      ),
    }),
  },
})
```

The human-owned requirement, acceptance model and production funnel observation
remain different. A code edit can be related to the journey through typed graph
edges, allowing Trust to expose relevant obligations before the agent changes
the endpoint and again after production evidence arrives. The product intent is
not yet hard merely because an authorized person entered it: the actual
acceptance, merge, rollout or operating boundaries must enact the intended
commitment.

## Conditions, stigmergic work and proposals

An active requirement with no qualifying route produces a policy-free
condition. Condition kinds distinguish missing evidence, contradiction,
inconclusive evidence, stale or unknown applicability, unreachable method, open
challenge, invalid configuration, unadmitted definition and operation failure.

Actionable conditions project deduplicated todos:

```ts
const page = await trust.todos.list({
  state: 'ready',
  subject: changedFeature,
  includeRelated: true,
})

const lease = await trust.todos.claim({
  todo: page.items[0].ref,
  expectedVersion: page.items[0].version,
})
```

Todos are shared environmental traces for agents. Claims return fencing tokens;
late workers cannot mutate a newer lease. Closing work recomputes the condition
and never creates evidence.

An agent may submit a proposed statement, protocol relation, derivation,
evidence method, oracle kit or qualification. The proposal carries source,
tests, declared limits and review work. It becomes usable only after a separate
authority admits the exact version. This lets agents help locate hardness
without authorizing their own discoveries.

## Evidence operations

Every evidence-producing route follows the same outer protocol:

```text
discover requirement
  → choose an admitted establishment route
  → create a bounded run plan
  → obtain capability for its source/environment
  → execute or submit a complete result
  → validate and commit atomically
  → qualify against the current subject graph
  → update hard points, conditions and work in one new snapshot
```

A plan fixes subjects, cases, method/runtime versions, expected cardinality or
stopping rule, dependency slice, coverage, omissions and authority. Failure,
cancellation, unreachable production, malformed output and cleanup failure add
no evidence. An indeterminate delivery is reconciled before retry.

Evidence is immutable. Dependency changes advance monotonic revisions; returning
to earlier bytes does not revive an older record. A failed claim is repaired
only by a causally later applicable observation addressing the same violation.

The sequence itself can create useful hardness. Trust cannot issue a current
decision token before evidence is committed and qualified, and a downstream
boundary can require that token before accepting a deployment. Reordering those
steps must be impossible, not merely discouraged in documentation. An advisory
report that a later system can ignore supplies guidance, not the same hard
point.

## Configuration and enforcement

Package defaults, project requirements and source-local declarations lower into
one inspectable configuration. Every fragment retains its selector, authority,
merge, source span and exclusion reason. A local declaration may add a
requirement or tighten a compatible bound. Weakening a higher-authority
requirement requires an explicit, independently authorized exception.

Policy evaluates one condition snapshot at an explicit instant. A temporary
exception changes only the selected action for exact subjects, conditions and
profiles until a server-owned deadline. It does not hide the condition or alter
evidence. A preview runs the same scope, overlap and authority checks but returns
no deployable decision token.

Policy becomes hard only where a named consumer reliably enacts its decision.
Trust records that decision boundary, the token or refusal it honors, and the
transitions that can bypass it. A configured `block` with no enforced consumer
is reported as pseudo-hardness rather than represented as a gate.

A sealed config preview can show what evidence and work would become necessary
if a global level or product requirement changed. It writes no live condition,
todo or evidence state. Preview, challenge, revision and time-bounded exception
are complementary softness: they let a protocol evolve or legally leak without
pretending the hard point never existed.

## Shared operations and messages

One versioned registry defines runtime schemas, capabilities, snapshot behavior,
receipts and errors for:

```ts
trust.status.get(input)
trust.explain.get(input)
trust.graph.related(input)
trust.hardness.list(input)
trust.hardness.explain(input)
trust.todos.list(input)
trust.todos.claim(input)
trust.todos.renew(input)
trust.todos.note(input)
trust.todos.release(input)
trust.todos.close(input)
trust.evidence.plan(input)
trust.evidence.run(input)
trust.evidence.submit(input)
trust.evidence.reconcile(input)
trust.policy.evaluate(input)
trust.policy.previewException(input)
trust.policy.createException(input)
trust.preview.config(input)
trust.proposals.submit(input)
trust.proposals.list(input)
trust.admissions.list(input)
trust.admissions.decide(input)
trust.changes.since(input)
```

Reads are snapshot-bound and side-effect-free. Commands are capability-checked,
idempotent and expected-version operations. Action descriptors bind directly to
one operation and input schema so an agent never guesses how a diagnostic maps
to a tool.

The MCP projection remains task-shaped: `trust_status`, `trust_explain`,
`trust_graph`, `trust_todos`, `trust_evidence`, `trust_policy` and
`trust_proposals`. CLI, LSP and Devtools are generated from the same registry.
LSP covers versioned source contexts; it is not the boundary of the system.

An agent-facing condition renders from a shared structure:

```text
product/checkout-completes — production evidence expired
Checkout changes touch endpoint `submitOrder` and query `inventoryForCart`.

Required: acceptance oracle passes and production completion remains ≥ 99.5%.
Established: acceptance oracle passed for build 8f12.
Missing: current production-funnel evidence for deployment prod-184.
Why required: checkout-v3 product requirement, admitted by Product Council.
Enforced by: deployment service requires a current Trust decision token.
Next: gather the production funnel, inspect affected subjects, or request an exception.
Softness: an authorized, expiring exception may permit this deployment while retaining the gap.
Limits: funnel completion does not establish correctness for abandoned sessions.
```

The structured record includes statement and source refs, affected subjects,
current establishment routes, evidence, causes, limits, authority, legal
actions, locations and snapshot. Consumer policy determines warning or error
presentation without changing the condition.

## Active overlaps

1. **Ground and interpretation:** a source resists, tests or authorizes a claim;
   a protocol states how that source bears on typed subjects. Neither can
   replace the other.
2. **Evidence and hardness:** a record may warrant a statement, while a hard
   point additionally requires current qualification, a coordination purpose
   and an enacted boundary. Neither can be collapsed into the other.
3. **Hardness and softness:** refusal supports coordination while unknowns,
   challenges, fallbacks, revision and authorized exceptions preserve the
   protocol's ability to adapt.
4. **Past, present and future:** immutable evidence records what happened,
   applicability decides what remains current, and enforcement makes a future
   transition dependable.
5. **Product and runtime:** a product requirement and a production observation
   may concern one user journey while retaining different authorities.
6. **Native and derived hardness:** Endpoints depends on PostgreSQL facts without
   becoming their owner.
7. **Oracle and observed hardness:** a model campaign and production telemetry
   can jointly support a requirement without being interchangeable.
8. **Condition and todo:** one semantic gap creates work, but work state cannot
   change semantic status.
9. **Source and configuration:** a source-local declaration is both code context
   and a config fragment; provenance and authority must survive lowering.

These overlaps form a graph rather than a clean package tree. Flattening them
would transfer authority or duplicate evidence.

## Dynamics

| ID | Legal transformation |
|---|---|
| HG-D01 | Project or update a grounding source through a versioned protocol. |
| HG-D02 | Publish or supersede a source-context batch of subjects, relations and facts. |
| HG-D03 | Derive a guarantee from admitted facts, laws and semantics. |
| HG-D04 | Plan and execute an oracle campaign or environment observation. |
| HG-D05 | Activate a requirement and resolve its establishment routes. |
| HG-D06 | Qualify evidence for adequacy and current applicability. |
| HG-D07 | Place, renew, expire, challenge or revise a hard point for a declared purpose and time. |
| HG-D08 | Open, reactivate, resolve or supersede conditions and fenced work. |
| HG-D09 | Evaluate live policy or a sealed counterfactual without changing evidence. |
| HG-D10 | Propose and independently admit a new source, statement, method or route. |
| HG-D11 | Project one operation/state model across agent and human interfaces. |
| HG-D12 | Harden an ordered transition by issuing and consuming a current decision token only after its prerequisites. |

## Constraints

| ID | Invariant |
|---|---|
| HG-C01 | Every consequential statement names its source, modality, scope, authority, dependencies and limits. Every hard point additionally names its purpose, time, reliance set, effect and complementary softness. |
| HG-C02 | Native, derived, oracle, observed and required paths are not collapsed into a strength score or assumed to be hard merely because they emitted a record. |
| HG-C03 | Unknown and unsupported inputs cannot become support. |
| HG-C04 | Relations permit traversal and reuse but never imply equality or transfer ownership. |
| HG-C05 | A requirement cannot be changed by evidence; policy cannot manufacture evidence. |
| HG-C06 | An oracle campaign records reach, generated domain, result and omissions; a green campaign is bounded evidence. |
| HG-C07 | Statistical claims declare population, sampling, dependence, stopping and uncertainty semantics. |
| HG-C08 | Production operations are planned, authorized, bounded, attributable and atomically committed. |
| HG-C09 | Work, proposals, edits, PRs, cache hits and successful delivery are not evidence or authority. |
| HG-C10 | A package or agent cannot admit its own semantics or grant its own deployment exception. |
| HG-C11 | Source-local declarations cannot weaken higher-authority requirements. |
| HG-C12 | Every interface preserves refs, causes, routes, evidence, limits, authority and snapshot identity. |
| HG-C13 | Pure reads execute no package code; writes are idempotent, version-checked and auditable. |
| HG-C14 | Hardness sufficiency or excess is assessed only relative to a declared coordination purpose; more force or durability is not automatically better. |
| HG-C15 | Every evolvable hard point exposes its legal challenge, revision, expiry, fallback or exception path; an irreversible point declares that fact. |
| HG-C16 | A displayed or configured gate that no named boundary reliably enacts is pseudo-hardness and cannot be reported as a hard point. |
| HG-C17 | Past evidence, present applicability and future refusal remain distinct; stale evidence cannot harden a later transition. |

## Boundary conditions

- The executable prototype contains a finite Trust kernel, one Endpoints
  guarantee, a SQL-effects compiler path and shared local CLI/LSP/MCP service.
- PostgreSQL protocol packaging, SQL-library adapters, Neon production sampling,
  lifecycle subject integration and product-requirement protocols are proposed.
- Authentication, signature governance, hostile extension isolation,
  multi-writer persistence, statistical calibration and institutional admission
  topology remain unresolved implementation work.
- No prototype deployment service currently consumes a Trust decision token, so
  the design's enacted future-refusal path and pseudo-hardness detection remain
  unimplemented.
- No independent second domain has tested this grammar's range.

## Adjacent generated forms

These forms exercise distinct transformations. They are possibilities under the
grammar, not product recommendations.

### HG-G01 — Product requirement adapter

**Route:** augmentation. A project imports requirements and owner decisions from
an existing product system, maps them to product subjects, and links them to
features and acceptance models. The invariant is that imported authority and
source history remain external facts rather than Trust-created authority. New
coordination cost: identity and update reconciliation. Loss: informal product
context may not survive the typed representation.

### HG-G02 — Build provenance protocol

**Route:** port. A build system exposes artifacts, dependency graph, compiler
results and reproducibility attestations as subjects, facts and establishment
routes. Product, code and deployment protocols can then require an exact build
lineage. New coordination cost: artifact identity and remote-cache trust. Loss:
reproducible bytes do not establish runtime correctness.

### HG-G03 — Combined oracle and canary requirement

**Route:** rule combination. A deployment requirement needs both an Endpoints
model campaign and a production canary observation before rollout. Each route
keeps separate coverage, applicability and failure semantics. New coordination
cost: joining build, deployment and observation clocks. Loss: both checks may
share an unrecognized model assumption.

### HG-G04 — Ordered deployment gate

**Route:** rule combination. A deployment service accepts only a decision token
issued after evidence commit, current qualification and policy evaluation for
the exact build and release. The ordering itself creates a hard point: the
release cannot precede the check. An expiring, independently authorized
exception is the complementary soft path. New coordination cost: token
freshness and reconciliation after indeterminate delivery. Loss: a correctly
ordered gate can still enforce the wrong requirement or rely on a bad model.

## Exclusions and decomposition loss

The grammar should not generate:

- an ordinary linter whose source callback and severity exhaust the state;
- an observability dashboard that treats available metrics as automatically
  adequate for an unstated requirement;
- a product checklist whose completion stands in for implementation or runtime
  evidence;
- a CI configuration that says `block` while deployment can ignore or bypass
  it;
- a universal trust score detached from subjects, sources and applicability; or
- an autonomous agent that proposes, admits, verifies and deploys its own route;
  or
- a system that maximizes refusal or ossification without a stated purpose,
  revision path or complementary softness.

Decomposition cannot establish whether a product requirement is legitimate,
whether a model captures the behavior people care about, whether an analyzer is
sound, whether telemetry is representative, or whether an institution should
hold authority. The typed graph also makes hardness appear discrete even though
teams often discover it gradually through failure and practice. Trust can
preserve these limits and revision paths; it cannot decide that a particular
amount or placement of hardness is wise, and it cannot make those limits
disappear.
