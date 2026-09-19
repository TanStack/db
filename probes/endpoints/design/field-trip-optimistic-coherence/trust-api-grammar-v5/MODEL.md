# Model — TanStack Trust API Design Grammar v5

This document is the normative design candidate used for the first agent
usability simulations. Type signatures are representative and constrain names,
ownership, transitions, and result shapes; they are not claims about the
current prototype.

## 1. Ownership

| Owner | Owns | Must not own |
|---|---|---|
| Domain module | subjects, claims, premises, routes, methods, adequacy, applicability, semantic messages, source mapping | deployment permission or its own admission |
| Trust kernel | identity, lowering, configuration resolution, history, evidence use, conditions, operations, snapshots, work coordination | domain truth or consumer policy |
| Authority provider | authenticated principals, capability grants, admission and override authorization | evidence or semantic adequacy |
| Consumer | active obligation level, severity, visibility, fallback, CI/deployment action | observation history or applicability |
| Adapter | transport and native presentation | new statuses, causes, actions, or authority |

## 2. Stable identity and history

Every durable object has a wire-safe reference. Human aliases are never its
identity.

```ts
type Ref<Kind extends string> = string & { readonly __kind: Kind }

interface DefinitionEnvelope<Kind extends string> {
  ref: Ref<Kind>
  module: Ref<'module'>
  localKey: string
  version: number
  contentHash: string
  definedAt: string
  source?: SourceSpan
}
```

`DefinitionEnvelope` contains definition-time facts only. Admission,
supersession, revocation, configuration activation, and lifecycle changes are
append-only events referencing the envelope. Re-publishing the same name and
version with different bytes is an identity collision.

Equality uses the canonical encoded reference. Compatibility, equivalence,
subsumption, migration, and replacement are explicit versioned relations; they
are not reference equality.

## 3. Module ecosystem protocol

```ts
interface TrustModuleManifest {
  name: string
  namespace: string
  version: string
  contentHash: string
  trustApi: string
  capabilities: {
    sourceProviders: readonly string[]
    rules: readonly string[]
    methods: readonly string[]
    configs: readonly string[]
  }
  docs?: string
  deprecated?: {
    since: string
    replacedBy?: Ref<'module'>
    messageId: string
  }
}

const endpointsTrust = defineTrustModule({
  meta: {
    name: '@tanstack/db-endpoints',
    namespace: 'endpoints',
    version: '0.1.0',
    trustApi: '^0.1.0',
  },
  sourceProviders: { typescript: endpointsSourceProvider },
  rules: { 'safe-skip-refetch': safeSkipRefetch },
  configs: { recommended: endpointsRecommended },
})
```

Discovery reads and validates inert manifest data before executable code is
loaded. Installation makes a module discoverable. It does not activate its
rules, admit its semantic functions, or grant execution capabilities.

Aliases chosen by a project affect configuration spelling only. Resolution
records the alias, package identity, exact content hash, and compatibility
decision.

## 4. Source providers and editor overlays

A source provider maps a host representation into domain subjects and back to
physical source.

```ts
interface SourceProvider<Services, Subject> {
  meta: DefinitionEnvelope<'source-provider'>
  discover(input: FrozenSourceInput): Promise<DiscoveryResult<Subject>>
  services(input: FrozenSourceInput): Promise<Services>
  locate(subject: Subject): readonly SourceSpan[]
  mapAction(action: DomainAction): ActionMappingResult
  dependencies(input: FrozenSourceInput): DependencyManifest
}

interface SourceSpan {
  uri: string
  sourceVersion: string
  start: { line: number; character: number }
  end: { line: number; character: number }
}
```

LSP document changes enter through `command.contexts.put`. The returned
`ContextRef` names a transient, versioned overlay and its reconciled base
snapshot. Queries may read that context without mutating it. Stale overlay
versions return a typed conflict. Closing an overlay never deletes durable
evidence; observations produced from it retain its digest and are applicable
only where the domain permits.

Providers must declare whether an action can be mapped safely to physical
source. An unmappable or stale action is disabled with a structured reason.

