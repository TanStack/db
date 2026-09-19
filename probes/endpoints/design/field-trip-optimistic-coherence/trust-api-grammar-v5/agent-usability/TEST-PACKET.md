# TanStack Trust v5 — condensed agent test packet

This is a proposed API, not an implementation. Use only this packet and your
assigned workflow. Simulate how you would use the design; do not inspect other
Trust design files.

## Product

TanStack Trust is “linting for agents.” Domain packages and projects define
rules about software, evidence methods for evaluating them, and messages that
explain failures. Trust keeps the evidence history and exposes current
conditions. Consumer policy decides whether those conditions warn or block.

Trust currently lives inside TanStack DB Endpoints. An example rule is
`endpoints/safe-skip-refetch`: an endpoint may omit an authoritative refetch
only when a valid support route has applicable evidence.

## Non-negotiable distinctions

- Installing, enabling, admitting, executing, and permitting deployment are
  different states.
- Claims exist before evidence. Alternate support routes and joint premises are
  retained.
- Work items, notes, PRs, agent agreement, applied edits, and successful command
  delivery are not evidence.
- Severity and policy do not change evidence or applicability.
- Queries are side-effect-free. Commands are authorized, idempotent, and bound
  to expected versions.
- Every interface projects the same condition, action, error, report, and
  snapshot schemas.

## Authoring

