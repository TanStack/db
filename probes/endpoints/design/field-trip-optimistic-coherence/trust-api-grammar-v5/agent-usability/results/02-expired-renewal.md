# Workflow 2 simulation — scheduled expired-evidence renewal

This is a bounded usability simulation against the condensed v5 packet. All
identifiers, payload values, response envelopes, and error codes below are
illustrative where the packet does not define them.

## 1. Assumptions

- The maintenance process already has an authenticated actor session allowed to
  list and claim maintenance work and to plan and submit `effectOracle` runs.
- The installed Endpoints configuration has the
  `endpoints/safe-skip-refetch` rule enabled, and this environment's `ci`
  profile blocks the selected expired-observation condition until it clears.
- The fixture has three ready renewal work items over two pages. The selected
  item, `work:w17`, concerns one endpoint mutation and an old observation whose
  recorded endpoint-schema dependency changed.
- `work:w17` requires 24 enumerated oracle cases. A complete replacement batch
  is adequate and applicable and therefore clears its sole
  `observation.expired` condition.
- The external effect-oracle program can gather eight cases per worker. Its
  first attempt completes 17 of 24 cases before one worker fails.
- A successful rerun updates one tracked baseline file,
  `packages/db-endpoints/generated/trust/billing-update.effect-oracle.json`.
- For the simulation, ready-work pages contain two items, external gather
  batches contain eight cases, a work lease lasts 15 minutes, and it is renewed
  with less than five minutes remaining.

## 2. Code and calls

### Job outline in TypeScript

The exact input and result types are absent from the packet. This code uses the
invented shapes catalogued in section 6 while keeping all operation names to
the packet's public operations.

```ts
async function renewOneExpiredObservation(trust: TrustService) {
  // Obtain a concrete snapshot before paging. This is a read only operation.
  const initial = await trust.query.policy.evaluate({
    profile: 'ci',
    snapshot: 'latest',
  })
  const s0 = initial.report.snapshot

  const ready: RenewalWork[] = []
  let after: string | null = null
  do {
    const page = await trust.query.work.ready({
      snapshot: s0,
      filter: {
        namespace: 'endpoints',
        conditionKind: 'observation.expired',
        purpose: 'renewal',
      },
      page: { limit: 2, after },
    })
    ready.push(...page.items)
    after = page.nextCursor
  } while (after !== null)

  const item = ready.sort((a, b) => a.work.localeCompare(b.work))[0]
  const claimRequest = {
    work: item.work,
    idempotencyKey: `daily-2026-09-17:${item.work}:claim`,
    expectedSnapshot: s0,
    leaseSeconds: 900,
  }
  const claimed = await trust.command.work.claim(claimRequest)
  if (claimed.status !== 'committed') return handleNonCommit(claimed)

  let snapshot = claimed.snapshot
  let fence = claimed.output.fencingToken

  const planned = await trust.command.runs.plan({
    idempotencyKey: `daily-2026-09-17:${item.work}:plan:1`,
    expectedSnapshot: snapshot,
    method: item.method,
    intendedSubjects: item.subjects,
    intendedCases: item.cases,
    coverage: item.coverage,
    expectedCardinality: item.cases.length,
    dependencies: item.currentDependencies,
  })
  if (planned.status !== 'committed') return handleNonCommit(planned)
  snapshot = planned.snapshot

  // External execution produces a candidate result, not Trust evidence.
  let gathered = await runExternalOracle(planned.output.runTicket, item.cases, 8)
  if (!gathered.complete) {
    const renewed = await trust.command.work.renew({
      work: item.work,
      fencingToken: fence,
      idempotencyKey: `daily-2026-09-17:${item.work}:renew:1`,
      expectedSnapshot: snapshot,
      leaseSeconds: 900,
    })
    if (renewed.status !== 'committed') return abandonLocalResults(renewed)
    snapshot = renewed.snapshot
    fence = renewed.output.fencingToken
    gathered = await rerunMissingCases(gathered, 8)
  }
  if (!gathered.complete) return leaveClaimForRetryOrRelease()

  const submitRequest = {
    runTicket: planned.output.runTicket,
    resultBatch: gathered.resultBatch,
    idempotencyKey: `daily-2026-09-17:${item.work}:submit:1`,
    expectedRunVersion: planned.output.runVersion,
  }

  // The first response is indeterminate. Retrying this exact request with the
  // same key must not create another observation or run.
  let submitted = await trust.command.runs.submit(submitRequest)
  if (submitted.status === 'indeterminate') {
    submitted = await trust.command.runs.submit(submitRequest)
  }
  if (submitted.status === 'indeterminate') {
    submitted = await trust.command.operations.reconcile({
      operation: submitted.operation,
      idempotencyKey: `daily-2026-09-17:${item.work}:reconcile:1`,
      expectedOperationVersion: submitted.operationVersion,
    })
  }
  if (submitted.status !== 'committed') return handleNonCommit(submitted)
  snapshot = submitted.snapshot

  const closed = await trust.command.work.close({
    work: item.work,
    fencingToken: fence,
    idempotencyKey: `daily-2026-09-17:${item.work}:close:1`,
    expectedSnapshot: snapshot,
    outcome: 'renewed',
  })
  if (closed.status !== 'committed') return handleNonCommit(closed)

  // close.output.condition is the primary answer. These reads cross-check the
  // replacement observation and absence of the condition at that same snapshot.
  const [evidence, active, policy] = await Promise.all([
    trust.query.evidence.get({
      evidence: submitted.output.evidence,
      snapshot: closed.snapshot,
    }),
    trust.query.conditions.active({
      snapshot: closed.snapshot,
      conditions: [item.condition],
    }),
    trust.query.policy.evaluate({ profile: 'ci', snapshot: closed.snapshot }),
  ])

  return { item, closed, evidence, active, policy, gathered }
}
```

