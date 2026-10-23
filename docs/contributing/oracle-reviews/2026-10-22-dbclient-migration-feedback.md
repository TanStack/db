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

## Eight-item review of 16824f677 — follow-up evaluation

The user supplied eight deduplicated, unverified findings against PR #2229 at
`16824f6778bc3feb21c67d4f865c4f444e11f2e4`. The reviewer used medium effort and
reported no clear AGENTS.md violations. Those statements describe provenance,
not correctness evidence. This appendix records a self-review and executed
experiments. The earlier appendices remain historical records.

### Laws, experiments, and inference

The review exposed incomplete ownership handling around a deliberate rejection
boundary. It also exposed a separate resumption defect. The user's decision,
“yes reject during cleanup,” remains authoritative. Automatic admission and
restart would revise that contract. It would not establish failure atomicity
for other setup errors.

| Law and authority | Existing coverage and precise gap | Experiment and repair |
| --- | --- | --- |
| Explicit demand can start a source independently of an abandoned render. Authority: subscriber/preload contract and the deferred-acquisition owner's opening law. | Ordinary admission released the render gate. The deferred-acquisition grammar lacked render-deferred source states and explicit subscription resumption. Stream preloads covered only an eager source without that gate. | R03 fails with zero source starts. The grammar now crosses seven source states, two query shapes, one/two levels and eleven histories. Both ordinary admission and resumption use the existing request-then-release ordering. Eight stream histories cross pending/success, eager/on-demand and idle/render-deferred. Omitting release only from resumption fails all four render-deferred stream cases; the four idle controls pass. |
| A failed subscription call transfers no listener ownership because it returns no release handle. Authority: observer subscribe/dispose contract. | The eligibility ledger covered publication and reentry after successful registration. It did not fail source admission during attachment or inspect leases before cleanup. | R07 leaves failed records and client/status/layout leases. Eight histories cross mode, cleanup/startup failure and one/two attempts. They inspect leases immediately, then explicit retry, publication and release. Two granular late-seed histories keep a healthy peer. Shared release removes only the failed record and detaches channels when the last owner leaves. A detach-only mutant fails all ten ownership histories. Synchronous setup errors still propagate. |
| Source cleanup makes a dependent pooled live query terminal and releases partial ownership. Authority: pooled/live-query lifecycle equivalence and glossary cleanup start. | The row grammar never releases a partition. The release owner covered reattachment and pending cleanup separately, but not their intersection or cleanup during startup before assignment. | R02 fails on a released partition reattaching during held cleanup. Twelve histories cross new/retained/released ownership, both observer modes and loading/ready cleanup. Two startup reentry histories check total logical ownership as well as public acquiring count. Observe cleanup before subscribing, release on failure, and unsubscribe a handle returned after synchronous retirement. |
| Cleanup callers share one operation until a replacement sync run actually starts. Authority: public cleanup promise and restart contract. | Admission validation also cleared cleanup ownership. A successful replacement was indistinguishable from a deferred request or a failed first-demand notification. | R05's successful subscriber legitimately starts a replacement. Its narrower defect appears when no replacement starts. Six outcomes compare promise identity, adapter entries and cleanup counts before settlement. Validation is now pure; entering loading transfers cleanup ownership to the actual replacement run. |
| Deferred logical demand starts no source work during cleanup. Authority: deferred-acquisition contract and the approved ordinary-admission rejection policy. | R06 was absent from the cleanup grammar: idle/cleaned-up cleanup-start callbacks could subscribe to a plain Collection, but a live-query Collection attempted local startup and threw. | Six histories cross plain/live-query and idle/ready/cleaned-up cleanup. Ordinary admission and resumption reject at the callback cut; logical demand stays deferred, then resumes explicitly after settlement. Local live-query startup now waits while cleanup is active. A universal rejection of deferred demand would violate this neighboring law. |
| Resumption cannot restore a retired subscription. Authority: subscription ownership and unsubscribe contract. | Releasing the render gate makes startup callbacks reachable during resumption. The old ownership increment followed those callbacks even when they unsubscribed. | S02 adds 28 histories from an independent token-count judgment: seven retirement/cleanup forms, both modes and both render-gate states. Start, acquisition count and the complete subscriber-count trace are checked at return and after settlement. Resumption commits its flag before notification and checks retirement on both sides. Removing the post-start guard fails 16 lifecycle and two pooled reentry assertions. |
| A deferred-source handoff preserves startup error identity and releases healthy peers. Authority: existing DbClient failure/peer contract. | After R03, independent demand may consume the render gate before the later handoff. The existing source-failure tests then exposed a lost error. | S01 preserves the current Collection sync error after the render release is already consumed. Existing exact-error, failed-stream replacement and healthy-peer witnesses pass. No automatic retry or new lifecycle state is introduced. |

These repairs preserve cleanup rejection, terminal dependents, render-only
zero-work behavior, independent preload demand, publication eligibility and
explicit restart. The laws are encoded and reached at the listed observation
cuts within their finite domains. No known reachable counterexample remains
within these declared repair boundaries. This is not a proof over arbitrary
provider, callback or framework schedules.

The receiving React driver adds deferred subscription resumption to the real
abandoned Suspense grammar. It reuses the core startup/cleanup judgment and
checks adapter entries, complete status traces, cleanup settlement and later
demand. Its 64 tests pass. A full-suite failure also exposed an older conflicting
expectation in `useLiveSuspenseQuery.test.tsx`: it expected no browser acquisition
while a server stream was pending. The established stream-preload law predicts
one local start, independently of stream availability. The corrected assertion
requires that start. The unchanged later assertions require the server row
until browser acquisition completes, then the browser row. This changes the
work observation to the accepted law without weakening snapshot authority.

### Source-order item ledger

Severity below is this evaluation's assessment. The supplied review gave no
severity except marking R06 as a design issue. Complete raw claims and the
append-only working ledger remain in the scratch root named below.

