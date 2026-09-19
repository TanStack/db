# Model — TanStack Trust: Protocol Discovery and Engineering

## Central reading

Trust begins with a question about the future: **what condition would be
valuable enough to rely on?** It then works backward to a protocol that can make
that condition sufficiently certain now. The protocol may expose hardness that
already exists, such as PostgreSQL refusing a duplicate key, or engineer new
hardness, such as refusing deployment until a new query has current production
latency evidence.

LLMs change the economics of this work. They can generate many candidate
protocols, proofs, tests and combinations of cloud operations. They remain poor
judges of their own output. Trust therefore composes an untrusted, abundant
generator with fast, independently grounded verifiers. Counterexamples feed the
next generation. Admission occurs only after the declared verifier portfolio
passes and an authorized owner accepts the exact protocol version.

```text
 valued future
      │
      ▼
 guarantee target ──► candidate protocol ──► fast verifier
                            ▲                      │
                            └── counterexample ───┘
                                      │
                                passing candidate
                                      │
                                      ▼
                             independent admission
                                      │
                                      ▼
 grounding + operations ──► enacted hard point ──► monitoring/renewal
       native or cloud           with softness           │
             ▲                                           └── new search
             └──────────── project/package ecosystem ───────────────┘
```

The result is both a protocol workshop and a protocol runtime. The workshop
helps a project discover a local hardening recipe and helps package authors
generalize useful mechanisms. The runtime gives an admitted recipe a concrete
TypeScript representation, executes its bounded operations and exposes one
meaning through LSP, MCP, CLI and Devtools.

## Candidate primitives

| ID | Candidate | Job | Must not imply |
|---|---|---|---|
| PE-M01 | **Guarantee target** | Names a valued future condition, subjects, beneficiary, horizon, required certainty, hard constraints and preferences | that desire establishes reality or authority outside its owner |
| PE-M02 | **Lifecycle subject graph** | Relates product, source, query, build, deployment and production identities across owners | equality or transferred authority merely because two subjects are related |
| PE-M03 | **Typed proposition** | Distinguishes facts, native laws, derived guarantees, measurements and normative requirements | that a registered proposition is established |
| PE-M04 | **Hardness primitive** | Describes a reusable source, verifier input or bounded operation that can observe, simulate, constrain, control, attest or refuse | that every primitive is independently hard or safe to invoke |
| PE-M05 | **Protocol design** | Gives a target an ordered hardening recipe, verifier portfolio, enforcement boundary, maintenance rule and complementary softness | that a candidate is admitted or effective |
| PE-M06 | **Verifier** | Judges one declared property over one domain and returns pass, counterexample or inconclusive with replay and limits | general quality, authority or correctness outside that property |
| PE-M07 | **Search campaign** | Retains generator proposals, verifier results, counterexamples, measurements, budgets and lineage across iterations | that iteration count or model confidence is evidence |
| PE-M08 | **Admission decision** | Authorizes one immutable protocol, primitive or verifier version for named scopes and capabilities | that package installation, popularity or a passing inner-loop test grants authority |
| PE-M09 | **Evidence record** | Preserves one attributable observation, derivation, campaign, refusal, attestation or admission result | current applicability or permission to act |
| PE-M10 | **Qualification** | Separately decides whether evidence is adequate for a proposition and current for a subject/context | enforcement or value judgment |
| PE-M11 | **Hard point** | Records native or engineered certainty people may rely on, its temporal placement, enacted consumer and legal softness | that a warning, score or configured gate is unbypassable |
| PE-M12 | **Condition, work and history** | Makes gaps, challenges, expiry, failed operations and agent todos queryable without changing semantic state | that claiming or closing work supplies evidence |
| PE-M13 | **Operation descriptor and capability** | Gives agents one typed, authorized meaning for reads and effects across every interface | permission from tool visibility or transport-specific semantics |

## Two distinct but connected levels

### Level 1: protocol discovery

Discovery works over proposals. It starts from PE-M01, exposes a palette of
admitted primitives, and lets generators propose PE-M05 designs. Verifiers judge
the candidates. A search campaign retains every attempt and counterexample so a
new agent can continue without treating the trace as truth.

