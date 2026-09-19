# Model — TanStack Trust API Design Grammar v4

This is the frozen Model layer for Field Log run 61. A unit survives only when
it reconstructs a preserved relation, changes a legal transformation or
exclusion, or preserves an active overlap. “Primitive” below means a minimal
unit in this design account, not an ontological claim.

## Central reading

TanStack Trust is a linter-shaped protocol system for agents. Its authoring and
project-composition surface should feel like a modern linter ecosystem, while
its semantic core retains more structure than a conventional linter: claims,
evidence methods, observations, applicability, causal challenges, admission,
agent work, and consumer action cannot collapse into one finding or severity.

Installed modules and project-local code describe available hardness. A
versioned project configuration selects the active rule set. Admitted methods
produce observations. Domain semantics assess their use. Trust derives shared
conditions and work. Consumer policy decides action. Every interface is a
projection of that lifecycle.

## Candidate primitives that survived reconstruction

### M01 — `EntityRef<T>` and immutable envelope

A package-scoped, kind-scoped, versioned identity shared across TypeScript,
stored history, LSP diagnostics, MCP tools, CLI JSON, Devtools, and work links.
The envelope retains definition hash, source location, actor, creation time,
supersession, and admission reference where applicable.

**Jobs:** cross-interface identity; immutable history; versioned concurrency;
stable diagnostic and rule references.

### M02 — `TrustModule`

An ordinary versioned code module that exports domain rules, evidence methods,
schemas, source locators, applicability functions, messages, and optional
configuration schema. It may come from a package or the current project.

Installation makes definitions discoverable; it does not enable them or admit
their semantic trust roots.

### M03 — `ProjectTrustConfig`

The source-controlled composition of installed and local modules for one
project. It explicitly enables, configures, or disables rules and methods and
selects named consumer profiles. Every resolved configuration has an immutable
revision/hash and a traceable source.

Project configuration determines which obligations are active in that project.
It cannot make an unadmitted definition authoritative, rewrite prior evidence,
or conceal conditions created under earlier revisions.

### M04 — `ClaimDefinition<TSubject>`

A proposition worth relying on, defined before evidence exists. It retains a
stable rule code, version, subject schema, scope, conditions, source locator,
obligation lineage, and human/agent presentation hooks.

### M05 — `SupportRoute` and `ClaimUse`

The explicit argument structure for a claim. A route retains joint premises;
alternate routes remain alternatives. `ClaimUse` names the exact consumer,
subject, context, and obligation for which support is requested.

### M06 — `EvidenceMethod<TInput, TDecision>`

A versioned code-defined way to produce evidence. Methods include deterministic
checks, oracles, measurements, certificates, recorded observations, and typed
probabilistic evaluators. Each declares input and output schemas, production
path, observation point, coverage, omissions, reach witness, dependencies,
fault controls, and calibration metadata where relevant.

A probabilistic method returns a typed distribution over declared decisions.
The distribution is an observation. Its calibration record is method-specific;
it is not a universal Trust confidence score.

### M07 — `Observation<TDecision>`

An immutable record of what one admitted method observed about one claim/case
under captured inputs, context, dependencies, method version, reach, coverage,
omissions, and operational result. Full check output is validated before atomic
commit; callers cannot submit only favorable findings.

### M08 — `EvidenceContext`, `EvidenceUse`, and `Applicability`

`EvidenceContext` captures the dependency and environment revisions relevant
to an observation. `EvidenceUse` connects one observation to one premise and
claim use. Every use is `applicable`, `inapplicable`, or `unknown` with a
domain-owned reason. Returning to old bytes does not revive an old revision.

### M09 — `OperationRecord`

The transactional record for running a method, submitting a batch, changing
context, claiming work, admitting a definition, activating an override, or
performing another command. It separates request acceptance, delivery,
cancellation, process outcome, reach, validation, commit, and receipt.

### M10 — `Challenge` and `RepairLink`

A versioned objection or counterexample attached to the exact law, case,
context, observation, and affected uses. A repair records what changed and why
a later operation addresses the same obligation. A later pass alone is not a
causal repair.

### M11 — `AdmissionRecord`

An authority act that admits, rejects, revokes, or supersedes a versioned
semantic trust root: module, claim, route, method, adequacy rule, applicability
rule, calibration basis, or presentation contract. Authorship and successful
execution do not confer admission. Agents may propose every semantic object but
cannot admit their own proposal.

### M12 — `PolicyProfile` and `PolicyOverride`

Consumer-owned inputs that translate policy-free conditions into severity,
CI/deployment action, fallback, and presentation choices. Overrides are scoped,
authorized, explained, versioned, inspectable, and expiring. They never change
an observation, assessment, challenge, or admission.

## Authored pattern: `TrustRule`

A linter-style rule is the ergonomic authoring bundle, not a replacement for
the semantic primitives:

```ts
const safeSkipRefetch = defineRule({
  code: 'endpoints/safe-skip-refetch',
  claim: defineClaim<EndpointRefetchCase>({
    version: 1,
    subject: endpointRef,
    statement: ({ endpoint }) =>
      `${endpoint} may skip authoritative refetch after this mutation`,
  }),
  support: anyOf(
    allOf('same-artifact', 'confirmed-baseline', 'complete-effects', 'no-overlap'),
    'authoritative-certificate',
  ),
  methods: {
    oracle: defineCheck({ /* method contract and executable code */ }),
  },
  applicability: ({ project, endpoint }) => ({ /* domain judgment */ }),
  messages: ({ condition }) => ({ /* domain wording and locations */ }),
})
```

The author writes one coherent rule module. Registration lowers that bundle to
M04–M06 and its presentation relations so evidence, admission, and policy can
refer to the exact parts without flattening them.

## Active projections

### X01 — `Assessment` and `Explanation`

A policy-free evaluation of support, contradiction, unresolved routes,
applicability, challenges, reach failures, admission gaps, and remaining
obligations. Explanation preserves the graph and authority boundary rather than
only a status string.

### X02 — `TrustCondition`

A normalized, stable, policy-free reason attention is needed: missing evidence,
expired or inapplicable evidence, open counterexample, unreachable observation
point, unadmitted definition, disabled required rule, invalid configuration,
or unresolved identity relation. Conditions form one half of the stigmergic
trace substrate.

### X03 — `WorkCase`

The coordination overlay attached to a condition or admitted proposal. It
supports ready/show/explain, claim/lease, notes, blockers, discovered-from,
supersession, guarded closure, and event history. Work closure never changes
evidence or admission; it reports whether the underlying condition remains.

### X04 — `Diagnostic`

The linter-shaped, source-local rendering of a condition. It contains a stable
rule/condition code, exact subject and locations, structured causes, affected
uses, limits, authority boundary, and typed legal actions. Severity and whether
it gates action come from M12.

### X05 — `PolicyEvaluation`

A pure evaluation of one coherent snapshot under a named profile and active
overrides. It returns severities, actions, exit/deployment status, fallback,
override provenance, and newly required obligations without changing evidence.

### X06 — `TrustSnapshot` and change cursor

A coherent multi-object read boundary containing configuration, definitions,
admission, observations, assessments, conditions, work, and policy state at one
version. A cursor exposes later changes without assembling mixed-version views.

## Consequential overlaps

| ID | Overlap | Active function |
|---|---|---|
| O01 | M02 module × M03 config × M11 admission | Keeps installed, enabled, configured, and authorized distinct. |
| O02 | M04 claim × M05 route × M06 method × presentation | Forms the linter-shaped `TrustRule` authoring bundle without erasing its semantic parts. |
| O03 | M06 method × M07 observation × M08 evidence use | Preserves the difference between producing a value and using it as support. |
| O04 | M07 observation × M08 applicability × M10 challenge × M11 admission | Determines X01 assessment without consumer policy. |
| O05 | X01 assessment × M09 reach × M10 challenge × M03 config | Produces one X02 condition taxonomy shared by every adapter. |
| O06 | X02 condition × X03 work | Creates the stigmergic agent substrate while preventing work from becoming evidence. |
| O07 | X02 condition × M12 policy | Produces severity and action without changing the condition. |
| O08 | X02 condition × X04 diagnostic × typed action | Makes a lint finding a navigable agent instruction rather than prose-only output. |
| O09 | X06 snapshot × X05 policy evaluation | Keeps CI, preview, and Devtools internally coherent. |

These overlaps form a semilattice rather than a clean package tree. In
particular, `TrustCondition` participates in diagnostics, work, CI, policy
preview, and Devtools; assigning it to any one adapter would duplicate meaning.

## Legal rules and invariants