| ID | Original claim and proposal | Technical judgment and evidence | PR action and durable value |
| --- | --- | --- | --- |
| R01 | Ordinary admission throws during GC cleanup while status remains ready; framework subscription can fail; no public promise/status exists to wait on. Proposed automatic admission/restart. | Rejection and retained status are approved. The no-promise subclaim is false: the same-path fake-timer GC probe calls cleanup(), obtains the exact pending operation, awaits it and subscribes successfully. A framework that does not handle the throw can still surface it. | `accepted-design`. Preserve the API-suitability concern and the GC timeline evidence. The public retry instruction remains valid. No automatic restart added. |
| R02 | registry.add precedes a throwing source subscription, retaining a nonterminal partition without a cleanup observer. | Confirmed, medium. Released-partition reattachment during pending cleanup exposes nonterminal status and partial ownership. Original expanded owner has four assertion failures on that boundary. | `fixed-now`. Earlier cleanup observation and complete partial release; release-owner grammar and startup reentry checks above. |
| R03 | resumeSubscriber checks admission but does not release an abandoned render gate, leaving a live query loading; changed fixtures hide it. | Confirmed, high. Both source modes have zero starts at the required demand cut. The correct React invocation fails all 16 added resumption cells before repair. | `fixed-now`. Shared subscriber start path and expanded acquisition/React grammars. Cancellation fixtures now create logical demand before explicit resumption. The DbClient fixture queues actual render-owned work directly, preserving its original cancellation assertion. |
| R04 | A startup throw consumes deferral, rejects other queued loads, and retains the first-demand flag while rolling back only counts. | These observations are real but belong to a failed sync run. The same-path probe reaches error, preserves the exact startup error for queued work, proves the old render release does not retry, and proves cleanup/new demand restores first-demand notification and readiness. Rolling back to an implicitly retryable idle run is not promised. | `accepted-design`. Preserve failure identity and explicit-restart witnesses. S01 enforces the neighboring handoff error law. This does not endorse partial ownership on failure, which R02/R07 repair. |
| R05 | Admission validation clears cleanupPromise, so concurrent cleanup can lose coalescing. Proposed a pure check. | Partly correct, medium. Successful ordinary admission starts a replacement and should receive a new operation. Deferred requests and failure before replacement startup must retain the old promise; those cases fail originally. | `fixed-now`. Pure assertion, transfer at actual loading, six distinguishing promise-identity histories. |
| R06 | Split admission differs between deferred plain/live-query Collections and requires cleanup-listener ordering. Proposed one shared method. | Narrower defect confirmed, medium: idle/cleaned-up cleanup-start reentry differs; ready cleanup does not show a blanket difference. Internal terminal dependents still need cleanup observation before source work. A common method cannot remove that ownership obligation. | `fixed-now`. Shared ordinary/resumed start logic and no local startup for deferred demand during cleanup. Six histories retain valid logical admission. No general policy/state-machine replacement. |
| R07 | Observer attach leaks client/status/layout listeners when source admission throws; should expose observer error status. | Leak confirmed, medium, including the logical listener record. A retry on the same observer originally attaches no source. Snapshot-error conversion is a separate unapproved policy. | `fixed-now`. Release failed registration and channels, preserve healthy peers and synchronous error reporting. Ten ownership histories plus existing publication campaigns. |
| R08 | An Effect created during cleanup returns disposed, never runs after restart, and gives no public reason. | Terminality is approved. The no-diagnostic subclaim is false: the same-path probe observes disposed and exactly one onSourceError with the cleanup cause, zero source ownership and no revival. The existing twelve joined-source receiving histories agree. | `accepted-design`. Keep explicit new Effect construction after settlement. No automatic revival. |
| R09 | Closing proposal: admitting then restarting would likely remove R01/R02/R07/R08; R03–R06 are separate. | This is a proposed contract revision, not a demonstrated cure. It conflicts with the user's rejection choice and does not prove setup-failure atomicity. | `accepted-design` for retaining rejection. Preserve automatic admission as an evaluated alternative, without implementation. |
| R10 | Metadata: eight deduplicated issues, medium effort, verified head 16824f67, no verification and no clear AGENTS violations. | Provenance retained. Matching HEAD was verified locally; effort and absence claims have no independent behavioral authority. | `duplicate` of the provenance recorded at this appendix's opening, with no product action or independent correctness credit. |
| S01 | Evaluation-discovered lost startup error after independent demand consumes the render gate. | Existing exact-error/healthy-peer tests fail on the first R03 repair. | `fixed-now`; deferred-source handoff now preserves that failure and peer release. |
| S02 | Evaluation-discovered resumption restores an owner retired during startup or misbalances notification reentry. | Original post-start ownership order fails pooled reentry; the calibrated guard mutant fails 18 assertions. | `fixed-now`; token-count grammar and two-sided retirement guards. |

Loss accounting: **eight raw findings = five fixed-now + three accepted-design**.
The two additional raw prose/metadata items remain separately accounted for.
Including them gives ten raw items = five fixed-now + four accepted-design +
one duplicate provenance entry.
Two discovered siblings are fixed separately. False subclaims remain explicit
inside their source items. No item is deferred or silently merged.

Reviewer recommendation: **hire for bug discovery, with reservations about fix
judgment**. Five of eight findings expose real defects, sometimes on a narrower
trace. R02/R03/R07 identify useful lifecycle cuts and R05 correctly questions
side effects in validation. The report does not execute them, overstates the
absence of public diagnostics in R01/R08, and treats an approved terminal policy
as a defect. Its automatic-restart proposal lacks contract authority and misses
failure atomicity. The ranking of R03 below the policy concern understates the
most direct progress failure. The reviewer is useful with independent contract
and experimental verification.

### Executed evidence and limits

Scratch root: `/tmp/tanstack-skill-reading-update/`. Logs retain assertion
messages and exact selected tests. No mutant remains in the working source.
Every mutation restores original bytes in `finally` and checks SHA-256 identity.

