# TanStack Trust

TanStack Trust helps teams verify agent-produced work and lets agents operate
more autonomously within the goals, standards, and authority boundaries of
their team.

## Cheap implementation moves the bottleneck to verification

Coding agents can produce and revise implementations quickly. The harder part
is establishing that a change is correct, safe, fast, and ready to deploy. Most
of that verification and guarantee work is still performed by people: deciding
what must be true, gathering support, judging whether it is sufficient, and
connecting the conclusion to review, deployment, or runtime behavior.

Trust makes that work reusable. It connects team goals and judgment with
independently grounded information from code, databases, tests, generated
oracles, production, and external services. Instead of reconstructing the same
argument in every review, a team can preserve what it expects, what evidence it
accepts, and what consequences follow.

## Captured judgment gives agents room to act

Once that judgment is explicit, an agent can query what a change must establish,
inspect what is missing, test candidate solutions, gather and submit evidence,
repair failures, and confirm when the work satisfies the team's requirements.
It can proceed independently until Trust identifies a decision or authority
boundary that still belongs to a person.

This does not require people to anticipate and hand-author every proof. Packages
can provide reusable targets and integrations; teams can add local ones; and
agents can propose new targets, evidence routes, and sources. Separate project
authority decides what may enter the trusted system.

The result is more agent autonomy without asking people to trust unverified
output. To build it, Trust helps teams find and engineer **sources of hardness**:
mechanisms that make important system conditions reliable enough to build on.

## A linter for the whole SDLC

At first, Trust feels like a linter built for agents.

An agent changes code. Trust reports missing or contradictory support, explains
why, and offers structured next actions. The agent fixes the problem. CI checks
the same targets and can reject the change.

```text
change → finding → explanation → fix
                              ↓
                         CI accepts/rejects
```

Trust keeps familiar linter conventions where they help: stable target and
finding codes, code locations, project configuration, machine-readable results,
editor feedback, and deterministic CI status.

## Targets connect goals to evidence and action

A linter usually compares source code with rules. Trust connects product and
engineering goals to evidence from across the software lifecycle.

A goal might depend on static analysis, PostgreSQL behavior, tests, generated
oracles, production measurements, project requirements, or an external service.
Those evaluations can also become consequential: CI can reject a change, a
deployment service can gate a release, or server and client code can select
safer runtime behavior.

Trust's authoring API centers on one concept: the **target**.

## Targets name the goals a team cares about

A target names a product or engineering condition that the current system and
its changes should satisfy. It gives documentation, CI, agents, and Devtools a
shared answer to: “What are we trying to make true?”

```ts
export const checkoutQuality = defineTarget({
  id: 'checkout/quality',
  condition: 'Checkout is fast and secure',
  for: checkout.flow,
  requires: allOf(checkoutFast, checkoutSecure),
})
```

Targets can range from broad team goals to small technical conditions. A broad
target composes smaller targets while preserving the team's goal as
infrastructure and implementation choices change.

## Targets can evaluate inputs or compose other targets

A target is a reusable definition of a condition and how Trust can evaluate it.
It declares its identity and condition, then either evaluates typed inputs or
composes other targets. It may also declare outputs it can build. Defining a
target does not assert that its condition is already true.

```ts
export const checkoutFast = defineTarget({
  id: 'checkout/fast',
  condition: 'Checkout stays within its latency budget',
  requires: allOf(queryLatency, renderLatency, queryExecution),
})

export const queryLatency = defineTarget({
  id: 'neon/production-query-latency',
  condition: 'Production p99 query latency stays below one second',

  inputs: {
    query: pg.inputs.query,
    environment: neon.inputs.environment,
    sample: neon.inputs.productionSample,
  },

  evaluate: evaluateProductionLatency,
})
```

Calling `trust.check(target)` produces a target result. Its status is
`supported`, `unresolved`, or `contradicted`; the result also carries its child
results, evidence, scope, dependencies, limits, and useful next actions. An
execution error is recorded separately from the target's status.

The same API supports two useful shapes. A leaf target evaluates typed inputs. A
composite target combines other targets with operators such as `allOf`, `anyOf`,
or a domain-specific combinator. Composite targets can recursively contain
other composite targets, so “Keep checkout fast and secure” can be assembled
from smaller reusable conditions.

Several composite targets can reuse the same lower-level target, giving the
graph shared branches. Targets are ordinary code. Open-source packages can
publish targets that generalize, and teams can write targets for local goals
and systems.

## Targets compose into a graph

Targets depend on sources, analyses, other targets, and recorded evidence.
Trust connects those dependencies into the **target graph**, a directed acyclic
graph leading toward target results and concrete outputs.