## 5. Rule authoring and deterministic lowering

```ts
const safeSkipRefetch = defineRule({
  meta: {
    code: 'endpoints/safe-skip-refetch',
    version: 1,
    docs: '/trust/rules/safe-skip-refetch',
  },
  options: schema.object({ level: schema.enum(['basic', 'standard', 'strict']) }),
  subject: endpointMutationSubject,
  claim: defineClaim({
    statement: ({ endpoint }) =>
      `${endpoint} may skip authoritative refetch for this mutation`,
  }),
  premises: {
    sameArtifact: definePremise(),
    confirmedBaseline: definePremise(),
    completeEffects: definePremise(),
    noOverlap: definePremise(),
    certificate: definePremise(),
  },
  routes: anyOf(
    route('derived', allOf('sameArtifact', 'confirmedBaseline', 'completeEffects', 'noOverlap')),
    route('certificate', allOf('certificate')),
  ),
  methods: {
    effectOracle: defineEvidenceMethod({
      supports: ['sameArtifact', 'confirmedBaseline', 'completeEffects', 'noOverlap'],
      result: effectOracleResultSchema,
      coverage: 'enumerated-cases',
      run: runEffectOracle,
    }),
  },
  adequacy: defineAdequacy({ evaluate: assessEffectOracle }),
  applicability: defineApplicability({ evaluate: appliesToEndpointMutation }),
  messages: defineMessages({
    evidenceMissing: 'Required {premise} evidence is missing for {endpoint}.',
    evidenceExpired: '{method} evidence no longer covers {changedDependency}.',
  }),
  actions: {
    gatherEvidence: defineAction({ kind: 'evidence.plan' }),
    explain: defineAction({ kind: 'condition.explain' }),
  },
})
```

Registration first produces a normalized `LoweringManifest`. Component refs are
deterministic from module identity, rule code/version, component kind, local
key, schema version, and content hash. The manifest explicitly connects methods
to premises and messages/actions to condition kinds. Registration validates the
complete dependency closure and commits atomically; any collision or invalid
reference rejects the whole module.

Claims may be reused by multiple rule presentations. The stable rule code
belongs to the authored rule; claim identity remains independent. Every
diagnostic includes both refs.

Executable semantic hooks run only inside a method/context command with frozen
inputs and captured dependencies. Pure queries consume persisted decisions and
descriptors; they never invoke arbitrary module hooks.

## 6. Configuration, obligation, and policy

Project configuration is an ordered list of named fragments with deterministic
matching and merge rules.

```ts
export default defineTrustConfig([
  config('base', {
    modules: { endpoints: endpointsTrust },
    extends: [endpointsTrust.configs.recommended],
  }),
  config('endpoint defaults', {
    subjects: endpointsTrust.subjects.endpoints(),
    levels: { endpoints: 'standard' },
    rules: {
      'endpoints/safe-skip-refetch': {
        enabled: true,
        options: { level: 'standard' },
      },
    },
  }),
])

export const policies = definePolicies({
  development: policy({ defaultAction: 'warn' }),
  ci: policy({ defaultAction: 'block' }),
})
```

`levels` and rule activation determine obligations. `policies` map active
conditions to channel visibility, severity, fallback, and action. Severity is
not rule activation. Invalid configuration produces a bootstrap report with
source spans; it does not require an already-valid project snapshot.

For each subject, the resolver exposes:

```ts
trust.query.config.resolve({ subject, context })
trust.query.config.inspect({ subject, context })
```

`resolve` returns the normalized configuration, exact module lock graph, and
revision. `inspect` additionally returns every contributing or excluded layer,
matcher result, merge, default, conflict, and provenance span.

An `ObligationSource` identifies the module level, explicit rule activation, or
external mandate that requires a claim. Disabling a rule required by another
active source yields a configuration conflict; otherwise disablement ends
current activation while retaining prior occurrences and evidence history.

## 7. Evidence methods, runs, and observations

An evidence method declares input/output schemas, supported premises, coverage
mode, dependency selectors, reach witness, cache/replay policy, runtime identity,
and calibration contract when probabilistic.

