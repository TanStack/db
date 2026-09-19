# TanStack Trust v5 — agent usability synthesis

## Test boundary

Six fresh, isolated agents each received the same condensed v5 packet and one
workflow. They did not receive the rationale, the full grammar, sibling reports,
or the evaluation rubric. The packet and rubric were frozen before the first
session:

- test packet SHA-256: `195d763570fc747b8f06cfac2269b70d4018a6f07f2195278a7f6365b80fcc9b`
- evaluation protocol SHA-256: `ce9ace687674dd958ee3938944ad93d2615319b50cda8393dc165d2388d9e25a`

These are exploratory usability sessions, not a success-rate estimate. Their
strongest evidence is the concrete code, state traces, and invention ledgers in
the raw reports.

## Bottom line

The agents recovered the architecture but could not recover an executable API.

All six found the intended conceptual route and kept claims, evidence,
conditions, work, policy, authority, and snapshots separate. None treated an
edit, work item, note, PR, successful command delivery, agent assertion, policy
decision, or override as evidence. None invented a hidden evidence run in CI or
a mutating query. This is strong evidence that the v5 ontology and three-layer
architecture communicate the right system.

Every session nevertheless needed consequential inventions. The design names
operations and invariants but usually stops before the versioned input, result,
receipt, error, pagination, capability, and adapter contracts needed to call
them. Two workflows also exposed missing operations, and one exposed a
normative authority hole. The next pass should therefore be a contract-closure
pass, not another ontology rewrite.

## Per-workflow classification

| Workflow | Outcome | Intended path | State fidelity | Primary finding |
| --- | --- | --- | --- | --- |
| 1. Editor repair | Recoverable with invention | Found | Strong | An LSP `ActionDescriptor` cannot be translated normatively into the exact service/MCP command. |
| 2. Expired evidence renewal | Recoverable with invention | Found | Strong | Ready work does not carry a runnable renewal plan, and the work fence does not authorize the resulting run. |
| 3. CI gate | Recoverable with invention | Found | Strong | Exit semantics exist, but no atomic machine-report contract binds the emitted `TrustReport` to the chosen exit. |
| 4. Devtools inspection | Recoverable with invention; one required panel is otherwise unreachable | Found | Strong | Admission records are required in Devtools but have no query operation; all read-model DTOs are also absent. |
| 5. Temporary downgrade | Recoverable with invention; preview is otherwise unavailable | Found | Strong | No side-effect-free proposed-override evaluation exists, and override/capability/conflict/expiry contracts are not concrete. |
| 6. Stricter-level preview | Recoverable with invention | Found | Strong | `policy.compare` requires a sealed candidate, but the candidate, sealing, validation, delta, and candidate-ref contracts do not exist. |

No report contains a clear agent mistake where the packet directly supplied a
needed answer and the agent overlooked it. The reports consistently labeled
their invented details and avoided presenting them as proposed API.

## What v5 successfully taught

The following survived condensation and six independent reconstructions:

1. Installation, configuration, admission, execution, evidence, policy, and
   deployment authority are different states.
2. Claims and alternate support routes exist independently of observations.
3. Planning, gathering, submitting, coordinating work, and closing work are
   separate transitions. Only an accepted observation can support a premise.
4. Conditions retain history and active intervals; policy projection does not
   erase either.
5. Queries are read-only. Commands are authenticated, idempotent, and version
   bound. Indeterminate delivery must be reconciled.
6. Overrides change consumer permission only. They do not change evidence,
   applicability, admission, or the underlying condition.
7. A comparison is hypothetical. It must not create live conditions, work,
   evidence, overrides, or deployment permission.
8. LSP, CLI, MCP, and Devtools are projections of one semantic service rather
   than separate products with separate truth.

This is the main positive result: the difficult boundaries were more
recoverable than the apparently simpler call signatures.

## Cross-workflow gaps

### 1. The shared protocol is asserted but not published

All six agents had to invent some combination of:

- exact query inputs and snapshot bootstrap;
- `SnapshotBound<T>` results and snapshot equality rules;
- page and cursor contracts;
- command request and receipt envelopes;
- stable `OperationError` codes and recovery fields;
- idempotency-key collision and replay behavior;
- capability/grant and authority-boundary records;
- concrete read models for work, evidence, explanations, policy, overrides,
  configuration, admissions, and changes; and
- the MCP operation envelope and CLI spellings.

This is primarily a schema gap in the full v5 model, not just a condensed-packet
gap. The model promises complete versioned schemas but does not define them.