```text
sources → analyses → leaf targets → composite targets
                               ↘          ↗      ├→ target results
                                shared targets   ├→ findings
                                                 └→ outputs/artifacts
                                                           ↓
                                             CI, deploy, server, client
```

Any target can be checked directly. Leaf targets are where the graph touches
analyzers, evidence, and external systems; composite targets connect those
conditions to broader ones. This internal execution model lets Trust preserve
provenance, reuse shared target results, invalidate downstream results when
inputs change, and explain how each result was reached.

A source provider reads facts from code, a database, production, or another
system. An input is a typed value supplied to a target. An analysis derives new
structured information from inputs. Evidence is an attributable record offered
in support of a target's condition. These roles stay distinct even when one
value moves through several of them.

## Agents can test candidate changes against the same target graph

An agent can test any target without first modifying the real system. It can
fork a frozen snapshot, hypothetically replace declared inputs, and test several
ideas in parallel.

```ts
const results = await trust.test({
  target: checkoutQuality,
  subject: checkout,

  variants: [
    {
      id: 'add-index',
      changes: [replace(pg.inputs.schema, schemaWithIndex)],
    },
    {
      id: 'rewrite-query',
      changes: [replace(pg.inputs.query, rewrittenQuery)],
    },
  ],
})
```

Trust reevaluates the affected part of the target graph and reports how each
variant changes child target results, the selected target's result, findings,
and outputs. The agent can use this repeatedly:

```text
propose variants → check targets → inspect results → propose better variants
```

The repeated behavior is an agent feedback loop built around the target graph.

Hypothetical target results guide exploration. After choosing a candidate, the
agent changes the query, schema, project configuration, or code and evaluates
the target graph against current project and production inputs. Project admission
policy decides whether those target results may satisfy a required gate or build
a runtime artifact. Admission records that decision for an exact result, subject,
scope, and use.

## Admitted target results can reject changes and build runtime artifacts

An admitted, supported target result can satisfy a gate. A target may also
produce an output. Once that output is versioned with its subject, build,
dependencies, assumptions, producer, and scope, it becomes an artifact that
another component can consume.

Different integrations can consume admitted target results and artifacts:

- LSP reports a finding beside code.
- CI rejects a pull request.
- A deployment gate refuses a release.
- A server chooses a safe execution path.
- A client chooses whether to refetch or reconcile locally.
- A feature flag or fallback limits exposure after failure.

Each consumer makes its own declared decision. A target result does not gain new
authority merely because it has the expected shape.

## Endpoints compiles database evidence into refresh decisions

TanStack DB Endpoints wants to avoid database-authoritative refetches when a
mutation cannot affect a retained query.

```ts
export const canSkipRefetch = defineTarget({
  id: 'db-endpoints/can-skip-refetch',
  condition: 'This mutation can skip database-authoritative refetch safely',

  inputs: {
    queryEffects: pg.analyses.queryEffects,
    mutationEffects: pg.analyses.mutationEffects,
    operationGraph: endpoints.analyses.queryMutationGraph,
    collectionState: dbEndpoints.inputs.collectionState,
  },

  evaluate: evaluateSkipRefetch,

  outputs: {
    runtimePacket: dbEndpoints.outputs.refreshEvidence,
  },
})

export const refreshPlan = defineTarget({
  id: 'db-endpoints/refresh-plan',
  condition: 'Every mutation has a safe refresh strategy',
  requires: chooseRefreshPath({
    skipWhen: canSkipRefetch,
    fallback: authoritativeRefetchAvailable,
  }),
})

export const safeSelectiveRefresh = defineTarget({
  id: 'db-endpoints/safe-selective-refresh',
  condition: 'Active queries update correctly without unnecessary refetches',
  for: endpoints.mutation,
  requires: allOf(refreshPlan, runtimeCanEnforcePlan),
})
```

PostgreSQL analysis supplies query reads and mutation writes. General Endpoints
analysis supplies the query/mutation graph. DB Endpoints supplies whether the
collection has a database-authoritative baseline, pending optimism, or repair
work.

Calling `trust.check(canSkipRefetch)` produces a target result with status
`supported`, `unresolved`, or `contradicted`. A supported result can build a
runtime evidence packet tied to the exact build. This packet is an artifact
containing the supporting evidence and refresh plan that runtime code needs.
`refreshPlan` uses a domain-specific combinator: `supported` selects the skip
path; `unresolved` or `contradicted` selects a database-authoritative refetch.
Server and client integrations consume an admitted packet plus live state.

An agent can test hypothetical queries, schemas, or effect summaries before
changing code. Changes to SQL, schema, endpoint relationships, or runtime
assumptions invalidate the affected target results and packet.