Every run begins with a `RunPlan` that commits the intended subjects/cases,
method version, expected result cardinality or stopping rule, dependencies,
coverage, omissions, and current snapshot. Internal runners—not rule callbacks—
attest reach. External submission requires the signed, unexpired run ticket.

```ts
type RunReceipt =
  | { status: 'committed'; operation: Ref<'operation'>; observations: Ref<'observation'>[]; snapshot: SnapshotToken }
  | { status: 'rejected'; operation: Ref<'operation'>; error: OperationError }
  | { status: 'indeterminate'; operation: Ref<'operation'>; reconcileWith: Ref<'operation'> }
```

The method's complete returned batch is schema-validated against the plan and
committed atomically. The record distinguishes expected universe, returned
batch, declared omissions, and whether exhaustive enumeration was promised.
Failure, cancellation, unreachable production, invalid output, and cleanup
failure commit no observation and no dependency revision. They remain visible
as operation records.

An observation retains producer, run, method/evaluator/schema/runtime versions,
full validated result, captured or retained input according to policy,
dependency/config slices, provenance/trust roots, coverage, omissions, reach,
cache/replay status, calibration basis, and creation admission. Applicability
is a separate versioned decision with the exact function, inputs, result,
reason, and supersession edge. Current admission is checked separately from
admission at production.

Cache validity is explained from the same captured inputs. Cache hits, timing,
cost, attempts, and concurrency are operational facts only; none increases
evidentiary weight.

## 8. Adequacy, probability, and applicability

Domain-owned, independently admitted `AdequacyDefinition`s map a method's typed
decision to one or more premise-support statements. Consumer policy cannot make
an inadequate result adequate.

A probabilistic result is a finite normalized distribution over a declared
decision algebra, optionally including abstention. It records evaluator,
sampling/backend/tool context, calibration population, metric, validity range,
date, drift signal, and reproducibility class. Outside-calibration and
insufficient-domain-adequacy are semantic conditions; consumer profiles only
decide what action to take in response.

Applicability is `applicable | inapplicable | unknown`, always with a reason.
Only captured evidence-relevant dependency or configuration changes affect the
decision. Returning to equal bytes at a later revision does not automatically
revive old evidence.

## 9. Challenges and causal repair

A challenge targets exact premises, routes, claim uses, observations, cases,
and contexts. Route defeat and overall claim status are separate: explanations
continue evaluating alternate routes and report every material cause.

Cross-version equivalence, subsumption, split, and migration use admitted
`IdentityRelation`s. Unknown mapping remains a visible condition.

A `RepairLink` must identify the challenged violation, affected use, changed
cause or repair hypothesis, authorizing principal, exact rule/method/case
versions, and a fresh non-cache run that started after the failed observation.
Pre-existing, same-batch, cached, unrelated-producer, or merely later passing
results do not establish causal repair.

## 10. Conditions and work

`ConditionOccurrence` is the stable policy-free trace shared by all adapters.

```ts
type ConditionKind =
  | 'config.invalid'
  | 'definition.unadmitted'
  | 'identity.unresolved'
  | 'observation.missing'
  | 'observation.inconclusive'
  | 'method.unreachable'
  | 'observation.inapplicable'
  | 'observation.expired'
  | 'challenge.open'
  | 'operation.failed'
  | 'cleanup.failed'

interface ConditionOccurrence {
  ref: Ref<'condition'>
  kind: ConditionKind
  rule: Ref<'rule'>
  claimUse: Ref<'claim-use'>
  causes: readonly Cause[]
  openedAt: Revision
  active: readonly ActivationInterval[]
  disposition?: 'resolved' | 'superseded' | 'withdrawn'
  closedAt?: Revision
}
```

Recurrence may create a new activation interval or a new occurrence according
to the rule's stable case key; the choice is deterministic and inspectable.
`conditions.active` and `conditions.history` are distinct queries. Configuration
disablement can end active membership while leaving history intact.

