# Workflow 1 simulation — editor repair loop

## 1. Assumptions

1. The project has an effective configuration equivalent to the packet's
   `endpoints` fragment: `endpoints/safe-skip-refetch` is enabled at
   `standard`, and the `development` and `ci` policy profiles are available.
2. The initial diagnostic is for illustrative LSP document version `17`. A
   harmless second edit creates version `18` between explanation and planning;
   this supplies the stale-version case. All refs and snapshot values below are
   illustrative opaque values, not guessed ref syntax.
3. For version `18`, the `derived` route's `sameArtifact`,
   `confirmedBaseline`, and `noOverlap` premises already have applicable,
   adequate evidence. `completeEffects` is the only missing premise. No
   `certificate` route is currently satisfied.
4. The authenticated transport session has whatever capability the current
   `gatherEvidence` action says it requires. If it does not, the action is
   disabled and the simulation stops before attempting a command.
5. A method-specific external effect-oracle runner exists and can consume the
   planned subjects, cases, dependencies, and ticket. The packet does not
   specify how that runner is discovered or invoked.
6. The external batch is valid under the rule's omitted
   `effectOracleResultSchema`, and `assessEffectOracle` finds it adequate. No
   source or dependency changes occur between the refreshed plan and the final
   submission.
7. The shown application edit is representative because the packet does not
   include the endpoint source API.

## 2. Code and calls

Names marked as invented here are collected in section 6. They illustrate the
minimum wire shapes needed to perform the workflow; they are not claims that
the proposed API already defines those shapes.

### Effective configuration and source edit

The relevant project configuration is:

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

The semantic source change is represented by this concrete TypeScript diff:

```diff
 export async function updateTodo(input: UpdateTodoInput) {
   const result = await applyUpdateTodo(input)
-  await refetchTodos()
   return result
 }
```

The names in this diff are application-local placeholders. The important fact
for Trust is that the exact unsaved document version now omits the authoritative
refetch.

### Publish and inspect the LSP diagnostic

The LSP adapter first places the exact unsaved text into a transient context.
The packet mandates `idempotencyKey`, an expected version, and a
transport-supplied actor, but does not define the rest of this input:

```ts
const put17 = await trust.command.contexts.put({
  idempotencyKey: 'lsp-put-updateTodo-v17',
  expectedSnapshot: previousSnapshot,
  context: {
    kind: 'lsp.document',
    uri: 'file:///workspace/src/endpoints/updateTodo.ts',
    documentVersion: 17,
    languageId: 'typescript',
    text: editorDocumentText,
  },
})
```

The server then publishes a standard LSP notification whose `data` contains
the complete shared diagnostic. The `data.trustDiagnostic` wrapper name is
illustrative:

```json
{
  "method": "textDocument/publishDiagnostics",
  "params": {
    "uri": "file:///workspace/src/endpoints/updateTodo.ts",
    "version": 17,
    "diagnostics": [
      {
        "code": "endpoints/safe-skip-refetch",
        "message": "Required completeEffects evidence is missing for updateTodo.",
        "data": {
          "trustDiagnostic": {
            "schemaVersion": 1,
            "condition": "<ConditionRef from server>",
            "rule": "<RuleRef from server>",
            "claimUse": "<ClaimUseRef from server>",
            "kind": "observation.missing",
            "messageId": "evidenceMissing",
            "messageData": {
              "premise": "completeEffects",
              "endpoint": "updateTodo"
            },
            "message": "Required completeEffects evidence is missing for updateTodo.",
            "locations": ["<SourceSpan from server>"],
            "causes": ["<Cause from server>"],
            "affectedUses": ["<ClaimUseRef from server>"],
            "limits": [],
            "authority": "<AuthorityBoundary from server>",
            "severity": "<note | warning | error from server>",
            "action": "<allow | note | warn | block from server>",
            "actions": [
              {
                "id": "<current action id>",
                "kind": "evidence.plan",
                "title": "Gather evidence",
                "requiresCapability": "<value if present>",
                "expectedSnapshot": "<SnapshotToken S17>",
                "inputSchema": "<schema supplied by server>"
              }
            ],
            "snapshot": "<SnapshotToken S17>"
          }
        }
      }
    ]
  }
}
```