### 2. A diagnostic action is not executable

Workflow 1 could discover the correct `evidence.plan` action, but
`ActionDescriptor` does not identify the service operation, MCP tool/operation,
or universal invocation envelope. `inputSchema` says what data is legal without
saying where the data goes.

Smallest repair: add an invocation binding and one action request envelope:

```ts
interface ActionDescriptor {
  // existing fields
  invoke: {
    serviceOperation: OperationId
    mcp?: { tool: TrustMcpTool; operation: string }
  }
}

interface InvokeActionInput<T> {
  actionId: string
  expectedSnapshot: SnapshotToken
  idempotencyKey: string
  input: T
}
```

### 3. Ready evidence work is not a runnable, fenced plan

Workflow 2 needed a work record containing the condition, claim use, method,
subjects, cases, coverage, expired evidence, and changed/current dependencies.
More importantly, the current work fence is required for work mutations but
not for `runs.plan` or `runs.submit`. A worker that loses its lease can still
appear able to submit evidence for the work.

This is a normative design gap, not merely missing field names. Add a
`RenewalWorkDescriptor`; require the current `{ work, generation }` when
planning; freeze it into the run ticket; reject submission when that generation
is no longer current. Idempotency keys must also be bound to the authenticated
actor and exact payload.

### 4. CI has an exit contract but no artifact contract

Workflow 3 could distinguish allow (`0`), block (`1`), and unable to evaluate
(`2`). It could not produce the requested machine artifact without inventing a
report flag, stream behavior, and atomicity rule.

Smallest repair:

```sh
trust ci --profile ci --report ./trust-report.json
```

The command should pin one evaluation, perform no commands or hidden evidence
runs, atomically write the exact `TrustReport` used to choose exit `0`, `1`, or
`2`, and keep human output separate. A malformed/ambiguous override set,
mid-evaluation incoherence, or inability to construct a valid report must fail
as `2`.

### 5. Required admission data has no read path

Workflow 4 is explicitly required to render admission records, but v5 only
defines `admissions.decide`. Add snapshot-bound `admissions.list` and
`admissions.get` queries with definition/version, status, authority/decision,
supersession/revocation, and time metadata.

The same workflow also exposed the need for an atomic Devtools frame: change
events should invalidate a frame, not be trusted as replacement state. Every
dependent result must echo the exact snapshot. Cursor expiry requires a typed
resync error. Time-derived override expiry must be able to invalidate a display
even when no durable cursor advances.

### 6. Temporary overrides cannot be previewed safely

Workflow 5 needed a read-only preview using the exact same validation and
authority checks as creation. The existing candidate-policy comparison does
not accept a proposed live override and is far too large for this task.

Add a proposed-override variant of `policy.evaluate`. It should return:

- whether the actor could create it;
- exact affected conditions and claim uses;
- overlap, shadowing, and ambiguity classification;
- the hypothetical decision and server-derived deadline; and
- no deployable decision token and no write.

The public contract must also settle whether `action` means the replaced action
or resulting action, reject omitted/broad selectors, define equality at the
expiry boundary, cap decision validity at the earliest applicable override
expiry, and fail closed on contradictory overlap.

### 7. Candidate comparison lacks its transportable object

Workflow 6 understood all four promised deltas but had to invent the complete
`CandidateBundleV1`, serializable lowered definitions, lock records, sealing
algorithm, compare request/result, candidate-only refs, validation errors, and
CLI/MCP transport.

Publish canonical `CandidateBundleV1`, `PolicyCompareInputV1`, and
`PolicyCompareResultV1` schemas plus a deterministic pure
`sealCandidateBundle` helper. Candidate validation errors must not become live
conditions. A sealed candidate is not thereby admitted, and any candidate
decision must be unmistakably non-deployable.

## Classification ledger

### Design gaps

- no action-to-operation invocation binding;
- no admission read operations;
- no proposed-override preview operation;
- no work-lease authority binding on evidence runs;
- no canonical sealed-candidate construction and validation contract;
- no deployment-side decision-token verification contract;
- unclear transient-context supersession and adapter refresh ownership; and
- unclear time-only invalidation when override expiry changes a projection.

### Public-packet gaps

The condensed packet omitted a few facts present in `MODEL.md`: source providers
have `mapAction`, `contexts.put` returns a `ContextRef`, a representative
`RunReceipt` shape exists, retry lookup returns the original receipt, and
invalid configuration can produce a bootstrap report. Restoring those facts
would reduce some invention, but none closes the main executable-contract gaps.