The result is a **protocol proposal**: an immutable candidate definition,
supporting evidence, verifier results, limits and requested capabilities. It has
no runtime authority.

### Level 2: protocol execution

Admission binds an exact proposal version to subjects, environments,
capabilities and authority. The same protocol structure then becomes executable:
providers gather evidence or control systems, qualification determines what is
current, and an actual consumer enacts the hard point. Runtime failure or drift
can reopen the design target and begin another search campaign.

The separation is asymmetric. Discovery may inspect admitted runtime metadata.
It may not mutate live evidence, invoke production capabilities or install its
own result without the corresponding operation and authority.

## Guarantee targets

A target contains both hard requirements and explicitly softer preferences.
This prevents “great” from becoming an LLM judgment or a hidden scalar score.

```ts
const fastNewQuery = defineGuaranteeTarget({
  code: 'new-query-is-safe-and-fast',
  on: postgres.subjects.query,
  valuedBy: team('checkout'),
  future: {
    event: deploy.events.release,
    horizon: days(7),
  },
  must: [
    postgres.guarantees.executesSuccessfully,
    latency.p99.below(ms(1_000)),
  ],
  prefer: [
    minimize(cloudCost),
    minimize(timeToEvidence),
  ],
  unacceptable: [productionWrite, unboundedLoad],
})
```

`must` is verified as predicates with explicit inconclusive states. `prefer`
produces separately named measurements and a Pareto set; an LLM does not fold
them into an opaque score. The authorized owner chooses among incomparable
passing candidates.

## Hardness primitives

A primitive is a reusable building block, not automatically a protocol or hard
point.

| Effect | Example | What it can contribute |
|---|---|---|
| `observe` | production latency sample | attributable evidence about an environment |
| `simulate` | fast-check model campaign | bounded falsification and counterexamples |
| `analyze` | PostgreSQL/TypeScript compiler | derived facts, unknowns and impossibilities |
| `constrain` | database constraint | native refusal at a substrate boundary |
| `control` | feature flag or staged rollout | bounded exposure, fallback and reversibility |
| `attest` | signed build provenance | stable identity and origin |
| `refuse` | deployment token consumer | engineered sequencing and admission |

```ts
export const productionSample = defineCloudPrimitive({
  code: 'neon/production-sample',
  effect: 'observe',
  on: postgres.subjects.query,
  input: schema.object({
    executions: schema.number().int().positive(),
    predicates: predicateSamplingSchema,
  }),
  capability: neon.capabilities.readOnlyProductionQuery,

  plan({ subject, input, environment }) {
    return {
      subject,
      environment,
      executions: input.executions,
      predicates: input.predicates,
      stoppingRule: count(input.executions),
      timeout: minutes(2),
    }
  },

  run: runProductionSample,
  validate: productionSampleResultSchema,
  produces: postgres.evidence.executionProfile,
  dependencies: [sql, schemaVersion, dataPopulation, environment],
  cleanup: 'none',
  limits: ['sampled predicates', 'read-only', 'no plan-stability claim'],
})
```

Planning is pure. Execution requires a scoped capability and produces an
immutable, schema-validated result. Cancellation, partial output, unreachable
production, cleanup failure and indeterminate delivery do not produce favorable
evidence. Reconciliation precedes retry.

## Protocol designs and hardening recipes

The common authoring surface makes the causal sequence visible without exposing
the lowered evidence graph in ordinary code.

```ts
export const productionReadyQuery = defineProtocol({
  meta: { code: 'postgres/production-ready-query', version: 1 },
  target: fastNewQuery,

  harden: sequence(
    run(neon.primitives.productionSample, {
      executions: 30,
      predicates: representativePredicates,
    }),
    verify(latency.verifiers.p99BelowTarget),
    gate(deploy.boundaries.release),
  ),

  maintain: reverify({
    when: anyOf(sql.changed, schema.changed, deployment.changed, after(days(7))),
  }),

  soften: {
    fallback: featureFlags.disableQuery,
    exception: expiringException({ max: hours(24), authority: releaseManager }),
    challenge: trust.operations.challenges.open,
  },
})
```