I retain the whole `TrustDiagnostic`; I do not reconstruct refs from the URI,
rule code, or message text. I also check `disabled` and
`requiresCapability` before offering or invoking the action.

### Get the deeper explanation with MCP

Using only values from the diagnostic, the first MCP query is:

```ts
const explanation17 = await mcp.trust_explain({
  schemaVersion: 1,
  condition: diagnostic17.condition,
  snapshot: diagnostic17.snapshot,
})
```

The response must retain both routes. Conceptually I expect it to show the
`derived` route with `completeEffects` missing and the independent
`certificate` route unsatisfied. I do not treat the prose explanation as
evidence; it is a read model of the cited snapshot.

### Handle an intervening document version

Before planning, the editor produces version `18`. The LSP adapter submits the
new exact text and explicitly drops the prior transient context:

```ts
const put18 = await trust.command.contexts.put({
  idempotencyKey: 'lsp-put-updateTodo-v18',
  expectedSnapshot: currentSnapshotAfter17,
  context: {
    kind: 'lsp.document',
    uri: 'file:///workspace/src/endpoints/updateTodo.ts',
    documentVersion: 18,
    languageId: 'typescript',
    text: editorDocumentTextV18,
  },
})

await trust.command.contexts.drop({
  idempotencyKey: 'lsp-drop-updateTodo-v17',
  expectedSnapshot: put18.snapshot,
  context: put17.context,
})
```

Attempting the old action demonstrates the expected-version fence:

```ts
const stalePlanAttempt = await mcp.trust_evidence({
  schemaVersion: 1,
  operation: 'plan',
  input: {
    idempotencyKey: 'plan-updateTodo-v17',
    expectedSnapshot: diagnostic17.actions[0].expectedSnapshot,
    actionId: diagnostic17.actions[0].id,
    actionInput: {},
  },
})
```

I expect a `rejected` receipt because its expected snapshot is stale. It must
not create a run or observation. I do not change the expected snapshot and
blindly resend the old action. Instead I consume the diagnostic published for
version `18` and use its new condition, claim-use, action, and snapshot values.
Whether refs are reused across document versions is deliberately not assumed.

### Plan, externally gather, and submit the complete evidence batch

First, re-explain the fresh condition and select the method offered by the
current action/input schema rather than hard-coding a method ref:

```ts
const explanation18 = await mcp.trust_explain({
  schemaVersion: 1,
  condition: diagnostic18.condition,
  snapshot: diagnostic18.snapshot,
})

const gather = diagnostic18.actions.find(
  (action) => action.kind === 'evidence.plan',
)
if (!gather || gather.disabled) throw new Error('No enabled evidence plan action')
```

Then invoke the plan operation with a fresh idempotency key and the action's
exact expected snapshot. `method` is shown as a value selected through the
action schema/explanation; the packet does not define that linkage.

```ts
const planReceipt = await mcp.trust_evidence({
  schemaVersion: 1,
  operation: 'plan',
  input: {
    idempotencyKey: 'plan-updateTodo-v18',
    expectedSnapshot: gather.expectedSnapshot,
    actionId: gather.id,
    actionInput: {
      condition: diagnostic18.condition,
      claimUse: diagnostic18.claimUse,
      method: explanation18.offeredMethods[0].ref,
    },
  },
})
```

For a committed plan, I expect the result to expose the already-committed
method choice, exact intended subjects/cases, `enumerated-cases` coverage,
expected cardinality (or stopping rule), dependencies, bound snapshot, and a
run ticket. The following output field names are illustrative:

```ts
const plan = planReceipt.result as {
  run: string
  runVersion: string
  ticket: string
  method: string
  intendedSubjects: unknown[]
  cases: Array<{ ref: string }>
  coverage: 'enumerated-cases'
  expectedCardinality?: number
  stoppingRule?: unknown
  dependencies: unknown[]
  snapshot: SnapshotToken
}
```

The external runner is constrained to that plan. It returns method-specific raw
measurements, not an agent-authored `completeEffects: true` assertion:

```ts
const completeResult: EffectOracleResult = await effectOracleExternal.run({
  ticket: plan.ticket,
  method: plan.method,
  subjects: plan.intendedSubjects,
  cases: plan.cases,
  coverage: plan.coverage,
  dependencies: plan.dependencies,
})

// Illustrative shape only; the real shape must come from
// effectOracleResultSchema.
// {
//   run: plan.run,
//   cases: plan.cases.map(c => ({
//     case: c.ref,
//     artifactDigest: '<measured digest>',
//     observedEffects: '<method-defined raw value>',
//     transcriptDigest: '<runner-produced digest>',
//   })),
//   dependencies: '<measured dependency versions>',
//   completion: { returnedCardinality: plan.cases.length },
// }
```

Submit the whole returned batch atomically. I use the narrower run version so
unrelated global snapshot advances do not tempt the client to strip version
checking:

```ts
const submitReceipt = await mcp.trust_evidence({
  schemaVersion: 1,
  operation: 'submit',
  input: {
    idempotencyKey: 'submit-updateTodo-v18-effectOracle',
    expectedRunVersion: plan.runVersion,
    ticket: plan.ticket,
    result: completeResult,
  },
})
```

If delivery is `indeterminate`, I do not assume success and do not submit under
a new idempotency key. I reconcile the same operation:

```ts
const reconciled = await mcp.trust_evidence({
  schemaVersion: 1,
  operation: 'reconcile',
  input: {
    operation: submitReceipt.operation,
    idempotencyKey: 'submit-updateTodo-v18-effectOracle',
  },
})
```

Only a final `committed` receipt permits proceeding as if observations may now
exist. A rejected/invalid/failed batch adds no observation.

### Confirm the exact document version

I ask for current status for version `18` and evaluate policy at the returned
snapshot; these MCP input shapes are illustrative because their schemas are not
included in the packet:

```ts
const status18 = await mcp.trust_status({
  schemaVersion: 1,
  context: {
    uri: 'file:///workspace/src/endpoints/updateTodo.ts',
    documentVersion: 18,
  },
  snapshot: 'current',
})

const ciDecision = await mcp.trust_policy({
  schemaVersion: 1,
  operation: 'evaluate',
  input: {
    profile: 'ci',
    snapshot: status18.report.snapshot,
    claimUse: diagnostic18.claimUse,
  },
})
```

The LSP server should publish an updated diagnostic set for version `18`. The
successful path has no active `endpoints/safe-skip-refetch` diagnostic for that
claim use, and a new CI decision token allows that snapshot. An old decision
token is not reused.

If the diagnostic remains, I do not equate a committed submission with an
adequate observation. I pass the *current* condition and snapshot from
`status18` to `trust_explain`, then inspect its current `kind`, causes, limits,
route premises, operation errors, and actions. For example, the service may
report a packet-defined kind such as `observation.inconclusive`,
`observation.inapplicable`, `observation.expired`, `challenge.open`, or
`operation.failed`. That current explanation determines whether to gather a
new planned batch, reconcile an operation, or leave the condition visible.

If a version `19` appears before submission or confirmation, the version `18`
result remains bound to its planned subjects and dependencies. I refresh the
version `19` diagnostic and let Trust decide whether the observation is
reusable; I never rewrite the ticket, claim-use ref, or expected version to make
the old batch appear current.

## 3. State trace

`S17`–`S21` are labels for complete `SnapshotToken` values. The actual tokens
remain opaque, and their `configRevision` stays unchanged in this scenario.