The job deliberately does not call `work.note` with “oracle passed,” does not
close the work before submission, and does not treat a zero exit status from
the external program as an observation.

### Concrete MCP interaction

The initial status and both ready-work pages are read against one snapshot:

```ts
trust_status({
  schemaVersion: 1,
  profile: 'ci',
})
// => TrustReport with snapshot S0 and active condition cond:c44

trust_work({
  schemaVersion: 1,
  operation: 'list',
  input: {
    state: 'ready',
    filter: {
      namespace: 'endpoints',
      conditionKind: 'observation.expired',
      purpose: 'renewal',
    },
    snapshot: S0,
    page: { limit: 2, cursor: null },
  },
})
// => { snapshot: S0, items: [work:w17, work:w22], nextCursor: 'ready:2' }

trust_work({
  schemaVersion: 1,
  operation: 'list',
  input: {
    state: 'ready',
    filter: {
      namespace: 'endpoints',
      conditionKind: 'observation.expired',
      purpose: 'renewal',
    },
    snapshot: S0,
    page: { limit: 2, cursor: 'ready:2' },
  },
})
// => { snapshot: S0, items: [work:w31], nextCursor: null }
```

The selected illustrative descriptor is:

```ts
{
  work: 'work:w17',
  workVersion: 'work-version:3',
  condition: 'condition:c44',
  claimUse: 'claim-use:billing-update',
  rule: 'rule:endpoints/safe-skip-refetch@1',
  method: 'method:endpoints/safe-skip-refetch/effectOracle',
  subjects: ['endpoint-mutation:billing.update'],
  cases: ['case:01', 'case:02', /* ... */ 'case:24'],
  coverage: 'enumerated-cases',
  expiredEvidence: 'evidence:e12',
  changedDependencies: [
    { dependency: 'endpoint-schema:billing.update', from: 'sha256:aaa', to: 'sha256:bbb' },
  ],
  currentDependencies: [
    { dependency: 'endpoint-schema:billing.update', version: 'sha256:bbb' },
  ],
}
```