| Experiment | Executed outcome | Log basename |
| --- | --- | --- |
| Original same-path probes | Seven assertion failures / seven passing controls; R01/R04/R08 reach the reported premises | review-eight-probes-red-2.log |
| Corrected original cleanup/observer/pool owner selection | 16 assertion failures / 125 passes: four cleanup, eight observer and four released-partition failures | review-eight-boundaries-red.log |
| Original real React receiving driver | 16 added resumption assertion failures | review-eight-react-red-proper.log |
| First repair, source handoff | Existing exact-error/peer tests expose S01 | review-eight-oracles-green-first.log |
| Startup cleanup during resumption | Two acquiring-count assertion failures expose S02 | review-eight-pool-reentry.log |
| Resumption retains render gate mutant | Four stream-preload assertion failures / four idle controls pass | review-eight-mutant-resume-keeps-render-gate.log |
| Observer detach-only mutant | All ten setup-ownership histories fail assertions, including healthy-peer preservation | review-eight-mutant-observer-detach-only-final.log |
| Retired-owner guard removed | 18 count assertion failures / 268 passes across complete lifecycle and pool files; no type or cell-audit error | review-eight-mutant-resume-retired-owner-final.log |
| Final five modified oracle owners | 741 tests pass; no type errors | review-eight-owners-final.log |
| Broad core/Effect/query surrounding run | 53 files, 2,584 tests pass; no type errors or unhandled errors | review-eight-core-final-3.log |
| Full React suite | 22 files, 457 tests pass; no type errors | review-eight-react-final-2.log |
| Scoped ESLint | Zero errors; pre-existing warnings remain | review-eight-lint-final-2.log, final command output |
| Production bundle vs merge-base 205ab7158 | db +102 gzip / +171 brotli bytes; react-db unchanged | review-eight-size.log |

The early `review-eight-oracles-red.log` is not a clean calibration total. It
contains eight invalid virtual-field comparisons and eight progress timeouts
among 80 failures. The invalid comparisons were corrected to the declared row
projection. The clean boundary and React assertions above carry the RED claim.
`review-eight-react-red.log` selected no tests and supplies no evidence.
The first retired-owner mutant used a test-name selection that also triggered
the existing cell audit because other tests were skipped. Only its count
assertions were useful; the complete-file rerun supersedes that audit artifact.
Intermediate broad GREEN attempts passed runtime assertions but had test-fixture
type errors. They are not cited as clean GREEN runs.

Production source weight for this follow-up is +71/-39 lines, net +32 across six
files. Shared admission startup, shared observer release and centralized pooled
status release remove duplicate control flow. The remaining added checks defend
observable partial-construction and reentry boundaries. Tests add dimensions
and assertions separately from production. Shipped growth above is +90 gzip and
+107 brotli bytes beyond reviewed head's earlier measured delta. No new stored
state, retry queue or recovery lifecycle was added.

Replay the broad core run from `packages/db`:

```sh
pnpm exec vitest run tests/collection tests/db-client.test.ts tests/effect \
  tests/live-query tests/query/pooled-live-query --coverage.enabled=false \
  --pool-options.threads.maxThreads=2 --pool-options.threads.minThreads=1
```

From `packages/react-db`, run the same command without path selections. The
complete repository `pnpm test` was not run. These results do not establish
actual provider shutdown, every framework commit schedule, arbitrary recursive
callbacks or unbounded failure histories. Source/error and cleanup facts are
available at the asserted cut; no concrete missing-input hypothesis remains for
these repairs. The coverage map retains each owner's wider limits.

| ORC requirement | Follow-up result |
| --- | --- |
| 001 authority and limits | Accepted rejection, demand, ownership, error and cleanup-promise laws are stated above and beside executable checks. |
| 002 independent judgment | Demand model, three-cut cleanup timeline, handle-count ownership and token-count retirement judgment do not import production semantic helpers. Private counts supplement public ownership observations; they do not compute expectations. |
| 003 literate responsibilities | Changed owners explain contract, independent judgment, finite grammar, real driver and immediate/settled comparisons. The shared grammar is named by core and React drivers. |
| 004 grammar controls | New cases are bounded enumerations, not important generated properties. Existing random campaigns are unchanged. Render deferral, explicit resume, held cleanup, released partition and failed attachment reconstruct the reports. Idle/no-retirement/successful replacement/healthy-peer neighbors distinguish their boundaries. No pending cleanup before adapter entry is claimed; callback cleanup at loading is synchronous. |
| 005 path and observations | Real Collection, observer, pooled view, Effect and React entry points run. Start counts, exact errors, handles, raw callback/count traces, rows, promise identity and resource leases reach immediate and settled assertions. Row projection omits unrelated virtual fields but retains full promised id/value fields. |
| 006 calibration | Original and mutant outcomes are classified above. Clean kills are assertion failures. Timeouts, invalid comparisons, missing selection and type errors supply no sensitivity credit. |
| 007 campaigns/replay | No important generated property added or altered. Existing observer and lifecycle fixed/random campaigns remain green with unchanged generators, recorder, budget and replay interface. Finite cases run directly through the listed test paths. |
| 008 minimal state | No new reference state. New source states project idle render deferral; explicit demand must erase its work distinction. The token model needs only retirement point and cleanup to predict counts and adapter entry. Distinguishing loading from ready is necessary because cleanup can prevent adapter entry only at loading. |
| 009 vocabulary | Canonical sync run, cleanup start, settlement, deferred acquisition, subscription and acquiring ownership remain distinct. The token-count judgment abstracts one logical owner's transfer and release, not production acquisition states. |
| 010 failure fidelity | New observer and cleanup checks use the existing primary/secondary cleanup aggregator. Pool and retirement fixtures resolve controlled gates and remove reentry callbacks before deterministic cleanup. No failure erasure or shrinking claim is made. |
| 011 second formulation | No concrete shared semantic fault requiring another formulation was identified. Terminal dependent policy is independently authorized by the user's decision and glossary, not inferred from the model. |
| 012 evidence | This versioned appendix records every applicable outcome and nonapplicable trigger, exact source identities, calibration and finite limits. This is self-review. |
| 013 boundary neighbors | Held cleanup versus post-settlement admission, logical versus acquiring demand, idle versus render-deferred source, failed validation versus actual replacement, retirement versus live owner, and failed late seed versus healthy peer all change asserted observations. |
| 014 receiving handoff | Real React abandoned Suspense resumption reuses the shared core judgment. The streaming React witness receives on-demand render deferral, starts acquisition before stream settlement and checks server/browser snapshot handoff. No actual remote-provider shutdown or other-framework schedule claim follows. |

