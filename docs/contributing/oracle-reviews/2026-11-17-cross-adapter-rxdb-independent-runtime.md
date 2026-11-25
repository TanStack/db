# Independent RxDB receiving review

Reviewer: `runtime_sync`, independent of `parse_oracle_author` and the RxDB
production implementation. Scope is the test-only receipt, shared-provider,
initial-gate and built-in mutation receiving paths. This record supplements the
author's pre-edit inventory; it does not approve a production repair.

Read the oracle-review skill, full rubric and glossary, coverage-map eager owner
and limits, stable Collection lifecycle/optimistic contracts, RxDB public guide,
new receiving drivers and their shared models/checks. The review attacks
enforcement, production-path fidelity and contract formulation. No change to the
accepted local mirroring, lifecycle or optimistic settlement laws is proposed.

## Reconstructed observations

Two Collections wrapping one RxCollection owe its complete keyed table. If one
ends its sync run, cleanup removes that Collection's public rows and subscription
only. The surviving Collection must receive a later real RxDB write. The new
shared-provider model derives this from authored masks and retired ownership;
it copies no RxDB classifier, queue or subscription implementation. Its driver
uses actual memory-storage query results and the real RxDB change Observable.

A built-in mutation's handler Promise decides its transaction outcome. An
accepted source event and handler settlement remain different boundaries. An
event accepted while the handler persists applies when its optimistic state
drops. If source delivery comes later, the old base can be visible in the
settlement waiter and the later event subsequently updates it. Handler rejection
does not undo a durable write that already happened in RxDB. The existing
optimistic-history owner supplies this judgment and attribution rules.

## Findings and repairs

1. **Confirmed ORC-010 receiving handoff loss.** The original receipt and shared
   drivers returned raw observations from inside `withOracleCleanup`. Their
   comparisons ran only after return. If teardown threw after a completed wrong
   observation, the raw mismatch was discarded and only cleanup propagated.
   The author adopted `retainOracleCleanupObservation`, retained each secondary
   diagnostic and added actual remove-then-throw paired controls. Independent
   execution of `tests/receiving-cleanup.test.ts` passed both controls. The
   receipt recorder also stays live through teardown and native event turns
   before copying detached errors. This finding is closed in the repaired
   source inspected here.
2. **Missing mutation source-delivery order.** The initial mutation driver held
   method return until it observed an accepted source receipt. Its inventory
   promised before/after-handler event cuts but its grammar generated only the
   former. The author accepted the finding and is adding real-event forwarding
   holds with both shared optimistic-history projections. Final execution and
   inspection are pending.
3. **Aggregate mutation reach did not bind each receiving path.** Independent
   operation and outcome states did not guarantee a witness for every CRUD ×
   outcome path, or the additional delivery-order paths. The author is adding
   fifteen legal joint constructions with generated rows and peer membership.
   Final measured reach and missing-state controls are pending.
4. **Default-run browser exclusion requires discovery evidence.** A local-store
   package with `test.dir: './tests'` did not honor a `tests/*.browser.test.ts`
   exclusion in actual `vitest list --filesOnly` discovery. Its independent
   `**/*.browser.test.ts` pattern worked. RxDB used the analogous relative
   pattern; the author was asked to verify discovery and correct it if needed.
   This is an executed neighboring configuration witness, not yet an RxDB
   execution claim.

The initial persisted-receipt inventory cell is separately supplied by
`registry_integration`: real RxDB memory SDK options behind the persisted
wrapper, a held baseline read, the adapter's original asynchronous receipt and
cleanup before or after application, on controlled, Node SQLite and actual
Chromium OPFS hosts. The reviewer inspected this exact receipt path. Ordinary
OPFS startup was not substituted for cancellation evidence. Final snapshots,
late teardown error capture and host controls are pending review.

## Independent executions

Native Node `24.19.0`, `--maxWorkers=1`, from
`packages/rxdb-db-collection`:

```sh
node ../../node_modules/vitest/vitest.mjs run tests/initial-receipt-oracle.property.test.ts tests/shared-client-oracle.property.test.ts tests/eager-gate-conformance-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=dot
node ../../node_modules/vitest/vitest.mjs run tests/receiving-cleanup.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=dot
```