Work is a coordination overlay. One ready item is deduplicated per
condition/action pair. Claims return a lease generation and fencing token;
renew, release, note, and close require the current token and expected version.
Late workers cannot mutate a newer lease. Quotas, backoff, blocker state,
objection windows, and no-progress signals are explicit. Work closure reports
the recomputed condition and cannot change evidence, admission, or policy.

## 11. Authority and admission

The kernel accepts an authenticated `ActorSession` from a separately configured
`AuthorityProvider`. A command names its required capability; the provider
verifies grants, delegation, scope, expiry, and revocation. A caller-supplied
principal string is never an authority proof.

Admission events admit, reject, revoke, or supersede exact versions of modules,
claims, routes, methods, adequacy, applicability, identity relations, and
presentation catalogs. Revocation changes current usability and may open new
conditions; it never deletes the observations produced under the earlier
admission. Agents may propose any definition or relation but cannot authorize
their own proposals.

The concrete signature, review, and delegation topology is a deployment
profile. Hostile executable modules remain gated on a separate loader-security
contract. v5 requires inert discovery and capability checks but does not claim
sandbox isolation.

## 12. Policy and overrides

Policy evaluates active conditions from one snapshot at an explicit instant.
Policy rules combine by the strictest action (`allow < note < warn < block`). An
equal-scope contradiction is invalid policy rather than order-dependent
behavior.

A deployment override targets exact condition/use/profile/action refs. It
records capability proof, rationale, scope, creation and expiry instants, and
review owner. It may only replace the specified consumer action. It cannot hide
the condition or affect adequacy, applicability, admission, or evidence.

Override queries cover active, expired, unused, shadowed, and ambiguous records.
Commands cover create, renew, revoke, and prune. Expiry is a derived lifecycle
transition at the policy evaluation instant; pruning is optional housekeeping
and does not erase the historical record.
Source-local visibility directives are presentation policy, not deployment
authority. Project-wide `enabled: false` is configuration. Temporary permission
to deploy is an override.

Policy evaluation returns a `DecisionToken` bound to snapshot, config, profile,
override set, authority clock, `evaluatedAt`, and `validUntil`. A later deploy or
CI publication must present it; expiry or changed inputs forces re-evaluation.

Counterfactual comparison uses a sealed candidate bundle containing complete
definitions, module locks, configuration, and policy. It returns hypothetical
obligations, evidence reuse, conditions, and work projections without writing
live conditions or work.

## 13. Query and command service

Queries are side-effect-free and snapshot-bound:

```ts
trust.query.capabilities.get()
trust.query.config.resolve(input)
trust.query.config.inspect(input)
trust.query.conditions.active(input)
trust.query.conditions.history(input)
trust.query.conditions.explain(input)
trust.query.work.ready(input)
trust.query.work.get(input)
trust.query.evidence.get(input)
trust.query.policy.evaluate(input)
trust.query.policy.compare(input)
trust.query.overrides.list(input)
trust.query.snapshots.get(input)
trust.query.changes.since(input)
```

Commands are capability-checked, idempotent, expected-version operations:

```ts
trust.command.contexts.put(input)
trust.command.contexts.drop(input)
trust.command.runs.plan(input)
trust.command.runs.execute(input)
trust.command.runs.submit(input)
trust.command.operations.reconcile(input)
trust.command.work.claim(input)
trust.command.work.renew(input)
trust.command.work.release(input)
trust.command.work.note(input)
trust.command.work.close(input)
trust.command.overrides.create(input)
trust.command.overrides.renew(input)
trust.command.overrides.revoke(input)
trust.command.overrides.prune(input)
trust.command.proposals.submit(input)
trust.command.admissions.decide(input)
```

Every command carries `idempotencyKey`, `expectedSnapshot` or a narrower
expected version, and the actor session supplied by its transport. Operation
history distinguishes intent, attempt, effect, commit, delivery, cleanup, and
reconciliation. Retry lookup returns the original receipt. An indeterminate
delivery is reconciled before retrying.

## 14. Diagnostics, reports, and adapters