| Step | Conditions | Evidence | Work | Policy | Snapshot |
|---|---|---|---|---|---|
| 0. Before the edit | No assertion about the rule's condition is needed. | Existing observations for the three assumed derived-route premises may exist. | Unchanged. | Any prior decision is bound to its prior snapshot. | `S16` |
| 1. Put document v17 | `observation.missing` is active for `completeEffects` on the exact v17 claim use; its occurrence and active interval begin. | No new evidence. | No work item is created. | A CI evaluation would block; development may warn under the assumed profiles. | committed `contexts.put` yields `S17` |
| 2. Explain v17 | No change; explanation retains both support routes. | No change. | No change. | No change; this is a query. | `S17` |
| 3. Put v18 and drop v17 | The current context now has a v18 missing-evidence condition. Dropping v17 ends its active context interval while history remains. Exact ref reuse is unspecified, so only returned refs are used. | No change. | No change. | A token for `S17` is no longer current. | put yields `S18`; drop yields `S19` |
| 4. Attempt v17 plan | Rejected stale action; current v18 condition remains active. | No observation is added. | No work item and no run should be created. | No change. | remains `S19` |
| 5. Explain and plan v18 | The missing condition remains active. A committed run plan now fixes method, subjects/cases, coverage, completeness rule, dependencies, and source snapshot. | Still no observation: a plan is not evidence. | Still unchanged; a run is not silently treated as a work item. | Any prior decision token is stale after the committed plan. | plan commit yields `S20` |
| 6. Run external oracle | No Trust state change while the external runner gathers data. | Raw external result exists outside Trust but is not yet an observation. | No change. | No change. | `S20` |
| 7. Submit complete batch | On committed validation and adequate evaluation, the `completeEffects` premise becomes supported, the `derived` route is satisfied, and the missing condition's active interval closes. If validation/adequacy fails, the condition stays active. | Success atomically adds the returned observations; rejection, invalidity, failure, cancellation, unreachability, or cleanup failure adds none. | No change. | The `S20` decision is no longer current. An override is neither created nor needed. | committed submit yields `S21`; rejected remains `S20` or returns the server's current token |
| 8. Status, LSP refresh, policy evaluate | Success: no active diagnostic for the v18 claim use; history still contains the prior occurrence. Failure: the current diagnostic explains the remaining condition. | Query only. | No change. | A fresh CI decision is `allow` only if the now-current report has no blocking condition under that profile; the token is bound to `S21` and its evaluation deadline. | current token, expected `S21` on success |

No `trust_work` mutation occurs anywhere in the workflow. A future work item
could coordinate evidence gathering, but claiming, noting, or closing it would
not change the evidence row above.

## 4. Clear parts

- The diagnostic has enough durable identity to avoid message-text matching:
  condition, rule, claim use, action, and snapshot all travel together.
- Query/command separation is clear. Explanation, status, and policy evaluation
  cannot silently gather evidence.
- The plan/ticket/complete-batch model makes the evidence scope explicit before
  external execution and prevents partial submission from looking complete.
- Expected versions, idempotency keys, and indeterminate receipts establish the
  right stale-state and uncertain-delivery posture.
- The design clearly says that planning, work, notes, edits, command delivery,
  and agent agreement are not evidence.
- Alternate support routes remain visible, so the explanation does not flatten
  the claim to only the currently missing `completeEffects` premise.
- Conditions preserve history separately from active intervals, which makes an
  LSP diagnostic disappearing after repair auditable rather than destructive.
- Policy and overrides remain downstream of evidence/applicability, and `ci`
  does not run a hidden method.

## 5. Friction

1. The largest gap is action invocation. `ActionDescriptor` gives an `id`,
   `kind`, expected snapshot, and input schema, but not a normative service/MCP
   operation or request envelope. A fresh client must guess that
   `evidence.plan` means `trust_evidence` with `operation: 'plan'` and how the
   action id and schema-produced input are nested.
2. The packet says every MCP tool has a complete versioned schema, but those
   schemas are absent here. Inputs and outputs for `trust_explain`,
   `trust_status`, and `trust_policy` therefore cannot be recovered precisely.
3. `runs.plan` promises the right commitments, but the plan receipt/ticket shape
   and the narrower version accepted by `runs.submit` are not shown. That makes
   correct stale handling depend on invented field names and matching rules.
4. The external path names `effectOracleResultSchema` but does not show it or
   explain how an agent locates the method-specific runner. The safe distinction
   between raw measurements and an agent assertion is conceptual rather than
   mechanically demonstrable from this packet.
5. Transient LSP context lifecycle is ambiguous: whether a new document version
   supersedes the old context, whether the adapter must call `contexts.drop`,
   and whether condition/claim-use refs survive a version change are unstated.
6. Receipt discriminator fields, stable error codes, current-version hints, and
   reconciliation inputs are not specified. The three outcomes are clear, but
   reliable client branching is not.
7. The trigger for fresh LSP publication after a run submission is not stated.
   The client can query status, but it cannot know whether to await a push,
   request refresh, or republish the document.
8. Evidence reuse for a semantically unchanged v18/v19 edit is correctly left
   to applicability/adequacy, but the client has no shown query result that
   explains the reuse decision before planning another run.

## 6. Invented API ledger