Claiming and planning use distinct commands:

```ts
trust_work({
  schemaVersion: 1,
  operation: 'claim',
  input: {
    work: 'work:w17',
    idempotencyKey: 'daily-2026-09-17:work:w17:claim',
    expectedSnapshot: S0,
    leaseSeconds: 900,
  },
})
// => committed at S1 with fencingToken { work: 'work:w17', generation: 7 }

trust_evidence({
  schemaVersion: 1,
  operation: 'plan',
  input: {
    idempotencyKey: 'daily-2026-09-17:work:w17:plan:1',
    expectedSnapshot: S1,
    method: 'method:endpoints/safe-skip-refetch/effectOracle',
    intendedSubjects: ['endpoint-mutation:billing.update'],
    intendedCases: ['case:01', 'case:02', /* ... */ 'case:24'],
    coverage: 'enumerated-cases',
    expectedCardinality: 24,
    dependencies: [
      { dependency: 'endpoint-schema:billing.update', version: 'sha256:bbb' },
    ],
  },
})
// => committed at S2 with runTicket run-ticket:r9 and runVersion run-version:1
```

The external program is outside the Trust service. Its first invocation has a
partial operational failure:

```sh
endpoint-effect-oracle gather \
  --run-ticket run-ticket-r9.json \
  --cases cases-01-through-24.json \
  --batch-size 8 \
  --output .trust-tmp/run-r9
# worker 3 times out; only 17 of 24 case results are present
```

No `runs.submit` call is made with those 17 results, so S2 still has only the
expired observation. Before retrying the missing cases, the lease is renewed:

```ts
trust_work({
  schemaVersion: 1,
  operation: 'renew',
  input: {
    work: 'work:w17',
    fencingToken: { work: 'work:w17', generation: 7 },
    idempotencyKey: 'daily-2026-09-17:work:w17:renew:1',
    expectedSnapshot: S2,
    leaseSeconds: 900,
  },
})
// => committed at S3 with fencingToken { work: 'work:w17', generation: 8 }
```

If the pre-renewal process later tries to mutate the work, its stale fence does
not work:

```ts
trust_work({
  schemaVersion: 1,
  operation: 'release',
  input: {
    work: 'work:w17',
    fencingToken: { work: 'work:w17', generation: 7 },
    idempotencyKey: 'stale-worker:work:w17:release',
    expectedSnapshot: S3,
  },
})
// => rejected, error.code = 'work.fence_mismatch'; S3 is unchanged
```

The live process gathers the missing seven cases, assembles all 24 results, and
submits once. The result shape is illustrative author-method data:

```ts
const submit = {
  schemaVersion: 1,
  operation: 'submit',
  input: {
    runTicket: 'run-ticket:r9',
    expectedRunVersion: 'run-version:1',
    idempotencyKey: 'daily-2026-09-17:work:w17:submit:1',
    resultBatch: {
      methodResultSchemaVersion: 1,
      dependencyVersions: {
        'endpoint-schema:billing.update': 'sha256:bbb',
      },
      cases: [
        { case: 'case:01', outcome: 'supported', artifactDigest: 'sha256:001' },
        // ...exactly one result for every committed case through case:24...
      ],
    },
  },
} as const

trust_evidence(submit)
// => indeterminate, operation operation:submit-77 (response path failed)

trust_evidence(submit)
// => committed original operation:submit-77 at S4; evidence evidence:e13
```

The retry sends the identical key and payload. It confirms the original commit;
it does not run validation again as a second logical submission and does not
create `evidence:e14`. If the retry remained indeterminate, the job would call
`trust_evidence({ operation: 'reconcile', ... })` with the returned operation
reference rather than minting a new submit key.

Finally the current fence closes the coordination item and receives the fresh
condition result:

```ts
trust_work({
  schemaVersion: 1,
  operation: 'close',
  input: {
    work: 'work:w17',
    fencingToken: { work: 'work:w17', generation: 8 },
    idempotencyKey: 'daily-2026-09-17:work:w17:close:1',
    expectedSnapshot: S4,
    outcome: 'renewed',
  },
})
// => committed at S5; output.condition = {
//      condition: 'condition:c44', active: false, kind: 'observation.expired'
//    }

trust_policy({
  schemaVersion: 1,
  operation: 'evaluate',
  input: { profile: 'ci', snapshot: S5 },
})
// => valid decision token D1, action 'allow' in this fixture
```

### CLI and external PR boundary

After Trust has accepted the result, repository inspection is a separate local
workflow:

```sh
git status --porcelain=v1
git diff -- packages/db-endpoints/generated/trust/billing-update.effect-oracle.json
git switch -c trust/renew-billing-update-evidence
git add packages/db-endpoints/generated/trust/billing-update.effect-oracle.json
git commit -m "chore(endpoints): renew billing update oracle baseline"
gh pr create --draft \
  --title "chore(endpoints): renew billing update oracle baseline" \
  --body-file /tmp/trust-renewal-pr.md
```

The PR body can cite `work:w17`, `run-ticket:r9`, `evidence:e13`, and snapshot
S5 for traceability. The edit, commit, push, PR, reviews, and successful Git or
GitHub commands do not become Trust evidence. If `git status --porcelain=v1`
were empty, the job would skip the branch and PR steps.

`trust ci --profile ci` may then be run as a consumer check. It reads/evaluates
current Trust state and, for this fixture, exits 0; it does not gather hidden
replacement evidence.

## 3. State trace

| Step | Snapshot | Condition | Evidence | Work / lease | Policy |
|---|---|---|---|---|---|
| Initial `trust_status` | S0 | `condition:c44` is active as `observation.expired`; its occurrence and active interval already exist | `evidence:e12` remains retained but expired after dependency `sha256:aaa` changed to `sha256:bbb` | `work:w17` is ready | Initial decision D0 blocks under the assumed `ci` profile and is bound to S0 |
| Page ready work twice | S0 | Unchanged | Unchanged | Same stable three-item ready set is observed over two S0-bound pages | D0 remains the only decision; queries have no side effects |
| Claim `work:w17` | S1 | Still active | Unchanged | Ready → claimed, generation 7, lease expiry recorded | D0 is not a decision for S1; no new evaluation occurs automatically |
| Plan run | S2 | Still active | No observation is added | Work stays claimed; planned run `r9` freezes method, 24 cases, coverage, dependency version, and expected cardinality | No policy fact changes; a new evaluation would still block |
| External gather partially fails | S2 | Still active; no Trust `operation.failed` condition is created for an unreported external worker failure | Seventeen local candidate results are not observations | Generation 7 remains held while time passes | Unchanged |
| Renew lease | S3 | Still active | Unchanged | Generation 7 → generation 8; an old holder's mutation with generation 7 is rejected and causes no state change | No new evaluation |
| Complete external retry | S3 | Still active | All 24 results exist only in local staging | Generation 8 remains held | Unchanged |
| Submit response is indeterminate | Server may already be at S4; caller only knows S3 until resolution | Caller must not assume clear | Caller must not assume an observation exists | Work remains logically claimed | No deployable conclusion can be drawn from the indeterminate receipt |
| Retry the identical submit request | S4 confirmed | `condition:c44`'s active interval ends because the replacement is adequate and applicable | `evidence:e13` is current; `evidence:e12` and its expiry history remain queryable; no duplicate observation is created | Work remains claimed until explicitly closed | D0 remains bound to S0 and cannot authorize S4 |
| Close with generation 8 | S5 | Close returns the freshly computed inactive state; history is retained | No evidence changes as a result of close | Claimed → closed | Still not evaluated automatically |
| Evaluate `ci` policy | S5 | Inactive condition remains visible in history, absent from active query | Unchanged | Closed | D1 is bound to S5 and allows in this fixture, subject to its validity deadline |
| Create draft PR | S5 | Unchanged | Unchanged | Unchanged | PR state has no effect on D1 or Trust state |

