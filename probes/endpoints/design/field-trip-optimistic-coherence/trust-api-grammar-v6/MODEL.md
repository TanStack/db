# Model — TanStack Trust API Design Grammar v6

## Status and center

This is a design candidate, not an implemented public API. It re-centers v5 on
domain compilers and typed protocols. ESLint remains a useful donor for package,
configuration, message and test conventions; it is no longer the semantic
model.

```text
source code and database catalog
            │
            ▼
 SQL-library adapters ──► PostgreSQL protocol graph
                              │ subjects, relations, facts
                              ▼
                       Endpoints protocol graph
                              │ endpoint semantics + static evidence
                              │
 independent providers ──────┤ runtime evidence (for example Neon)
                              ▼
 project requirements ──► qualification ──► conditions ──► policy decision
                              │                   │
                              │                   └─► todos and proposals
                              ▼
                 TypeScript / LSP / MCP / CLI / Devtools
```

The key change is that a domain package is a protocol for both establishing
hardness and finding where more hardness is needed. A compiler publishes what
it knows in a reusable form. Requirements name what must be established.
Evidence methods add bounded observations. Trust keeps those objects separate,
qualifies their current relationship and leaves permission to consumer policy.

## Candidate primitives

| ID | Candidate | Job | Not the same as |
|---|---|---|---|
| G-P01 | **Protocol** | Versions a domain vocabulary, extension points and compatibility boundary | a product policy or package installation |
| G-P02 | **Subject** | Gives stable identity to a thing claims and evidence concern | its current source span or human label |
| G-P03 | **Relation** | Links subjects across protocols without copying their state or evidence | inferred equality |
| G-P04 | **Fact** | Records typed, source-mapped knowledge published by a compiler or adapter, including unknowns | evidence that a requirement is satisfied |
| G-P05 | **Requirement** | States what must be established for selected subjects and with which parameters | a diagnostic severity or method invocation |
| G-P06 | **Evidence chain** | Defines an evidence contract and method, then preserves each immutable run result | a fact, cache hit, task or permission |
| G-P07 | **Qualification** | Decides separately whether evidence is adequate and whether it applies now | consumer enforcement policy |
| G-P08 | **Condition and work trace** | Preserves unmet/defeated requirements and coordinates repair | evidence or proof of completion |
| G-P09 | **Policy decision** | Maps a coherent condition snapshot to visibility, fallback and action | a semantic judgment about evidence |
| G-P10 | **Operation descriptor** | Gives every interface one typed, versioned read or command meaning | a transport-specific endpoint |

`G-P06` is a small pattern, not one opaque record:

```text
evidence contract ─► method definition ─► run plan ─► evidence record
       type             how gathered       promised scope    immutable result
```

The split matters. PostgreSQL can own the `query-execution-profile` contract;
Neon can own one method that produces it; a particular production run produces
one record. None acquires the authority of the others.

## Protocol and graph authoring

A protocol exports stable handles. Package-private compiler structures do not
become the interoperability surface.

```ts
export const postgres = defineProtocol({
  meta: {
    name: '@tanstack/trust-postgres',
    version: '0.1.0',
    trustApi: '^0.1.0',
  },

  subjects: {
    operation: defineSubject<PostgresOperation>({ identity: 'content' }),
    query: defineSubject<PostgresQuery>({ extends: 'operation' }),
    mutation: defineSubject<PostgresMutation>({ extends: 'operation' }),
  },

  facts: {
    statement: defineFact(postgresStatementSchema),
    effects: defineFact(sqlEffectsSchema),
    source: defineFact(sourceMappingSchema),
  },

  evidence: {
    executionProfile: defineEvidence(queryExecutionProfileSchema),
  },

  requirements: {
    productionLatency: defineRequirement({
      on: 'query',
      options: schema.object({
        p99Ms: schema.number(),
        minSamples: schema.number().int(),
        maxAge: durationSchema,
      }),
      accepts: ['executionProfile'],
      adequate: ({ evidence, options }) =>
        evidence.samples >= options.minSamples &&
        evidence.p99Ms < options.p99Ms,
      currentWhen: postgresDependencies.statementAndSchema,
    }),
  },
})
```

