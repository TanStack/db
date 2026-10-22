# DbClient migration feedback evaluation

Evaluation date: 2026-10-22. Source artifact: `Feedback.txt`, identified by its
SHA-256 under [Content identifiers](#content-identifiers).
The report describes db 0.15.1, react-db 0.5.11, electric-db-collection 0.6.2,
react-router-with-db 0.1.0, and Start 1.169, without a reviewed commit or an
application fixture. This evaluation uses fresh `origin/main`
`205ab7158d81680c3cc4f06cd9ebe62b30911a5a`, in the isolated
`codex/evaluate-dbclient-feedback` worktree. Current package versions are db
0.15.2, react-db 0.5.12, and electric-db-collection 0.6.3.

The review found two reproducible correctness failures. A newly admitted ordinary
subscriber must be able to start a source left deferred by an abandoned render;
that defect is repaired here. A plain SSR hook can render a warm source's rows
that are absent from result-only transport; actual React hydration then recovers.
That defect remains unfixed, with a product decision needed about the initial
snapshot policy. A green scoped test run does not close it.

Production changes add one executable call and an ordering comment. The React
oracle, shared lifecycle judgment, three core test drivers,
SSR guidance, and coverage map also change. At the initial evaluation closeout,
the changes were uncommitted and unpushed; only the helper's initial branch was
published. The user subsequently approved PR preparation after both review
findings were repaired. No external review response was sent.

Source weight: production +2/-0, including the comment; oracle and ordinary
test files +332/-46. Documentation is separate. The production call repairs
the existing admission path without adding state or replacing its control flow.

PR preparation also measured shipped bytes with
`pnpm size:compare --packages db,react-db --files` against the stated merge-base.
The final db production bundle grows by 8 gzip bytes and 116 brotli bytes. Its changed
module grows by 24 minified bytes before compression. The react-db bundle is
unchanged. A simplifier review found no safe consolidation: moving release into
the shared start helper or resumed-acquisition path broadens its authority.
The earlier experiment releasing from resumeSubscriber broke synchronous-error
and peer-release laws. The measured growth pays for the separate independent
demand boundary without a new state or branch.

## Laws, experiments, and remaining enforcement

### Hydration must begin from the server's observable snapshot — F02

Authority: the [SSR guide](../../guides/ssr.md) promises query-result transport
and hydration before hooks render. React requires the initial hydration output
to agree with server markup. The review exposes a missing transport boundary,
not an obligation to choose one particular capture implementation.

The existing [React descriptor owner](../../../packages/react-db/tests/descriptor-query-binding-oracle.test.tsx)
checks request isolation, descriptor binding, transported results, source claims,
and handoff. Its green histories either register the observed query or supply
the corresponding normalized source data. They do not establish the behavior
of a second, unregistered plain query over a source loaded by another query.
This is an absent history dimension, not a wrong per-client reference map.

The diagnostic history uses one descriptor and two projections. Preload the
first projection into the server client; it synchronously publishes
`{ id: 'one', value: 'server' }`. Render a plain hook for the second projection,
dehydrate the server client, hydrate a fresh browser client, and compare the
initial server snapshots. Then run real `hydrateRoot` in jsdom with an
`onRecoverableError` recorder. Explicitly preloading the second projection is
the distinguishing control. The expected relation is markup equality and zero
hydration recoveries, independent of the query evaluator.

| History | Server markup | Initial browser snapshot | React recoveries |
| --- | --- | --- | --- |
| Second query unregistered | `<span>server</span>` | `<span></span>` | 1; assertion RED |
| Second query explicitly preloaded | `<span>server</span>` | `<span>server</span>` | 0; GREEN |

The source facts exist on the server at render time. The transport lacks the
second query's result and the source rows; waiting until browser commit cannot
repair that earlier observation. The real React receiving witness confirms the
reported host failure with a controlled source. It does not establish the
reporter's Start/router/Electric deployment.

The unresolved choice is whether plain SSR hooks automatically capture their
observable synchronous result for transport, or initially render empty/loading
unless a result or normalized source snapshot was explicitly supplied. The
former needs capture and transport semantics; the latter changes observable
server behavior. Merely refusing new source starts does not solve reads from an
already warm source. Capturing only rows from eager source Collections with
status `ready` fixes one trace. It misses partial nonready rows and status flags.
Suppressing all unregistered rows would conflict with documented reuse of
explicitly normalized sources.

The failing diagnostic and passing control are preserved in task scratch as
`dbclient-hydration-feedback.probe.test.tsx` and `react-hydration-red.log`.
They are not installed as a passing oracle or hidden behind an expected-failure
gate. The permanent owner remains the React descriptor owner, as recorded in
the [coverage map](../oracle-coverage.md). After the product decision, extend its
model and histories for ready/partial/nonready sources, full rendered status,
normalized-source transport, and mixed plain/Suspense/preload schedules; reject
the original behavior and a ready-only capture mutant at the hydration cut.
Actual Start/Electric delivery is a separate receiving witness. F02 is
`design-decision`, with the correctness failure still confirmed and open.

### Independent subscription demand outlives an abandoned render — F03

Authority: public ordinary `Collection.subscribeChanges()` starts sync when
needed; `deferAcquisition` explicitly withholds that demand. React render-time
source deferral prevents work before commit, but does not grant an abandoned
render authority to veto a later independent reader. This composes the
Collection subscription contract with the descriptor owner's zero-work-before-
commit law. Source `preload()` is independent demand too, although on-demand
source preload alone does not acquire rows.

The old React owner tested only the preload reader after suspension. Its
expected start rule was correct within that scope; its history grammar omitted
ordinary and deferring subscriptions. The first extension crossed all three
readers with startSync true/false and eager/on-demand sources (12 cells). PR
review then exposed cleanup reentry during ordinary admission, R01 below.

The final React grammar has 24 cells: ordinary subscriptions cross those source
axes with no cleanup, cleanup from loading, synchronous cleanup from ready, and
held cleanup from ready (16 cells); preload and deferring readers retain their
eight no-cleanup controls. The core lifecycle owner adds 24 cases crossing the
four cleanup histories with no start gate, a held unrequested gate, or a held
requested gate, in both source modes. The shared finite judgment is defined in
`collection-subscription-lifecycle-grammar-oracle.ts`. It derives expectations
from demand and cleanup authority, without reusing production classifiers.

Without cleanup, ordinary/preload demand starts once and reaches ready;
deferring demand remains idle with zero starts. An eager source publishes at
start; on-demand rows are owed to an ordinary subscriber, while source preload
alone does not acquire them. Cleanup during loading prevents adapter entry.
Cleanup during ready permits one entry and retires it. Held resource cleanup
retains the ready public status until settlement, as defined by the glossary.
Admission cannot retry a retired start. A fresh later subscriber may restart
it; otherwise the peer reuses the existing run.

The real React driver renders an ordinary hook and throws a never-settling
promise inside Suspense, preventing commit. Direct public Collection operations
then supply demand. The driver checks adapter entries, cleanup calls, status
and the complete status trace at admission return and cleanup settlement. It
checks rows only in no-cleanup histories, and checks fresh demand afterward.
The core driver reaches the same judgment independently of React, including
an explicit no-gate control. These are finite histories, not a claim about all
concurrent schedules.

| Subject | Result at intended checkpoint | Classification |
| --- | --- | --- |
| Original implementation, first 12-cell extension | All 4 ordinary cells see 0 starts instead of 1 | Historical assertion RED |
| First release-before-request repair, first 12 cells | All pass | Historical GREEN; omitted cleanup histories |
| Previously-requested-start mutant on that first repair | Both startSync=false ordinary cells fail | Historical assertion RED; not current calibration after reorder |
| Release-before-request repair, expanded cleanup grammar | 4/223 core owner cases fail and 4/24 selected React cases fail at admission return | Assertion RED |
| Original/no-release mutant, final 24-cell React grammar | All 16 ordinary cells fail on adapter entries or status; 8 controls pass | Assertion RED |
| Final request-before-release repair | All 741 surrounding core and 441 React tests pass | GREEN |

The repair records ordinary demand, requests/starts sync, then calls
`sync.resumeStart()` to release any render gate. There is no trailing start
request that could retry after callback cleanup. It adds no state, retry,
recovery path, or lifecycle. Releasing the gate in `resumeSubscriber()` was
tried and rejected: that query-owned acquisition transition may occur while
the renderer still owns a separate start gate, and it broke existing
synchronous-error/peer-release tests. That distinction remains intact.

Three core test files previously used an ordinary new subscriber to simulate
the renderer-held gate. Their drivers now create a deferring subscriber and
resume its acquisition while retaining the separate renderer gate. Their
queued request, cancellation, lease, and release assertions remain. Core tests
that directly exercise `_sync.loadSubset` still cover the actual deferred sync
queue. No expected result was changed to match a wrong production output.

F03 is `fixed-now` for abandoned-render deferral followed by independent public
subscription demand in the finite eager/on-demand, startSync true/false grammar.
The model, histories and drivers check admission, cleanup settlement, and later
fresh demand; both the original design and release-before-request repair are
rejected. No remaining
counterexample is known within those cells. Arbitrary React interruption
schedules and Electric `awaitTxId` delivery are not established. In particular,
the reporter's downstream txid timeout was not reproduced against Electric.

### Indexes must exist before compilation if diagnostics depend on them — F01/F08

This is an initialization requirement, not evidence of incorrect rows. Four
executed cells compile the same ordered-limit query before source sync:

| Index setup | Sync starts | Missing-index warnings | Installed indexes |
| --- | --- | --- | --- |
| None | 0 | 1 | 0 |
| Inside sync callback | 0 | 1 | 0 |
| `client.collection(descriptor).createIndex(...)` before query | 0 | 0 | 1 |
| Eager auto-indexing | 0 | 0 | 1 |

The report is right about timing and the missing descriptor config API. The
literal claim that there is no place to initialize indexes is too broad: an
application client initializer is available. The guide now shows it. Whether to
add declarative `indexes` or `onCreate` is a product/API decision. F08 retains its
unique hydration-fallback context but is a duplicate of F01's timing issue;
that exact React fallback/index-warning combination was not independently run.
The existing index-suggestion owner remains authoritative for diagnostic laws;
this evaluation does not invent a new runtime failure law.

### Readiness, cancellation, identity, and ownership — F04/F05/F06

Preload waits for readiness. A controlled never-ready source starts once and
keeps the promise pending. Whole-client cleanup rejects it and stops the source
once. The API has no timeout or `AbortSignal` option. Thus F04 identifies an
operational need and API choice; it does not falsify an existing deadline
promise. Real unreachable-Electric retry behavior remains reporter evidence.
A timer race alone does not cancel work; the guide now calls out cleanup.

The same prepared query produces different function-form `query` and
object-form `config` hashes. F05's diagnosis is correct. Config identity also
includes result settings such as schema, getKey, singleResult, and collation;
blindly merging hashes could alias different result contracts. The requested
guide note and shared-config example are implemented. This documentation action
is closed without changing identity semantics or adding a warning.

Three distinct browser preloads produce three public result records and three
retained preloaded Collections. Once one mounted observer takes authoritative
live ownership, public records fall from three to two, while retained preloaded
Collections remain three. Whole-client cleanup exists, and private error/retry
paths can discard entries; therefore “nothing discards them” is too broad.
There is no public per-query release. F06 needs a policy for cache lifetime,
active observers, repeated preload, eviction, and release. Cardinality proves
retained ownership here, not endless active network work or a violated memory
budget. The guide documents current ownership and independently owned query
Collections as an alternative. This does not close the API request.

## Lossless finding ledger

Severity below is this evaluation's estimate; the report supplied no formal
severity ranking. `design-decision` does not mean fixed or permission to defer a
known defect. No item is marked deferred.

| ID | Original claim and remedy | Evidence and technical verdict | Action | Durable destination |
| --- | --- | --- | --- | --- |
| F01 | 55 manual indexes have no descriptor creation hook; sync is too late; propose indexes/onCreate, use eager indexing | Timing confirmed by four cells; existing client initializer disproves literal lack of an initialization point. Low correctness severity, meaningful API friction | `design-decision`: declarative indexes versus initializer/eager policy | SSR index guidance; law analysis above |
| F02 | Plain warm-source SSR query renders rows but hydrates empty; use separate preload client or refuse unregistered source starts | Confirmed markup mismatch and actual React recovery, high SSR correctness impact; proposed refusal alone misses already warm sources | `design-decision`: capture versus initial empty/loading semantics; unfixed | React descriptor owner and coverage-map gap; preserved failing probe |
| F03 | Discarded render strands deferred start; ordinary subscriber should resume; preload works; awaitTxId may time out | Start defect confirmed; four original cells fail. Downstream Electric consequence unverified. High lifecycle impact | `fixed-now`: one executable call, 24-cell receiving grammar, 24 core cleanup histories and preserved acquisition boundaries | React descriptor owner, core acquisition owner, review calibration |
| F04 | Unreachable Electric can hang preload; request signal/deadline; race timer and cleanup | Missing option and controlled pending lifetime confirmed; real SDK retries unrun. Operational API need, no pre-existing deadline law | `design-decision`: signal/cancellation ownership and deadline policy | SSR lifetime guidance and API decision here |
| F05 | Function and config hashes differ; function hook misses preload silently; request guide note or warning | Distinct hashes executed; config result semantics prevent naive canonicalization. Medium migration friction | `fixed-now`: requested documentation alternative implemented; hashes unchanged | Shared-config SSR example and identity warning in guide |
| F06 | Browser preload map retains results on navigation; request public release; server-only workaround | Retained map confirmed; public records are consumed separately. Cleanup/private discard qualify literal claim. Potential unbounded workload-dependent retention | `design-decision`: release/eviction/cache semantics | SSR lifetime guidance and measured ownership history |
| F07 | Default ElectricCollectionUtils rejects Date descriptors; use generic any; old concrete Collection worked | Not reproduced by reliable direct strict compiler check on current source, including Date schema/non-schema, wrapper, and handler. Earlier isolated Vitest failure is contradictory and withdrawn as confirmation | `confirmed-open`, evidence gap; smallest failing assignment and resolved dependencies requested | Type probe in scratch and fixture request; no unsafe variance change |
| F08 | Hydration fallback warns about missing index before sync; eager indexing fixes | Compile-before-sync timing confirmed; exact fallback path not run. Low severity | `duplicate` of F01; unique fallback premise retained | F01 initialization guidance and this ledger |

F07 needs particular care: `tsc --noEmit` with strictFunctionTypes enabled and
explicit absolute paths to current db/electric sources accepts assignments to
`CollectionOptions<any, any, any, ElectricCollectionUtils> & NonSingleResult`.
It also accepts the report's generic `TConfig extends CollectionConfig<any,
any, any, any>` wrapper with a Date schema and typed mutation handler. Positive
non-never assertions avoid a vacuous `never` witness. Reversing the assertions
causes errors and leaves an unused `@ts-expect-error`. The tested fixtures do
not refute an unprovided application assignment. The report's Date/type-variance
explanation remains unconfirmed. There is no basis to loosen typed public
utilities or introduce production `any` for it.

The surrounding setup and closing prose also contain useful claims. They are
kept separately rather than silently folded into the numbered issues:

| ID | Contextual claim | Evidence, qualification, and action | Destination |
| --- | --- | --- | --- |
| N01 | 26 collections and about 50 hooks migrated; every page SSR/hydration and handoff succeeds with workarounds | `confirmed-open` for independent verification: reporter's application observation; no application fixture. Not an additional alleged defect | Retain integration testimony without claiming an end-to-end run |
| N02 | Descriptor factory receives request DbClient; handlers resolve another descriptor through it | `accepted-design`: client-aware factory signature in client.ts and SSR factory guidance. Source-verified; application handler not run | Existing scoped-client API and this review |
| N03 | Keep all browser sources syncing for txid waits; await only written tables, chosen from mutation result; unwritten collection “always times out” | `accepted-design` for evidence-driven waiting and scoped browser ownership, qualified: awaitTxId also accepts snapshot visibility evidence, so “always” is not a universal rule. Existing snapshot-end test exercises that exception | Electric awaitTxId/snapshot tests; do not turn the ERP's observation into a Postgres law |
| N04 | Separate finite-lived server preload client; query-results-only transport; timer, finally cleanup, graceful browser recovery | `design-decision` linked to F02/F04/F06. Cleanup is material; timer does not cancel; graceful application recovery not independently run | SSR lifetime guidance and unresolved transport policy |
| N05 | Shared builder/config lets loader and hook hashes match across clients | `fixed-now` documentation action linked to F05. A callback alone is insufficient across function/config forms; use the same config or config objects with the same explicit queryKey at both consumers, preserving compatible sources and result configuration | SSR shared-config example |
| N06 | Nested materialize descriptors resolve; descriptor ids stabilize identity across clients | `accepted-design`: existing descriptor owner checks includes/nested FROM, two-client identity and rows, with explicit finite limits | Existing owner, exercised in full React run |
| N07 | routerWithDbClient, Electric sync metadata hooks, and hydrated-to-live handoff work unchanged | `confirmed-open` for independent application verification; preserved positive report. Relevant component tests are not that ERP/Start integration | Reporter testimony; real-provider receiving limit above |
| N08 | Pass DbClient into module-level optimistic actions; wait for transaction settled before success toast | `accepted-design`: scoped-client mutation ownership and Transaction.when('settled') contract support this usage; reporter's toast integration not run | Existing transaction/client APIs; no unrelated optimistic machinery changed |

## Reviewer assessment

Recommendation: **hire**, with moderate confidence from this one integration
report. The author found two concrete lifecycle/SSR counterexamples, connected
them to practical application behavior, supplied useful workarounds, and
identified hash and retained-ownership details accurately. Signal is high and
the report preserves successful integration evidence as well as friction.

Prioritization and fix design need strengthening. Hydration and independent
demand are correctness defects; index hooks, cancellation, cache release, and
type erasure need separate contract/API treatment. “No place,” “nothing
discards,” and unwritten collections “always” timing out overstate the evidence.
The typing claim lacks a minimal fixture and did not reproduce in the reliable
compiler check. Refusing source starts is an incomplete hydration remedy.
Missing tests, law boundaries, partial-ready states, and adjacent schedules were
not analyzed by the reporter. These reduce confidence in a ready-to-implement
fix specification, without diminishing the value of the original diagnosis.

## Verification and replay

Scratch root: `/tmp/evaluate-dbclient-feedback/`. It holds the unchanged raw
report, append-only initial ledger and corrections, diagnostic sources, and
logs. Scratch files are not intended repository changes. Logs can include
cleanup diagnostics; the decisive REDs below are assertion failures reached
before cleanup, not setup failures or timeouts.

| Check | Executed result | Evidence file |
| --- | --- | --- |
| Expanded React subscriber grammar on original implementation | 4 subscriber assertion failures | original-subscriber-red.log |
| Historical previously-requested-start mutant before reorder | 2 false-config subscriber assertion failures | narrow-start-requested-mutant.log |
| Historical first-repair 12-cell subscriber grammar | 12 pass | react-subscriber-expanded.log |
| Full React suite before R01 | 22 files, 429 tests pass; type errors none | react-full-final.log |
| Full React suite after R01 | 22 files, 441 tests pass; type errors none | r01-react-green.log |
| Core surrounding suites before R01 | 7 files, 717 tests pass; type errors none | subscription-surrounding-final.log |
| Core surrounding suites after R01 | 7 files, 741 tests pass; type errors none | r01-core-green.log |
| R01 expanded core owner before reorder | 4 assertion failures, 219 pass; no suite/audit errors | r01-core-full-red.log |
| R01 expanded React matrix before reorder | 4 assertion failures, 20 pass | r01-react-red.log |
| Original/no-release mutant on final React grammar | 16 ordinary assertion failures, 8 controls pass; restored | r01-original-mutant.log |
| Final shipped-size comparison | db +8 gzip / +116 brotli bytes, changed module +24 minified bytes; react-db unchanged | r01-size.log |
| Diagnostic runtime probes | 7 pass: index timing, pending cleanup, identity, ownership counts | runtime-probes.log |
| Actual hydration diagnostic | 1 RED, 1 control GREEN | react-hydration-red.log |
| Reliable direct strict TypeScript check | Exit 0 on positive Date descriptor assignments | electric-tsc.log |
| Electric snapshot visibility exception | 1 existing test passes; 124 unrelated tests filtered; typecheck disabled for this targeted runtime check | txid-snapshot.log |
| Scoped ESLint | Exit 0, no errors; 3 pre-existing no-shadow warnings in lifecycle owner | Direct command output |
| Whitespace validation | git diff --check passes | Direct command output |

Run the permanent React owner from `packages/react-db`:

```sh
pnpm exec vitest run --coverage.enabled=false \
  --pool-options.threads.maxThreads=2 --pool-options.threads.minThreads=1 \
  tests/descriptor-query-binding-oracle.test.tsx
```

Run its demand matrix alone with `-t 'after an abandoned render'`. The original
calibration removes only the added `this.sync.resumeStart()` in addSubscriber.
The narrow calibration keeps that repair but changes sync.resumeStart's gate
to require both deferred start and a previously requested start; filter to
`"'subscriber' after an abandoned render"`. Those historical mutations were temporary and restored. The previously-requested
start mutant is no longer discriminating on the reordered path, which requests
before release; its old kill does not calibrate the current implementation.
The expanded final matrix is also run with the added resume call removed.
sync.ts has no final diff.

Core surrounding command, from `packages/db`:

```sh
pnpm exec vitest run --coverage.enabled=false \
  --pool-options.threads.maxThreads=2 --pool-options.threads.minThreads=1 \
  tests/collection-subscription-lifecycle-oracle.test.ts \
  tests/collection-subscription.test.ts tests/collection.test.ts \
  tests/db-client.test.ts tests/query/immutable-demand-boundary.test.ts \
  tests/live-query-deferred-acquisition-oracle.test.ts
```

Vitest's path matching also selects `tests/query/live-query-collection.test.ts`.
For scratch probes, copy each archived file back to its original package's
tests directory, run the same package-local Vitest filename, then move it back.
The electric probe uses direct `pnpm exec tsc -p
/tmp/evaluate-dbclient-feedback/tsconfig.electric.json --noEmit`, with that config
including the package-local file and absolute source paths. The hydration probe
is intentionally RED on this branch. It is not part of the green suite count.

## Oracle review evidence

This is a self-review of the modified oracle portions, not an independent
review of the whole owner or repository. Base HEAD is the exact commit above;
the content identifiers below bind the uncommitted executable changes to this
record. Recheck this evidence if those files change.

| Requirement | Outcome for the changed F03 boundary |
| --- | --- |
| ORC-001 | Law and authority distinguish independent demand, explicit deferral, cleanup retirement, pending-cleanup status and on-demand preload limits |
| ORC-002 | Shared finite judgment derives entries and status traces from demand and cleanup authority; row predictions follow fixture facts. Neither reuses production classifiers |
| ORC-003 | Opening and adjacent prose distinguish the judgment, finite cleanup grammar, core and React drivers, and observation checkpoints |
| ORC-004 | Bounded enumeration: 24 React cells (16 ordinary cleanup cells plus 8 controls) and 24 core cells (4 cleanup histories × 3 gate states × 2 modes). Gate, loading/ready, held cleanup and mode axes distinguish concrete next observations. Arbitrary schedules and failed providers remain outside scope |
| ORC-005 | Real Suspense render establishes the abandoned-render cut. Drivers compare callback entries, cleanup calls and full status traces at admission return and cleanup settlement; later demand checks restart/reuse. Rows are checked without cleanup |
| ORC-006 | Original/no-release mutant fails 16 final React cases. Release-before-request repair fails four core and four receiving cases at admission return. These are assertion failures, without timeout/setup failure |
| ORC-007 | Not triggered: bounded enumeration, no new random property or replay grammar |
| ORC-008 | No stateful reference machine added; finite demand/cleanup judgment distinguishes callback entry, public status, trace and fresh demand. Pending cleanup is explicit, without copying production state |
| ORC-009 | Uses source, sync run, acquisition, subscription, and render/commit cuts as in glossary; fixture starts are sync-entry instrumentation, not a new production state |
| ORC-010 | finally resolves held cleanup, removes listener, releases peer/subscriber/tree/client and handles pending preload rejection. Original-mutant source restoration uses finally; no shrinking layer changed |
| ORC-011 | Expected entry counts and cleanup retirement derive from public contracts; preload/deferring controls and fresh-demand restart challenge overbroad suppression. No named shared semantic computation fault requiring another formulation was found |
| ORC-012 | This exact-base/content record, loss audit, and coverage-map update state the finite closure and open receiving cells |
| ORC-013 | Ordinary versus deferring demand distinguishes veto from ownership. Callback cleanup rejects trailing restart; held cleanup distinguishes delayed retirement. A new peer rejects suppressing all restarts. Historical previously-requested-start mutant evidence does not calibrate the reordered path |
| ORC-014 | Real React supplies the abandoned-render premise. Sync readiness/publication remains controlled; Electric txid delivery and arbitrary host schedules are expressly outside the closure claim, with owner/gap in coverage map |

## Content identifiers

SHA-256 of the executable files reviewed above, on the stated base plus working
changes:

| File | SHA-256 |
| --- | --- |
| `packages/db/src/collection/changes.ts` | `9b7d6bf3f24bd23cfc383fd416630527134e8082dc04b563b1269247351651e7` |
| `packages/react-db/tests/descriptor-query-binding-oracle.test.tsx` | `ac6686ebc5caa4aa4aceca43fb1b89e495ab1e01e923c866e35ed4835f07940d` |
| `packages/db/tests/collection-subscription-lifecycle-oracle.test.ts` | `ed48ff71b10b5878a182527ce3ce29bf1f3866b848b91b4cb164a881d88f75f4` |
| `packages/db/tests/collection-subscription.test.ts` | `eaea5e97d9af83383af3c9595f05db4f1dbdbafbd13ea8c30e3a209347af3239` |
| `packages/db/tests/db-client.test.ts` | `8ff61c5f994db41062834c4857502f96a9118678b43a6da41571bb1749d50bb7` |
| `packages/db/tests/collection-subscription-lifecycle-grammar-oracle.ts` | `4b915ee56770f18334ab477cf7710ae2108e0dbaada2cd5654a1f6be3c25499b` |

The source report SHA-256 is `846313a43c3deae3b72abcd7ae2102c4b589460465ee838c9fb42fa6dd379922`.

## Loss audit and implementation state

Returned to the raw report after verification: all eight numbered issues,
setup/helper suggestions, and closing positive claims are represented above.
F08 overlaps F01 without losing fallback timing; N04/N05 preserve workaround
details without erasing their corresponding defects. No sibling production
defect was confirmed. The erroneous intermediate typing conclusion is corrected
in the append-only scratch ledger and here.

Numbered finding totals: 2 `fixed-now`, 4 `design-decision`, 1 `confirmed-open`,
1 `duplicate` = 8. Contextual claim totals: 1 `fixed-now`, 1 `design-decision`,
2 `confirmed-open` reporter observations, 4 `accepted-design` qualified API
usages = 8. Combined: 3 fixed + 5 decisions + 3 open + 4 accepted + 1 duplicate
= 16 raw items. These are disposition counts, not 16 production defects.
There are zero deferred, stale, already-fixed, or fully refuted items.

Item accounting is complete; implementation is not fully complete. F02 remains
a demonstrated defect pending its exact initial-snapshot contract. F07 needs
the failing application fixture. Index initialization, cancellation and preload
release need API decisions. Reporter deployment success, actual unreachable
Electric retries, the txid consequence, and Start/Electric hydration are not
independently established. No postponement of confirmed repair work has been
approved or inferred. The permanent suite's green excludes the explicitly
preserved failing hydration diagnostic.

Initial evaluation readiness: **not assessed**. The original request was to
evaluate feedback, before the later PR preparation request. The known
hydration counterexample prevents claiming this work closes all migration bugs.

## Subsequent PR preparation review

The user subsequently requested PR preparation. Parallel simplification and
independent production/lifecycle and oracle/documentation review found two
introduced issues. No simplification was warranted. The user accepted R01; the
admission path is now repaired and the expanded oracle covers cleanup reentry.
The user also accepted OD01; the guide and N05 now require config objects at
both consumers when using an explicit queryKey.

| ID | Finding | Evidence and gap | Current action |
| --- | --- | --- | --- |
| R01 / PL01, P2 | Ordinary subscription can restart a source after its startup callback cleans it up | A deferred, previously requested start reaches ready, whose listener calls cleanup once. At subscribeChanges return, starts=2 and status=ready; the trace is loading, ready, cleaned-up, loading, ready. Nondeferred and deferred-without-queued-request controls each start once and remain cleaned-up. The copied original stays stranded at zero starts/idle in both deferred cases. Existing cleanup law requires retirement; new reader histories omitted callback cleanup, while core cancellation histories use explicit gate release without this admission path | Fixed after user acceptance. Mark demand, request/start sync, then release the gate. The shared cleanup judgment reaches 24 core and 24 React cells; original wrong order fails four cases in each path, and the repair passes the surrounding suites |
| OD01, P3 | Added queryKey guidance promises unsupported cross-form reuse | getExplicitQueryKey reads object inputs only; the bare callback hook accepts a dependency array as its second argument. Therefore an explicit loader key cannot connect useLiveQuery(openTodos.query) | Fixed after user acceptance. The guide and N05 require config objects with the same explicit queryKey at both consumers, preserving compatible sources and result configuration. Verified against the hook overloads, getExplicitQueryKey and the preload key lookup |

The runtime probe ran successfully against the current source and an isolated
copy with only the added resume call removed. An earlier TypeScript-script
setup failure is excluded from the evidence. The parent repeated the successful
three-case current-source probe. Raw independent reviews, exact scripts, and
stdout are preserved under the same scratch root as `prep-code-review.md`,
`prep-production-review.md`, `prep-production-current.log`,
`prep-production-original.log`, and `prep-oracle-docs-review.md`.

The hydrated-row core test now resumes detached demand rather than itself
proving the exact sync-layer queue path. Adjacent explicit _sync.loadSubset
and lifecycle request histories preserve that path; this is a qualification,
not another confirmed defect. Internal resumed deferring acquisition remains
distinct from new ordinary demand. Executable content identifiers above bind
the accepted repair and expanded judgment.

F03 is fixed-now within the expanded finite scope. Numbered totals return to
2 fixed, 4 decisions, 1 open, and 1 duplicate. R01 and OD01 are fixed.
The eight contextual items retain their earlier dispositions, with N05 qualified
by OD01. R01 and OD01 are additional PR-review items, not additional claims
attributed to the migration reporter. The user approved committing the reviewed
changes and generating PR documentation. The open hydration
policy and missing typing fixture remain outside this repair's closure claim.

A focused independent follow-up reviewed the accepted R01 repair and changed
judgment/drivers after calibration. It found no residual actionable defect:
request-before-release removes the trailing restart; the shared judgment is
independent; both drivers check entries, cleanup calls, full status traces at
admission return/settlement, and fresh-demand restart. It verified the counts
for 24 core cases and 24 React cases, including loading cleanup and held cleanup.
This was a read-only source review, not a new broad test run or whole-PR
readiness verdict.

## Subsequent CodeRabbit evaluation

[Review 5618234197](https://github.com/TanStack/db/pull/2229#pullrequestreview-5618234197)
covers `2975790568cab6c4834db575fe22904693f669e3`. The next head
`75a7d043fee10f50f34ecd4b1f13df918b2bf373` changes only skill instructions;
all six reviewed executable hashes still match. The inline comment's newer
commit metadata does not change the review body's stated coverage.

| ID | Claim or contextual assessment | Disposition |
| --- | --- | --- |
| C01 | LGTM shared cleanup judgment | accepted-design |
| C02 | LGTM ordinary subscriber production order | accepted-design |
| C03 | LGTM db-only patch changeset | accepted-design |
| C04 | LGTM core lifecycle changes and cleanup histories | accepted-design |
| C05 | LGTM subscription driver deferral changes | accepted-design |
| C06 | LGTM client test driver changes | accepted-design |
| C07 | LGTM React receiving grammar | accepted-design |
| C08 | LGTM coverage-map limits | accepted-design |
| C09 | LGTM SSR guide identity, indexes, lifetime | accepted-design |
| C10 | Rewrite 24 core and 24 React case counts | fixed-now |
| C11 | Clarify ready eager rows | fixed-now |
| C12 | Replace machine-local Feedback.txt source path with stable identifier | fixed-now |
| C13 | Mutable summary warns 0% docstring coverage against 80% threshold | accepted-design |
| C14 | Mutable summary says mergeable with documentation follow-up | accepted-design |
| C15 | Mutable summary title check passes | accepted-design |
| C16 | Mutable summary description check passes | accepted-design |
| C17 | Mutable summary linked-issue check skipped | accepted-design |
| C18 | Mutable summary out-of-scope check skipped | accepted-design |

The three corrections change prose only. The source reference now uses the
existing immutable artifact identifier, whose SHA-256 matches the archived raw
feedback. Counts and Collection status wording retain the original meaning.
Direct source and link checks, plus whitespace validation, are sufficient for
these findings. No production or oracle behavior changed, so no new runtime
RED/GREEN claim is made.

The docstring warning names no functions and supplies no repository authority
for its 80% threshold. The admission method has JSDoc, and the shared judgment
has adjacent literate contract prose. Preserve that approved documentation
form rather than add redundant comments for an unverified external metric.

Loss audit: 18 items = 3 fixed-now + 15 accepted-design contextual assessments.
No CodeRabbit finding is deferred or confirmed open. Raw review, inline data,
mutable summary and the detailed ledger are retained in task scratch. Related
PR #2060 is a useful navigation pointer, not new proof of current behavior.
Reviewer recommendation: hire, with low confidence from this review alone.
It supplies three useful documentation corrections and no new runtime
counterexample. The original open hydration decision and typing fixture gap
remain separate; pending CI and a mergeable flag do not establish PR readiness.


## Cleanup admission follow-up — CodeRabbit review 5620262151

[Review 5620262151](https://github.com/TanStack/db/pull/2229#pullrequestreview-5620262151)
covers `75a7d043fee10f50f34ecd4b1f13df918b2bf373`. Its runtime code is
identical to the starting head `7f2ad8e12f44c1811d1b557b19b9116435259763`.
This appendix audits the follow-up on that head. The executable content hashes
below identify the tested tree independently of this report's commit.

### Law, experiment, and repair

A same-path diagnostic reproduced the admitted-but-idle subscription in eight
cells: loading/ready status, eager/on-demand mode, and both initial-snapshot
options. The adapter cleanup promise remained held when `subscribeChanges`
returned an active subscription. After cleanup settled, the Collection stayed
`cleaned-up` with one subscriber until an explicit restart. The same observations
held with `changes.ts` from merge-base `205ab7158`; this predates the PR.

The review proposed automatic retry. The public cleanup contract instead closes
restart admission while cleanup is active. On 2026-10-22, the user selected
rejection: “yes reject during cleanup.” This decision applies to ordinary
subscription admission and deferred acquisition resumption. A subscription that
still defers acquisition can retain logical demand without starting source work.
Existing subscriptions can survive cleanup for an explicit restart. An Effect
constructed during active cleanup must still return a disposed handle.

| Law and authority | Oracle extension and observations | Decisive evidence |
| --- | --- | --- |
| Ordinary admission and deferred resumption reject during active cleanup. Authority: the user decision, `subscribeChanges` contract, and glossary cleanup boundary. | The primary cleanup/restart owner's three-cut model now drives 18 cells: loading/ready/error, eager/on-demand, and plain/snapshot/resumed admission. At the held cut it checks the error, unchanged subscriber ownership and callbacks, zero new sync runs or acquisitions, and retained deferral. After settlement it checks no automatic restart, successful explicit admission, and the replacement row. | Original implementation: 18 admission assertion failures. Omitting only the resume guard: six resumption assertion failures. Final owner: all 70 tests pass. |
| Cleanup start makes an Effect terminal without retaining partial source ownership. Authority: the existing Effect cleanup contract and glossary. | Twelve receiving histories use real `createEffect`: all three prior statuses, both source modes, and cleanup on either joined source. They check a disposed handle, one cleanup report, no batches, no source subscriptions or retained cleanup observers, and successful new construction after settlement. | Guards with the old Effect observer order fail all 12 receiving histories during construction with `CollectionStateError`. The final observer order passes them. |

The production repair adds the existing lifecycle admission assertion before
ordinary ownership or deferred resumption changes. The Effect cleanup observer
moves before subscription admission. It can retire a late Effect before that
Effect requests forbidden source work. There is no retry queue or new state.
These are two new executable guard statements; the Effect machinery is moved.
Tests and contract prose account for the remaining source growth.

The old cleanup owner checked start/preload admission and the late Effect
handle, but did not exercise fresh ordinary admission or deferred resumption
while adapter cleanup remained pending. The general subscription grammar models
completed cleanup and explicit restart. R01 checks cleanup during an admission
already in progress. Neither history is this new admission boundary.

The new oracle retains the independent three-cut judgment. It adds production
paths and finite histories, without changing that model to match production.
A deferred subscription may report its local snapshot before a rejected resume.
The callback recorder preserves that prefix and requires rejection to add no
callbacks. The later row projection deliberately compares only `id` and `rank`;
virtual-field semantics are outside this law. All recorder entries remain
countable, so an extra callback cannot disappear in a final row map.

### Executed evidence and limits

Scratch root: `/tmp/tanstack-skill-reading-update/`. It retains the complete raw
review, append-only item ledger, diagnostic source, and logs. Calibration restores
the final source bytes in `finally` and verifies their identity. The original
and missing-resume outcomes are assertion failures at the held admission cut.
The guard-only outcome is a runtime failure after setup at Effect construction;
it is not a timeout or a refinement-assertion kill.

| Check | Result | Evidence file |
| --- | --- | --- |
| Same-path current and merge-base diagnostics | Eight observed histories pass on each version | cleanup-probe-current.log, cleanup-probe-base.log |
| Original implementation, final 30-cell selection | 18 admission failures, 12 Effect controls pass | cleanup-calibration-original.log |
| Fresh-subscriber-only guard | Six resumption failures, 24 controls pass | cleanup-calibration-no-resume-guard.log |
| Guards without Effect observer reorder | 12 construction failures, 18 admission controls pass | cleanup-calibration-guard-only.log |
| Core and Effect surrounding suites | Ten files, 951 tests pass | cleanup-surrounding.log |
| Collection, DbClient, immutable-demand and receiving query suites | Four files, 224 tests pass | cleanup-additional.log |
| Full React suite | 22 files, 441 tests pass | cleanup-react.log |
| Scoped ESLint and whitespace | No lint errors; diff check passes | Direct command output |
| Production bundle against merge-base 205ab7158 | db +12 gzip / +64 brotli bytes; React unchanged | cleanup-size.log |

All Vitest runs report no type errors. The complete repository `pnpm test`
command was not run. The ordinary receiving checks use controlled adapter
cleanup and real Collection entry points; the Effect checks use that same
premise through real Effect construction. They establish the stated finite
admission and ownership cuts, not actual provider shutdown or every framework
schedule. The owner already has cleanup rejection and terminal-status restart
histories. Ordinary admission specifically at a terminal-status callback,
multiple overlapping cleanup failures, and arbitrary framework scheduling are
not new coverage here. The primary cleanup/restart owner owns additional core
boundary histories; framework conformance drivers own their host schedules.

Replay the new finite selection from `packages/db`:

```sh
pnpm exec vitest run --coverage.enabled=false \
  tests/collection-cleanup-restart-oracle.test.ts \
  -t 'closes .* admission during|releases a late Effect'
```

The ten-file command adds the lifecycle history, acquisition cells, subscription
reentrancy, deferred acquisition, sync reentrancy, idle cleanup, ordinary
subscription, Effect, and Effect disposal suites named in the evidence table.
The four-file command selects `collection.test.ts`, `db-client.test.ts`, and
`query/immutable-demand-boundary.test.ts`; Vitest also selects the receiving
`query/live-query-collection.test.ts` by path matching.

| ORC requirement | Follow-up outcome |
| --- | --- |
| 001 authority and limits | The explicit rejection decision, public cleanup contract, and finite bounds are recorded above and beside the executable law. |
| 002 independent judgment | The reused three-cut model derives admission and terminality from the contract, without importing production classifiers. |
| 003 literate responsibilities | Opening prose, model, case arrays, real drivers, and checks remain distinguishable in the primary owner. |
| 004 generated grammar controls | No new generated property. The fixed products reconstruct the report and add error status, resumption, snapshot, and join-position neighbors. |
| 005 production path and observations | Public admission, callbacks, subscriber counts, statuses, replacement row, Effect handle, and cleanup observer ownership are compared at held and settled cuts. |
| 006 calibration | Original, missing-resume, and guard-only outcomes are classified above. Each reaches its named admission or construction boundary. |
| 007 campaign parity and replay | No new important generated property. The finite selection runs directly with the command above. Existing lifecycle campaigns still run fixed and random seeds. |
| 008 state minimality | No reference-model state was introduced or removed. |
| 009 vocabulary mapping | Existing cleanup-start, settlement, subscription, acquisition, and sync-run concepts are reused. The prior model's dependent abstraction is unchanged. |
| 010 failure fidelity | New drivers use the owner's cleanup aggregator to preserve primary and teardown errors and release every resource. Its existing calibration remains green. |
| 011 second formulation | No concrete shared semantic fault remains after the explicit policy choice; no additional independent formulation is claimed. |
| 012 review evidence | This appendix records applicable outcomes and exact source identities. This is a self-review, not an independent agent review. |
| 013 boundary witness | Held cleanup rejects while explicit admission after settlement succeeds. Ready, loading, and error statuses prevent a ready-only repair from defining the law. |
| 014 receiving handoff | Real Effect construction receives controlled adapter cleanup through the same owner and judgment. No real provider-shutdown or all-framework claim is made. |

### Loss audit and reviewer assessment

CR2-01 is the single unique behavioral finding, repeated in generated prompts.
Its admitted-but-idle counterexample is confirmed. Its proposed retry is
superseded by the user's rejection decision. The boundary repair and its finite
oracle coverage are `fixed-now`; no cleanup finding is deferred or left open.
The review body, both repeated prompts, selected-file metadata, and outside-diff
placement were reconciled. There is no associated inline finding. Loss total:
**one raw item = one fixed-now**. The original F02 hydration policy and F07
application typing fixture remain separate open work.

Reviewer assessment: hire for counterexample discovery, with low confidence
from one finding. The report supplies a useful public lifecycle cut and a
correct symptom. Its proposed cure lacks contract authority and misses the
Effect guarantee, so its fix guidance needs independent verification.

Executed source identities (SHA-256):

| File | SHA-256 |
| --- | --- |
| `packages/db/src/collection/changes.ts` | `f6b2e2fff7b782e1306838ae860e467f21fcaf9aaff5271486bec9e9a5aa4c5d` |
| `packages/db/src/collection/index.ts` | `29bf79f5b702a1bfea91040c86d08b439e99688c5bff10a5b9983f6bd652e11c` |
| `packages/db/src/query/effect.ts` | `0e7cd82b5213edf3666e8793f6bd71ffd1dd9166f7574cbf5c75920c74610f7b` |
| `packages/db/tests/collection-cleanup-restart-oracle.test.ts` | `a87b7b3fad0637a1d3cb7de831d3943304f3c8c4e84c11b558367e35be1f52c6` |