| ID | Rule |
|---|---|
| R01 | Modules and project-local rules own domain meaning; Trust owns lifecycle mechanics; consumer profiles own action. |
| R02 | Installation, configuration enablement, semantic admission, successful execution, and policy permission are different states. |
| R03 | Project configuration is explicit, versioned, inspectable, source-controlled, and part of later applicability; changing it never rewrites history. |
| R04 | A module may expose convenient `defineRule` bundles, but stored identity and admission remain addressable at claim, route, method, and semantic-function versions. |
| R05 | Claims precede observations. Joint premises and alternate support routes cannot be flattened into a checklist. |
| R06 | A method captures and validates its complete returned batch before atomic observation commit; callers cannot submit only favorable output. |
| R07 | Typed probabilistic output retains its decision algebra, full distribution, evaluator and schema version, input digest, calibration basis, coverage, omissions, and reach. It never becomes a generic confidence number. |
| R08 | Schema-valid output proves only conformance to the output algebra, not semantic correctness, applicability, adequacy, or admission. |
| R09 | Every evidence use has explicit applicability and a domain-owned reason under one configuration and context revision. |
| R10 | A challenge remains effective until an authorized repair satisfies its same-law, same-case, affected-use, applicability, and happens-after obligations. |
| R11 | Conditions, work, notes, task links, PR state, rule popularity, repeated assertions, and agent agreement are coordination facts; none is evidence. |
| R12 | Queries are side-effect-free at one snapshot. Commands are transactional, capability-checked, versioned, and return discriminated receipts. |
| R13 | Disabling a rule changes the active project obligation set only through an authorized configuration revision. A scoped suppression changes consumer action through an expiring override. Neither erases prior evidence or conditions. |
| R14 | Every actionable diagnostic exposes stable codes, structured causes, affected uses, coverage limits, authority limits, and only currently legal operations. |
| R15 | CLI, LSP, MCP, Devtools, and TypeScript adapters project one condition and operation model; adapter vocabulary cannot redefine semantics. |
| R16 | Multi-object reads and policy comparisons use one coherent snapshot and return the cursor/version used. |
| R17 | Local rules use the same definition, identity, admission, evidence, and configuration grammar as packaged rules; “local” lowers distribution cost, not authority requirements. |
| R18 | Trust never claims universal proof, liveness, analyzer completeness, cross-domain validity, or a lawful cross-method confidence scale. |

## Dependency matrix

| Projection | M02 module | M03 config | M04/M05 claim | M06 method | M07/M08 evidence | M09 operation | M10 challenge | M11 admission | M12 policy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| X01 assessment/explanation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| X02 condition | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| X03 work | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |
| X04 diagnostic | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| X05 policy evaluation | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ |
| X06 snapshot/cursor | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Representative project extension surface

```ts
// node_modules/@tanstack/db-endpoints/trust.ts
export default defineTrustModule({
  name: '@tanstack/db-endpoints',
  version: '0.1.0',
  rules: { safeSkipRefetch },
})

// trust.config.ts
export default defineTrustConfig({
  modules: [endpointsTrust, projectTrust],
  rules: {
    'endpoints/safe-skip-refetch': ['error', { level: 'standard' }],
    'project/orders-preserve-ledger': 'warn',
    'endpoints/experimental-rule': 'off',
  },
  profiles: { ci: strictCI, development: developmentPolicy },
})

// trust/rules/orders-preserve-ledger.ts
export const ordersPreserveLedger = defineRule({
  code: 'project/orders-preserve-ledger',
  claim: defineClaim<OrderMutation>({ /* ... */ }),
  support: allOf('transaction-oracle', 'failure-replay'),
  methods: {
    transactionOracle: defineCheck({ /* executable project code */ }),
  },
  applicability: ({ mutation }) => mutation.tables.has('orders'),
})
```

`off` is visible configuration state, not a deleted definition or favorable
observation. A source-local temporary exception is represented by an authorized
M12 override with scope and expiry, even when an adapter renders it with a
familiar suppression syntax.

## Distinct adjacent forms

### F01 — Linter-first authoring facade

Packages export `defineTrustModule` and `defineRule`; projects use
`trust.config.ts`; the runtime exposes `check`, `report`, and `explain`.

**Route:** augment the v2 package-scoped facade with a real plugin/config layer.
**Preserves:** M01–M12 and X01–X06 after lowering authored bundles.
**New option:** minimal adoption cost and straightforward local rule authoring.
**Cost/loss:** the facade can make a rule look atomic and make a mutating check
run look like a side-effect-free lint read unless command boundaries remain
explicit.

### F02 — Resource-oriented query/command service

```ts
await trust.query.conditions.list({ rule, snapshot })
await trust.query.work.ready({ module: endpoints.ref, snapshot })
await trust.command.methods.run({ method, input, expectedConfig })
await trust.command.observations.submit({ batch, expectedVersion })
```

**Route:** split side-effect-free resources from transactional commands.
**Preserves:** lifecycle and failure boundaries most visibly.
**New option:** idiomatic TypeScript service and precise authorization.
**Cost/loss:** more verbose; module authors need the F01 layer for linter-like
ergonomics.

### F03 — Schema-first operation protocol

```ts
await trust.query({ type: 'work.ready', module: '@tanstack/db-endpoints' })
await trust.execute({ type: 'methods.run', method, input, expectedConfig })
```

**Route:** substitute one discriminated wire protocol for resource methods.
**Preserves:** the same operations across CLI, LSP, MCP, and remote transports.
**New option:** generated clients, capability negotiation, and stable agent
tool schemas.
**Cost/loss:** least idiomatic for direct TypeScript authoring and vulnerable to
becoming an unstructured request funnel.

The three forms are structurally distinct but composable: F01 can lower to F02,
and F02 can serialize through F03. This run does not rank or select the nesting.