If the final complete batch were inadequate, inapplicable, invalid, or failed,
the close result would not be assumed inactive. The agent would report the
returned active condition and would not infer success from the work being
closed.

## 4. Clear parts

- The split between ready-work discovery, claim/renew/close coordination, run
  planning, result submission, and policy evaluation is easy to recover.
- The requirement to plan before external submission gives the replacement a
  committed method, subjects, cases, coverage, dependencies, and cardinality.
- An incomplete or failed run adding no observation makes the correct behavior
  after the 17-of-24 partial result clear: do not convert partial work into
  evidence.
- Fenced lease generations make the stale-process scenario conceptually clear,
  and the current token requirement is stated for every later work mutation.
- The committed/rejected/indeterminate split plus idempotency and reconciliation
  gives the agent a safe posture after losing a response: never improvise a new
  operation while the old one may have committed.
- `work.close` returning fresh condition state and being unable to alter
  evidence is a useful, explicit boundary.
- Snapshot-bound decisions and validity deadlines prevent reuse of the initial
  policy decision after evidence or work state changes.
- The packet is unequivocal that the repository edit and PR workflow cannot
  stand in for evidence.

## 5. Friction

- There is no input or output schema for `work.ready`: a fresh agent cannot know
  the pagination fields, stable ordering, renewal filter, or whether a cursor
  is bound to the first page's snapshot.
- No work-item schema connects an expired condition to the `MethodRef`, intended
  subjects/cases, coverage, changed dependencies, current dependency versions,
  old evidence, or an action descriptor. The job cannot construct `runs.plan`
  without inventing that bridge or making several unspecified reads.
- Claim duration, expiry behavior, whether renew rotates the generation, and
  the exact stale-fence error are unspecified. “Require the current fencing
  token” supplies the invariant but not enough recovery behavior for a daemon.
- The packet says commands are idempotent but does not define what happens when
  the same key is reused with a different payload, how long keys are retained,
  or whether a retry returns the original receipt verbatim.
- Indeterminate receipts and `operations.reconcile` lack a shared concrete
  shape. A client cannot know which reference/version to persist or how to
  distinguish “still pending” from “terminal failure.”
- The relationship between a work lease and evidence commands is not stated.
  A fenced token is required by later work commands, but it is unclear whether
  a stale worker can still plan or submit a run for the same renewal.
- It is unclear whether accepted replacement evidence automatically makes the
  claimed work no longer ready, whether close is still legal after that state
  change, and whether close should use a global snapshot or a narrower work
  version.
- The author-defined `effectOracleResultSchema` is intentionally opaque in the
  packet, so a concrete external result batch necessarily invents its inner
  fields.
- There is no first-class PR handoff or artifact-change declaration. That is a
  defensible product boundary, but the maintenance agent must supply all branch,
  staging, and PR conventions from its surrounding repository workflow.

## 6. Invented API ledger

“Essential” means the simulation could not issue a safe concrete call without
the invention. “Convenient” means it only makes the example deterministic or
readable. Public operation names in the packet were not reinvented.