```ts
interface TrustDiagnostic {
  schemaVersion: 1
  condition: Ref<'condition'>
  rule: Ref<'rule'>
  claimUse: Ref<'claim-use'>
  kind: ConditionKind
  messageId: string
  messageData: Record<string, string | number | boolean>
  message: string
  locations: readonly SourceSpan[]
  causes: readonly Cause[]
  affectedUses: readonly Ref<'claim-use'>[]
  limits: readonly Limit[]
  authority: AuthorityBoundary
  severity: 'note' | 'warning' | 'error'
  action: 'allow' | 'note' | 'warn' | 'block'
  actions: readonly ActionDescriptor[]
  snapshot: SnapshotToken
}

interface TrustReport {
  schemaVersion: 1
  snapshot: SnapshotToken
  config: Ref<'resolved-config'>
  profile: Ref<'policy-profile'>
  decision: DecisionToken | null
  conditions: readonly TrustDiagnostic[]
  operationErrors: readonly OperationError[]
  overrides: readonly OverrideSummary[]
  deprecations: readonly DeprecationNotice[]
  stats?: OperationalStats
}
```

Domain message catalogs own semantic wording. Policy controls channel,
visibility, severity, action, and fallback. Adapters may shorten display text
but retain message ID/data and the complete structured record.

LSP diagnostics carry refs and structured data. Code actions are generated only
from current `ActionDescriptor`s; privileged or evidence-producing actions open
an explicit command flow and are never disguised as automatic fixes.

The CLI uses the same report and formatter registry. `trust ci` exits:

- `0`: a valid policy decision allows the snapshot;
- `1`: a valid policy decision blocks the snapshot;
- `2`: usage, configuration, authority, or operation failure prevented a valid
  decision.

The initial MCP facade has five task-oriented tools:

- `trust_status` — obtain the current report and capability/version summary;
- `trust_explain` — expand a condition, rule, config, evidence, or action ref;
- `trust_work` — list, claim, renew, note, release, or close work;
- `trust_evidence` — plan, execute, submit, or reconcile evidence operations;
- `trust_policy` — evaluate/compare policy and manage explicit overrides.

All inputs and outputs have complete versioned schemas and structured error
content. MCP does not expose an arbitrary kernel-operation tunnel.

Devtools consumes snapshot/change queries and the same explanation/report DTOs.
It may display historical conditions and suppressed actions together because
neither is deleted by projection.

## 15. Author conformance

`TrustRuleTester` ships with the authoring package. Fixtures can assert:

- subject discovery, stable refs, source remapping, and overlay behavior;
- config resolution, options/defaults, lowering, collisions, and admission;
- routes, adequacy, applicability, evidence requirements, and full batches;
- condition codes, messages, locations, causes, limits, and legal actions;
- diagnosis, preview, apply, and fresh re-evaluation traces;
- challenge and cross-version repair histories;
- self-admission, favorable partial returns, undeclared dependencies, stale
  evidence, late leases, disappearing conditions, and mutating-query negatives;
- TypeScript inference and exhaustiveness; and
- runtime schema equivalence across service, CLI, LSP, MCP, and Devtools.

## 16. Compatibility and experimental surfaces

Authoring API, service API, and wire schema versions are explicit and may move
independently only through declared compatibility adapters. Experimental and
next-major namespaces are visibly unstable. Deprecation and replacement paths
are machine-readable and appear in reports. Types, runtime schemas,
documentation examples, and conformance fixtures must name the same release.

## 17. Non-transfers and exclusions

- Installed or executable code is not admitted semantics.
- Severity and visibility do not activate obligations or evidence methods.
- Work, notes, popularity, agent agreement, and PR state are not evidence.
- A valid schema, clean report, applied edit, or converged fix is not proof.
- Cache validity is not evidence applicability.
- Warning/error counts are not confidence.
- AST visitors are one provider strategy, not the universal Trust rule model.
- No agent may admit its own claim, method, proof, repair, or protocol revision.
- v5 claims no universal proof, analyzer completeness, liveness, lawful
  cross-method score, hostile-code isolation, or cross-domain validity.