Endpoints can publish a useful default set as an array of targets:

```ts
export const endpointsRecommended = [
  authoritativeMutationDelivery,
  safeSelectiveRefresh,
  recoverableOptimism,
] as const satisfies readonly TrustTarget[]

export default defineTrustModule({
  targets: {
    authoritativeMutationDelivery,
    safeSelectiveRefresh,
    recoverableOptimism,
  },
  configs: { recommended: endpointsRecommended },
})
```

`endpointsRecommended` is a target preset: the goals most Endpoints projects will
find valuable and tractable. A project can adopt that array, remove a target,
or add a local target. Selecting a preset chooses goals; target policies
configure thresholds and evidence requirements.

## Packages and projects extend the graph with ordinary code

Trust's base system manages typed dependencies, evidence, history, authority,
hypothetical evaluation, outputs, and agent operations. Packages and projects
contribute ordinary code:

- A PostgreSQL package can publish sources, analyses, targets, and descriptions
  of native database behavior.
- A general Endpoints package can publish query/mutation graph analysis.
- DB Endpoints can publish targets, runtime artifacts, and a
  recommended target set.
- Neon can publish production sources, bounded cloud operations, and targets.
- A project can define local targets, sources, analyses, outputs, and
  integrations for requirements that do not generalize.

Installing a package makes code available. Projects separately decide which
definitions they accept and which production capabilities they grant.

## Teams judge whether the arrangement is good enough

For each target, its result presents what the team is bringing to bear: child
target results, evidence, gates, runtime integrations, fallbacks, exceptions,
incidents, dependencies, and methods.

Individual target conditions may be formally proven or quantitatively measured.
The team judges whether the overall arrangement gives it enough reason to rely
on each target.

That judgment can change. An outage, production slowdown, near miss, new threat,
or changed requirement may lead the team to add targets, evidence, gates, or
fallbacks. Trust preserves what changed and why.

**Hardness** is the practical certainty that lets people and software rely on a
target holding now and across the changes covered by its evidence and gates.
Sources of hardness are the mechanisms brought together to create it.

Teams can preserve explicit fallback, exception, challenge, revision, repair,
and exit paths so guarantees can evolve without hiding bypasses or rewriting
history.

## Repeated enactment makes the whole arrangement a protocol

Following the Protocol Institute usage, a protocol is the complete coordinating
arrangement that becomes real through repeated use by people, agents, rules,
artifacts, packages, infrastructure, runtime behavior, maintenance, exceptions,
and exit paths.

Targets help construct and operate that arrangement. A TypeScript declaration
or installed package alone is not the full protocol.

## Every interface exposes the same system

An agent can:

1. List targets and inspect their results.
2. Ask what evidence or actions are missing.
3. Batch-test hypothetical changes against any target.
4. Inspect target results, counterexamples, preserved successes, and limits.
5. Apply a selected change to project code.
6. Gather and submit authorized evidence.
7. Confirm that every required target is `supported`.
8. Renew expired evidence after dependencies change.

LSP presents source-local findings. MCP exposes richer queries and actions. CLI
gives agents and CI deterministic status. Devtools presents target results,
evidence, artifacts, runtime integrations, incidents, adaptive paths, and the
methods assembled around each target.

## The core model is coherent; key semantics remain open

The conceptual center fits in one paragraph:

> Teams define valuable targets and recursively compose smaller targets that
> connect real evidence to broader conditions. Trust builds the target graph.
> Packages can publish recommended target sets. Agents can optionally test
> hypothetical inputs for fast feedback. Project policy can use admitted,
> supported target results to reject CI, gate deployments, or build artifacts
> used by servers and clients. Trust shows teams what they are bringing to bear;
> teams judge whether it is enough. The repeatedly enacted whole may form a
> protocol.

Important decisions remain:

1. The exact status and explanation semantics of `allOf`, `anyOf`, shared
   child targets, and domain-specific target combinators.
2. Which inputs may be hypothetically replaced and what hypothetical target
   results can establish.
3. The exact semantics and distribution of server/client runtime artifacts.
4. What target results must preserve for sound team judgment.
5. What observations show that an arrangement has become an active protocol.
6. How package acceptance, result admission, runtime capabilities, and project
   policy compose across owners.
7. Whether the model remains natural outside Endpoints.

The executable prototype currently supplies a finite Endpoints evidence kernel,
one skip-refetch certificate, SQL-effect compilation, and local CLI/LSP/MCP
interfaces. The general Target API, speculative batch evaluation, PG and Neon
packages, runtime packet enforcement, Devtools, and cross-domain range remain
proposed.