| Invented element | Need | Why it was invented |
|---|---|---|
| MCP request envelope fields `schemaVersion`, `operation`, and `input`, and the literal operation values such as `list` and `plan` | Essential | The tools and their covered operations are named, but their complete versioned wire schemas are not shown. |
| `trust_status({ profile })` returning the current report/snapshot | Essential | `trust_status` is named, but its input and result contract are absent. |
| `policy.evaluate({ profile, snapshot: 'latest' })` and the `'latest'` sentinel | Essential | The query is named but there is no documented bootstrap mechanism for acquiring the first exact snapshot. |
| Work-list fields `state`, `filter.namespace`, `filter.conditionKind`, `filter.purpose`, `snapshot`, and `page.{limit,cursor}` | Essential | No `work.ready`/MCP-list input schema is supplied. |
| The `purpose: 'renewal'` value and one-ready-item-per-expired-condition selection model | Essential | The workflow promises ready renewal work but does not define how it is represented or selected. |
| `RenewalWork` and its fields `work`, `workVersion`, `condition`, `claimUse`, `rule`, `method`, `subjects`, `cases`, `coverage`, `expiredEvidence`, `changedDependencies`, and `currentDependencies` | Essential | No work-item read model connects ready work to a plannable evidence run. |
| Ready-page fields `items` and `nextCursor`; `null` as both first/last cursor; stable ordering; cursor-to-snapshot binding; rejection of cross-snapshot cursors | Essential | Snapshot binding is stated generally, but page mechanics and cursor rules are not. |
| A two-item page and lexicographic `WorkRef` selection | Convenient | These merely make the no-specific-endpoint job deterministic in the fixture. |
| String spellings such as `work:w17`, `condition:c44`, S0–S5, and all sample hashes, versions, dates, and refs | Convenient | Refs are opaque and no fixture data is provided. |
| Receipt fields `status`, `snapshot`, `operation`, `operationVersion`, `output`, and `error` | Essential | Receipt variants are stated, but their common discriminant and payload shape are not. |
| Idempotent retry returns the original logical receipt; a key is bound to its exact payload; a changed payload under the same key is rejected | Essential | Idempotency is required, but collision and replay semantics are not described. |
| `claim`/`renew` field `leaseSeconds` and output `fencingToken.{work,generation}` | Essential | A fenced generation is promised, but lease-duration input and token shape are absent. |
| Fifteen-minute TTL, five-minute renewal threshold, and renew rotating generation 7 to 8 | Convenient | No timing or rotation policy is specified; replacing the local token with every renew response is the conservative client behavior. |
| Exact errors `work.fence_mismatch`, `snapshot.stale`, `evidence.batch_incomplete`, `run.ticket_mismatch`, and `idempotency.payload_mismatch` | Essential | The rejection situations are needed for client branching, but no error code catalog is given. Only the first is exercised in the trace. |
| Claim, plan, renew, submit, and close each advancing the global snapshot; rejected commands and queries leaving it unchanged | Essential | Snapshot/version binding is explicit, but the exact mutation-to-snapshot transition rule is not. |
| `runs.plan` field spellings `method`, `intendedSubjects`, `intendedCases`, `coverage`, `expectedCardinality`, and `dependencies` | Essential | The committed concepts are listed, not their input schema. |
| Plan output fields `runTicket` and `runVersion` | Essential | A run ticket exists, but its receipt field and narrower expected version are not defined. |
| External `endpoint-effect-oracle gather` command, all of its flags/files, batches of eight, and local rerun/merge protocol | Convenient | Trust does not define the external evidence producer. They make partial failure concrete without claiming it is Trust API. |
| `resultBatch`, `methodResultSchemaVersion`, `dependencyVersions`, and case fields `case`, `outcome`, and `artifactDigest` | Essential | The rule's result schema is referenced but not included; a submit example needs an illustrative conforming payload. |
| Local completeness check before submit and exact-one-result-per-committed-case rule | Essential | Atomic complete-batch validation is stated, but duplicate/missing case validation details are not. |
| Submit input field `expectedRunVersion` as the permitted narrower version | Essential | Commands require an expected snapshot or narrower version, but the submit schema is absent. |
| An indeterminate submit retry becoming a committed receipt without a duplicate observation | Essential | The safe intention follows idempotency, but the replay result and duplicate-suppression transition are not specified. |
| Reconcile fields `operation`, `expectedOperationVersion`, and its own `idempotencyKey`; terminal reconcile returning a normal command receipt | Essential | The operation is named with no input/output schema. The fallback is shown but not exercised. |
| External worker failure creates no `operation.failed` condition unless Trust itself records a failed operation | Essential | The packet does not state how out-of-band failures map to conditions; this avoids fabricating Trust state from an unreported local event. |
| Accepted replacement `evidence:e13` supersedes the old observation for current adequacy while retaining `evidence:e12`; its acceptance ends `condition:c44`'s active interval | Essential | General evidence/history behavior is described, but the exact renewal transition is not. |
| Work remains claimed after evidence acceptance and transitions to `closed` only through `work.close` | Essential | The packet does not define automatic work state transitions after evidence changes. |
| Close field `outcome: 'renewed'` and returned condition fields `condition`, `active`, and `kind` | Essential | The fresh-condition guarantee is stated without a close input/output schema. |
| Policy-evaluation input fields `profile` and `snapshot`, plus result shorthand `action: 'allow'` | Essential | The operation and report/decision concepts exist, but the query input and decision-token schema are not shown. |
| Initial `ci` block and final allow | Convenient | This is fixture policy behavior, not a universal consequence of expiry or renewal. |
| Every new snapshot invalidates an older decision token, even when only work/lease metadata changed | Essential | Tokens are snapshot-bound, but whether policy ignores non-policy-relevant snapshot changes is not explained; strict invalidation is the safe choice. |
| Artifact path, branch name, commit message, temporary PR-body path, draft status, and Git/GitHub commands | Convenient | Trust intentionally does not define repository or PR workflow. |
| Authenticated actor omitted from every input and supplied by the MCP/transport session | Essential | The packet says the transport supplies it but does not define the authority failure or session representation. |