This ledger includes every packet-absent operation, type, field, default, error
rule, authority behavior, or transition used above. Existing packet operations
are named here only where their call shape was invented.

| Invented item | Classification | Why it was needed |
|---|---|---|
| Application-local `UpdateTodoInput`, `applyUpdateTodo`, and `refetchTodos` names | Merely convenient | Makes the source diff concrete; they have no Trust semantics. |
| Placeholder URI `/workspace/...`, document versions `17`/`18`, idempotency-key strings, and `S17`–`S21` labels | Merely convenient | Provides traceable examples without asserting wire ref syntax. |
| `contexts.put.context` envelope and its `kind`, `uri`, `documentVersion`, `languageId`, and `text` fields | Essential | The packet says LSP versions enter as transient contexts but omits the command input schema. |
| `contexts.put` receipt fields `snapshot` and `context` | Essential | The next expected-version command and later drop need returned committed identities. |
| `contexts.drop.context` input and the explicit put-new-then-drop-old lifecycle | Essential | The packet lists `drop` but does not define context identity or version supersession. |
| Dropping v17 ends its active interval while retaining history | Essential | This is the state transition used in the trace; retained history/active intervals are specified, but their behavior on transient-context drop is not. |
| Standard LSP diagnostic wrapper field `data.trustDiagnostic` | Merely convenient | The packet requires complete diagnostic data but does not name its LSP container field. |
| Representing `SourceSpan`, `Cause`, `AuthorityBoundary`, refs, and snapshot as JSON placeholders | Merely convenient | Their schemas/wire encodings are omitted; no behavior relies on the placeholders. |
| MCP request fields `schemaVersion`, `operation`, and `input` | Essential | Five tools are named, but their promised versioned schemas are absent. |
| `trust_explain({ condition, snapshot })` exact input and `offeredMethods[0].ref` output | Essential | Explanation must be snapshot-bound and a plan needs a method, but the input/output schema is omitted. |
| Explanation output contains per-route/premise status and offered methods | Essential | Needed to retain alternate routes and select the current method without hard-coding it. |
| Mapping `ActionDescriptor.kind === 'evidence.plan'` to `trust_evidence` operation `plan` | Essential | No normative action-to-command/MCP binding is provided. |
| Plan inputs `actionId` and nested `actionInput` with `condition`, `claimUse`, and `method` | Essential | The descriptor exposes an input schema but not how its validated value invokes `runs.plan`. |
| A rejected stale-plan receipt has an unstated snapshot-mismatch error and creates no run | Essential | Expected-version binding requires a safe stale outcome, but the error code/current-token response and no-run transition are not explicit. The report intentionally does not invent a literal error-code string. |
| Refresh rule: never replace the old expected snapshot manually; fetch a new diagnostic/action | Essential | Needed to prevent applying an action to a different document version; client behavior is not prescribed. |
| Plan result fields `run`, `runVersion`, `ticket`, `method`, `intendedSubjects`, `cases`, `coverage`, `expectedCardinality`, `stoppingRule`, `dependencies`, and `snapshot` | Essential | The packet says the plan commits these concepts but does not provide their result schema or field names. |
| External operation `effectOracleExternal.run` and its request envelope | Essential | The workflow requires external gathering, while the packet only names the authoring function `runEffectOracle` and does not expose an external runner interface. |
| `EffectOracleResult` example fields `run`, `cases`, `case`, `artifactDigest`, `observedEffects`, `transcriptDigest`, `dependencies`, `completion`, and `returnedCardinality` | Essential | A concrete complete external batch is required, but `effectOracleResultSchema` is absent. These fields are illustrative and must not substitute for the real schema. |
| External runner authority assumption: its method-defined measurements are acceptable input but not evidence until authorized ticket validation and adequacy evaluation commit | Essential | Prevents raw output or an agent assertion from becoming evidence; the packet gives the boundary concept but not runner attestation/authority fields. |
| Submit inputs `expectedRunVersion`, `ticket`, and `result` | Essential | Ticket and narrower-version concepts are specified, but exact command fields are not. |
| Narrow run-version validation permits unrelated snapshot movement but rejects a changed/consumed run | Essential | The packet permits a narrower version but does not define its matching or consumption rules. |
| Receipt discriminator field/value access such as `outcome === 'committed'`, plus `result`, `operation`, and current `snapshot` fields | Essential | The three receipt outcomes are specified, but their wire schema is not. |
| Reconcile inputs `operation` and original `idempotencyKey` | Essential | `operations.reconcile` exists and MCP evidence covers it, but the correlation input is not shown. |
| Indeterminate handling rule: do not infer observations and reconcile before proceeding | Essential | Prevents successful delivery from masquerading as committed evidence; exact indeterminate visibility is omitted. |
| `trust_status` context filter `{uri, documentVersion}`, `snapshot: 'current'`, and output `report.snapshot` | Essential | Needed to verify the exact unsaved version; tool schema is omitted. |
| `trust_policy` evaluate input `{profile, snapshot, claimUse}` and a result exposing the decision action/token | Essential | The operation is documented but not its MCP envelope or scoping fields. |
| Fresh LSP diagnostic publication is triggered after committed evidence submission | Essential | Needed for the editor repair loop; notification/refresh ownership is unstated. |
| A new source version is not silently substituted into an old run ticket; Trust alone decides evidence reuse | Essential | Preserves exact-context binding. The packet states snapshot binding but does not define cross-document-version reuse behavior. |
| Authenticated session is authorized to plan/submit/reconcile when the descriptor is enabled; unauthorized commands reject without evidence | Essential | Commands are said to be authorized and transport-authenticated, but capability resolution and rejection schema are absent. |
| CI blocks the initial active condition and allows the final snapshot once no blocking condition remains | Essential | Follows the assumed example policy/config; exact policy rule resolution for this diagnostic is not provided by the workflow. |
| Planning advances the global snapshot while creating no work item; external execution alone does not advance it; committed submission advances it and closes the active condition | Essential | These transitions are necessary for the trace. Planning/submission are commands and plans are not evidence, but exact snapshot and condition recomputation timing is not specified. |