```ts
const safeSkipRefetch = defineRule({
  meta: { code: 'endpoints/safe-skip-refetch', version: 1 },
  options: schema.object({
    level: schema.enum(['basic', 'standard', 'strict']),
  }),
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

export default defineTrustModule({
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

Rule registration deterministically lowers claims, premises, routes, methods,
adequacy, applicability, messages, and actions into independently versioned
parts. `TrustRuleTester` can assert discovery, lowering, configuration,
evidence, conditions, diagnostics, actions, transitions, and hostile cases.

## Configuration and policy

```ts
export default defineTrustConfig([
  config('base', {
    modules: { endpoints: endpointsTrust },
    extends: [endpointsTrust.configs.recommended],
  }),
  config('endpoints', {
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

Named config fragments match subjects and merge in order. Resolution is
deterministic and records all contributing/excluded layers, defaults, conflicts,
source spans, exact module versions, and a revision. Configuration activates
obligations. Policy controls visibility, severity, fallback, and action.

## Core references and read models

Durable objects use opaque wire-safe refs such as `ConditionRef`, `RuleRef`,
`ClaimUseRef`, `MethodRef`, `WorkRef`, and `OverrideRef`.

```ts
interface SnapshotToken {
  version: string
  cursor: string
  configRevision: string
  evaluatedAt: string
}

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

interface ActionDescriptor {
  id: string
  kind: string
  title: string
  requiresCapability?: string
  expectedSnapshot: SnapshotToken
  disabled?: { code: string; message: string }
  inputSchema: unknown
}

interface TrustDiagnostic {
  schemaVersion: 1
  condition: ConditionRef
  rule: RuleRef
  claimUse: ClaimUseRef
  kind: ConditionKind
  messageId: string
  messageData: Record<string, string | number | boolean>
  message: string
  locations: SourceSpan[]
  causes: Cause[]
  affectedUses: ClaimUseRef[]
  limits: Limit[]
  authority: AuthorityBoundary
  severity: 'note' | 'warning' | 'error'
  action: 'allow' | 'note' | 'warn' | 'block'
  actions: ActionDescriptor[]
  snapshot: SnapshotToken
}

interface TrustReport {
  schemaVersion: 1
  snapshot: SnapshotToken
  config: ResolvedConfigRef
  profile: PolicyProfileRef
  decision: DecisionToken | null
  conditions: TrustDiagnostic[]
  operationErrors: OperationError[]
  overrides: OverrideSummary[]
  deprecations: DeprecationNotice[]
  stats?: OperationalStats
}
```

Conditions have retained occurrence history and separate active intervals.
`conditions.active` and `conditions.history` are distinct queries.

## TypeScript service

Queries are snapshot-bound and side-effect-free:

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

Commands return discriminated committed/rejected/indeterminate receipts. Each
input includes an `idempotencyKey`, expected snapshot or narrower version, and
an authenticated actor session supplied by the transport:

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

`runs.plan` commits the method, intended subjects/cases, coverage, expected
cardinality or stopping rule, dependencies, and snapshot. `runs.execute` runs an
internal method. `runs.submit` accepts an external result only with the run
ticket and validates the complete returned batch atomically. Failed,
unreachable, cancelled, invalid, or cleanup-failed runs add no observation.

Work claims return a fenced lease generation. Later renew/note/release/close
commands require the current fencing token. Closing work returns the freshly
computed condition state and cannot alter evidence.

## Policy comparison and overrides

Policy rules combine by the strictest action. Contradictory rules at equal scope
are invalid. A deployment override targets exact conditions, uses, profile, and
action; records authority, rationale, and expiry; and never hides the condition.

Override queries include list and inspection of active, expired, unused,
shadowed, and ambiguous records. Commands cover create, renew, revoke, and
prune. Expiry is derived at the policy evaluation instant; pruning does not
erase history. Policy evaluation returns a decision token bound to snapshot,
profile, override set, evaluation instant, and validity deadline. Deployment
must present the token and re-evaluate when its inputs or deadline change.

`policy.compare` takes the current snapshot and a sealed candidate bundle with
complete module locks, definitions, configuration, and policy. It returns newly
active obligations, reusable evidence, new conditions, and hypothetical work.
It does not write live state.

## LSP, CLI, MCP, and Devtools

LSP document versions enter as transient contexts through
`command.contexts.put`; diagnostics then read that exact context. LSP data
contains the complete diagnostic refs and actions. Code actions come only from
current `ActionDescriptor`s. Privileged and evidence-producing actions open an
explicit command flow; they are not automatic fixes.

CLI commands use the service operation names and the same report/error schemas.
`trust ci --profile ci` does not run hidden evidence methods and exits:

- `0`: valid policy decision allows the snapshot;
- `1`: valid policy decision blocks the snapshot;
- `2`: no valid decision because usage, configuration, authority, or an
  operation failed.

The MCP server intentionally exposes five task tools:

- `trust_status`
- `trust_explain`
- `trust_work`
- `trust_evidence`
- `trust_policy`

Each has a complete versioned input/output schema. `trust_work` covers list,
claim, renew, note, release, and close. `trust_evidence` covers plan, execute,
submit, and reconcile. `trust_policy` covers evaluate, compare, and override
management. There is no arbitrary kernel-operation tool.

Devtools reads snapshots and cursor changes and renders the same report,
condition history, explanation, evidence, work, admission, config, policy, and
override records.

## Your simulation report

Complete your assigned workflow as though this API existed. Return:

1. **Assumptions** — only facts not present in the packet.
2. **Code and calls** — concrete TypeScript/config plus LSP, MCP, CLI, or
   Devtools interactions you would use. Show important inputs and fields.
3. **State trace** — the expected conditions, evidence, work, policy, and
   snapshot changes after each step.
4. **Clear parts** — what was directly discoverable from the design.
5. **Friction** — awkward naming, excess ceremony, missing affordances, or
   ambiguous ownership.
6. **Invented API ledger** — every operation, type, field, default, error rule,
   authority behavior, or state transition you had to invent. Mark each as
   essential or merely convenient.
7. **Safety check** — any path that might let work, policy, an edit, or an agent
   assertion masquerade as evidence or authority.
8. **Smallest repair** — the minimum design change that would remove the most
   consequential friction you observed.

Do not redesign the whole system and do not consult another agent. The goal is
to expose what this packet actually lets one fresh user recover.