This protocol creates hardness that the production observation did not contain.
The observation supports the guarantee; the ordered release gate makes a later
deployment depend on it. The feature flag, exception and challenge path are
complementary softness. If the deploy service can ignore the gate, Trust reports
pseudo-hardness rather than an enacted hard point.

A protocol exposing existing PostgreSQL hardness is different:

```ts
const uniqueConstraint = postgres.defineNativeProtocol({
  code: 'unique-constraint',
  on: postgres.subjects.constraint,
  law: postgres.laws.rejectsDuplicate,
  groundedBy: postgres.server.refusal({ sqlState: '23505' }),
  currentWhen: postgres.catalog.constraintExists,
})
```

An editor diagnostic may predict that a query will encounter this refusal. The
diagnostic does not create new hardness. A dev-time admission protocol that
prevents the query from progressing until it passes a production-shaped check
does.

## Verifier contract

Verifiers return structured judgments, never an unqualified score:

```ts
type Verification<Counterexample, Witness> =
  | {
      status: 'pass'
      witness: Witness
      coverage: Coverage
      limits: readonly Limit[]
    }
  | {
      status: 'fail'
      counterexample: Counterexample
      replay: OperationRef
      violated: PropositionRef
    }
  | {
      status: 'inconclusive'
      missing: readonly EvidenceNeed[]
      limits: readonly Limit[]
    }
```

```ts
export const selectiveRefreshEquivalence = defineVerifier({
  code: 'endpoints/selective-refresh-equivalence',
  property: endpoints.guarantees.matchesAuthoritativeRefetch,
  domain: endpointHistoryDomain,
  reference: authoritativeRefetchModel,
  generate: endpointHistoryArbitrary,
  execute: runProductionEndpointHistory,
  checkpoint: mutationPublicationCheckpoint,
  compare: exactCollectionState,
  shrink: preserveFailureSignature,
  replay: replayEndpointHistory,
  faultControls: selectiveRefreshMutants,
  budget: { p95: seconds(2) },
  limits: ['bounded generated domain', 'trusted observation adapter'],
})
```

Fast means the verifier can sit in the candidate loop; it does not weaken reach,
reference independence, fault controls or output completeness. Statistical
claims additionally declare population, sampling distribution, dependence,
stopping, estimator, calibration and uncertainty semantics.

### Verifier portfolios

Visible counterexamples make iteration productive and also make overfitting
possible. A protocol search therefore separates:

- **inner-loop verifiers**, which are cheap, replayable and return full
  counterexamples;
- **admission verifiers**, which use independently maintained fault controls,
  rotated or sealed cases where appropriate, and cannot be modified by the
  candidate generator; and
- **runtime verifiers**, which monitor whether the deployed guarantee remains
  applicable.

A shared model assumption can still defeat the whole portfolio. Trust records
lineage and overlap; it does not call several correlated checks independent.

## Generator–verifier search

```ts
export const queryHardeningSearch = defineProtocolSearch({
  target: fastNewQuery,
  palette: [
    postgres.native,
    endpoints.oraclePrimitives,
    neon.productionPrimitives,
    project.localPrimitives,
  ],
  generator: untrustedAgentGenerator({ maxCandidatesPerRound: 8 }),
  verify: verifierPortfolio({
    inner: [protocolTypecheck, capabilitySafety, latencySimulation],
    admission: [sealedSafetyCases, selectiveRefreshEquivalence],
    runtime: [latencyDrift],
  }),
  budget: {
    rounds: 100,
    cloudCost: usd(20),
    wallTime: hours(2),
  },
  select: pareto({ by: [cloudCost, timeToEvidence] }),
})
```

The generator receives the target, admitted palette, public verifier contracts,
prior candidates and inner-loop counterexamples. It cannot change the target,
verifiers, budgets or admission authority. Each round is append-only and
replayable. Exhausting a budget returns the Pareto set and unresolved residue;
it does not choose a winner or lower the guarantee.

Campaigns are individually bounded and may be continued with a new authorized
budget. “Endless iteration” means the generator–verifier loop can keep improving
without requiring a person to judge every candidate; it does not mean unbounded
production capabilities, spend or wall time.

When a candidate passes the inner loop, Trust runs admission verification from
a clean candidate snapshot. A passing result creates a proposal, not an
admission. An authorized reviewer or policy operation selects an exact version.