## 7. Safety check

- **Edit:** Removing the refetch activates an obligation; the edit itself cannot
  satisfy `completeEffects`.
- **Agent assertion:** I never submit `{ completeEffects: true }`. The external
  runner returns the method schema's raw batch, which remains non-evidence until
  the ticket, full cardinality/stopping rule, dependencies, result schema, and
  adequacy evaluation are validated atomically.
- **Plan and delivery:** A committed plan is still not an observation. A
  successfully delivered command with an indeterminate receipt is also not
  treated as one; it is reconciled. Failed, unreachable, cancelled, invalid,
  or cleanup-failed runs add none.
- **Staleness:** The v17 action is never rebound to v18 by swapping its snapshot
  or refs. A later source version must be evaluated as itself, with reuse
  decided by Trust.
- **Work:** No work command is used. If one were used, claim/note/close would
  coordinate the task only; close's freshly computed condition could report
  success but could not cause it.
- **Policy:** Switching from CI block to development warn, or creating an
  override, would not add evidence or remove the condition. A decision token is
  accepted only for its bound snapshot/profile/override set/evaluation instant
  and before its deadline.
- **Authority:** The actor comes from the authenticated transport, not from an
  MCP input field the agent can forge. The client honors `requiresCapability`
  and `disabled`; absent authority means no command attempt or a rejected
  receipt, never downgraded evidence requirements.
- **History:** A clean editor means no active condition for the exact current
  claim use. It does not erase the prior occurrence or its active interval.

The residual safety risk is the missing external runner/result/attestation
schema. Without it, a naive client could mistake self-reported semantic labels
for method observations even though the packet's conceptual rules forbid that.

## 8. Smallest repair

Add one normative invocation binding to `ActionDescriptor`, or normatively
define it as derivable from `kind`, so a current LSP action is executable
without guessing the MCP tool, operation, or envelope. For example:

```ts
interface ActionDescriptor {
  // existing fields...
  invoke: {
    serviceOperation: 'runs.plan'
    mcp: { tool: 'trust_evidence'; operation: 'plan' }
  }
}
```

Then specify one universal action request shape:

```ts
{
  actionId: string
  expectedSnapshot: SnapshotToken
  idempotencyKey: string
  input: unknown // validated by this descriptor's inputSchema
}
```

This is smaller than changing the evidence model and removes the most
consequential ambiguity in the editor loop: how to turn the exact, current,
authorized diagnostic action into the correct snapshot-bound command.