The eight-item implementation and bounded oracle repair are complete. Whole-PR
readiness remains separate: F02 still needs an initial-snapshot policy and F07
still needs the reported failing application fixture. Earlier browser E2E runs
failed in dependency setup rather than demonstrating an assertion failure.
A new CI run does not erase those independent limits.

Final evaluated source identities (SHA-256), based on reviewed HEAD
`16824f6778bc3feb21c67d4f865c4f444e11f2e4` plus this follow-up:

| File | SHA-256 |
| --- | --- |
| `packages/db/mangle-cache.json` | `d16ffa42f01a034ee4786bc6b12e26b8b00d0e474c5ae94b8e2fa2e97883e27e` |
| `packages/db/src/collection/changes.ts` | `64e0b1d507dc9390a87c1db907bb178998f971910957ebe18a4d9565398f4433` |
| `packages/db/src/collection/lifecycle.ts` | `19025f597061032ad0dfd1fe394e6fa873af473d3b67698cfdb2e6ecb0d1ffef` |
| `packages/db/src/collection/subscription.ts` | `40d0d093671dcab5464614820de7799883577bf22a754922e29ba54f4fa3730d` |
| `packages/db/src/live-query-observer.ts` | `e212d8b1d10ed334c8268e7125a74f3de32ce7ca81c14627a3003e5c31a4b023` |
| `packages/db/src/live-query-options.ts` | `e6117272c8dfbc5d4c0636a2c3ff760a6db6b99e42e0edf8b10e36529e7a2dbf` |
| `packages/db/src/query/pooled-live-query.ts` | `2d247b2b14e9b8cc9a96e054d1b5dd4bb632b5a392086594c023263c8f98fc3e` |
| `packages/db/tests/collection-cleanup-restart-oracle.test.ts` | `65b3b32f54bc1ecaa61e62a2754142c7f5cf25ef1917df7ac14177342d094a20` |
| `packages/db/tests/collection-subscription-lifecycle-grammar-oracle.ts` | `e8144f0517fb21d55b66b3c0e63b2e628df6cc4ebda4edc8825adb384e8bf46b` |
| `packages/db/tests/collection-subscription-lifecycle-oracle.test.ts` | `f43e492ede9e000bf5c8a82687001d8b9a4c0b74c960a4022ef4708216b0dc9d` |
| `packages/db/tests/db-client.test.ts` | `e9aecb15f4bf1b29d07fb010ad6f79cc8eb379ba70b232d517f56c39b0836908` |
| `packages/db/tests/live-query-deferred-acquisition-oracle.test.ts` | `7df15face42f44bff73f7eab3e05a62c802650de9d671eedacfb1421bb9551b6` |
| `packages/db/tests/live-query-observer-history-oracle.property.test.ts` | `66a4803dd813967874f02db368595cca57cc4887208699247225ca25a27e938b` |
| `packages/db/tests/query/pooled-live-query-gc-oracle.test.ts` | `5eba86cb508775f885a9c13ec17253d04256f857002664bdeedfbce685426f89` |
| `packages/react-db/tests/descriptor-query-binding-oracle.test.tsx` | `101b8030b4d5e2ee4a090dca940c9708344fa2bdbd482ca94065969ef41478ab` |
| `packages/react-db/tests/useLiveSuspenseQuery.test.tsx` | `7d0ace536f2a4a8b6a5ccf124463ddf68cdb53ff390058a556fce3e6363bb136` |

## Current-head summary: cleanup during ownership transfer

CodeRabbit's summary at `da37bc9bbafbed4b2cc901adcbad9181b0aeb93d` reported no
actionable comments, but said: “The deferred-resumption cleanup edge case is
unresolved but has no established user impact.” It then paused automatic
reviews. This concern required an experiment without an inline finding.
The previous appendix's closeout is historical and does not cover this new
counterexample. The earlier eight-item ledger remains unchanged.

### Law, experiment, and repair

A returned acquiring subscription remains demand after cleanup. Explicit restart
must serve it. A still-deferred subscription contributes no acquisition.
Cleanup during admission retires that start. Admission must not start another
run unless a caller explicitly requested one. Authority comes from the primary
owner's surviving-subscriber contract, cleanup start, and shared startup judgment.

Eight probes varied plain/live-query Collection, eager/on-demand source and
cleanup from loading/ready callbacks during resumption. Two on-demand live
queries remained loading after explicit restart with one acquiring subscriber.
Removing the target render gate exposed a neighbor: first-demand notification
could clean up the query, after which admission started it again. These are
concrete consequences absent from the summary.

The old surviving-subscriber grammar cleaned up after admission settled. The
retirement grammar unsubscribed at the interruption. Neither represented a
surviving owner whose transfer was still in progress. The primary deferred-
acquisition owner now adds 192 finite histories: two modes, two shapes, one/two
levels, ordinary/resumed/deferred readers, render gate present/absent, source
loading/ready cleanup, and explicit restart later/from terminal publication.

The independent judgment counts returned acquiring handles as next-run demand.
A deferred handle contributes none. Eager local rows can establish readiness
without acquisition. The driver reaches cleanup through real status callbacks.
It compares the complete target status trace after cleanup starts, ownership
and absence of implicit restart, then acquisition, readiness and rows after
explicit restart. Two-level histories permit an inner query's earlier accepted
acquisition to remain useful. They require acquisition to exist, without forcing
an unnecessary new physical attempt for each outer restart.

The first draft incorrectly required that additional attempt. Its assertion
was corrected before production changed. The corrected original implementation
fails 44 histories at unintended-restart or replacement-progress assertions.
Keeping ownership retention while removing the sync-run guard fails 16
unintended-restart assertions. Both runs have no type errors. Evidence:
`review-da37-surviving-red-original.log` and
`review-da37-surviving-red-no-generation-guard.log` in the existing scratch root.
The earlier draft total is not calibration evidence. Mutants restore source
bytes in finally and verify identity.