## Agent-facing failure feedback

Every failure is structured to enable the next iteration:

```text
trust/protocol-candidate-failed — candidate query-gate@7

Target: new query executes successfully and remains below 1s p99 for 7 days.
Failed verifier: postgres/no-production-writes@3.
Counterexample: predicate generator produced `tenant_id = NULL`; candidate
  attempted a setup write in production.
Violated: productionWrite is unacceptable.
Replay: trust.verifiers.replay({ result: 'verify_01J...' }).
Preserved: latency target passed for the sampled domain.
Next legal actions: revise the candidate, choose an admitted read-only primitive,
  or inspect the counterexample trace.
Limits: this failure says nothing about latency representativeness.
```

The message separates the failed property from preserved results and from what
was never measured. Its actions carry exact operation references and schemas.
The agent never has to infer a tool name from prose.

## Project-local and package ecosystems

The same authoring contract supports three scopes:

1. **Project-local protocol:** a `trust/` module may describe proprietary
   subjects, internal cloud operations and organization-specific future value.
2. **Domain package:** PostgreSQL or Endpoints may publish reusable subjects,
   laws, verifiers and protocols.
3. **Provider package:** Neon may implement admitted operations over PostgreSQL
   subjects without redefining PostgreSQL truth.

```ts
export default defineTrustPackage({
  meta: {
    name: '@neondatabase/tanstack-trust',
    version: '0.1.0',
    trustApi: '^0.1.0',
  },
  extends: [postgres],
  capabilities: neonCapabilities,
  primitives: { productionSample, shadowQuery, stagedRollout },
  verifiers: { sampleIntegrity, latencyProfile },
  protocols: { productionReadyQuery },
  configs: { recommended: neonRecommended },
})
```

Registry publication makes metadata, compatibility, schemas, declared effects,
limits, tests and provenance discoverable. Installation makes code available.
Project admission decides which definitions and capabilities may run. These are
three different transitions.

A local discovery may be promoted to a package proposal with its original
target, evidence, counterexamples and limitations intact. Popularity and reuse
are search signals, not truth or permission.

## Layered authoring surface

Most users configure targets and admitted protocols. Protocol authors compose
primitives and verifiers. Provider authors implement capabilities. Only kernel
authors see the lowered proposition, evidence and dependency graph.

```ts
// Project user
export default defineTrustConfig({
  use: [postgres, endpoints, neon],
  require: [
    postgres.queries().require(productionReadyQuery),
  ],
  policy: {
    development: { unmet: 'diagnose' },
    ci: { unmet: 'block' },
  },
})
```

Source-local annotations may specialize subjects or tighten a target. They
cannot weaken a higher-authority requirement. Weakening uses an explicit,
scoped, expiring exception operation.

## Runtime evidence, qualification and hard points

Protocol execution preserves the distinctions from the discovery loop:

```text
primitive plan
  → capability grant
  → bounded execution
  → complete validated result
  → immutable evidence commit
  → adequacy + applicability
  → hard-point update or condition
  → decision token consumed by the named boundary
```

No later step may precede or stand in for an earlier one. Returning to earlier
dependency bytes does not revive stale evidence. A failed guarantee is repaired
only by causally later applicable evidence addressing the same violation.

Hard points record whether hardness is native or engineered, what people may
rely on, what event and horizon it covers, which consumer enacts it, how it can
expire or be challenged, and what fallback or exception is legal. A configured
`block` with no named consumer is a condition about missing enforcement, not a
hard point.

## Conditions and Bead-style work

Conditions cover missing or contradictory evidence, inconclusive or stale
qualification, verifier failure, budget exhaustion, unadmitted definitions,
unavailable capabilities, pseudo-hardness, open challenges and operation
failure. Actionable conditions project deduplicated todos with leases and
fencing tokens.

```ts
const todo = await trust.todos.claim({
  todo: 'todo_01J...',
  expectedVersion: 4,
})

const result = await trust.protocols.search.next({
  campaign: todo.subject.campaign,
  lease: todo.fence,
})
```

Closing a todo re-evaluates its condition. It never admits a protocol, creates
evidence or marks a verifier passed.

## Shared operation model

