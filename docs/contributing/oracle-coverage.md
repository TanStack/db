# Oracle coverage and closeout

Use [Oracle Testing Rubric](oracle-rubric.md) when adding or reviewing a
law. This map identifies existing owners, their judgment, and their limits. It
is not a claim that every state or every test has been audited.

The [project glossary](glossary.md) owns terms shared by these executable
models and their production subsystems. A coverage owner may define narrower
local terms, but it must not silently rename a production concept.

The [2026-10-10 owner-overlap review](oracle-reviews/2026-10-10-owner-overlap-audit.md)
distinguishes canonical laws from their receiving witnesses across packages.

## Scope of the oracle repair project

[Issue #1808](https://github.com/TanStack/db/issues/1808) commissioned a bounded
portfolio audit and repair. The September 11 inventory contained 329 tracked
paths: 132 selected/support entries and 197 discovery-tier files. The latter
received routing recommendations, not 197 full semantic reviews. Focused
examples, type tests, and host-wiring tests remain useful; converting them all
to generated tests is not a completion criterion.

## Literate model audit

The literate-model pass audits every primary executable owner in
[Find an owner](#find-an-owner) and every repository file explicitly named
`oracle` or `property`. Derive that strict inventory from the repository rather
than copying a count into this document:

```sh
git ls-files -co --exclude-standard packages \
  | rg '/[^/]*(oracle|property)[^/]*$' \
  | sort -u
```

The command includes tracked and untracked package files so an in-progress
audit cannot hide a new owner. A surface is complete only when each primary
owner states its contract, model, history grammar, production driver, and
refinement check—including its public observations and checkpoint—in the
executable file. Focused regressions outside that inventory may remain short,
but a file named `oracle` or `property` cannot use that allowance to omit the
literate structure.

The pass must not change product behavior. If clearer prose exposes a missing
model rule or assertion, strengthen the oracle and run it against unchanged
production first. Track any production failure as separate follow-up work.

The same pass audits vocabulary. Shared concepts use the production names in
the project glossary. The audit corrected model prose that collapsed a physical
acquisition into a request or called an acquisition lease merely a lease.
Model-only terms such as an appointment ledger or fault tape remain local and
say what production facts they abstract. This is a semantic review, not a rule
that test identifiers must copy production's private data structures.

| Surface                                  | Status                                                         | Completed or next owner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordered relations and BTree              | Complete                                                       | The signed top-K relation, BTree/Map refinement model, and DBSP incrementalization laws are literate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D2 operator work                         | `packages/db-ivm/tests/d2-work-oracle.test.ts`                 | A finalized 65-branch graph receives one direct input at the first, middle, or last branch, then a second input on a different branch. The oracle compares exact forwarded messages and operator invocations after each `run()`: branches without queued input perform no operator work. A connected reversed-registration pair must drain in the same run, and an empty unfinalized graph rejects. The old unconditional loop fails with 64 idle calls per turn. This bounded work check does not establish elapsed latency, fused operators, arbitrary graph topologies, or provider-level live-query work.                                      |
| Includes and publication                 | Complete, [facade rollback](https://github.com/TanStack/db/blob/main/packages/db/tests/query/bucket-facade-rollback-oracle.property.test.ts) ([review](oracle-reviews/perf-lazy-bucket-rollback-copy.md)) | The central recomputation model plus cross-formulation, temporal demand, layered publication, Collection facade lifecycle and space bounds, route-context transport, functional projection, query-shape, optimistic, and source-work owners are literate. They keep the architecture document as their contract source. A failed facade flush restores every facade it wrote, disposes the facades it created, publishes no event or layout revision, and reads the stored rows of no other facade; nested facades across two edges have a pinned witness. The grammar adds optimistic facade inserts and optimistic deletes of shown graph rows; a retired facade must show exactly its visible optimistic rows, and every history ends by settling them and comparing all rows again. A facade commit that throws before committing is generated, and the restore must commit the open sync transaction. Every change pending at a failed root commit, child rows included, stays pending, and the next flush publishes it once. Open: the flush's edge and bucket map copy is unmeasured bookkeeping; disposal between a flush and its rollback has pinned witnesses only; held facade commits are generated one hold at a time for up to three flushes, and a release that covered earlier flushes checks rows only; the grammar also cleans up a shown facade from outside, lets optimistic rows share graph ids and later rolls them back, after which those keys are compared by value; a holder's cleanup of a shown facade rejects (code 241) and the facade keeps receiving the graph's writes; retiring a shown bucket without the graph's retractions is generated (`contradict`) and throws code 240; optimistic deletes and updates of shown graph rows are generated, and an update's copy keeps the row's key; a facade that `resolve()` created before activation can stay ready and empty after a failed flush (recorded limit). |
| Collection lifecycle                     | Complete                                                       | The shared logical-owner/acquisition-attempt/sync-run grammar plus mutation admission, lifecycle trace, publication, replay, disposal, and transaction-refinement boundaries are literate.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Paced mutations                          | Partial                                                        | The core virtual-clock owner checks strategy timing, admission, cleanup, and settlement. The React render-cut owner checks committed callback ownership across suspended and committed transitions, descendant layout effects, and StrictMode while preserving mutate identity. Callback affinity to transaction admission, other frameworks, new debounce/throttle admission after cleanup, failed persistence, and broader generated schedules remain open. |
| Optimistic state                         | Complete                                                       | The independent base/intent/source-queue graph plus outcome, transaction-payload, and publication drivers are literate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Drafts and native values                 | Complete                                                       | Native differential behavior, draft change tracking, detachment and its class-instance exception, hostile keys, aliases, cycles, and Map/Set live iteration are literate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Query DB and observer                    | Complete                                                       | Query-scope row ownership, subset identity and cancellation, failure and recovery, and the per-listener eligibility ledger are literate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Query DB SSR dehydration                 | Fixed QueryClient/Seroval boundary                             | Successful on-demand entries with a compound predicate, a request signal, and an ordered cursor with a custom comparator retain their row and user metadata through Seroval's reconstructed stream payload and Query Core hydration; request options are absent from the stream, while query functions retain the original values. The TanStack Start router and browser Collection resume path still need a host witness.                                                                                                                                                                                                                         |
| Ordered acquisition                      | Complete                                                       | Exact demand identity, applied settlement, independent pagination recomputation, request work, lifecycle products, replay authority, source-generation readiness, and transaction-refinement abort boundaries are literate. An initial full-source ordered load shares the synchronous readiness cut ([historical review](oracle-reviews/initial-full-source-sync-readiness.md)). The ordered-lifecycle oracle covers an inexpressible-boundary fallback before first publication when every acquisition returns literal `true`. It also checks a later null-boundary fallback after the first joined window publishes, across literal, Promise, and held-receipt responses, including a held receipt after child demand settles ([review](oracle-reviews/issue-2152-initial-ordered-fallback.md)). The ordered loader state oracle also has a generated request-authority lane (`ordered-loader.request-authority`, fixed and random campaigns). It drives the real loader over a fake subscription through settlements in any order, failures, deferred invalidation and report reactions, ordinary passes and window moves, and began with four laws from a TLA+ model (#2191): a successful repair keeps its acquisitions until a covering read succeeds; quiet loading holds nothing older than its last authoritative read; a superseded request's failure is recovered by a full-source read without an explicit retry; and once quiet, an invalidation and a pass issue a read unless a full-source read covers the source. Scenarios also throw from the first release callback, answer a repair synchronously from installed rows, and let a page's own delivery invalidate ordering; named replays keep the traces they found, each of which failed on main (a throwing release that unwound a resumed repair, a synchronous repair waiting behind a superseded request, and a self-invalidating page whose tie was never retired). On main it found a superseded tie that failed after its repair finished and a newer invalidation's reaction was deferred, which left refills blocked; a named replay keeps that trace. A stale prefix that retires the repair's prefix fails the held law, and a stale request held after the repair finished fails the leak law. The lane also crosses unexpressible boundaries, joined work that defers loading, truncate replay that succeeds or stays pending, optimistic departures, source deletes, the bounded backoff retry, window moves that shrink or widen, plans that read only the full source, and reports inside the loader's own first page. A replay owns the requests issued before its truncate, and when the subscription still holds a full-source lease the settled replay covers the source. These dimensions found three more defects, each kept as a named replay: a repair prefix that settled after a replay started its replacement took the replacement's chain tag and was never retired; a replay counted a full-source read as complete after an explicit retry had released it; and a failure from before a truncate dropped the next repair's staged step. Each of the seven defect replays fails on the loader at the branch's merge base with main. A later law, one request at a time, found that a replaced repair chain's prefix still counted as current and issued a tie beside the replacement's prefix; a chain is now superseded by any newer authority start. The failed-lease law also counts a covering replay, which a named replay reaches. Repeated random campaigns then found a repair request that settled after full-source coverage and stayed held; full coverage now retires it. The held law counts a later prefix that a successful replay reacquired while it was in flight. Four histories from TCP's known error classes followed: a request the provider never answers (a lost segment), a release callback that truncates synchronously (a reentrant reset), a window offset other than zero, and an at-most-once release law with no release while a replay owns the demand unless an explicit retry replaces it or a held full-source lease covers it. They found that the backoff retry's release pass kept releasing failed demands after a release started a truncate; every release pass now stops on a reentrant reset. The oracle now observes epoch moves as calls to `invalidateSourceOrdering()`, so it tells a replacement chain from a chain step exactly. The loader's work slot and debt now move only through a transition table that throws `OrderedLoaderInvariantError` on an illegal move or an incoherent work and debt pair; the oracle records any such error as a broken law, so its generated histories fuzz the table. A covering-lease law (a full-source lease whose read succeeded or whose demand a replay reacquired is never released) found that a full-source transport failing after a covering replay turned complete coverage into an own failure; the table then found that a repair request failing after a replay finished its chain did the same. Mutants that drop each new guard fail. A release callback that runs an ordinary pass synchronously, as a graph run does when the release delivers deletes outside a transaction, found that the pass issued a page while another request was settling, and that request then issued its tie; every release pass now blocks refinement until it unwinds. A dispose command and a release callback that disposes the loader check that a disposed loader issues and releases nothing; mutants that drop the loader's own `active` checks in the release pass and in failure handling survive because dispose resets the cursor, so those checks were removed. TLA+ run 3 (`LoaderTable.tla`) models the table with truncate and replay; its safe rules pass with 9,368,122 distinct states, and each of the four guards from this round, removed alone, produces a counterexample. Reverting any one fix fails its replay and a campaign. The generated histories also stack a second truncate on a pending replay and truncate after a failed replay, each with a reach witness. A lease missing from its map during a release pass is now an invariant violation; no history reaches it. A second high review found that a covering replay did not retire a superseded failed lease from before its truncate, because the failed-lease law exempted every replay-owned request. The law now judges a superseded failure that was live (it failed in the incarnation it was issued in) once a covering replay settles after it, and the replay retires those leases. The subscriber now schedules the replay's graph run in a finally. The replay-refinement oracle is the receiving witness: its generated ordered section (`replay.ordered-window-faults`) drives a real on-demand Collection and an ordered live query through rank moves, held and failed loads, truncates, and unloads that throw without a truncate, while a replay starts, and while it settles. Its settled-window law found that a release throwing after a successful ordered load left the window on old rows, because the builder counted the rejected participant as a failed load (also on main); the loader now marks release errors and the builder publishes. It also fails without the subscriber's finally. The section now also crosses tied ranks (its law compares the window's rank sequence and each shown row's current rank), a peer live query on the same source, offset 1, descending order, and explicit window moves; a move that rejects after a failed source recovery leaves the window, and one rejected only by a release failure still moves. A reported-faults law accepts injected faults as rejected loads, thrown releases, rejected moves, or errors the subscription rethrows from a microtask, and rejects any other escaped error. These found that a window move whose load succeeded was recorded as failed when a release threw, so the window stayed private until another move. A throwing release is an adapter bug, so the loader now reports it uncaught from a microtask and changes nothing else; the reported-faults law rejects a move that a release failure rejects, and the request-authority oracle requires each throwing release to be reported uncaught exactly once (a mutant that swallows the error fails). It also crosses a joined marker source: a LEFT join that keeps marked or unmarked rows, and an inner join. The marker source is eager or on-demand, with marker loads that are held, fail, and truncate. This found that an on-demand joined source whose loads finished without delivering a row left the window on old rows, because nothing ran the graph that the pending joined work held; the subscriber now runs it when a joined source becomes ready. A move whose load a truncate aborts may reject with an `AbortError` and leaves the window; a named replay reaches that branch. Recovery truncates the marker source too, because a failed marker replay keeps the last complete publication until that source replays. A hostile-mutant pass over the loader's guards found guards that no ordered oracle kills. A differential instrument then ran 3,000 generated request-authority histories through the loader and each mutant and compared every request's shape, outcome, and release. Three guards the code makes redundant are deleted: the backoff timer guard, the explicit-move check in the retry callback, and the `requiresFullSource` check on a report. An ignored-report law now kills two of the mutants that changed public requests: a report issues no authoritative request before any request settled (a request in flight still owes an exact result for its own options) or while the window is inside the loader's own first prefix. Named replays reach both, and the random campaigns judge them in quiet histories. One mutant still changes requests without a law: dropping the optimistic-refill flag turns a refill into a refetching prefix. Six more are equivalent in the fake but stay, because the fake cannot reach their premise or they encode a documented rule: the own-first-page check behind a held sync transaction (the fake never holds one), a truncate moving complete coverage back to held, clearing the pending request when a full-source read starts (the fake never answers a full-source read synchronously), staging a joined `more` continuation, the staged-continuation guard before an unindexed prefix, and the drain re-entry guard (a long synchronous chain would otherwise recurse). An include dimension adds a `toArray` child that reads the marker source for each shown row, and an include-children law requires each shown row's markers to equal the model wherever the window law holds; a mutant that never loads newly demanded child keys fails it in an include-only scenario. A newest-move law requires a superseded window move to resolve only after the newest move settles (a superseded move that fails still rejects with its own error), and the model lets the newest move that resolved set the window; it found that a superseded move resolved as soon as its own load settled, so awaiting it showed neither window. The terminal-error law also allows `error` after a load fails while the query is still loading, the documented initial-load failure; a lazy join source is exempt. Limits: includes are one level deep. It also found that a release failure in lazy joined demand during a window move rejected the move, because the subscription reported it as a load error. A window law now lets the newest move win; it found that two moves deferred by a pending source recovery could resume in the opposite order, so the older request replaced the newer window. `setWindow()` now ignores a deferred call that a newer call superseded. A terminal-error law allows a final `error` only after a newly initiated keyed snapshot request, on either side, rejects with an injected load error, or an initial load fails; a new include request can begin during a truncate commit, whereas reacquisition of an established request remains an ordinary nonterminal replay; named replays reach that branch and the aborted-move branch. Core now reports a throwing `unloadSubset` uncaught and fails nothing with it; the subscription lifecycle, replay, Effect disposal, includes-temporal, and subset-error oracles check the uncaught report, once, with the adapter's error. The request-authority oracle now also generates requests that throw while they start, the last history only TLA+ covered, with an error-identity law: a failed request's participant reports that request's own error. It found that a superseded failure whose recovery read threw at its start reported the start error instead (review finding 6). A cost law then checks, after loading is quiet and a bounded repair is available, that one invalidation reads no full source and issues at most one chain per ordering epoch move (in the fake, a prefix, a tie, and a refill); a mutant that always repairs with a full-source read fails it. The replay-refinement section's status law requires a quiet live query and its peer to stay ready when no load failed. Limits: whether a release runs the graph at once or defers it to a transaction belongs to the scheduler, and the oracle generates both forms without checking the scheduler's choice; the fake's rows do not move except for the unexpressible boundary; publication holds stay with other tests; the laws do not judge requests issued before a truncate; a hung authoritative request suspends the leak law for its unfinished chain; a recovery start that throws during a superseded failure is rare in the campaigns, so a named replay owns it. |

| Indexed predicate filtering | Complete for bounded dotted-path collision | An independent row filter checks direct predicates and public callback predicates for a dotted scalar field beside a nested path, with and without an index. Selected-field ordering checks the same distinction through `$selected`. |
| WHERE predicate publication | Complete for bounded predicate and sync-transaction grammar | The contract, Kleene reference evaluator, snapshot and change-history grammar, three subscriber consumers plus direct snapshot, and per-commit key-set refinement check are literate. A fixed same-key update checks live-row and direct-subscriber payloads; a focused descriptor boundary checks stored-row prefilter safety. Generated cleanup and restart histories for filtered subscribers remain open. |
| Joined result keys | Complete for bounded two-source key grammar | The contract, nested-loop pair model, delimiter-, number-like, infinite, and `NaN` key grammar, public join driver, and per-checkpoint pair and key-count check are literate. Joins over subqueries, more than two sources, custom `getKey`, and optimistic mutations remain outside this owner. |
| D2 Index storage | Complete for bounded prefix grammar | The contract, plain-`Map` multiset model, prefixed and unprefixed value grammar, `Index` driver, and per-addition `get`/`has` check are literate. Compaction, presence tracking, and structural payloads remain outside this owner. |
| Pooled live queries | Complete for bounded eq-filter grammar | The contract, independent `eq` model, live-query Collection second formulation, sync/optimistic/mount/cleanup-restart grammar, observer driver, and per-step refinement check are literate. On-demand and persisted sources, `DbClient`, Suspense, and every clause beyond `eq` conjuncts keep the live-query Collection. |
| Live-query deferred acquisition | Complete for bounded synchronous grammar | The law, independent model, history grammar over source states, shapes, and depth, real-Collection driver, and per-step refinement check are literate. Pooled views and DbClient stream preloads have their own blocks. The grammar also adds a peer consumer starting the source and a source truncate before the first subscriber; pinned blocks cover a subscriber that outlives cleanup, reads that wait for readiness, and release of two independent descriptor sources when one start fails. Asynchronous sources, several live-query consumers, and general failure histories stay open. |
| Flat-row change tracking | Complete for bounded flat-row grammar | Flat and proxy trackers and an independent change model run the same generated callbacks. Nested values fall back to the proxy, which its own oracles own. |
| Production error messages | `packages/db/tests/production-error-messages-oracle.test.ts` | Every public error class keeps its development message for frozen sample inputs, and its coded production line shows the JSON of each shown input, even for hostile inputs. Every plain `Error`, `TypeError`, `RangeError`, or `AggregateError` site in `packages/db/src` keeps its frozen development template, has a code, and passes each showable interpolated expression or one of its sub-expressions; the TypeScript checker keeps plain objects, such as rows, out of production lines. A projection of an object, such as `Object.keys(handlers)`, is not required. Every `console` call whose argument holds library text is coded, development-only with its text frozen per guarded region, or a development-only decoration of a value. Text that reaches the console through a parameter, such as `setErrorState(message)`, is coded where it is written; the census cannot follow it. `scripts/test-production-errors.mjs` checks that a production bundle drops the full text and every development-only hint, in ESM and CommonJS. Errors built from a caller's value stay outside this owner. |
| Lazy target path identity | Focused compiler boundary | A same-source union/coalesce witness keeps dotted and nested demand paths distinct during target deduplication. |
| Correlated include path identity | Focused public route-context witnesses | One-level and nested includes keep dotted and nested parent paths, including ancestor aliases, distinct. Conditional result paths receive separate routes. Fixed fixtures cover initial reads and selected source updates; other recursive source forms and arbitrary path segments remain outside this witness. |
| Alias scope identity | Generated cross-scope alpha-renaming and finite exact-output refinement | Optimizer copies, wraps, and collapses keep `SourceId`; captured refs retain lexical bindings under ancestor shadowing; ancestor/descendant source declarations need distinct builders while sibling placements may reuse one; public aliases remain visible. The bounded paths and remaining gaps are in the owner row. The [ad5e0108 review](oracle-reviews/issue-2072-alias-shadowing-ad5e0108.md) adds finite self-join, joined-context, and captured whole-row witnesses. The [outer-join follow-up](oracle-reviews/issue-2072-alias-shadowing-outer-joins.md) covers absent RIGHT/FULL sides and captured ancestor join operands. |
| Join equality and cold acquisition | Complete | Independent cold relational recomputation, acquisition evidence, established equality domains, replacements, and scan/index routes are literate. |
| Opaque backend pagination | Complete | The full-relation value model plus opaque token, cache generation, publication, browser acquisition, and live-window integration owners are literate. |
| Electric and TrailBase | Complete | Electric replica and recovery models, installed-SDK HTTP delivery, PostgreSQL serialization, and TrailBase's controlled RecordApi/native-stream lifecycle are literate with their real-provider limits intact. |
| PowerSync | Complete | Patch conservation, effective-update receipts, metadata and falsey changes, declared-view keys, transformed schema output, logging, cleanup, and native SQLite reach are literate. |
| SQLite persistence and native hosts | Complete | Persisted hydration/replay and ownership, shared-handle driver transaction laws, OPFS page and diagnostic state machines, and the 113-law native conformance manifest are literate. Native execution remains distinct from registration and shim evidence. |
| Offline execution | Complete | FIFO retry, scheduler eligibility, leadership replay, transaction settlement, and typed wire serialization are literate. The [interruption settlement oracle](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/interruption-settlement-oracle.property.test.ts) moves one leadership loss, offline change, or disposal across individual microtask turns after one to three commits on disjoint keys, then recovers by regaining leadership, going online, or restarting over the same storage. It requires that no provider call or new outbox admission starts while fenced, that each admitted ID reaches the provider once and in commit order, that a fulfilled commit's row is already gone from storage, that commits settle with their provider outcome after a regain or reconnect, and that the outbox ends empty. A reach check requires interruptions before admission, between admission and the provider call, and after it, for each interruption. Mutants that drop the execution loop's fence, resolve before deletion, drop the admission check, or check admission before awaiting initialization fail it. Open there: shared keys, providers that answer later, and overlapping old and new executors. The settlement oracle's generated FIFO histories draw each transaction as one record (outcome; manual commit, auto-commit with the option set or omitted, or an `OfflineAction`; receipt read or not), use `isPersisted` as an auto-commit's receipt, and require that no failure escapes as an unhandled rejection, also when nobody reads the receipt, and that settlement logs no failure again and writes no debug output. An empty transaction on any commit path may precede each one; its receipt and completion waiter must fulfil without reaching the provider or the outbox. A manual transaction that writes a row and rolls back before it commits may also precede each one; its waiter must reject with an Error that names the rollback. A focused witness rolls a transaction back while it persists, for both provider outcomes: its waiter must wait for the executor and report the executor's outcome. After every transaction settles, a new waiter for each one must reject within a turn rather than hang. An unread receipt still settles with its own outcome when read afterwards, and a caller may register its completion waiter before admission on every path but `OfflineAction`. A focused witness fails the admission outbox write on every commit path and requires the receipt to reject with the storage error, without an unhandled rejection or a repeated log; a failed outbox write stops the executor, so generated histories do not continue past one. Open: the generated failure source is the mutation function only; manual commits always follow their own `mutate()` at once, so a pending manual transaction behind a failing shared-key sibling is not generated; a throwing `mutate()` callback is not generated, because core keeps its transaction pending; a rolled-back-before-commit transaction is generated only on the manual path, with its own key and its waiter registered after `mutate()`, so a secondary rollback of a pending transaction by a failing sibling, whose waiter gets the generic rollback Error, is not generated. |
| Frameworks | Complete | Shared live-query and infinite-query models are literate. Each framework keeps its own realm, ownership, and scheduling driver. |
| Structural values and ordered primitives | Complete | Structural hashing, deep equality, comparison, cursor denotation, index refinement, and query-identity output equivalence are literate. |
| Mixed-kind ordered prefixes | Bounded | Eager BasicIndex and BTreeIndex paths compare ascending and descending direct and live-query windows with an unindexed scan across mixed value kinds and paired source changes. One retained on-demand BTree history checks settled windows after a number/bigint transition, a finite request for a missing row, and a cursor request after index eligibility changes. Other provider paging histories remain open. |
| Boundary refinements | Complete | Cleanup/restart admission, metadata publication, retained state, acquisition cells, D2 source reconciliation, top-K support windows, and nested Query work bounds are literate. |
| Small structures and test mechanics | Complete | SortedMap, cleanup appointments, and guarded replay are literate. |

### Guide-audit boundary handoffs

The cleanup/restart owner checks ordinary subscription admission and deferred
acquisition resumption during held adapter cleanup. Its eighteen cases cross
loading/ready/error status, eager/on-demand sources, and direct, snapshot, or resumed
admission. The three-cut model requires rejection before subscriber ownership
or acquisition, followed by successful explicit admission after cleanup settles.
Twelve Effect receiving cases cross both source modes, all three prior statuses, and
cleanup on the first or second joined source. A late Effect returns disposed,
reports the cleanup once, and retains no subscription or cleanup observer. A
new Effect after settlement is admitted. The original implementation fails all
eighteen admission cases; a guard limited to fresh subscribers misses six
resumption cases. A guard without earlier Effect cleanup observation fails the
twelve receiving cases during construction. The owner covers these controlled
adapter cuts, with cleanup rejection and terminal-listener restart covered by
its existing histories. It does not establish arbitrary concurrent framework
schedules or actual provider shutdown. The [migration feedback review](oracle-reviews/2026-10-22-dbclient-migration-feedback.md)
records the rejection policy and exact calibration.

The eight-item follow-up at reviewed head `16824f677` extends the same owners.
The cleanup/restart owner adds six plain/live-query logical-demand cases at
idle, ready, and cleaned-up cleanup start, plus six admission outcomes that
distinguish a pending cleanup promise from an actual replacement sync run.
The deferred-acquisition owner adds render-deferred eager/on-demand sources and
explicit deferred subscription/resumption histories across both query shapes
and one/two live-query levels. The React descriptor driver receives resumption
after a real abandoned suspended render through the existing startup judgment.
The observer-history owner adds eight failed-setup histories, with both modes,
one/two failures, cleanup rejection or real sync-start failure. Client, status,
and layout leases are checked immediately, then retry, publication and release.
Two late-listener seed failures retain a healthy peer and exclude the failed
listener from later publications. Eight stream-preload histories cross pending
or successful streams, both source modes and a render deferral. The real React
streaming test receives the on-demand premise while retaining server rows until
browser acquisition completes.
The pooled release owner adds twelve new/retained/released partition histories
through held loading/ready cleanup and two startup-cleanup reentry histories.
The subscription boundary owner adds 28 resumption/retirement histories crossing
loading, ready and acquiring notifications, cleanup, source mode and render gate.
The shared token-count model forbids restoring a retired owner. Deferred-demand
cancellation fixtures now create logical demand before explicit resumption;
render-owned queued loads remain covered by the DbClient fixture. These finite
extensions do not establish arbitrary async/provider schedules or new framework
error policy. The [follow-up audit](oracle-reviews/2026-10-22-dbclient-migration-feedback.md)
records original RED, hostile controls, and the unchanged rejection decision.

A subsequent current-head summary exposed cleanup during ownership transfer.
The deferred-acquisition owner adds 192 surviving-owner histories crossing both
source modes, shapes, depths, ordinary/resumed/deferred readers, render gates,
source loading/ready cleanup, and explicit restart later or from terminal
publication. They check the complete post-cleanup status trace, ownership,
replacement acquisition, readiness and rows. The previous implementation fails
44 assertions; retaining ownership without fencing first-demand cleanup fails
16. The controlled grammar does not claim arbitrary recursive cleanup or async
provider work before acquisition. This owner retains those wider witnesses.

The ten-finding high review adds generated error-provenance and partial-setup
histories to the existing owners. The deferred-acquisition owner crosses ready,
returned-error and thrown starts, before/during handoff, with defined/absent
causes. Its independent start-handoff judgment also feeds real React ordinary
and infinite hook drivers. Each hook now has independent fixed/random campaigns
and reach minima for returned/thrown source failures before/during commit,
including absent causes. They compare readable error/boundary behavior after
commit, one source start, and ownership immediately after unmount, before GC.
Independent startup owns a pre-commit throw; the later hook reads error status.
The restored broad-rethrow defect fails both observations for each hook.
Explicit DbClient preload continues to
report source startup failures. Pooled lifecycle histories add released
partitions whose synchronous late cleanup callback returns or throws, including
1–3 healthy status peers. The same pooled release owner now generates
bootstrap callback return/throw, Error/undefined, zero through three healthy
observers, callback position before/after those peers, and `gcTime` 1–3 through
both ordinary compiled and pooled core observer paths. Failed granular
bootstrap retains no unreturned ownership after the grace period; surviving
peers retain their source until release. Held source cleanup gives every
admitted wholesale observer one terminal error snapshot and callback despite
a sibling throw, then preserves the exact reported failure at settlement.
First-return, surviving-peer, cleanup-start, settlement and final-release/GC
cuts distinguish ownership rollback from all-peer status delivery. Original
production and repairs that implement only one of those obligations fail the
respective public comparisons. These are controlled core receiving paths, not
framework scheduling or remote-provider shutdown evidence.
Observer histories add early capability or sync
failure, one/two failed attempts, both modes and reentrant surviving peers,
then explicit retry/publication/release. First-party persisted readiness does
not throw at registration; that premise is a controlled core-capability claim.
The lifecycle owner adds held/immediate cleanup and actual post-transfer
notification throws across 1–3 demands, checked after replacement readiness.
Original and narrow-mutant assertions calibrate these cuts. All six new
properties have declared reach, paired fixed/random campaigns and guarded
seed/path replay. The [high-review audit](oracle-reviews/2026-10-22-dbclient-migration-feedback.md#high-review-of-ten-findings--2026-10-23)
records counts and finite limits.

Two historical high-review claims, H04 and H08, remain `confirmed-open`
evidence gaps, with no reproduced contract counterexample or closure credit.
They are not accepted exclusions or refuted by the neighboring controls. For
H04, the pooled lifecycle owner needs a legal eager-source `subscribeChanges`
throw that reaches the partition's terminating catch and whose contract
promises same-partition, same-run recovery; current eager
`markError`/`markReady` histories recover both shared views. On-demand sources
are ineligible for pooling, so their throwing probes do not reach this path.
For H08, the lifecycle/deferred-acquisition owners need a synchronous
post-transfer notification throw that keeps retained demand detached past
supported replacement readiness; generated real throws currently acquire
afterward through the status listener. Resumption can skip its immediate
restart when that notification throws. An implicit retry without another
readiness signal is not established by the current contract. A broader
recovery promise needs an explicit decision; a legal failing trace under the
existing promise needs enforcement in these owners.
Arbitrary provider outages, callback programs and other frameworks' error
policies remain outside these new witnesses. The approved cleanup admission
rejection policy remains unchanged.

The Collection lifecycle history owner includes a 26-cell cleanup-restart
matrix. It crosses explicit and default eager sources with absent or present
loaders, empty or nonempty replacements, and no interruption, truncate during
loading, or recoverable error before same-run readiness. On-demand controls use
settled subset acquisition. A cleanup-detached eager demand remains active, its
`onLoadSubsetResult` promise stays pending through these pre-ready cuts, and it
starts no physical subset acquisition before fulfilling with the exact
replacement. The focused Query Collection test receives the successful-restart
law through automatic Collection GC, an eager Query Collection, and
`DbClient.preloadLiveQuery`. Demands first admitted after eager restart,
terminal eager failure, retired or concurrent eager owners, and same-turn
interruption schedules remain open. The broader generated lifecycle histories
cover those ownership operations only in on-demand mode.
Before the truncate repair, the four eager loader-present truncate cells
fulfilled at the loading checkpoint; their loader-absent controls stayed
pending. This distinguishes sync mode from the adapter's incidental shape. The
[issue #2163 audit](oracle-reviews/issue-2163-eager-restart-truncate-bb2122012.md)
records the exact-head ORC-001–014 outcomes, RED/GREEN calibration, review
ledger, and remaining limits.

The includes-space owner (`packages/db/tests/query/includes-space-oracle.test.ts`)
now varies leaves per twig across 0, 1, and 10. Public leaf rows change from
0 to 10 to 100 while 13 Collection facades remain. This protects facade
ownership for the fixture's fixed root/branch/twig topology; route churn, D2
demand retention, and a heap bound need separate witnesses in the includes
owners.

The virtual-row-fields owner
(`packages/db/tests/query/virtual-row-fields-oracle.test.ts`) checks presence
of all four public virtual fields directly after implicit, expression, and
functional root publication. Its fixed controlled-Collection cases do not
establish every nested projection shape or framework receiving boundary.

The generated persistence option type/admission owner is
`packages/db-sqlite-persistence-core/tests/persisted-options-type-oracle.ts`.
It generates row shapes (1–4 scalar, nullable, array, or nested fields), six
key domains, field optionality/readonly modifiers, utility signatures, numeric schema versions,
and network deadlines. Each shape retains 30 construction forms across
local/synced, schema-free/transforming schema, typed-spread/inline arguments,
and inferred/partial/full type arguments, including contextual schema callbacks.
Twelve configured forms cross eager/on-demand/network-first options with schema
and sync modes; network-first remains eager. Two schema-free forms supply a
phantom schema generic without a schema value and still preserve row input.
Eight modifier neighbors cross mutable/readonly first fields with schema and
persistence modes, bringing each shape to 52 core or 53 browser constructions.
Transforming schemas accept their output as input, as required by the schema
guide: their distinguished field narrows string | number to number, and output
optional fields remain optional on input. Exact input equality distinguishes
the two domains; inserting an output row is a legal neighboring observation.

Independent type laws compare insert input, complete published row types,
exact keys, user utilities, added local persistence capabilities (including
optional leadership/reload signatures), option types, and contextual getKey /
markReady callbacks. The browser driver uses real Query Collection options.
Declared schema-compatible-input, readonly-input, readonly-output and
mutable-fields reaches occur structurally in every generated history.
Its independent closed capability model checks direct-write signatures,
observer state, refetch parameters and a non-any Promise-array envelope. A
supplemental before/after relation preserves the full Query utility types;
QueryObserverResult's internal payload has no independent model here.
Fresh-object sync rejection uses an exact unsuppressed overload diagnostic and
a legal neighbor that changes only sync, so a collateral option error cannot
substitute for the promised rejection.

Core and browser `persisted-options.test.ts` runners share the grammar/model
and use their respective receiver tsconfig. Package and root `test:oracles`
commands select them. Both run 12 histories with seed 2259 and 12 with a fresh
seed, measure per-path reach, and accept the shared seed/path/property replay
interface (`persisted-options.types.core` / `.browser`). A shared semantic
builder retains source and declaration diagnostics while caching dependencies;
timeouts scale with the campaign multiplier, and histories yield for worker RPC.
This owner does not execute runtime parsing, adapter I/O, sync, or publication,
and does not check built declarations, npm resolution, other host packages,
every TS version, arbitrary extra-property structural assignment, or the
internal semantics of trusted PendingMutation/LoadSubsetOptions carriers.
The [type-preservation audit](oracle-reviews/pr-2259-persisted-option-types.md)
and `scripts/calibrate-persisted-option-types.mjs` preserve parent RED, GREEN,
legacy-suite survival, hostile-mutant evidence, and runnable overlay recipes.
The readonly-row overlay strips user-property readonly modifiers from get's
return while retaining readonly virtual fields. The prior grammar accepted it;
the modifier histories reject it at the shared exact published-row comparison.

The maintainer chose rejection for local caller utility collisions. The same
owner's runtime admission grammar checks the three reserved names
acceptMutations, getLeadershipState and forceReloadSubset, individually and in
combinations, against both public core/browser wrappers. It crosses local/synced
options, schema presence, function/undefined values, and enumerable/non-enumerable/inherited
properties. Rejection must be an InvalidPersistedCollectionConfigError before
persistence resolution; ordinary local utilities and synced adapter utilities
remain available. Each fixed/fresh campaign measures all ten admission states
under `persisted-options.utilities.core` / `.browser`. No Collection is created,
and no sync, SQLite I/O, native-host or publication claim follows from this path.
The versioned audit records the user decision, original overwrite RED, GREEN,
and guards that check only own/truthy properties or omit a reserved name.

Other existing fixed type checks cover adjacent compile-time boundaries:
`packages/db/tests/mutation-handler-type-oracle.test-d.ts` checks sibling
Collection/key/utilities in mutation handlers; and
`packages/db/tests/query/virtual-row-fields-oracle.test-d.ts` checks all four
published virtual fields against an independently written public shape. Their
passing type assertions do not prove runtime parsing, I/O, or publication.

The shared-driver fairness owner now distinguishes K=1 from K=2 at the second
hydrate and checks full logical persist FIFO order. Its Node and Chromium
production drivers apply one comparison,
`findSharedDriverFairnessLawViolations`. It checks hydrate admission and
completion, public rows rebuilt from the scenario seeds, persist FIFO order,
the non-preemptible running persist, and the K=1 cut at each hydrate. The K=1
reference bounds completed persists only from above, so a synthetic preempted
running persist passes it and fails only the non-preemptible law. The
[Chromium OPFS receiving spec](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/e2e/shared-driver-fairness-oracle.opfs.spec.ts)
states no expected results of its own and adds a cold SQL read. It runs a
neutral history, a held-BEGIN storm with every persist before the hydrates, and
an interleaved storm with hydrates queued ahead of later persists. The
persist-first scheduling fault fails both storms at the shared comparison. This
closes the bounded real-OPFS handoff at logical adapter completion for those
histories. It
does not establish durable write order after reopen, naturally occurring
contention, a browser matrix, multi-context coordination, elapsed-time
latency, or unbounded eventuality.

The D2 source reconciliation owner checks its helper and controlled Effect and
live-query consumers. Fixed truncate/replay and cleanup→preload graph-restart
cuts run on both eager-index and scan-fallback routes. Its generated histories
still do not cover arbitrary graph shapes or real provider event delivery;
the Electric real-provider E2E owner must supply that external premise before
a cross-boundary claim.

PowerSync's correctness owner reaches native local SQLite and records an
SDK-delivered watcher callback after a metadata-bearing `Collection.update`;
registration is wrapped for observation while delivery uses the SDK callback.
The oracle checks the public and SQLite rows and the exact queued CRUD patch.
Its held watcher callbacks are a controlled delivery premise, and its trailing
no-op and tracked metadata-only
cases enter through the public transactor with synthetic mutations rather than
`Collection.update`. Neither path establishes remote backend upload or that
Collection updates can construct those zero-field mutations.

The Query DB nested-shape work owner checks both an all-reachable finite tree
and an on-demand irrelevant-branch variant. At preload, one or three
disconnected branches leave the public tree and delivered rows unchanged and
cause exactly one acquisition attempt and one Query provider call per child
level. Provider scans, internal index traversal, facade allocations, and
elapsed time remain outside this owner; DB includes-work counts source
Collection reads and delivered changes, not internal index traversal.

The DB includes-work owner
(`packages/db/tests/query/includes-work-counter-oracle.test.ts`) also generates
an ordered parent (a page, a `findOne` with or without an `offset`, or an
`orderBy` alone), optionally narrowed by `setWindow` before start and moved by
it later, with `distinct`, a static parent filter by `eq` or `inArray` on the
correlation field, and a static child filter on the grandchild correlation
field. Its child source Collections are local or on demand; the on-demand test
handler stands in for both the sync adapter and the provider. Child forms are
`materialize`, a child Collection, a child `orderBy`, a child `limit`, a child
`findOne`, nested includes, and limited nested includes. Histories insert,
delete, and move parents, insert and delete children, and move the window, with
60 base runs per campaign; a reconstruction check requires at least three
executed fixed cases for each premise, and every checkpoint asserts
`getWindow()`. A `findOne` keeps its compiled limit (1, or 0 for
`.limit(0).findOne()`); an ordered `findOne` has a movable window, and an
unordered one is a fixed one-row result that accepts only its compiled limit
at offset 0. Rows must equal
a relational model. Preload may load only the children of the shown rows'
groups, and a step only those of rows that entered the window and were not
shown before it. A static filter creates static child demand before the
query runs only when no enclosing query is windowed or a `findOne`, and either the query is neither windowed nor a `findOne`, or it is a `findOne` that shows one row for one named correlation value, with no `offset`, and offset 0 at start if a window was requested before start. Pinned witnesses show each case
the rule closes: a window requested before start (12 child rows for a bound of
2 before the rule), grandchild demand below a windowed parent, a `findOne` with
`limit(0)`, and a `findOne` moved past its one named value before start; a
detail page whose window before start is at offset 0 still starts its child
acquisition attempt at once. A focused test requires `setWindow` to throw
`SetWindowFindOneLimitError` for any other `findOne` limit and
`SetWindowRequiresOrderByError` for an offset move on an unordered `findOne`. A `findOne` detail page with on-demand parent and child starts
its child acquisition attempt beside its parent's. On main, a late page
delivered 120 child rows for a bound of 9. Routers that add the row after the
window fail the generated campaigns; routers that add every row in an edge tie
group fail a pinned collapse and the detail page; a child that takes over
`setWindow` fails the rows law. Focused tests require a window inside a `from`
or joined subquery not to answer `setWindow`.

Recorded limit (#2151): while an index-backed parent top-K refills within one
graph run (a held row moved out, a tie group loaded at the window edge, a
forward window move), it can briefly hold a row outside the window it shows
once its ordered acquisition completes, and load that row's children; the
public snapshot stays correct. A refill checkpoint is a model observation that
combines an ordered acquisition and whether it completed: the parent Collection
delivers more change batches than the initial load or the step's own parent
write. The generated campaigns skip only its work bound. In the fixed campaign
(60 runs, seed 2137), the work bound checks 285 of 290 checkpoints strictly:
preload 60 of 60, parent inserts 45 of 45, parent deletes 34 of 35, rank moves
43 of 43, child inserts 36 of 36, child deletes 37 of 37, backward window moves
18 of 18, and forward window moves 12 of 16. Six replays pin the known traces
and allow exactly the one extra child row each shows; with no overshoot
allowed, each fails. Four pinned forward moves (local and on-demand children,
with and without `distinct`) allow none. Each generated campaign counts the
forward moves its own runs check strictly and fails if it counts none.

Open in-scope paths, all owned by this includes-work owner unless noted:
refill checkpoints need the #2151 fix (holding include demand until the
ordered acquisition completes) before the work bound can check them; includes
inherited from a `from` subquery and inputs to `fn.select` still route from
every row before the window, and need generated forms under the work bound; the
edge tie group router is caught only by pinned cases, and needs a generated tie
at the window edge on a checkpoint without a refill; a child compile error after
the parent's `orderBy` still leaves the parent's auto-index (owner: compiler
tests), and needs a focused witness that the index does not outlive a failed
compile.

The ordered-lifecycle owner also crosses deletion and retargeting of the first
window's join marker after that window is public but the live-query Collection
is still `loading` on child demand. The next ordered page ends at null; a later
unfiltered full-source request supplies the new eligible row. A finite join
model checks the final public window and the net delete/insert change events,
and each callback's rows must match its changes. Four more histories hold the
fallback provider Promise after root 3's writes apply, then retarget marker 2
to root 2 before settling it, with pending or settled child demand. They check
both public cuts, final rows, and every callback, while allowing a coherent
root-3 window to publish before the second marker change. These controlled
histories do not assert synchronous timing after first publication. Four
neighboring histories retarget marker 2 to root 4 while that provider Promise
is pending, then write root 4 only after releasing the Promise gate. The
independent join model checks the final window and callbacks. The adapter
observes that the cursor-page acquisition lease remains active while the
full-source Promise is pending and retires after it settles; ignoring provider
settlement fails at that held lease cut. Other marker actions, overlapping
root-source changes, and provider rejection remain open. Real adapter delivery
and an on-demand React first commit need receiving witnesses.

Three Ordered acquisition companions own distinct controlled cuts:
`packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts` checks
held replay authority and public snapshots, and its generated ordered section
checks an ordered window under load failures and throwing releases;
`packages/db/tests/query/load-subset-source-readiness-refinement-oracle.test.ts`
checks source-generation readiness, progressive old-child retention, and
retired-route publication; and
`packages/db/tests/query/load-subset-transaction-refinement-oracle.test.ts`
checks before, during, and after-commit abort boundaries with applied receipts.
These fixtures do not establish real-provider cancellation or framework timing.
The replay-refinement status driver observes initiating keyed snapshot-request
receipts rather than inferring logical demand from truncate callback timing.
At each history command and final convergence, terminal errors must also
satisfy the independent retained-demand classification described below.
Its generated histories declare and measure initiating keyed-request rejection
and keyed-reacquisition failure separately. A fresh include request issued
during marker truncate can fail terminally; failed reacquisition of an
established include or marker request retains the last publication until
recovery. The status comparison does not independently establish correct
settlement of the initiating receipt. Peer scenarios retain one history-level
failure allowance, so per-receiver failure isolation remains outside this
comparison; the owner is this replay-refinement oracle, with a needed witness
that fails one receiver's current request while comparing another receiver's
status at the same checkpoint. This is a stated observation limit, not a
retirement of the per-demand error-ownership law.

The ordered replay owner distinguishes replay renewal from an ordinary lazy
demand created during another subscription's replay. Its adapter records the
leases held at truncate, then matches subscription identity and independently
evaluated key predicates once per renewed lease. New owners and different keys
remain ordinary demand. Terminal-error assertions run after each history action
and at convergence. Named neighbors require a new include demand's failure to
be terminal and a settled joined demand's failed replay to remain nonterminal.
The CI seed `-1751969525`, path `67:11:10:12:1:8:7:7`, reaches the former.
The normal broad campaigns did not each reach both critical failure origins
in the declared-reach audit. A second property in the same owner,
`replay.subscription-demand-origin`, generates zero to three prior replays,
marked-row rank moves and ordinary/renewal failure schedules. Its 75-history
fixed and random campaigns must each reach new demand failing during marker
replay and a settled demand's failed renewal. The adapter witnesses non-aborted
failure independently of expected terminal status. A positive terminality check
rejects ignored ordinary failures. Source-wide, subscription-blind and
always-terminal controls also fail. Broad reach counts each of its existing
seventeen required dimensions once per history. The [declared-reach audit](oracle-reviews/2026-10-22-dbclient-migration-feedback.md#audit-against-the-declared-reach-rules-from-pr-2233)
records counts, exact replay coordinates, calibration and chronology limits.
This projection covers the grammar's five numeric keys and one-level includes;
it does not establish arbitrary predicates or provider-driven replay schedules.

The ordered-work owner has a 96-cell optimistic-departure matrix over source,
joined, and anti-joined filters; update and delete; Collection and Effect;
acknowledgement and rollback; one- and two-row windows; and indexed and
unindexed loading. Its independent installed-ID model applies one overlay,
sorts, and slices. Two indexed controls install a replacement independently of
index and query shape. A non-prefix witness installs rows 3 and 1 while row 2
is missing: deleting 3 must publish `[1]` immediately and then acquire 2.
The six-row provider ledger includes rejected leading and irrelevant trailing
rows, so useful bounded progress differs from full-source overfetch. Eight
source/joined histories settle before the held provider answer; eight more
mutate the joined-side marker for joined and anti-joined windows. Eight
complete-local-extent histories cross ascending order, offset, a tied head,
an exhausted window, and acknowledgement or rollback. Four on-demand
ascending limit-one histories cross joined/anti-joined filters with
acknowledgement/rollback. A rank-only acknowledgement and a combined
rank-and-membership departure rollback are adjacent controls. After an
acknowledged marker departure, restoring that marker must restore both rows
and its Collection or Effect publication.
Its held-load grammar also replays an unindexed descending joined window in
which an installed null-ranked row fills the visible window beyond the settled
provider prefix. After earlier deletes and held answers, the owner compares
public rows with an independent full-source sort; a boundary-blind refill check
leaves the next eligible filler row unseen and fails at the final checkpoint.
For signalling refetches, the no-new-full-source work assertion applies to
indexed numeric orders with finite ranks. Unindexed underfilled continuations
and unexpressible null or NaN boundaries may use full-source recovery; the
owner checks their row law but does not claim bounded transfer for them.

At the immediate cut, both consumers must publish the recomputed installed-row
window, even if it is short. Missing extent must start a useful finite
acquisition while the mutation persists. A provider sync transaction queued
behind persistence stays private until application; its publication can occur
before the applied-receipt promise resolves. The oracle observes answer-before-
and answer-after-settlement schedules, callback-visible rows and publication
suffixes, receipt/provider state at the relevant cuts, and two later task
turns. Every pending indexed acquisition must be a bounded ordered page or a
single-rank boundary probe; a source-filter request must reject an ineligible
row at a relevant rank. It rejects a repeated identical request without
progress in the same settlement phase, a full-source request passed off as
bounded refill, and a broad request after a valid refill. The
request ceiling is an emergency guard, not a fixed-point proof. Effect
callbacks establish membership; Collection callbacks also preserve order.

The reviewed base suppressed #2169's immediate departure and gave the
controlled indexed joined-delete histories no useful refill row. The current
loader repair prevents optimistic overlays from being classified as
authoritative source-order loss. The exact mismatch ledger is gone; all
exercised histories must satisfy the model. The [#2169 review record](oracle-reviews/issue-2169-optimistic-window.md)
contains the RED/GREEN evidence and scope. The Query DB
`optimistic-ordered-refetch-oracle.test.ts` owner runs #2169's mutation-handler
`utils.refetch()` with real QueryClient observers; restoring the old loader
classification fails its immediate `[2]` checkpoint. It checks the held and
settled callback-visible windows. It rejects an unordered request whose full
predicate scope is not one rank, even if its capped answer has one row. #2148's
exact historical provider replay is not published, although the controlled
ascending joined and anti-joined limit-one path is now exercised. With #2154
integrated, the Query DB receiver also invalidates a shifted ordered page
while the optimistic update persists. It requires one loaded-subset report, a
bounded acquisition after that report, no retraction of the immediate `[2]`
window, and final `[5, 2]` rows. Disabling the loader's report-triggered
revalidation fails at the acquisition checkpoint. This fixed history does not
cover every refetch shape or a second optimistic change during held repair.
The installed ascending/offset/tie/exhausted
witnesses do not prove those provider-refill schedules. Provider rejection,
rank-only rollback and other rank-move histories, overlapping optimistic
transactions, exact callback payloads, and framework render timing remain
outside this controlled owner. The later Ordered
acquisition table retains #2148's historical replay ownership.

The core `load-subset-oracle.property.test.ts` now distinguishes each exact
demand-key option through one-axis pairs; its derived-sync expected-failure
guard and controlled-adapter scope remain explicit limits.

The QueryRef owner checks DISTINCT support through source deletions,
last-support removal, reinsertion, and person enable/disable. It checks nested
and flat aggregate joins through source updates, and ordered joined
`findOne()` through initial, singleton, empty, restored, and changed-join-key
cuts. An unordered `findOne()` QueryRef used on either side of a join keeps
one default-key row through deletion and reinsertion. The optimizer aggregate
owner checks the initial public inner join of a global aggregate with
accepting, rejecting, and absent outer predicates; a materialized-Collection
formulation supplies matching and nonmatching controls. Other `singleResult`
forms, join forms, and scheduling cuts remain outside these owners.

The offline scheduler owner (`packages/offline-transactions/tests/KeyScheduler-oracle.property.test.ts`)
checks FIFO eligibility and retry order at the scheduler boundary. It does not
observe the executor's awaited outbox update between `updateTransaction` and
`markFailed`, or public caller settlement. Those receiving cuts belong with
`packages/offline-transactions/tests/transaction-settlement-oracle.property.test.ts`.
The transaction serializer owner uses controlled Temporal constructors and fake
storage; a claim about native Temporal or browser storage needs a receiving
witness in those runtimes.
The offline settlement owner follows the README's success boundary: the
configured `mutationFn` has returned and the storage adapter has acknowledged
outbox deletion. Its controlled storage histories hold and fail deletion,
stop the executor and queued peers on a storage failure, reject new admission,
and restart after a persisted `deletion-pending` phase. A marked row skips provider replay
even when `beforeRetry` filters all ordinary pending work; an old unmarked row
still replays. Adapter tests prove that IndexedDB transaction failure and
localStorage `removeItem` failure reject rather than masquerade as deletion.
When a caller removes an active row with `removeFromOutbox` or `clearOutbox`
while its provider is held, the caller remains pending until that provider
returns. The controlled witness then checks provider calls, public settlement,
and the empty outbox. The leadership owner checks that an earlier
`deletion-pending` row with the same persisted timestamp is deleted before its
later peer reaches the provider. This restart witness uses storage insertion
order to distinguish creation order; independent storage writers and native
browser hosts remain outside its claim.
These witnesses do not establish physical power-loss durability, a real
provider's idempotency, or the crash window between provider completion and
the phase write. The provider must honor the supplied idempotency key in that
window. Older application versions that do not understand the phase can also
replay a marked row. Native browser restart and multi-owner handoff of the
marked phase remain receiving witnesses for this owner.

The same owner also needs a captured failing seed-and-shrink-path replay for
its generated settlement property. The
[deletion-settlement review record](oracle-reviews/2026-09-30-offline-deletion-settlement.md)
preserves its earlier executable revision. The
[fail-stop follow-up](oracle-reviews/2026-09-30-offline-fail-stop-followup.md)
records the revised storage-failure law, RED/GREEN witnesses, and limits.
The guarded replay owner (`packages/db/tests/oracle-replay.test.ts`) now checks
that named pagination and index campaigns execute only the requested replay
lane. An unrelated failing fixed campaign no longer runs first. The
[prep-PR review record](oracle-reviews/2026-09-30-prep-pr-followup.md) records
these four review repairs at their exact executable revision.

### Recent fix-wave authority inventory

This inventory records the permanent authority for the September 17 fix wave. It
distinguishes an executable oracle from a specialized real-provider authority and
does not award oracle credit for a filename alone.

| PR                                                | Classification                   | Permanent authority and campaign                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#1831](https://github.com/TanStack/db/pull/1831) | Explicit oracle                  | PowerSync's `packages/powersync-db-collection/tests/correctness-oracle.test.ts` crosses real PowerSync receipts and native SQLite behavior. It runs in the package test campaign and the focused `test:oracles` campaign; portable declarations retain compiler authority.                                                                                                                       |
| [#1832](https://github.com/TanStack/db/pull/1832) | Equivalent specialized authority | `packages/electric-db-collection/e2e/sql-predicate-semantics-oracle.e2e.test.ts` and `packages/electric-db-collection/e2e/subset-sql-acceptance.e2e.test.ts` run through the package's real-provider `test:e2e` campaign. Compiler unit tests are collateral, not substitutes for either service boundary.                                                                                       |
| [#1833](https://github.com/TanStack/db/pull/1833) | Explicit oracle                  | `packages/db/tests/query/pagination-oracle.property.test.ts` owns inherited collection collation, actual `item2`/`item10` order, exact request options, hostile lexical/numeric controls, and both scan and auto-index paths. It runs in `@tanstack/db`'s `test:oracles` campaign.                                                                                                               |
| [#1834](https://github.com/TanStack/db/pull/1834) | Explicit oracle                  | `packages/db/tests/query/cold-join-reconciliation-oracle.test.ts` owns join/predicate equality equivalence across the established value domains, binary/string and nullish controls, replacement histories, raw lazy demand, and scan/auto-index paths. It runs in `@tanstack/db`'s `test:oracles` campaign.                                                                                     |
| [#1835](https://github.com/TanStack/db/pull/1835) | Explicit oracle                  | The existing `packages/db/tests/collection-state-retention-oracle.property.test.ts` and `packages/db/tests/optimistic-transaction-oracle.property.test.ts` owners cover separate collection-state and transaction-history laws. Both were already registered in `@tanstack/db`'s `test:oracles` campaign; focused storage/local-only tests remain collateral.                                    |
| [#1837](https://github.com/TanStack/db/pull/1837) | Explicit oracle                  | The offline scheduler, leadership replay, and serializer owners cover selective replay retirement, durable per-ID settlement, stale-read fencing, lifecycle recovery, native scalar encoding, and prior wire compatibility. They run in the package test campaign; generated owners expose `OFFLINE_ORACLE_{SEED,PATH,RUNS}` or the scheduler's `TANSTACK_DB_OFFLINE_ORACLE_*` replay interface. |
| [#1842](https://github.com/TanStack/db/pull/1842) | No shipped-law case              | The PR changed only focused observer tests and introduced no production behavior. `packages/db/tests/live-query-observer.test.ts` remains the correct evidence; no synthetic oracle or campaign claim is added.                                                                                                                                                                                  |

[PR #1816](https://github.com/TanStack/db/pull/1816) preserves existing witnesses,
repairs false-green assertions and drivers, adds missing histories, and includes
narrow runtime fixes reproduced by the stronger tests. The later ten-area audit
found 59 actionable findings or optional suggestions: 46 repaired, one partly
repaired storage item, nine contract decisions, and three deferred suggestions.
These are **not counts of production bugs**. The earlier 13-item review is a
separate ledger, not another 13 unique defects.

## Find an owner

Paths below are relative to the repository root. Follow each suite's domain
comment and the current API/architecture contract before extending its model.

For paced mutations, `packages/db/tests/paced-mutations-oracle.test.ts` owns
core strategy timing, admission, cleanup, and settlement. It does not cross a
framework render boundary. The React receiving owner is
`packages/react-db/tests/usePacedMutations-render-cuts-oracle.test.tsx`. Its
independent model selects the committed callback owner when a transaction is
admitted. The bounded grammar calls before and after a candidate render,
releases a suspended render to commit, and calls from a descendant layout
effect with delayed or immediate persistence, with and without StrictMode. It
compares ordered callback traces and public Collection rows at the mutation
cut, the trace after persistence, and mutate identity at the commit cut. It
does not establish callback affinity across a commit between transaction
admission and persistence, server delivery, arbitrary React schedules, or
behavior in another framework. The
[PR 2170 review](oracle-reviews/pr-2170-react-paced-render-cuts.md) records the
render-time and layout-effect mutant kills.

For standalone descriptor queries, the primary owner is
`packages/react-db/tests/descriptor-query-binding-oracle.test.tsx`. It checks
one prebuilt Query with a reusable factory descriptor under two DbProvider
clients. Disjoint-key inserts and same-key updates with different client values
are compared against plain per-client maps after initial publication, each
write, and a mounted A→B→A provider switch. It checks the public `$key` against
each projected row ID, exact public key sets, and identity equality with direct
Collection formulations.
The same owner crosses join, nested FROM, union, and include placements of two
standalone descriptors under two clients with equal row keys and different
values. Complete selected rows are compared with plain per-client values after
initial publication, a child write in the first client, and a parent write in
the second. A first-client-only binding mutation fails at the second client's
initial public-row assertion. This finite matrix does not observe on-demand
requests or arbitrary write interleavings.
The receiving include also crosses shadowed and renamed child aliases while
projecting a captured parent value. It compares both clients' public rows at
the same three cuts. An alias-only parent lookup fails the shadowed initial row
while the renamed control passes. Dropping binding IDs during descriptor
materialization fails the bound-versus-unbound public hash comparison in both
alias forms. More include depths remain outside this cell.
The receiving outer-join history crosses RIGHT/FULL, correlation on the main or
joined source, shadowed/renamed aliases, eager/on-demand sources, and two clients
with equal keys and different values. Plain per-client maps predict complete
public rows after initial acquisition and five source writes, including an
absent main side, an absent joined side, and return of the main side. It also
checks each client's source starts, on-demand requests, and descriptor-binding
hash. An absent-main join-route mutant fails the public-row check at initial
acquisition. Multi-join receiving histories and arbitrary write interleavings
remain outside this finite matrix; the core alias owner covers its own bounded
multi-join grammar.
The same owner also checks a prebuilt Query consumed by `useLiveQueryEffect`:
two clients with the same row key report their own initial enter events, and
one mounted Effect reports the new client's row after a provider switch.
After that switch, an old-provider write produces no update event and a
new-provider write produces one. The event-history check rejects an Effect
that retains the old subscription.
It checks that a descriptor Collection first acquired by a committed Effect
appears in `DbClient.dehydrate()` after the first enter event. A separate
same-hash transition from a concrete query to an unbound descriptor query
checks that the hook reports the missing client before reusing prior rows.
The same React owner checks that a descriptor render suspended before commit
starts no source work. Its finite 24-cell grammar crosses later reader intent,
startSync true/false and eager/on-demand sources. Ordinary subscription admission
also crosses no cleanup, loading callback cleanup, ready callback cleanup, and
held ready cleanup. Preload and deferring readers retain no-cleanup controls.
The shared independent judgment in
`collection-subscription-lifecycle-grammar-oracle.ts` predicts adapter entries
and the complete public status trace at admission return and cleanup settlement.
A second ordinary subscriber reuses a live run or restarts a retired source.
Public rows without cleanup distinguish on-demand source preload, which does
not acquire rows, from ordinary subscriptions. The core lifecycle owner adds
24 cases crossing the four cleanup histories, no/unrequested/requested start
gates and eager/on-demand modes. The erroneous release-before-request repair
fails four core and four React cells at admission return. The final expanded
React grammar also rejects the original no-release implementation. Historical
calibration of a previously-requested-start mutant predates the final call
reorder and is not evidence against that mutant on the current path.
This does not establish arbitrary concurrent-render schedules, failed-provider
histories, or Electric txid delivery. The [migration feedback review](oracle-reviews/2026-10-22-dbclient-migration-feedback.md)
records the SSR admission repair. The maintainer chose a programming-error
rejection when an ordinary server hook reads incidental rows or readiness that
its first browser render cannot reproduce. Cold/loading SSR remains legal.
`packages/db/tests/ssr-snapshot-admission-oracle.ts` owns the independent
preparation judgment and history grammar. The descriptor owner drives React's
ordinary and infinite hooks independently. The Svelte server driver is
`packages/svelte-db/tests/ssr-snapshot-admission-oracle.svelte.test.ts`.
Each compares rejection, projected rows and status before browser commit across
no preparation, completed or pending query preload, and normalized source
transport, including ready-empty and partial-loading sources. Render-time query
captures carry their own readiness; normalized source rows alone remain
provisional. React also runs real `hydrateRoot`, observes recoverable errors, and
checks the committed browser result. Svelte's actual server-to-browser driver is
`packages/svelte-db/tests/ssr-snapshot-handoff-oracle.svelte.test.ts`: it loads a
server-compiled fixture and calls browser-compiled native `hydrate` or `mount`.
Its first hook rows/status before effects and later authoritative browser view
are compared with the shared judgment. Histories cross zero through three
rows, same/different browser rows, zero through two earlier authoritative
readers, first/late hydration, fresh mount and a child created after provider
mount. Each independently hydrated root supplies `DbProvider hydrating`;
nested same-client providers inherit that host fact unless explicitly
overridden. An inherited marker must preserve the late reader's server view,
while a fresh mount or later child must read live rows. Always using the server
getter, keeping the marker after mount, and ignoring it each fail a receiving
comparison. Both React and Svelte cross writes after server render and before
browser hydration, including a completed same-query browser preload. The older
Svelte server-only owner proves server reconstruction only; its second render
is not browser evidence. `hydration.svelte.test.ts` separately receives
normalized transport and normal warm-browser initialization through its native
scheduler.

The shared admission owner also defines runtime ready/error outcomes, browser
explicit preparation and defined/undefined causes. Its receiving drivers are
`packages/react-db/tests/ssr-runtime-error-handoff-oracle.test.tsx` and
`packages/svelte-db/tests/ssr-runtime-error-oracle.svelte.test.ts`. React drives
ordinary and infinite hooks independently through `renderToString`, JSON and
`hydrateRoot`; Svelte uses the server/browser compilation and native host above.
Each checks every public lifecycle flag at the actual first hook view and the
committed browser view: the transported initial error/ready view is reproduced,
then browser error/ready becomes authoritative. The React driver also checks
that an error snapshot cannot fulfill a later explicit data preload. Runtime
`markError` remains a returned error result; the explicit failed preload must
reject. These empty-source histories do not establish arbitrary error-detail
serialization, error identity or post-error row retention.

Real React streaming checks
cold and warm Suspense discovery, opaque keyed/unkeyed logic, and prepared
non-streaming Suspense. Under the shared React identity law, unkeyed opaque
queries reject with `UnhashableQueryIRError` during preparation, before stream
admission. Both cold and warm receiving cases check that class; keyed controls
still render and transport their rows. Infinite identity checks callback-returned Collections
and explicit keys with matching and unbounded windows across builder, direct
Collection and callback-returned Collection inputs. The latter callback path is
JavaScript runtime coverage; it has no TypeScript overload. The React
mixed-reader streaming owner crosses zero through three rows and microtask
source publications before preload settlement. Histories place an ordinary
hook before or after a Suspense sibling, or omit it, with source readiness
synchronous or held until the ordinary server read. Held histories distinguish
Suspense registration before the ordinary loading capture from ordinary-first
discovery. An empty-source failure outcome makes that later stream reject after
the ordinary loading view was rendered; rejected Suspense supplies a fallback,
not a successful hook view.
Real React hydration receives JSON-copied snapshots and streamed promises from
the real Router adapter under its controlled SSR callback. It compares each
hook's first browser view with its own server view, even when local browser rows
differ. `packages/db/tests/ssr-stream-view-oracle.ts` owns this shared metamorphic
comparison over independently recorded ordered row names and status; a missing
browser observation fails. Mandatory reach distinguishes both reader orders,
Suspense alone, same/different browser rows, synchronous/held readiness and held
source failure. It crosses async hydration with a synchronous
React act cut that permits ordinary commit before Suspense hydration, while
transported promises can still be pending. Both schedules must preserve each
reader's first projected rows and readiness, including an ordinary loading view
whose sibling stream later failed. Emitting an update without a newer transport
revision and prioritizing that later error over the ordinary initial snapshot
fail the respective first-view comparisons. The Router's focused receiving
test separately checks replacement delivery after an initial loading record.

`examples/react/start-ssr-e2e/e2e/router-stream-view.spec.ts` receives the same
law through the real Router serializer and HTML transform
(`attachRouterServerSsrUtils`/`renderRouterToStream`), manifest-driven `Scripts`,
`RouterClient`/`hydrateRoot` and Chromium. Its mini HTTP host holds the first DB
record and every later byte until a browser hook attempts hydration, preserving
byte order after the async entry and completed shell. Thirteen finite cases
cross initial-shell/later-boundary discovery, ordinary reader order, zero/one
row, same/different browser rows, and delayed first-record arrival. A completed
same-query browser preload with a newer local timestamp cannot replace the
older server view owed to hydration. Missing-record normal close and transport
failure report the exact Error Boundary cause without a successful browser
substitution or new adapter work after termination. A known pending result
remains pending across DB record-stream close and explicit local Collection
preload until the held server provider is released. Original no-wait and
close-known-pending designs fail these host comparisons. Waiting forbids a
successful substituted view before the server record; it does not prohibit
valid Suspense prefetch.

The core receiving driver
`packages/db/tests/ssr-stream-record-wait-oracle.test.ts` adds paired generated
histories for missing, pending and explicitly preloaded local records, arrival,
normal close, transport error or cleanup, unrelated peer records, first attempts
after termination, and defined/undefined causes. The shared stream-view owner
supplies its independent lifetime judgment. Promise settlement/identity and
public observer retry cuts check that only the requested server record settles
a wait, known pending results survive normal record-stream close, and terminal
missing records cannot become local success or start new adapter work. This
later dimension coverage follows the original host RED gate. Histories also
cross public client cleanup, rematerialization and a new stream for the same
hash. Old wait promises remain settled, a new stream obtains a fresh wait, and
enabling the same open stream preserves its current pending demand. The sticky
failure implementation and an unconditional reset each fail the corresponding
checkpoint. Pending-result
disposal during client cleanup and timestamp policy after record consumption
are excluded from this grammar. The
[SSR review audit](oracle-reviews/2026-10-23-ssr-review.md) records RED on unchanged
production, GREEN, narrow mutants, and exact receiving replays.
The consumer bundle owner `scripts/ssr-bundle-oracle.mjs` checks the maintainer's
2026-10-26 SSR isolation decision at the current DbClient import boundary. It
enumerates ordinary, Suspense, and infinite React hook exports, with and without
DbClient. Final production bundles must exclude the entire observer transport
module and its admission/capture operations without DbClient; positive controls
must retain them. `pnpm test:ssr-bundle` runs after built artifacts in the
minified-DB CI lane. The original shared observer fails the absence assertion;
`--calibrate` forces transport into a plain bundle and fails that same assertion.
The package aliases and pre-bundle artifact freshness checks share one list:
DB, DB IVM and React DB, including TypeScript and TSX source inputs. Stale React
and IVM controls passed the former standalone command, then fail its named
freshness guard after correction; current output still passes all six consumer
programs. The inputs are built ESM; esbuild minifies the final consumer bundle.
Freshness compares source/config timestamps with the package entry, not
content-addressed provenance or manually falsified timestamps.
This finite build oracle does not establish every bundler, framework entry,
byte budget, or runtime hydration schedule. A client-only application that uses
DbClient still ships its transport methods: isolating that case needs an
explicit SSR API boundary and remains outside this import-level guarantee.
The [isolation record](oracle-reviews/2026-10-26-ssr-bundle-isolation.md) records
the size comparison, runtime checks, and calibration.
The separate `live-query-observer-snapshot-oracle.property.test.ts` owner checks
unchanged getter identity with and without a completed DbClient query. It runs
ordered/single-result and attached/detached histories through ordinary and server
getters. It does not model provisional hydration replacement or host scheduling.
Focused snapshot checks protect lazy state, one admission walk for an unchanged
revision, explicit preload after a loading capture, JSON-compatible non-streaming
transport, and pending-stream ownership. The observer history
owner generates throwing releases followed by explicit retries, in both modes
and with thrown undefined. This last premise is a controlled synchronous channel
release; first-party event listeners report their failures asynchronously.
Its hydration error-timing grammar also crosses error before attachment versus
after subscribe returns, granular/wholesale mode, all three portable seed
statuses, and defined/undefined causes. The first pre-attachment hydration read
must retain its server view; an owned provider error after subscription must
publish error and notify synchronously. Always deferring error handoff fails
the latter cut; original local-error precedence fails the former. This
distinguishes initial hydration from ordinary owned runtime publication.

Limits: admission/runtime sources are synchronous and eager with zero through
three rows; the mixed-reader driver additionally holds readiness/failure.
Infinite receiving coverage uses a one-row initial page and its peek-ahead row.
Arbitrary asynchronous providers, later page-shape changes during a pending
hydration stream, persistence readiness, arbitrary concurrent-root hydration
schedules and custom dehydration filters remain open for these receiving
owners. The Router/Chromium witness covers its finite serializer/HTML/script
path, not a deployed Start application, Electric delivery, every React renderer
or every host schedule. The React mixed-reader owner still needs a partial
nonempty loading snapshot followed by failure; its failed-source histories are
empty. The Svelte owners do not cover a pending streamed boundary, deferred
source throws, arbitrary asynchronous providers, error-detail identity or
post-error row retention. Manual multiple hydration epochs remain unspecified:
Core-SC04 asks whether an older record arriving after active-record consumption
may replace a newer retained server record. The shared stream-view and DbClient
owners need an explicit ordering contract before adding consumed/unconsumed
and older/equal/newer record histories. Neither local-versus-transported version
coverage nor normal Router byte order resolves that question. Transport
deliberately discarding required state and rendering local Collection object
identity are outside the portable snapshot law.
The Date descriptor typing report remains an evidence gap. The reliable strict
compiler probe accepts the reported Date forms. The receiving owners are
`packages/db/tests/db-client.test-d.ts` and
`packages/electric-db-collection/tests/electric.test-d.ts`; extending them needs
the failing application assignment and its resolved dependency versions.
Its no-client diagnostic also covers explicit `queryKey` and legacy dependency
identity for both `useLiveQuery` and `useLiveSuspenseQuery` at first consumption.
A local hook-first SSR stream over a concrete
source rejects a later same-hash descriptor preload over a different source;
the same source is accepted. A hydration-first stream has no server Collection
objects in its payload. The first committed browser hook claims its local source
objects for the hash before source readiness; a later conflicting preload
rejects, and the public row changes from the server result to the browser
result after readiness. Removing the hook's attach claim fails the conflict
assertion while readiness is held. A pending hydrated stream also has a
Suspense receiving cut: its uncommitted read preloads the first local source,
so that source may start and claim the hash before React commits. A later
same-source preload succeeds while a different same-hash source rejects. A
mutant that skips the Suspense preload claim fails at the conflict assertion.
This differs from an ordinary hook render with no explicit preload demand.
This owner does not claim that a failed Svelte effect can recover in place
after a reactive query replacement.
`packages/db/tests/db-client.test.ts` supplies a
focused nested-query preload witness across two clients, including equal query
hashes and distinct dehydrated rows.
`packages/db/tests/db-client-preload-identity-oracle.test.ts` owns the bounded
same-hash preload law within one DbClient: the second local preload reuses a
result only when its source Collection objects are the same at each query
position. Concrete then
descriptor, descriptor then concrete, and two concrete same-ID sources must
reject a conflicting second request without changing the first dehydrated row;
a same-ID pair swapped between union branches also rejects. A descriptor and
its own materialized Collection may reuse it. For a hydrated hash, the first
local preload claims ordered source-object identity; a later conflicting
preload rejects for settled and pending streams. A newer hydration chunk keeps
that claim. If the earlier local stream instead fails, a newer settled or
pending hydrated result starts without its source claim. A healthy observer
using a different same-ID source then attaches and reads its own row. The old
preload entry cannot claim the new stream. Different explicit query keys,
concurrent first local claims, and other failure/hydration orders remain
outside this finite history.
Observer preload checks that an active settled graph or pooled stream, and a
pending hydrated graph stream, reject a different same-hash source through the
returned Promise without a synchronous throw. Same-source pooled preload is
the neighboring success case. A controlled reentrant registration collision
also checks that a discarded stream Promise's later rejection has an observer;
it does not claim that an official adapter currently makes this reentrant call.
An ordinary observer's first subscription also checks an active stream claim
before retaining its listener. With equal hashes, same-source attachment and
public row read succeed; a different-source attempt and its retry both reject
while the first stream remains active. A failed first attach leaving a retained
listener fails the retry assertion. After the first observer's live result
becomes authoritative, public dehydration omits the consumed client stream.
The next observer may then attach with the same or a different source object
under the same hash and reads its own row; the earlier preload entry cannot
extend the consumed stream's source claim. Other attach failures and concurrent
subscription orders remain outside this control.
An adapter observer over a pooled view crosses the same-source and different-
source cases for an existing stream hash. The former completes its own preload
and reads the first source; the latter rejects before borrowing the first
stream. Pooled views have no query Collection config, so this receiving path
needs a separate source-identity witness.
`packages/db/tests/live-query-deferred-acquisition-oracle.test.ts` also checks
a two-source descriptor union when the first sync start fails: the second source
still starts and reaches ready on direct preload, and a preparation error stays
primary if a deferred source also throws during release. The controlled sources
start synchronously. At the synchronous preload error cut, even a caller that
opts to stream pending queries cannot dehydrate the failed query; a later
same-hash preload over a healthy replacement publishes its own row. Asynchronous
failure is also exercised with a later controlled `markError`: the pending
stream rejects and disappears from dehydration, the peer source is ready, and
a healthy same-hash replacement publishes its row. A mutant that dehydrates
errored records fails at that cut. Other asynchronous schedules and larger
source sets remain open. Retrying the same options after the
source entered terminal error reports that source error instead of reusing the
failed query's pending stream; it does not restart the source.
A replacement observer subscribed after the controlled asynchronous failure
can attach under the same hash and reads the healthy replacement row as ready,
without a stale stream error, before a new client preload. The prior
source-mismatch check fails that attachment assertion. The same history rejects
a different-source preload while its original stream is still pending. A second
fixed history crosses a synchronous source throw and then attaches a healthy
replacement observer before a new client preload; its settled snapshot contains
only the replacement row. Removing the failed-record source-claim guard fails
that observer attachment, while ignoring every existing stream's claim fails
the pending-stream rejection. The preload-identity owner also checks active
streams. These histories do not enumerate concurrent replacement observers,
other failure schedules, or later conflicting preloads while an observer has no
reusable client stream.
An observer preload over a config-free pooled view is also explicit demand: it
starts an idle eager source once, does not restart a running source, and reaches
a ready public snapshot in both cases, with or without an SSR cleanup client.
This bounded witness does not claim the same path for on-demand or asynchronous
sources.
`packages/svelte-db/tests/descriptor-query-release-oracle.svelte.test.ts`
checks Svelte's two-source release after a first startup error and a direct
reader after a second descriptor factory fails. It observes source start counts,
ready status, and failed-hook subscription release. A fresh effect root after
the failed root is retired consumes an independent healthy query and its row.
A controlled Svelte runtime probe showed that an uncaught effect error does not
rerun the same effect when its reactive query changes; in-place recovery after
that error is not promised. This owner does not establish two-client Svelte
provider binding or ordinary reactive query replacement. Concrete-
config descriptors, on-demand acquisition, and those Svelte paths remain open
for this binding law; a
receiving oracle needs the relevant public observation for each. Vue, Solid,
and Angular have no DbClient descriptor-binding contract in this work. Their
query callers use concrete Collections.
`packages/db/tests/live-query-options.test.ts` checks that a client-aware
consumer binds nested, union-branch, and include-child descriptors during final
preparation. Construction retains descriptor refs in those positions, including
direct, nested, materialized, and conditional includes. A prepared builder is a
bound snapshot; a later descriptor join remains unbound until another
client-aware consumption. The focused core tests check source materialization
and sync starts before and after release of a render deferral set, plus the
missing-client error for direct consumption. The React descriptor oracle checks
public rows after a committed hook consumes such a continuation and zero source
starts when a render containing one never commits. These bounded checks do not
compare union or include rows under separate clients, or concurrent render
schedules. The original standalone Query remains the reusable two-client plan;
rebinding a previously prepared snapshot to a different client is not claimed.
`packages/db/tests/query/collection-ref-compatibility.test.ts` pins the
exported `IR.CollectionRef` shape for concrete Collections: `collection` is an
enumerable, writable own field that a spread copies. It also checks that an
unbound descriptor uses `IR.DescriptorRef` with no `collection` field. A bounded
source-position matrix checks collection, nested query, union, join, and include
IR traversal and conversion to concrete refs during placement cloning. This
focused shape test does not establish public rows for those query forms or
generic visitor behavior outside the named collectors.

| Surface                                      | Primary executable owners                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Independent judgment and important limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordered relations and BTree                  | [top-K relation oracle](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/operators/topk-relation-oracle.test.ts), [fractional-index window moves](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/operators/topKWithFractionalIndex-oracle.test.ts), [BTree/Map](https://github.com/TanStack/db/blob/main/packages/db/tests/btree-map-oracle.test.ts), [incrementalization laws](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/incrementalization-law-oracle.property.test.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Independent ordered relations and cumulative signed output. Each generated incrementalization campaign sums the checker's delivery counts and requires one atomic delivery per checkpoint and more split deliveries than an unsplit run makes; a checker that stops splitting fails all six campaigns. Most ordered steps edit the previous world by one removal or insertion, and a reconstruction check counts promotions of retained rows over the executed fixed campaign (25 global and 21 per parity at 100 runs; independent worlds gave 2 and 2). A type test pins `join(other, type)`'s nullable pair sides for every join type. Top-K consolidation compares same-key values without hashing, including cyclic replacements and fresh transient cancellation. The fractional-index test checks an empty output message for a window move after all rows retract; it does not prove downstream lazy acquisition. Other hash-based operators retain hashing's declared domain. Algebra does not specify client readiness. The BTree/Map oracle checks point operations, neighbor pairs, and full, partial, boundary, exclusive-high, and empty range scans for integer keys and node sizes 4–8. It does not check balance or space, and it assumes consistent comparators ([code-weight BTree review](oracle-reviews/code-weight-btree-trim.md)). The generated groupBy law compares JSON values; a pinned contract test in `packages/db-ivm/tests/operators/groupBy.test.ts` records that after a delete, `min` and `max` return a value hash-equal to a remaining member, not necessarily the remaining instance (`-0` for `0`, an equal Date), which is why the query compiler keeps its own exact-value keys. It checks both insertion orders, reads the group's row by integrating output multiplicities, deletes the minimum and the maximum, and shows that an aggregate input that tells the rows apart returns the remaining instance, for -0/0 in both directions and for both `min` and `max`. The contract holds while every member has positive multiplicity. It pins the current behavior separately: the delete's retraction is the last record a shared hash entry gets, so the deleted instance comes back in either insertion order, for -0/0 in either direction and for an equal Date. For -0/0 and equal Dates the contract assertions only show hash equality, which is all the contract promises. Open: the incrementalization law's value policy compares JSON and clones by `structuredClone`, so no generated history sees -0 or Date identity; a value-identity policy with -0/0 and equal-time Dates would generalize this pinned contract. |
| Includes and publication                     | [cross-formulation](https://github.com/TanStack/db/blob/main/packages/db/tests/query/includes-cross-formulation-oracle.property.test.ts), [temporal](https://github.com/TanStack/db/blob/main/packages/db/tests/query/includes-temporal-oracle.test.ts), [Collection includes](https://github.com/TanStack/db/blob/main/packages/db/tests/query/includes-collection-oracle.property.test.ts), [architecture and complete suite map](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/ARCHITECTURE.md#executable-contracts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Per-parent/flat-join/partition relations, callback-time rows, nested values, and route histories. Fragmented lazy-demand consolidation covers delta growth and successful, rejected/retried, and obsolete replacements at the Collection request boundary; it observes exact key unions and abort checkpoints. A compiled-includes fixture makes adapter unload evict owned child rows and proves a rejected union cannot remove established public child rows. Retry after that terminal live-query failure remains covered at the acquisition boundary; no automatic in-place recovery is claimed. Observe raw promised order; fresh queries do not establish continuous publication safety. The temporal owner's source-readiness lane enumerates every legal order of delivery, settlement, source readiness, and one later change for a source whose Collection readiness lags its settled subsets. It checks live-query readiness, preload settlement, and visible rows for direct, single-result, ordered-window, include-child, lazy-join, and eager-root sources; `queryOnce` results for the direct and eager-root shapes; `toArrayWhenReady()` and `stateWhenReady()` results for a read started after rows are visible but before readiness, over the direct, single-result, and eager-root shapes (and the lazy join for `toArrayWhenReady()`); and Effect `skipInitial` deltas for the direct, lazy-join, and eager-root shapes, and every on-demand cell of every consumer is crossed with a truncate or (join and include) a parent rekey before settlement. Each on-demand cell also compares its consumer with a metamorphic twin over a source that is ready from its start, which does not rely on the model's eager/on-demand rule. A live-query observer test checks that a hydration seed hands off at subset settlement, and an Electric test pins that a ready progressive query's rows update only at the full sync's swap. Effects over an ordered window or an include have no lane. It rejects both a design that waits for every source's Collection readiness and one that ignores source readiness. Electric live-query tests are the receiving witnesses for a real progressive source and an on-demand source that is ready before its subset loads; a React Suspense test checks that Suspense and `isReady` release together. Other framework adapters have no Suspense witness.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Collection lifecycle                         | [mutation startup](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-mutation-startup-oracle.test.ts), [change-event history](https://github.com/TanStack/db/blob/main/packages/db/tests/change-event-history-oracle.test.ts), [sync publication reentrancy](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-sync-reentrancy-oracle.test.ts), [history](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-subscription-lifecycle-history-oracle.property.test.ts), [publication](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-subscription-lifecycle-publication-oracle.property.test.ts), [replay](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-subscription-replay-oracle.property.test.ts), [effect disposal](https://github.com/TanStack/db/blob/main/packages/db/tests/effect-disposal-oracle.test.ts), [PR #1902 review](oracle-reviews/pr-1902-change-event-history.md), [batch-order decision review](oracle-reviews/change-event-batch-order.md), [absent-key insert review](oracle-reviews/2026-10-02-insert-for-absent-key.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Core Collection `insert`/`update`/`delete` admission while `startSync:false` is idle; complete public-row/change-message agreement across bounded one- and two-key histories plus replayable four-key campaigns, where every message must be valid for a strict consumer (insert only for an absent key, update or delete only for a present one; [absent-key insert review](oracle-reviews/2026-10-02-insert-for-absent-key.md)); a two-key deferred sync history checks each key's causal insert/update/delete trace while allowing any cross-key interleaving. Reversing all deferred messages fails that check; reversing each sync transaction's distinct-key messages passes. Queued duplicate admission and cancellation, ownership and phase histories, exact caller/error/publication evidence, and late completion and restart have separate witnesses. Generated deferred histories with cancellation or reentrant callbacks need a witness in the change-event history owner before claiming general batch-shape coverage. Query write utilities and effect self-dependent disposal remain separate contracts. During a truncate, a ready callback can write to any key after a prior optimistic request. Each subscriber, with or without initial state or a filter, must receive valid messages after the Collection is ready and end at the Collection's rows. A throwing ready callback during sync entry surfaces once the sync function returns, whether it calls markReady or commits a truncate ([round 3 follow-ups](oracle-reviews/2026-10-05-round-3-followups.md)). Callback rollbacks, non-optimistic callback writes, and several writing callbacks remain open ([ready-callback truncate review](oracle-reviews/2026-10-05-truncate-ready-callback-delete.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Paced mutations                              | [virtual-clock oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/paced-mutations-oracle.test.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `createPacedMutations` with queue front/back options, bounded waiting capacity at zero and one, cleanup draining in FIFO/LIFO order after a held write, cleanup timing at the configured wait for immediate writes, admitted writes after separate Collection cleanup, debounce and throttle schedules with explicit and omitted options, and first-leading throttle execution at epoch zero. Finite histories compare optimistic rows, returned transaction identity and receipt outcome, execution order and virtual-clock time. Held writes verify queue serialization. Leading-only throttle and debounce witnesses reject skipped calls immediately with their named dropped-call errors, including omitted edges, both edges disabled, and same-row rollback while a prior write is held. Capacity witnesses cover overflow rejection, distinct-key optimistic rollback, same-key admitted-write survival, and in-flight versus waiting admission. Cleanup witnesses check repeated queue cleanup, eventual admitted receipt settlement, direct queue strategy rejection of new callbacks, public post-cleanup rollback with `QueueDisposedError`, pending debounce transactions that wait until the last call's quiet edge after separate Collection cleanup, and a trailing throttle timer that runs at its regular edge after separate Collection cleanup. Deferred custom queue and batch callbacks check compatibility with `void` and `false` execute results, respectively. Frozen options verify factory non-mutation; a mutable option witness checks that debounce uses its construction-time trailing setting. Throwing `onMutate` histories check leading-edge reuse before any row change, failed-row restoration when a pending transaction already has admitted work, eligible leading writes behind a held handler, and throttle pending merges at the throw, start, receipt, and later-timer cuts. New debounce/throttle admission after cleanup, manual commit of a strategy-owned transaction, longer throwing/reentrant bursts, failed persistence, broader capacities and schedules remain outside this owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| React paced-mutation render cuts             | [render-cut oracle](https://github.com/TanStack/db/blob/main/packages/react-db/tests/usePacedMutations-render-cuts-oracle.test.tsx), [PR #2170 review](oracle-reviews/pr-2170-react-paced-render-cuts.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `usePacedMutations` publishes callbacks only from committed renders and does so before descendant layout effects, while callback-only commits preserve mutate identity. An independent committed-document model crosses ordinary and StrictMode schedules with mutation before or after a suspended candidate, mutation after the candidate commits, and delayed or immediate mutation from a descendant layout effect. It compares ordered callback traces and public rows at the mutation cut, the trace after persistence, and mutate identity at the commit cut. Render-time publication, layout-effect-only publication, and split insertion/layout publication mutants fail at the intended comparisons. A commit between transaction admission and persistence, arbitrary React schedules, server delivery, and other frameworks remain outside this receiving owner. |
| Optimistic state                             | [same-key composition](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-composition-oracle.test.ts), [history model](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-history-oracle.ts), [generated histories](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-transaction-oracle.property.test.ts), [outcomes](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-history-outcomes-oracle.test.ts), [publication](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-history-publication-oracle.test.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Optimistic state drops at settlement and held sync transactions publish with it ([settlement-drop review](oracle-reviews/2026-10-03-settlement-drop.md)); whole-row active overlays, metadata and prior-value events. A raw subscriber without initial state checks that each truncate batch inserts a key once ([2026-10-02 review](oracle-reviews/2026-10-02-truncate-raw-subscriber.md)). Never rebase a pending snapshot merely to simplify the model. Generated histories also write source batches inside mutation handlers, before they return; the Collection must own the request by then ([handler source batch review](oracle-reviews/2026-10-01-handler-source-batch.md)). The same-key transaction lane also authors a delete followed by a reinsert, which must be visible optimistically and net to the truth-table request ([state mutation round 2](oracle-reviews/2026-10-02-state-mutation-round-2.md)). Source rows are written as `insert` for a key the source lacks, and batches may delete keys the source holds ([state-stack mutation gaps](oracle-reviews/2026-10-02-state-stack-mutant-gaps.md)). Batches may also delete a key the source never held. That delete leaves an active request in place ([absent-key source delete review](oracle-reviews/2026-10-02-absent-key-source-delete.md)). A separate partial campaign keeps the default partial row update mode, where source updates may omit a field and merge into the source row, not into an optimistic row ([round 3 review](oracle-reviews/2026-10-05-state-mutation-round-3.md)). An aborted open batch restores the driver's own source rows as well as its keys, so a later partial update still omits the field ([aborted-batch review](oracle-reviews/2026-10-08-partial-update-aborted-batch.md)). A failed synchronous manual `mutate` callback is now checked after same-key update, distinct insert, and same-key delete, with and without earlier intent, plus two two-Collection cases, one with a restoration listener failure. The throw cut compares public rows and pending payload; the later commit checks only surviving intent. A restoration listener error retains the callback error as the aggregate cause and does not stop other Collection restoration. These witnesses allow transient notifications during the callback and do not cover nested throwing callbacks or async work after the synchronous scope. After every step the driver also checks, by transaction identity, that the Collection tracks exactly its unsettled transactions, so a failed or rolled-back transaction leaves the map ([failed transaction retention review](oracle-reviews/failed-transaction-retention.md)). The [transaction ownership oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/transaction-ownership-oracle.property.test.ts) owns release across two Collections: merged-away pairs, conflicting rollbacks with a throwing subscriber, asynchronous success and failure settlements with a throwing subscriber, rollbacks from a `truncate` listener during a sync commit, a reused transaction id, and a `mutate()` callback that throws, checked in the same call stack and after promises flush. It also checks the settlement error shape and that a settled transaction's set of tracking Collections is empty; its mutations still name their Collection, so neither owner claims the Collection is collectable. Focused [restoration ownership](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/restoration-ownership.test.ts) witnesses check that repeated offline `mutate()` calls add to one transaction, that a completed restoration settles `isPersisted`, and that a restoration one Collection cannot track leaves no Collection tracking it. Its grammar also has direct writes (`insert`, `update` and `delete` outside a transaction), optionally with a throwing subscriber that may have been sent the rows first; it captures each direct write's own transaction and requires it to fail when the admission throws and to complete otherwise, counts handler calls (none for a rejected write), and keeps a mirror subscriber on each Collection that must match the rows after every step. A write whose admission throws rolls back only its own transaction and rethrows. The [change-event history oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/change-event-history-oracle.test.ts) generates local-only direct writes that meet a throwing subscriber, registered after the mirror, and requires the call to rethrow with its transaction completed and the rows following the model. Focused witnesses cover a local-only subscriber that writes the key it was told about, and a subscriber that throws a value that is not an Error; whether a throwing subscriber may stop a later subscriber is not decided. Open (approved limits): a direct write made inside another write's change subscriber reports its subscriber failure to the outer write; on a local-only Collection a direct write whose subscriber throws completes on the fast path but rolls back on the transaction path, and the change-event oracle generates only the fast path; a direct write admitted from inside a sync-commit listener, where the rollback's recompute is deferred, is not generated; the generated ownership histories read every receipt themselves, so only a focused witness (rolling back an empty manual transaction) checks that an unread receipt reaches no `unhandledrejection`; two Collection instances with one id, a Collection cleaned up before its transaction settles, and offline restoration have focused witnesses only; no generated history combines a held completed row with a second Collection. |
| Drafts and native values | [proxy](https://github.com/TanStack/db/blob/main/packages/db/tests/proxy-oracle.test.ts), [detachment](https://github.com/TanStack/db/blob/main/packages/db/tests/proxy-detachment-contract-oracle.test.ts), [iteration](https://github.com/TanStack/db/blob/main/packages/db/tests/proxy-iteration-contract-oracle.test.ts), [revert](https://github.com/TanStack/db/blob/main/packages/db/tests/proxy-revert-oracle.property.test.ts), [native methods](https://github.com/TanStack/db/blob/main/packages/db/tests/proxy-native-methods-oracle.property.test.ts) | Native-operation controls, exact patches and actual stored rows; alias/cycle/adversarial-key histories. Set and Map reorder histories check draft patches and stored iteration order after replacement and clear-and-readd; RegExp replacement/reversion histories check `lastIndex`. General native-mutator and symbol-write support is not established by a plain-object oracle. The revert owner generates assignment, revert, delete, nested, symbol-key, and `for...of` histories and checks `getChanges()` and the draft against an independent draft-equality model: ordered Map and Set contents (including Sets inside Map values), RegExp `lastIndex`, array holes, and symbol keys inside nested values. Map and Set mutators and top-level symbol writes are outside its grammar; array mutators appear only in the mixed block below. Its round-trip grammar also replaces a field with a new object and restores the original value through a nested write. The law requires every changed key, and permits a written key whose final value equals its original to be reported with that value: a false positive repeats the stored value, and a false negative loses a write ([review](oracle-reviews/proxy-revert-replaced-object.md)). A further revert block mixes array `push`, `pop`, and `reverse` with assignments, a nested object replacement, and a retained handle, and checks that a mutator through a replaced handle changes nothing; pinned witnesses require a native write through a Map or Set value, a typed-array view, or a frozen draft to be reported, and a nested revert inside a Map or Set to keep the container's other write; Map and Set mutators are not mixed with assignments, and an equal-valued assignment keeps a retained handle attached (declared). The proxy owner's stored-function law checks, against a native row, that a function stored as data reads back as stored by every read path and that a stored method sees the draft as `this`, so its writes are tracked. The detachment owner pins which key classes a draft copies: enumerable string keys and every symbol key. The revert owner also generates typed arrays (including a subclass that does not forward its constructor argument), URLs, and a class with only private state as written values, with a property that writes two of them over one field. The native-methods owner generates rows (holes, `undefined`, duplicates, nested arrays, empty rows, typed `-0` and `NaN`) and calls every method of `Array.prototype` and `TypedArray.prototype`, in fixed and random campaigns with replay; it compares the result, whether the method returned the array itself, the identity of each original object, and the published row with native values, and a new built-in method fails until it has arguments. The proxy owner's `defineProperty`, stored-function, and frozen-draft laws are bounded tables against native rows. Its `defineProperty` law compares result, value, descriptor, and changes, for values and accessors. The iteration owner checks that array iterators see a push, removal, index write, or length cut made while they are open. Open: a draft reads a class instance of the original row as a plain object, so private-field getters read `undefined`, and a built-in method called through `this` on a nested Map or Set draft rejects the Proxy receiver; a mutator that changes nothing publishes an equal value; writing back a keyless class instance of the original row is a change, and `DataView` setters are untracked ([draft proxy review](oracle-reviews/code-weight-draft-proxy.md)). |
| Query DB and observer                        | [ownership](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts), [persisted direct-write window](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/persisted-direct-write-window.oracle.test.ts) ([review](oracle-reviews/issue-2029-direct-write-lock-window.md)), [load lifecycle](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/load-subset-lifecycle-oracle.test.ts), [observer histories](https://github.com/TanStack/db/blob/main/packages/db/tests/live-query-observer-history-oracle.property.test.ts), [retained snapshots](https://github.com/TanStack/db/blob/main/packages/db/tests/live-query-observer-snapshot-oracle.property.test.ts) ([review](oracle-reviews/pr-2043-retained-observer-snapshots.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Real QueryClient boundary, applied-settlement barriers for existing and cached demand, mutation-handler Collection identity, terminal fetch-record lifecycle, and a per-listener eligibility ledger, not a duplicate dispatch queue. The bounded handler grammar crosses insert, update, delete, parameter and mutation-alias access, refetch, and clearError. A held clearError retry retains the prior public error through initial, background, and Collection application failures; success clears it, failure advances the count, including a repeated error at clock time zero. An intermediate Query retry attempt does not recount the previous background error; a held final attempt can succeed or fail. A held application after successful Query fetch keeps the error visible until the applied result. A mocked persisted-baseline scan holds an older success while a newer terminal Query failure arrives; the newer public error and count survive application, including when the Error object and clock tick repeat. Native SQLite persistence, concurrent retries across multiple tracked Queries, mutation-handler fetch-boundary settlement, and deferred result application remain outside this witness. The mutation overlap grammar crosses both start orders. Check reentry, peer survival, FIFO and disposal independently of final rows. A retained observer snapshot shows its capture-time rows on a later first read of `data` or `state`. Direct-write witnesses now distinguish an idle pending eager cache seed (success with no new freshness timestamp) from an in-flight pending request, and require update, delete, and upsert to reach both eager Collections through their shared physical Query, in both acquisition orders. They check both public Collections and the Query cache immediately after each write. A held older shared fetch also crosses B's release and reacquisition, then compares both public rows at refetch and load settlement; mixed select wrappers and three or more co-owners remain outside this witness. The load-lifecycle owner also restores an intermediate checkpoint that keeps an explicit subset refetch pending until a post-write request applies, and rejects a no-cancel mutant at the replacement-request assertion. |
| Query DB SSR dehydration                     | `packages/query-db-collection/tests/ssr-dehydration-oracle.test.ts`, [review record](oracle-reviews/issue-1950-ssr-dehydration.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | A plain Query cache control, a live on-demand compound predicate, a signal-only request, and an ordered cursor with a custom comparator all retain their row through QueryClient dehydration, reconstruction of Seroval's emitted stream payload, and Query Core hydration from that payload. The on-demand query functions still receive the original IR, comparator, and signal; serialized metadata retains enumerable user metadata but excludes request options. The original implementation fails the compound and signal cases at the stream checkpoint. A serializable stream-only request-options leak passes the former chunk-count check but fails the current payload assertion. This owner covers successful Query cache entries at the installed Query Core 5.90.20 and Seroval 1.5.0 versions. A TanStack Start integration owner still needs the reporter's Router 1.171.33 and Seroval 1.6.8 path, browser Collection resume/refetch, and request cancellation across SSR. Query subset and pagination oracles remain owners of predicate/order/cursor meaning and supported value types. The issue's `shouldDehydrateQuery` workaround replaces Query Core's success-only default and admits pending/error queries; any documented workaround must preserve that default filter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Query DB ordered refetch | `packages/query-db-collection/tests/refetch-ordered-prefix-oracle.test.ts` | Issue #2136: after preload, and after `utils.refetch()` or a Query invalidation settles, an on-demand Query Collection behind a LEFT-joined, ordered, limited live query must show the window over the current backend rows. The design under test: query-db reports `invalidateLoadedSubsets()` when an ordered page changes keys and either has a later page or ends earlier in the order than before, and each ordered loader runs its bounded prefix repair. Its model is a pure top-k of marked backend rows. A fixed and a random campaign generate rounds of marker flips (which serve continuation pages), backend changes while the provider lags, a second live query (`observe`) whose own demand can load a page's new row first, optional Query invalidation with further changes, and a refetch, across one or two order terms, a numeric or locale-collated string order, limits 1–3, offsets 0–1, and a static or function Query key. With an unchanged backend, a repeated refetch must serve no more rows, start at most one first-page request, and report nothing. A refetch or invalidation must never start a new full-source request. A coverage law runs at the same checkpoints: every backend row from the start of the order through the window's last row (every row, when the window is short) must be in the source Collection with its current values, so a latent gap fails before a marker exposes it; a named replay of the issue trace with the moved row unmarked passes the window law and fails only the coverage law when Query DB never reports. The grammar can hold an optimistic update across a refetch, with the checkpoint moved to its release, and a premise-directed campaign under a hold (other rows observed, a row moved ahead of the page's end, a new row further ahead, a write to the last-sorting observed row) requires a report during a hold in every case and fails a skip that reads rows held back behind the transaction; the general campaigns did not. The general grammar holds optimistic deletes as well as updates. A named replay of a refetch during a held delete left the window short after release, also with this PR's report and overlap changes reverted, until the fix that resumes a continuation after a synchronous answer; no window is checked during a hold, where #2148 and #2169 remain open. Reports (`loadedSubsets:invalidated`) are bounded: a step reports at most once, and only when some ordered request was answered again with different rows; named replays require no report when a one-page window, or a window's last page, only loses a row, and a sync-boundary replay requires a report when a page ending on a row without an order value has its end move earlier (on the earlier gate, which read that page as empty, it reported nothing), and another requires a report when the provider returns a one-page window's rows in reverse order (the earlier gate took the last array row as the page's end). When a page's end moves earlier, Query DB reports, and a loader whose window lies inside its own first page must skip the repair: a named replay of an insert into a top-N list bounds the refetch's requests by its Queries, and a filtered one-page window whose page end moves past an unseen row must still repair (found by the random campaign; a loader that always skips fails it, the f9 tie replay, and the ordered-work oracle's signalling replays). The skip also refuses while the source holds accepted sync rows back: a replay refetches while an optimistic update persists, so the report arrives before the refetched rows are visible, and a skip that reads those older rows fails it. The ordered loader state oracle checks that a prefix read issued before an ordering invalidation, which settles after the bounded repair, does not retire the repair's prefix; the repair-first order failed before that fix. A `loadSubset` call that acquires a released, invalidated page can report, because Query then refetches that page on its own. A failed repair shows only the last window or the right one. Named replays cover the issue trace after a refetch and after an invalidation, with a page-capping provider, with another live query loading the page's new row first, with an empty later page, with a page whose end moves earlier while a tie request holds its old last row, a second refetch after an invalidation, a repair failure, and a provider that honors neither cursor nor offset. Never signalling, the old overlap-to-full-source rule, ignoring empty later pages, reporting on any page change, removing the repair loop guard, and reporting once per page each fail it by assertion. A replay makes a page's application fail and checks the window shows its last result or the right one, then the next refetch restores it; recording a page before its rows are accepted cannot be distinguished, because the failed attempt reports on its own. Open: the report laws bound reports but do not require each one; a page whose end moves earlier reports even with unique order values, where no row can be missing; it does not check whether a repair waits for in-flight work; the generated campaigns use an uncapped cursor provider only (an offset-only provider and a page-capping provider each hit a loader defect that reproduces on main: #2182, #2183); the generated campaigns do not check the window after a marker flip (a named replay checks the trace where the loader stopped refilling after a joined-side removal, which the repair-retirement fix below closed); a failed repair still recovers through the loader's full-source retry; interval, focus, and reconnect refetches share the invalidation path but are not driven; NaN order values have no executable witness; overlapping `refetch: true` acquisitions on one Query hash are counted, so the first to finish does not clear the loop guard for the other, but no witness separates that from a plain set; a Query refetch that joins a running `refetch: true` acquisition on the same hash does not report, and no witness reaches it (#2185); follower tabs of a multi-tab persisted collection never receive the report (#2174). The offset-only and page-capping loader defects have `it.fails` witnesses in the oracle. A finished bounded repair used to discard its boundary when its retirement made Query DB remove a row the loader had sent; the loader then restarted paging with a smaller first page that could not retire the repair's prefix, so every later refetch read both. A named replay found by the random campaign (at four times the run count) and an ordered loader state witness fail on that, and the fix also closed the joined-side refill defect. At four times the run count, the random campaign found a short window that stopped paging before the last row of the order: a report's repair released continuation Queries, and Query DB answered their reacquisition synchronously from its cache, so the graph turn inside each request asked for more while the loader was still requesting and nothing resumed the staged continuation. Only the coverage law failed. A named replay and an ordered loader state witness (a synchronous answer whose writes the graph already processed must continue the chain) fail on that, and pass with the fix. The loader side of the report also has a second owner: the ordered-work oracle's `refetch-signal` provider re-runs each served request alone and reports when any answer changed, across that oracle's generated plans, and a signalling refetch must start no full-source request unless a bounded page in that step ended on a null or NaN rank, which takes the documented full-source fallback (a random seed found that case). Never signalling and the old overlap-to-full-source rule each fail it. It excludes a peer live query, which can keep a short window after a refetch (#2155). The persisted-collection oracle checks that a source's report reaches the Collection through the managed cache-generation wrapper and that a retired source session's report is dropped. Remaining work for this class is tracked in #2186. |
| Ordered acquisition                          | [pagination](https://github.com/TanStack/db/blob/main/packages/db/tests/query/pagination-oracle.property.test.ts), [ordered work](https://github.com/TanStack/db/blob/main/packages/db/tests/query/ordered-work-oracle.property.test.ts), [ordered lifecycle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/ordered-lifecycle-oracle.property.test.ts), [ordered loader state](https://github.com/TanStack/db/blob/main/packages/db/tests/query/ordered-source-loader-state-oracle.test.ts), [graph scheduler](https://github.com/TanStack/db/blob/main/packages/db/tests/query/scheduler.test.ts), [issue #1880 ordered-repair review](oracle-reviews/issue-1880-ordered-repair.md), [issue #1882 custom local collation review](oracle-reviews/issue-1882-custom-local-collation.md), [issue #1898 relation-filter review](oracle-reviews/issue-1898-relation-filter.md), [PR #1909 external review](oracle-reviews/pr-1909-external-review.md), [eager ordered-window repair review](oracle-reviews/perf-ordered-window-repair.md), [reversed index reads](https://github.com/TanStack/db/blob/main/packages/db/tests/reverse-index-oracle.property.test.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Complete finite provider results, inherited locale and bounded/unbounded custom collation with exact request options, query-level inheritance across source aliases, real lexical/numeric disagreement, custom comparator ties, scan/index paths, pending windows, ties/nulls, lease ownership, Effect callback gates, including an indexed source update during Effect startup, and documented repair timing. Direct LEFT-joined filters cover local finite prefixes, pending child demand, child removal, and anti-join publication with custom full-source and unindexed fallback loading; unrelated include demand cannot stall the root continuation, and an empty joined replay wakes held Effect callbacks; remote relation hints remain outside this owner. Graph scheduler checks coalescing, dependency order, synchronous loader input, and repeated-alias failure ownership. The ordered-work oracle checks that a synchronous root refill reaches D2 before joined publication; a mutant that omitted the post-loader graph step failed at the second child demand. Custom collation proves local full-source acquisition only; it does not establish provider cursor capability or backend collation fidelity. Sibling-source input during a synchronous ordered continuation returns to graph work before another ordered acquisition. Request completion is not proof of unrequested source extent. A window move during existing joined demand waits for its root continuation, including an independently held root request; current demand failure rejects the move, while retirement and an obsolete rejection do not. A bounded ordered repair resumes its refill after joined demand settles. The ordered-source-loader state test checks that an explicit failed-request retry blocked by joined demand retains its generation until it can issue a request. Multiple simultaneously pending joined plans during a window move and a public-query failed-retry overlap still need dedicated witnesses. The ordered-work oracle also checks an eager indexed window over generated upserts and deletes: the rows equal the filtered, sorted model, and each change delivers a bounded number of source rows; an unbounded or always-full repair read fails it. Its filter dimension adds a function filter and a LEFT-joined filter, and a campaign fixed to the joined premise checks that a window refilled past a distant row the query already received holds the first eligible rows. Joined filters also run as anti-joins, change eligibility through the marker or the root row's join key, and drive an Effect beside the Collection. A full-join filter keeps every root row and adds a null-ranked rootless row for each marker no root row matches; on main a bounded root prefix showed markers whose root rows were not yet loaded as unmatched rows, and restoring the old inner-or-right full-source rule fails eight tests. Null placement is a generated dimension, with the index built to match, and a query that ignores it fails six tests. A full-join campaign has few or no filler rows, a matched null-ranked root row and at least one orphan marker in every case, so its windows reach the null group where rootless rows and null-ranked root rows tie; a reconstruction check samples exactly the cases its fixed-seed run executes and requires such windows (19 rootless and 7 mixed null-group windows of 40 at one times the run count), and the Effect runs beside the Collection. Full joins read their full source, so only the rows law covers them; paging them under the old join rule fails the window law. Pinned cases cover a null-ranked root row past a prefix that ends in the null group. Paging a nulls-last full join passed this oracle but was not adopted: it cost more per delete when the window reached the null group, which no work law here measures, and #2130 tracks full-join paging. Joined filters can match a row through several markers, and the model keeps one result row per matched pair; a model that collapses them fails. The eager harness also runs an on-demand source whose provider follows the LoadSubsetOptions contract (offset only without a cursor, the applied receipt returned). Its test provider combines a sync adapter and its provider (glossary model alignment rule 2); a held request is a physical acquisition whose provider answer is delayed, a served range is the prefix and boundary one answer establishes (a model abstraction), and the peer is a second live-query Collection. The provider sorts by the requested order and keeps its own ledger of sent rows. A forwarding provider sends live changes only for rows it sent or rows that match a served subset, and its served rows obey the work bound; a loader that asks for 100 extra rows fails it. A refetching provider, like query-db-collection, sends nothing until a refetch. The refetch keeps every served ordered range whole, as the LoadSubset contract requires: it sends every row from the start of the order through the last order value a limited page returned, and rows in no range leave; the rows law over the model applies once no change is pending. After every step on either provider, the Collection must hold exactly the rows in the provider's ledger, and the query and the Effect must show their window over those rows; a mutant that drops marker removals fails this law at steps 0 and 1 of the fixed refetching campaigns, earlier than the model's rows law, and in one more campaign. A holding provider answers each load only at an `answer` step, from the rows at that moment, so live changes arrive while loads are in flight. While a load is in flight, the query and its peer either keep the window they showed at the previous checkpoint or show distinct ledger rows that pass the query, in its order; the Effect is not checked then. That is weaker than the architecture's barrier rule, under which a repair or window move keeps the last public snapshot until it settles: a barrier law fails today on on-demand joined plans, where a visible-delete repair and a held `setWindow` publish before they settle (#2131; the law and traces are kept for that fix). The provider records a request as served only once it answers it, and an abort (or an adapter unload) of a held request follows `LoadSubsetOptions.signal`: a cooperative provider installs none of its rows and its load fulfills at once, while a provider that cannot cancel in-flight work (`late` cancellation, generated) answers it anyway and its load fulfills after those rows become visible. A `release-peer` step cleans up the peer while its loads are held, which aborts them; each request counts once although its acquisition release both aborts and unloads it. The fixed held campaign reaches 5 aborted held requests and 1 late answer, and its reconstruction check requires at least 3 cooperative cancellations and 1 late answer. A held load rejects when its applied receipt rejects, and the step then fails, because no signal or cleanup rejects a receipt in these histories; that branch is unwitnessed. The held campaign pins a forwarding provider, so `release-peer` never reaches a refetching provider; that branch is unwitnessed. A request whose signal is already aborted when the provider receives it is never reached; that branch is unwitnessed. The held campaign uses a forwarding provider and an indexed source filter or a joined filter, deletes three visible rows and then upserts an eligible row with an id no other command uses; its reconstruction check runs in the same test as the fixed-seed campaign and reads its per-case counts: 35 of 40 cases issue a held request, and every one of them changes rows while it is in flight. Loading must reach a fixed point: past a request budget the provider rejects and records it, and the initial load, every step and the end of each history assert the record is clear (a loader that re-requests a prefix it already holds can loop without reaching the provider, which this cannot see). A bounded step makes at most four provider requests, and each consumer's initial proven-prefix load is bounded separately, in total transfers (a repeated request for the same prefix counts) and in distinct rows (at most the source's size); a loader that asks for 100 extra rows on every page fails that bound and the initial-load work law. Loader mutants that never resume after a boundary request, or that ignore a load request while another load is pending, fail it; a mutant that drops a window move blocked behind a pending load still survives, even with the settlement check on held moves; whether it is equivalent is open. Open (#2148): on an on-demand source with a joined or anti-joined filter, an optimistic delete of the visible row leaves the window short until the delete persists, because the next row is never loaded. On an on-demand source with a source filter, and on an eager source with any filter, the same delete refills the window correctly; these are the contrast cases. Owner: this oracle. Needed witness: the optimistic-delete dimension (kept as a patch for #2148) in the grammar, plus a pinned replay of the anti-join trace. A refetch that re-runs each page alone, as query-db-collection does today, leaves a row that moved between two pages unloaded; random seeds found that trace, a named replay fails on it, and a query-db receiving witness reproduces it (#2136 tracks the provider fix). An Electric-style provider, which skips updates to rows it never sent, is not modeled; a mocked-stream witness shows a row moving into a served ordered range never arriving under the default replica mode (#2138). At one times the run count, the campaigns reach 87 refetch steps: 39 change the window, 6 remove a visible row, and 13 lead to a further provider request. A random seed found a refetch that empties a joined window, after which the loader refills it over several page requests and publishes `[]`, one row, then the final rows; a named replay keeps that trace for #2131. No incorrect final window has appeared on that path, and no loader mutant tried so far is caught only by it; the work law does not cover it. For an on-demand joined or anti-joined filter, the initial load must not request the whole source when the first window's worth of source rows in query order all pass the join and no boundary value is null or NaN; 35 executed cases meet that premise, and a compiler that reads the whole source for every joined filter fails eight tests on this law alone. The rows served by that initial load stay within the prefix, its boundary ties and a refill, for each consumer. Later steps of those plans have no work bound. An unindexed join filter over it left the window empty on main, until the plan counted the rows it still needs; restoring the old guard fails the campaigns and a pinned replay. A step that changes the visible rows must publish, and its subscriber starts with every visible key, so a removal-only change reaches it; mutants that drop update-only or removal-only publications fail. A step may publish one intermediate window per provider request it made, and only its last publication must show the final window, because a repair or refill can publish after each round trip (#2131); the content of those intermediate windows is unchecked. The model keeps its own copy of the markers, and full-join histories can insert the root rows of orphan markers. A premise-directed campaign inserts a fresh row and then changes an initial row's eligibility alone, so the row leaves the window only through the join; it and a named replay fail when a window row past the loader's settled boundary counts toward a full window. One case in four adds a second live query over the same sources with a larger window, and its rows law holds at every checkpoint; the work laws do not apply to those cases. #2155: a second live-query Collection over a refetching on-demand provider kept a short joined window after a refetch removed a tied row (the peer showed ranks `[0, 0]` where the model shows `[0, 0, 100]`). The loader fix that resumes a staged continuation after a synchronous answer the graph already processed closed that trace. The pinned replay of that indexed trace now expects the right window. Still open: an unindexed peer over a refetching provider keeps a short joined window (the peer shows `[100]` where the model shows `[100, 101]`), which also fails without that fix; each campaign therefore still excludes the peer and refetching pairing, as its last map. Owner: this oracle. Needed witness: a pinned replay of the unindexed trace flipped to pass, and the pairing restored to the grammar. Limits: Effects are checked for rows after each step, not for publication counts or positions. Histories move the first query's window with `setWindow` (150 moves at one times the run count, 56 on demand), and its rows law and ledger law then follow the moved window; the Effect and the peer keep theirs. On a holding provider every window-move promise must have fulfilled after the final drain. A refetching provider models query-db's unload: it drops the unloaded request and removes rows that no remaining request's last answer holds. The per-step work law applies only to forwarding, immediate, single-consumer cases: it skips refetching, holding and peer cases and move steps; a two-term indexed move scanned the source four times, which no law here bounds. Multi-term joined plans stay outside this harness, on both paths; on the on-demand path, the provider's transfer is bounded only for indexed single-term source-predicate plans. Joined windows compare order values, so a wrong row tied with the expected one passes; a window row tied with the boundary counts as proven before its tie request settles, which no witness exercises. A boundary that cannot advance past a window row would repeat one page per new key; reading the boundary's range locally should always reach that row, but no witness shows it. Joined ties are compared as any valid first rows; whether source-filter ties may be fixed to the source key is open. The same grammar includes NaN and null ranks and a second-order term, and bounds both rows read and rows delivered, including the initial load and index refills; a scan law limits each change to one pass over the source. A pinned case checks that an indexed descending window places nulls first, and a lifecycle witness checks that an eager full-source window is ready with its rows at creation when its source answers synchronously. The initial fallback cells check indexed and unindexed locale strings with distinct and tied values, plus a null boundary after a warm ordered request. The warm null-boundary case crosses preload-started and constructor-started live-query sync runs: the former completes at the synchronous cut, while the latter resumes deferred on-demand acquisition asynchronously and publishes after settlement. They require an unfiltered full-source request, no public row at fallback entry, and the expected row and status at the immediate readiness check. A Promise fallback stays loading at that checkpoint. A React receiving witness checks an eager locale-string `findOne()` at the first layout commit. A Query DB receiving witness checks warm cached subsets: both raw adapter calls return literal `true` with the source rows visible at each return, and the live query is immediately ready without a fetch. The same fallback cells observe subscriber changes from before the first source write: literal-true and Promise fallbacks each publish one nonempty final-window insert after the fallback settles, and the callback sees the complete row. Promise cells show no nonempty event at the immediate cut; a duplicate-event fault fails all eight cells. Other adapters and a real on-demand React first commit remain unwitnessed. Full-source work after initial publication and repair remain outside this synchronous guarantee. A separate post-publication oracle crosses marker deletion and retargeting with literal, Promise, and held-applied-receipt fallback responses. It also settles the child demand before holding the receipt, so the public live-query loading flag isolates the root fallback. The model checks final rows and net events, while event replay checks every callback snapshot; a retained or empty intermediate window is allowed. A loader fault that ignores the pending receipt fails at the held loading-flag check. Two literal-true cleanup-failure histories require that the replacement still publishes and the adapter error reaches the public query status without making the unrelated marker commit throw; the provider's applied receipts are recorded and compared outside provider callbacks. The Promise case checks eventual coherence on an asynchronous callback path, without claiming a separate timing cut. Four held-Promise histories apply fallback writes, change another join marker before provider settlement, and compare each callback and the final winner; an injected stale extra publication fails the event comparison. Other marker actions and overlapping root-source changes remain open; the provider has no later write or rejection, so this schedule does not establish when the loader claims full-source authority. The reversed-index oracle checks every reversed read's order and filter work for both null placements.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

| Indexed predicate filtering | `packages/db/tests/query/index-path-collision-oracle.test.ts` | A bounded cross product of numeric values checks exact public keys before and after adding a nested-field BTree index. Direct predicates vary argument order, bound inclusivity, reversed operands, and bound field. Public Collection subscription and live-query callbacks run with and without the index. Selected-field ordering compares a direct JavaScript sort with a public `$selected` callback; restoring the dotted-key proxy cache made that comparison fail. The original compound grouping failed four indexed cases while scan controls passed. The original callback proxy caches also failed both unindexed public routes. A hostile cleanup control preserves the primary mismatch and secondary release error. Arbitrary path segments, nullish values, custom collation, and incremental publication need separate witnesses if claimed. |
| Lazy target path identity | `packages/db/tests/query/compiler/lazy-targets.test.ts` | A focused same-source `UnionFrom`/`coalesce` witness requires both [`a.b`] and [`a`, `b`] demand targets. Restoring dotted-string deduplication drops the second target at the compiler boundary. A public on-demand adapter and row-publication history still need a separate witness. |
| Correlated include path identity | `packages/db/tests/query/includes-context-transport-oracle.test.ts` | A flat parent field and nested parent field reach one-level and nested `toArray` results independently; dotted ancestor aliases remain distinct through a grandchild route. Initial results and parent updates have exact public-value checks. A conditional projection gives [`a.b`] and [`a`, `b`] different include results and checks parent-key changes plus later child inserts. Removing the compiler's unique route-key allocator loses a public child result; restoring dotted-string deduplication at either builder site loses a distinct parent value. These fixed witnesses do not establish arbitrary path segments, every recursive source form, or every materialization form. |
| Alias scope identity | `packages/db/tests/query/includes-oracle.property.test.ts` (`includes alpha-renaming across lexical scopes`), `packages/db/tests/query/includes-scope-identity-oracle.ts`, `packages/db/tests/query/includes-alias-shadowing-oracle.test.ts`, `packages/db/tests/query/includes-outer-join-route-work-oracle.test.ts`, `packages/db/tests/query/validate-aliases.test.ts`, [issue #1975 review](oracle-reviews/issue-1975-scope-identity.md) | Four topologies place a source beside a same-named source: a `from()` subquery with an include, a joined `unionAll()` branch with an include, a collapsed top-level pure wrapper with a join subquery, and an include directly on a joined `unionAll()`, which may reuse a branch alias. The grammar crosses zero to two joins, LEFT or INNER, zero to two predicates, plain, ordered-and-limited, or DISTINCT bodies, include forms, and eager or on-demand finite providers, after preload and after source writes. Includes read their source directly, through a join, through a `unionAll()` with an anchor join, or through a `from()` subquery that reads the parent row. One in four scenarios draws any naming; same-scope and union-branch repeats are rejected while ancestor shadowing is admitted. Each checkpoint compares the canonical naming with plain recomputation, the generated naming with the canonical naming, and per-Collection `loadSubset` WHERE clauses. The exact-output companion independently recomputes parent-child rows for direct, QueryRef, union, and implicit-join forms across two equality operand orders, shadowed and renamed aliases, eager and on-demand children, initial publication and parent/child writes. The recursive forms keep a required outer lockId correlation and an independent captured lockName predicate; the union has a nonempty right branch and a later two-branch overlap. It checks enumerable user and virtual key names, user values, multiplicity, sibling helper reuse, a fresh parent/inner QueryRef declaration across a source update, direct, child union-branch, parent union-branch, parent QueryRef, and nested-include rejection of ancestor/descendant builder reuse, one nested grandparent capture, functional callback child input, grouping, captured whole-row and nested-path spreads across shadowed and renamed aliases, eager and on-demand children, and parent/child writes, and query identity. Focused follow-up cells check same-path group keys under shadowing and renaming through parent and child writes, alpha-renamed pure wrappers at public-row and optimized-identity cuts, and indexed lazy demand for direct or wrapped nested includes through anchor and user writes. Wrong-query controls that drop either inner predicate or substitute a parent-shaped callback value fail at the initial public-row comparison. A finite follow-up crosses direct includes and joined QueryRefs with shadowed or renamed aliases, eager or on-demand sources, and child IDs equal to or distinct from an outer filter literal; it checks public rows and on-demand child admission after preload. Another follow-up projects a captured parent rank through a child QueryRef and checks public rows after preload, a child-rank change, and a parent-rank change. The original compiler misrouted the outer filter in four cases, and the original optimizer lost the captured binding in two cases at their first public-row comparison. Every pinned witness and both campaigns fail on `18abceee4`; each of the four optimizer re-mint sites fails a witness when reverted. Arbitrary nested includes, include-inside-subquery forms beyond the checked LEFT joined QueryRef, other join-subquery topologies, `having`, outer joins beyond the bounded RIGHT/FULL matrix, publication events, unload, ordered windows, other lazy join targets, and temporal demand remain outside these owners; they need witnesses before an alias-scope closure claim covers them. Ancestor/descendant builder reuse is rejected before correlation extraction; one helper builder remains legal across a parent QueryRef, union branch, or joined QueryRef and a sibling include child. Six placement/source-mode cells check construction, exact rows after preload, and a source update; the joined placement includes an unmatched manager that would expose a missing helper join. The original source-tree guard rejects all six. A discarded enumeration of a captured proxy cannot change the selected query identity or rows before or after a child update; the retained-marker implementation fails that identity check. The [PR #2079 follow-up](oracle-reviews/issue-2072-alias-shadowing-followup.md) records its RED trace, the repaired spread and nested-QueryRef cells, and the remaining compiler and optimizer evidence gaps. The [ad5e0108 review](oracle-reviews/issue-2072-alias-shadowing-ad5e0108.md) adds a self-join with an inner alias matching the outer joined source, a joined child whose local source competes with inherited parent context in matched and unmatched LEFT joins, captured/local spreads, grandparent whole-row capture, and direct captured-alias selection. These finite cells compare public rows after preload and selected writes; an alias-only lazy-target mutant fails the eager self-join comparison. The reported on-demand failure did not reproduce with the controlled source. A further finite matrix crosses nested FROM or JOIN placement, field or whole-row capture of a shadowed outer joined alias, shadowed or renamed spelling, and eager or on-demand acquisition. It compares source-role rows after preload, child deletion and movement, joined-row update and movement, and parent update; on-demand cases compare nonempty request sets. Disabling projected binding lookup fails all eight cells at the initial public-row assertion; an alias-only lazy-target mutant survives this matrix, so it adds no broader lazy-target claim. A bounded outer-join extension crosses RIGHT and FULL joins, main- or joined-side correlation, direct and QueryRef joined sources, shadowed and renamed aliases, eager and on-demand sources, two parent routes, and seven initial or post-write cuts. Its independent source-role model checks exact public rows, including both absent sides; on-demand cells also require source acquisition. A join-operand extension crosses an ancestor term combined with a local main or joined term, or serving as the whole main key, with equality reversal, alias renaming, source mode, and five public-row cuts. The [outer-join follow-up](oracle-reviews/issue-2072-alias-shadowing-outer-joins.md) records RED and GREEN evidence. A foreign captured join operand must reject: a finite provenance matrix checks root and include placements, matching or different alias spelling, and eager or on-demand sources at construction or preload settlement; valid local and captured-ancestor operands remain controls. A two-LEFT-join history now checks that a later routed QueryRef or captured operand cannot restore an absent shadowed local source, across alias renaming, eager/on-demand mode, two parents, and local and second-joined arrival/removal. It also selects and updates a parent label while joins are matched, checking that the main route retains that ancestor value. A nested joined QueryRef control projects its join key from an inner tag source while the post alias shadows or renames an outer user alias; an independent plain-row model and installed on-demand post/tag rows are compared at preload, a user-key move, and a tag update. A wrong Collection/SourceId pair loads an irrelevant post at preload and fails the installed-row check. Other nested source shapes and real-provider request schedules remain outside this control. The route-work owner compares public rows and assembled parent-route work as irrelevant joined rows grow for direct main-correlated RIGHT/FULL joins in both source modes; an unconditional-route mutant grows from two to six pairs at preload. RIGHT joins correlated on main now join the outer-join row matrix, beside joined-side correlation and FULL controls. An include child rejects a bound join operand declared inside its parent QueryRef or union branch, across matching/renamed aliases and eager/on-demand sources; the original source-tree collector resolves preload instead of rejecting. A joined QueryRef rejects a captured source declared beside it in the enclosing query: the matrix crosses root/include placement, matching/renamed inner alias, and eager/on-demand sources; four true-ancestor controls assert rows, and the permissive sibling-scope mutant fails all eight invalid cells while those controls pass. The primary oracle now extends the hidden-source rejection through two QueryRef or union levels, with matching/renamed aliases and both source modes; a source-tree-binding mutant fails all eight added cells at the rejection cut. An unrelated bound reference is rejected in WHERE, GROUP BY, HAVING, ORDER BY, direct SELECT, and conditional SELECT across matching/renamed aliases; legal local controls and a grouped include with captured ancestor predicates, HAVING, ordering, shadowing, and parent/child writes prevent a blanket rejection. It also rejects foreign references moved into extracted include parent filters or into the removed correlation equality, each across alias spelling and source mode with valid parent controls. Disabling expression validation fails twelve non-join cells; omitting parent-filter or extracted-correlation validation fails four cells each. A separate plain relational model checks RIGHT-to-LEFT, RIGHT-to-RIGHT, FULL-to-FULL, and FULL-to-LEFT two-join chains under shadowing/renaming, both source modes, main/joined/tag correlation, and six source or ancestor writes; a later-FULL-as-LEFT mutant fails two initial public-row comparisons. The route-work owner now compares public rows and parent-route assembly counts at preload and four main-source writes while irrelevant joined rows grow. Other expression forms, arbitrary join-subquery and lazy-target shapes, deeper captures, other chained outer joins, real-provider schedules, and broader source-work bounds remain open under this owner. The alias-scope owner also checks outer grouping through a nested QueryRef and joined source with shadowed or renamed inner alias, eager or on-demand acquisition, and four source/tag writes at five public-row cuts. The tag insertion duplicates one joined source and the plain model counts both copies. A controlled rewrite probe reached an unbound pushed WHERE inside the QueryRef while the bound GROUP BY remained outside; an inner GROUP BY blocked that pushdown. A matcher mutant that ignored binding IDs failed two same-path group cells at the first public-row cut; a dropped-pushed-predicate mutant failed all four new cells by publishing an extra group. This refutes the reported WHERE-rewrite-to-GROUP-BY-matcher route in those shapes; another lost-provenance route needs a concrete fixture. Base/head work probes confirmed an extra pure-wrapper stage after #2079, but the same full-source outer-WHERE request and keyed lazy-join request on both revisions. No wrapper-stage work budget or safe binding remap is established. Bound root refs caused two route-metadata symbol checks per evaluation on the current head versus zero on base, while captured-ancestor rows remain protected by the primary oracle; a compile-time fast path needs a justified work budget and a preservation witness. The same function-form subquery placed twice compiled two results and invoked its callback four times for two source rows on both revisions. Cache comparison read more query properties on the current head, and a stateful callback produced placement-specific values. A callback identity or purity rule and work budget are needed before cache-equivalence changes. |
| Join equality and cold acquisition | `packages/db/tests/query/cold-join-reconciliation-oracle.test.ts` | Independent recomputation for cold acquisition plus direct join/predicate equivalence across established equality domains. Binary/string and nullish classes, replacement histories, raw on-demand values, and both scan/auto-index paths are explicit; the compound lane also covers tuple equality, term order, all four join types, controlled cold sources, and keyed histories. Positive acquisition witnesses require a satisfiable tuple. |
| Aggregate selects | [aggregate select oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/aggregate-select-oracle.property.test.ts) | Generated select shapes of aggregate queries with and without `groupBy` by `c.k`, the pair `c.k`, `gt(c.v, 1)`, the triple that adds `gt(c.v, 2)`, `upper(c.k)`, `inArray(c.k, ['a', 'b'])`, a Date-valued `coalesce` or a `NaN`-valued `add`, rebuilt per use (literals, parent fields, the group key, the raw field `c.k`, source fields, `count`/`sum`/`max`, `add`, `caseWhen` with expression or object branches, nested objects, spreads, a nested include) and a HAVING condition that may compare an aggregate, selected as a field or not, at the top level, directly or through a `unionAll`, and in an include whose source may shadow the parent alias, through parent updates and source inserts, updates (including key changes that move a row to another group and route) and deletes. A shape throws `NonAggregateExpressionNotInGroupByError` exactly when a non-key source field appears outside an aggregate in its select or HAVING, or the shape spreads a row or holds a nested include; otherwise every published group equals the model and keeps the select's field order. The same grammar checks the opt-in operator laws: a grouped query whose select and HAVING hold no aggregate throws `GroupingOperatorRequiredError` when its keys are passed bare, and works through `groupKeys()`; a bare query builder throws `IncludeOperatorRequiredError` as a field, inside a nested object, or in a conditional branch; a wrapped include inside a nested object throws (a conditional branch may be an include; the includes-collection oracle publishes one, and a compiler that rejects one fails both that oracle and this one). When several errors apply, any one of them passes. Includes are wrapped in `toArray()`, `include()`, or `materialize()`. In three generated histories of six, the driver strips one kind of operator code, the grouping compiler, the include runtime, or the grouping compiler of the `orderBy` aggregate only, from the IR it built. One history in three is a forced history that strips the grouping compiler everywhere or from `orderBy` only, with no, one, or two group keys in turn, so every campaign reaches each path and compiles it through `new BaseQueryBuilder(ir)`; IR without its operator code must throw the coded error for the missing operator. A runtime-stripped history gives its include a child query that is valid on its own, so other errors cannot hide the missing runtime. Half the grouping-stripped histories give the top-level query a select of `count()` alone, with an aggregate HAVING when the generated shape has one, so a model error set of exactly `groupingRequired` witnesses the grouped, one-group, and HAVING paths. The top-level and include queries may order their groups with one or two `orderBy` calls, each on an aggregate or on a number or string select field through `$selected`, strings with the documented `en-US` collation: published rows and each parent's `kids` fall into blocks of equal values in that order. An `orderBy` aggregate that no top-level field selects throws `AggregateFunctionNotInSelectError` (now stated in the guide's "Ordering by SELECT Fields"), and a stripped `orderBy` aggregate compiles with the compiler that `groupKeys()` or a select or HAVING aggregate brings. One history in four takes ordered shapes from a grammar whose shapes compile, because generated ordered shapes compile in about one case in forty; the source starts with a key `A`, where locale and code-unit order differ. The property declares twenty-one states with `createOracleReach`, and each campaign of 160 histories reaches each of them; without the forced select, the one-group and HAVING states were never reached, and a mutant that throws the wrong error class only on the implicit path passed three campaigns. Pinned witnesses in `hand-built-ir-operators.test.ts` cover the old `IncludesSubquery` argument order, an aggregate only in `orderBy` without a select aggregate, and the mixed `orderBy` replay. The compiler before the order step took the query's grouping compiler fails the generated `orderBy` dimension (`top compiles`); an order step that ignores direction, keeps only the first `orderBy` call, or sorts strings by code unit, an include query that ignores direction, a group step that keeps only the first one or two keys, and a check that throws the wrong error class only beside HAVING each fail it (the last passed two of three campaigns before the alone states). A mutant without the include-runtime check, which publishes `kids: null`, and one without the grouping guard, which throws a `TypeError`, both fail it. A mutant that skips the grouping-operator check fails it with a `TypeError`, and one that treats a bare builder as an include fails it with the wrong error class. Open: an `orderBy` term on a raw expression other than an aggregate, and on boolean, Date, `NaN`, or object fields, whose order the docs do not state. The operator laws are generated only for aggregate and grouped selects; for plain selects, `includes.test.ts` pins a bare builder as a field, nested, and in a conditional, because this model publishes one row per group and needs a separate row-per-source model for them. |
| Query optimizer semantics | `packages/db/tests/query/optimizer-semantics-oracle.test.ts`, [aggregate review](oracle-reviews/2026-09-28-optimizer-aggregate-pushdown.md), [QueryRef repair](oracle-reviews/2026-09-30-queryref-publication-repair.md), [residual review](oracle-reviews/2026-10-01-pr-1977-residual-convergence.md) | Independent sum recomputation and a materialized-Collection formulation check the first public snapshot of a nested aggregate under a left join. Direct, arithmetic-wrapped, and conditional aggregates distinguish safe from unsafe pushdown; a grouped-key control covers the grouped boundary. Matching and nonmatching global aggregates also cross a nested QueryRef inner join with absent, accepting, and rejecting outer predicates. The matching initial cases fail on the pre-repair revision and pass after the computed-projection lookup repair. A separate fixed residual-convergence grammar checks exact predicate and outer WHERE clause counts at `optimizeQuery` return and after re-optimization: LEFT, RIGHT, INNER, and FULL joins; equality, greater-than, nullable-field `isUndefined`, same-source OR, cross-source equality, clause order, separate/AND form, two active predicates, two residual sources, and an existing residual marker. Plain-array LEFT/RIGHT and three-source join models check first public rows, including unmatched rows. Arbitrary expressions, more complex join chains, and incremental optimizer/publication histories remain outside this owner. |
| QueryRef operators and user-value boundaries | `packages/db/tests/query/subquery-user-value-oracle.test.ts`, `packages/db/tests/transactions.test.ts`, [repair record](oracle-reviews/2026-09-30-queryref-publication-repair.md) | A finite array/Set model checks the compiled output bag for a joined DISTINCT subquery with an outer WHERE. Live-query drivers check selected containers, no-select, functional, and predicate-literal user objects with IR-like fields, top-level and aggregate-subquery proxy-shaped fields, arrays of selected references, outer virtual-field filters on joined DISTINCT and nested aggregate QueryRefs, and a renamed no-select source. The transaction suite documents the existing development-browser duplicate-load guard. The bounded cases run in `test:oracles` or the full DB suite. Joined DISTINCT, nested and flat aggregate source-update histories pass. Ordered joined `findOne()` checks initial, singleton, empty, restored, and changed-join-key cuts; an unordered `findOne()` QueryRef on either side of a join checks default-key candidate deletion and reinsertion. A materialized joined `findOne()` supplies a separate receiving formulation. Other `singleResult` forms, join forms, schedules, and cross-copy value handling outside the duplicate-load guard remain unproved. |
| Opaque backend pagination | [window oracle](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination.oracle.test.ts), [cache histories](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination.cache-oracle.test.ts), [cache publication](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination.publication-oracle.test.ts), [browser acquisition boundaries](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination.boundary-oracle.test.ts), [QueryCollection integration](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination-oracle.integration.test.ts) | Full filter/sort/slice reference, opaque token transport, actual Query cache expiry/invalidation/GC, forced refresh during growth, protocol failure publication/recovery, bounded slice work, nested cancellation/replacement, reader abort, browser retry defaults, manual-write cache isolation, and production window publications. Stable backend sequences; not snapshot guarantees for changing endpoints. Peek-ahead remains enabled. |
| Experimental no-peek continuation | [test-only live-window probe](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination-oracle.no-peek.integration.test.ts) | The candidate uses an authoritative fact only for the same complete output prefix and otherwise requests the extra row. It remains test-only; the shipped opaque-pagination owner keeps peek-ahead. See [experiment limits](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/cursor-pagination/NO-PEEK-RESULTS.md). |
| Electric and TrailBase                       | [Electric histories](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/tests/electric-oracle.property.test.ts), [recovery histories](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/tests/electric-recovery-oracle.test.ts), [held resume snapshots](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/tests/electric-resume-snapshot-races.test.ts), [PostgreSQL semantics](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/e2e/sql-predicate-semantics-oracle.e2e.test.ts), [TrailBase contract](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/tests/ORACLE.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Installed SDK delivery/framing, independent predicates, exact subscription arguments, restart/reset lineage, held certification and durability races, source-order publication before durability, and late errors. The queued-presence property runs identical fixed/random generators plus isolated seed-and-path replay across insert, update, delete, and truncate callbacks. The recovery fixtures use a mocked ShapeStream; they do not establish live Electric-service framing or native persistence-host behavior. The TrailBase lifecycle oracle's early-demand lane checks that an on-demand load issued before the change listener runs does not fetch until the listener runs or cannot start, through a real live query and the subset boundary: 16 histories cross listen, subscribe rejection, reader failure, abort, and cleanup with a service change before the subscription; the adapter from before the wait fails all 16. Its page-event lane checks that a page read before a concurrent change event neither reverts nor resurrects that row, and its stream-end lane pins that the adapter does not resubscribe: 17 histories, 6 of which fail on the adapter before the page fence. A generated page lane (`trailbase.page-event`) crosses two-page loads, cursor and offset paging, overlapping on-demand loads, and up to four changes among page releases. A held-commit lane checks that a page never fails a load for an older event that core holds while a user mutation persists; deciding insert or update from visible rows fails it. After a generated history drains, the Collection holds exactly the rows a page returned or an event touched. Both page lanes deliver events for changes made before the list call at once, during the page, or after it applies, and check that the listener survives a late insert for a row a page already holds. The retry-decision property (`electric.retry-decision`) generates histories over full-log and progressive waits, with and without `onError`, crossing synchronous and asynchronous retries and give-ups, a throwing `onError`, a later error after a retry, an Electric client give-up, an external abort before or during a decision, new demands, the first up-to-date, a persisting optimistic transaction that holds the retried snapshot and later settles, and cleanup. The retry-decision grammar also crosses eager and changes-only sources, an external signal already aborted at sync start, and a status listener that cleans up inside the failure; it checks that a readiness wait rejects with the same cause as every waiting demand, and that such a cleanup leaves a rejected demand rejected. It also holds the acceptance of the first up-to-date commit across later errors, retries, give-ups, and aborts, and checks that the Collection becomes ready with the snapshot's rows when the commit is accepted, and fails with the acceptance's cause when it is not. The descriptor-isolation oracle holds that acceptance across a managed-cache rotation and checks that the retired session's acceptance settles nothing, whether it resolves or rejects, and that the replacement session's snapshot decides readiness. A progressive snapshot's truncate applies at once; a demand whose snapshot arrived before an external abort settles when its rows apply, and cleanup after the abort rejects it. An independent model checks the status, every demand's settlement and cause, and row visibility after each step: a source that still tries stays `loading`, and only a give-up fails its waits. `main` before #2127 and mutants that fail before the decision, skip the failure on a throw or give-up, or skip `markError` on a client give-up or an external abort each fail it at an assertion. An installed-client lane in the SDK delivery oracle drives the same model (`electric-retry-decision-model.ts`) through the real Electric client and HTTP: a retried 503, a response without Electric headers, and an exhausted 50-retry budget, in eager, full-log, and progressive modes, with a synchronous or asynchronous retry (18 cells). Skipping `markError` on the client's give-up fails the 12 give-up cells; failing before the decision, or `main` before #2127, fails 15; the 3 survivors give up in the same continuation that decides, so an early failure is not observable there. A mutant that settles a held demand on acceptance instead of visibility fails the held replays. Excluded: stream steps while `onError` decides or after a final failure, which the client cannot produce. The source-release property (`electric.sdk-source-release`) checks that cleanup removes every `visibilitychange` listener that the installed client registered for a sync run's streams: one to three runs in eager, on-demand, and progressive modes, each answering up to three requests with row-only delivery, an up-to-date, an HTTP 409 reset, or a retried 503, then staying open, giving up, aborting the external signal, or holding an asynchronous retry/give-up decision through cleanup and later runs, with restarts through `preload()`. It declares separate cleanup reach for partial delivery, reset before a later up-to-date, and a pending error decision. The minimal partial/reset histories cross all five endings in every sync mode through the same driver. It compares the live listener count with the number of active runs after each step. The recorder tracks ordered callback/capture identities with duplicate-add semantics; all 8,421 add/remove histories of length zero to three over two callbacks and five capture spellings compare its count with native EventTarget dispatch before teardown. Recorder teardown independently removes retained registrations after the comparison; bounded callback-subset enumeration checks actual EventTarget dispatch and preservation of a primary failure. `main` before the fix, and mutants that release only while the stream is unaborted or only without a final initial failure, fail it at cleanup; the generated managed-rotation property (`electric.sdk-rotation-release`) checks the approved Electric deadline before replacement `ShapeStream` construction. It rotates one to three times in one on-demand sync run, so a replacement session is itself retired. Each old HTTP snapshot arrives during held rotation, before replacement snapshots, or after their settlement. It declares reach for all three delivery cuts, initial/replacement session retirement, and demands awaiting replacement source responses. A transparent constructor observer records zero retired listeners immediately before the real SDK constructor; both retained demands stay pending while rotation is held and before any replacement response, then fulfill after their source snapshots apply. Fresh public/current-generation durable rows, late old-response rejection, and final cleanup comparisons remain. Each round also remembers its retired storage target and checks that the late response's absent key reaches neither that target after delivery nor after replacement settlement. The seventh declared state requires this retired-target observation. This constrains the expired session's row; unrelated retained rows remain allowed, and a separate run with a valid claim can still use a retired generation. Assertion inputs copy mutable observations so cleanup cannot change their failure payload. The browser listener is observed in jsdom; React Native's AppState adapter and overlapping rotations are outside this generated lane. |
| PowerSync                                    | [tests](https://github.com/TanStack/db/tree/main/packages/powersync-db-collection/tests), `tests/correctness-oracle.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Applied receipt positions crossed with held peers, native SQLite/SDK and cleanup evidence. A metadata-bearing `Collection.update` passes through an observed SDK watcher callback to the public and SQLite rows and an exact queued CRUD patch. Held callback ordering and synthetic zero-field cases remain controlled-only, and remote upload has no receiving fixture here. Run the focused owner with the package's `test:oracles` command. A timeout mutant proves a progress failure, not every value assertion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| SQLite persistence and native hosts          | [persisted histories](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts), [reset/resume histories](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/sqlite-core-adapter-oracle.test.ts), [setup reopen](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/collection-setup-reopen-oracle.test.ts), [reload class](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/reload-class-oracle.ts), [dual-adapter resume snapshots](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts), [Browser composed-owner histories](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/per-collection-coordinator-oracle.test.ts), [Browser coordinator RPC](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/browser-coordinator-oracle.test.ts), [shared-driver fairness](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/shared-driver-fairness-oracle.test.ts), [driver contracts](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract.ts), [Node shared-handle scheduling](https://github.com/TanStack/db/blob/main/packages/node-db-sqlite-persistence/tests/node-driver.test.ts), [OP-SQLite shared-handle scheduling](https://github.com/TanStack/db/blob/main/packages/react-native-db-sqlite-persistence/tests/op-sqlite-driver-oracle.test.ts), [browser OPFS lifecycle](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/opfs-page-lifecycle-oracle.test.ts), [worker diagnostics](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/opfs-worker-diagnostics-oracle.test.ts), [request order](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/opfs-request-order-oracle.ts), [Electron IPC and composed owner](https://github.com/TanStack/db/blob/main/packages/electron-db-sqlite-persistence/tests/electron-ipc.test.ts), [113-law manifest](https://github.com/TanStack/db/blob/main/packages/db-collection-e2e/src/fixtures/persisted-conformance-manifest.ts) | Core cache/remote rejection/peer/reopen histories, atomic reset/resume lineage, key-set evidence, dual-adapter races, queued coordinator reload/gap notifications during startup, unscheduled startup/reset overlap, and exact driver results. The setup-reopen owner checks that a fresh adapter's first read repairs an interrupted setup, every subset of missing indexes, triggers, and bookkeeping rows, and a schema change to the fresh-install schema with rows kept or reset; complete setup costs at most one driver call over a cached read. It excludes cache-generation claims and concurrent adapters; the held-registration resume cases cover a collected generation at the setup DDL and at the registry read. The reload class owner keeps the reload law, model, histories, driver loop, and comparison in one module, with four production drivers: the Node Browser driver (real Browser persistence and coordinator, one connection per tab), the Node Electron driver (real renderers and main handler with an in-process `ipcMain` double), the real Chromium OPFS page, and a real Electron app (renderer over real IPC to a main process running the Node persistence over `node:sqlite`). Histories cover 1 to 4 eager or managed Collections with any subset of missing derived setup facts, a schema change, a database missing a migrated column or index, lock grants 1 to 5 tasks after the request, statement latency where the host controls it, a local write during another startup read (issued before or after its grant), a write held in flight at another Collection's grant, a follower write, a write from a third tab, takeover (also while a follower read is held after an earlier follower or third-tab write, and while a follower that knows the departed leader's route has a source commit queued behind a held subset read, which it flushes after the grant or which the departed leader received and never answered), restart, and a tab closed while its terms wait. It checks skipped and repaired Collection and database setup, that no term runs ahead of work queued on its tab at its grant unless a leader need is live in that election (a need that an earlier election served exempts none), that needs elect and settle, that a takeover's queued source commit settles within one RPC timeout (one timeout and a retry when the departed leader received it), and an exact per-reload budget: one registry read per adapter, one row scan per tab, two startup snapshots per eager Collection (metadata before the source starts, rows at the baseline hydrate, both required by the Electric resume laws), no rescan after a commit the tab already knows, and no database setup statement when it is complete. The implementation on origin/main fails every fixed history: the original 24 on all four drivers, and the 5 that cover per-election needs on the Node Browser driver. Production on this branch passes all 29 on all four drivers. The Node drivers reject 14 production mutants by assertion, including a lasting need latch, an earlier served need from this tab or another, a need still waiting at the grant that is ignored, and a grant that keeps the departed leader's route. The Browser coordinator RPC owner's per-election cells also reject those latches and a delayed heartbeat from the departed leader that restores its route during an election. Real Chromium rejects the never-waiting barrier across its histories; the real Electron app rejects it in 10 of the 29 fixed histories; in the others, real IPC finishes the startup reads before any grant. Hold seams patch the adapter in the process that runs it. Not owned here: a barrier that skips queued but not yet running regular work, which driver transaction order and the writer lock hide in reload histories; the shared logical scheduling oracle owns it. The real Electron app uses `node:sqlite` because Electron's ABI cannot load better-sqlite3; a native better-sqlite3 build for Electron is not run. The shared core-adapter contract checks custom local comparator dispatch for ascending, descending, and comparator-equal public-key ordering at `loadSubset` completion. Host packages register this contract, but the local sqlite3 CLI run does not prove native host execution. Browser composes public source commits with per-collection elected-owner routing and covers the complete committed-transaction wire partition through deterministic Node transport seams. Remote-subset histories distinguish logical demand, physical acquisitions, exact acquisition leases, and released replay tombstones. Electron composes source commits with a per-collection renderer owner, IPC adapter, real SQLite, and reopen checks. The shared-driver fairness owner checks K=1 complete-logical-hydrate scheduling with identical fixed, random, and seed-plus-path campaigns. It records public rows, raw dequeue reach, and a persist-first FIFO hostile control. Its Chromium OPFS fixture refines the provider boundary but does not establish a browser matrix, elapsed-time latency, unbounded eventuality, or multi-process coordination. Same-handle Node and OP-SQLite tests cover transaction admission. Controlled OPFS page/worker histories cover ownership and diagnostic-cause retention. The reset/resume owners use sqlite3 CLI and in-memory node:sqlite seams; they do not prove multi-process WAL, mobile/Tauri, or other native-device execution. Distinct database handles rely on SQLite lock admission rather than one in-process queue. React Native hosts without async-context propagation must use the transaction driver supplied to the callback for nested work. Fake workers and synthetic page events do not prove native handle release or real bfcache admission. The Browser composed seams are not real multi-context/OPFS-worker execution; the Electron harness is not an actual Electron process unless its explicit runtime-bridge mode runs. An ownerless elected node suppresses core routing, while a follower may route demand to the elected owner. The follower generation-notice and rotated-reacquisition lanes state the rotation law: a rotated follower holds the new generation's commit notices until the owner has reacquired every active demand, then ends scoped recovery and applies them. Production does not yet end that recovery, so their cells that require it are pinned as failing under the known gap [#2139](https://github.com/TanStack/db/issues/2139); the random generation-notice campaign is omitted until the fix, because some of its histories pass today. Cells that still pass cover failed reacquisitions (scoped recovery stays and the failure is reported), a superseding rotation as leader, and a scoped recovery without rotation, with or without an active demand (untrusted durable rows stay hidden). Other cells cover a follower whose claim expires while its ensure is in flight and an owner reset (the follower requests its demand again). The follower remote-demand lane checks that a follower's load, and a live query over its demand, settle only after the owner's broadcast applies here, for a broadcast that applies at once, one queued behind another subset's hydration, and one while the cache claim is expired; the claim-rotation placement is pinned under #2139. A failed apply rejects the load, errors the query, and fails the source. A renewal that fails transiently at the reply rejects the load but keeps and retries the demand, without releasing the owner's acquisition; a rotation during the reply wait is tracked under #2139. The flush-side expiry check and arrival-order queueing have no killing witness yet. Removing the follower's wait on either ensure path, its terminal check, or the queued flush's terminal marking each fails it. The Electron IPC readiness oracle checks a fresh or reopened renderer, a successful or failed IPC hydration, and an upstream load that succeeds, fails, or is released during hydration, against a model of the three readiness checkpoints; a renderer that replies before the main-process read or treats an IPC failure as empty fails it. The owner is a controlled coordinator double, not two real coordinators; host coordinators retry only classified transport or admission failures while demand remains retained. The manifest excludes progressive and move suites; registration and shim runs are not device execution. The per-collection coordinator oracle's real-tab lane runs a follower and an owner tab with real Browser coordinators over Node's BroadcastChannel and Web Locks and one real SQLite file: 16 histories over the owner's source (custom or Query Collection), the broadcast's placement, the follower's apply outcome, and the consumer, plus a rotation cell. Main fails all 16 histories; an owner tab for a rotated follower generation is not reachable there. The Electron IPC readiness oracle adds a follower and an owner renderer with Electron coordinators: 4 histories over the apply outcome and the consumer, in process and through a real Electron main process; main fails all 4. |
| SQLite expression-index planning             | [Node expression-index oracle](https://github.com/TanStack/db/blob/main/packages/node-db-sqlite-persistence/tests/expression-index-oracle.test.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | RFC #1659 invariant 8 owns identical persisted-index and runtime-expression shapes. Independent expected keys are checked against direct captured SQL, adapter results, and named-index plans. Generated BigInts use SQLite's signed range; one fixed case checks legacy oversized-value reads. Other limits: bounded unqualified JSON paths/scalars, Node BetterSQLite, and no null, arbitrary raw SQL, or native-host planning. Run the package's `test:oracles` campaign.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Offline execution                            | [scheduler](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/KeyScheduler-oracle.property.test.ts), [leadership](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/leadership-replay-oracle.property.test.ts), [settlement](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/transaction-settlement-oracle.property.test.ts), [serialization](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/transaction-serializer-oracle.property.test.ts), [web connectivity replay](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/connectivity-replay-oracle.test.ts), [review record](oracle-reviews/pr-1879-visible-replay.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Declarative FIFO eligibility, per-transaction outcomes, durable state and typed wire trees. The web connectivity owner checks a persisted write under a false browser online hint, then visible replay by event or explicit retry, at provider-call, outbox, and caller-settlement cuts. It uses controlled browser globals and fake storage; it does not prove actual browser network detection, genuine offline retry timing, multi-tab leadership transfer, or React Native behavior. Issued work may finish after ownership loss, but new work must not start. Exactly-once network execution is not promised.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Frameworks                                   | [React conformance](https://github.com/TanStack/db/blob/main/packages/react-db/tests/conformance.test.tsx), [React pagination](https://github.com/TanStack/db/blob/main/packages/react-db/tests/infinite-query-conformance.test.tsx), [shared framework contracts](https://github.com/TanStack/db/tree/main/packages/db/tests/conformance), [Vue synchronous publication](https://github.com/TanStack/db/blob/main/packages/vue-db/tests/useLiveQuery-publication-oracle.test.ts), [Preact conformance](https://github.com/TanStack/db/blob/main/packages/preact-db/tests/conformance.test.ts), [Preact binding witnesses](https://github.com/TanStack/db/blob/main/packages/preact-db/tests/useLiveQuery.test.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Exact exposed rows/pages and each framework's own lifecycle cuts. Vue's synchronous watcher checks insert, update, and nonterminal delete through supplied Collection and identity query inputs; it does not cover an empty final result, multiple changes in one transaction, or query recompilation. A React witness does not prove Preact/Vue/Solid/Angular/Svelte scheduling. Preserve their receiving registrations. The Preact driver observes each result at commit through a layout-effect probe under an error boundary, because Preact runs passive effects after paint and `act` drains only those it scheduled; it has no Suspense, server-snapshot, or DbClient witness. Its binding witnesses check that a write between render and subscription publishes and that an equal `queryKey` or structurally equal query keeps its live-query Collection. Subscribing in a passive effect instead of a layout effect survives both, as allowed scheduling freedom. The query-identity laws (1.0, maintainer decisions 2026-10-22 and 2026-10-23) run through every live-query driver and the React, Preact, Vue, and Svelte infinite drivers, branching on each driver's public `comparesQueryIdentity` policy. In a binding that compares identity (React and Preact), a query without a nonempty `queryKey` whose IR has no stable hash throws `UnhashableQueryIRError` at mount and at recompilation, with any dependency list; an empty key counts as none, and a nonempty key runs the query. Such a binding claims each source Collection ID it compiled, so A(x) -> C(y) -> A(x) is legal while a later B(x) throws `SourceCollectionIdReuseError`. A pairwise model judges 32 enumerated histories over A(x), B(x), C(y), and a disabled step, with declared reach for a swap after an intervening query, a swap after a disabled step, and a revisit after an intervening query. Reach labels name the steps between the claim and its test, so a direct swap does not count; removing the C(y) step fails reach. Claims that keep only the latest query, or reset at a disabled step, fail it. React runs every shared history twice, with derived identity and with a dependency list (mount, config mount, and recompile); skipping the dependency-list check at the first compile fails five scenarios. A nonempty `queryKey` skips the claim: React and Preact witnesses swap a same-ID source under a changed key, and a key reader that ignores keys fails both. One query over two same-ID objects uses overlapping but different rows; an engine mutant that resolves each source through the Collection-ID map, so the last object serves both join sides, fails the live and infinite scenarios. A Svelte hydration witness checks that a `DbClient`-backed query with a dependency list hydrates `queryKey: []` exactly as it hydrates an omitted key. The infinite suite runs the same pairwise grammar over A(x), B(x), and C(y), 18 histories with declared reach for a swap and a revisit after an intervening query; it has no disabled or page-shape step, because one infinite handle changes either its query or its page shape. A new binding starts unclaimed. A React witness checks that a dependency-list query with a `DbClient` rejects an unhashable query when it compiles, at mount or after a dependency change, but not on a render whose dependencies did not change. After a rejection, two reads must each throw or hold no rows. No current driver can fail that check, and reactive drivers do not reject. React unmounts a tree whose render throws. Preact keeps such a component mounted, so its driver mounts the hook under an error boundary, which unmounts it; a Preact component with no boundary keeps its last committed rows and is not witnessed here. It guards a future driver whose binding stays mounted; the `DbClient`-backed Svelte binding, which stays mounted, is checked field by field in its release oracle. A reactive binding (Vue, Solid, Angular, Svelte without a `DbClient`) runs the same histories and must publish the current input's rows: the unhashable query runs and recompiles when a captured value changes, and B(x) shows B's rows, never A's. One query over two same-ID objects is likewise rejected by a comparing binding and read through an inner join by a reactive one. The same mount-and-recompile split is not yet generated for `DbClient`-backed Svelte or React hooks beyond the receiving witnesses below. The [React source ID reuse oracle](https://github.com/TanStack/db/blob/main/packages/react-db/tests/source-id-reuse-oracle.test.tsx) and the [Svelte descriptor release oracle](https://github.com/TanStack/db/blob/main/packages/svelte-db/tests/descriptor-query-release-oracle.svelte.test.ts) own the release law for `DbClient` descriptors: a rejected query releases every sync start it deferred. React crosses six causes (source-ID collision, unhashable IR, a descriptor factory that throws, a query the live query rejects when it compiles, a single-result query in an infinite hook, and a Suspense query that cannot stream during SSR) with six hook paths (live, infinite, and Suspense, each derived or with a dependency list) and two direct readers; Svelte crosses the collision, unhashable, factory, and compile causes with eager and lazy sources and three readers, and its collision history reads every public result field separately after the rejection; dropping the guard from one getter, such as `isError`, fails all six collision cells. The React oracle also checks that a dependency-list Suspense hook claims its source when it takes a cached Suspense collection, on a retry after suspending and on a sibling mount; with a hashable dependency, the cache path skipped the claim before the fix. These are two fixed histories, not a dimension of the claim grammar: that grammar's disabled step has no Suspense form, because `useLiveSuspenseQuery` rejects a disabled query. Each hook releases at one render boundary (React `useLiveQuery`, `useLiveSuspenseQuery`, and `useLiveInfiniteQuery`, and Svelte's compiled query); removing any one boundary fails exactly that hook's cells, and routing Svelte's getters around the compiled query fails its collision cells; `preload()` overrides a deferral, so those cells pass without the release by design. Declared reach: each enumerated release history asserts that the rejected query ran the shared descriptor's factory once before the reader, and a history that binds the failing descriptor first fails that check. A render that never commits (React: a sibling throws after the hook returns, or the render suspends; Svelte: setup throws after the hook returns) releases its deferral when garbage collection reclaims the live query it built (maintainer decision 2026-10-23), or after the unsubscribed GC floor when the hook's config disables that reclaim (`gcTime` 0 or `Infinity`, or `startSync: false`); both release grammars add these causes, React adds the three config paths and Svelte a `gcTime: 0` setup, and waiting only for the reclaim fails those cells; removing the reclaim release fails exactly them, and releasing at the end of render instead fails the descriptor binding owner's no-work-before-commit law. Known limit, owner the maintainer: the reclaim follows the 50 ms unsubscribed GC floor, so a render whose commit React holds past that floor releases its deferral, and its source may start, before it commits; that render then subscribes to a cleaned-up live query, which restarts. No history holds a commit past the floor, which needs a controlled React scheduler or fake timers; this joins the existing held-commit open cell in the infinite-query publication row. A keyed step records no claim and checks none (maintainer decision 2026-10-23): for a comparing binding the claim grammar adds keyed steps AK and BK over the same-ID objects, 108 histories with declared reach for a claim that crosses a keyed step and a keyed step after a claim; a keyed step that claims, or that resets earlier claims, fails it for React on both paths and for Preact. Each controllable driver records a publication log (`publication-log.ts`) at the end of each synchronous turn, plus the value on screen at the first paint after each `setParam`, once the framework has flushed and before any later task (maintainer decision 2026-10-23). After a same-ID swap, a reactive binding's every logged value holds only the new source's rows or none: a binding that keeps the old rows published until a later task fails it in Vue and Svelte. A value replaced within one synchronous turn is not logged, because the browser never paints it; Solid and Svelte publish the previous query's rows once inside the swap's own turn, for any input change, and pass. Accepted design (maintainer decision 2026-10-23): React claims source IDs during render, so a concurrent render that is abandoned before commit keeps its claim, as the React oracle states for a render that suspends, because that render's live query may still own the source until cleanup. Same-ID source objects stay legal; the claim, not `createCollection`, rejects a swap. Trace: committed C(y); a transition render reads B(x) and is interrupted; an urgent render reads A(x) and throws `SourceCollectionIdReuseError`. The abandoned-transition history has no witness. Adapter-specific `queryKey` change semantics stay with each adapter's own tests; React's infinite hook also has a focused witness that a `queryKey` array changed in place recompiles, because only React hands the caller's array to the shared window binding. The shared lifecycle histories distinguish adapter-created projections from caller-owned retention: omitted and explicitly `undefined` `gcTime` use the 1 ms adapter policy; `gcTime: 0`, a positive 100 ms retention, and supplied Collections keep caller authority. They observe retirement after unmount, replacement, disabling, and positive expiry, plus survival before that expiry. The shared suite also checks initial-query readiness over a lagging on-demand source, for a list and a `findOne` query and for the infinite query (React, Preact, Vue, and Svelte): not ready before the subset settles, ready at settlement while the source is still `loading`, and still ready after the source becomes ready. Solid's Suspense over that source has its own witness. A separate Solid two-resource Suspense witness holds one ready projection past the 50 ms unsubscribed floor while its sibling remains pending, then checks both commit and boundary abandonment release the temporary preload owner and preserve ordinary 1 ms teardown. |
| Backend Collection E2E | [shared provider suites](https://github.com/TanStack/db/tree/main/packages/db-collection-e2e/src/suites); [Electric registration](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/e2e/electric.e2e.test.ts); [Query registration](https://github.com/TanStack/db/blob/main/packages/query-db-collection/e2e/query.e2e.test.ts); [TrailBase registration](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/e2e/trailbase.e2e.test.ts) | Electric, Query, and TrailBase register reusable predicate, pagination, join, and live-update checks at their provider boundaries; Electric also registers the move suite. These are receiving paths for core query and Collection laws, not framework render cuts. |
| Window-controller overlap | [shared infinite-query conformance](https://github.com/TanStack/db/blob/main/packages/db/tests/conformance/infinite-suite-oracle.ts), [React driver](https://github.com/TanStack/db/blob/main/packages/react-db/tests/infinite-query-conformance.test.tsx), [Vue driver](https://github.com/TanStack/db/blob/main/packages/vue-db/tests/infinite-query-conformance.test.ts), [Svelte driver](https://github.com/TanStack/db/blob/main/packages/svelte-db/tests/infinite-query-conformance.svelte.test.ts), [Preact driver](https://github.com/TanStack/db/blob/main/packages/preact-db/tests/infinite-query-conformance.test.ts), [review record](oracle-reviews/dec-03-window-overlap.md) | Four or five ordered source rows, two window-settlement orders, and public snapshots after each settlement, a subscribed observer update, a detached controller read, and explicit recovery. Insertion and removal of the fifth row distinguish both continuation directions while an earlier error remains visible. The detached read follows a source change with no controller subscriber; its preloaded Collection retains the five-row window. The exact overlap uses the exported DB controller in each package realm. Framework hooks expose no controller preload, so this cell does not establish a hook scheduling path; direct hook paging remains in the adjacent shared scenarios. An unsubscribed controller has no notification claim. |
| Infinite-query publication | [shared publication laws](https://github.com/TanStack/db/blob/main/packages/db/tests/conformance/infinite-suite-oracle.ts), [React render cuts](https://github.com/TanStack/db/blob/main/packages/react-db/tests/infinite-query-render-cuts-oracle.test.tsx), [Svelte hook tests](https://github.com/TanStack/db/blob/main/packages/svelte-db/tests/useLiveInfiniteQuery.svelte.test.ts), [review record](oracle-reviews/2026-10-05-infinite-first-paint.md) | Each driver records every value its framework published: React layout commits, Vue pre-flushes, and the Svelte construction value plus pre-effect runs. The shared suite checks that a synchronous source shows its ready first page on the first value, for a query callback and for a supplied collection that has not started, that every ready value in a fixed-source, fixed-query scenario equals the source prefix for its own page count, including an equal dependency replacement that keeps page depth, and that a mount requests an on-demand first window once, for a query callback and for a supplied collection whose finite window is wider than or equal to the one the hook needs, judged by the rows the on-demand source holds after mount. Under deferred acquisition, an on-demand first value is either the ready first page or a value with no rows, by framework: React and Svelte publish before the hook subscribes, Vue after. `preloaded-collection-first-paint` checks the documented route-loader pattern: a limited live query preloaded before mount shows its ready first page on the first value in every framework and asks the source for nothing more; a preload that does not count as demand never settles there. Pre-commit work has no shared form, because Vue setup is its commit. The React driver owns renders that never commit, StrictMode double renders (one first-window request on React 19), retries after GC, a mounted replacement whose startup error must reach the error boundary, and a collection kept from an abandoned render that enters terminal error before its query is selected again, each as under `useLiveQuery`. The React source ID reuse oracle drives the infinite hook too. Svelte owns construction and superseded recomputes before the subscribing effect. In both, the hook acquires an on-demand source as often as `useLiveQuery` does under the same history, for either input form, direct or behind a live-query Collection. On-demand requests from renders that never commit are now owned by the live-query deferred acquisition oracle; the React render-cut oracle checks that an abandoned render makes no acquisition. Open cells, owned here: React 18 StrictMode, where neither hook keeps refs across the double render; a React commit held after the 50 ms unsubscribed GC floor, where a controlled-premise controller witness shows no non-ready value but no React scheduling witness exists; ready values in scenarios that write the source or replace the query, which need a per-step source model; a join of eager and on-demand sources, which needs a zero-acquisition check before commit; a supplied collection with no `.limit`, which sends one unbounded request on `main` too, because the controller cannot narrow it before the source request; and Svelte `state_unsafe_mutation` when a start inside `$derived.by` synchronously writes rows a peer is waiting for, shared with Svelte's `useLiveQuery`, which a two-component probe reproduces and the deferred-acquisition follow-up removes. |
| Structural values and ordered primitives | [hash values](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/hash-oracle.property.test.ts), [hash identity](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/hash-identity-oracle.property.test.ts), [MultiSet consolidation](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/multiset-consolidate-oracle.property.test.ts), [hash graphs](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/hash-graph-oracle.property.test.ts), [mixed hash graphs](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/hash-mixed-graph-oracle.property.test.ts), [hash retry](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/hash-failure-retry-oracle.property.test.ts), [murmur stream](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/murmur-stream-oracle.property.test.ts), [comparison](https://github.com/TanStack/db/blob/main/packages/db/tests/comparison-oracle.property.test.ts), [deep equality](https://github.com/TanStack/db/blob/main/packages/db/tests/utils-oracle.property.test.ts), [cursor](https://github.com/TanStack/db/blob/main/packages/db/tests/cursor-oracle.property.test.ts), [indexes](https://github.com/TanStack/db/blob/main/packages/db/tests/index-update-oracle.property.test.ts), [BTree Map](https://github.com/TanStack/db/blob/main/packages/db/tests/btree-map-oracle.test.ts), [query identity](https://github.com/TanStack/db/blob/main/packages/db/tests/query/identity-output-shape-oracle.test.ts), [LIKE semantics](https://github.com/TanStack/db/blob/main/packages/db/tests/query/compiler/evaluators-oracle.test.ts) | Independent flat values, graph topology, algebraic laws, structural object keys in code-unit order (the flat-value, identity and consolidation grammars include keys that tie under locale collation), murmur byte framing against a byte-at-a-time reference (block mixing, the finalizer and symbol framing have no owner there), Map/group/sort recomputation, expression denotation, custom comparator dispatch/reference identity/index compatibility, LIKE wildcard refinement, compiled output bags, declared value-pair agreement between D2 equality keys and IR equality operands, and Collection collation with exact public scan/index order and one-index reuse across repeated reads. The auto-index cells cross BasicIndex and BTreeIndex; scan cells omit indexes. Both paths cover lexical and numeric `en-US` locale defaults plus an explicit ordinary locale override of a numeric default. An unindexed six-row work cell bounds Collection collation resolution to at most two reads per ordered scan: one index-path check and one scan clause. Other locales and ordered histories are outside this owner. The identity pair grammar covers primitives, signed zero, NaN/invalid Date, valid Date/timestamp, binary/Buffer, Temporal, nested references, symbols, and functions; fixed and sampled pairs do not prove every JavaScript value or hash collision freedom. Ref proxies are expressions rather than literal values in this lane. The deep-equality owner also pins that `deepEquals` ignores Map and Set insertion order, RegExp `lastIndex`, array holes, and typed-array class, the rules draft equality keeps. It also pins that objects of another class differ, that plain and null-prototype objects are one class, that a class instance without enumerable keys equals only itself, that URLs compare by `href`, and that typed-array elements compare like numbers. The hash-values owner checks equal-hash consequences for independently constructed flat values. Distinct type identities are checked by the hash-identity owner through `equalHashValues`, including forced digest collisions; distinct 32-bit digests are not promised. The hash-identity owner checks `hash` and `equalHashValues` against one spec-level identity model: primitives with signed zero, NaN, and bigint; reference leaves (functions, registered handles, `File`, binary over 128 bytes); Date, binary, Temporal, and RegExp headers; array length and holes; Map and Set insertion order; and object keys in any order, for acyclic values and for cycles through arrays, Map values, Sets, and plain objects. Map/Set order sensitivity is pinned current behavior, not a promise. Arrays from another realm, RegExps with a `NaN` `lastIndex`, getters, proxies, other cycle carriers, and pairs that differ only in a back-edge target are outside its grammar; pinned cases keep equality's cross-realm length check and strict RegExp field comparison. `hash-work.test.ts` pins how visited values and array/RegExp headers count toward the structural work cap, and that equality copies a shared Map's entries once per distinct pair ([code-weight hash dispatch review](oracle-reviews/code-weight-hash-dispatch.md)). Custom string indexes do not optimize ordinary ranges, and custom cursors remain unsupported. The LIKE owner covers boolean string matching and bounded work, not nullish three-valued logic or a general Unicode collation contract. Unsupported composite cursors reject. The MultiSet consolidation owner checks keyed, single-type, and structural identity, signed zero and NaN in keyed and single-number data, the retained first record, zero-sum removal, and input record contents. It does not assert output order. Its keyed grammar includes cross-type key and value collisions, non-finite numeric keys, the `\|` delimiter, symbol and function identity, and a direct-object/object-tuple delimiter control from #1948. Eight named collision witnesses and both generated campaigns are RED on `c879ba6d` and GREEN with the repair ([#1948 review record](oracle-reviews/issue-1948-keyed-consolidation.md)); the [code-weight consolidation review](oracle-reviews/code-weight-multiset-consolidation.md) records the earlier exclusion. The keyed reference uses direct value/reference equality, including SameValueZero for numeric keys. The unkeyed fallback keeps its original key and value domains. The direct `MultiSet` owner does not prove which `@tanstack/db` query shapes produce primitive keyed values or mixed-type source keys; that needs a live-query production witness. The index owner enforces one invalid-comparator law across both BasicIndex and BTreeIndex: for each comparator, accepted numeric prefix (including the empty prefix), and probe operation (add, update, eq/range lookup, take, build), the operation throws exactly when it receives a `NaN` or non-number result and never when every comparison is valid. A `signed infinity` comparator is the valid control, and a custom collation `compare` supplied through `compareOptions` is checked the same way. Two BTree Map split histories check inserted-key reads, exact whole-range payloads/order, size, and extrema, proving split placement follows the insertion index without a post-mutation comparison. A rejected index add or remove leaves the index refining its accepted rows; update and build are not atomic. At the Collection boundary, both index types and both write paths (optimistic insert, sync commit) crash the collection: status becomes `error` and the next mutation throws, so a usable collection never holds rows its subscribers were not told about. Open: a sync source can still commit writes on a collection in `error` state, which stores unpublished rows; this is existing `markError` behavior and needs a lifecycle-owner witness. Comparator transitivity is outside this evidence. |
| Mixed-kind ordered prefixes | [mixed-kind public-order oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/mixed-index-order-oracle.test.ts) | A separate unindexed ready Collection computes the public ordered two-row prefix for the same keyed rows as an eager BasicIndex or BTreeIndex Collection. Five histories cross number/bigint, boolean/number, object/string, and array/object values, with insert, update, and delete transitions into and out of mixed domains. Ascending and descending reads use one ascending physical index, so descending checks exercise ReverseIndex. After preload and after both source copies commit each step, exact direct and live-query IDs must match the scan. Same-kind checkpoints verify that safe indexes still serve ordered reads. The original type-name index order failed eight ascending public-prefix checks. A second numeric source Map models a finite on-demand provider: a bigint enters and leaves the visible prefix, deletion requires an uninstalled row, and an offset window reaches a cursor after the retained BTree index loses ordered-plan eligibility. Public IDs match the independent provider order at each settled window; controls withholding either requested row fail those assertions. This owner does not define a global precedence among unlike values, cover in-place value mutation or arbitrary mixed-kind pairs, or prove that every retained on-demand traversal is safe after its source domain changes. |
| WHERE predicate publication                  | [WHERE predicate publication oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/where-predicate-publication-oracle.property.test.ts), [`in` evaluator](https://github.com/TanStack/db/blob/main/packages/db/tests/query/compiler/in-evaluator-oracle.property.test.ts) ([review](oracle-reviews/perf-in-constant-set.md)) | An independent Kleene evaluator judges `eq`/`not`/`and`/`or` predicates over strings, a normalization-prefixed string, booleans, numbers, `NaN`, a valid Date, `null`, a missing field, and virtual fields. Snapshot histories with pending optimistic inserts compare a live query, direct subscribers with and without initial state, and `currentStateAsChanges`; change histories apply multi-key sync transactions, including reinsertion of a key deleted earlier, and compare every consumer's key set after each commit, on scan and `BasicIndex` paths. Peer subscribers share one field with different literals, plus one on a virtual field, so every published change must reach exactly the subscribers whose predicate it can satisfy; routing mutants that ignored the previous value, ignored the field, delivered a change twice, or routed while stale published rows awaited reconciliation fail here. Fixed witnesses cover a layout-only publication reaching a filtered subscriber as one empty batch, a filtered subscriber's empty Collection-readiness batch, retraction of a vanished row after eager cleanup and restart, and the new row plus exact subscriber update payload when a same-key row stays TRUE. A stale-live-value mutant survives the generated membership checks but fails the payload witness. A focused [property-visibility test](https://github.com/TanStack/db/blob/main/packages/db/tests/query/where-prefilter-property-visibility.test.ts) compares the public unindexed snapshot with the enriched-row contract for inherited, non-enumerable, enumerable-own, and nested getter paths; the pre-fix stored-row shortcut failed three of its four controls. Other property-descriptor and stateful-getter histories remain outside those fixed controls. Hostile mutants for FALSE-for-UNKNOWN `eq`, `or` or number-literal subscription prefilters, a prefilter that ignores the previous value, a skipped readiness batch, a skip while stale published rows await reconciliation, and an unindexed snapshot scan that reads only synced rows while an optimistic insert or delete changes visibility passed the prior `@tanstack/db` suite and fail here. Change routing withholds a dropped row from an `eq` subscription before its sent key could be recorded, so a mutant that records dropped rows as sent is equivalent for routed predicates in this oracle. A focused `collection-subscription.test.ts` witness checks that a dropped insert or update, alone or beside a matching change, cannot advance a limited subscription's page offset under a routed `eq` and an unrouted `or` predicate; the unrouted cases beside a matching change kill that mutant, and the unrouted `alone` case does not. A loose-equality prefilter is an equivalent mutant: it only skips less. Skipping during truncate replay also survives; the replay's baseline diff re-derives the same retraction, so the guard keeps the prior dataflow without its own witness. Generated cleanup and restart histories for filtered subscribers remain open for the lifecycle publication owner. No-op updates, other comparison operators, Temporal and binary operands, joins, ordering, optimistic updates, and truncate are outside this owner. It runs in `@tanstack/db`'s `test:oracles` campaign. The [2026-09-30 review](https://github.com/TanStack/db/blob/main/docs/contributing/oracle-reviews/2026-09-30-where-predicate-and-join-keys.md) records each ORC outcome. Change routing was later removed in favor of pooled live queries; the routing mutants above are historical, and the same peer laws now check plain subscription dispatch. The unindexed snapshot prefilter was restored for compiled queries as one stored-row `eq` test on a string or boolean literal. Its property-visibility test also covers the reverse direction: a stored row with an inherited or non-enumerable field must still match `isUndefined` on that field, which a scan that evaluated the full predicate on stored rows fails. The `in` evaluator owner checks `in` against an independent linear reference over Dates, `NaN`, `-0`, BigInt, bytes, Temporal values, objects and nullish items, for constant and row-supplied lists. |
| Joined result keys                           | [Joined result key oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/join-result-key-oracle.property.test.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A nested-loop model recomputes the pair set of an inner, left, or full join over source keys drawn from plain, comma-bearing, bracket-bearing, and quoted strings, numbers beside the strings that print the same, both infinities, and `NaN`. After preload and each synced group change, the published rows must equal the model's pairs and the result key count must equal the row count. The comma-joined key encoding fails its two pinned histories and both campaigns; plain `JSON.stringify`, which prints infinities as the missing-side `null`, fails the pinned infinity history and both campaigns. A pinned history in which a `NaN`-keyed pair leaves and re-forms fails when the join index compares source-key prefixes with `===`. Joins over subqueries, more than two sources, custom `getKey`, and optimistic mutations are outside this owner. It runs in `@tanstack/db`'s `test:oracles` campaign. The [2026-09-30 review](https://github.com/TanStack/db/blob/main/docs/contributing/oracle-reviews/2026-09-30-where-predicate-and-join-keys.md) records each ORC outcome.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D2 Index storage                             | [Index refinement oracle](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/index-refinement-oracle.property.test.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | A plain-`Map` model sums multiplicities under a type-and-value identity in which `NaN` equals `NaN` and `-0` equals `0`. Histories of up to twelve additions to two keys mix prefixed arrays with `NaN`, `0`, `-0`, `1`, `'1'`, `1n`, and `'a'` prefixes and unprefixed values, with cancellation and reappearance. After each addition, `get` and `has` must equal the model. Each step also checks that `get` returns what `getIterator` yields, in its order, since the two walk the storage separately. Comparing prefixes with `===`, which disagrees with the `Map` that holds them, fails three pinned histories and both campaigns; the `-0` control passes under both. Every history also runs with `prefixIdentity`, where values under one key with the same prefix are one value; mutants that merge unprefixed values or ignore the option in a prefix map fail. The [structural identity oracle](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/structural-identity-oracle.property.test.ts) checks that `structuralIdentity` agrees with D2 value identity for equal representations (array subclasses, class instances, null prototypes, key order, non-enumerable symbols) and independent values, including separator-bearing strings and keys, enumerable symbol keys, Dates, RegExps with numeric `lastIndex`, Maps and Sets with zero to two entries (the second Set member is a fresh tagged array, so primitive deduplication and unwrapped reordering are outside this lane), arrays with an optional enumerable `note` field, binary values, holes, deep nesting, and a cyclic value; an independent normal-form model decides equality and is checked against `equalHashValues`. The model expands `deep` shorthand into nested arrays. A pinned equal `deep`/array pair and adjacent-depth control guard the model boundary exposed by seed 1158727847/path 255. The equal-pair grammar crosses same-spec values with explicit-array/`deep` equivalent specs; the independent-pair grammar uses two specs. Both run fixed and fresh campaigns with guarded one-case seed/path replay. Pinned same-description symbols and equal-body Map/Set/object pairs expose collisions that random independent pairs rarely reach. Mutants that stringify symbols, collapse those three object-kind tags, drop a string's or key's length or an array's length, or omit Date and RegExp headers fail it. A first-entry-only Map/Set mutant and an array-identity mutant that ignores enumerable non-index fields fail the pinned comparisons; lowering the depth cap is equivalent, because the cap only bounds work. Open: reference-valued RegExp `lastIndex` can give D2-unequal values one defined identity and merge `groupBy` contributions ([#2192](https://github.com/TanStack/db/issues/2192)); the structural-identity and incrementalization owners need a production repair and receiving witness. Temporal values, other opaque reference values, large binary values, getters/proxies, and mutation between observations are outside this generated grammar. groupBy's use of it is owned by the incrementalization law: its string-extrema lane fails a string identity without a length prefix, and a focused groupBy witness fails when the group key is left out of the identity. Compaction, presence tracking, and structural payloads are outside this owner; a focused test checks that an index built without presence (as reduce builds its indexes) throws when presence is read; the [reduce fast-path oracle](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/operators/reduce-fast-path-oracle.property.test.ts) compares the fast path's emitted entries one by one with the general path's, over keys that move between the paths, hash-merged outputs, -0, and zero and negative multiplicities, while an unchanged `NaN` output is owned by a focused reduce test; the join operator tests and incrementalization law own operator behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Pooled live queries | [pooled live query oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/pooled-live-query-oracle.property.test.ts) | An independent `eq` model (nullish UNKNOWN, Date as timestamp, `NaN` equal to `NaN`, `-0` equal to `0`) gives membership; a live-query Collection compiled for the same query gives order, values, and status. Histories mix sync transactions, optimistic writes confirmed or rolled back, peer mounts and unmounts, and source cleanup and restart, including cleanup while a write is pending and a mount between cleanup and restart. Wholesale observers must match after every step, granular changes must match a reference observer by type, key, value, and previous value and replay to the model's rows, the layout revision must advance when keys reorder, and observing must never build the live-query Collection. Peers may add a residual `not(eq(...))` conjunct, which the model evaluates itself; a view that ignores it, reports an unfiltered `entries()`, or delivers a row entering or leaving it as an update fails it. Other residual operators use the same compiler evaluator but are not generated. Peers may also order their rows by `id` or by a `g` that can be null, with explicit `nulls`; order comes from the reference. A comparator that ignores direction or `nulls`, an order left out of the partition key, and key order instead of the query's order each fail the pinned reorder history and both campaigns. A partition that ignores a row's previous group, orders by arrival, skips normalization, skips the initial snapshot, follows the source's status after cleanup, or never terminates fails it. Two shared conformance scenarios (`eq-filter-rows`, `eq-filter-peers`) run the pooled path under React, Vue, Solid, Svelte, and Angular; a partition that ignores a row's previous group fails both under every adapter, and `eq-filter-peers` checks through `subscriberCount` that each adapter shares one source subscription per partition while mounted and releases every source subscription after the final framework unmount. The [resource-lifetime oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/pooled-live-query-gc-oracle.test.ts) compares when a pooled query and a live-query Collection release their sources across `gcTime` 1, 100, 0, and `Infinity`, with and without a subscriber, and with no `gcTime`, where both use the live-query Collection default, checks that a partition waits for its views' longest `gcTime`, checks that a view resubscribed after its partition released follows later source writes as its live-query Collection does, including a view with a residual conjunct, and checks that a partition that subscribes again still serves new mounts from one source subscription. Further focused witnesses check that a partition keeps groups only for values that have rows or watchers, that a detached reader never sees a dropped group's revision reused, keep a pooled query's public Collection live while the view is observed, accept it as a query source, and check that a pooled query turns terminal when source cleanup starts while the adapter's cleanup is still pending, as a live-query Collection does. Generated callback-boundary histories also compare ordinary compiled and pooled core observers across return/throw, Error/undefined, zero through three healthy peers, callback position before/after peers, and `gcTime` 1–3. Failed granular bootstrap retains no unreturned ownership after grace; held source cleanup gives every admitted wholesale observer one terminal error snapshot/callback despite a sibling throw, and preserves the exact failure at settlement. Original production and independent rollback-only or all-peer-only repairs fail the respective ownership or cleanup-start comparisons. These controlled core receiving paths do not establish framework schedules, arbitrary callback programs or provider shutdown. A pinned oracle witness checks that an `eq` path whose getter throws excludes the row on both paths; a pooled path that rethrows fails it. The pooled oracle's grammar never releases a partition, so release and resubscribe histories rely on these fixed witnesses; a fixed delay, a missing unsubscribed floor, a last-`gcTime`-wins rule, and releasing at `gcTime` 0 each fail it. Removing the partition's final-listener release survives the mounted row checks but fails the shared framework unmount checkpoint and core release-timing owner. The [2026-10-01 review](oracle-reviews/2026-10-01-pooled-live-queries.md) records each ORC outcome. The shared adapter conformance suite checks the opt-in boundary in every framework: queries without `pool` keep a source subscription each in the function, config, and parameterized forms, and a pooled parameterized query follows its parameter between pool groups beside an unchanged peer. Pooling every query by default, a pooled identity that ignores literal values (React then reuses the old query), and an Angular `params` form that drops `pool` each fail it. `pooled-param-change` also reads each driver's publication log: every value published after a switch holds only the new group's rows. Each driver also logs its keyed `state` map at the same points, and the law applies to it. A pooled view that serves the previous view's rows until a later task replaces them passes every final-state check and fails only the log, in all six drivers. A view that sends the previous rows as its first change set fails the `state` log in Vue; Solid rebuilds its map from a snapshot within the same turn, and Angular builds its map from `entries()`, so that mutant cannot reach them. The `invalid-pool` scenario requires `InvalidPoolOptionError` for `true` and for `false` (the value adapters pass to say a hook cannot pool), alone, beside `gcTime`, beside `queryKey`, on a parameterized query, and on a disabled config or parameterized query, in all six drivers; a check in only one of the three readers of `pool` fails it in four of them, and Angular's `params` form failed the `false` and disabled cases until it checked its pool first. The shared `grouping-operator-switch` scenario re-renders a grouped query without `groupKeys()`, and `compile-error-after-rerender` re-renders to a select that mixes a source field with an aggregate; both require the error and no rows after it. A binding that keeps its last compiled query when compilation throws fails both in Solid, Svelte, and Angular; one that throws once and then serves that query fails the no-rows check in Solid and Svelte, and cannot occur in Angular, whose `computed` rethrows a cached error until an input changes. In `grouping-operator-switch`, React and Preact kept the grouped query before query identity held operator code, and Vue served the previous rows before its compile error stopped reaching readers through a throwing computed (also on `main` at `5649a07d4`). |
| Live-query deferred acquisition | [deferred acquisition oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/live-query-deferred-acquisition-oracle.test.ts), [React Suspense warm-cache witness](https://github.com/TanStack/db/blob/main/packages/react-db/tests/suspense-warm-cache.test.tsx) | An independent model of the law that a live-query Collection starts no provider work before a subscriber or a preload in its current sync run crosses seven source states (eager or on-demand, idle, already started or render-deferred, and an on-demand source that already holds the rows), an unordered query and an ordered window, one or two live-query levels, and eleven histories: start and read, subscribe or preload after a start, subscribe or preload without one, deferred subscription and resumption with or without a start, cleanup before a subscriber, peer start, source truncate, and restart after a run that had one. After every command it checks source sync-run starts, acquisition attempts, readiness when the call returns (the synchronous observation cut), settled readiness, and rows. A pooled block checks that building a pooled view starts no idle eager source until a view subscribes or preloads, and eight DbClient histories check that a preload answered by a pending or settled stream still resumes acquisition across eager/on-demand idle and render-deferred sources. The React streaming witness receives the on-demand render-deferral premise, starts local acquisition before the stream settles, and retains server rows until browser acquisition completes. Mutants that never defer, keep the subscriber-or-preload fact across cleanup, ignore preload, never resume a builder's subscriptions, let a deferring subscriber start a base source, build a pooled partition without deferral, never resume it, mark a preload one microtask late, or drop the stream's preload mark each fail it. The React witness checks that `useLiveSuspenseQuery` over a source that already holds the rows renders without the fallback, for eager and on-demand sources and both shapes; creating the Suspense collection started, or not preloading it in render, fails it. A later review added `peer` and `truncate` commands: a peer that starts an idle on-demand source, or a truncate on a running one, made the live query acquire before any subscriber, and both guards are killed separately. Pinned blocks check that a subscriber surviving cleanup is served after a restart while a surviving deferring subscriber is not, and that `toArrayWhenReady()` and `stateWhenReady()` count as a preload. A pinned block checks that a deferring live query is not counted in its source's `subscriberCount` or `subscribers:change` until its first subscriber, while still keeping the source from garbage collection; a Query Collection test checks that it causes no refetch. Another pinned block checks that a preload or subscriber requested by an inner live query's status handler, while the outer query creates its subscription to it, still resumes acquisition. Solid's Suspense receiving witnesses check that a resource whose preload settles first retains its live-query Collection while its sibling remains pending past the unsubscribed floor, then releases that temporary owner on both commit and abandonment, and that a preload settling after its owner unmounts cannot publish an error through the abandoned result. Open: source failure and asynchronous loads before resumption, which the subscription lifecycle oracle owns once acquisition resumes; a resume that throws, which leaves later sources unstarted only for a live query that is already in error; asynchronous sources; and arbitrary Suspense schedules with a `DbClient` beyond the bounded abandoned-render and streaming handoffs recorded above. |
| Live-query notification algebra | [real-query and checker calibration](https://github.com/TanStack/db/blob/main/packages/db/tests/notification-laws-oracle.test.ts), [independent Map checker](https://github.com/TanStack/db/blob/main/packages/db-collection-e2e/src/utils/notification-laws-oracle.ts) | One-key synchronous source histories check exact live-query callback reconstruction and unsubscribe silence. Synthetic multi-key histories calibrate the checker; direct source Collection events remain with the change-event history owner. |
| Flat-row change tracking | [flat change tracking oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/flat-change-tracking-oracle.property.test.ts) | Generated callbacks over flat rows, frozen or not and with or without a non-enumerable field (assignments of `0`, `-0`, `NaN`, `undefined`, functions, and fresh objects; reverts; deletions; added fields; data and accessor `defineProperty`; stored drafts; throws), run through the flat tracker, the draft proxy, and an independent model, which must report the same change sets with `0` and `-0` equal, or throw the same error and leave the rows unchanged. Defining a field acts as assigning it, and a non-enumerable field is row data only once written; the proxy broke three of those laws on `main` and the flat tracker one. Diffs using `!==`, `Object.is` alone, or no deletions fail it. It found that the proxy dropped a field added as `undefined` when another field reverted; the pinned history and both campaigns fail without that fix. Non-flat rows must fall back. The [2026-10-01 review](oracle-reviews/2026-10-01-pooled-live-queries.md) records each ORC outcome. |
| Virtual props cache | [cache laws](https://github.com/TanStack/db/blob/main/packages/db/tests/virtual-props-cache.test.ts) | Focused laws for the per-key cache of rows read with virtual props: a change's published value is the row later `get` and `toArray` reads return, for every subscriber, after sync and local writes, and a key that is deleted or rolled back leaves the cache. Enriching the value before the previous value fails the first two; skipping the drop on delete events fails the third. Rows read with virtual props through other paths, such as joins, are outside these laws. |
| LocalStorage Collection | [mutation order](../../packages/db/tests/local-storage-order-oracle.test.ts), [peer snapshots and ownership](../../packages/db/tests/local-storage-peer-oracle.test.ts) | Finite two-write histories compare authored same/disjoint-key updates, both handler completion orders, and all four application-decision pairs against public rows, durable rows, caller settlement, and fresh restore. A nested fire-and-forget admission checks that the outer write reaches storage first; awaiting the nested receipt inside its earlier handler is an excluded dependency cycle. Handler-free direct insert, update, and delete are checked at the method-return boundary for synchronous Storage effects. A later handler failure is checked while its earlier handler remains held: its receipt rejects and its optimistic row rolls back promptly, while the durable predecessor remains pending. An automatic insert followed by manual acceptance crosses same-key update versus disjoint insert and both earlier-handler decisions; manual settlement waits behind that handler, and public, durable, and fresh-restore rows match the authored fold. Un-awaited manual acceptance crosses direct and held-predecessor paths with success or Storage failure: both commit and persistence receipts wait for every registered write, report the exact fault on failure, and agree with durable and public rows at settlement. A two-Collection witness checks that one manual receipt waits for both un-awaited acceptances. Peer witnesses check serialized disjoint typed-key writes before delayed event delivery, equal-ID manual Collection ownership, construction-time rejection of direct or shallow-copy reuse before or after first preload with the first Collection still writable, a peer insert during pending local insert, listener release across cleanup/restart, malformed startup snapshots, transient startup read failures and restart, the null-versus-empty storage sentinel, local and peer clear publication with subsequent public/durable agreement and a pending optimistic mutation across clear, and storage/parser read failures during writes and event delivery. The [same-tab audit](oracle-reviews/2026-10-08-localstorage-same-tab.md) records witnesses that withhold events through each persistence receipt: disjoint typed keys, a manually accepted same-key update followed by automatic update and delete, clear, a rejected Storage write, a pending same-key optimistic insert, cleanup/restart, and a write started by a ready-status listener compare public snapshots with the authored durable fold. A default jsdom Storage witness receives a same-tab write. The old event-only adapter fails seven no-event checkpoints. The original adapter also fails the second-handler-first, delayed-peer, equal-ID, listener-release, read-failure, synchronous direct-write, prompt-failure, mixed manual/automatic order, un-awaited manual receipt, reused-options admission, malformed-startup, and clear-publication witnesses. A failed write read rejects without replacing durable rows; a failed event read retains the public snapshot until a later valid event. These checks do not establish simultaneous cross-tab read-modify-write atomicity, atomic acceptance across distinct storage keys, manual acceptance without a mutation Collection owner, arbitrary long histories, native browser scheduling, or synchronization across distinct custom Storage wrapper objects. Existing LocalStorage failure and CRUD tests remain supporting examples. |
| LocalStorage value fidelity | [JSON value model](../../packages/db/tests/local-storage-value-fidelity-oracle.property.test.ts) | With the default JSON parser, an insert, update, manual insert, or manual update is accepted only if a fresh restore can return the row. A recursive value grammar labels each generated value, while it is built, with its expected JSON form or as lost. Lost: functions, symbols, enumerable symbol keys, `NaN` and infinities (also boxed), `undefined` and missing array entries, arrays with extra or symbol properties, a `toJSON` that returns `undefined` in an array, and Map, Set, WeakMap, Promise, RegExp, Uint8Array, and SharedArrayBuffer values. Normalized: `toJSON` values (Date, a plain object, and a function with its own `toJSON`), `undefined` properties and `toJSON` results, `-0`, boxed finite numbers, and non-enumerable symbol keys. Histories cross the four entry paths with and without an automatic handler. At `isPersisted` settlement, an accepted row must keep the authored writer value, store the model's form durably, and restore it in a fresh Collection; a lost row must reject with `SerializationError`, leave the writer's predecessor and storage bytes unchanged, and never call the handler. Pinned witnesses cover every lost kind and normalization on each path, with and without a handler; a fixed-seed and a random campaign of 300 histories run under `local-storage.value-fidelity`. A pinned witness per entry path uses a `toJSON` that changes after its first call: storage must hold the JSON the check accepted, and serializing the row again during the key check or the snapshot write each fails it. The stringify-only check on `main` fails 162 of 230 cells. The first walker in this PR failed 66 cells of the expanded grammar. Mutants that reject `undefined` properties, accept `undefined` array entries, skip boxed-number unwrapping, treat non-enumerable symbol keys as lost, skip the array-property check, or shrink the opaque-type list each fail at least six cells. Open: custom parsers, including a wrapper around `JSON` (accepted by design, documented); class instances (accepted by design; the guide states they restore as plain objects); cross-realm natives; getters; non-enumerable string data; update payloads whose shape the draft copy changes (array extra properties and symbol keys are dropped, and a hidden symbol key becomes enumerable, so an update of an object with a hidden symbol key rejects although its insert succeeds), which the proxy detachment owner must decide; peer or event delivery of a rejected write, which never reaches storage; and peer delivery of normalized values: the peer owner checks only `Date` at that boundary, so a peer receiving witness for the generated value grammar remains with the peer owner. IndexedDB clone rejection is owned by the IndexedDB settlement and values oracles, which require `SerializationError`; local-only rows keep values by reference, pinned in `local-only.test.ts`. |
| Local-only direct writes | [direct write witnesses](https://github.com/TanStack/db/blob/main/packages/db/tests/local-only-direct-write-oracle.test.ts) | Focused witnesses pin when a local-only direct write skips the optimistic stage: a completed transaction and one publication per write, and the fallbacks for a pending, persisting, or ambient transaction and a user handler, for insert, update, and delete. Each history also runs on a local-only Collection whose handlers resolve, which must match its rows, change batches, errors, and transaction states, across mixed multi-key batches, a batch that fails midway, schema rejection, and handler rollback. Mutants that drop each guard, write only the first mutation, or never complete the transaction fail them. The change-event history oracle drives the direct path through generated histories (about two thousand writes per run); removing the guard, or guarding only persisting transactions, fails these witnesses. |
| Reused sync row objects | [reused row witness](https://github.com/TanStack/db/blob/main/packages/db/tests/sync-reused-row.test.ts) | Focused witnesses for a sync source that changes a stored row object in place: in development, writing it again as an update without `previousValue` throws, while the same write with `previousValue`, or with a new object, moves the row out of an `eq` live query. Production skips the check. The check compares a shallow snapshot taken when the object was written, so it misses changes to nested fields; a write that names `previousValue` and a row whose fields throw on read are not checked. |
| Index suggestions | [index suggestion oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/index-suggestion-oracle.test.ts) | A public filtered live-query Collection checks manual/default, eager, threshold, matching-index, and unrelated-index cases against the documented collection-size suggestion policy. A bounded ordered-query decision table separately classifies no field index, a null-placement mismatch, matching but order-ineligible indexes, and usable candidates in either registration order. It compares the development warning after preload; the matching-index selection owner below checks the chosen reader and ordered request. Two cyclic locale-options cells require the diagnostic to preserve valid query construction with or without a field index, and a custom-collation cell requires remediation to preserve comparator reference identity. The original manual-silence/eager-noise implementation failed two expected observations. The issue #2190 baseline failed four diagnostic cells, including a first-unusable/second-usable candidate order; the first formatter draft failed all three non-JSON-safe remediation cells. The owner does not judge repeated-query warning volume, slow-query timing, production-build suppression, every comparison-option mismatch, or every query shape. It runs in `@tanstack/db`'s `test:oracles` campaign. |
| Minified DB public API | [consumer bundle check](https://github.com/TanStack/db/blob/main/scripts/test-minified-db.mjs) | CI builds `@tanstack/db`, then bundles its built `dist` entry with db-ivm inlined through esbuild `minify: true`. The build renames TypeScript-private members from `packages/db/mangle-cache.json`, so this lane runs against the renamed output that consumers install. It rejects a `dist` that is older than `src`, the cache, or the package's build configuration. `pnpm --filter @tanstack/db test:dist` also runs five db test files against the built `dist`, chosen for coverage of the modules with the most renamed members. `pnpm check:mangle` fails when a cached name is used other than as a private member in db src, is read by another package, appears as a string, or has a short name that collides with a source identifier ([private-member mangling review](oracle-reviews/code-weight-private-member-mangling.md)). It checks every exported error class's current public `name`, the built-in `BasicIndex` resolver name in index metadata and its event, complete query rows (after removing the four documented virtual fields) against an independent array filter/sort/projection, and one live update. The `new.target.name`, public-member mangle, and extra-output-field calibration modes fail at the intended observations. This fixed slice does not replace the unminified generated oracles, exercise framework adapters, or establish stable names for custom index resolvers. |
| Boundary refinements | [cleanup/restart](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-cleanup-restart-oracle.test.ts), [idle cleanup](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-idle-cleanup.test.ts), [issue #1891 async-cleanup review](oracle-reviews/issue-1891-async-cleanup.md), [issue #1891 cleanup-start follow-up](oracle-reviews/issue-1891-cleanup-start-followup.md), [metadata publication](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-metadata-publication-oracle.property.test.ts), [row metadata composition](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-row-metadata-composition-oracle.test.ts), [nested-begin metadata rebuild review](oracle-reviews/2026-10-06-nested-begin-metadata-rebuild.md), [state mutation round 4](oracle-reviews/2026-10-06-state-mutation-round-4.md), [state retention](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-state-retention-oracle.property.test.ts), [acquisition cells](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-subscription-lifecycle-oracle.test.ts), [D2 source reconciliation](https://github.com/TanStack/db/blob/main/packages/db/tests/d2-source-reconciliation-oracle.property.test.ts), [top-K support windows](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/operators/topk-support-window-oracle.test.ts), [nested Query work](https://github.com/TanStack/db/blob/main/packages/query-db-collection/tests/includes-work-counter-oracle.test.ts) | Explicit lifecycle products, independent source maps and weighted relations, exact publication cuts, support/multiplicity, and value-plus-work observations. These refine the larger subsystem models; they do not replace them. |
| Small structures and test mechanics | [SortedMap](https://github.com/TanStack/db/blob/main/packages/db/tests/SortedMap-oracle.test.ts), [cleanup queue](https://github.com/TanStack/db/blob/main/packages/db/tests/cleanup-queue-oracle.property.test.ts), [live-query GC clock](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-gc-clock.test.ts), [guarded replay](https://github.com/TanStack/db/blob/main/packages/db/tests/oracle-replay.test.ts) | Map/full-sort and elapsed appointment-list models with executed target/seed/path checks. SortedMap also checks deferred bulk writes, array-movement work, scan reuse, live iterators, runtime `undefined` keys, and public single-transaction and queued-transaction Collection sync paths. It does not settle the contract for comparator-observed values mutated after publication or every legal iterator/mutation interleaving. Wall-clock steps do not move due times, and a focused public witness checks source subscription release. Callback-reentrant scheduling, OS suspend/resume, environments without `performance.now()`, and fake/real Performance clock replacement while GC is pending remain outside this coverage. Tests must drain or reset pending GC before switching timer providers. |

The index-suggestion oracle's PR #2196 extension checks a matching local
custom-collation index against the full-source request and retained warning,
an ordinary unindexed on-demand prefix against its bounded request, virtual
field advice, and direction-free comparison guidance. It observes first
acquisitions and warning text, not later window moves or real-provider cost.

## Unit-test retirement transfers in PR #2116

The [direct index refinement oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/index-update-oracle.property.test.ts)
owns the seven behaviors moved from index unit tests: an absent lower bound
with an exclusive flag; exact membership through comparator-equal updates;
`null` and `undefined` exact and `IN` membership, including repeated owners;
undefined endpoint and cursor traversal; and explicit, omitted, and
double-undefined range bounds. A source Map predicts exact key sets and
ordered reads after bounded direct actions on BasicIndex and BTreeIndex. A
full-build witness catches native `Array.sort` moving raw `undefined` last.
The [round 1](oracle-reviews/index-unit-retirement-round-1.md),
[round 2](oracle-reviews/index-unit-retirement-round-2.md),
[round 3](oracle-reviews/index-unit-retirement-round-3.md), and
[round 4](oracle-reviews/index-unit-retirement-round-4.md) ledgers retain each
retired assertion. The [build review](oracle-reviews/basic-index-nullish-build.md)
records the direct RED/GREEN repair. A separate mixed number/string lane
checks that full direct traversals and one indexed, bounded public Collection
snapshot return each live source key once after deletion and after a direct
delete/update/re-add history. Two more direct histories keep an ordinary string
beside ordered ZonedDateTime or Duration keys and verify key conservation after
one Temporal deletion. An en-US locale and a custom string-collation cell compare
the first bounded public row through a scan and each index when an ordinary
string begins the internal encoding prefix. An `origin/main` probe failed the
default-locale public prefix case. The pre-classifier PR comparator failed all
four public prefix cases and both BTree Temporal-deletion histories. This owner
also compares complete forward and reverse reads through `IndexInterface`,
without prescribing index buckets or a BTree representative. A fixed churn
witness holds one live row while 16, 64, or 256 earlier distinct values are
added and removed; its public `takeFromStart(1)` result and comparator-call
growth reject retained empty buckets that add comparator work. This is a bounded
read-work check, not a memory bound or a general complexity proof. A deliberate
empty-bucket mutant failed at the intended comparator-count comparison.
The invalid-comparator owner checks rejection exactly when a comparison
returns a non-number or `NaN` and checks rejected removal atomicity; it does
not require a comparison merely because one comparator-equal row is removed.
The binary lane checks fresh equal-content removal, re-addition, and
replacement beside another byte value. It compares complete forward and
reverse key reads to a source Map. Separate short and 8193-byte pairs check
exact membership and complete forward and reverse key conservation when only
the last byte differs. An intermediate PR BTree rewrite lost a surviving key
after one equal-content owner left; the expanded lane rejected that result.
A separate two-value Date, Temporal.Instant, and Uint8Array callback lane
checks legacy scalar input kinds on direct add only. Arbitrary callbacks and
update, build, and range paths are outside that lane.
This owner does not prescribe mixed-kind order or cover binary range ordering,
all JavaScript value kinds, or general Collection publication histories.

The [comparison oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/comparison-oracle.property.test.ts)
owns the transferred same-realm NaN and invalid-Date default-order cases,
plus ordinary PlainDate calendar and ZonedDateTime instant order. Its
independent supplied values predict direct comparator signs and ties. The
[round 5](oracle-reviews/comparison-unit-retirement-round-5.md) and
[round 6](oracle-reviews/comparison-unit-retirement-round-6.md) ledgers name
the retired examples. Mixed-kind order, cross-realm values, modified built-ins,
and public indexed reads are outside this transfer.

The [deep-equality oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/utils-oracle.property.test.ts)
owns the transferred same-realm Date and RegExp equality boundaries: equal
copies, changed values, and inequality with timestamp, ISO, or source text.
The [round 7 ledger](oracle-reviews/utils-unit-retirement-round-7.md) retains
the retired examples. Caller-modified built-ins and Collection publication
are outside this direct-return owner.

The [Duration query equality oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/duration-query-equality-oracle.test.ts)
uses ten public fields to predict direct BasicIndex/BTreeIndex exact lookups and
public `eq` snapshots before and after indexing. The `in` evaluator owner also
checks same-display Duration forms through constant and row-supplied lists.
The deep-equality and Collection change-event history owners check a Duration
field replacement and its subscriber mirror. These fixed histories do not
establish arbitrary multirow Duration updates or live-query publication.

The [Temporal index order oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/temporal-index-order-oracle.test.ts)
owns ZonedDateTime instant ordering and time-only Duration ordering for direct
BasicIndex/BTreeIndex reads and bounded public first-row reads. It separates
exact Duration fields from order ties, including exclusive cursor behavior.
An extended-year PlainDate lane checks calendar order under lexical string
collation through ready scan and direct indexed snapshots, with eager live-query
preload as parity evidence. The old indexed direct path chose the wrong year.
An exception lane requires ready scan, BasicIndex, and BTreeIndex direct reads
and eager live-query preloads to reject mixed PlainDate/PlainDateTime values and
distinct PlainMonthDays, as changelog #1519 specifies. The old indexed direct
path returned a row instead. Calendar-unit Duration order, other extended-year
histories, on-demand exception publication, arbitrary updates, and custom index
callbacks remain outside this owner.

The [custom-index selection oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/custom-index-order-selection-oracle.test.ts)
checks that a reverse manual index cannot change an ascending limited public
snapshot or live-query result. Eager and prepopulated on-demand sources with
three distinct numeric ranks and a two-row window compare public IDs after
preload. The reviewer withdrew a claimed wrong live-query result after fixing
its scratch test's cross-checkout `@tanstack/db-ivm` resolution. The witness
makes no claim about per-row custom callback order inside a comparator tie. A
second on-demand witness registers an order-ineligible custom index before an
eligible index on the same field and comparison options. It requires a bounded
ordered request, a read through the eligible index, and no read through the
ineligible index. The first-matching-index mutant fails at that reader check.
Provider paging from an incomplete on-demand source and later updates remain
outside this witness.

The PR #2196 follow-up adds a direct `optimizedOnly` snapshot to the
first-ineligible/second-eligible history. An eager-auto history starts with
only an ineligible custom index and requires an eligible ordered reader after
query compilation. These checks cover selection and creation at the initial
read checkpoint; later index registration, mixed value domains, and provider
paging from an incomplete source remain outside them.
The existing mixed-kind public-order oracle checks the neighboring dynamic
domain: a structurally sound index can temporarily lose ordered-read
eligibility as row kinds change, without warranting a duplicate auto-index.

The [PR #2116 confirmed-fixes review](oracle-reviews/pr-2116-confirmed-fixes.md)
records baseline failures, hostile controls, and the bounded scope of these
repairs. The [deferred findings record](oracle-reviews/pr-2116-deferred-findings.md)
tracks remaining design and coverage questions, including valid Temporal kinds
without public order and mixed-kind query order. Earlier PR-branch
counterexamples do not by themselves establish an `origin/main` failure.

The Query DB ownership oracle owns the direct-write no-automatic-refetch law
([review](oracle-reviews/issue-1935-direct-write-refetch.md)).
The Query DB `optimistic-ordered-refetch-oracle.test.ts` receiver runs a real
QueryClient and on-demand Query Collection. A held optimistic inbox-to-archive
update must publish installed `[2]` immediately; its mutation handler changes
the provider row and calls `utils.refetch()`, after which queued application
publishes `[2,1]` to both rows and subscribers. It observes a useful bounded
ordered request while held and rejects the old loader classification at the
immediate cut. The separate
`invalidateLoadedSubsets()` trigger belongs to the Query DB ordered-prefix
owner introduced by open PR #2154 and still needs a during-hold observation.
The load-lifecycle owner checks the bounded static-key full-source reuse law
through live-query subscriptions: a settled full request serves a later
filtered demand with no second provider call; after the full view releases,
invalidation still updates the filtered view; an overlapping exact refetch
keeps its own rows and owner; and final release removes them. A pending full
request does not establish filtered coverage; the filtered demand may wait for
its application or request its exact scope. The settled-full witness
fails on the original implementation at the provider-call checkpoint.
It checks that the initial full acquisition signal may abort while a later
shared full fetch receives a live signal.
Another held-fetch cut releases the final filtered owner during full Query
revalidation, then checks transport abort and no late row publication.
Query-cache success reentry checks that initial and replacement full results
cannot settle a filtered acquisition before Collection application; the
replacement cut rejects a gate based only on previous full-row ownership. An
applied direct cache patch permits reuse or one exact filtered revalidation
for a new demand, but cannot trigger a redundant full request. The bounded
history has no retry, invalidation, or explicit refetch; a duplicate filtered
provider-call mutant fails its full request-sequence assertion. Signal
witnesses cover providers that ignore
their signal and may finish into Query cache after final unload for full-source
and equal filtered sharing; equal full-source and filtered peers after the
first releases; and two Collections sharing a Query whose later fetch runs the
released Collection's queryFn. Held initial and refetch histories acquire an
equal filtered peer before or after fetch start, then release the first owner.
They distinguish exact and custom abort reasons, a fresh provider AbortError,
no remaining peer, and an unrelated ordinary error at provider-call,
acquisition-settlement, public-row, cache-row, and error checkpoints. A
recovery-specific ignored-signal witness rejects a guard that consumes Query
Core's lazy signal before the replacement provider runs. The foreign closure
witnesses verify the installed Query Core's option-selection path both before
and during a shared fetch. A synchronous provider throw caused by reentrant
peer acquisition has no separate witness.
The ownership owner seeds a persisted `until-revalidated` subset owner, then
applies a complete full-source result and acquires that subset. An omitted,
unchanged, or moved source row must match public and durable rows at settlement,
and the subset's retention marker must clear. A moved row must retain its full
Query owner after its old subset owner retires. Reusing the full Query while
leaving the subset owner unvalidated fails the row and marker observations;
unconditional row deletion fails the moved-row control. Arbitrary predicate
containment, function-built Query keys, TTL retention, native SQLite replay,
and other persisted startup histories with a shared full-source lease still
need distinct witnesses.
These tests do not prove every provider returns a complete full source,
arbitrary observer-option selection, or the policy for a new equal demand after
failed revalidation. A fresh AbortError caused by the request signal and an
unrelated fresh AbortError after that signal abort are indistinguishable to the
adapter; the one-retry policy favors a surviving peer and may retry the latter.
Real network providers and cross-Collection option selection beyond the
installed Query Core version need receiving witnesses. The load-lifecycle owner
also needs an external `queryClient.cancelQueries` history with a pending
on-demand acquisition and a surviving peer; compare the public acquisition
promise and status at cancellation and after release. A late-peer release
history also needs a public live-query preload checkpoint for the retired
creator, separate from the surviving peer's load. The raw internal
`_sync.loadSubset` creator promise can fulfill in the current fixture; its
settlement policy is unresolved at that boundary. Neither observation alone
establishes a public cancellation bug. The load-lifecycle owner also needs a
cleanup-fault calibration that preserves a primary row mismatch and reports
secondary cleanup failure separately.
Its real QueryClient witness loads ten disjoint on-demand subsets, then checks
`writeUpsert`, `writeUpdate`, `writeDelete`, `writeInsert`, and a mixed
`writeBatch`. After each accepted write it compares public live-query rows with
an independent category filter and checks that no provider request started.
The pre-repair implementation failed this request check with ten requests after
one upsert. A held `deferDataRefresh` barrier adds a request checkpoint after
release; the pre-review implementation made an unwanted request there. A
derived-`select` witness checks that a direct write cannot replace an `edges`
array with node objects. It permits a stale cache row while requiring a valid
response envelope and the accepted public row. A direct-insert/unload witness
keeps a manually written row after its queried peer retires; assigning every
insert to the active subset fails that public-row checkpoint. Existing sibling
cache witnesses reject retaining inactive entries under the Collection's base
query-key prefix, including entries seeded before sync starts. The load-lifecycle oracle
separately owns explicit refetch settlement; the ownership oracle checks that
an explicit refetch after a direct write starts a post-write request when the
initial fetch is still pending. A direct write alone starts no request. These bounded
witnesses do not establish exact Query cache membership, ordering, or window
replacement after a direct write. The ownership oracle owns future scoped-cache
witnesses; the cursor-pagination oracle owns windowed receiving cases. The
offline-transactions owner still needs a full reconnect-replay witness for its
real `deferDataRefresh` premise. The ownership oracle also owns a later-remount
witness after an inactive prefetched entry is evicted, and direct-insert
retention across persisted restore remains with its persisted-owner histories.

The ownership oracle also checks per-key precedence when a held on-demand
refetch meets a later direct update, error and invalidation/freshness metadata
across cache patches, one patch per physical Query under a colliding hash, and
owner-bounded key extraction for ten disjoint 1,000-row subsets. An eager
derived-`select` remount witness rejects replaying its stale envelope over a
direct write; a foreign-observer witness permits an old inactive cache value
while requiring the public row to survive remount and release of another owner.
These controlled Query Core histories do not establish arbitrary `select`
inverses, exact scoped membership or window replacement, every custom hash
collision, or unbounded performance. The Query DB ownership oracle owns
further direct-write cache histories; cursor pagination owns windowed receiving
behavior.
A caller using direct writes must accept the
scoped-cache limits or request an explicit refetch.

The ownership oracle also checks five later boundaries from PR #2065 review:
a derived `select` still applies a held fetch's rows and settles eager
readiness after a direct insert; overlapping explicit refetch callers follow
the replacement request after a silent cancellation; a fetched result queued
behind a persisted-baseline scan cannot overwrite a later accepted write; a
zero-lease subset observer retained by a listener receives a direct cache
patch before reacquisition; and eight retired on-demand subsets leave no
fetch-start positions (removing the retirement call fails at eight retained
entries). The Query error, invalidation, and staleness checks now cover both
eager and on-demand modes. These are controlled Query Core and persistence
seams. They do not establish every derived response shape, arbitrary
overlapping refetch schedule, native SQLite timing for the queued-result cut,
or unbounded cache-memory growth. This owner retains those boundaries; the
persisted direct-write oracle owns native durable-order receiving cases.
The retained-Query witness holds an empty-cache fetch across subset unload and
reacquisition. A direct delete then requires an explicit refetch to start a
post-write request and preserve the deleted public row at settlement; without
a later write, the same refetch may reuse the in-flight request. A separate
checkpoint keeps the detached fetch-start position until that request settles
and retires it afterward. Two further shared-Query histories add A's sync
restart after a direct insert/delete while B's pre-write request remains in
flight. Without an explicit refetch, the old result must preserve the delete;
with one, A must start a post-write request. Both were RED before physical
fetch-start positions survived the restart and are GREEN afterward. These
controlled histories do not establish every persisted adapter or Query
cache-removal schedule.
The [intermediate review at 74e399150](oracle-reviews/pr-2065-74e399-review.md)
adds ordinary-unload and unobserved-fetch histories to that request-order law.
The [final direct-write authority review](oracle-reviews/2026-10-12-query-direct-write-authority.md)
records the later law decisions, RED/GREEN evidence, and ten-item audit.
The [four-review follow-up](oracle-reviews/2026-10-12-query-authority-oracle-followup.md)
audits legal subset predicates, cache-projection boundaries, scoped omissions,
and the generated cursor manual-write campaign against its repaired commit.
The ownership oracle also checks derived-select reacquisition and eager restart,
explicit subset refetch, a derived result held behind `deferDataRefresh`, a
provisional cache row awaiting persisted application, aliased physical Queries,
and the boundary between an in-flight pending Query and an idle empty cache
entry. The cursor-pagination integration oracle supplies the idle-entry control.
Its shared-Query reset history holds B's acquisition after A's direct cache
patch, resets the physical Query so the next fetch repeats the patch's numeric
update count, and requires B's load to settle on the new provider row. It runs
with a new response array and with the patch's exact array reference. This
checks the authority boundary at fetch settlement, but does not model every
Query Core reset schedule or custom-hash collision.
An outside-prefix custom-hash collision remains in Query Core's cache after a
direct write. The disabled reacquisition witness requires the load to wait for
an explicit provider result, then checks that result and ownerless-row
retirement. It covers one physical alias and an unbounded scope, not arbitrary
hash functions or windowed scopes.
The ordinary-unload, provisional-row, and alias tests reject their respective
hostile classifiers at public-row or cache checkpoints. These finite histories
do not establish every persistence schedule, every Query hash collision, or a
full offline replay; those remain owned by the Query DB ownership and offline
receiving oracles. Query Core 5.90.15 is the lowest version on which the full
Query DB suite passed; 5.90.14 failed error-recovery witnesses, and 5.85.2
failed the post-write refetch witness. Older versions are excluded by the peer
minimum.

The ownership oracle now checks a direct row's ownership lifetime across one
and two subset claims, with and without Collection row metadata. A direct
update preserves those claims; a direct delete ends them; a later insert or
upsert of the same key starts unowned; a later Query result can claim the new
row. Its 20 bounded histories compare accepted public rows and exact persisted
owner identities after each action and subset release. Removing the delete-retirement repair
fails nine histories at those checkpoints. One real SQLite receiving history
releases both former subsets, restarts the Collection from the same storage,
and keeps the reinserted unowned row. A controlled persisted snapshot restart
also retires two overlapping claims one at a time and compares durable owner
identities and public rows after each empty result. This does not establish every persisted
adapter, overlapping result schedule, or ownership of an inferred window
replacement; the persisted direct-write owner retains the wider durable
receiving boundary. Shared-Query cached-result authority
across an unobserved Collection is now an accepted law: a newer physical fetch
may replace and claim a direct row on later acquisition, while an older cached
result or another Collection's local cache edit may not. The 24-history matrix
crosses fetch/write order, a later same-key or unrelated write, a local cache
edit, and another real refetch. It compares public rows at acquisition and
subset release and checks that acquisition did not start an extra request. The
pre-repair implementation failed the post-write and unrelated-write orders;
removing fetched-data provenance fails two local-cache-edit histories. Two real
SQLite receiving histories restart A as a fresh Collection instance while B
retains the shared Query, with and without a later local cache edit. An
ownerless stored row colliding with the cached result has unknown order, so
acquisition refetches once and the new server row wins. Without that guarded
revalidation the original receiving history kept the direct value. These
finite histories do not establish every persisted adapter, a cached result
without a colliding key, or a cross-process Query cache hydration order.

Further controlled histories compare an accepted direct insert with a cached
server row across cleanup and restart, so a discarded run's write position
cannot suppress that row. The insert/delete neighbor distinguishes a stale
position from intentional row deletion. An equivalent-predicate alias history
coalesces two logical demands into one physical Query: a held pre-write fetch
must preserve the accepted direct row, while a later fetch can replace it. A
shared-Query history also checks A's direct insert while only B has loaded the
Query; B's public row and cache stay on the server value until a newer fetch.
The latter history rejects a cache patch that depends on A already owning a
subset. A stable empty persisted result avoids repeated full-store scans on
retained reacquisition, while a cold run still scans and retires a newly
seeded durable owner. A nonempty provisional result still takes the baseline
scan before applying. These checks use real Query Core observers and controlled
persistence; they do not cover every custom hash collision or external durable
writer. The overlap matrix below covers two requests and one shared row.

The shared-Query authority histories now also vary peer acquisition timing:
both Collections loaded at the write, B loaded while A is not, and B acquiring
after A patched the cache. The latter rejects a local edit leaking into a
late peer at a held-request public-row checkpoint, then admits the later
server result. A real SQLite restart matrix distinguishes a persisted
ownerless insert from an owned direct update against a shared pre-write cache
row. It compares durable storage after cleanup and the fresh Collection's row
after acquisition; an owned row cannot silently revert to the cached older
value. Two alias schedules separately reject omitting the observer-attach
fetch position and omitting propagation of a later physical fetch position to
all logical observers. A directly selected response property checks the same
late-peer rule as a raw array. A failed replacement fetch reaches the peer's
public error state without publishing the other Collection's local edit. An
outside Query observer retains A's own cache patch through cleanup; A's next
sync run must request a new result rather than replay that old patch. A
separate owned-row history checks that `queryClient.setQueryData` can update
B but cannot replace A's later accepted direct value; a real post-write fetch
may replace it. A held-fetch history checks the local edit before that provider
result, and a sole-owner unload/reacquire history requires a new result before
the manually edited cache can establish rows again. Eager shared-Query histories
require compatible Collections to project the same representable cache patch.
They cross active co-owners, a new direct key, a later or disabled peer, a cold
cache seed, an older held fetch, and a later complete result. They compare A
and B's public rows and the shared cache at write and fetch-settlement cuts. A
held B application checks that disjoint writes alter only their own cache
keys while preserving the peer's edit, for raw rows and a directly selected
`{ items }` envelope whose unrelated metadata must survive. An eager writer's
representable edit also reaches an already-acquired on-demand peer sharing its
exact Query, while an unacquired peer waits for a server result. An eager peer
with a derived visibility filter projects a direct-property writer's cache edit.
A disabled eager peer projects a cached edit without a request; a disabled
on-demand peer waits for an explicit refetch. A held persisted direct commit
crossed with a refetch start compares public and durable rows before the provider
responds, then after a newer response; eager and on-demand modes both reject
replay of the old cached success.

A complete matching on-demand refetch removes an omitted ownerless direct row,
whether the result is empty or nonempty. A real SQLite restart witness confirms
that the complete filtered fetch ran, retired the matching durable row, and
preserved a disjoint durable sibling. Unload alone, disjoint, limited, offset,
cursor, or failed results leave the row intact. Empty disjoint, offset, and
cursor results and matching/disjoint compound predicates check the completeness
and membership boundary at public-row settlement.

A seven-history overlap model crosses prior ownership, both request settlement
orders, equal-value responses, and direct writes between or after request
starts. Its provider rows satisfy real `IR.PropRef` predicates; a fixture guard
rejects literal-field comparisons that would make these histories illegal. It
compares the public row after each result and after releasing both owners in
either order. The older response may add an owner without replacing the
later-started fetch's value while row ownership remains continuous. After full
release, a receiving witness reacquires each retained Query with infinite
`staleTime` and `gcTime`: each cache entry projects its own value without a new
request. A complete response that omits an ownerless direct row settles that
row for its matching scope; it does not tombstone older responses from other
Query entries. A cross-scope omission-ordering guarantee would need a separate
law and model. The original implementation fails three reverse-settlement
histories. A separate real Query Core history writes inside an observer's
success notification; a late on-demand peer must not mistake that cache edit
for the fetch action's payload. The original implementation fails at the peer's
held-request checkpoint. These finite histories leave same-run external durable
writers, larger overlapping-fetch schedules, and direct-patch provenance after
Query cache dehydration outside their proven scope.

A fixed accepted-ownership history acquires three exact subset claims for one
row, then accepts two complete empty results while an unrelated optimistic
mutation delays publication. Its independent model stores the latest complete
result per active Query and exposes their union: the third result keeps the row
public until its own release, after which the union is empty. The ordered
refetch owner's held-delete replay is the killing witness for trusting stale
published owners over accepted ownership. A release/reacquisition history also
holds publication, reacquires the same cached Query, then proves the older
release cannot erase the new claim by releasing it and observing an empty
public row set. That history uses infinite `staleTime`, so reacquisition starts
no fetch. A sibling table crosses a stale reacquisition whose refetch fails,
returns the same rows, or returns no rows; the refetch settles while publication
is held or after the older release publishes; zero to two peer leases own the
first row until after the refetch; and the reacquired result has one or two
rows. Its independent model keeps each active observer lease's latest
successful result and compares public rows while held, after publication,
after the refetch, after every peer's release, and after the reacquired
release. On `main` at `31dad2dd3` 20 of its 42 cells fail: the older release's
empty ownership entry made the cached result look already applied, so the
reacquired lease owned nothing. A row only it owned disappeared at
publication; a row a peer also owned disappeared when the last peer left. The repair marks a released lease's entry and
lets only an applied entry satisfy the already-applied guard and the on-demand
direct-write skip. The empty-result cells reject keeping the row for every
reacquired demand. Removing the guard fails the persisted direct-write
histories that keep an accepted write through a refetch start, and their
sibling with an empty current result and an inserted row rejects treating
every empty entry as unapplied: in on-demand mode the insert disappears at its
receipt, and in eager mode Manual survives the Newer result. A second table
rejects deleting the entry at release: lease `b` claims the row while `a`'s
release is held or after it publishes, with or without a peer `c`, and a
server DbClient's dehydrated owners are hydrated into a fresh client. Deleting
the entry copies `a` back from unpublished metadata, which adds an owner edge
and, without a peer, leaks the row after the hydrated client releases `b`. Its `reacquired` histories reacquire `a` without
cached data and fail its fetch before `b` claims the row; deleting the entry
at reacquisition copies `a` back the same way. A
reacquisition behind a refresh barrier (`deferDataRefresh`) followed by a
direct upsert requires the reacquired Query's cache to show the upsert; reading
the released entry as applied leaves the cache stale, and only the Query cache
shows it. A release whose durable commit fails leaves the row public and
stored, puts the Collection in `error`, rejects a later acquisition with the
persistence error, and a `cleanup()` and `preload()` restart starts from clean
ownership; a host that swallows the failure fails it. A sibling holds the release's
durable commit, reacquires, and fails the reacquired application's commit: the
row leaves with the durable release, the Collection enters `error`, and a
restart serves and releases the row. Eager mode cannot reach
the reacquisition premise: it has no subset release, and ending an eager sync
run removes its Query from the cache. A cleanup that skips entries without an
observer passes this owner but fails the explicit-cleanup retention test in
`tests/query.test.ts`. A receiving probe on the Node SQLite adapter does not
match the controlled failed-release premise: when a SQLite trigger aborts
the release's delete, the Collection enters `error` and storage keeps the row,
but the public Collection drops it. The SQLite persistence owner has no
witness for that divergence ([#2210](https://github.com/TanStack/db/issues/2210)). Persisted retention (`persistedGcTime`) is
outside these histories. The
[review record](oracle-reviews/2026-10-20-stale-reacquired-ownership.md)
lists the mutant outcomes and open cells. Larger overlap schedules, window ownership outside the ordered
replay, and durable-adapter ordering remain open under the owners named above.

A controlled cold persisted scan gives one Query two rows in both scan orders,
then returns a current result that omits one row. Its independent replacement
model requires the survivor to remain public with its owner and the controlled
persistence boundary to receive a deletion for the omission. A row-by-row
reconstruction that treats the first persisted edge as a resolved Query fails
one order. A sibling DbClient hydration history supplies the same two rows in
both orders, then compares the public Collection with the same complete current
result and releases its demand. A row-by-row reconstruction fails both orders
at the public-row checkpoint. These finite histories do not cover larger cold
results or hydration interleaved with another active Query result.

The alias-scope owner also has a compiler invariant witness for a malformed
include plan: removing a captured ancestor's parent projection after the
builder creates it must fail before child rows are read. Without that check,
the plan compiled and a shadowed child could read its local row. The original
Query-builder paths remain covered by the owner's public-row histories; this
invariant witness does not claim arbitrary manually constructed IR is valid.

The following related oracles own distinct production paths or observation cuts:

- The [Collection lifecycle publication oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-subscription-lifecycle-publication-oracle.property.test.ts)
  owns exact public rows and change batches. The
  [replay oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-subscription-replay-oracle.property.test.ts)
  applies that law to competing replay schedules and same-key writes. Both
  models publish a replay's rows when its last owner is released and its
  current attempt has not failed, and keep a failed one private; the
  publication oracle's named histories cover a value written, rewritten or
  deleted during the replay, a row no demand names, a failed replay, a
  later request that updates a row still shown at an older value, and a row
  retained by a failed replay that the source deletes before a later replay
  retires. The replay oracle's named witnesses fail each synchronous failure
  site (a replay load, an old lease's unload, a new request) and then release
  the last owner; removing that site's sticky failure fails its witness.
  Limit: the generated grammars reach a failed retirement followed by another
  retired replay only rarely (the replay grammar releases one demand, on the
  last attempt), so the named histories own that sequence.
  Bounded three-row histories now compare a subscription's selected keys with
  callback key/type batches across full, explicit, filtered, and empty snapshots,
  two later ordered selections, both initial-state modes, and callback reentry.
  A delete and reinsert checks that selection can reset. A 12-case callback
  matrix also crosses new insertion and delete/reinsert with filtered,
  full-state, and skip-filtering subscriptions, with and without a cursor. It
  checks callback batches after each source commit and checks retained-key
  count after deletion. Source-callback reentry also selects an unseen ordered
  row after publishing another key. A controlled three-row offset provider
  checks sparse callback and ordered callback-reentry histories in both
  initial-state modes: local selection does not establish a provider prefix.
  A second offset-only adapter checks cursors near the end of three- and
  seven-row sources: without an explicit offset, the request must be unbounded
  because no finite prefix derived from local keys can reach an arbitrary
  cursor value. A four-cell optimistic-overlay matrix submits a new ordered
  request after one or two pending deletes or predicate-removing updates. A
  plain remote array checks that the provider page reaches the first still
  visible remote rank. The source commit can remain queued behind the mutation,
  so this is a request-bound check, not an immediate-publication claim.
  The replay owner checks a filtered snapshot followed
  by an ordered selection during a pending direct truncate replay, including
  callback reentry before the target receives the source transaction. It also
  settles a repeated ordered replay and compares public batches before and
  after settlement. A sparse successful replacement checks that an adapter
  honoring a last-key cursor can still acquire lower-ranked rows. The
  [snapshot-selection review](oracle-reviews/2026-10-12-snapshot-selection-review.md)
  records the baseline and reservation-removal mutant kills at public-row,
  request-bound, and replay checkpoints. The controlled providers cover three
  and seven distinct ranks and the tested request schedules; arbitrary rankings,
  provider-specific pagination contracts, and compiled live-query windows
  remain outside these owners.
- The [pagination oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/pagination-oracle.property.test.ts)
  owns general ordered-window rows and publication. Its optimistic overlay
  matrix crosses one and two pending source deletes or rank moves. It checks
  that a submitted provider page reaches the independently modeled window, then
  accepts the mutations through source sync and compares final public rows. A
  second matrix holds one or two optimistic inserts or rank moves while an
  indexed window widens. It crosses cursor-expression and offset-only providers,
  including windows opened from zero. The plain remote array checks the needed
  provider rank when a request can start before settlement; after source
  acceptance the public window must equal independent recomputation. The
  original six failing cells and narrow overlay, padded-boundary, and delayed
  continuation mutants reached these request or public-row comparisons.
  Settled ten-page traversals bound returned provider row volume and use only
  cursor-expression and offset transports. CollectionSubscription cannot emit
  `lastKey`; the [TrailBase adapter test](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/tests/trailbase.test.ts)
  covers an external last-key caller and shows that core requests do not retain
  unused opaque cursors. Direct ordered subscription requests without an
  explicit offset may repeatedly load a growing prefix; with a cursor and no
  offset they may load the full source, because the adapter is permitted to
  ignore cursor expressions. The
  [ordered-work oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/ordered-work-oracle.property.test.ts)
  rechecks rows while bounding eager indexed and joined work.
  These finite matrices do not establish arbitrary overlapping optimistic
  histories, ties, or provider-specific cursor behavior.
- The [IR identity oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/ir-stable-identity-oracle.test.ts)
  owns demand-key encoding. The
  [load-subset oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/load-subset-oracle.property.test.ts)
  owns runtime sharing and retry. The
  [transaction refinement oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/load-subset-transaction-refinement-oracle.test.ts)
  owns abort timing around sync acceptance and publication.

The LocalStorage owners above also cover the [peer and materialization
review](oracle-reviews/2026-10-08-localstorage-peer-review.md): a failing
same-tab receiver cannot revoke a durable writer receipt or block later peers;
a nested peer write remains authoritative through a later update; a DbClient
Collection and its module-level manual utility share one write order, including
before explicit preload; unrelated equal-ID Collections cannot borrow that
utility even when they share the Storage object and key; startup
validation fails before `begin`; and clear reads once per active receiver.
The default JSON writer avoids a second full parse only when its saved bytes
remain current. Custom parsers still read back. These finite witnesses do not
establish recovery of an invalid writer key extractor or manual acceptance
without a mutation Collection owner.

The [follow-up oracle review](oracle-reviews/2026-10-08-localstorage-final-review.md)
adds direct-owner idle, ready, and cleaned-up histories for module-level
acceptance into a DbClient materialization. It checks the manual receipt,
durable snapshot, active public snapshots, and fresh restore. A hostile subject
that drops transaction commit work fails the held-receipt checkpoint. The peer
owner checks a peer write admitted by a restore subscriber, custom-parser
normalization of an authored insert and update without a version-token change,
invalid events followed by same-token repair, and malformed stored row shape
or key identity before startup opens a sync transaction. The order owner checks
a handler-free direct write at method return immediately after a synchronous
handler failure. These finite witnesses do not prove arbitrary reentrant
subscriber histories or cross-tab atomicity. Default JSON intentionally keeps
the writer's authored rich value until restore; a Date witness records the
public/durable representation difference.

The [second LocalStorage review](oracle-reviews/2026-10-08-localstorage-round-two.md)
extends the peer owner across unchanged versus changed version tokens for an
untouched parser-normalized row. At a fulfilled receipt it compares writer,
peer, durable bytes, and fresh restore. It also checks duplicate decoded keys,
serializable NaN-derived keys, nonfinite default-JSON row IDs, and prewrite
versus postwrite read faults. The order owner holds an earlier handler while
manual acceptance is followed by a `mutationFn` failure, then compares both
receipt cuts and the eventual public, durable, and restored rows. A direct
nested peer write replaces the unsupported manual-acceptance fixture. These
finite histories do not establish arbitrary parser side effects, concurrent
cross-tab writes, or every possible row serialization shape.

The [boundary audit](oracle-reviews/2026-10-08-localstorage-boundary-audit.md)
crosses default-JSON native-value retention with a disjoint same-tab peer write:
the writer keeps its authored Date while receiving the peer's row, and a later
same-key peer edit replaces that Date. Writer, peer, durable bytes, and fresh
restore are observed at the peer receipt. A throwing writer subscriber after
Storage acceptance does not revoke the receipt or prevent peer publication.
The controlled host does not establish arbitrary native values or `toJSON`
side effects, many-operation histories, or native browser scheduling. Those
need a widened peer-owner value/history grammar and a receiving browser witness.

The LocalStorage peer owner checks descriptor admission after three failed
constructor boundaries: invalid index configuration before sync binding,
controlled browser-listener registration failure during sync startup, and a
missing on-demand `loadSubset` handler after a browser listener was acquired.
A corrected retry must persist; a third construction and reuse after successful
owner cleanup must reject. The original owner can restart and persist, while
controlled browser-listener counts return to zero after failure and cleanup.
Paired hosts compare the Storage reads caused by one later same-tab write; the
failed-construction host has one extra read on `8b3debb3a`, exposing an
abandoned same-tab callback. These checks cannot prove that a failed Collection
is no longer retained by a private adapter closure or an inert callback in
the same-tab registry; those resource-retention claims need a receiving
lifecycle/GC witness owned by
`packages/db/tests/local-storage-peer-oracle.test.ts`.
Native browser listener failure and host scheduling remain outside the
controlled history.

The [React source ID reuse oracle](https://github.com/TanStack/db/blob/main/packages/react-db/tests/source-id-reuse-oracle.test.tsx) ([review](oracle-reviews/issue-1991-react-source-id.md))
checks that a mounted derived-identity hook rejects a different same-ID
source Collection directly, after an intervening ID and predicate, within one
query, and after source cleanup. Stable sources, new IDs, a fresh hook after
cleanup, and independent client scopes remain usable. Returning to a prior
client scope retains that scope's binding, including through `DbProvider`.
A suspended render that starts a source query also claims the ID until unmount.
An infinite-hook driver runs direct reuse, reuse after another ID, the same
object and a new ID, reuse after a suspended render, and deferral release on
rejection through `useLiveInfiniteQuery`, whose render-time collection cache is
keyed by the same derived identity.
Separate client-scoped Suspense hooks and an initial suspended retry keep their
same-ID sources distinct. A rejected collision render releases sync-start
deferral for a different shared client descriptor; a later direct reader reaches
`ready` and observes its row. The public rerender error, status, or row is the
observation cut. A second controlled history makes two deferred sync starts
throw and checks that a later shared source still starts and publishes its row.
This distinguishes releasing every pending source from stopping at the first
startup error. The first thrown error still reaches React's error boundary.
This owner does not constrain explicit `queryKey`, direct Collection input,
or legacy dependency-array identity, and it does not install a process-wide ID
registry. Real persisted SQLite sources and DbClient SSR preload/streaming
remain outside this controlled React driver. A space policy for a mounted hook
that visits unbounded distinct source IDs remains open; this owner needs a
bounded-navigation counter witness once that policy is chosen.

The SQLite core binding-capacity oracle in
`packages/db-sqlite-persistence-core/tests/sqlite-core-adapter-oracle.test.ts` is a
bounded owner for issue #1993. The
[review record](oracle-reviews/issue-1993-sqlite-binding-capacity.md) gives the
exact executable revision and guide audit. It failed on the original 900-item
chunking and passes with one JSON table binding per runtime `IN` list and a
statement-total fallback. It compares independently filtered rows and typed
values with
`loadSubset` on real Node prepared SQLite statements. Node versions that expose
the configured 999-parameter limit use that native cap. Older versions use a
controlled driver that rejects over-cap bindings before SQLite preparation;
the oracle tests that guard separately. Fixed and generated cases cover empty lists, 998/999/1000
single lists, 499+500 and 500+500 statement totals, mixed scalar/list and
nested predicates, root and distinct transaction-driver routes (including an
omitted transaction cap at the 100/101 driver boundary), signed-64-bit BigInt edges,
escaped strings, an ordered two-hit list across the old 900-item chunk, both
cursor SELECTs, and a 1,000-scalar fallback. Both index-definition `IN`
contexts must remain literal SQL. The existing CLI
large-list test substitutes values into SQL and cannot witness parameter
capacity. This new owner does not establish behavior for null, nonfinite,
container, or structured values; 50,582-ID stress; JSON-function availability;
the cost of a full-table fallback; concurrent writers; or browser, mobile,
Tauri, and native-host execution. The core owner needs typed equivalence and
row-read work witnesses before claiming class closure. Each host driver owns a
receiving capacity witness for its real SQLite engine.

The Query ownership oracle checks that a direct-write promise stays pending
while a controlled persisted adapter holds its sync commit and settles after
the adapter stores the row. It also checks that all five direct-write methods
reject after cleanup starts and that a restarted sync run can persist a new
write. Focused Query tests check a synchronous batch callback returning another
Collection's write without losing either write, while an async callback still
rejects. They also check two serialized updates: after each awaited response
write and mutation settlement, the public row shows the server revision. These
witnesses cover an eager Query Collection after initial load with a controlled
adapter, not a direct write already in flight when cleanup starts, native
SQLite, or overlapping Query revalidation. The Query ownership and
optimistic-history owners still need a joint generated witness
for competing source writes around mutation settlement.

The hash-identity owner also runs every law in a second module copy whose
initialization draws are all equal, so every type marker has the same hash
number in any declaration order. There it checks equality verdicts, equal
hashes for equal identities, cycle rejection, and a `topKBatch` Map-to-Set
replacement. No distinct-digest check is needed: a legal 32-bit collision
cannot weaken the equality verdict. This closes the equality type-separation
witness for every generated carrier. It does not prove hash collision freedom. Generated Map keys include numbers, symbols,
references, and containers, and the model merges keys under SameValueZero.

The [NaN ranked-window review](oracle-reviews/2026-09-30-nan-ranked-window.md)
records an eager direct-source refinement in the pagination owner. It covers
initial ascending and descending windows, two NaN tie values, an offset move,
and equal, changed, and deleted source ranks. On-demand NaN rank acquisition,
joined queries, and null/NaN order combinations still need public witnesses in
the pagination owner before they support a broader claim.

The [Angular conformance driver](https://github.com/TanStack/db/blob/main/packages/angular-db/tests/conformance.test.ts)
checks a required signal input on a real TestBed component. Angular assigns
the input after field initialization, then the driver checks rendered data and
exact selected IDs after initial change detection and one input change. The
driver supplies the AOT-equivalent signal-input flag because this suite uses
Angular's JIT test environment. It does not exercise Angular's AOT compiler,
older Angular runtimes, or every scheduler cut. The same driver checks that an
explicitly disabled query reports `disabled` and ready before effects run.

The query identity owner generates both equal and unequal primitive string
pairs. Its fixed pairs also check public `groupBy` rows after initial
publication. End-to-end subset-demand reuse is still unproven: the demand-key
check observes internal identity only. The identity owner needs a subscription
witness that compares public rows and acquisition counts after equivalent and
distinct predicate demands settle.

The subscription callback-reentry companion kills eleven guard-deletion mutants
at the named request, resource, status, replay, or retention checkpoint on the
reviewed production head. It also checks that releasing a direct snapshot
during an unoptimized callback or snapshot evaluation prevents publication.
A combined-predicate loader case checks release by the original request
predicate before the loader returns. Three
guards remain for a separate code-weight review (SUBS-09): M1's generation
check after `loadSubset` is followed by demand-membership and generation checks
after cleanup removes a starting demand; M6's replaced-state check before
restart setup is followed by detached-demand and replay-state checks; M8's
`releaseAttempted` true branch was unreached in 538 focused tests and its callers
remove or detach ownership before invoking adapter unload. These are bounded
equivalence arguments, not permission to delete the guards without a separate
review. The companion does not establish arbitrary provider callback behavior.

Row canonicalization before the result boundary now runs only for DISTINCT,
which tracks visibility by selected value; removing it fails the functional
projection oracle. Ordering already consolidates each key's batch before top-K
state changes, and materialized relations reduce by public key. Removing the
former parent-route, non-Collection source, join, grouping, ordering, and
includes conditions passed the whole `@tanstack/db` suite and a
`TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=10` oracle campaign. Without the keyed
reduction, `live-query-result-multiplicity.test.ts` witnesses the output
boundary rejecting a flush that changes one key by more than one row.

The Collection lifecycle publication owner checks 32 bounded histories in which
cleanup interrupts nested publication deferrals and a restarted sync run later
publishes or discards one or two source rows. It compares the next subscriber's
exact batch when the new deferral closes, including an old handle closed before
or during that deferral. The includes publication owner still needs a
compiled includes witness for cleanup during a discarded source deferral,
followed by a parent or child publication at its callback boundary.

`packages/db/tests/query/group-by-work.test.ts` owns the work law for grouped
aggregates: a change costs the same number of iterator steps at every group
size, for a `groupBy` count and for an include count. `group-by.test.ts`
checks which member supplies the value of a group whose members are equal
under query equality but differ exactly, in both arrival orders. It also
checks that `min` and `max` equal a remaining member's value after each delete,
for signed zero and Dates and for stored and rebuilt arguments
([review](oracle-reviews/group-representative-exact-value.md)). Open: no law
observes which parent supplies an include route's parent context, because a
single-group include aggregate drops non-aggregate select fields; parents equal
under query equality but different exactly share one route.

The [Temporal group-key oracle](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/temporal-group-key-oracle.test.ts)
owns the db-ivm `groupBy` value boundary for the eight Temporal kinds recognized
by structural hashing. It compares public group counts with fixture-defined
identity classes after one input batch, including distinct and matching fresh
values and a plain object with its own spoofed Temporal tag. Nested
serialization controls cover records, arrays, Maps, and Sets. Incremental
retractions and unsupported symbols, cycles, and mutable RegExp state are outside
this owner's bounded domain. The owner uses db-ivm's established kind-and-string
Temporal key domain. Alternate representations remain separate: Durations such
as `PT1H` and `PT60M` form different groups even when they compare equal. The
supported inputs are ordinary native Temporal values or values from one
polyfill copy. A custom prototype that impersonates Temporal can still merge a
plain object with a genuine value. A genuine value with a replaced prototype
can split from an equal value. Both altered-prototype cases and separately
loaded polyfill copies are outside this contract. The oracle still protects a
plain object's own spoofed tag without a custom prototype.

The [includes publication oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/includes-publication-oracle.test.ts)
now checks one held ordered repair with two public parent rows and one inline
child. Its bounded history crosses a single-step row move, a private value
change that returns to the prior value, and a final value change. It compares
root Collection reads and subscriber callbacks with an independent sorted
source Map, and checks Effect callbacks against the last callback-visible row.
Its optimistic rollback histories also require the callback to be reached and
compare the restored public rows and callback trace after rejection. This
rejects a final-row-only check that misses a torn callback publication.
The [DEC-02 review record](oracle-reviews/2026-09-28-retracted-value-retention.md)
retains the RED and mutant evidence. The receiving Collection-valued owner
(`packages/db/tests/query/includes-collection-oracle.property.test.ts`) now
checks a held finite ordered child repair request with A→A, A→B→A, and B→C histories,
facade identity, silence during the hold, final child order, and subscriber
delivery. The optimistic owner
(`packages/db/tests/query/includes-optimistic-oracle.property.test.ts`) checks
a same-root-row optimistic update during held ordered repair, comparing exact
public snapshots and change events before release, after release, and after
rollback. Both use controlled provider timing; real-provider ordering remains
a separate receiving handoff.

The ordinary committed-transaction companion in the SQLite resume-snapshot
owner checks durable rows, row and collection metadata, expected-key evidence,
tombstones, applied position, idempotent reapply, and replay threshold behavior
for bounded insert, partial-update, delete, metadata-only, and repeated-key
histories. Its fixed and random generated campaigns cover a two-row seed,
ordered action prefixes, seven required action/metadata suffixes, optional
dependent updates, and late-bookkeeping rollback, comparing durable state after
each settlement. The generated grammar is bounded to two writable string keys,
one absent metadata key, up to 60 prefix mutations sampled in short, middle,
and long bands, three row-metadata and
two collection-metadata prefix actions, and up to three committed positions;
it does not claim arbitrary histories or concurrent owners. Every generated
seed, candidate, dependent update, and late rollback must enter exactly one
SQLite transaction; counters are captured before durable snapshot reads. A
separate fixed/random generated work grammar covers 0–60 distinct keys, six
insert/update/delete/row and collection metadata shapes, and 100/999 parameter
caps. It checks
durable values before applying the same proposed chunk-bound work law; all
repeated-key histories now check a distinct-key work bound after both committed
and rolled-back candidates. A fixed 205-update single-key case drops from 824
to 8 query/run calls against a bound of 18. Truncate cases require overwritten
invalid row and metadata values, including unbindable `undefined` collection
metadata, to reject and roll back. Fixed 25/26 and
10,000-row cases separately witness the independent-key work boundary. Both
fixed and generated independent-key work laws were
RED on `ef1e6a4` and are GREEN with ordinary batching: the 10,000-row insert
plus metadata takes 505 query/run calls instead of 50,005. A later
125-row-ceiling follow-up checks 124/125/126 rows under a 500-parameter host
cap; the 10,000-row case now takes 405 calls. A temporary
repeated-key classifier mutation fails the generated oracle at the candidate
durable checkpoint, seed 1992, path `2:0:0:2:2:2:2`. A temporary chunk-limit
mutation passes the Cloudflare 25-row case but fails at 26 rows under the
100-parameter guard. A collection-metadata classifier mutation that ignores
repeated keys fails at the durable checkpoint for a set/delete history. All
mutations were restored. The Cloudflare receiving driver also persists ordinary
writes with row and collection metadata at 25, 26, and 205 rows within that
guard. Its Node SQLite storage seam does not establish Cloudflare
Worker execution. The synthetic node:sqlite seam does not establish OPFS
worker scheduling, browser latency, or native-device performance. Tagged-value
serialization, unavailable key evidence after raw loss, concurrent schema
migration, WAL across processes, and arbitrary longer transaction histories
remain with their existing owners or need explicit future witnesses.

The SQLite resume-snapshot owner also checks a cold, unique-key, non-delete
full replacement with 205 rows. It compares exact durable rows, row metadata,
key-set evidence, resume metadata, and applied position at transaction return;
the driver query/run count is bounded, and a later-batch fault rolls back the
whole transaction. Duplicate-key and delete histories keep their sequential
semantics. This in-memory driver-call law does not measure Chromium OPFS
latency, worker scheduling, or an end-to-end Electric snapshot.

The Cloudflare Durable Object test applies 25-, 26-, and 205-row full
replacements and ordinary writes with row and collection metadata through the
actual Cloudflare driver. A storage seam enforces Cloudflare's documented
100-bound-parameter query limit and checks durable keys and metadata after each
transaction. Its subset receiving witness compares exact rows for 100 and 101
equality or one-item `IN` clauses through both savepoint and native transaction
drivers; the same seam rejects a statement above 100 bindings. The original
transaction driver exceeded the cap at 101. This Node SQLite seam does not
execute in Workers or prove native JSON-function support.

The browser OPFS lifecycle owner also checks that a silent initialization
rejects at the default or overridden open deadline, terminates its worker,
ignores a late response, and releases the deadline and abort listener after a
successful open. It also checks an abort during synchronous option evaluation,
after the initial signal check but before listener registration. A Chromium
fixture holds the VFS database Web Lock while a second tab times out. It checks
that the queued request disappears, then reopens the database after releasing
the lock. This controlled lock holder does not
reproduce a frozen tab or establish behavior in other browsers.
The [issue #1883 review record](oracle-reviews/issue-1883-opfs-open-deadline.md)
preserves the exact-head unit and Chromium evidence and the queued-lock mutant.

The [browser OPFS lifecycle owner](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/opfs-page-lifecycle-oracle.test.ts)
also generates explicit close histories: zero to three pending executes, how
many answer while close is in flight and in which order, a successful close and
every worker error classification, a concurrent close, an execute submitted
during close, and pagehide or a Worker terminal event before the close
response, which then rejects close and pending siblings with its own failure. At close settlement, answered executes keep their rows and the
rest reject with `AbortError`. Every close call shares the first close's
outcome. The worker receives exactly one close request, and work submitted
after close starts never reaches it. Rejecting at close start, posting a second
close, admitting work during close, deferring rejection past close settlement,
and the pre-fix hang each fail this lane, as does ignoring pagehide or a Worker
error while close is in flight. The controlled worker
answers in any order, so these histories also cover a close response that
overtakes pending work.

The [OPFS request-order oracle](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/opfs-request-order-oracle.ts)
states that a connection settles requests in acceptance order with sequential
results, settles close after them, refuses work after close starts, and keeps
answered writes across a reopen. One module holds the law, the sequential
replay model, the fixed examples, the public-connection driver loop, and the
comparison. Two drivers run it. The
[Node driver](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/tests/opfs-request-order-oracle.test.ts)
runs the real worker module and wa-sqlite WASM build behind a bridge Worker,
over an in-memory VFS with OPFSCoopSyncVFS's lock protocol, with fixed,
random, and SEED/PATH campaigns. The
[Chromium driver](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/e2e/opfs-request-order-oracle.opfs.spec.ts)
runs every fixed example against real OPFS and takes the access handle through
the VFS's own BroadcastChannel and Web Lock handoff. Histories vary one to
three inserts and selects, which execute meets a taken handle, whether the
handle returns before or after close reaches the worker, and an execute after
close. The previous worker handled messages concurrently, so close ran while an
execute waited for the handle and SQLite refused to close. That worker and a
worker that queues executes but not close fail both drivers. Neither driver
proves other browsers, frozen tabs, a crash between a write and close, or more
than one other handle holder. The review record is
`docs/contributing/oracle-reviews/pr-2213-opfs-close.md`.

The ordered-work owner also checks that an Effect with `skipInitial` waits for
joined demand before ending initial callback suppression. A deterministic work
counter rejects an extra joined-filter graph schedule on root readiness while
preserving the joined-source wake-up. Nonterminal per-demand failure recovery
is outside this owner: `failDemand` enters terminal live-query error while its
plan record remains unsettled until sync teardown. A future recovery contract
must reconcile plan and subscription pending state before reopening publication.
Its startup witness covers one synchronous rank update after an indexed page
load and before the last source subscription returns. It does not cover every
source ordering, multiple buffered mutations, or asynchronous startup changes.
The [ordered Effect startup review](oracle-reviews/gap-06-ordered-effect-startup.md)
records its baseline and hostile-mutant observations.

The Collection lifecycle change-event history owner also checks eager auto-index
equality buckets and fresh indexed `eq` live queries against its independent
row Map. Its required same-turn delete/reinsert prefix reaches an already-built
index for both BasicIndex and BTreeIndex. In the batched lane, public rows and
equality buckets are checked after each mutation returns, before any transaction
is awaited; the batched final state and each sequential settled prefix are also
checked. Fresh indexed queries are checked at the final checkpoint.
Fixed and random tails check nearby legal histories. One temporary mutant that
skipped index updates failed the fixed batched final count: one indexed key
versus two model rows. Another fault that preserved the final keys failed the
new returned-mutation check. The direct index refinement owner does not prove
this Collection mutation path. Callback-time index agreement,
the reported insert-seeded string-key setup, adapter cancellation, and
non-local-only persistence remain outside this lane.
The [issue #1912 review record](oracle-reviews/issue-1912-eager-index-history.md)
records the grammar controls, exact reviewed commit, and ORC audit.

The [live Electric immediate-reload witness](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/e2e/electric-immediate-reload.opfs.spec.ts)
checks one Chromium/OPFS history: an `onInsert` handler receives PostgreSQL
transaction evidence, `awaitTxId` and the optimistic transaction settle while
the source row's adapter write is held, and a hard page close is followed by
an empty raw OPFS snapshot before the recovering Collection or Electric starts.
After release, the witness checks the exact public and durable row from live
Electric and records that the reopened page sent no user-insert request. Public
rows are polled before durable snapshots to avoid a full OPFS read on every
pre-publication tick. This bounded history does not prove Windows/Edge behavior,
offline recovery, arbitrary later re-inserts, or a durable-acknowledgment
contract for `awaitTxId`.

The [optimistic-history oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-history-oracle.ts)
now owns the held-row law for sync transactions deferred behind a wrapping
sync's durable step, and checks that every optimistic mutation is visible in
the tick that makes it. Its
[persisted lane](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/persisted-optimistic-history.test.ts)
runs the shared grammar through `persistedCollectionOptions` with
`hold-store` and `release-store` steps and a handler that commits its own
server row. It was RED before the wrapper reported deferred sync keys to
core: when an earlier source transaction's store was held, a settled row
dropped to an older synced row before its deferred server row applied
(insert-then-update and insert-then-delete histories). It is green now, and
mutants that drop deferred keys from the hold, drop the held row at a drain,
or skip the held overlay after a drain each fail it. The grammar also
aborts a deferred transaction before its turn, and ends every history with a
source transaction on every key, so a stale hold or leaked local attribution
shows. That step was RED on the first fix: the wrapper marked an aborted
transaction as handed to the Collection, so its hold never ended, and a
non-optimistic write kept local attribution for a dropped transaction. A
campaign check requires each run to reach a hold across a drain and a hold
released by an abort. Open: wrapper cleanup or source restart while a
transaction is deferred has no grammar step, and a held-row release filtered
as a recent sync echo was not reproduced. The lane uses an in-memory
adapter.
Several tabs on one durable store each run their own source and store
every source transaction they receive. DB promises only eventual
consistency between them: while their streams interleave, a lagging tab's
copy of an older transaction can be stored and announced after a newer one,
so a tab can briefly show an older server state. Every tab delivers the
same log in order, so durable state and every tab converge once the streams
catch up. No lane checks this yet. Ordering the copies would need a generic
source position on sync commits; Electric already stores `{ handle, offset }`
with each commit, PowerSync does not use this wrapper, and persisted Query
collections have no log position.

The [PR #1914 follow-up review record](oracle-reviews/pr-1914-immediate-reload-follow-up.md)
preserves the held-checkpoint and extra-POST mutant results at the exact
reviewed executable commit.

The [PR #1902 review record](oracle-reviews/pr-1902-change-event-history.md)
also covers one-pass queued-sync cancellation, partial-update dependencies on
queued source rows, and focused late-hydration cases in
`packages/db/tests/db-client.test.ts`. Those cases cross queued adapter insert
and delete with a held local mutation. The
[DbClient hydration authority oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/db-client-hydration-authority-oracle.test.ts)
crosses applied adapter insert, update, delete, and truncate with hydration
before and after the applied receipt. It includes delete/reinsert and
truncate/reinsert controls. These owners do not establish arbitrary hydration
stream order, a later authoritative hydration epoch, or unbounded retention.

The [two-tab OPFS remote-subset oracle](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/e2e/remote-subset-two-tab.opfs.spec.ts)
now exercises a real Chromium follower with a QueryClient-backed, filtered
on-demand live query. It checks the function-bearing local request, clone-safe
follower post, public row, and rejection of an invalid nested wire value before
transport. A raw-options mutant fails with browser `DataCloneError`. The
[review record](oracle-reviews/2026-09-27-remote-subset-two-tab.md) names the
exact reviewed commit. The test does not run React, Firefox/Zen, or a live
backend, and it does not settle exclusive OPFS ownership during leadership
transfer.

The [two-tab live Electric OPFS oracle](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/e2e/electric-resume-two-tab.opfs.spec.ts)
crosses real Chromium tabs, Web Locks, OPFS workers, PostgreSQL, and the
installed Electric SDK. It checks distinct per-Collection schema versions,
unchanged public and durable rows when a follower opens, leadership transfer
with later source rows, and recovery of partial-row loss or a fully empty
pre-key-ledger baseline with a stale resume marker. A wrapped source-commit
test in `packages/browser-db-sqlite-persistence/tests/browser-coordinator-oracle.test.ts`
checks scheduler entry before the writer-lock request; the old bypass fails at
that order assertion. The live recovery histories also guard the resulting
progress. These bounded histories do not prove Firefox/Zen,
React rendering, React Native, arbitrary large datasets, or an exclusive-OPFS
ownership topology. Their
[review record](oracle-reviews/issue-1589-live-electric-opfs.md) preserves the
RED and GREEN host observations.

The [issue #2085 review record](oracle-reviews/issue-2085-leader-close-red.md)
preserves the baseline RED result and the subsequent repair audit. The source
Collection law keeps an applied receipt pending after an indeterminate RPC. The
replacement leader checks its exact transaction ID under the writer lock; an
existing ID acknowledges the commit, while an absent ID permits application
only against an unchanged durable anchor. The Collection and a dependent live
query stay in one sync run. Direct mutating RPCs retain the #1845
`IndeterminateCommitError` contract. An absent ID after an intervening write,
reset, or pruning remains indeterminate because applying it could regress a
newer row or opaque source cursor.

The persisted wrapper owner in
`packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts` checks
before/after durability, pending receipts, mounted live-query rows, queued
hydration, later work, known durability failures, and an unchanged
reconciliation reload. Its orphan row-metadata case fails on a shortcut that
skips needed cleanup. Sparse-array, extra-array-property, and nested-prototype
histories require a changed durable value to reload even when ordinary deep
equality would skip it.

The PR #2096 four-oracle review adds a mixed-demand reset route to the
targeted/full-reload history. A previously public row outside the current
filter is retained, refreshed, or deleted according to complete durable
evidence; an unconfirmed DbClient seed remains source-owned. The controlled
reset must publish no intermediate empty snapshot. Eighteen crossed histories
compare every callback snapshot and final rows, including absent or older
durable seed values. The original reset failed at the callback checkpoint.
Targeted peer metadata set/delete now crosses active complete demand, an active
filter, and retired demand with row update/delete/insert: an unconfirmed seed
keeps both its row and its row metadata. The old receiver failed all eighteen
seed-metadata histories. A protected-seed no-op reconciliation control reaches
the same public event cut and emits none; its suspected redundant public event
did not reproduce. Accepted same-key source transactions racing a targeted
notice, paginated mixed demand, a peer write between complete and filtered
reads, and atomic multi-subset reads remain unproved by these controlled
histories. The [four-oracle review](oracle-reviews/2026-10-12-pr-2096-four-oracle-review.md)
records the exact laws, witnesses, and dispositions.

Direct persisted options and their spread copies can create only one Collection,
both with and without a wrapped upstream sync source. The second creation
rejects before it redirects the first owner's local or source writes.
Selecting only the exposed wrapped `sync` config omits the descriptor claim;
the runtime guard rejects that second Collection before changing control
callbacks. A local-only write and an in-flight upstream source transaction
remain with the first owner after the rejection.
The ownership history now starts a selected-sync copy before the original
lazy wrapped-source Collection as well as after it. A copy cannot bind first
and steal the runtime from the successfully constructed options owner. The
LocalStorage peer owner crosses those start orders for a selected `sync` copy
and checks the owner's receipt, public rows, durable bytes, and listener count.
Controlled listener and row observations do not establish that retained module
options stop strongly referencing a cleaned-up restartable Collection. Whether
cleanup promises collectability remains a separate resource-contract question.
Cleanup does not release that claim. A selected `sync` config also cannot bind
a second Collection after the first cleans up; the original Collection can
restart and write through the same runtime in local-only and upstream-sync
modes. Two DbClients materializing one descriptor receive independent runtimes.
A no-demand on-demand full-reload notification reads collection metadata
without fetching durable rows when no row is public. If a retired demand left
public rows, the notification reads one durable snapshot and corrects only
those rows. It retracts a peer-deleted row, updates a changed row, and removes
obsolete row metadata without exposing unrelated stored rows. A later
constrained demand does not need another validation read. An empty bounded
page does not retract a row outside its scope. Eighteen source-precedence histories
for that route preserve accepted source rows across insert/update/delete,
truncate replay, and queued or serial reads. The original unbounded-read path
and direct options reuse both failed these new witnesses before repair.
The notice corrects already public rows even during the idle interval after
demand retirement. With an active unpaginated filter, six further histories
retain, update, or delete a previously public out-of-filter row across targeted
and full-reload notices while another in-filter row changes. The original
mixed-demand implementation failed three of six exact public comparisons;
the repaired path validates previously visible out-of-filter keys from a
complete durable snapshot. Paginated mixed demand, arbitrary overlapping
retired subsets, a peer write between the full and filtered reads, and host
scheduling remain outside these bounded controlled histories.
A failed direct Collection constructor releases its options claim if the runtime
never bound an owner; a corrected retry can then create the Collection. A
successful owner still retains its claim through cleanup. The persisted owner
also checks DbClient hydration seeds against absent, older, and equal durable
rows through complete demand, zero-demand peer validation, and a bounded peer
notice. The active-notice history combines a protected seed with ordinary row
replacement, deletion, and insertion, then repeats the notice with an older
durable seed. These controlled paths assert public rows and change batches;
they do not prove every host-delivered peer schedule. Zero-demand validation
clears orphan row metadata with zero or one public row, while an equal
metadata-bearing row emits no change batch. The full durable snapshot used to
validate visible keys remains O(table) per notice, including when a current
filter leaves previously public keys outside its scope. There is no O(visible)
read budget. A keyed atomic snapshot would need an adapter contract and
receiving witness before that work bound can be claimed.

The persisted wrapper owner models complete durable rows as exact values:
field absence, including an own `undefined` field in the generic adapter,
matters as much as scalar content. Eighteen bounded histories cross complete
demand, retired-demand full-reload notice, and retired-demand reset with field
removal, addition, and scalar change. They compare full public rows, event
values, deleted and newly admitted keys, and a protected DbClient hydration
seed at settled publication. Nine removal histories fail on the reviewed
`8b3debb3a` implementation, while nine neighboring controls pass. The
`undefined` arms are generic-adapter evidence; SQLite object encoding omits
those fields. A captured-read source history checks submitted same-key and
new-key writes after the held read releases, while eighteen complete-demand
source-precedence histories extend the existing bounded matrix. These checks
do not assert that a source write was accepted before the held read releases.

Targeted `tx:committed` notices have separate bounded demand-scope and
partial-patch histories. Six cases cross active `title = Keep` demand and
retired demand with a row that stays in, enters, or leaves that predicate;
five fail at exact public-row comparison and the leaving-active control passes.
Nine more cases protect a DbClient hydration seed against durable replacement,
partial update, or deletion under active complete, active filtered, or retired
demand while an ordinary row changes; all nine fail. Two active-demand union
controls keep a row that leaves `title = Keep` but enters `title = Other`, in
both demand acquisition orders; both pass on the reviewed head. Temporary
first-only and last-only evaluator mutants each fail one control at the public
snapshot comparison.
Ten source-confirmation histories apply a source insert, update, or delete to a
DbClient hydration seed, await its applied receipt, then deliver a targeted or
full-reload peer update, deletion, or insertion. A changing ordinary sibling ensures a
perpetual-seed-protection mutant fails at exact public-row comparison rather
than only timing out. Six same-key operation-order cases cross active complete and retired demand
with delete-then-update, update-then-delete, and two partial updates; three
fail and three pass. The independent models select authored complete durable
rows, while notices carry legal source patches. Delete-then-update and
update-then-delete produce the same separated `changedRows` and `deletedKeys`
but opposite durable outcomes, so the receiver cannot infer the row from that
envelope alone. The baseline failures and neighboring controls are recorded in
the [PR #2096 law review](oracle-reviews/2026-10-12-pr-2096-oracle-laws.md);
the repaired controlled paths pass. Further in-scope source transactions
concurrent with targeted delivery need a same-key acceptance-order witness in
this owner.
Real SQLite delta creation and browser/Electron notification delivery need
matching receiving witnesses in their existing adapter and host owners before
this controlled result can be claimed across those boundaries.
The Electric recovery owner has separate real SQLite restart histories. Its
generated peer-publication history instead uses a Map-backed adapter and a
manually delivered notice. It compares exact public rows, durable rows, and a
committed metadata marker. A full-reload notice requires an authoritative
durable row read in that active-demand history, through either adapter row-read
route. A targeted notice for a previously unseen key may also read durable
rows because its value has no completeness certificate. The oracle does not
treat `requiresFullReload: false` as a no-read guarantee.
The metadata of an unseen targeted row is not asserted to be demand-scoped:
core permits explicit row metadata for an absent row, so this needs a separate
product decision before changing that contract.

The user chose demand-scoped schema-reset publication for on-demand
Collections. With no active subset, reset validates only already public keys
against durable rows; an empty public Collection remains empty, and a changed
or deleted visible row is corrected. Eager reset still restores its full
baseline. Eighteen source-precedence histories cross on-demand reset with
insert/update/delete, source truncate replay, and queued or serial reads;
three focused reset histories distinguish empty, changed, and deleted visible
scopes. They do not establish host notification delivery or a keyed SQLite
read budget. The visible-key validation may read the full durable table.

A controlled term-jump history recovers a missed row; a position-only
certification history shows that observing a durable version
does not publish its rows. Reset continuations rebase the publicly applied row
version, reject a delayed pre-reset notification in both orders relative to a
newer election, and recover a row committed between the reset reload and the
later position-only read. A controlled same-term reset continuation checks two
new-epoch commits separated by a delayed old-epoch notice. The commit envelope
has no reset epoch, so the wrapper rereads durable rows for all three ambiguous
notices; a no-fence mutant publishes the old row. This establishes public-row
safety and its three-reload work cost, not a bounded-work promise. The built-in
coordinator currently has no `collection:reset` sender; a real-host same-term
reset needs a Browser/OPFS receiving witness. A future epoch-aware fast path
needs the persisted wrapper owner to distinguish old and new same-term notices
at each public cut before that real-host receiving witness. The controlled
wrapper compares public rows after each held cut; removing the old-term fence
or treating the later position read
as published rows fails those assertions. The SQLite adapter owner checks exact
IDs, row versions, reset epochs, pruning,
unchanged anchors, same-key peer writes, cursor metadata, durable no-write term
reservation, and the exact-ID index plan against real SQLite transactions. It
also checks that a live claim on a retired physical generation can proceed,
that live claims cannot cross physical generations, that expiry fences
reconciliation and term reservation before a durable write,
and that a new claim remains usable. The Browser coordinator owner checks
writer-lock stream advancement, changed
routes, and invalid wire anchors. It delays a former owner's captured heartbeat
past a no-write Web Lock takeover and checks both the new owner and a passive
follower retain the newer route after the delayed heartbeat. Distinct durable
terms protect the later routed source write. Its election witness checks that
the registered physical storage ID and claim reach term reservation. The
Electron IPC bridge runs the
SQLite adapter contract through its renderer and main-process handlers,
including exact-ID reconciliation and protocol-v5 claim-scoped term reservation. Its
resolved-adapter witness checks that reconciliation carries each Collection's
mode and schema version, and its absent-capability witness checks that an
unknown result leaves durable state unchanged. The real-process witness runs
the renderer adapter in Vitest and sends its envelope to an Electron main
process. It does not execute the adapter inside an Electron renderer or check
concurrent requests from multiple renderers. A reconciliation IPC reply delayed
until after main applies is an untested transport history owned by the Electron
receiving contract. The Chromium/OPFS host owner runs idle, before-durable,
after-durable, peer-before-reconciliation, notification-before-lost-answer,
and cold-successor histories across real tabs, Web Locks, BroadcastChannel,
workers, and SQLite.
It observes durable rows, cursor, and exact applied transaction IDs, public
source/live-query rows, receipt settlement, one sync run, and passive-tab event
counts. The peer history holds
reconciliation before the writer lock until the peer write is durable. Removing
the reconciliation reload marker leaves the passive source and live query
without the original row at that public checkpoint. The real Electric receiver
in `packages/browser-db-sqlite-persistence/e2e/electric-leader-close.opfs.spec.ts`
streams a PostgreSQL row through the installed SDK, closes the first writer
after SQLite applies that source transaction, and checks the surviving
Collection, mounted live query, durable rows, exact applied ID, resume marker,
and later PostgreSQL row. The original Electric applied receipt fulfills in
one sync run. The crossing row's transaction and first durable snapshot agree
on resume offset, handle, and shape ID. It supplies the SDK handoff for this one
after-durable history.

The wrapper's controlled term jump and the real OPFS cold-successor election
are separate evidence cells. The persisted wrapper now has a controlled
same-key peer-write continuation:
X is durable at version 1, Y advances storage to version 2, exact-ID
reconciliation acknowledges X's original position, the source receipt fulfills,
and the wrapper's owned resume evidence fails closed against version 2. A
temporary latest-position response makes that evidence assertion fail. The
real SQLite exact-ID decision and this wrapper receiving history still have
separate drivers; one real-adapter wrapper join remains with the persisted
SQLite receiving owner. A single real-host history combining a missed
original notice, an empty reserved term, and a passive follower's later public
rows remains with the Chromium/OPFS owner. The controlled nested-prototype
replacement reaches source and mounted live-query cuts; real SQLite
serialization of that nested class in the same wrapper history remains with
the Node SQLite receiving owner. The reset continuation uses a controlled
snapshot with the same version-zero premise that the real SQLite adapter's
schema-reset oracle proves. A combined real-adapter wrapper reset and later
notification remains with the persisted SQLite receiving owner.

The persisted wrapper owner also holds an on-demand resume certification across
a newer, sequence-zero term while the row version and reset epoch stay fixed.
It rejects the old exact-generation guard at key-set evidence. The Electric
held-snapshot owner joins the real SQLite term reservation with the persisted
wrapper and mocked Electric stream: the source retains its cursor and reaches
ready with the original durable rows. Neighboring committed-write and schema-
reset histories reject inheritance of the old baseline. The real Chromium/OPFS
reopen history still owns the host election and restart schedule; this local
join does not prove that schedule passes in CI.

A bounded TLA+ design grammar and exact TLC receipts live in
`review-evidence/issue-2085-tla/`. It explores one X, one same-key peer Y,
one reset, delayed/lost notices, position-only observation, and ledger pruning;
it checks the reference laws and kills wrong-design mutants but does not
execute a production path. A separate challenge shows that an old commit
notice can publish an old row after durable reset _before_ a passive peer
receives any reset signal. The built-in coordinator has no reset sender, so
this is an unresolved proposed cross-tab reset law, not a confirmed current
receiving failure. A future sender needs a Browser/OPFS witness for that
pre-signal order.

This bounded owner assumes tabs run the same protocol version and one `txId`
identifies one immutable payload. The Electric receiver does not cover
before-durable loss, queued hydration, two Electric providers contending in
both tabs, seven concurrent Collections, or a closing leader's active SQLite
call; those need receiving schedules owned by
the Browser Electric, hydration, and OPFS page-lifecycle suites. Arbitrary
concurrent writes, physical crash durability, other browsers, and
cross-version tabs are outside the established host evidence. These limits do
not authorize a late apply after an intervening durable write.

The persisted wrapper owner now also checks the no-`pullSince` row-version-gap
fallback at every Collection change callback: a durable baseline, a missed
commit, and a later notice may expose only the baseline or the complete durable
replacement. The old truncate fallback exposed an empty intermediate snapshot.
The Electric recovery owner drives ordinary peer notifications only after its
adapter commits matching rows, metadata, and a contiguous row version; its
bounded peer/stream histories retain exact public-row and publication-marker
checks. The previous fixture announced version 101 while its durable position
remained zero, so the new gap detector treated an ordinary notification as a
missed history. These controlled owners do not prove real Electric delivery of
a lost-notice gap; the Browser Electric/OPFS receiver owns that schedule.
The Electric recovery fixture now distinguishes same-key insert replacement
from partial update merge. Its generated peer-publication grammar varies that
operation and a removable field, and requires a subscriber event carrying the
authored callback-time snapshot when public rows change. A missing-event mutant
fails at that event assertion. The generated same-key insert history found a
receiver violation: targeted notices omit insert/update identity, so a public
row must be checked against durable state before interpreting an omitted field.
The primary persisted owner crosses insert replacement with two-update and
delete/update controls under active and retired demand; removing the durable
check fails both insert histories at exact public-row comparison. These
Map-backed histories do not establish real SQLite notice construction or
browser delivery; the relevant real-provider receiver remains needed.

The [live Electric hydration-straddle oracle](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/e2e/electric-hydration-straddle.opfs.spec.ts)
owns one #1754 host history: an on-demand Collection has an initial durable row;
an OPFS subset hydration is held after its local read; a PostgreSQL update
begins an Electric source transaction during that hold; and the row-bearing
commit is released only after the hydration scope exits. It checks the old row
before release and the exact new public and durable row afterward, then after
follower takeover and reopen. The fixture observes the on-demand run's claimed
storage ID and claim at coordinator registration; PostgreSQL supplies the
expected row independently. A late-buffer mutant leaves the old row in both
observations. The [core persistence tests](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts)
own the adjacent during/straddling/after settlement, FIFO, abort, and failure
histories. The live oracle does not prove eager-startup overlap, other mutation
shapes, arbitrary Electric fetch schedules, Firefox/Zen, React rendering, or
exclusive OPFS ownership. The
[review record](oracle-reviews/issue-1754-live-electric-hydration-straddle.md)
preserves the live-host and mutant evidence.

### Source durability inside a shared hydration scope

The `hydration source durability routing` owner in
`packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts` now runs
144 bounded histories: startup/subscription/after-ready × scoped/unscheduled ×
empty/shared-key baseline × twelve transaction templates. Its independent edit
log covers full upsert, same-key order/delete, truncate/replacement, row and
collection metadata set/delete, truly empty work, atomic multi-row batches,
independent pre-abort, and first/second durability failure. It checks each
acceptance and applied receipt separately, exact durable admission and prefixes,
sequence allocation, current scoped-adapter identity/lifetime, ordinary next
use, a second on-demand scope, and durable reopen. Four cleanup/restart histories
and one early-receipt checker calibration supplement the matrix. Existing
startup-read failure, request-local failed-read/retry, and optimistic causal
replay witnesses preserve no-scope, same-adapter and distinct-adapter paths.
Three callback-lifetime calibrations distinguish nested scopes and both overlap
exit orders. Forwarding-wrapper and explicit-adapter controls cover coordinator
composition and the ordinary registered fallback.

The receiving
`packages/browser-db-sqlite-persistence/e2e/hydration-commit-oracle.opfs.spec.ts`
runs 24 real Chromium OPFS histories plus one cleanup-failure calibration.
It crosses the original phases/coordinators/baselines with single-insert and
rich source histories, and checks three distinct Collection schemas, a cold
peer, metadata, durable rows, and reopen. Sixteen startup/subscription histories
require exact owning-scope exit; eight after-ready controls have no held scope
and report that fact explicitly. The held cut waits for real peer hydration and
ordinary-write scheduling admission. Peer hydrate/regular callback entry and
C's commit SQL remain forbidden until the owning callback exits. Election
stream-position reads are deliberately outside that regular-work law. The tail
joins any truncate-triggered hydration, then must use the default coordinator's
public apply or the browser coordinator's regular scope exactly once. Cycle detection ties the same transaction
to the supplied live scope and its erroneous scheduled call; temporal overlap
alone is insufficient. Captured primary evidence survives cleanup failures.

The default coordinator now uses the supplied scoped adapter for that call,
without caching it. The initial repair receipt on main at `a37e69ab` records
48 core routing assertion failures and eight real scheduler-cycle assertion
failures for the original production code. The latest review follow-up passes
640 persisted-oracle checks (with one existing todo) and 25 Chromium OPFS checks.
The original eight hostile repairs cover premature receipts, cached loans,
omitted data, reverse FIFO and suppressed/misclassified failure. New calibration
shows the old browser checks accepting cached loans and ordinary scheduling
bypass; the strengthened receiver rejects them at tail routing and the complete
scope boundary. A no-scope error-identity mutant is rejected by the restored
failure paths. The
[loss audit and exact content bindings](oracle-reviews/issue-2046-hydration-loss-audit.md)
preserve all source recoveries, decisions, commands, calibration and limits;
the [initial review](oracle-reviews/issue-2046-hydration-commit-deadlock.md)
retains the original issue ledger.

- [ ] **Scoped lifecycle compositions.** The persisted-history owner needs
      distinct-scope witnesses for dependent and post-publication aborts,
      buffered partial-update recovery, row metadata from different owning
      reads, arbitrary queued reloads, and late already-issued storage results
      after replacement. Existing semantic owners remain authoritative. The
      new queued-cleanup witness does not promise rollback of issued writes.
- [ ] **Nested work under fairness backlog.** The shared-driver fairness owner
      (`tests/shared-driver-fairness-oracle.ts` in the browser package, with its
      OPFS receiver) needs a nested source commit inside a hydrate while both
      lanes retain a backlog that distinguishes K=1 from K=2. Finite peer
      progress here does not establish that composition.
- [ ] **Elected-owner/host handoffs.** The per-Collection coordinator owner
      retains transfer/cross-tab RPC while nested durability is pending. The
      OPFS receiver owns provider-supplied physical failure and abort/cleanup
      witnesses; other browsers and native hosts need their own receivers.
      Distinct-schema isolation on this host is now checked.
- [ ] **Historical attribution.** A package bisect is still needed for the
      earliest affected release; this work checks the stated `origin/main`.

### SQLite boolean predicate arity and row work

`packages/db-sqlite-persistence-core/tests/sqlite-boolean-arity-oracle.test.ts`
is the primary executable owner for bounded `and`/`or` predicate arity at
`SQLiteCorePersistenceAdapter.loadSubset` return. Its independent three-valued
model compares public keys while a `node:sqlite` driver records SQL and raw row
work. The 960-case matrix and paired fixed and unseeded campaigns cover root
arity 0–3, one nested operator, boolean and nonboolean operands, safe selective
predicates, and sound candidate supersets for unsafe predicates. Eight direct cases challenge Unicode `ilike`
and `like` patterns, tagged `NaN` comparison, lone-surrogate equality, and
null-vs-missing under `not`. Paired- and lone-surrogate equality controls
retain SQL row-work reduction.
An empty-IN control and two-SELECT cursor composition check zero-row work.

The original compiler was RED for unary and empty boolean work and multioperand
under-selection. The first repair was RED for unsafe SQL prefilters: Unicode
case folding, an emoji spanning two JavaScript code units, tagged `NaN`, and
null-vs-missing under negation. A later lone-surrogate equality witness was RED
for public rows and SQL work. The compiler now applies SQLite JSON extraction
to the matching binding; paired and lone surrogates both keep indexed equality.
The current compiler passes the bounded oracle.
A removed-WHERE mutant fails the raw-row work law and a blind-unary mutant
fails public rows. For this grammar, SQL pushdown admits every row that the
in-memory evaluator could retain; a statically false AND may read zero rows
even with an unsafe sibling.
Mixed-AND witnesses retain a certified equality while an unsafe range, NOT,
or OR sibling stays with the row evaluator. They cover child order and one
nested AND, measure one raw row instead of twenty, and reject a removed-WHERE
mutant. The unsafe OR mutant loses a public row.
A fixed 80-level nested AND witness bounds compiler argument reads to linear
work. It was RED on the prior quadratic compiler and is GREEN after removing
the repeated subtree compilation; elapsed latency and arbitrary depth remain
outside this owner.
TimFL's 50,582-string-ID `AND(OR(IN, IN))` scope was RED for SQL row work:
the adapter returned the right public row but read all 20 stored rows. A fixed
real-SQLite witness now checks the public result, exact candidate count, two
bound JSON arrays, and use of both named expression indexes. It includes
lone-surrogate, NUL, and paired-surrogate string members. Mixed-type lists,
other SQLite hosts, and elapsed-time gains remain outside this witness.

The Node expression-index oracle checks the receiving SQLite query, raw
candidate keys, public keys, and named-index plan. Its generated indexed
grammar uses string equality, BigInt membership, numeric range, and string
conjunction. Focused Date-epoch witnesses keep numeric equality and numeric
membership on the JavaScript fallback path: a stored `Date(1)` matches numeric
`1` in the row evaluator but is ISO text in the SQLite expression index. Fixed
lower-wrapped BigInt membership and lone-surrogate coalesce witnesses also
retain fallback: SQLite converts the former to text and encodes the latter's
inline fallback differently from a JSON-extracted binding. Integer-bound
range cases include adjacent fractional values and tagged or mixed scalars;
this is bounded evidence, not a proof over every persisted representation.
Large Number versus BigInt range cases check both operand directions, four
inequalities, and unary boolean wrappers. Unsafe BigInt bounds admit a wider
candidate range over the indexed expression for potentially rounded Numbers; JavaScript still
decides the public result. Numeric-key object and array cases check public
rows and named-index use through three digit segments, including mixed
carriers. Deeper numeric paths use an unbounded candidate read. Unicode
lowercase cases place NUL before and after a fold and keep the matching row
through either equality direction and unary wrapper.
The receiving Node plan uses the named index for the selective BigInt range
orientation in both operand orders. The opposite orientation can scan because
its candidate union also admits text and rounded Numbers; this oracle makes no
constant-index-use claim for that branch.
Fixed `strftime`, `add`, and Date-range witnesses also use full reads for mixed
stored types; direct SQL would exclude a matching numeric timestamp or string
concatenation. A typed-field contract or a separate indexed representation is
needed before those forms can gain a generally sound selective candidate.

The owner does not establish arbitrary depth or arity, every equality or LIKE
pattern, limit/offset after filtering, all cursor shapes, order or value/metadata
semantics, index-expression compilation, native hosts, OPFS, or multi-process
execution. The existing SQLite owners above retain their separate reset/resume,
order, driver, and host contracts. Broader class closure needs witnesses at those
remaining paths.

## Acceptance map

The post-merge review added three missing domains to existing owners:

- [Top-K batch contracts](https://github.com/TanStack/db/blob/main/packages/db-ivm/tests/operators/topk-batch-contract-oracle.test.ts)
  cross sparse-array length/holes and RegExp source/flags/position with equal
  controls, replacement order, hash consolidation, and actual retained graph
  output. Ordinary replacements also run without the global `File` constructor.
- [Leadership replay](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/leadership-replay-oracle.property.test.ts)
  holds real storage-read delivery across successful and permanently rejected
  durable removals, with bounded scans, concurrent loads, and unfinished peers.
  This is distinct from exactly-once execution across independent owners.
- Settlement-time drop of optimistic state is owned by the
  [optimistic history model](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-history-oracle.ts)
  and [state retention](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-state-retention-oracle.property.test.ts).
  A transaction's optimistic state drops when its mutation function settles.
  Sync transactions committed while it persisted are held and publish with
  that drop; `isPersisted` settles after that publication. Handler sync writes
  are generated at every cut, with and without awaiting their acceptance.
  Receipts stay pending until visible. With one persisting local mutation and no
  truncate, the first queued same-key source transaction consumes local
  attribution at settlement if that mutation succeeds. An absent-key delete
  consumes it without leaving a row. Repeated same-key writes in that first
  atomic source transaction keep its attribution. Later source transactions
  are `'remote'` without another local owner. A truncate can publish while the
  mutation remains active and label its same-key row `'local'` even if that
  mutation later fails. Attribution uses key and timing; `SyncConfig.write`
  has no causal client identity. A pending manual mutation does not hold source
  writes; a same-key source row can retain local attribution after rollback.
  A subscriber can commit a truncate and a later same-key transaction during
  another drain. The suffix truncate can use the still-active mutation's
  attribution. The later same-key transaction in that suffix drain is remote.
  An active mutation on a key the
  truncate does not write still attributes that key's first later transaction
  in the same drain. Bounded histories also cross two
  persisting same-key mutations, one or two source batches, both settlement
  orders, and success/failure combinations. The first source batch is local
  when at least one mutation succeeds; two failures leave it remote. A hostile
  failed-sibling mutant fails the one-success cases at settlement. The pending
  lane rejects a mutant that ignores pending mutations at its source or
  settlement publication. Bounded manual histories now cross success, direct
  rollback, and handler rejection with both optimistic visibility settings.
  A later disjoint edit cannot supply the earlier manual request's handler
  outcome. The original harness left rejected manual requests pending; the
  new settlement check rejects that harness and a shared-handler variant.
  Six pending-peer histories distinguish same-key rollback cascades from
  secondary rollback and different-key controls, through public settlement
  and publication. Longer manual interleavings and larger same-key cascades
  remain outside these fixed histories. The original truncate implementation
  failed the reentrant history at failed-mutation settlement. The earlier
  accepted-snapshot retention law
  and its truncate-capture ownership refinement were retired with this
  contract. The
  [PR #1907 review record](oracle-reviews/pr-1907-accepted-delete-ownership.md)
  is historical. The [settlement-drop review record](oracle-reviews/2026-10-03-settlement-drop.md)
  holds the RED/GREEN and mutant evidence. A handler that awaits a visibility receipt held by its own
  transaction, such as an on-demand load of its own Collection, waits for
  itself; that history is outside the generated grammar.

Issue #2071 adds two focused checks to this acceptance map:

- The [issue #2071 review](oracle-reviews/issue-2071-refused-insert.md)
  checks a rejecting `onInsert` through the persisted wrapper. Four controlled
  histories cross source insert/delete with acceptance before/after rejection.
  They compare live rows, exposed base, durable rows, origin, and a held source
  receipt at mutation settlement and after source application. The
  [real SQLite receiver](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/persisted-real-adapter-lifecycle.test.ts)
  checks two same-key continuations, including a real source `update` after
  reinsert. Each reopens the same file with a new
  Collection, adapter, and SQLite driver. Both the reported release and this
  review tree pass these bounded histories. The reporter's private bridge
  sequence is unavailable; these witnesses do not establish its behavior,
  other mutation kinds, on-demand sync, other SQLite hosts, or an OS process
  restart. The persisted wrapper owner needs the bridge callback and write
  sequence to reach that path.

- The [optimistic publication owner](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-history-publication-oracle.test.ts)
  distinguishes one and two queued same-key source transactions during a
  successful local mutation, two same-key writes inside one atomic transaction,
  an absent-key delete before a source insert, a delete and reinsert in one
  atomic source transaction, a truncate published before
  a mutation fails, pending manual mutations, two overlapping same-key
  mutations, a truncate followed by another same-key transaction, and a
  truncate followed by a different-key transaction with an active mutation in
  one reentrant drain. The persisted wrapper receives the one/two transaction
  pair. The source grammar can now preserve mixed write order inside one
  transaction; its atomic delete/reinsert witness is distinguished from a
  later same-key transaction. These histories establish bounded key-and-timing
  attribution; they do not establish every mixed operation sequence, causal
  authorship, or every overlapping mutation schedule. A
  causal `$origin` guarantee would require an explicit source signal and a new
  core-owner model and provider receiving witness. The
  [PR #2078 review](oracle-reviews/pr-2078-origin-attribution.md) records the
  original same-drain RED, the repair, and hostile controls. The optimistic
  history owner still needs controlled pending-plus-persisting same-key
  histories, truncate with two active owners, and longer reentrant or mixed
  source suffixes if those broader schedules are claimed. Such a witness must
  compare origin and complete publication cuts, not only the final row. The
  persisted wrapper owner still needs the private bridge callback and write
  sequence before claiming that reported path.

| Issue obligation           | Implemented evidence                                                                                                                                                        | Limit                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Metamorphic laws           | Includes cross-formulation/partition, D2 independent-key commutation, DBSP incremental/full recomputation, pagination provider/UI boundaries, optimistic snapshot stability | Equivalence premises are explicit; not arbitrary query rewrites.                             |
| Public observations        | Reads, exact event payloads and reconstructed state, observer eligibility, downstream includes, lifecycle and ownership checks                                              | Count/work budgets are separate from row truth and only pin established promises.            |
| Meaningful async histories | Applied receipts, truncate/replay, cleanup/restart, pending optimistic work, held provider completion, leadership loss                                                      | Control real causes; unsupported SDK traces receive no coverage credit.                      |
| Checker sensitivity        | Faulty output controls, missing/duplicate events, stale completion/ownership controls, forced collisions and pre-fix runtime witnesses                                      | Setup failures and timeouts are recorded separately from assertion kills.                    |
| Executed reach and replay  | Named manifest with guarded replay, finite boundary products, pinned examples, fixed/random lanes and explicit stress runs                                                  | Root `test:oracles` is a selected core/Query DB campaign, not all repository oracles.        |
| Contract and scope records | Guide, companion case notes, this map, suite-local law/domain comments and architecture                                                                                     | This is an executable testing method, not a completeness proof or new product specification. |

## Running and replaying

Build workspace dependencies before testing consumers of package exports. Use
the package's checked-in config; source aliases and native shims must be named
when they replace that path.

```sh
pnpm --filter @tanstack/db-ivm build
pnpm --filter @tanstack/db build
pnpm --filter @tanstack/db test:oracles
pnpm --filter @tanstack/powersync-db-collection test:oracles
pnpm --filter @tanstack/db-sqlite-persistence-core build
pnpm --filter @tanstack/node-db-sqlite-persistence test:oracles
# Service-dependent: requires Electric and PostgreSQL to be running.
pnpm --filter @tanstack/electric-db-collection test:e2e
pnpm run typecheck:tests
pnpm exec tsc --noEmit -p packages/db/tsconfig.json
pnpm --dir packages/db exec vitest run --coverage.enabled=false --maxWorkers=2
pnpm --dir packages/db-ivm exec vitest run --coverage.enabled=false --maxWorkers=2
pnpm --dir packages/offline-transactions exec vitest run --maxWorkers=2
```

Core guarded replay is run from `packages/db`, for example:

```sh
TANSTACK_DB_ORACLE_SEED=1813 TANSTACK_DB_ORACLE_PATH=0 \
TANSTACK_DB_ORACLE_PROPERTY=live-query-observer.granular-history \
node --import tsx tests/oracle-replay.ts \
  tests/live-query-observer-history-oracle.property.test.ts \
  -t 'granular listeners follow the eligibility ledger with a random or replayed seed' \
  --coverage.enabled=false --typecheck.enabled=false
```

Use the failure's actual seed/path for a reproduction. The example establishes
target execution, not reproduction of a particular bug. Local IVM and offline
properties have separate environment variables; inspect their test headers.
Do not assume the core multiplier reaches them.

The Node expression-index oracle runs matching fixed-seed and seedless-random
campaigns by default. Supplying both replay values selects only the requested
seed and shrink path:

```sh
TANSTACK_DB_WS5A_SEED=1659005 TANSTACK_DB_WS5A_PATH=0 \
pnpm --filter @tanstack/node-db-sqlite-persistence test:oracles
```

Stress runs need an explicit file list, run budget, seed policy, runtime, exit
status and cost. For long synchronous campaigns, yield **between complete
histories**, never between an action and its synchronous observation. In this
project, worker progress RPC starvation produced passing assertions with a
nonzero process exit. Such a run is not green. Raising a test timeout alone
does not let the worker process its progress messages.

## Action enforcement example

`examples/react/action-enforcement/eslint-rules/no-direct-collection-mutations-oracle.test.js`
owns the example's file-local lint boundary. Its finite grammar covers 12 binding
forms, six methods, six call forms, and two callback definition orders, plus
lexical shadowing, sibling scopes, configurable imports/methods, and alias cycles.
The independent model labels the constructed receiver as a Collection and
predicts one diagnostic for writes and none for reads. The checkpoint is the
complete diagnostic list from the real ESLint `Linter.verify` call. A receiving
check runs the actual ESLint configuration on feature writes, feature reads,
and action writes. The import-source dimension checks eight alias/relative/barrel
spellings against four nearby unrelated paths, including the real configuration.
Three TypeScript import-equals forms must preserve other diagnostics without
crashing; static and escaped template members are paired with dynamic names.
On `7d3a3e85b`, the expanded suite fails 21 of 32 groups: the parser-node witness
throws while linting; the other failures are missing diagnostics. The repair
passes all 32 groups. A path-prefix mutant that includes `collections-extra`
fails three groups. A template-prefix mutant that treats interpolated names as
static fails the dynamic-name assertion. Both failures reach diagnostic
comparisons; neither is a setup failure.

The original implementation (`3da274d8a`) failed 11 of the 18 test groups at
that checkpoint:
name-based scope pollution, declaration-order dependence, and missed destructuring.
The repair passes all groups. The example README states the conservative rule
for reassigned aliases. This oracle does not establish inter-module or type-based
tracking, function argument/return propagation, new object/array containers,
extracted mutation functions, or dynamic method names. Those are outside this
example's declared static scope; expanding it requires new syntax witnesses here.

Guide evidence: ORC-001–005 and ORC-009 are stated beside the finite grammar,
model and driver. ORC-006 uses the original production rule as the rejected
wrong design; failures are diagnostic assertion mismatches, not setup failures.
ORC-013 pairs writes with reads and imported bindings with shadowing local values.
ORC-007 does not apply to this bounded enumeration; ORC-008 has no stateful model,
ORC-010 has no shrinking or resource cleanup, ORC-011 has no named shared semantic
fault requiring a second formulation, and ORC-014 is witnessed at the real ESLint configuration boundary; no browser
or backend-provider claim is made.
These outcomes supply ORC-012 evidence; the executable suite contains the law
and observations, rather than relying on this record for expected behavior.

`examples/react/action-enforcement/tests/TodoApp.test.tsx` owns the example's
application input and pending-write controls. Its focused component witnesses
use real actions and the fake API with a virtual clock. They check unchanged,
newer, and empty drafts after successful adds; unchanged and newer drafts after
controlled create rejection; native form submission; and disabled toggles at
0, 40, and 119 ms during creation. A settled row remains enabled while another
row is pending, and a newly settled row can toggle and persist its change.
The original component fails the newer-draft, form, and three pending-row checks.
The fixed component passes these nine cases. The lint oracle above cannot observe
these application behaviors, and the shared framework owners do not own form
state.

The component suite also owns add admission: one add may be pending per mounted
form, the input stays editable, and settlement permits the next submission.
Four controlled-create histories cross fulfillment/rejection with repeated
submits before/after a React render. They assert one action and provider call,
reject submissions of a newer draft while pending, then admit that draft after
settlement and check exact persisted counts. A fifth witness checks admission
after synchronous validation rejection. The original handler fails all four
pending-add histories. A guard based only on React state fails the same-render
histories; a mutant that omits guard cleanup fails subsequent admission.

A controlled-toggle history also checks failure and retry in both completion
directions. It observes pending disablement, optimistic state, rollback, visible
error, retry error clearing, and final provider state. The original component
rolls back but fails the error-message assertion. This provider rejection is
injected at the component boundary; it does not claim a real backend emits it.
The same-path rejection probe found no unhandled rejection: Collection cleanup
already catches the persistence promise.

Toggle tests select buttons by accessible role. A hidden-toggle mutant passes
the original tag selector but fails the scoped role query before interaction.
This checks exposure in the accessibility tree; it does not establish keyboard
focus or screen-reader behavior.

These 15 focused cases do not establish arbitrary-length form histories,
remount behavior during pending writes, or browser-native Enter dispatch.
This component suite owns the first two extensions; a browser form witness
is needed for native keyboard dispatch.

## Reusable-law backlog

RFC #1659 reviews found several green oracles whose stated laws remained valid
but whose fixtures, grammars, or observations did not cover a neighboring
boundary. Track the generalized repairs here instead of accumulating isolated
regressions. Completion requires an executable owner, a production-path witness,
a hostile wrong-answer control, and an explicit statement of remaining limits.

- [ ] **Offset-only providers under a joined ordered window.** A provider that
      honors `offset` and ignores `cursor` gets a wrong window at preload under a
      LEFT-joined filter: the ordered loader repeats a continuation `offset`
      capped at the window's `offset + limit` (`countAcquiredRows()`), so the
      provider serves the same page again. Witness: ranks 2, 1, 0 with only rank
      0 marked and limit 1 leaves the window empty (an `it.fails` case in the
      Query DB ordered refetch oracle). Owner: the ordered-work oracle
      (`packages/db/tests/query/ordered-work-oracle.property.test.ts`) needs an
      offset-honoring provider; the Query DB ordered refetch owner then adds the
      offset encoding to its generated campaigns.
- [ ] **Bounded recovery after a failed ordered request.** The maintainer
      decided that full-source reads should be avoided whenever a bounded read
      is available. A failed page, tie, or bounded repair, and an invalidation
      before any request has settled, still recover with a full-source read.
      A first attempt to make failures recover with a bounded prefix repair
      broke 48 pinned expectations and showed real regressions: a wrong window
      (`[1, 4]`, expected `[1, 2]`) after a failed tie request, changed lease
      release after a failed tie, and settlement mismatches in the pagination
      pending-history campaigns. Owner: the ordered-source-loader and pagination
      oracles; the change needs its own oracle work before production changes.
- [ ] **A page-capping provider during an ordered repair.** A provider may
      return fewer rows than a request's `limit`. Under a joined, offset
      window, a row whose order changes can then drop out of the window after
      a refetch, through the loader's own repair; it reproduces on main.
      Witness: the capped-provider `it.fails` case in the Query DB ordered
      refetch oracle. Owner: the ordered-work oracle needs a page-capping
      provider; the Query DB ordered refetch owner then adds page caps to its
      generated campaigns.
- [ ] **Refill after a joined-side removal when a continuation adds no rows.**
      With a current provider, unmarking a window row makes the loader request a
      continuation that returns only rows it already holds, then stop with an
      underfilled window instead of continuing from the new boundary. Witness:
      the `it.fails` case in the Query DB ordered refetch oracle (window `[5]`,
      expected `[5, 1]`); it reproduces on main. Owner: the ordered-work oracle;
      the Query DB ordered refetch owner then checks the window after marker
      flips while the provider is current.
- [ ] **Accepted sync transactions across persistence reads (partial coverage).**
      The persistence-history owner retains the original 24 histories:
      insert/partial-update, one/two/three queued reads, unreserved/reserved
      commit turns, and an absent/present dependent successor. They check applied
      receipts, public/durable rows, metadata, cursor, and durable source order.
      Eight adjacent histories begin during an owning persistence read and commit
      after it finishes. They vary original key membership, commit-turn reservation,
      and one/two later reads. Captured row metadata ownership survives acceptance.
      The maintainer specified that persisted rows are an older baseline for
      newer sync-adapter changes; an internal read cannot revoke an accepted
      sync transaction. Ninety additional histories compare queued and completed
      reads against the same independent snapshot algebra. They cross
      insert/update/delete, no/before/after truncate replay, on-demand subset
      demand, and coordinator reset/full-reload notifications in eager and
      on-demand Collections. Exact settled rows, row metadata, opaque cursor
      metadata, status, applied receipts, loaded rows and durable completion order
      distinguish source precedence from truncate replay's ordered replacement.
      The old guard fails all 45 queued cells; serial controls pass. Omitting
      public truncate fails 60 cells; omitting public delete fails 10.
      Owner: `packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts`.
      The [original review](oracle-reviews/issue-2036-queued-hydration-publication.md)
      and [admission follow-up](oracle-reviews/issue-2036-admission-follow-up.md)
      preserve revision receipts, review dispositions and oracle-guide audits.
      Further witnesses must compose these schedules with cancellation, cleanup,
      or persistence-read failure. Existing rejection of still-open transactions
      across persistence reads remains a characterized admission restriction;
      its independent authority argument is not established by these tests.
      The notification fixtures assume a compatible persisted baseline. They do
      not establish behavior after schema changes or invalidated resume points,
      or each intermediate publication during a multi-transaction truncate replay.
      The same owner needs those histories before claiming those stronger laws.
      A claimed leftover-replay/reset failure still needs a concrete schedule;
      the bounded two-replay-then-reset probe drains replay before reset.
      Live Electric/browser OPFS delivery needs the matching schedule in
      `packages/browser-db-sqlite-persistence/e2e/electric-hydration-straddle.opfs.spec.ts`;
      its current ordering does not establish this handoff.
      These are bounded witnesses, not closure of arbitrary interleavings.

- [ ] **Optimizer residual convergence beyond the checked paths.** The
      optimizer-semantics owner now checks `sourceWhereClauses`, source-free
      predicates, namespace-only predicates, later RIGHT/FULL join nullability,
      and an ordered QueryRef refusal at structural checkpoints. It still needs
      public-row witnesses for later RIGHT/FULL chains, residual checks for
      aggregate, functional, and projection-remapped QueryRef refusals, a
      separate UNION branch model, and incremental source/publication histories.
      Owner: `packages/db/tests/query/optimizer-semantics-oracle.test.ts` and
      its production compiler driver. Each extension needs a distinguishing
      wrong-plan control at the relevant checkpoint.

- [x] **Real-provider conformance fixtures.** Frozen 15.2.7 React Native and
      Node receipts cover the supported peer version; 18.2.1 React Native, Node,
      and browser receipts cover the known forward shapes. Exact-row checks and a
      row-dropping hostile control prove the shim accepts those envelopes without
      mutating them. Owner:
      `packages/react-native-db-sqlite-persistence/tests/fixtures/op-sqlite-provider-results.ts`
      and `packages/react-native-db-sqlite-persistence/tests/op-sqlite-driver-oracle.test.ts`.
      Native device/host execution remains a separate runtime receipt.
- [x] **Minimal ambiguity and name invariance.** Generate one-field and
      otherwise minimally distinguishable results. Renaming a selected column to a
      structural-looking alias must not turn a data row into a write envelope.
      Owner: `packages/react-native-db-sqlite-persistence/tests/op-sqlite-driver-oracle.test.ts`.
- [x] **Carrier coexistence and representation symmetry.** Cross `rows`,
      `rawRows`, `columnNames`, and supported result containers, including legal
      coexistence. Equivalent array and object forms must agree on rows or on the
      documented rejection. Owner:
      `packages/react-native-db-sqlite-persistence/tests/op-sqlite-driver-oracle.test.ts`
      and the shared SQLite driver contract.
- [x] **Shared-handle transaction admission.** Concurrent driver wrappers for
      one provider database handle serialize root transactions. Nested work must
      use the transaction driver supplied to the callback on hosts without async
      context propagation. Owners:
      `packages/node-db-sqlite-persistence/tests/node-driver.test.ts` and
      `packages/react-native-db-sqlite-persistence/tests/op-sqlite-driver-oracle.test.ts`.
- [x] **Transitions at every relevant await.** Hold each coordination boundary,
      then change leadership, remote-subset ownership, abort state, cleanup, or
      restart generation before release. Owners: browser/electron coordinator,
      persisted-history, and collection cleanup/restart oracles.
- [x] **Local-versus-transport refinement.** Compare local-leader and transported
      remote-subset behavior for immutable values. Separately prove that local
      `signal` and `subscription` references survive delivery and reach matching
      unload cleanup. Owners: browser/electron coordinator and persisted-history
      suites.
- [x] **Partial-construction cleanup.** Fail database, driver, worker, and
      subscription construction after each acquired resource. Preserve the primary
      failure while proving all acquired resources are released exactly once.
      Owners: OP-SQLite driver-contract construction and OPFS page/worker lifecycle
      suites.
- [x] **On-demand persistence after evidence changes.** Cross baseline versus
      on-demand hydration with consistent, unknown, and incompatible key-set
      evidence. A baseline certification failure must not silently erase valid
      on-demand rows. `loadSubset` checks baseline visibility and on-demand rows;
      the sync-absent `forceReloadSubset` route crosses the same startup evidence
      states but records baseline visibility as unobserved because that API does
      not expose baseline hydration. Owner:
      `packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts`.
- [x] **Deterministic value-and-work laws.** Pair row correctness with stable
      statement, scan, trigger, or queue-cardinality observations where the
      subsystem promises bounded work. Owners: SQLite resume snapshots, Electric
      acquisition work, shared-driver scheduling suites, and the Node
      same-database-handle admission law.
- [x] **Startup generation interleavings.** Hold persisted startup between its
      metadata and hydration snapshots, then cross no write, a managed mutation,
      and hostile raw loss. Compare public rows with the atomic durable snapshot,
      and require mutation persistence to wait until the prior stream position is
      known. Owners: SQLite resume snapshots and Electric resume snapshot races.
- [x] **Schema-generation fences on cached adapters.** Cross a newer-schema
      reset with snapshot, row, metadata, delta, position, and index-lifecycle
      operations from the cached older adapter. Every stale operation rejects;
      the current adapter remains readable and its index registry remains intact.
      Owners: SQLite resume snapshots plus browser/electron coordinator routing.
- [x] **Explicit omission records.** Add a short `Known omissions` section to
      each primary executable owner touched above and keep this map synchronized as
      laws land. An omission record narrows evidence; it does not waive a product
      obligation.
- [ ] **Atomic active-subset full reload.** Load collection metadata and every
      active subset from one adapter generation, including filtered and paginated
      on-demand subsets. A sound implementation needs an atomic multi-subset API;
      loading all rows or accepting a metadata/row torn pair is not equivalent.
      RED evidence and the deferred executable placeholder live in
      `packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts` under R5-007.

- [x] **Joined aggregate and `singleResult` subquery histories.**
      `packages/db/tests/query/subquery-user-value-oracle.test.ts` checks flat and
      nested aggregate source changes and joined `findOne()` QueryRefs at initial
      and later public checkpoints. The bounded histories and remaining forms are
      recorded in the QueryRef owner row above.

## Persisted readiness and network-first initial rendering

The persisted-readiness oracle in
`packages/db-sqlite-persistence-core/tests/persisted-readiness-oracle.test.ts`
owns the opted-in eager restore boundary through the persisted wrapper,
Collection, live query, and observer. A finite two-source model checks all 36
opt-in/outcome combinations independently of the observer classifier. Its
controlled persistence histories check nonempty
and empty restore while upstream remains pending, all-source conjunction,
mixed opt-out, nested live-query sources, exact failure, SSR seed handoff,
stale cleanup/restart work, an already-restored source, and a two-source
history in which A restores, restarts, and remains pending
after B restores. A new query's persisted readiness and initial-render wait
stay gated until A restores in its current sync run. This history uses controlled
adapter reads and does not claim that an old query survives source cleanup.
The remaining controlled histories cover a network-first deadline,
early network success and failure, network failure before nonempty restore,
client query stream failure before or after empty and nonempty restore or before
observer construction,
joined-source deadline composition, and a derived-query error alone or alongside
a failed client stream that must not be mistaken for network failure. It checks a
separate initial-render wait that leaves network `preload()` unchanged. The
framework conformance suite checks the projected signals in React, Vue,
Svelte, Solid, and Angular, including exact identity for a plain-object restore
error after notification. The window-controller test checks infinite-query
projection, and focused React and Solid tests check Suspense gating. The React
tests check client-stream failure before and after completed empty and nonempty
restore, including a failed record already present before mount. They also
check error-boundary handling for derived-query failures with and without a
failed client stream. A replacement client record arriving during an
initial-render wait has no persisted-fallback witness yet.
This owner uses a controlled persistence adapter, not native SQLite or a real
network provider; it does not prove browser scheduling or arbitrary histories.
The framework identity scenario does not cover every possible rejection value
or an error already present before a hook mounts.

## Deferred contracts and evidence

The maintainer assigned offline policy work to
[RFC #1659](https://github.com/TanStack/db/issues/1659). It is not a merge blocker
for this oracle repair. Keep these scenarios and decisions with that owner:

- **A10 R7/R13:** the executor holds caller success until deletion is
  acknowledged, and a persisted `deletion-pending` phase prevents provider
  replay after a known deletion failure. Controlled restart and adapter-failure
  witnesses cover that boundary. A crash before the phase write, old readers of
  marked rows, physical power loss after adapter acknowledgement, and native
  browser restart or multi-owner handoff remain open. Provider idempotency is
  required to avoid a repeated effect in the first two cases.
- **A10 R4:** [Issue #1939](https://github.com/TanStack/db/issues/1939)
  is owned by the leadership replay oracle. The action grammar crosses retained
  leadership, loss before invocation, and loss during or just after `onMutate`
  after offline selection; a manual transaction loses leadership after its
  optimistic mutation and before `commit()`. The original action path fulfilled
  with no outbox record or provider call. The repaired paths reject and roll
  back; retained-leader and before-invocation controls still fulfill. Later
  leadership changes and a held outbox write crossed with loss or regain remain
  for this leadership oracle, using controlled write settlement and caller
  checkpoints. The [IndexedDB write-settlement owner](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/indexeddb-write-settlement.test.ts)
  still needs a browser-host composition with leadership loss across a write.
  These paths are outside this bounded repair. The [review record](oracle-reviews/issue-1939-offline-admission.md)
  preserves the RED/GREEN and checker-calibration evidence.
- **A10 R5/R9:** manual removal/clear outside the active-provider witnesses and
  broader restored optimistic lifetimes remain open. The settlement owner checks
  the optional retry decision across AbortError, ordinary network, 400/401/403/
  422/404 message, and permanent errors. Each kind crosses true, false,
  undefined, and absent hook answers with 1–3 FIFO peers. The fixed examples
  each receive a campaign run before generated cases, with a reach assertion.
  A later failure checks the current retry count. Public `commit()` witnesses
  cover thrown, null, zero, and fulfilled or rejected Promise hook results;
  a rejected Promise must not escape as an unhandled process rejection. Primitive
  and status-bearing object provider rejections check Error conversion before
  the hook. A status-bearing Error from another JavaScript realm reaches the
  hook by identity, keeps its first retry record, and later settles after a
  successful attempt. A plain status-bearing object still takes the non-Error
  conversion path; spoofed Error tags are outside these witnesses. The first
  stored decision distinguishes terminal rejection from a retry record. A hook
  fault records a terminal rejection for only the failed row. The executor
  removes that row,
  rejects its caller with the hook failure, and continues queued work
  after acknowledged deletion. The public admission witness holds the terminal
  marker read, write, or deletion after a thrown or invalid hook: a new commit
  durably joins the queue at each cut but cannot run before head cleanup.
  The started-write witness crosses write acknowledgement before, during, or
  after the hook fault, including a row visible before acknowledgement and a
  write rejected before storage changes. It checks both public promises,
  outbox IDs, Collection rows, and same-executor peer progress. A visible but
  unacknowledged peer cannot run even after the head is removed. The controlled
  adapter does not cover a write that changes storage and then rejects its
  acknowledgement; fresh executor startup before a held write acknowledges
  remains outside this witness.
  Failed terminal marker or deletion storage still stops the executor: the
  head caller receives the hook error, the batch receives the storage error,
  and queued peers stay durable and unrun. If deletion fails after the terminal
  marker is written, restart removes the marked row without another named
  mutation function call or optimistic restoration. The settlement owner also
  checks terminal named mutation function rejection with failed deletion, a
  halted executor with queued peers held, and offline executor restart without
  a second named mutation function call or optimistic restore. The executor
  does not automatically retry a failed phase write or deletion. A failed
  terminal marker write followed by a crash remains an unmarked outbox replay
  window. The [row-local review](oracle-reviews/pr-1592-row-local-retry-hook.md),
  [retry-decision grammar review](oracle-reviews/pr-1592-retry-decision-grammar.md),
  [rejected-Promise review](oracle-reviews/pr-1592-rejected-hook-promise.md),
  and [error-boundary review](oracle-reviews/pr-1592-error-boundary-review.md)
  record the checker controls. The Node-hosted Promise witnesses do not establish
  browser `unhandledrejection`, third-party thenables, or rejection after executor
  disposal; this settlement owner needs a receiving witness for any broader
  claim. A held provider can reject after `removeFromOutbox` or `clearOutbox`
  acknowledges deletion. The default network retry and a hook's 401 retry both
  reject that caller with the provider Error, keep the outbox empty, and allow
  later same-executor work. Manual removal overlapping the read/write inside
  `outbox.update`, rather than finishing before provider settlement, still needs
  a controlled witness and an atomicity decision in this owner. Broader offline
  retry and recovery policy remains with RFC #1659.
- **A10 R11/R12 and earlier R8:** metadata/native-value domain, old readers of
  new wire records, and unreadable/unknown-version outbox recovery. New readers
  accepting old records does not prove reverse compatibility. Do not delete
  unreadable work silently or invent exactly-once guarantees.

Other explicit follow-up boundaries are owned by
[issue #1820](https://github.com/TanStack/db/issues/1820), not silently claimed
green:

- **Effect disposal:** the existing external-disposal wait and synchronous
  in-handler cancellation are tested. Waiting for independent work returned by
  the initiating handler conflicts with supporting a handler that awaits its
  own disposal. The candidate implementation was removed pending a contract.
- **Proxy native mutators and symbol writes:** retain supported standard
  Map/Set behavior. Decide additional support versus a clear error before
  generalizing expectations; do not silently drop native edits.
- **Progressive/native execution:** eight progressive registrations lack valid
  phase/capability evidence. The progressive suite's expectation that a live
  query preloads before the full sync now matches the core initial-readiness
  law, but no run receipt shows that case executing against Electric. Electric's ready gate is after application, not a
  pre-swap source gate; TrailBase does not supply that capability. The 24 move
  cases and actual native hosts need separate execution receipts. A green
  registration helper or package job does not prove these cells ran.
- **Optional mechanics/performance:** separating the expensive replay-process
  campaign, sharing native runner code only with both host builds verified,
  optional cancellation calibration and proxy construction-work budgets.
  An earlier suggestion to merge unnamed cleanup helpers still lacks exact
  targets; do not perform a blind consolidation.

## SQLite Temporal value preservation

The implemented [v2 grammar and evidence](oracle-reviews/issue-2034-design/v2.md)
cover native `Temporal.Instant` and `Temporal.PlainDate` through the shared
SQLite adapter and local persisted wrapper. Global constructors must be
registered; other Temporal kinds reject. Existing lifecycle, receipt and
publication-before-durability laws remain with their current owners.

- The [typed-value owner](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/sqlite-temporal-value-oracle.test.ts)
  checks real file reopen, direct/nested rows, metadata, replay, equality/range,
  Boolean/IN, large IN, field comparisons, cursor ties/continuation and ordered
  windows. Its directly named rank/text companion supplies independent native
  observations across precision, signed-year, endpoint and calendar families.
  Constructor failures, invalid brands and marker-shaped records are included.
- The [Node expression-index owner](https://github.com/TanStack/db/blob/main/packages/node-db-sqlite-persistence/tests/expression-index-oracle.test.ts)
  checks raw SQL before residual cleanup, final adapter keys and actual named
  index use. Wrapper-created coalesce indexes reach Collection metadata/native
  literals and distinguish adjacent-literal signatures. Small and large scalar
  membership indexes protect compatibility with SQLite's DDL restrictions.
  Numeric array/object native EQ and IN also inspect persisted expression values.
  Mixed-domain polarity checks retain NaN, null/missing and scalar controls.
  NUL strings cover both equality directions, membership and Boolean composition.
  Negated coalesce and scalar eq(in(...), true) keep #1997's full-read fallback.
  Exact replay excludes unrelated native cases; simultaneous semantic/cleanup
  failure retains both errors and still closes SQLite.
- The [ordinary-work owner](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/ordinary-transaction-work-oracle.ts)
  adds twelve native repeated-action success/rollback histories and invalid
  superseded actions. Its independent Map model retains immutable native values;
  kind/text observations reject the old structuredClone false-green boundary.
- The [persisted wrapper owner](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts)
  rejects native remote-subset literals before dispatch/retry, including an
  ownerless leader that becomes a follower while hydration waits or after local
  success followed by sequence-gap recovery. The latter uses the existing
  terminal error path before retry admission. String controls dispatch once;
  existing transient retry, receipt and FIFO histories still run. The
  [mixed-demand refinement](oracle-reviews/issue-2034-recovery-review.md) covers
  both demand orders, retained/aborted/released candidates, both native kinds
  and string controls. It observes valid-prefix dispatch, exact reentrant and
  later error identity, post-terminal replay/retry fencing, and exact release
  objects. Successful controls observe complete demand coverage after held
  transport settles. First-demand-only and replacement-error mutants distinguish
  these laws from the older singleton checks; successful pullSince recovery and
  real-host elections remain separate receiving paths.

The [initial RED receipt](oracle-reviews/issue-2034-temporal-persistence.md)
remains historical. The v2 receipt records failures against original production,
a lexical-order mutant that retains native reconstruction, and intermediate
paired-IN, nested-path, routing and membership-index counterexamples. Final
results are green for the reached paths; this is not a universal proof or a
latency guarantee. SQL cleanup alone cannot compensate for lost candidates.

Remaining witnesses have explicit owners: engine-native/alternate constructors
and old-byte/marker-shaped compatibility belong to the typed-value owner;
native truncate/delete, crash and format-transition histories belong jointly
with ordinary-work/resume owners; real mobile/browser roundtrips belong to each
adapter's receiving contract; actual native multiprocess transport belongs to
browser/Electron coordinator receiving owners. The persisted owner retains
native release/abort/reset and wider ownership schedules. None of those receiving
claims follows from this Node/shared-core result. Same-kind ordering is the
supported domain; arbitrary Temporal arithmetic and other kinds are excluded.
Applications may rebuild old damaged caches through existing schema/reset paths;
no type can be recovered from an already-erased empty object.

### Law enforcement audit

The [law audit](oracle-reviews/issue-2034-law-enforcement.md) strengthens the
persisted and Browser owners after three demonstrated false greens. Captured
pre-validation expectations protect mutable builtin state on acceptance and
rejection. Rich output checks now enforce detachment and exact release-object
identity; later projections must reflect changed input without altering earlier
snapshots. Optional indexes cross both supported native kinds and missing-global
cases, plus independent local/coordinator synchronous and held failures. The
intermediate held cut checks that coordinator completion evidence cannot precede
local settlement; settled cuts check warnings, exact calls, healthy siblings,
readiness and ordinary reads. Mutants establish assertion sensitivity. Copy-work
bounds remain explicitly limited to the measured buffer/record copy seams and
full discarded projections; total allocations, latency, arbitrary third-party
coordinator work, and real-host scheduling are not established by these checks.

### Remaining review investigations

The [high-effort follow-up](oracle-reviews/issue-2034-high-effort-review.md)
records measured work and upgrade behavior. Remaining questions are assigned
to the following owners:

- The boolean-arity compiler-work owner now counts discarded literal quoting
  for bound string IN at sizes 0, 1, 32 and 1,025. The old compiler performed
  two quotes per value; the repair performs none and retains exact rows and
  binding counts (BUG-007, HE-006). This is not a latency bound.
- The [bounded follow-up](oracle-reviews/issue-2034-bounded-follow-up.md) closes
  repeated native literal encoding (HE-007): the typed-value work witness admits
  at most one encoding per literal occurrence for EQ and IN at sizes 1/3/1,025.
  Both native kinds are calibrated against the previous implementation; the
  surrounding expression-index and rank/text owners retain semantic coverage.
- Discarded wire projections (HE-008) are closed for the three persisted admission
  guards by shared validation-only traversal. The [work follow-up](oracle-reviews/issue-2034-wire-validation-work.md)
  records an 18-case persisted matrix: follower/role transition/retry/recovery and
  abort/release during hydration at 0/1/33 bytes. Payload copies drop from two to
  one per successful attempt, four to two across a retry, and one to zero when
  demand retires during hydration. Independent Browser-owner rejection/path
  fixtures cover validation-only admission; frozen rich-value receiving histories
  retain cycles, aliases, detached snapshots, and local lifecycle identity. The
  original guards and no-admission/no-detachment mutants fail at intended
  assertions. Repeated validation traversal and runtime latency remain unmeasured;
  real-host scheduling remains with the browser/Electron receiving owners.
- Optional index specification serialization now shares the existing best-effort
  persistence boundary. The [index-admission follow-up](oracle-reviews/issue-2034-index-admission.md)
  records startup/runtime histories with supported native controls, unsupported
  kinds, missing global constructors, and healthy siblings. The persisted owner
  asserts readiness, exact local/coordinator signatures, warning paths, rows,
  and subsequent ordinary reads. Original source and a local-only repair fail
  six cases each. This covers wrapper admission; real SQLite index execution and
  browser scheduling retain their separate receiving owners.
- The resume owner now proves the selected explicit schema-reset route for
  obsolete indexes (HE-010) and ambiguous legacy marker bytes (HISTORY-002).
  It removes both registry entries and physical indexes before the first read,
  preserves an unrelated collection, and retains newly escaped data and rebuilt
  indexes on same-schema reopen. A registry-cleanup mutant fails this witness.
  Automatic reclamation without reset and lossless old-byte migration remain
  outside the selected policy; this test does not claim either.
- The [Collection index-value owner](https://github.com/TanStack/db/blob/main/packages/db/tests/collection-index-value-oracle.test.ts)
  distinguishes native literals from ordinary tagged records, nested mixtures,
  and the escape envelope while preserving equivalent key orders (BOUNDARY-005).
  Plain and null-prototype own-tag records have isolated metadata snapshots
  (BOUNDARY-004/HISTORY-004). The old implementation fails these public metadata
  observations. Custom-prototype impersonators are outside this owner's native
  contract; the typed-value owner separately checks rejection and rollback of an
  invalid native brand at SQLite persistence.
- The Node expression-index owner now covers ordinary/native-mixed NUL lists,
  four NUL/Unicode positions, positive and negated membership, exact stored index
  values, final keys and candidate containment (VERIFY-NUL-NOTE). The former SQL
  literal encoder fails at the public index-DDL boundary. Direct runtime mixed
  membership already passed; the defect was persisted expression construction.

## Final evidence record

Verification receipts and follow-up issue links are recorded in the PR and
the issue closeout comment. Keep their exact revision/runtime boundaries;
historical counts in research notes do not certify later commits. Closing the
bounded repair means the acceptance map has evidence and each remaining
question has an owner—not that there can be no more bugs.

## IndexedDB Collection persistence

Owner: [IndexedDB oracle portfolio](https://github.com/TanStack/db/blob/main/packages/db/tests/indexed-db/ORACLE.md).
Settled histories compare independently authored scalar rows with public,
subscription, peer, export, raw durable and fresh-restored snapshots. Imports
check changed-value versions; detached driver inputs protect authored truth.
Handler decisions are followed by an ordinary successful insert before a
separate replacement suffix, so replacement cannot erase the observed leak.
Wrong-version, input-mutation and suffix-leak controls calibrate those boundaries.

The transport owner adds twelve histories: delayed clear/import followed by a
later disjoint receiver insertion under FIFO/reverse/duplicate notifications;
idle/cleaned-up clear/import; real manual acceptance after cleanup; and whole-
database deletion with active sibling stores. Every affected public snapshot
must match authored durable operation order after controlled delivery. A raw
unseen row makes excluded-notification handling observable. These cases repair
specific convergence laws; they do not establish arbitrary concurrent receivers.

The [compatibility owner](https://github.com/TanStack/db/blob/main/packages/db/tests/indexed-db/compatibility-oracle.test.ts)
checks full versus getRandomValues-only crypto through write/broadcast, one
reusable descriptor across independent DbClients and cleanup, and injected
factories without ambient IndexedDB globals across typed-key multi-store
restore/import/clear. Wrapper tests distinguish callback, request and native
completion, including durable rows after late callback rejection. Store
creation is additive; declared stores and actual native stores are distinct.
Normal generated persistence tests retain fixed/random campaigns and direct
seed/path replay. Blocked/unblocked open/delete cases check native terminal
settlement and caller connection ownership through later native upgrade/delete.
Native failed opens preserve durable rows/schema. A blocked administrative deletion
retains public and durable snapshots. Its receipt has no row-publication authority;
managed versionchange marks affected Collections errored while retaining rows. Failure to issue
deletion preserves those snapshots. The controlled cases establish no timeout,
cancellation, or automatic in-memory fallback. Native receiving cases below
cover named blocker and release schedules; arbitrary browser lock scheduling
remains open.

The transport owner also crosses two/three independent managed descriptors with
native upgrade/delete. Exact versionchange recipients and zero blocked events
check automatic close. Deletion retains errored public snapshots while fresh
storage is empty; upgrade preserves durable rows. Both require fresh descriptors
for further persistence. The four
original-source assertion failures and repaired cases distinguish this law from
the earlier shared-descriptor fixtures. Raw unmanaged blockers keep the wrapper's
pending-until-terminal law. These controlled cases do not prove browser scheduling.

The concurrent extension adds independent per-Collection expectations, raw
publication and Collection-status recording, native transaction gates and
non-awaiting dispatch. It receives the whole-row omission law and rejects a
full-to-partial application mutant. It also rejects a spurious Collection error,
invalid delta semantics and a repaired partial publication. A serial delivery
fixture fails the overlap reach control. Generated histories use fixed/fresh
parity, original-failure-preserving reduction and checked direct replay.

Executed coverage and remaining package-owned cells:

- **Connection ownership, CR-02:** native managed versionchange with a held
  test-owned readwrite transaction and unmanaged deletion blocking, in all three
  engines. The retirement and deletion-queue owners now receive admitted writes,
  immediate error notification, obsolete reads, late startup, caller/publication
  obligations, and both native blocker-release orders. The retirement owner additionally receives abnormal native closure with ready,
  idle, loading and five admitted persistence operations. Chromium receives actual
  native close/abort through storage clearing; other engines lack that control.
  Raw close bypass and automatic restart remain outside the managed contract.
- **Persistence, PC02:** all six manual acceptance orders for three distinct
  Collection identities, two stores, disjoint same-store keys, reused sibling
  keys, mixed deletes/inserts and unaffected versions. The compatibility owner
  also projects same-ID/disjoint-key payloads by Collection reference, in both
  acceptance orders before/after cleanup. Same-ID/same-key core payload merging
  remains outside that adapter witness.
- **Settlement, PC04/PC06:** first/middle/last clone failure in a three-row batch
  for automatic/manual/import; multi-row held CRUD with both decisions and
  independent peer progress. Raw storage, caller, payload, versions, ordinary
  suffix and restore cuts remain distinct.
- **Transport/settlement, PC08/PC10:** two to five independent descriptors,
  generated read windows across replacement/CRUD, one held whole-row local
  intent crossed with peer CRUD/clear/import, and downstream query cuts. Native
  import exposed transient union publication and ordered peer persistence exposed
  duplicate-insert confirmation; both have source repairs and receiving tests.
  The local-order owner now crosses three held local intents with ordered peer
  update/delete/replace and checks every decided prefix. Peer work interleaved
  between those acceptances, multi-intent intermediate local publications and
  reads straddling unordered writes still need receiving witnesses in the
  pending/transport owners; final local equality does not prove those cuts.
- **Transport, PC12/CC09:** obsolete receiving read success/abort after cleanup
  and restart; native obsolete abort and later restore. Pending mutation caller
  outcome/confirmation into a restarted sync run remains a distinct policy and
  test obligation; callback invalidation does not specify it.
- **Transport/core optimistic, PC16:** non-truncating omission via ordered
  delete/reinsert in controlled and native drivers; active intent, exposed base,
  public snapshot and one-use acknowledgement metadata at held/settled cuts.
  Nested values and several overlapping local intents remain with the core owner.
- **Settlement, AUX01:** valid post-durability send/publication failure still
  needs a native premise and defined caller/source/public outcome. No retry or
  rollback-after-commit policy is inferred.
- **Native/consumer, CC10:** Chromium, Firefox and WebKit receive overlapping
  callbacks, native read/write abort, startup subscriptions, blockers,
  versionchange, controlled page close/reload and restore. Raw evidence survives
  acknowledged page destruction with a held handler. A schedule-dependent mutant
  reproduces its original law/checkpoint in each engine. The controlled pending
  companion checks complete downstream live-query snapshots. Real suspension,
  lost-message recovery, quota/eviction, process-crash durability and evidence
  lost before runner acknowledgement remain open and require their own premises.

Native evidence is per engine. Simulated reverse/duplicate messages do not prove
browser delivery ordering. The package has no leader election, timeout or
in-memory fallback. Same-key writers without explicit persistence order, untested mutable-value
shapes and timing guarantees remain unresolved; separate Collection
acceptance calls do not promise cross-Collection atomicity.

**Typed-key payload identity (HC005):** the
[optimistic transaction payload oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/optimistic-transaction-oracle.property.test.ts)
now crosses four numeric/string pairs, both author orders, insert/update/delete/
repeat-update, and success/rejection. Exact handler payload multiplicity, order,
types and final public keyed rows reject the original collision. The native
host owner receives numeric 0 and string "0" in one insert, then peer update,
import, clear and restore. Core global mutation identity now encodes Collection
id, key type and key value as a tuple. This does not establish interoperability
between distinct Collections that intentionally reuse the same id and key.

**Failed mutation callback context:** the optimistic transaction payload owner
checks that restoration publishes after the failed callback's ambient frame
ends. A subscriber's new write is visible but does not enter the failed
transaction payload. Nested success and failure witnesses retain the enclosing
callback's context for subsequent writes. The reviewed implementation fails the
subscriber payload cut; the frame-specific repair passes it and the adjacent
nested histories. These finite histories do not establish arbitrary subscriber
reentry or cross-scope restoration behavior.

**Failed-callback snapshot work:** the same owner places 16 prior mutations in
one transaction and counts array-entry visits across five no-write `mutate`
callbacks. The eager snapshot on the reviewed code visits 80 entries; capturing
only before the first real `applyMutations` visits none. The neighboring
failed-write histories still check restoration of prior intent. This bound
does not remove the existing linear merge traversal for each real write or
establish elapsed-time performance.

## Compound joins

[The replacement evidence record](oracle-reviews/2026-10-05-compound-joins.md)
records RED admission on main, GREEN refinement, and hostile-mutant failures.
The cold-join reconciliation owner now covers compound equality classes,
nullish operands, two/three terms, order/reversal/nesting, all four join types,
scan/index paths, controlled cold acquisition, and keyed replacement histories.
The identity-output-shape owner checks complete predicates through direct,
from-QueryRef and joined-QueryRef boundaries. The includes-context-transport
owner checks parent values used only in a later equality across both operand
sides and direct/joined-QueryRef sources, in all three materialization forms.

The compiler demand oracle in
`packages/db/tests/query/compiler/lazy-demand.test.ts` independently recomputes
active first-key demand from satisfiable rows. Its finite histories cross
LEFT/RIGHT, two/three fields, both term orders, shared primary keys, nullish
components, and put/remove/restore. Nullish tuples contribute no keyed demand.
The controlled cold provider now applies direct-field IN requests using the
independent value-class labels. Four distinguishing numeric tuples reject
wrong-field demand that the former whole-table provider missed.

The bounded claim excludes arbitrary expression trees and wider tuples. Real
provider acquisition, eviction/reentry, and exact lazy-demand minimality need
receiving witnesses in the cold-join and adapter owners. Compound async,
optimistic, paginated, and deeper nested include histories remain with the
includes-temporal, includes-optimistic, pagination, and includes owners. This
feature does not claim those cross-products are established by its finite
matrix. Consumer hook caches require framework conformance witnesses; the
identity owner proves the compiler identity boundary and fresh public rows.

Review follow-ups remain bounded by the evidence above:

- The cold-join owner must distinguish required acquisition from demand
  minimality. A nullish tuple contributes no keyed demand; a satisfiable tuple
  still needs a positive witness. Real-provider demand counts remain with
  the receiving adapter owner.
- A deterministic 10,000-row-per-side probe measured the new operand-array
  cost and the repair: single equality 20,000 to zero arrays, two equalities
  40,000 to 20,000. Whole-query runtime and heap impact remain unmeasured.
  The always-tuple alternative restores single-equality allocation, so its
  simplification remains a tradeoff for a future measured join benchmark.
- Builder admission checks Boolean join syntax, while the compiler binds
  sources and also accepts direct IR. A single-parse representation would need
  a design for these separate entry points and measured compile-work benefit.
  No parser state or cached validation is added for an unmeasured saving.
- The cold-join driver's cleanup callback unsubscribes before cleaning up its
  live query. No legal throwing-unsubscribe witness was found. The owner is
  `checkWithCleanup` in the cold-join oracle; any future cleanup change must
  demonstrate the throwing path and verify later cleanup plus primary-error
  preservation. This is an evidence gap, not a demonstrated production bug.

### Compound-join planning and identity follow-ups

The second high-effort review at `5bb211519` distinguishes semantic identity
from physical acquisition. A controlled React `useLiveQuery` rerender keeps
its Collection and region-first demand when only the equality order changes.
Freshly compiled controls use the supplied order. The guide now states that
ordering selects a plan when the Collection is created. This React witness
does not establish other frameworks' reuse behavior.

- The compiler/lazy-targets and cold-acquisition owners retain the proposed
  first-eligible-equality optimization. A receiving witness must cross join
  direction, computed operands, direct and subquery sources, and index modes.
- The identity owner retains join-specific unary/duplicate equality
  normalization. Public `and()` requires two operands; direct unary AND IR and
  `and(eq(...), eq(...))` with duplicate terms currently differ from bare EQ.
  A change must preserve general Boolean coercion and test actual Collection
  reuse in the receiving framework. Making loading order part of identity is
  a separate design choice; current identity remains semantic.
- Exact compound acquisition needs a tuple-preserving demand model in the
  compiler/lazy-demand and cold-acquisition owners, plus adapter witnesses.
  Independent per-field IN sets admit cross-pairs from different parent tuples.
  Current first-field candidate supersets remain permitted by the architecture.

### IndexedDB review extension: local ordering and boundary admission

The xhigh review at `6ad2edc42` receives its audit in
[the versioned review record](oracle-reviews/2026-10-05-indexeddb-xhigh.md).
`local-write-order-oracle.test.ts` owns the approved automatic-write ordering
law for one Collection: three authored effects, every handler completion
permutation, every accept/reject mask, held earlier handlers, and synchronous
handler reentry. It checks caller outcomes, durable/public/peer snapshots and
fresh restore. The native suite receives held insert followed by update in
Chromium, Firefox and WebKit. Cross-Collection writers and explicit utility
operations remain outside this ordering contract.

The compatibility owner adds id changes at options/Collection construction,
automatic/manual acceptance and acceptance after cleanup. Transport adds
none/mixed/all version metadata, typed keys, duplicate delivery, invalid message
exclusion with a valid neighboring read, old-connection error propagation, and
native deletion completion separated from callback delivery and database
recreation. Native multi-page tests receive the deletion/recreation premise in
all three engines with the old success callback deliberately held.

The wrapper owner observes native error causes. Settlement counts all native
write requests admitted before the first success and retains its atomic abort
matrix. This establishes request admission work, not an elapsed-time speedup.
Runtime and type tests use source without built DB output. Published declarations
have a separate build-consuming lane after concurrent CI runtime tests finish.

The [law enforcement follow-up](oracle-reviews/2026-10-05-indexeddb-law-audit.md)
records the subsequent calibration and closes the stored-field/type cleanup.

- **Connection closure, XH-06:** implemented under the subsequent approved
  contract. Managed versionchange and explicit descriptor close immediately mark
  affected Collections errored. New reads lose publication authority; native-
  admitted writes finish and confirm without regaining readiness. Applications
  recreate Collections. The retirement owner, core readiness owner, and native
  receiving cases enforce these separate obligations.
- **Deletion lifetime authority, XH-07:** closed under administrative deletion.
  The stale-receipt counterexample was retained before implementation. The
  Collection deletion utility and database-deleted message authority were removed;
  `deleteDatabase(name)` only reports the native administrative outcome. The
  deletion-queue owner checks old/new receipt cuts, retained errored snapshots,
  queued name targeting, and fresh empty storage. The browser owner receives
  both unmanaged/native transaction release orders. See the
  [TLA refinement audit](oracle-reviews/2026-10-06-indexeddb-tla-refinement.md)
  for exact bounds and provider limitations. No persisted identity or deferral.
- **Stored metadata/public types, XH-14:** new version records omit `updatedAt`;
  legacy absent/past/future timestamps retain their row semantics. Persistence
  checks ordinary writes, untouched records, mixed-format restore and replacement.
  Utils now carry output and input types only; source assertions and published
  ESM/CJS consumers preserve the transformation distinction and Collection keys.
- **Ownership, XH-02:** equal/distinct Collection IDs, both manual acceptance
  orders and live/cleaned-up sync runs retain only reference-owned effects.
- **Transport, XH-03/XH-08:** absent metadata at the receiving read is independent
  of startup metadata. Typed keys, initial membership, duplicate delivery and a
  successful suffix are checked. Invalid envelopes cannot issue storage work.
  Native pages receive missing-metadata rows and duplicate notifications in all
  three engines; low-level writes still require their own invalidation.
- **Settlement and diagnostics, XH-04/XH-09/XH-13:** transformed-key collisions
  and schema failures at first/middle/last input preserve rows and versions;
  exact cause identity survives each native admission branch. Request admission
  counters cover automatic insert/update/delete and import, with atomicity
  enforced by the existing abort matrix.

### IndexedDB connection closure: TLA+ refinement owners

`packages/db/tests/indexed-db/retirement-oracle.test.ts` owns the finish
policy's row, caller, admission, read-authority, accepted-work and error-status
laws. `deletion-queue-oracle.test.ts` owns administrative receipt authority across
delete/recreate/delete. `packages/db/tests/truncate-readiness-oracle.test.ts`
owns replacement publication with explicit readiness preservation. Their models
remain structurally independent of production connection listeners and caches.
See the [loss audit](oracle-reviews/2026-10-06-indexeddb-tla-refinement.md) for every
formal transition/invariant, recovered distinctions, fault calibration and bounds.

The browser receiving owner crosses five admitted mutation kinds × three closure
origins × commit/abort in all three engines. It separately receives both releases
of an old native transaction and unmanaged deletion blocker. This last receiving
witness is required: fake-indexeddb 6.2.5 violates the transaction-only deletion
hold. The model law remains normative; the faulty provider does not narrow it.

The closed-connection finish policy is separate from cleanup/restart, physical
crash, lost notifications, post-durability application listener failures and
uncontrolled browser discard. Those existing owners/boundaries are unchanged.
This bounded translation does not claim every formal graph path is executed by
the TypeScript suite or that finite tests prove unconditional progress.

### IndexedDB wrapper observer composition

`packages/db/tests/indexed-db/wrapper-settlement-oracle.test.ts` owns
callback/native settlement independently of native event-observer registration.
Its 20-case matrix crosses native complete/abort, none/additive/property/replaced/
cleared observers and immediate/held callbacks. It checks caller outcome at native
terminal and callback-release cuts, durable rows and exact application observer
events. Twelve cases failed against property-owned settlement; eight controls
passed. Two adjacent native request-error cases distinguish prevented errors that
permit commit from uncanceled errors that abort. The original wrapper owner keeps
callback failure identity and late rejection after native commit. Provider scope
is fake-IDB; no physical-crash or arbitrary event-suppression guarantee is added.

### IndexedDB donor coverage receiving extension

The [sighted donor survey](oracle-reviews/2026-10-06-indexeddb-donor-survey.md)
now has these receiving owners. The [port audit](oracle-reviews/2026-10-06-indexeddb-donor-port.md)
records calibration, validation and the remaining limits.

- DP08: `compatibility-oracle.test.ts` starts two/three native opens against
  absent same/independent names, with identical complete declarations. It checks
  schema, held restore/readiness, disjoint writes, convergence, restore and a later
  upgrade with no orphan blocker.
  `packages/db/e2e/indexed-db/value-oracle.spec.ts` receives three-open
  histories in all engines. These histories settle all opens before writing;
  they do not impose an order on open callbacks or union conflicting declarations.
- DP09: `persistence-values-oracle.test.ts` extends the persistence owner with
  independent tagged descriptions in `structured-clone-oracle.ts`. Seven value
  shapes cross scalar updates, peer delivery, export/import, first/middle/last
  nested clone rejection, metadata rollback and fresh descriptor restore.
  Type, offsets, backing bytes, dates and Blob content are observed inside the
  receiving realm. Native receiving is in
  `packages/db/e2e/indexed-db/value-oracle.spec.ts`.
- DP10: the compatibility owner substitutes six legal database/store names into
  the same authored multi-store history. Prefix neighbors, typed keys in separate
  transactions, version values, peers and restore distinguish routing mistakes.
  `packages/db/e2e/indexed-db/host-oracle.spec.ts` receives all six names
  through single-transaction typed-key insertion, peer update, import, clear, export and fresh restore.
  Prefix-neighbor and anchor snapshots must remain unchanged.
- DP17: `packed-consumer.test.ts` supplements declaration tests with installed
  tarball ESM/CJS consumers and broken-export controls. The browser spec builds
  the same consumer without source aliases and executes it in all three engines.
  Tarball overrides pin the installed dependency closure; registry range selection,
  older Node/tool versions and every public export remain outside this smoke test.

The ordinary local Playwright WebKit profile rejects Blob preparation with
`UnknownError`; its two Blob-containing cells require exact rejection and a
healthy suffix. The additional disposable persistent WebKit profile requires
native acceptance and executes the full preservation/capture/rejection/restore
histories. Chromium and Firefox receive the same full corpus. The provider
rejection branch cannot certify success in the persistent profile.

### IndexedDB approved donor follow-up laws

The [follow-up audit](oracle-reviews/2026-10-06-indexeddb-donor-followup.md)
records the approved contracts and assertion-killed wrong implementations.

- **DP02, abnormal closure:** the retirement owner adds idle/ready/loading and
  five admitted persistence phases. It compares actual native outcome, caller
  settlement, retained public rows, error status, rejected later admission and
  fresh restore. Its forced-close fixture compensates for fake-IDB's missing
  forced transaction abort by aborting those native transactions explicitly.
  Native Chromium storage clearing supplies seven actual close witnesses,
  including six with admitted work. This proves neither other-engine forced
  termination nor physical-crash durability.
- **DP03, blocked diagnostics:** wrapper open/delete and managed opening expose
  the optional native event without settling the caller. Native old/new version,
  independent blocked reach, callback count and eventual terminal settlement
  are checked. No timeout, cancellation or fallback is added.
- **DP12, value capture:** `persistence-values-oracle.test.ts` crosses six mutable
  kinds with update/import behind handler/storage gates. Authored descriptions
  compare writer, peer, export and durable rows after caller mutation. Native
  receiving includes the immediate update snapshot and held settlement cut.
  The core detachment owner checks buffer bytes, view range, aliases in both
  traversal orders, foreign realms and custom-constructor compatibility. Native
  iframe witnesses receive standard foreign ArrayBuffer/Uint8Array/DataView
  aliases in each engine. Shared-memory concurrency, detached/resizable buffers
  and arbitrary class private state are outside these copy laws.
- **DP13, dedicated workers:** the native host owner uses real worker and page
  contexts for typed-key insert, peer update, import, managed close, retained
  error snapshot, late-write rejection and worker recreation/restore. Service
  workers, SharedWorkers and background delivery are unclaimed.

Atomic cross-Collection read-modify-write remains a separate API proposal.
Native durability remains the current receipt. These are accepted design limits,
not deferred implementations of the approved follow-up.

## Electric recovery demand and scoped persisted restore

[The cache-eviction design](oracle-reviews/issue-2056-cache-eviction-design.md)
records the generation and expiry laws and their unresolved cuts. The
[PR #2069 review at 51563046](oracle-reviews/issue-2069-review-51563046.md)
records the Query startup handoff, index reverse-order challenge, all review
dispositions, and the repair commit's ORC-012 audit. The
[review of code head `7f1df5c82`](oracle-reviews/issue-2056-cache-generation-audit-7f1df5c82.md)
records the ORC-012 outcomes, RED/GREEN witnesses, and evidence gaps. The
[receiving-gap audit at `87aead1be`](oracle-reviews/issue-2069-receiving-gap-audit-87aead1be.md)
records the native Electric, shared-QueryClient, and old-leader timeout
histories, their mutant outcomes, and remaining cuts. The
real-SQLite owner checks generation rotation, legacy-writer isolation,
warm-run claims, rejection of moved or expired claims, uncertified key-set
evidence after partial writes, and physical collection of a retired row table.
A held registration test rejects a read after collection and removes its late
DDL and metadata. Two further real-SQLite held-registration histories move one
claim while a warm peer retains the physical generation. They require both an
initial registry insert and a destructive schema reset to check that claim
inside their SQLite transactions; the warm peer keeps its schema, rows, applied
transaction, and resume metadata. The persisted owner checks demand-triggered
and timer-triggered expiry recovery, queued old source commits, and an
optimistic mutation held through the accepted truncate. It also holds
hydration, row-scan, and replay results across claim expiry and checks
publication or returned rows after recovery. A startup history holds private
rotation during index bootstrap and checks that the source cannot enter until
new storage is bound. The real-SQLite
owner rejects an expired startup resume record and checks that a public index
event from an expired Collection cannot remove a warm peer's persisted index.
The persisted owner also holds cleanup across cache rotation and requires the
late private claim to release. It holds a peer full-reload read across claim
expiry, checking both returned old rows and SQLite-style rejection at its
second claim check; a live-claim I/O failure remains terminal. The real-SQLite
owner accepts a valid eager Collection ID with the internal cache prefix and
rejects late managed registration that tries to recreate collected storage
after the first claim check.
Its explicit-storage-target history rejects bare IDs of both ordinary and
cache-generated form. It checks all eleven adapter data operations after a
managed generation is collected, compares every per-ID catalog and physical
table after each rejection, reopens the adapter, and retries the old managed
target after explicit eager reuse of the same ID. The contract is claim
authority, not a reserved naming prefix: an application that explicitly
declares an eager Collection with those bytes may create eager storage. The
bare-ID fallback mutant fails at the first post-collection read. The
[explicit-storage-target review](oracle-reviews/pr-2069-explicit-storage-targets-6b0192c19.md)
records the checked paths, mutants, and remaining native-host limits.
The persisted owner also keeps a subset demand through rotation from an old
row version 10 to a new version 1 and requires the new peer notice to request
source reacquisition. Four held-rotation histories cross old row versions 1 and 10
with an old physical cache's commit or reset before rotation binds. The new
notice has row version 3 or 1, so the old notice can have a lower or higher
version. A fixed and random bounded grammar also varies absent, commit, and
reset old notices, both row versions, and absent or present new notices. The
queued old callback cannot add a source request; the new notice must request
source reacquisition. These use a controlled in-process coordinator whose recording
adapter shares row storage across physical IDs. Exact durable row isolation,
arbitrary interleavings, and native multi-tab delivery remain separate checks.
The persisted owner varies whether a custom on-demand source has an active
subset before claim loss. It requires one source cleanup and a new source entry
after rotation, checks that a retained demand reaches the replacement, and
invokes a late callback from the retired session. The callback cannot publish
or persist its row. A real SQLite receiving history expires the first claim,
then checks reentry, public rows, and the replacement physical cache through
a claimed adapter read. Native-host delivery remains separate.
The controlled owner also holds custom rotation until Collection cleanup; it
requires one old-source cleanup and no replacement source entry after disposal.
The same owner crosses cleanup before and after a held scoped refresh settles.
Its raw coordinator release log requires exactly one release in both orders;
the cleanup-first case rejected the prior double-release path at the late
settlement checkpoint. A real multi-tab transport receiving cut remains open.
The persisted owner also rejects a startup resume read after its claim expires,
including two successive claim losses, then enters the source only after a live
read under the replacement claim. A live-claim read error stays terminal. The
real-SQLite owner now holds a resume transaction before its second claim check.
Its fixed and generated histories cross clock cuts before, at, and after expiry;
row inclusion; zero-to-three rows; and a later peer-claim time. An expired
read makes no generation-specific durable access beyond claim validation; the live peer retains exact rows
and metadata. Removing the transaction-local check and moving it after payload
access fail at separate comparisons. The wrapper's response to that rejection
remains a controlled adapter history, not a composed SQLite startup receiving
history.
The persisted owner holds resume certification across claim expiry: an old
answer or a second claim-check rejection starts private recovery, while a
live-claim I/O failure remains terminal. It also holds initial scoped rotation
while aborting one demand and checks prompt rejection with a sibling still
pending. The CLI owner writes a claimed physical ID through sqlite3, and its
subset-failure cases seed the claimed storage while preserving their public
and durable assertions.
The Browser owner checks two concurrent runs:
the recovering demand reaches its own source owner while the warm run keeps
its source-backed row. Another controlled receiving test delivers a peer
notification to an expired claimant before its renewal timer runs and checks
subset reload. Both coordinator owners offer unload before a held source load
settles. The persisted owner now holds claim renewal after wrapper admission
and varies whether the demand retires before the claim check returns. At load
settlement it requires zero coordinator acquisitions for retired demand and one
for retained demand; the retired case rejected the former late-acquisition path.
It also revokes a claim after a cache subset read, then holds the replacement
acquisition. The active demand must request it once and remain pending until it
settles. The old path made two coordinator requests at that cut. A separate
pre-read expiry history and peer-notice histories cover their narrower cuts;
these controlled paths do not prove every real-host scheduling interleaving.
The Browser coordinator owner holds an acquisition across a failed release and
varies whether the acquisition settles before or after release starts. A pending
release retry survives both orders. Its unacquired-release case observes no
outbound RPC. The overlapping case failed before the acquisition-success path
stopped clearing release retry debt. These are controlled transport schedules;
a real tab crash and an indefinitely unreachable leader remain outside them.
The Browser coordinator owner also checks that a managed local mutation carries
its exact claim into the coordinator-created transaction. Its recording-adapter
law failed before the repair at the target-kind comparison. A follower-RPC
claim-loss mutant fails at its success checkpoint. A real SQLite
receiving history accepts that write and rejects a late local mutation after
rotation without recreating the retired table or registry. Direct coordinator
callers that omit a claim remain outside this adapter law; the coordinator
interface still accepts eager Collection IDs.
The Electron IPC receiving owner forwards claim, renewal, rotation, release,
cache-claim read contexts, exact-ID reconciliation, and durable term reservation
through protocol v6. Its in-process main adapter
witness keeps the logical Collection ID for adapter selection while reads
address the claimed physical storage ID. A direct shared-renderer-adapter
claim/read/release history selects the authored logical ID, and a raw managed
envelope without it fails before main-process selection. The shared SQLite adapter contract
runs its claimed-cache cases over that bridge. A custom main-process adapter
can explicitly disable managed cache generations and retain the full-shape
fallback. The local Electron binary is unavailable, so an actual
main/renderer process receiving cut remains with the Electron runtime-bridge
owner.

The Electric descriptor owner now holds an old SDK snapshot across claim
expiry. The replacement provider session settles both demands from fresh
snapshots, rejects a pending old txid wait, and excludes a late old row from
public and durable state. A second delivery lands during rotation, before the
replacement stream starts; it rejects old callback admission into the new
cache. Initial scoped recovery also forgets imported old txid evidence, and
retiring an incomplete old stream transaction releases its commit turn so a
new demand can start. These histories killed the one-phase restart, retained
acknowledgement, and open-transaction designs at their named checkpoints. The
Electric descriptor owner also holds rotation while aborting one old demand:
that demand rejects promptly and a sibling later applies fresh source rows.
Its overlapping-rotation history rejects a callback from the retired middle
provider session, then requires the final provider session to apply a fresh
subset demand after the second gate opens.
The unabortable restart wait failed at this settlement checkpoint before the
repair. The SQLite owner rejects coordinator stream-position, replay, and
index work from a specific expired claim even while a peer claim is live. An
expired run recovers privately while the healthy current cache remains
claimable. The older Electric resume-race owner explicitly exercises adapters
without managed generations; its unknown and missing on-demand evidence cases
now require full-log replacement. The scoped reset settlement owner uses an
abstract managed claim for that one applied-receipt law; the SQLite owner
checks physical generation separation.
The [bounded cache-authority design grammar](../../review-evidence/cache-authority-tla/README.md)
also checks incompatible resume evidence followed by claim expiry. SQLite's
transaction-time claim test makes that rotation private. The SQLite receiving
owner now holds the real adapter's rotation after a controlled source starts
scoped recovery, expires that run's claim while a peer remains live, then
checks the peer's public and durable rows and unchanged resume metadata, an
empty then fresh subset in the private generation, its reset marker, the
recovering claim's storage ID, and a later claim of the unchanged head. A
mutant that uses the expired claim's remembered storage ID advances the head
and fails at that comparison. The controlled source supplies the recovery
decision. The Electric resume-race owner now supplies an incompatible stored
shape identity, reaches Electric's own scoped-recovery decision, expires its
claim before SQLite's rotation transaction, and checks that a warm peer keeps
its rows and resume metadata while the recovering run gets private storage.
This witness failed before Electric stopped writing a reset marker into the
shared generation. A second real-SQLite witness holds rotation after the
storage transaction but before public truncate. It delivers a retired Electric
callback and starts a distinct demand in that interval. The replacement
session refetches the active empty subset and applies fresh rows for both
explicit demands. Only those rows reach public and durable state. A deliberate
wrong row in the rotated storage fails the held private-cache assertion. The
grammar combines those actions; these fixed receiving cuts supply the missing
implementation evidence.
It does not model physical garbage collection or arbitrary callback schedules.
The separate [receipt-settlement grammar](../../review-evidence/cache-receipt-tla/README.md)
checks the accepted-versus-visible distinction during scoped recovery with a
persisting optimistic transaction. It is bounded model evidence; the
optimistic-history and Electric owners remain the production checks for those
receipt laws.
The installed-SDK delivery owner now holds an old HTTP subset response across
managed rotation and observes fresh demand settlement, public rows, and the
new cache's durable rows after that old response arrives. Its adapter is a
controlled Map; real SQLite and native multi-tab delivery are separate cuts.
The same owner uses real SQLite and the installed SDK for a cold restart after
expiry rotation left a partial row and no reset marker. It observes the row
absent before and after an empty source subset snapshot, including with an
explicit Electric offset or handle. The explicit-cursor cases were RED at the
pre-response public-row checkpoint before the cache-trust predicate changed.
This rules out both early cache hydration and relying on source completion to
delete that row.
The descriptor owner also checks that cleanup during a held rotation fulfills
after rotation settles. It does not establish a prompt cleanup bound while the
adapter rotation remains held.
The Query ownership owner now pairs a real QueryClient with managed Node SQLite.
It advances a cache claim beyond expiry, uses a disjoint demand to trigger
rotation, and requires an already active subset to reacquire its distinct row
without another caller request. A later demand with stale QueryClient data
waits for a new fetch; an old fetch and a public utility refetch cannot publish
or return their retired result. A held real SQLite retention scan cannot delete
a same-key row reacquired in the replacement generation. A released acquisition
cannot launch another fetch after its held old result settles. These are fixed
histories at public-row, request-count, and caller-settlement cuts. A paired-Collection real-SQLite history now gives two on-demand Query
Collections one QueryClient and prefix-overlapping but distinct Query keys.
Only the earlier claim expires; its rotation and fresh fetch must leave the
warm peer's public row, Query cache entry, durable row, current storage ID,
and fetch count intact. A broad prefix-eviction mutant failed at the peer
cache-entry comparison. Shared exact-key cleanup follows the documented Query
cache contract; arbitrary retention schedules and custom provider restart
implementations remain outside these histories.
The expiry and late-fetch histories also read the tested run's claimed physical
SQLite generation after fresh settlement and after the retired fetch resolves;
both cuts require the fresh rows and exclude old rows. A separate active-head
claim would inspect a different generation when an expired run rotates privately.
The same owner distinguishes a private startup rotation from a warm startup:
only the rotated run must refetch a cached QueryClient success. It also holds a
peer Query fetch that began before source entry through that rotation. Both its
late success and late error require a new fetch before demand fulfillment.
Two queued rotations have a separate held-second-rotation cut: the first
recovery cannot reacquire an active Query subset or start a provider fetch.
After the second rotation, that demand must fetch and apply a fresh row.
The Query owner also checks new keys with and without a stale QueryClient value
after claim rotation: one provider fetch satisfies the generation boundary in
either case, with no extra cancelled fetch.
A rejected SQLite rotation instead puts the Collection in public terminal error
and rejects later demands with that same error; this is fail-stop, not a silent
observer freeze. These are real SQLite/QueryClient cuts, not arbitrary provider
failure schedules.
The persisted owner also holds active rotation across index bootstrap and checks
that an index added during the hold targets new storage. Its adapter call log
does not prove native SQLite DDL completion. A virtual-clock history holds the
provider restart after rotation and requires claim renewal once it resumes;
index creation and renewal failures stay best-effort without changing public
readiness. A held bootstrap lets index removal settle before the earlier
creation completes; the wrapper reconciles the final durable index with the
Collection's declaration. Re-adding that index during reconciliation has a
separate fixed witness. The SQLite resume-snapshot owner now runs both
reverse-order histories through the persisted wrapper and real `node:sqlite`
DDL. It holds the first new-generation ensure until removal settles, then
checks the Collection declaration, index registry, and `sqlite_master` after
rotation. Its re-add history makes the replacement ensure finish before the
held reconciliation removal, so a missed final re-ensure leaves the real index
absent. Host-specific native DDL scheduling remains outside these Node cuts.
The persisted Electric interleaving owner holds an uncancelable local cache
read after demand abort. It requires the returned load to remain pending until
the cached row is public, then reject with `AbortError`; both fixed and random
campaigns were RED at the early-settlement checkpoint before the wrapper
separated pre-hydration abort from in-flight baseline settlement. A separate
composed Electric probe confirms prompt abort while a later source snapshot is
held after local hydration. These cuts do not establish cancellation of an SDK
request that has already delivered its rows through the shared stream.

The persisted owner refuses a managed custom adapter that lacks rotation,
renewal, or release, and refuses recovery from a managed source without a
provider-session restart capability. The Browser owner holds the old leader's
release message while the new generation starts its own source demand. Its
host factory owner checks that configured claim lifetime and clock reach the
SQLite adapter. A composed receiving history advances that clock past expiry
and rejects a peer update before reloading the demanded subset. Cross-package
Browser runs require freshly built core package
artifacts because package exports otherwise resolve stale `dist` files.

Reachable limits remain. A source that declares a restart capability must
itself retire callbacks synchronously when recovery calls it. Claim expiry
after core publication but before SQLite accepts the write rejects the receipt
and leaves the Collection in terminal error; a real-SQLite hostile probe
confirmed the row can remain public without becoming durable. The ordinary
durability-failure law permits that fail-stop, while automatic expiry reload
covers admission before publication. The first new-format
claim isolates but does not reclaim legacy storage.
The Browser coordinator owner now drops an old leader's release reply after
its adapter unload, transfers leadership, lets the real RPC timer expire, and
checks that retry retires the outbound acquisition without replaying demand or
unloading twice. A release-without-retirement mutant failed at the new owner's
unexpected load. Claimless direct-adapter access to a physical ID after its
catalog row is collected remains unproved and has a reproduced orphan-write
probe; rejecting it while retaining arbitrary eager Collection IDs requires a
durable distinction for former physical IDs.
The Browser owner
now has a combined receiving history over real wa-sqlite and the controlled
Browser coordinator wire. Two runs hold distinct claims on one generation;
only the earlier claim expires before its renewal timer. A real durable peer
write precedes a matching, manually delivered notice. The expired run reloads
into private storage while the warm peer retains its exact public and durable
row, live claim, and source ownership for another demand. The current head
remains unchanged. An always-rotate-head mutant failed at the head-ID
comparison. Native coordinator emission, multi-tab or OPFS scheduling, and a
composed SQLite-to-wrapper startup rejection were open at that review head.
The SQLite owner now composes a real claim rejection during startup with the
persisted wrapper: the expired run gets a private cache and a fresh demanded
row, while a later live peer keeps its public row, durable row, and resume
metadata under the unchanged head. Its separate three-generation reachability
model varies release, expiry, renewal, zero or two rows, and collection
checkpoints immediately before and at both renewed expiries. It compares
retained row, tombstone, resume, and key contents; both physical tables;
native indexes; every generation-scoped catalog; and claim identities.
Wall-clock passage alone is not a sweep checkpoint. The persisted notice
grammar now holds the fresh source receipt behind an optimistic transaction
and checks a pending constrained demand, stale-row quarantine, the public
publication trace, and release of the exact `(storage ID, options)` refresh
acquisition. Its controlled coordinator supplies the receipt wait. The fixed
Browser receiving cut below supplies that premise with a real coordinator on
one schedule.
The Browser OPFS owner now has a fixed two-context receiving history in which a
real source commit makes the coordinator emit a physical-ID notice over native
BroadcastChannel. One receiver callback is held until its claim expires;
its private reload leaves the warm peer's public and durable rows and current
head intact. An explicit demand stays pending until the fresh source receipt
applies. The renewal timer lies beyond the fixed test window, and the receiver
checks no refetch before releasing the delivered callback. The same fixed
two-context history now also runs the installed Electric SDK
in the expired tab against controlled HTTP source snapshots. It holds an old
subset request and the new source response across the native notice, then
checks pending demand, public and durable rows, and the warm peer. Dropping the
held native callback fails at the refetch-entry checkpoint. Arbitrary native
scheduling and a live Electric service rather than controlled HTTP remain
separate unproved cuts; these
fixed receivers do not close every cache-eviction interleaving.

The [cache-generation oracle audit](oracle-reviews/issue-2069-cache-generation-oracle-audit-53ded62d8.md)
records the generated grammar controls, killed mutants, direct replays, and
the remaining handoff limits for code commit `53ded62d8ef70ccd63b75d0e6dbc0a964f14b17c`.
The [cache-claim gap audit](oracle-reviews/issue-2069-cache-claim-gap-audit-575fb9473.md)
records the added receiving witnesses, hostile checks, direct replay, and
remaining limits for code commit `575fb9473dd7d8eccbe469d0831dc9f71cffddd4`.
The [native SQLite index receiving audit](oracle-reviews/issue-2069-native-ddl-receiver-b4d57ced6.md)
records the two reverse-order DDL witnesses, hostile checks, and remaining
host-specific limit for code commit `b4d57ced63d513dd0dcb794b8e8bb2a840577758`.
The [follow-up review audit](oracle-reviews/issue-2069-native-ddl-review-followup-b42b94b73.md)
records the exact recovery-settlement and target-table assertion repairs for
code commit `b42b94b73ddba79a6a87fa93e71787dd126ea1bd`.

[Issue #2056 evaluation](oracle-reviews/issue-2056-full-mode-recovery.md) records
the original RED and candidate comparisons on head
`f43a16522c990134ae993235a312d2d5e433dc8a`. The later scoped design
revises the Electric guide's on-demand cold-recovery contract. The earlier
“Complete” literacy status is not a claim that every recovery law or provider
assumption is enforced.

Primary owner: `packages/electric-db-collection/tests/electric-descriptor-isolation-oracle.test.ts`.
Its tag-history fixture has no managed cache claim, so an incompatible on-demand
resume waits for a full source replacement while cached rows remain visible
until the source transaction begins. The controlled ShapeStream rejects snapshot
requests in full mode. Tagged cold, legacy, explicit reset, warm resume,
interruption, partial replacement, and late demand have named cuts. Managed
scoped recovery has separate descriptor and installed-SDK histories. The
fixed/random tag campaigns share budget and grammar; a direct seed/path replay
runs only the selected property. An unconstrained subset demand can fetch all
rows because the caller requested all rows; it does not prove bounded network
work.

Receiver: `packages/electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts`.
A real installed SDK receives two launches through the Electric adapter and
persistence wrapper with controlled HTTP and durable storage. Direct demand and
public live-query preload settle through changes-only scoped snapshots in a
managed fixture with separate durable stores for retired and current cache
generations. The receiver verifies `id = 1` and its bound parameter on both
launches. It permits one snapshot to satisfy the live query's active demand
and checks its public and durable row after settlement.
It does not require a second physical request for the same subset. Lost tags,
changed shape, and malformed resume state keep stale B in the retired store
without exposing it after an A snapshot or an empty B
snapshot. The changed-shape case makes B's empty snapshot first. A third launch
with no demand starts no full-shape transport or unrestricted local subset
read. The fixture models generation routing, while real SQLite independently
checks claim enforcement and physical tables. Another receiving witness rejects
concurrent SDK snapshot invocation on the shared cursor. Compatible untagged
resumes and the unmanaged full-log fallback remain separate controls.
An installed-SDK abort witness holds subset HTTP across external stream
retirement, then returns a valid row. The demand rejects, the row stays absent,
and an identical demand is not certified as loaded.
The two-launch receiver also delivers a coordinator invalidation after a
paginated scoped snapshot. The persistence owner crosses targeted, paginated,
full-reload, and reset notifications after an active source row. Its
post-invalidation public-row checks distinguish source authority from durable
cache; the non-scoped paginated reload remains a neighboring control.
The persistence owner also checks that a scoped cache clear preserves initial
Collection loading until the source marks ready. A held optimistic handler
checks that the same clear settles before the handler releases: core applies a
truncate immediately, so the proposed accepted-versus-applied deadlock does
not arise on this path. Its subset settlement law remains separate.
The persistence owner now calls baseline hydration after starting scoped
recovery with a stale durable row. It requires that no row enter the public
Collection and that no full-row resume snapshot be read. This is a direct
capability-ordering witness; ordinary Electric startup does not call baseline
hydration after choosing scoped recovery. The buffered partial-update recovery
read has a gated failed-local-load history: a partial source update may appear,
but it cannot inherit stale durable fields. Removing the scoped read guard
fails at that public-field checkpoint.
`electric-resume-snapshot-races.test.ts` also holds a real SQLite metadata
read across row loss or a committed replacement. Unknown and missing key-set
evidence start changes-only without publishing the cached rows; a row-1 demand
then applies only its source snapshot. This is a fixed Node SQLite receiving
witness, not a generated-history claim or a native Expo result.
Its two cache-generation receiving histories use Electric's real resume
classifier and wrapper with real SQLite. An incompatible stored shape reaches
private rotation after claim expiry without overwriting a warm peer's resume
metadata. A later active-session claim expiry holds the boundary after SQLite
rotation and before public truncate; a retired callback cannot write there,
and a demand started in that interval settles after its replacement subset
applies. The ShapeStream callback schedule is controlled. An installed-SDK HTTP delivery
at this exact intermediate cut and native-host execution are not established.

Applied-settlement owner: `packages/electric-db-collection/tests/electric-oracle.property.test.ts`.
Held optimistic application distinguishes readiness from subset completion for
demand both before and after readiness. A later same-run reset distinguishes a
current replacement obligation from a permanently fulfilled startup gate.
Concurrent initial-error and cleanup cuts observe settlement and lifecycle
authority; cleanup quietly settles in-flight adapter loads. A sibling-demand
abort cut requires one canceled demand to reject promptly while its sibling
and a replacement of the canceled demand wait for the full source snapshot and
succeed after its row applies. A separate external stream abort rejects its
current full-log demand and never certifies an identical later demand as loaded.
These full-log wait obligations still apply when scoped recovery is unavailable;
the scoped path uses SDK snapshots and applied receipts.
The changes-only path has the same refusal both when a subset transport returns
after stream retirement and when an applied receipt is held across that
retirement.
The full-mode retry histories now reject their pre-error demand, then require a
new demand to succeed after a same-run recovered snapshot, both with and
without a held applied receipt. An installed-SDK controlled-HTTP receiver
exhausts 503 backoff, invokes the user's retry
handler, and acquires a new demand while the retry HTTP request is open. It
requires that demand to wait, then succeed after the new full-log up-to-date.
A missing-header response checks that the SDK's refusal to retry rejects later
demands rather than leaving a renewed gate pending. The
scoped reset history acquires a snapshot before must-refetch, then requires
subset-end to apply its row before demand success without waiting for a full
up-to-date. The neighboring full-mode reset retains that stronger wait. The
Electric durable fixture has an adversarial insert check that rejects retained
old columns or tag metadata; it is driver validation, not a new model owner.
The Electric adapter owner now holds an asynchronous user retry decision and
checks that a new full-recovery demand remains pending until source replacement,
while the pre-error demand rejects. It also checks caller abort before subset
transport settlement, while a request is queued behind the SDK cursor, and
while an applied receipt is held. Each original behavior failed at the caller
settlement cut; the fixed driver requires prompt `AbortError` without certifying
that demand. The explicit-resume neighbor keeps malformed durable metadata
untouched until source evidence arrives. The persistence owner now invokes a
retired scoped-recovery capability after cleanup and restart; the original
cleared the replacement Collection, and the lifecycle guard preserves its row.
These fixed schedules do not prove arbitrary overlapping retry decisions or
all failure paths through `startScopedRecovery`. A valid scoped-clear commit
failure with an exact public sync-error observation still needs a witness;
an attempted subscriber-throw fixture did not reach that callback during the
local clear and supplies no evidence for the review's error-report claim.

Remaining witnesses before broader closure:

- Electric tag/history owners: unknown or missing key-set evidence combined
  with tagged scoped demand, multiple resets overlapping held application,
  and partial updates arriving before a scoped baseline. Repeated provider
  errors, SDK retry-loop exhaustion, and a
  scoped reset overlapping a held applied receipt also need witnesses. The
  untagged SQLite metadata-read race is covered above.
- Persistence/coordinator owners: native SQLite reads, browser/electron
  cross-tab transport delivering an invalidation during cache quarantine, and
  source versus local-only truncate durability. Controlled coordinator
  delivery and installed-SDK receipt cover the wrapper response, not the
  multiprocess transport premise. Scoped recovery also needs an explicit
  durable-cache eviction or certification policy: the current reset marker
  makes later uncertified starts repeat quarantine, and deleted durable rows
  can remain on disk. Neither a safe offline subset certificate nor bounded
  storage growth is proved here.
- Installed-SDK delivery and Electric service E2E owners: actual subquery/tag
  emission, overlapping provider responses, and the scoped restart schedule
  against a live service.
- Expo `expo-persisted-collection.e2e.test.ts` and emulator owners: the offered
  node:sqlite fixture, native storage, and actual process relaunch.
- Descriptor/tag and SDK DNF owners, if durable tags are selected: complete
  selected membership and silent active-condition changes persisted atomically
  with rows and the resume certificate, including migration/reset admission.

No individual maintainer assignment or approved deferral is implied by these
executable ownership destinations. The bounded controlled-HTTP and Map-backed
persistence witnesses do not establish class closure across those hosts.

## Paced persistence serialization

Issue #2058's primary owner is
`packages/db/tests/paced-mutations-oracle.test.ts`. Its held-write model
crosses debounce/throttle, explicit leading/non-leading and omitted leading
with trailing enabled, and successful release one tick before, at, one tick
after, or ten ticks after the successor's timer edge. It observes handler
concurrency, start times, transaction states, receipt settlement and identity,
and optimistic rows at admission, timer edges, release, and drain. The original
implementation fails 18 of 24 histories at the held edge; the six
release-before-edge controls pass. The model's immediate handoff after both
prerequisites hold is the chosen pacing policy. The original overlap violates
the independent serialization promise regardless of that policy.

Adjacent histories check renewed debounce quiet, throttle spacing from actual
starts, leading-only admission isolation, same/distinct-key success or failure,
pending cancellation, manual rollback of a persisting transaction, and
synchronous nested admission. Manual-rollback witnesses cross all three serial
strategies, including queue, and observe handler overlap after the public
receipt has rejected. The wrong implementation fails at that intermediate cut;
the repaired implementation waits for the handler itself to return.

The owner also drives a leading debounce successor canceled while the first
handler is held. A third admission after either direct rollback or same-key
cascade must start after its own quiet edge and the held handler's release;
the old callback cannot consume the third call's persistence obligation. The
reviewed implementation fails at that handler-start cut, while the ownership
repair passes both histories. A failed optimistic callback must not retain a
newly created empty pending transaction: admitted debounce, dropped debounce,
and queue paths now have scope-retention witnesses that fail on the reviewed
implementation and pass after cleanup. The owner checks the chosen group-rejection law for a nested admitted call
both with and without an earlier pending call. All receipts sharing the failed
pending transaction reject with the callback error, no member reaches the
backend, and a later independent call persists. The earlier-pending regime
failed at the transaction-state cut before the group rollback repair; both
factories now pass at the throw and scheduled edges. A separate held-handler
matrix crosses debounce, throttle, and queue: manual `commit()` throws before
changing a pending receipt, and the strategy still starts that write only
after its timer edge and the prior handler's release.

The owner also checks one strategy shared by two managers. Reentrant
leading/trailing and ordinary trailing histories retain both separate
transactions at one timing boundary. A renewed-quiet history moves another
manager's eligible callback to the new quiet edge while the first handler is
held. A held-handler rollback keeps the second manager's write behind the first
handler. The reviewed code fails the second
backend-start assertion for both debounce and throttle; the keyed pending-run
repair passes. The owner does not yet cover provider echo, cleanup during a
held handler, longer arbitrary bursts, held default/omitted-trailing
combinations, or more than two managers. It owns those future source-level
witnesses. Leading-only
throttle admission-window timing while a write is held remains a separate
policy question; the existing serialization and minimum actual-start spacing
do not depend on its resolution. Real server ordering, framework unmount
scheduling, and published npm behavior require receiving integration witnesses;
the present evidence is controlled DB source execution. The revision-bound
review record is `docs/contributing/oracle-reviews/issue-2058-paced-serialization.md`.

## Opt-in operator bundles

Grouping, includes, and pooling ship only with the value that names them: an
aggregate or `groupKeys`, an include function, or `pooledLiveQueries`. Joins
are core. `packages/db/tests/opt-in-operator-bundle.test.ts` owns that law. It
bundles small apps from source with esbuild and reads which modules reach the
output. Each of the 10 operator values runs alone, and every one of the 8
combinations of operator families runs with rotating values. An operator's
modules must be present exactly when the app imports one of its values. The
join compiler and public-key reduction must be present in every app. The
single-value runs are positive controls, so a renamed or moved module cannot
pass the absence checks. A mutant that statically imports
`BucketFacadeAdapter` into the live-query builder, and one that uses a
`group-by.ts` helper from the live-query Collection builder, fail it.

The owner checks module reachability only, not byte budgets; `pnpm
size:compare` measures bytes. It bundles `@tanstack/db` alone, with other
packages external, so it does not check db-ivm operators or framework
adapters. Query results under the new API are owned by the existing query and
includes oracles, which run with migrated queries; no oracle compares a
query's old and new spellings on one input.

Operator code is part of query identity. The
[IR identity oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/ir-stable-identity-oracle.test.ts)
runs every combination of `groupBy` (none, bare keys, `groupKeys()`), a select
aggregate (none, built, without its grouping compiler), and an include (none,
built, without its runtime), checks each compile outcome against a small
model, and requires distinct identities for any two combinations whose
outcomes differ. Removing the identity mark for `groupKeys()`, for an
aggregate without its compiler, or for an include without its runtime each
fails it. A second check runs a wider product: `groupBy`, a select, HAVING,
and `orderBy` aggregate each built or without its compiler, an include as a
field, in a `caseWhen` branch, or with a child aggregate, each built or
stripped, and an `eq`-filtered query without a select that a pool can serve.
It takes each outcome from production compilation and requires one outcome
per identity, for the IR identity and for the prepared identity with
`pooledLiveQueries`. Each identity mark's removal fails it, and so does a
pool shortcut that accepts a `groupBy` query. Bare and `groupKeys()` keys
beside an aggregate may share an identity or not; the law leaves that open.

Open counterexample, not fixed by this change: the ordered-window random
campaign in
`packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts` fails
with `TANSTACK_DB_ORACLE_SEED=1593300187` (path `121:1:2:3:2:2`) and with
seed `-1005431615` (path `68:1:2`). Both shrink to one history: `hold`,
`truncateMarkers`, `settle` with a load failure, over an ascending limit-one
window on an on-demand marker source with includes. The convergence check
sees a terminal error. Main at `65d9ada50` and the merge-base `5649a07d4`
fail with the same counterexample, so the operator change did not introduce
it. The campaign reaches this defect in ordinary runs, so CI can fail on it
intermittently until the defect is fixed. Owner: the load-subset replay
owner. Needed witness: a decision whether a truncate during a held, then
failed, load may end the window in a terminal error, and the fix or model
change that follows.

Open counterexample on `main`, not caused by this change: the random
campaign of `packages/db/tests/query/ordered-work-oracle.property.test.ts`
(`eager indexed ordered windows > keeps rows and per-change work bounded`)
fails with `TANSTACK_DB_ORACLE_SEED=1023848973` (path
`34:3:3:3:3:4:3:3:4:4:4`). The history is an on-demand, refetch-signal,
anti-joined, unindexed, ascending limit-one window with nulls first: upsert
row 0 as ineligible, then delete the visible row. The check finds two
full-source requests after a signalling refetch, where it expects none.
`main` at `5649a07d4` fails the same way. Seed `-436579979` reaches the same
check through a joined window (`filter: joined`, `via: link`), fails on
`main` at `5649a07d4` too, and in CI timed out at 5 seconds while it shrank.
The campaign can fail CI intermittently until the defect is fixed. Owner: the ordered-work owner.
Needed witness: whether this unindexed window may use full-source recovery,
which this map allows for unindexed underfilled continuations; if so the
check is too strict for it, and if not production is wrong.

The same comparison fails on main `6c1ca8f8f` and PR #2229 at `7fff3a7e0`
with seed `1902868771`, path `19:2:2:4:4:4:5:9:18:15`. This joined-filter
history changes eligibility through `link`, then touches another row. Both
exact replays report two full-source requests where the check expects zero;
neither reports type errors. The existing contract question remains open.

Open observation without a trace: in one CI run of this change, the random
campaign of `packages/query-db-collection/tests/refetch-ordered-prefix-oracle.test.ts`
timed out at 120 seconds before it printed a seed. The previous CI run took
29 seconds, and twelve local runs with random seeds passed in 38 to 50
seconds each. Owner: the refetch ordered-prefix owner. Needed witness: a
seed that reproduces the slow history, and whether it is a slow shrink of a
real counterexample or a slow passing history.

Open observation without a trace: during this change, one run of the random
campaign in `packages/db/tests/query/includes-oracle.property.test.ts` failed
on the branch. The run did not record its seed or counterexample. Thirteen
later dedicated runs and two full-suite runs on the branch passed, and the
campaign was not run on `main` at that time. Owner: the includes oracle owner. Needed witness: the failing seed and
path from a later run. Until then, this entry cannot tell an operator
regression from an older defect. A later failure of that campaign must record
its seed here before anyone calls it pre-existing.
