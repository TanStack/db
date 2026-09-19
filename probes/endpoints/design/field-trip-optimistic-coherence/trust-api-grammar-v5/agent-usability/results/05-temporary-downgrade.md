# Workflow 05 simulation — temporary endpoint downgrade

## 1. Assumptions

- The transport has already authenticated the incident commander as `actor:ic-17`. The actor is authorized to create deployment overrides for the CI profile, for the exact `orders.update` use, with an `allow` action and a lifetime of at least 45 minutes. The packet says the transport supplies the actor session, but it does not define this capability or its scope.
- Illustrative server time at the first read is `2026-09-17T18:00:00Z`; the requested expiry is `2026-09-17T18:45:00Z`. Server time, not a caller-provided evaluation time, determines expiry.
- The existing condition is `observation.expired`: an earlier complete-effects observation remains in history but is no longer applicable. “Lacks fresh” could instead lower to `observation.missing`; that distinction does not change the override flow.
- `orders.update`'s condition is the only condition currently blocking the relevant CI deployment decision. Otherwise an endpoint-local override could be valid while the aggregate CI decision remained blocked for another reason.
- The deployment system already accepts a Trust decision token and can ask Trust to re-evaluate it. The packet requires this behavior but does not define the consumer API.
- Opaque refs and token strings shown below are illustrative returned values, not encodings a caller constructs.

No configuration, policy rule, evidence, or work item is edited for this workflow.

## 2. Code and calls

All commands below run through the authenticated transport session. In particular, no `actor` or `authority` field is accepted from the command payload.

### Inspect the current state and required authority

```ts
const capabilities = await trust.query.capabilities.get()

const S0 = await trust.query.snapshots.get({ version: 'latest' })
// {
//   version: 'snap-40', cursor: 'cursor-900',
//   configRevision: 'cfg-12', evaluatedAt: '2026-09-17T18:00:00Z'
// }

const active = await trust.query.conditions.active({
  snapshot: S0,
  profile: 'policy-profile:ci',
  subjects: [{ kind: 'endpoint', id: 'orders.update' }],
  rules: ['rule:endpoints/safe-skip-refetch@1'],
})

const [condition] = active.conditions
// condition.condition === 'condition:orders-update-complete-effects'
// condition.claimUse === 'claim-use:orders.update:safe-skip-refetch'
// condition.kind === 'observation.expired'
// condition.action === 'block'
// condition.authority identifies the endpoint/profile boundary

const evidence = await trust.query.evidence.get({
  snapshot: S0,
  claimUse: condition.claimUse,
  premise: 'completeEffects',
  includeHistory: true,
})

const readyWork = await trust.query.work.ready({
  snapshot: S0,
  conditions: [condition.condition],
})

const existingOverrides = await trust.query.overrides.list({
  snapshot: S0,
  profile: 'policy-profile:ci',
  conditions: [condition.condition],
  include: ['active', 'expired', 'unused', 'shadowed', 'ambiguous'],
})

const blocked = await trust.query.policy.evaluate({
  snapshot: S0,
  profile: 'policy-profile:ci',
  subjects: [{ kind: 'endpoint', id: 'orders.update' }],
})
// blocked.decision is a valid blocking decision; the condition remains listed.
```

I would verify that the capability result covers all of the following, rather than inferring authority from the agent's role or from the condition's action:

```ts
// Provisional projection because the packet does not specify the capability schema.
capabilities.grants.some((grant) =>
  grant.capability === 'trust.overrides.create' &&
  grant.profile === 'policy-profile:ci' &&
  grant.conditions.includes(condition.condition) &&
  grant.claimUses.includes(condition.claimUse) &&
  grant.actions.includes('allow') &&
  grant.maxTtlSeconds >= 45 * 60
)
```

The proposed override is deliberately exact. It contains no module-wide, rule-wide, or all-endpoints selector.

```ts
const proposal = {
  targets: {
    conditions: [condition.condition],
    claimUses: [condition.claimUse],
  },
  profile: 'policy-profile:ci',
  action: 'allow',
  rationale: 'IC-17: permit orders.update during incident INC-4821 only',
  expiresAt: '2026-09-17T18:45:00Z',
}
```

### Preview the effect

The packet specifies side-effect-free `policy.evaluate` and `policy.compare`, but neither documented input says how to preview a not-yet-created live override. `policy.compare` explicitly describes a sealed bundle of modules, definitions, configuration, and policy, not a candidate override. For this simulation I use the following essential provisional `proposedOverrides` input:

```ts
const preview = await trust.query.policy.evaluate({
  snapshot: S0,
  profile: 'policy-profile:ci',
  subjects: [{ kind: 'endpoint', id: 'orders.update' }],
  proposedOverrides: [proposal], // provisional API
})

// Expected preview:
// - decision outcome: allow
// - condition still present and still observation.expired
// - existing observation remains expired; no observation is added
// - no work item changes
// - decision validity is bounded by 18:45Z
// - validation reports the authority requirement and no overlap/conflict
```

The equivalent concrete MCP interaction would be:

```ts
trust_policy({
  schemaVersion: 1,
  operation: 'evaluate',
  input: {
    snapshot: S0,
    profile: 'policy-profile:ci',
    subjects: [{ kind: 'endpoint', id: 'orders.update' }],
    proposedOverrides: [proposal],
  },
})
```

The MCP dispatch envelope and preview field are invented because the packet names the tool and operations but omits their schemas.

### Create the override, reconcile uncertainty, and evaluate

```ts
const createReceipt = await trust_policy({
  schemaVersion: 1,
  operation: 'overrides.create',
  input: {
    ...proposal,
    expectedSnapshot: S0,
    idempotencyKey: 'inc-4821-orders-update-45m-v1',
  },
})

// Expected committed projection:
// {
//   status: 'committed',
//   override: 'override:ov-71',
//   committedSnapshot: S1,
//   record: { ...proposal, authority: <server-derived authority> }
// }
```

If delivery is uncertain, I do not create a new key or assume success:

```ts
if (createReceipt.status === 'indeterminate') {
  const reconciled = await trust.command.operations.reconcile({
    operation: 'overrides.create',
    idempotencyKey: 'inc-4821-orders-update-45m-v1',
    expectedSnapshot: S0,
  })
  // No deployment unless reconciliation yields a committed receipt.
}
```

Retrying the exact create payload with the same idempotency key must return the original result and must not create `ov-72`.

The committed override changes durable state, so this simulation expects a new snapshot:

```ts
const S1 = {
  version: 'snap-41',
  cursor: 'cursor-901',
  configRevision: 'cfg-12',
  evaluatedAt: '2026-09-17T18:01:00Z',
}

const deployable = await trust.query.policy.evaluate({
  snapshot: S1,
  profile: 'policy-profile:ci',
  subjects: [{ kind: 'endpoint', id: 'orders.update' }],
})

const D1 = deployable.decision
// D1 is bound to S1, the CI profile, {ov-71}, the evaluation instant,
// and a validity deadline no later than 18:45Z.
// deployable.conditions still contains the unresolved condition.
```

The specified CLI gate should now return a valid allow decision (assuming the stated absence of other blockers):

```sh
trust ci --profile ci
# exit 0; TrustReport still includes the unresolved condition and ov-71
```

The external deployment consumer then presents `D1`. Its concrete interface is not provided; this is a placeholder for the required integration:

```ts
await deploymentGate.permit({
  endpoint: 'orders.update',
  trustDecision: D1,
})
```

### Stale snapshot and overlapping/conflicting override

First, a stale command is rejected without changing the override:

```ts
const staleRenewal = await trust.command.overrides.renew({
  override: 'override:ov-71',
  expiresAt: '2026-09-17T18:50:00Z',
  expectedSnapshot: S0, // stale after create committed S1
  idempotencyKey: 'inc-4821-stale-renewal-probe',
})
// { status: 'rejected', error: { code: 'snapshot.mismatch', current: S1 } }
```

After refreshing S1, a second override with the same exact target, profile, and overlapping lifetime but a conflicting resulting action is also rejected in this simulation:

```ts
const conflicting = await trust.command.overrides.create({
  targets: proposal.targets,
  profile: proposal.profile,
  action: 'warn',
  rationale: 'conflict probe',
  expiresAt: '2026-09-17T18:30:00Z',
  expectedSnapshot: S1,
  idempotencyKey: 'inc-4821-conflict-probe',
})
// { status: 'rejected', error: { code: 'override.ambiguous' } }
```

The fail-closed rejection is provisional. The packet says equal-scope contradictory policy rules are invalid and says override inspection can classify ambiguous records, but does not say whether override creation rejects the overlap, commits an ambiguous record that prevents a decision, or applies a precedence rule.

### Observe automatic expiry

No expiry command or prune is needed. On the first evaluation at or after `18:45:00Z`, server time makes the override expired:

```ts
// Called after the server clock reaches 18:46Z. There is intentionally no
// caller-provided evaluationTime.
const afterExpiry = await trust.query.policy.evaluate({
  snapshot: await trust.query.snapshots.get({ version: 'latest' }),
  profile: 'policy-profile:ci',
  subjects: [{ kind: 'endpoint', id: 'orders.update' }],
})

const overrideHistory = await trust.query.overrides.list({
  snapshot: afterExpiry.snapshot,
  profile: 'policy-profile:ci',
  conditions: [condition.condition],
  include: ['expired'],
})
// ov-71 is visible as expired; afterExpiry is a valid blocking decision.
```

```sh
trust ci --profile ci
# exit 1: valid CI decision blocks orders.update again
```

A deployment attempt that presents old `D1` after `18:45:00Z` must be refused because its deadline has passed. The consumer re-evaluates and receives the blocking decision; it must not treat the earlier exit-0 result or successful command delivery as continuing permission.

### Alternative: revoke early

If the incident ends at `18:30Z`, this branch replaces the expiry branch:

```ts
const current = await trust.query.snapshots.get({ version: 'latest' })

const revoked = await trust.command.overrides.revoke({
  override: 'override:ov-71',
  rationale: 'INC-4821 ended; restore normal deployment policy',
  expectedSnapshot: current,
  idempotencyKey: 'inc-4821-revoke-ov-71',
})
// committed as S2; ov-71 remains in history with status revoked

const afterRevoke = await trust.query.policy.evaluate({
  snapshot: revoked.committedSnapshot,
  profile: 'policy-profile:ci',
  subjects: [{ kind: 'endpoint', id: 'orders.update' }],
})
// block; the condition remains visible
```

Even before 18:45Z, `D1` can no longer authorize deployment after revocation because its bound override set changed.

## 3. State trace

`E0` denotes the unchanged evidence history, including the expired complete-effects observation. `W0` denotes whatever ready/open work already existed; the workflow neither creates nor closes work.

| Step | Condition | Evidence | Work | Override and policy | Snapshot |
|---|---|---|---|---|---|
| Initial read | `C0` active as `observation.expired`, action `block` under CI | `E0`; no fresh complete-effects observation | `W0` | No applicable override; valid decision blocks | `S0` |
| Capability/state inspection | Unchanged and visible | `E0` | `W0` | Read-only | `S0` |
| Preview | Live condition unchanged | `E0`; preview creates none | `W0` | Hypothetical `ov-71` yields allow until no later than 18:45Z | Live state remains `S0` |
| Create commits | `C0` remains active | `E0` | `W0` | `ov-71` active, exact target/profile/action; next evaluation allows | `S1` (new version/cursor, same config revision) |
| Idempotent retry | Unchanged | `E0` | `W0` | Same `ov-71`; no duplicate | `S1` |
| Stale renewal rejection | Unchanged | `E0` | `W0` | Renewal does not apply | `S1` |
| Conflicting create rejection | Unchanged | `E0` | `W0` | `ov-71` remains the only active override | `S1` |
| Deploy before deadline | `C0` remains visible in report | `E0` | `W0` | `D1` permits only while all bindings and deadline remain valid | No Trust write |
| Expiry branch, at/after 18:45Z | `C0` still active | `E0` | `W0` | `ov-71` classified expired; valid decision blocks | No durable write assumed; same version/cursor, later `evaluatedAt` |
| Deploy after expiry | `C0` still active | `E0` | `W0` | `D1` rejected; re-evaluation blocks | No Trust write |
| Early-revoke branch | `C0` still active | `E0` | `W0` | `ov-71` revoked; new evaluation blocks; `D1` invalid | `S2` |

The important invariant is that the only favorable state is the temporary policy decision. The claim, failed premise, condition occurrence/active interval, evidence history, and work history never become favorable because of the override.

## 4. Clear parts

- The packet clearly separates evidence/applicability from severity, policy, and deployment permission. That makes a temporary exception conceptually safe.
- The required scope is explicit: exact conditions, uses, profile, action, rationale, authority, and expiry. This directly prevents a global downgrade when implemented literally.
- Queries are read-only; commands require authentication, idempotency, and an expected version. That yields a clear inspect-preview-create-evaluate sequence.
- The override never hides the condition, and expired/revoked records remain inspectable. Pruning is maintenance, not the expiry mechanism and not history erasure.
- The decision token is explicitly bound to snapshot, profile, override set, evaluation instant, and a deadline. The deploy-after-expiry rule follows directly.
- `trust ci --profile ci` has useful fail-closed exit meanings: `0` allow, `1` valid block, and `2` no valid decision. It runs no hidden evidence method.
- The same schemas across TypeScript, CLI, MCP, LSP, and Devtools make projections conceptually consistent even though the concrete MCP/CLI override syntax is absent.