The repair uses the existing sync-run generation to fence admission after a
first-demand callback cleans up. Current acquiring ownership also contributes
to the demand judgment. Ownership commitment restores a demand mark cleared
during startup cleanup, including an explicit cleanup-listener restart.
Retired owners do not commit that notification. Ordinary admission includes
its fallible ownership notification in rollback, preserving the setup error if
a release listener throws too. Rollback removes the pending owner's count,
without resetting a total that could erase a reentrant peer. No stored lifecycle
state, retry queue or recovery lifecycle was added.

The same 53-file core selection passes **2,776 tests**. The full 22-file React
selection passes **457 tests**. Both report no type errors or unhandled errors.
Scoped ESLint has zero errors. The production bundle is **+138 gzip / +191
brotli bytes** against merge-base `205ab7158`; React is unchanged. This adds
36 gzip / 20 brotli bytes beyond `da37bc9bb`. Additional source weight is
production +23/-6 and tests +112/-0, with documentation separate. Evidence logs:
`review-da37-core-green.log`, `review-da37-react-green.log`,
`review-da37-lint.log`, and `review-da37-size.log`.

| Item | Technical judgment | Action and durable value |
| --- | --- | --- |
| CR3-01: unresolved resumption/cleanup edge, without established impact | Plausible concern. Same-path probes establish stalled replacement and unintended restart. Concrete diagnoses are S03/S04 below. | `fixed-now`; primary surviving-owner grammar and ownership-transfer repair. |
| CR3-02: docstring score 16.67%, below the bot's 80% threshold; generate docstrings | Reported default metric, with no named function or missing contract. Neither AGENTS.md nor ESLint imposes that threshold. The summary says no repository configuration applied. The score establishes no repository defect. | `refuted` as a required PR repair. Preserve the metric and documentation idea here. Existing contract prose remains required and was updated. No comments were generated only for the score. |
| CR3-03: no actionable comments, covered head da37, minimal risk, automatic pause | Exact covered commit verified. Risk classification is opinion and does not override F02 or the executed cleanup counterexample. | `duplicate` provenance retained here, without extra correctness authority. |
| S03: startup cleanup loses a surviving acquiring owner's demand | Confirmed on-demand progress failure after explicit restart. | `fixed-now`; current ownership and demand commitment survive the transfer. |
| S04: first-demand cleanup is followed by implicit startup | Confirmed ordering failure with an already-running local query. | `fixed-now`; existing sync-run generation fences admission. |

New-summary accounting: three raw items = one fixed-now + one refuted repository-
requirement claim + one duplicate provenance entry. S03/S04 remain separate
violations. No finding is deferred. Reviewer recommendation for this summary
alone: insufficient evidence for a hire decision. It preserved a useful concern,
but gave no trace and missed the demonstrated consequence.

ORC-001–014: authority, limits, independent handle judgment, literate layers,
real entry points and immediate/settled comparisons are stated above and beside
the grammar. New cases are bounded enumeration, so generated controls and new
campaign/replay interfaces are not triggered (004/007). Existing fixed/random
campaigns remain unchanged and green. No reference state was added (008).
Glossary terms and the existing projection remain unchanged (009). Controlled
teardown removes callbacks before cleanup, with the preceding failure-fidelity
limits (010). No concrete shared semantic fault calls for a second formulation
(011). Original and narrow-mutant assertion failures calibrate both ownership
retention and startup fencing (006/013). This versioned appendix and the source
identities below supply 012. These cases claim controlled core callbacks only,
so no additional real-provider/framework handoff is claimed (014). The React
run is compatibility evidence, not a receiving witness for this new premise.

The law is encoded and asserted across the stated 192 histories, including
no-acquisition and explicit-listener-restart neighbors. No counterexample remains
within this declared boundary. Arbitrary recursive cleanup, asynchronous
provider work before acquisition and other framework schedules remain outside
these finite histories. The primary owner's coverage-map entry retains those
wider witnesses. No universal history or provider-shutdown proof is claimed.

Source identities for this follow-up on `da37bc9bb` (SHA-256):

| File | SHA-256 |
| --- | --- |
| `packages/db/src/collection/changes.ts` | `4d0849637a03e8012ee965191d9ed9332957e0bdf07b19d25d4deb0e400e9d34` |
| `packages/db/tests/live-query-deferred-acquisition-oracle.test.ts` | `0198add12e3c185aaa70a378bdfe115632686f864a178a42cbaa934809d387bd` |


## Final-head CI: subscription-specific replay classification

Core shard 1 at `e852b0accf9971f61348066277290b010a7b016e` found CI-01 in
`replay.ordered-window-faults`: seed `-1751969525`, shrink path
`67:11:10:12:1:8:7:7`. The five-action reduction holds work, moves row 1 to
rank 1, truncates markers, then settles one request successfully and one with
failure. The query is ascending, offset zero, limit one, with an anti-join,
on-demand markers and an inline include. No peer participates.

### Law and competing accounts

A failed ordinary lazy demand is terminal. A failed truncate replay retains the
last complete publication until a later authoritative replay succeeds. Authority
is the architecture's demand, replay and publication contracts and this owner's
stated terminal-error law. Those contracts apply to each subscription's demand;
a shared source's replay does not classify every other subscription's load.

The existing grammar already generated the case. Its source-wide
`markerReplaying` flag mistook a new include subscription's first request for
renewal of an older demand. The real adapter diagnostic reaches a new lexical
subscription without a replay hold. Its ordinary request fails and the query
correctly enters terminal error. The oracle rejected that allowed result.
The same exact seed fails with all six changed production files restored to
`16824f67`, so this classifier defect predates the eight-item repairs.

An initial hypothesis blamed production's lazy-demand failure path. A guard
experiment did not repair the failure and was removed. It supplies no GREEN
credit. A trial that inspected a nonpublic Collection property could not
classify provider ownership and was also discarded. A test-name selection that
matched zero tests supplies no evidence. Final evidence below uses only adapter
inputs, recorded lease ownership, semantic predicates and public query status.

### Model, observations and calibration