```ts
trust.targets.list(input)
trust.targets.explain(input)
trust.targets.propose(input)
trust.protocols.search.start(input)
trust.protocols.search.next(input)
trust.protocols.search.inspect(input)
trust.protocols.proposals.submit(input)
trust.protocols.get(input)
trust.verifiers.run(input)
trust.verifiers.replay(input)
trust.primitives.plan(input)
trust.primitives.run(input)
trust.primitives.reconcile(input)
trust.evidence.submit(input)
trust.hardness.list(input)
trust.hardness.explain(input)
trust.todos.list(input)
trust.todos.claim(input)
trust.todos.renew(input)
trust.todos.release(input)
trust.todos.close(input)
trust.admissions.list(input)
trust.admissions.decide(input)
trust.policy.evaluate(input)
trust.policy.previewException(input)
trust.policy.createException(input)
trust.registry.search(input)
trust.changes.since(input)
```

Reads are snapshot-bound and side-effect-free. Commands are schema-validated,
capability-checked, idempotent and expected-version operations. LSP projects
source-bound conditions and candidate failures. MCP groups operations into
task-shaped tools such as `trust_design_protocol`, `trust_test_protocol`,
`trust_gather_evidence` and `trust_todos`. CLI supplies stable reports and
separate exits for clean, policy-blocked and operational failure. Devtools shows
the same graph, search lineage, counterexamples, hard points and softness.

## Active overlaps

1. **Value and verification:** an owner defines what is valuable; a verifier
   tests a proposition. Neither can supply the other's authority.
2. **Generator and verifier:** the generator needs counterexamples to improve,
   while verifier definition and admission must remain outside its control.
3. **Visible and sealed verification:** visible cases enable iteration; clean
   admission cases test overfitting. Their results remain separate.
4. **Native and engineered hardness:** a protocol may expose a substrate refusal
   or use evidence and sequencing to create a new refusal earlier in the
   lifecycle.
5. **Protocol discovery and execution:** the same design structure crosses the
   boundary, while proposal state and runtime authority do not.
6. **Local and public protocols:** local context enables specific hardness;
   publication enables reuse but can erase boundary conditions.
7. **Observation and control:** a cloud provider may both measure production and
   control rollout; capabilities and evidence cannot inherit each other's
   authority.
8. **Hardness and softness:** gates support reliance while fallbacks, challenges,
   revision and exceptions preserve adaptation.
9. **Condition and work:** a semantic gap coordinates agent activity, but work
   state cannot change the semantic result.
10. **TypeScript and transported operations:** authoring types and wire schemas
    express the same contract but have different compatibility hazards.

## Dynamics

| ID | Legal transformation |
|---|---|
| PE-D01 | Author or revise a guarantee target under its value authority. |
| PE-D02 | Register a local primitive or discover admitted package primitives. |
| PE-D03 | Generate a bounded candidate protocol from a target and palette. |
| PE-D04 | Run inner verification and append structured counterexamples. |
| PE-D05 | Revise a candidate without changing its frozen target or verifier definitions. |
| PE-D06 | Run independent admission verification from a clean candidate snapshot. |
| PE-D07 | Submit, admit, reject, deprecate or replace an exact protocol version. |
| PE-D08 | Plan and execute an admitted primitive under a scoped capability. |
| PE-D09 | Commit and qualify evidence, then place, renew, expire or challenge a hard point. |
| PE-D10 | Evaluate and enact policy at a named consumer boundary. |
| PE-D11 | Promote a local design to a package proposal without erasing provenance or limits. |
| PE-D12 | Project the same state and operations through TypeScript, LSP, MCP, CLI and Devtools. |

## Constraints