## 5. Friction

- There is no concrete override input, record, summary, receipt, or error schema. “Targets exact conditions, uses, profile, and action” is enough to understand intent but not enough to construct a call without inventing field names and validation rules.
- There is no specified side-effect-free preview for a proposed live override. `policy.compare` requires a large sealed candidate bundle and does not say that bundle can contain overrides. This is the largest workflow gap.
- `capabilities.get()` and `AuthorityBoundary` are named but not shaped. A caller cannot recover the required capability, whether the 45-minute TTL is authorized, or whether authorization is per condition, use, profile, action, module, or environment.
- Overlap semantics are unresolved. The packet mentions strictest policy combination, equal-scope contradictory policy rules, plus shadowed and ambiguous override records, but never connects those rules to override creation/evaluation.
- The meaning of an override's `action` is not explicit: it could be the replacement action (`allow`) or the action being overridden (`block`). I treated it as the resulting action.
- The prose promises override “inspection,” while the TypeScript query list only includes `overrides.list`; there is no named `overrides.get`/`inspect` operation.
- Snapshot mutation and time are awkward together. `SnapshotToken.evaluatedAt` changes with evaluation, while automatic expiry is derived without a write. It is unclear which token components participate in optimistic command matching and whether a later clock-only snapshot is considered stale.
- Trust defines the token's binding but not the deployment verifier call or its rejection schema. A fresh agent can state the safety rule but cannot wire the last mile.

## 6. Invented API ledger

No unspecified defaults are assumed: targets, profile, action, rationale, expiry, expected snapshot, and idempotency key are all explicit. The following details nevertheless had to be invented.

| Invented item | Why | Necessity |
|---|---|---|
| Literal ref/token encodings such as `condition:...`, `claim-use:...`, `policy-profile:ci`, `override:ov-71`, `snap-40`, and `D1` | The packet requires opaque refs but gives no example values or encoding | Convenient for a readable trace |
| `snapshots.get({ version: 'latest' })` input | Only the operation name is specified | Essential to acquire an expected snapshot |
| `conditions.active` fields `snapshot`, `profile`, `subjects`, and `rules`, including `{ kind: 'endpoint', id }` | Query input schemas are absent | Essential for an exact read |
| `evidence.get` fields `snapshot`, `claimUse`, `premise`, and `includeHistory` | Query input schema is absent | Convenient verification of the evidence invariant |
| `work.ready` fields `snapshot` and `conditions` | Query input schema is absent | Convenient verification of the work invariant |
| `overrides.list` fields `snapshot`, `profile`, `conditions`, and `include`, plus the status filter values | Query input schema is absent; status classes exist only in prose | Essential to inspect overlap and expiry; exact spelling is convenient |
| Initial lowering to `observation.expired`, an expired observation in `E0`, and symbolic work set `W0` | The workflow says “lacks fresh” but does not state the current diagnostic/evidence/work records | Convenient; `observation.missing` would preserve the same flow |
| `capabilities.grants[]` and its fields `capability`, `profile`, `conditions`, `claimUses`, `actions`, `maxTtlSeconds` | Capability response schema is absent | Essential to demonstrate authority inspection |
| Capability name `trust.overrides.create` and the per-target/profile/action/TTL authorization rule | Capability identifiers and authority evaluation are absent | Essential and security-sensitive |
| Server-derived authority behavior: ignore/forbid client authority, derive it from the authenticated session, and record it on commit | The packet says the transport supplies the actor and overrides record authority, but not how they join | Essential and security-sensitive |
| `proposal`/create fields `targets.conditions`, `targets.claimUses`, `profile`, `action`, `rationale`, and `expiresAt` | The semantic requirements exist, but the concrete object shape does not | Essential; property names and nesting are convenient |
| Interpretation of `action: 'allow'` as the resulting action | The word “action” is ambiguous for an override | Essential |
| `policy.evaluate` fields `snapshot`, `profile`, and `subjects` | Input schema is absent | Essential |
| `policy.evaluate.proposedOverrides` and its behavior: full create validation, hypothetical decision/deadline, zero writes | No proposed-override preview is specified | Essential to satisfy the requested preview |
| MCP envelope `{ schemaVersion, operation, input }` and operation strings `evaluate`/`overrides.create` | Only the five tool names and covered operation families are specified | Essential for a concrete MCP call; exact envelope is convenient |
| Create receipt fields `override`, `committedSnapshot`, and `record`; rejected receipt's `error` shape | Only committed/rejected/indeterminate discrimination is specified | Essential to continue safely; names are convenient |
| Create advances durable snapshot `S0 -> S1` while preserving `configRevision` | Override persistence implies a state change, but snapshot transition rules are unstated | Essential |
| Exact retry behavior “same key and payload returns original receipt and creates no duplicate” | Commands are called idempotent, but replay semantics are not detailed | Essential |
| `operations.reconcile` fields `operation`, `idempotencyKey`, and `expectedSnapshot` | The operation exists but its input schema is absent | Essential for an indeterminate create |
| Renewal fields `override`, `expiresAt`, `expectedSnapshot`, and `idempotencyKey` | Operation exists but its input schema is absent | Convenient stale-snapshot probe |
| Rejection code `snapshot.mismatch`, `current: S1`, and validation ordering that rejects a stale command before other validation | Expected-version binding is required, but exact error and precedence are absent | Essential fail-closed behavior; exact code is convenient |
| Conflicting override rule: overlapping equal targets/profile with different resulting actions is rejected at create | Override overlap semantics are absent | Essential and security-sensitive |
| Conflict error code `override.ambiguous` | Error schema is absent | Convenient |
| Preview/result notions “outcome allow” and “validity no later than 18:45Z” as accessible fields | `DecisionToken` is named but not shaped | Essential behavior; field names were intentionally not relied upon |
| Boundary rule “active iff server time is strictly before `expiresAt`; expired at equality” | “Expiry is derived at evaluation instant” does not specify equality | Essential for deploy-at-deadline behavior |
| Expiry causes no durable write and retains the same version/cursor while a new report token has a later `evaluatedAt` | The packet separates derived expiry from pruning but does not define snapshot behavior | Essential for the state trace |
| Decision deadline is capped at the earliest applicable override expiry | The token has a validity deadline and binds the override set, but the exact deadline computation is absent | Essential and security-sensitive |
| Revoke input fields `override`, `rationale`, `expectedSnapshot`, and `idempotencyKey` | Operation exists but input schema is absent | Essential for the early-revoke branch |
| Revoke advances `S1 -> S2`, retains historical record status `revoked`, and immediately invalidates `D1` | History and changing-input re-evaluation imply this, but the exact transition is unstated | Essential |
| External `deploymentGate.permit({ endpoint, trustDecision })` operation | Trust requires token presentation/re-evaluation but supplies no deployment integration | Essential to show the last mile; exact API is convenient |
| Deployment rejection behavior for an elapsed deadline or changed override set, followed by mandatory re-evaluation | Required in prose, but no verifier operation/error schema exists | Essential and security-sensitive |