The initial three-family execution passed **123** tests. The repaired paired
cleanup execution passed **2** tests. Logs:
`.review-2377/rxdb-independent-runtime-node.log` and
`.review-2377/rxdb-independent-runtime-cleanup.log`. These runs predate the final
mutation additions and do not approve those unexecuted cells.

No production defect was identified in this bounded independent review. The
findings concern missing test histories and failure-report fidelity. Final
approval remains pending the updated authored freeze and receiving evidence.

## Final independent verdict, 2026-11-17

**APPROVED for the bounded RxDB-owned receiving slice.** This supersedes the
pending verdict above. Approval of shared oracle dependencies remains with the
root review and its assigned shared-owner reviewers. No RxDB production change
or product bug-class closure is approved or claimed here.

The final nonpersisted package freeze is
`2026-11-17-rxdb-receiving-final-test-snapshot-v2.json`, SHA-256
`8208df540aa6e462b1cd4fea5d4763f0bd6c93ac322f9935b89e9429a98a9bbe`.
All 34 owned test/configuration hashes and both production hashes match.
The persisted receipt amendment is
`2026-11-17-rxdb-persisted-receipt-final-test-snapshot-v2.json`, SHA-256
`3a3e34a6f281b15c52e19bce841ba2f4f45d245cd77483a5e968bdc74283dfa8`.
Its sole receiving-source change after the runtime freeze adds an explicit
generic type argument; it changes no emitted JavaScript. Owned persisted file
hashes also match. The shared receipt registration subsequently changed under
its separate owner; this package verdict does not credit those later edits.

The independent evidence and correct per-campaign reach counts are versioned in
`2026-11-17-rxdb-independent-runtime-evidence.json`, SHA-256
`4a205aeaa231b9adea1a0897a50a2578961ba2cf2ddd4616d26a230878602ff9`.
That record fingerprints every credited log and the observed shared
dependencies. The reviewed Git head remains
`92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`; the slice is uncommitted.

### Resolved findings

- The mutation grammar now distinguishes source delivery before and after
  handler settlement. The late path holds real SDK events, then forwards them;
  it does not fabricate confirmation. Each schedule projects into the existing
  optimistic-history model and uses its unchanged comparison.
- All 15 legal CRUD × outcome × event-order cells have individual randomized
  constructions. Both campaigns check every construction's required reach,
  including generated construction outputs. Every missing-state calibration
  runs. Each final mutation campaign has 25 constructions plus 60 generated
  histories, recorded in 26 reach rows. All 25 states reach at least twice in
  each fixed campaign; minima in the independent random campaigns are three
  for Node and two for Chromium.
- Actual Node discovery includes the new Node receivers and excludes every
  `*-oracle.browser.test.ts` file. The dedicated configuration runs them in
  actual Chromium. The discovery log is independently retained.
- A further mutation ORC-010 defect was found during final review: cleanup
  could throw before returning completed product cuts. Cleanup now runs in the
  protected envelope, and the shared cleanup observation is appended after
  those attempts. A real update plus wrong settlement rows and an actual
  cleanup-then-throw control preserves the primary `rows` violation at
  `step 2 (settle)`.
- The receiving mutation check originally retained secondary diagnostics only
  in its raw result. The rendered primary verdict now includes separately
  labeled cleanup/host diagnostics while retaining its exact law, checkpoint
  and row diff. The paired control invokes that same receiving check and
  verifies its rendered diagnostics.
- Final snapshot reach parsing initially omitted lines prefixed by Vitest's
  reporter dots. The author preserved that artifact and supplied the v2
  evidence amendment. Independent parsing includes every reach row once;
  generated reach and construction reach are not conflated with test counts.

### Executed final evidence

All independent runs used Node 24.19.0 and `--maxWorkers=1`:

| Independent execution | Result | Log under `.review-2377/` |
| --- | --- | --- |
| Six new Node files before the final mutation-only repair | 294 passed; its 107 mutation and three ordinary controls are superseded below | `rxdb-independent-final-node.log` |
| Final mutation receiver and four ordinary harness controls | 111 passed | `rxdb-independent-final-mutation-verdict-node.log` |
| Four nonmutation Chromium receivers, including actual worker/OPFS receipt | 152 passed | `rxdb-independent-final-chromium.log` |
| Final mutation receiver in actual Chromium | 107 passed | `rxdb-independent-final-mutation-verdict-chromium.log` |
| Actual worker/OPFS native recorder fault and clean neighbor | Clean trace accepted; delayed post-source-disposal rejection rejected as `detachedErrors` | `rxdb-independent-persisted-recorder-calibration.log` |
| Normal Node discovery | Browser files absent, Node receivers present | `rxdb-independent-final-node-discovery.log` |

There are **295 distinct passing final Node tests and 259 passing Chromium
tests** in this added slice. Repeated intermediate runs are not added to those
totals. The receipt Node run includes both actual controlled-persistence and
Node SQLite receiving paths, their four post-record worker-failure controls,
and the shared wrong-observation calibrations. The OPFS run supplies the same
deferred-receipt abandonment/application premise through the real worker host.
The native recorder remains active through source disposal, storage close and
OPFS artifact cleanup, then eight native task turns precede its final copy.

The author additionally reran the unchanged 47 gate tests in both Node and
Chromium after the shared dependency edits and checked final package types and
scoped ESLint. Those are authored executions, distinct from this reviewer's
runs above. Direct guarded replay logs for each new family show one executed
comparison; the final mutation replay was repeated after the diagnostic repair.

### Numbered outcomes and limits

| Requirement | Independent conclusion |
| --- | --- |
| ORC-001/002/003 | The local mirroring, cleanup, initial-gate and optimistic laws trace to public docs, glossary and shared owners. Models, grammar, drivers and cuts remain distinguishable. No production classifier computes expected rows. |
| ORC-004 | Authored masks, join timing, retirement, pagination, CRUD/outcome/order and peer axes have reconstruction/ablation/bounds/exclusion evidence. Before-write refusal correctly has no source-event variant. |
| ORC-005/006 | Actual memory-storage reads/events, built-in handler calls, receipt observations and resource counters reach the named cuts. Bound wrong-row/error/reach controls reject at their intended comparisons; fixture setup failures are not credited as kills. |
| ORC-007 | Fixed and unseeded campaigns retain identical budgets and judgments. Reviewed guarded replay logs have positive one-execution witnesses. No command grammar requires a commands replay path. |
| ORC-008/009 | Existing lifecycle/optimistic models remain unchanged. New shared-table judgment recomputes authored membership. Numeric model keys map explicitly to RxDB string keys, and source delivery remains distinct from handler settlement. |
| ORC-010 | Raw retention, final rendered diagnostics and actual paired/late teardown controls close the identified failure-fidelity gaps. |
| ORC-011 | No concrete remaining shared semantic fault requiring another formulation was identified. Recorder suppression was challenged with actual native faults, rather than a second copied lifecycle model. |
| ORC-012/013/014 | Exact freezes, independent logs, neighboring schedules and the real Node/Chromium receiving premises bound the verdict. No production repair or universal closure claim is made. |
| ORC-015 | Required reach is enforced in each receiving campaign; every construction's missing-state control rejects. Correctly parsed counts are versioned. |
| ORC-016 | Oracle files retain shared laws/campaigns/calibrations; ordinary concrete harness controls remain outside oracle files. |

The mutation evidence covers one actual RxDB memory-storage request, an optional
untouched peer, three CRUD handlers, success or failure around a real write,
and both source-event delivery orders. It does not establish the composition
of these mutation histories with TanStack persistence wrappers, concurrent CRUD,
remote replication, every RxDB storage engine, concurrent tabs, field deletion
or actual schema-validation refusal. Existing `rxdb.test.ts` independently has
actual AJV extra-property refusal and valid-neighbor examples; the injected
before-write error here is not credited as that provider premise. Persisted
receipt evidence covers wrapper-deferred abandonment or application, not an
accepted receipt held after admission or source-handler catch-deletion closure.
These limits preserve the other primary owners' obligations.