One consequential behavior was deliberately **not** invented: the report does
not assert that `runs.plan` or `runs.submit` checks the current work fence. The
packet only requires that fence for renew/note/release/close, so treating the
lease as evidence-command authority would overstate the design.

## 7. Safety check

- The partial 17-case output stays local. Submitting it, writing a work note, or
  reporting that the external command succeeded would not make it evidence.
- Only a complete result tied to the committed run ticket is submitted. An
  indeterminate response is resolved with the same key or reconciliation; a
  second key is not used while the first operation may have committed.
- Claiming or closing `work:w17` does not establish any premise. Close is used
  to read the recomputed condition, not to force it clear.
- Generation 7 cannot release, note, renew, or close after generation 8 exists.
  Local results from a process that loses the lease are quarantined rather than
  asserted as owned work.
- The accepted edit, commit, PR, reviewer agreement, and green external command
  remain outside the evidence store. Their refs may appear in explanatory
  metadata only; they cannot support a premise by themselves.
- The initial D0 token is not reused after S0. The final outcome comes from a
  new evaluation at S5; no override is created, and policy never changes the
  evidence or hides the historical condition.
- The largest unresolved safety gap is lease-to-run authority. A process with a
  stale work fence appears barred from work mutations, but the packet does not
  say it is barred from planning or submitting evidence for that work. Run
  tickets and expected versions reduce accidental duplication, but they do not
  prove that the current lease holder authorized the run.
- A second gap is unspecified idempotency-key collision behavior. Safety
  requires a key to be durably bound to one authenticated actor and exact
  payload; otherwise a same-key/different-payload retry could be mistaken for a
  replay.

## 8. Smallest repair

Add one normative `RenewalWorkDescriptor` wire schema returned by
`work.ready`. It should contain the condition/claim-use/method/subject/case/
coverage/dependency inputs needed by `runs.plan`, plus an `expectedWorkVersion`.
On claim, the service should add the current fenced lease to that descriptor;
`runs.plan` should require it and freeze `{ work, generation }` into the run
ticket, and `runs.submit` should reject a ticket whose generation is no longer
current.

That single descriptor-and-binding contract removes the most consequential
guess: how a discovered renewal becomes the right, currently authorized
evidence run. It also prevents a stale worker from using evidence commands
after fenced work ownership has moved, without changing claims, evidence,
policy, or the external PR boundary.