## 7. Safety check

- The override changes only the CI policy decision. It does not add, refresh, reinterpret, or make applicable any observation; it does not close work; and it does not end the condition's active interval.
- The rationale, incident ticket, agent agreement, successful create receipt, successful CLI invocation, and completed deployment are records of policy/operations, never evidence for `completeEffects`.
- Authority comes only from the authenticated transport and server authorization. A client-provided role, rationale, `authority`, long expiry, or assertion of incident-command status must not grant capability.
- Exact condition and claim-use refs plus the CI profile prevent the exception from applying to other endpoints, uses, or profiles. Any missing/broader selector should be rejected rather than defaulting to “all.”
- Preview is a query and must make no state change. A previewed allow is not a decision token suitable for deployment.
- An indeterminate create is reconciled with the same idempotency key. The agent does not retry under a new key, assume success, or deploy until commit is known.
- Stale expected snapshots and ambiguous/conflicting overrides fail closed. If ambiguity instead exists as stored state, policy evaluation should produce no valid decision and CLI should exit `2`, never choose the looser action.
- The client never supplies `evaluatedAt`. Server time derives expiry, preventing clock rollback or caller-chosen evaluation instants from extending permission.
- Deployment validates the decision token at use time. An expired deadline, revoked/changed override set, changed snapshot/config/profile, or unverifiable token forces re-evaluation. A prior `trust ci` exit `0` is not a reusable authority grant.
- `trust ci` must not gather hidden evidence, and pruning an expired override must not erase its history.

## 8. Smallest repair

Specify one side-effect-free proposed-override variant of `policy.evaluate` (and project it through `trust_policy`) using the exact same `OverrideCreateInput` validator and authority check as `overrides.create`. Its result should state whether creation would be authorized, the exact affected conditions/uses, any overlap classification, the hypothetical decision, and its server-derived validity deadline, while issuing no deployable token and performing no write.

That single addition would make the required preview implementable and force the design to publish the currently missing override shape, authority requirements, overlap behavior, and expiry boundary without redesigning the rest of Trust.