Before truncate, the adapter records its held leases. A new acquisition renews
one captured lease only when its subscription token and independently evaluated
key predicate match. Each lease is consumed once. A new owner or different keys
remain ordinary demand even during another owner's replay. Separate source and
marker snapshots retain the provider boundary; a WeakSet records which adapter
received each options object. The five-key grammar makes predicate membership a
complete finite demand projection here. No production replay classifier or
private state computes the expected result.

Terminal-error assertions now run after each history action, before final
recovery, as well as at convergence. The named CI reduction requires terminal
error. A settled joined-demand replay neighbor requires nonterminal recovery.
Existing fixed and random campaigns use the unchanged generators and 300-run
budget. The direct seed/path replay still runs without a normal campaign.

| Experiment | Result | Log in existing scratch root |
| --- | --- | --- |
| Original final-head seed replay | One convergence assertion fails; 23 controls pass | final-db1-replay-current.log |
| Reviewed-head production replay | Same convergence assertion fails; 23 controls pass; all six files byte-restored | final-db1-replay-16824.log |
| Added intermediate cut and pinned reduction, old classifier | Two terminal-error assertions fail; 23 controls pass | final-db1-expanded-red.log |
| Subscription-specific classifier, direct replay | 26 tests pass, no type errors | final-db1-classifier-second.log |
| Owner-blind classifier mutant | New-include assertion fails, replay neighbor passes; no type or setup error | final-db1-mutant-owner-blind.log |
| Production mutant makes every subset error terminal | Replay-neighbor assertion fails, ordinary-failure neighbor passes; no type or setup error | final-db1-mutant-fatal-replay.log |
| Final surrounding selection | Three files, 962 tests pass; includes both normal campaigns; no type errors | final-db1-classifier-surrounding-final.log |

All mutant source bytes were restored and verified. This correction changes no
production file. The original eight-item dispositions and S01–S04 remain intact.
CI-01 is `fixed-now` as an oracle-classification defect, with the generated
witness, distinguishing neighbors and calibration retained in the primary owner.
No product contract or approved cleanup policy changed.

ORC-001–014: the law and finite projection are stated above and in the owner;
expected classification uses adapter-observed ownership and an independent
predicate evaluator (001–003/009). Existing generated domains, exclusions,
fixed/random parity and replay interface are unchanged; the CI reduction and
settled-demand neighbor supply reconstruction and ablation controls (004/007).
The driver invokes real Collections and checks status at each action and
convergence, with no missing-input hypothesis for this controlled boundary
(005/013). The two assertion failures calibrate owner identity and replay
terminality separately (006). Captured ownership and provider identity are
necessary to distinguish a new demand from renewal of an existing one (008).
Existing cleanup fidelity is unchanged; experimental mutations restore bytes
(010). No additional shared-fault hypothesis calls for a second formulation
(011). This versioned record and source identity supply 012. No provider or
framework handoff claim is made (014).

Limits remain five numeric keys, one-level includes and controlled adapter
schedules. This is self-review. The coverage map names the expanded observation
cuts. F02's initial-snapshot decision and F07's application fixture remain
separate readiness obligations.

Oracle source SHA-256 at this follow-up: `86f652fadc3ddeddfd5188d18b049969293209efdda51641e28ec38122884ea2`.


## Audit against the declared-reach rules from PR #2233

This self-review starts at `38eb2831f6005faa51f4021f0c29dd532c3a6cf4`.
It uses rule proposal `91ee6db4f1e37fffb44ca4432d01e27c63bed45c`, now merged
as `65d9ada508114f199464f753d50eb3447eb0eaf9`. The audit changes tests and
coverage evidence only. It preserves the maintainer's cleanup-rejection decision.
The scratch ledger and raw logs are in `/tmp/tanstack-rule-2233/`.

### Law, experiment and inference

**Law.** An ordinary lazy demand failure is terminal. A settled demand's failed
truncate renewal preserves the last complete publication and permits a later
authoritative replay. Authority is the live-query architecture's demand and
replay-participant rules, publication law 9, and this owner's terminal-error
contract. Subscription identity and immutable predicate membership distinguish
renewal from new demand; sharing a Collection does not establish renewal.

**Reach.** The existing 300-history fixed campaign reached zero failures of new
demand during marker replay and one failed settled renewal. A calibrated random
campaign reached zero of either. Both fail when both states are required.
The old grammar can express the CI counterexample, but its normal budget does
not reliably enforce that interaction. More named examples would not fix this
missing sampling dimension.

The primary replay owner now runs `replay.subscription-demand-origin`: 75 fixed
histories with seed `2233`, then 75 random histories with the same grammar and
judgment. It varies ordinary versus renewal origin, zero to three prior
successful replays, a marked row from 1/3/4/5, and its rank from 1 to 9.
The ordinary branch holds work, moves the row, truncates markers, succeeds one
held request, then fails the next. The renewal branch holds, truncates, and fails
the held renewal. Both use the existing production driver and independent
five-key predicate projection. Actual adapter entry, prior demand, public
readiness and a non-aborted failure establish reach, independently of the
expected terminal status. Named neighbors calibrate the recorder.

The original broad grammar, seed, 300-run budget and replay coordinates remain.
Its seventeen existing required dimensions now count histories, once per state,
instead of events. Both new states require at least one history per campaign.
Explicit seed/path replay skips campaign minima. Public terminal status is
checked after actions and at convergence. A new positive assertion also requires
an observed ordinary failure to become terminal at convergence.

**RED.** `replay-broad-reach-calibrated-red.log` records both broad campaigns
failing their added critical reach requirements on unchanged production.
This is a reach failure, not a product defect. The initial
`replay-reach-original.log` used an uncalibrated new-subscription witness that
missed the named regression. It supplies no reliable zero-reach claim and is
superseded. A new logical demand can use an already-seen subscription token.
The calibrated recorder checks demand renewal rather than token novelty alone.

**GREEN.** `final-owners-green.log` passes 1,006 tests in eight files, with no
type errors. It includes the replay owner, reach helper, subscription lifecycle,
cleanup, deferred acquisition, observer construction/publication, partition
release and DbClient tests. Scoped ESLint passes. Production source is unchanged
in this audit. Earlier full core and React counts remain evidence at their
recorded heads, not new runs against an integrated tree.