| ID | Invariant |
|---|---|
| PE-C01 | Every target names value authority, subjects, future event or horizon, hard constraints, preferences and unacceptable actions. |
| PE-C02 | Generator output, self-critique, iteration count and popularity never supply verifier or admission authority. |
| PE-C03 | Every verifier names its proposition, domain, reference or ground, reach, result schema, replay, fault controls, dependencies and limits. |
| PE-C04 | Pass, fail and inconclusive remain distinct; measurements and preferences do not become proof predicates. |
| PE-C05 | Candidate-visible feedback cannot stand in for independent admission verification. Correlated verifiers declare shared lineage. |
| PE-C06 | A passing portfolio establishes only its declared conjunction over its captured domain and context. |
| PE-C07 | Statistical confidence additionally declares population, sampling, dependence, stopping, calibration and uncertainty semantics. |
| PE-C08 | Cloud operations are planned, authorized, bounded, attributable, cleanup-aware and atomically committed or reconciled. |
| PE-C09 | Installation, registry presence and package execution do not grant semantic admission or production capabilities. |
| PE-C10 | Evidence, qualification, enforcement, work, policy and authority remain distinct. |
| PE-C11 | A protocol creates engineered hardness only where an actual consumer makes the future transition depend on it. |
| PE-C12 | Every engineered hard point declares monitoring, expiry and complementary challenge, fallback, revision or exception paths. |
| PE-C13 | Source-local declarations cannot weaken higher-authority targets. |
| PE-C14 | Pure reads execute no package code; writes are idempotent, version-checked and auditable. |
| PE-C15 | All interfaces preserve target, candidate, verifier, counterexample, evidence, limits, authority, legal actions and snapshot identity. |
| PE-C16 | Range and promotion claims retain the local boundary conditions that produced the protocol. |

## Boundary conditions

- The executable prototype contains a finite evidence kernel, one Endpoints
  certificate, a SQL-effects compiler path and shared local CLI/LSP/MCP service.
- The current Endpoints certificate explicitly does not enact refresh policy.
- Protocol search campaigns, generator adapters, target APIs, verifier
  portfolios, registry behavior and Devtools views are proposed.
- PostgreSQL packaging, Neon cloud primitives, production capabilities,
  deployment-token consumption and product-system integration are proposed.
- Authentication, hostile package isolation, institutional admission topology,
  sealed-verifier operation, cost accounting and multi-writer persistence remain
  unresolved engineering work.
- No independent second domain has tested this grammar's range.

## Adjacent generated forms

### PE-G01 — Project-local protocol workshop

**Route:** augmentation. A project adds internal subjects, primitives and value
targets, then runs the same generator–verifier campaign without publishing its
sources. Preserved: admission and capability boundaries. New coordination cost:
maintaining local verifiers. Loss: useful knowledge may remain undiscoverable.

### PE-G02 — Provider hardness marketplace

**Route:** port. Cloud providers publish metadata and implementations for
bounded observe/control/refuse primitives over shared domain subjects. Preserved:
domain ownership and project admission. New coordination cost: capability,
billing and provenance interoperability. Loss: providers may optimize for
discoverability rather than epistemic value.

### PE-G03 — Continuous protocol evolution

**Route:** rule combination. Runtime drift opens a new search campaign using the
deployed protocol and failure as its baseline; a replacement must pass clean
admission before a controlled migration. Preserved: old hard-point history and
explicit softness. New coordination cost: version coexistence. Loss: repeated
local optimization may narrow the verifier domain.

### PE-G04 — Industry hardness atlas

**Route:** augmentation. Registries index targets, primitives, protocol designs,
counterexamples, transfer limits and negative results across ecosystems without
admitting them into any project. Preserved: source and local admission. New
coordination cost: vocabulary and identity reconciliation. Loss: catalogued
popularity can be mistaken for general validity.

## Exclusions and decomposition loss

The grammar should not generate:

- an LLM that proposes, judges, admits and deploys its own protocol;
- an endless loop whose only objective is to satisfy a verifier the generator
  can rewrite;
- a benchmark score presented as general quality or future certainty;
- a registry where installation or popularity grants runtime authority;
- a cloud tool whose visibility grants an agent permission to invoke it;
- a CI `block` that downstream deployment can ignore;
- a local protocol promoted as universal after passing only its home fixtures;
  or
- maximum hardness without a valued purpose or complementary softness.

Decomposition cannot determine what people should value, whether a verifier's
property captures that value, whether a sealed case remains independent, or
whether an institution deserves admission authority. The clean loop can hide
human labor in target formation, primitive construction and verifier upkeep.
Fast iteration can also intensify Goodhart pressure and converge on a narrow
proxy. Trust can preserve lineage, counterexamples and limits; it cannot turn an
underspecified objective into greatness.