### Schema gaps

- inputs/results for every listed query and command;
- common snapshot-bound, page/cursor, receipt, and error envelopes;
- `Cause`, `Limit`, `AuthorityBoundary`, `DecisionToken`, `OperationError`, and
  durable/candidate ref wire behavior;
- evidence, work, explanation, admission, config, override, policy, capability,
  history, and change read models;
- run plan/ticket/result and method-runner discovery contracts;
- override create/renew/revoke and candidate comparison DTOs; and
- concrete MCP inputs/outputs and CLI machine-output contracts.

### Ergonomic gaps

- agents must guess how an action kind maps onto one of five MCP tools;
- ready work requires several unspecified joins before it can be acted on;
- snapshot bootstrap relies on an invented `current`/`latest` convention;
- overloaded MCP tools have no shown discriminated operation schemas; and
- CLI operation names are said to follow service names without a discoverable
  spelling or help/schema projection.

### Agent mistakes

None identified. Some reports selected conservative answers where v5 is
ambiguous, but they marked those choices as inventions instead of mistaking
them for the design.

### Open implementation details

The external runner command, GitHub Actions/pnpm setup, React store structure,
page size, lease duration, concrete refs in fixtures, local file paths, and
branch/PR conventions are legitimately host-specific. They do not need to enter
the Trust protocol unless a later implementation demonstrates a portability or
safety dependency.

## One-off safety findings to preserve

Repetition is not required for a safety defect. The following appeared in only
one or two sessions and should become conformance cases:

1. An external method result needs a discoverable schema and producer/runtime
   attestation so self-reported semantic labels cannot masquerade as raw
   observations.
2. An LSP action from document version N must never be rebound to N+1 by merely
   replacing its snapshot or refs.
3. Losing a work fence must invalidate authority to plan or submit the run
   associated with that work.
4. A machine report and process exit must derive from the same pinned
   evaluation; a later query cannot be spliced into the artifact.
5. A Devtools frame must reject mixed snapshots and resync after cursor expiry.
6. Client-supplied principal, role, clock, TTL, rationale, or broad selector
   must never create override authority.
7. A preview result is not a deployment token.
8. A sealed candidate is not an admitted candidate, and its decision is not a
   live deployment decision.
9. Candidate validation failures must not create live conditions or work.
10. Invalid or ambiguous override state must produce no valid decision, not
    select the looser action.

## Proposed v5.1 repair sequence

This sequence preserves the v5 ontology and makes the three layers real.

1. **Close the shared protocol.** Define canonical refs, `SnapshotBound<T>`,
   pages/cursors, command envelopes, receipts, errors, capability records, and
   decision tokens with runtime schemas and exported TypeScript types.
2. **Close the six workflow DTOs.** Publish the minimal request/result types for
   status/explanation/actions, renewal work and run tickets, CI reports,
   Devtools reads, proposed overrides, and candidate comparison.
3. **Repair authority-bearing holes.** Bind work fences into runs; add
   proposed-override validation; define decision verification and candidate
   scope/admission rules.
4. **Add the missing read operations.** Admission list/get are required;
   override get/inspect is a smaller consistency improvement.
5. **Specify adapter projections.** Generate MCP schemas, CLI parsing/report
   behavior, LSP data/actions, and Devtools clients from the same operation
   registry rather than documenting them independently.
6. **Turn the six sessions into conformance fixtures.** Each workflow should
   compile against public types, run against a deterministic service fixture,
   assert the full state trace, and contain its hostile/stale/indeterminate
   branch. A future fresh-agent rerun should then measure naming and ceremony,
   not compensate for missing types.

## Decision suggested by the evidence

Keep the v5 architecture. Call the next revision v5.1 and treat it as protocol
and schema closure with three intentional semantic additions:

1. fenced work authorizes its evidence run;
2. proposed overrides have a non-deployable preview; and
3. admissions are queryable.

Everything else can be expressed as completing contracts v5 already claims to
have. Revisiting claims, routes, evidence, conditions, work, policy, or the
three-layer architecture would discard a part of the design all six agents
successfully recovered without addressing the friction they actually met.

## Limits of this test

One agent handled each workflow, so model variance is unmeasured. All six saw
the same author-written condensation, and the evaluator shares the design
context. Requiring concrete code may overemphasize missing field names, while
allowing simulation lets an agent work around a genuinely unusable surface by
inventing it. The test therefore supports a precise claim—v5 communicates its
semantic boundaries better than its executable contracts—not a general claim
that agents will use an implementation correctly.