Each count below is the number of histories in that normal GREEN run.

| Property / declared state | Fixed | Random |
| --- | ---: | ---: |
| `replay.ordered-window-faults` / `settlementThrows` | 12 | 23 |
| `replay.ordered-window-faults` / `throwsAfterReplay` | 50 | 53 |
| `replay.ordered-window-faults` / `replayStartThrows` | 56 | 64 |
| `replay.ordered-window-faults` / `heldAcrossTruncate` | 26 | 19 |
| `replay.ordered-window-faults` / `failedLoads` | 9 | 6 |
| `replay.ordered-window-faults` / `settledWindowChecks` | 246 | 238 |
| `replay.ordered-window-faults` / `tiedWindows` | 15 | 13 |
| `replay.ordered-window-faults` / `peerChecks` | 127 | 107 |
| `replay.ordered-window-faults` / `windowMoves` | 92 | 86 |
| `replay.ordered-window-faults` / `descendingRuns` | 139 | 149 |
| `replay.ordered-window-faults` / `joinedRuns` | 225 | 238 |
| `replay.ordered-window-faults` / `includeChecks` | 152 | 149 |
| `replay.ordered-window-faults` / `markChanges` | 87 | 79 |
| `replay.ordered-window-faults` / `antiJoinedRuns` | 76 | 87 |
| `replay.ordered-window-faults` / `innerJoinedRuns` | 81 | 74 |
| `replay.ordered-window-faults` / `markerLoads` | 132 | 120 |
| `replay.ordered-window-faults` / `markerTruncates` | 80 | 71 |
| `replay.subscription-demand-origin` / `new-demand-failed-during-marker-replay` | 9 | 10 |
| `replay.subscription-demand-origin` / `settled-marker-demand-replay-failed` | 32 | 38 |

**Mutant.** The generated focused campaigns reject all four semantic controls
at assertions, with no setup, timeout or type failure:

| Exact semantic edit | Distinguishing assertion | Evidence log |
| --- | --- | --- |
| Classify marker loads from the source-wide synchronous truncate flag | Illegal terminal error after ordinary demand is mislabeled renewal | `replay-mutant-source-wide.log` |
| Remove subscription identity from the captured-demand match, retaining predicates | Same illegal terminal classification | `replay-mutant-no-subscription.log` |
| Make `recordSubsetError` terminal regardless of `fatalBeforeReady` | Settled renewal must remain nonterminal | `replay-mutant-fatal-renewal.log` |
| Remove `failDemand`'s terminal transition | Ordinary failure must be terminal: zero observed versus one required | `replay-mutant-ignore-ordinary-failure.log` |

The first control shrinks at seed `2233`, path `1:0`, to ordinary origin, zero
previous replays, row 1 and rank 1. Direct replay rejects that mutant and passes
after byte restoration (`replay-direct-mutant-red.log`,
`replay-direct-green.log`). The all-terminal control shrinks at the same seed,
path `2:1:1:1`, to renewal with zero previous replays. Removing the rank move
from the grammar leaves ordinary-demand reach at zero and fails both campaign
minima (`replay-mutant-no-rank-move.log`). All mutated files were restored in
`finally`, with byte identity verified. The new positive assertion was added
before its ignored-failure production mutant ran.

**Limits.** Five numeric keys, one-level inline includes, one live query in the
focused grammar, ascending offset-zero limit-one windows and controlled adapter
settlement. The unchanged broad grammar covers other window/order/peer forms.
Neither property proves arbitrary predicates, actual provider cancellation,
unbounded replay histories or framework scheduling. The coverage map names the
same primary owner and these remaining receiving boundaries.

### Audit of the seven shortcuts

| Obligation | Result and remaining qualification |
| --- | --- |
| A01 production-first | No new production repair in this pass. Earlier entries retain their recorded finite-oracle REDs and original/narrow-mutant evidence. The new generated reach was added after those historical product commits. It cannot establish historical generated-oracle-first chronology. Under a literal requirement for generated RED before every historical repair, that chronology remains a deviation. A retrospective run cannot erase it. |
| A02 model authority | No reference semantics changed in this pass. Earlier rejection, explicit-restart and terminal-Effect rules follow the approved cleanup decision. The stream-preload expectation follows demand law 15, while server rows remain protected until local acquisition settles. Replay classification follows captured logical demand, not observed terminal output. F02's competing snapshot policies remain undecided. |
| A03 unmeasured reach | Confirmed gap in the normal replay campaigns, repaired with a focused process grammar, mandatory minima and reported history counts. Broad publication campaigns in other owners remain compatibility evidence only for the new construction cuts. |
| A04 quiet exclusions | No comparison was relaxed. Existing broad aborted-move and terminal-error reach exceptions remain explicit, with named witnesses. The new property requires the two terminality premises. The deferred owner's unchecked status/rows apply only while no live-query sync run exists, not after an owed ready result. Changed cancellation fixtures retain queued-load and release assertions. No new product exclusion or retired promise was introduced. |
| A05 pinned-only coverage | Replay terminality needed a focused generated interaction and now has one. The other review repairs use bounded enumerations: admission/status/mode, six promise outcomes, 28 retirement forms, 192 interrupted ownership transfers, eight observer construction forms plus two healthy-peer seed cases, twelve partition forms plus two startup cases, and twelve late-Effect receiving cases. Those are finite boundary matrices with original or hostile controls. They do not claim arbitrary generated construction histories. The deferred owner now calls its eleven command histories finite. |
| A06 older counterexamples | F02 remains a demonstrated warm-source SSR mismatch with a real hydrateRoot trace and a pending initial-snapshot decision. Its descriptor receiving owner and missing witnesses remain in the coverage map. F07 remains an unconfirmed Date typing report whose reliable strict compiler probe passes. It needs the failing application assignment and resolved dependency versions. Neither is dismissed because it predates this audit. |
| A07 no failing mutant | Earlier finite owners retain the exact assertion controls documented above. The new generated property rejects source-wide, identity-blind, always-terminal and ignored-ordinary-failure designs, plus grammar ablation. No setup-only failure receives calibration credit. |