The convenience API above lowers to stable subjects, a parameterized claim,
premises, alternate routes, evidence-to-premise edges and two qualification
decisions. Those proof objects remain inspectable. Ordinary authors do not need
to spell them unless the convenience form cannot express their argument.

### SQL-library adapters

An adapter translates one library into a protocol batch. It must publish
explicit unknowns instead of guessing.

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

Publication is atomic and tied to a source context. A batch supersedes its own
prior facts; it does not erase immutable evidence history. Drizzle, Kysely and
raw SQL may expose different source information while projecting the same
PostgreSQL contracts.

### Endpoints builds on PostgreSQL

Endpoints imports the PostgreSQL protocol rather than absorbing it.

```ts
export const endpoints = defineProtocol({
  meta: { name: '@tanstack/db-endpoints', version: '0.1.0' },
  uses: [postgres],
  subjects: {
    query: defineSubject<EndpointQuery>(),
    mutation: defineSubject<EndpointMutation>(),
    refreshDecision: defineSubject<RefreshDecision>(),
  },
  relations: {
    sqlOperation: defineRelation({
      from: ['query', 'mutation'],
      to: postgres.subjects.operation,
      cardinality: 'one',
    }),
  },
  facts: {
    authority: defineFact(collectionAuthoritySchema),
  },
})
```

Its compiler can publish subjects, cross-protocol relations and static check
results in one batch:

```ts
const safeSkipRefetch = endpoints.defineCheck({
  code: 'safe-skip-refetch',
  on: endpoints.subjects.refreshDecision,
  result: skipRefetchResultSchema,
  dependencies: ({ subject }) => [
    subject.queryArtifact,
    subject.mutationArtifact,
    subject.queryEffects,
    subject.mutationEffects,
    subject.collectionAuthority,
  ],
  interpret(result) {
    if (result.verdict === 'skip') return supports(result.reason)
    if (result.verdict === 'refresh') return contradicts(result.reason)
    return inconclusive(result.reason, result.unknown)
  },
})

ctx.publish({
  subjects,
  relations: endpointSqlRelations,
  facts: endpointFacts,
  evidence: [
    safeSkipRefetch.observe(refreshDecision, canSkipRefetch(query, mutation, authority)),
  ],
})
```

`defineCheck` is the simple authoring surface: typed subject, dependencies,
result and interpretation. It lowers to `G-P05`–`G-P07`. The compiler performs
the domain work; Trust validates and records the batch instead of calling a
linter-style callback during every read.

## Independent evidence providers

An evidence provider may implement a contract for a protocol it does not own.

```ts
export const neon = postgres.defineEvidenceProvider({
  meta: {
    name: '@neondatabase/tanstack-trust',
    version: '0.1.0',
  },
  methods: {
    productionSample: postgres.evidence.executionProfile.method({
      input: schema.object({
        samples: schema.number().int().min(1),
        predicates: predicateSamplingSchema,
      }),
      plan({ subject, input }) {
        return {
          executions: input.samples,
          statement: subject.statement,
          environment: 'production',
          readOnly: true,
          stoppingRule: { kind: 'count', value: input.samples },
        }
      },
      run: runNeonProductionSample,
      dependencies: postgresDependencies.statementSchemaAndEnvironment,
      attest: neonRunAttestation,
    }),
  },
})
```

Installation makes this definition discoverable. Project configuration admits
the exact version and grants a bounded capability before it can execute against
production. The provider owns collection and attestation; PostgreSQL owns the
evidence contract; a requirement owns the adequacy test; Trust owns history and
application; policy owns deployment action.

## Project requirements and source annotations

The project activates parameterized requirements over selectors:

```ts
export default defineTrustConfig({
  use: [postgres, drizzle, endpoints, neon],

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

A query may add a source-local requirement:

```ts
export const searchRecipes = query({
  sql: `select * from recipes where title ilike $1`,
}).trust(
  postgres.requirements.productionLatency({
    p99Ms: 250,
    minSamples: 100,
    maxAge: days(1),
  }),
)
```

The annotation lowers into a named config fragment with a source span. It may
add a requirement or make a compatible threshold stricter. It cannot remove or
loosen a requirement contributed by a higher-authority project source. Config
inspection returns every contributing selector, threshold, merge and conflict.

Checks remain packageable TypeScript. A project-local check uses the same
surface:

```ts
export const noSequentialScan = postgres.defineCheck({
  code: 'project/no-sequential-scan',
  on: postgres.subjects.query,
  evidence: postgres.evidence.explainPlan,
  options: schema.object({ maxRows: schema.number().int() }),
  dependencies: postgresDependencies.statementAndSchema,
  interpret: ({ plan, options }) =>
    plan.sequentialRows <= options.maxRows
      ? supports('plan is within the project bound')
      : contradicts('plan exceeds the project bound'),
})
```

## Qualification: the necessary internal split

Qualification has two independently inspectable facets:

```ts
interface QualificationDecision {
  requirement: RequirementRef
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

Adequacy asks whether thirty samples and an 800 ms p99 meet the declared
requirement. Applicability asks whether those samples concern the current SQL,
schema and environment and remain inside the age limit. A value can be adequate
but stale, or current but inadequate. The kernel keeps the decisions separate;
the authoring API derives exact dependency matching and expiry by default.

Advanced protocols may replace either default with a versioned, admitted
function. Such a function runs only during a bounded write operation over frozen
inputs. Pure reads never invoke package code.

## Conditions, todos and proposals

A requirement instance is either satisfied or has a policy-free condition.
Conditions distinguish missing evidence, contradiction, inconclusive evidence,
stale or unknown applicability, unavailable method, open challenge, invalid
configuration, unadmitted definition and operational failure.

Each actionable condition may project one deduplicated todo. Todos are the
stigmergic surface: an agent can discover, claim, annotate, release and close
work without relying on another agent's memory.

```ts
const page = await trust.todos.list({
  state: 'ready',
  reason: ['evidence.expired'],
  protocol: postgres.ref,
})

const lease = await trust.todos.claim({
  todo: page.items[0].ref,
  expectedVersion: page.items[0].version,
})
```

Claims return a fencing token. Planning or submitting evidence for claimed work
requires the live fence; a late worker cannot write through a newer lease.
Closing a todo recomputes and reports the condition. It never changes evidence.

Agents can also submit versioned proposals for a requirement, evidence method,
qualification, relationship or protocol revision. Proposal status and review
are queryable. Only an independently authorized admission operation makes a
proposal usable.

## Evidence runs

Every evidence-producing operation follows one grammar:

```text
discover need → select admitted method → plan bounded run → authorize
→ execute or externally gather → validate complete result → atomic submit
→ re-qualify → expose new snapshot
```

A plan commits the subject set, method and runtime versions, dependency slice,
coverage, expected cardinality or stopping rule, omissions and authority. An
external result needs the signed, unexpired ticket. Failure, cancellation,
unreachable production, malformed output and cleanup failure add no evidence.
They remain visible operation records. An indeterminate delivery must be
reconciled before retry.

Evidence is immutable. Returning dependencies to earlier bytes does not revive
an old record because dependency revisions are monotonic. A challenge is
repaired only by a causally later, applicable same-case observation tied to the
challenged cause.

## Policy, previews and temporary exceptions

Policy evaluates one snapshot at an explicit instant. Strictness combines
monotonically unless two equal-authority rules conflict, in which case no valid
decision is produced.

```ts
const preview = await trust.preview.config({
  patch: { levels: { postgres: 'strict' } },
})

const overridePreview = await trust.policy.previewOverride({
  subject: endpointRef,
  profile: 'production',
  action: 'warn',
  expiresAt,
  reason: incidentRef,
})
```

A config preview returns newly activated requirements, reusable evidence,
conditions, todos and policy deltas without writing live state. An override
preview performs the same selector, overlap and authority checks as creation,
but returns no deployable token.

An authorized temporary override changes only the named policy action for the
exact subject, conditions and profile until a server-owned deadline. The
conditions remain visible. The resulting decision token is bound to snapshot,
config, policy, override set, evaluation instant and validity deadline.

## Canonical operations and interface projection

`G-P10` keeps one operation registry with runtime schemas, capabilities,
snapshot behavior, receipts and errors. The idiomatic TypeScript resources are:

```ts
trust.status.get(input)
trust.explain.get(input)
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
trust.policy.previewOverride(input)
trust.policy.createOverride(input)
trust.preview.config(input)
trust.proposals.submit(input)
trust.proposals.list(input)
trust.admissions.list(input)
trust.admissions.decide(input)
trust.changes.since(input)
```

Reads are snapshot-bound and side-effect-free. Commands are capability-checked,
idempotent and expected-version operations with committed, rejected or
indeterminate receipts. Action descriptors name the exact operation and bind
its input schema, capability and expected snapshot; agents never guess which
generic tool to call.

The first MCP projection is task-shaped:

- `trust_status`
- `trust_explain`
- `trust_todos`
- `trust_evidence`
- `trust_policy`
- `trust_proposals`

The CLI uses the same registry. `trust check --profile ci --format json` never
runs hidden evidence and exits `0` for allow, `1` for a valid block and `2` when
no valid decision could be produced. Devtools reads snapshots and cursor deltas.
LSP document overlays create transient source contexts; diagnostics and actions
remain bound to the exact document version.

## Diagnostic and explanation grammar

The shared diagnostic is structured for an agent and renderable for a person:

```ts
interface TrustDiagnostic {
  code: string
  condition: ConditionRef
  subject: SubjectRef
  requirement: RequirementRef
  state: ConditionState
  summary: string
  because: Cause[]
  needs: EvidenceNeed[]
  currentEvidence: EvidenceSummary[]
  limits: Limit[]
  requiredBy: RequirementSource[]
  actions: ActionDescriptor[]
  locations: SourceSpan[]
  authority: AuthorityBoundary
  snapshot: SnapshotToken
}
```

Message catalogs provide semantic text; adapters do not invent meaning. A
production-latency diagnostic can render as:

```text
postgres/production-latency — evidence required
`todosByOwner` has no current production latency evidence.

Required: p99 < 1000 ms across at least 30 production samples.
Required by: trust.config.ts → all PostgreSQL queries.
Current evidence: none for SQL revision sql:7 and schema revision schema:12.
Next: gather with neon/production-sample, or explain the requirement.
Limits: this establishes sampled latency, not result correctness or future load.
```

The first line states the current condition, not an instruction to “fix” code.
The structured payload answers: what is affected, what is known, what is needed,
why it is required, what could make evidence stale, what actions are legal and
which authority is still missing. Warning/error presentation comes from the
consumer profile; the condition code does not change.

## Dependencies and active overlaps

| Consumer ↓ / primitive → | Protocol | Subject/relation graph | Facts | Requirements | Evidence/qualification | Conditions/work | Policy | Operations |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| PostgreSQL adapters | ✓ | ✓ | ✓ |  |  |  |  | ✓ |
| Endpoints compiler | ✓ | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |
| Neon provider | ✓ | ✓ | reads |  | ✓ |  |  | ✓ |
| Project config | ✓ | selectors |  | ✓ | method constraints |  | ✓ | ✓ |
| Agent workflow | reads | reads | reads | reads | creates | reads/writes work | previews | ✓ |
| CI / Devtools | reads | reads | reads | reads | reads | reads | evaluates | ✓ |

Three overlaps are active rather than accidental:

1. **Foreign evidence overlap:** a Neon method and an Endpoints query meet on
   the same PostgreSQL subject without either package owning the other.
2. **Condition/work overlap:** a condition supplies work, but the work lifecycle
   cannot mutate the condition's semantic basis.
3. **Annotation/config overlap:** a source declaration is code-local authoring
   and project configuration at once; lowering preserves both provenance and
   global authority.

Flattening these overlaps into a package tree would either copy evidence, turn
tasks into truth, or let source code weaken project policy.

## Dynamics, constraints and boundary conditions

### Dynamics

| ID | Legal transformation |
|---|---|
| G-D01 | Compile or recompile a source context into an atomic graph batch. |
| G-D02 | Resolve package, project and source fragments into requirement instances. |
| G-D03 | Plan, authorize, run and atomically submit evidence. |
| G-D04 | Recompute adequacy and applicability over a pinned snapshot. |
| G-D05 | Open, reactivate, resolve or supersede conditions and derive fenced work. |
| G-D06 | Evaluate policy or a sealed counterfactual without changing evidence. |
| G-D07 | Propose and independently admit a new definition or relationship. |
| G-D08 | Project one operation and state model through all interfaces. |

### Constraints

| ID | Invariant |
|---|---|
| G-C01 | A package may define domain meaning but cannot admit itself or choose deployment permission. |
| G-C02 | Unknown and unsupported analysis remain explicit and cannot lower to support. |
| G-C03 | Requirements cannot be changed by evidence; policy cannot manufacture evidence. |
| G-C04 | Evidence is immutable, attributable and dependency-bound; work and delivery are not evidence. |
| G-C05 | Cross-protocol reuse follows stable relations; evidence is never copied into a new owner. |
| G-C06 | Source annotations are additive or stricter unless an independent authority grants an exception. |
| G-C07 | Production execution and external submission require a bounded plan and capability. |
| G-C08 | Every interface preserves refs, causes, actions, limits, authority and snapshot identity. |
| G-C09 | Pure reads execute no plugin code and all writes are atomic, idempotent and version-checked. |
| G-C10 | A proposal, preview, cache hit, closed todo, PR or clean presentation is not authority. |

### Boundary conditions

- The executable evidence kernel and one Endpoints check are local, trusted-
  process prototypes.
- PostgreSQL extraction exists in Endpoints-shaped probes, not as a reusable
  package with Drizzle, Kysely and raw-SQL adapters.
- The Neon package, production sampling API and attestation scheme are proposed.
- Authentication, hostile extension isolation, multi-writer persistence,
  signature governance and calibration remain unresolved implementation work.
- No independent second domain has tested the grammar's range.

## Adjacent generated forms

These are grammar-generated possibilities, not discoveries or recommendations.

### G-F01 — Substitute the SQL-library adapter

**Route:** modular substitution. Replace the Drizzle adapter with Kysely while
holding PostgreSQL subjects, facts, unknown representation and source mapping
contracts fixed. Endpoints and Neon continue to refer to PostgreSQL operations.
The new coordination cost is a Kysely-specific identity/source mapping test
suite. Loss: adapter-specific type information may not survive the common
contract.

### G-F02 — Add a second PostgreSQL evidence provider

**Route:** modular augmentation. Add a provider that produces the same execution
profile contract from a staging replay rather than Neon production sampling.
The requirement may accept either method or explicitly require one. The new
coordination cost is provider/runtime admission and comparability testing. Loss:
staging data and load may not bear on the production requirement.

### G-F03 — Admit an agent-proposed proof route

**Route:** pattern unfolding. An agent observes that a static cost certificate
could establish one bounded latency premise without executing production. It
submits a typed route, verifier and limitation declaration. Until independent
admission, the proposal can organize discussion and work but cannot satisfy the
requirement. The new coordination cost is review and conformance evidence.
Loss: the certificate may model planner cost without measuring wall-clock
latency.

## Exclusions and decomposition loss

The grammar should not generate:

- a conventional linter whose callback directly returns a severity and fix with
  no evidence history or requirement identity;
- a universal “agent trust score” detached from a domain subject, requirement,
  evidence method and applicability context; or
- an autonomous loop in which an agent proposes, admits, runs and deploys its
  own proof route.

Decomposition loses some whole-system properties. A typed graph cannot itself
establish the social legitimacy of a requirement, the soundness of a compiler,
the honesty of a production provider or the quality of an institution's review.
The protocol model also makes discrete versions and decisions more visible than
the gradual learning by which teams discover useful hardness. Those losses must
remain explicit rather than being renamed “governance” and treated as solved.