These results preserve the eight-item ledger: five fixed-now and three
accepted-design, with S01–S04 separately fixed in their declared finite bounds.
The audit adds a reach-enforcement repair, not another product-policy change.
Whole-PR readiness remains **not ready** because F02 needs a product decision.
F07 remains an evidence gap. Green finite evidence does not resolve either.

### ORC-001–015 result for this repair

Authority, limits and the unchanged independent projection satisfy 001/002.
Prose, grammar, driver and comparison remain beside executable code (003/009).
The shrunk ordinary and renewal histories reconstruct the known witnesses.
Removing rank movement loses the ordinary premise. Rank bounds avoid existing
starting ranks, and the constructive grammar places failure after holding work
rather than requesting failure without a pending request (004). Real Collection
entry points, action cuts and convergence supply 005/013. The four assertion
controls and reach ablation supply 006. Equal fixed/random budgets and the
checked direct replay supply 007. No model state or equivalence class changed
(008). Existing primary/secondary cleanup fidelity remains, and experimental
mutations restore exact bytes (010). No new shared semantic hypothesis calls
for a second formulation (011). This versioned record, starting revision and
source identities supply 012. Controlled-boundary claims require no new
provider handoff (014). Mandatory campaign minima and the table supply 015.

SHA-256 identities for the repaired executable sources:

| File | SHA-256 |
| --- | --- |
| `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts` | `34aec1038062a15957642c35de2fafe2576b2941a326f449c75b6a3b28cb9da1` |
| `packages/db/tests/oracle-config.ts` | `a3464344b04bfdc59bc4ab42489eeea540aed1461f9fb440e2da0f5b0a0b0c46` |
| `packages/db/tests/oracle-reach.ts` | `d38c86d0a2d197d566108cfb59cdd6cb624619df8ab570afa2c7e09b7f00ba63` |


### Integration with merged PR #2233

Oracle repair commit `a39a07d21` was followed by merge commit `e32ac735c`, which
includes `origin/main` at `65d9ada50`. The authoring skill conflict retains both
the oracle-first sequence and the branch's full-source reading requirement.
The review skill retains both sets of instructions as well. Upstream's persisted
readiness extraction merges with the observer ownership repair without a manual
production edit. No branch history was rewritten.

The first combined core command passed 2,808 runtime tests but failed with two
test-source type errors. The filtered dimensions have a narrower union than
`keyof OrderedReach`; the loop had continued to iterate all keys. Iterating the
declared dimensions fixes those errors and removes the unused event aggregation.
This does not alter generated histories, public judgments or reach minima.
`integrated-core.log` is not a clean GREEN result. The final command in
`integrated-core-fixed.log` passes all 2,808 tests in 55 files, including type
checks, with no unhandled errors. The smaller earlier selection did not expose
these test-source diagnostics.

The merged React suite passes 458 tests in 23 files. The persistence readiness
owner passes 64 runtime and type tests in two runner entries. Evidence:
`integrated-react.log` and `integrated-persistence.log`. Scoped ESLint,
Prettier, `git diff --check`, and the 418-name mangle-cache check pass.
The complete repository command remains unrun.

The source-wide, identity-blind and always-terminal mutants again fail both
focused campaigns at the terminal-status assertion on the combined tree.
Removing rank movement again fails reach. Ignoring ordinary failure again fails
the positive terminality assertion. The `integrated-replay-*.log` files preserve
these runs. Every production and test mutation was restored before the final
checks. The direct seed/path replay passes all 26 selected tests
(`integrated-direct-green.log`).

Final normal core-run history counts follow. Fixed seeds and budgets are
unchanged, and the minimum is one history for each declared state.

| Property / declared state | Fixed | Random |
| --- | ---: | ---: |
| `replay.ordered-window-faults` / `settlementThrows` | 12 | 22 |
| `replay.ordered-window-faults` / `throwsAfterReplay` | 50 | 46 |
| `replay.ordered-window-faults` / `replayStartThrows` | 56 | 55 |
| `replay.ordered-window-faults` / `heldAcrossTruncate` | 26 | 14 |
| `replay.ordered-window-faults` / `failedLoads` | 9 | 12 |
| `replay.ordered-window-faults` / `settledWindowChecks` | 246 | 245 |
| `replay.ordered-window-faults` / `tiedWindows` | 15 | 13 |
| `replay.ordered-window-faults` / `peerChecks` | 127 | 120 |
| `replay.ordered-window-faults` / `windowMoves` | 92 | 88 |
| `replay.ordered-window-faults` / `descendingRuns` | 139 | 141 |
| `replay.ordered-window-faults` / `joinedRuns` | 225 | 230 |
| `replay.ordered-window-faults` / `includeChecks` | 152 | 131 |
| `replay.ordered-window-faults` / `markChanges` | 87 | 83 |
| `replay.ordered-window-faults` / `antiJoinedRuns` | 76 | 70 |
| `replay.ordered-window-faults` / `innerJoinedRuns` | 81 | 77 |
| `replay.ordered-window-faults` / `markerLoads` | 132 | 138 |
| `replay.ordered-window-faults` / `markerTruncates` | 80 | 80 |
| `replay.subscription-demand-origin` / `new-demand-failed-during-marker-replay` | 9 | 9 |
| `replay.subscription-demand-origin` / `settled-marker-demand-replay-failed` | 32 | 40 |

Against merged main `65d9ada50`, `pnpm size:compare --packages db,react-db --files`
reports db +139 gzip / +238 brotli bytes and React unchanged. Tree-shaken app
scenarios range from +136 to +148 gzip bytes. This is the existing production
repair's cost on the integrated baseline. The declared-reach audit adds zero
production source lines or shipped bytes. `integrated-size-final.log` records
the final matching-source cached comparison. Earlier bundle figures remain tied
to their original bases.

Final repaired replay-owner SHA-256:
`7b47e515ce94ec26f60fd78b400ddb2ea104abd9eb3bd8978a098c5efd7662e8`.
The six-part evidence block and the stated finite limits above still apply.
The historical generated-RED chronology deviation, F02 decision and F07 evidence
gap remain visible. Integration GREEN does not turn this into a ready verdict.
