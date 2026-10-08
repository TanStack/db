# Standalone descriptor Query binding oracle review

Reviewed semantic head: e4a002a046a8f2d99a6155cf63f1f897e8633909

## Claim and boundary

The standalone Query contract in the SSR guide permits a Query built before any DbClient exists to use a reusable factory Collection descriptor. A consuming hook binds that plan to its current DbProvider client. Two clients using the same descriptor ID and plan must see their own source rows. A descriptor made from an arbitrary concrete config has a narrower one-client contract and is outside this claim.

The React owner is packages/react-db/tests/descriptor-query-binding-oracle.test.tsx. Its reference model is one plain row map per client; a write changes only that map. Two fixed legal histories use disjoint IDs with inserts, or one shared ID with different values and updates. Each builds one Query before the clients, mounts it under two providers, writes to each client, and switches one mounted hook A→B→A. At each settled publication, the refinement check compares the complete public projected rows, each row's $key, and the exact public field set against the map for the current client. Query-plan identity is also compared with direct Collection formulations. Model seed rows are copied before entering production.

The separate core witness in packages/db/tests/db-client.test.ts preloads a nested form of one Query in two clients and compares distinct dehydrated rows with equal query hashes. The React witness establishes the bounded hook behavior above. Neither witness establishes on-demand acquisition, joins, union sources, concrete-config descriptor reuse, or non-React adapters. The coverage map assigns those open cells to the React owner or a receiving owner for the relevant adapter and public observation.

## Guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass. The SSR guide states the standalone Query and factory-descriptor contract; the oracle and coverage map bound the claim. |
| ORC-002 independent judgment | Pass. Plain per-client maps predict rows without importing the query builder, materializer, binding cache, or live-query engine. Production receives copies of the model's seed rows. |
| ORC-003 visible responsibilities | Pass. The opening prose states law, model, histories, observation, and limits; the driver and comparison sit beside the executable history. |
| ORC-004 generated grammar | Not applicable. Two fixed histories are claimed, with no generated-history coverage claim. |
| ORC-005 production path and observation | Pass. The driver uses the public useLiveQuery hook under DbProvider, and compares public rows and $key after each settled publication and provider switch. Both cases execute and pass. |
| ORC-006 calibration | Pass. Three temporary mutants reached the intended comparisons and failed by assertion, as detailed below. None remains in the branch. |
| ORC-007 fixed and random campaigns | Not applicable. The oracle has no important generated property. |
| ORC-008 stateful-model minimality | Not triggered by this change. The existing two-map model retains the same state; the new history varies key collision and write kind. Separate maps are necessary because a write to A must leave B's expected rows unchanged. |
| ORC-009 vocabulary mapping | Pass. Each map is a model-only projection of one client's expected public rows. A model write corresponds to a Collection insert or update; the comparison cut is the settled public hook result, not a sync transaction or source snapshot. |
| ORC-010 failure fidelity and cleanup | Not triggered by shrinking or failure normalization. The fixed tests assert before unmount and use the React test harness for cleanup. |
| ORC-011 independent second formulation | No named shared semantic fault requires a second result model. The direct Collection formulation checks plan identity; it is not presented as a second row oracle. |
| ORC-012 review evidence | Pass for this bounded claim. This record names the exact semantic head, all guide outcomes, mutant outcomes, witness boundary, and open cells. |
| ORC-013 distinguishing boundary witness | Pass. The disjoint history rejects binding to the first client. The colliding history rejects a global row-ID cache that the disjoint history accepts. The $key comparison rejects a separate global public-key cache. |
| ORC-014 controlled-premise handoff | No real-provider claim is made. The mock sync factory supplies independent initial rows and local writes; real adapter timing and persistence remain outside this controlled React witness. |

## Distinguishing evidence and closeout

The first-client bound-query mutant returned A's row where the disjoint history expected B's row. It failed at the public row assertion. The colliding case also failed in that run, but the mutant's global cache carried state from the earlier case, so the disjoint case is the clean witness. A global row-ID cache passed the disjoint case and failed the colliding case at B's value: first instead of second. A global public-key cache failed the $key assertion: a instead of b. All three outcomes were assertion failures at the intended checkpoint, not setup failures or timeouts; the temporary mutants were restored.

This evidence covers reusable factory descriptors, one prebuilt basic projection Query, two controlled React clients, independent insert or same-key update, and a mounted A→B→A switch at settled public-row checkpoints. No reachable counterexample was found in that bounded domain. The broader descriptor-binding law remains open for the cells listed in the coverage map; each needs a receiving oracle with its own public observation before a broader closure claim.

The React oracle and existing useLiveQuery suite passed 62 tests in two files. ESLint, Prettier, and git diff --check passed. The SSR guide's two bare preloadLiveQuery calls were corrected to the documented config-object form in the reviewed semantic head.

## Follow-up audit: React Effects and preparation

Reviewed semantic head: a037c605221fa458e06796dd85ef81774b41c314 (2026-10-08). This entry supplements the earlier e4a002a0 audit; it does not revise that earlier verdict.

The added Effect history uses the same prebuilt factory-descriptor Query under two DbClients with the same row key and different values. At initial publication, each `useLiveQueryEffect` must report its own client's public row. Switching one mounted Effect to the second provider must report the second row. The model is the pair of plain input rows, copied before seeding production; it does not use the query compiler to predict values. The public observation is the ordered `onEnter` row sequence at the settled test cut. The Effect witness covers initial enters and one A→B switch. It does not establish later source writes, on-demand loading, joins, unions, or non-React Effects.

The new witness failed on the prior code head 8361d12ad during Effect setup with the unbound descriptor error. On a037c6052 it passed. A temporary hostile fixture made both clients supply the first client's row while retaining the second client's expected row; the oracle failed at its initial public-event comparison (`first` observed where `second` was expected). That was an assertion failure at the intended checkpoint. The fixture was restored. This checks that a wrong cross-client row result cannot pass merely because the two rows share a key.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001 authority and limits | Pass. The standalone descriptor contract and the existing two-client law also govern a client-aware React Effect; the new fixed history and open cells are stated above and in the coverage map. |
| ORC-002 independent judgment | Pass. Plain expected rows are copied before entering production and compared with callback values. |
| ORC-003 visible responsibilities | Pass. The oracle opening prose now names the Effect law, model, fixed history, callback observation, settled cut, and limits beside the executable witness. |
| ORC-004 generated grammar | Not applicable; this follow-up adds a fixed history. |
| ORC-005 production path and observation | Pass. The driver mounts the public hook under `DbProvider` and compares complete projected `onEnter` values after initial publication and a provider switch. |
| ORC-006 checker calibration | Pass. The hostile first-client-row fixture failed by assertion at the public-event checkpoint; the previous production code failed earlier during Effect setup. |
| ORC-007 fixed and random campaigns | Not applicable; no generated property was added. |
| ORC-008 stateful-model minimality | Not triggered; the two independent client inputs remain distinct because a provider switch changes the required event value. |
| ORC-009 vocabulary mapping | Pass. A model row is one client's expected projected public row; an `onEnter` event is the Effect's public observation, not a source change message. |
| ORC-010 failure fidelity and cleanup | Not triggered by shrinking. The fixed test unmounts both hooks after its comparisons. |
| ORC-011 independent second formulation | No additional shared-fault hypothesis is claimed for the fixed Effect history; the existing `useLiveQuery` two-client result is a separate consumer path. |
| ORC-012 review evidence | Pass for the bounded follow-up claim. This entry names the reviewed semantic head, all guide outcomes, the negative controls, and open cells. |
| ORC-013 distinguishing boundary witness | Pass. Same-key, different-value clients and the hostile first-client-row fixture distinguish the required client binding from a wrong cross-client row. |
| ORC-014 controlled-premise handoff | No real-provider claim is made. The controlled sync fixture supplies each client's initial row. |

Two focused core tests also failed before the fix and pass on a037c6052: preparation of an unfinished builder without a client now returns the builder unchanged, and the core unbound-descriptor error no longer recommends React's `DbProvider` to callers in other frameworks. The focused core and React runs passed 16 tests across three files, with no type errors. React package build, ESLint, Prettier, and `git diff --check` passed.

## Public IR compatibility follow-up

Reviewed semantic head: 368bcbca1f8b94cd3d7e4e08537198c7c890a5ac (2026-10-08). The prior `IR.CollectionRef` exposed `collection` as an enumerable, writable own field for a concrete Collection. The descriptor implementation at c99228736 instead exposed an enumerable `source` field and a prototype `collection` getter. A spread lost `collection`, and assignment failed.

The focused public-API test `packages/db/tests/query/collection-ref-compatibility.test.ts` failed on c99228736 at the own-key comparison. It passes on 368bcbca1. A concrete ref again exposes and permits assignment to its own `collection` field. Its `source` getter follows an assigned Collection. An unbound descriptor ref still keeps its descriptor until a receiving client binds a cloned plan, and reading its `collection` fails with the intended missing-client error. This fixed shape check is sufficient for the finite own-field contract; it makes no general oracle claim about arbitrary IR walkers over unbound plans.

The focused DB and React runs passed 116 tests with no type errors. DB package build, the private-member minification check, changed-file ESLint and Prettier, and `git diff --check` passed. Generic traversal of unbound descriptor refs remains outside this compatibility claim; callers can distinguish those refs through `descriptor` before reading `collection`.

## Distinct descriptor IR follow-up

Reviewed semantic head: ad49d7427f76c4e9dae5d25b24f14d09dd3e07fe (2026-10-08). This entry supersedes the descriptor representation described in the prior public IR compatibility follow-up. It does not change that follow-up's concrete Collection shape result or the earlier React oracle verdicts.

An unbound descriptor is now an `IR.DescriptorRef` with type `descriptorRef`, an own `descriptor` field, and no `collection` field. `IR.CollectionRef` again represents only a concrete Collection and retains its enumerable, writable own `collection` field. Placement cloning turns each descriptor ref into a concrete ref when a resolver is supplied. `IR.collectSourceRefs` traverses either source kind. The existing `IR.collectCollectionSources` return type remains concrete and reports the missing client if a descriptor is still unbound. Compilation makes the same check before optimization.

The focused shape test was written first. On the prior head bfa4d1ffa, its builder observation failed by assertion: `collectionRef` appeared where `descriptorRef` was expected. On ad49d7427, it passes. The test checks the concrete own-field shape, the unbound discriminant and absence of `collection`, the bound clone's new source ID, and a finite IR position matrix for nested query, `unionFrom`, `unionAll`, join, and include sources. Each matrix case names its expected aliases independently of the traversal function, then checks unbound collection traversal rejects and bound traversal returns all concrete refs with distinct source IDs. It does not execute those query forms or compare their public rows.

The React two-client oracle's contract, model, histories, driver, and public-row comparisons did not change. Its three tests pass on this head. The focused DB descriptor and identity run passed 115 tests, and the nearby optimizer, union, join, include, and identity run passed 447 tests, each with no Vitest type errors. DB and React builds, DB and React TypeScript checks, the private-member minification check, changed-file ESLint and Prettier, and `git diff --check` passed. The changeset is minor because exported `IR.From` now includes `descriptorRef`. Public row behavior for descriptor joins, unions, includes, on-demand sources, and other frameworks remains assigned to the coverage map's receiving owners.

## Follow-up audit: committed Effects and nested placement

Reviewed semantic head: 1413277f11f0fb51e44a9d3688ab0c780b350169 (2026-10-08). This entry records bounded evidence for the subsequent review and follow-up changes; it does not revise the earlier heads' observations.

A committed `useLiveQueryEffect` may acquire a descriptor Collection without render deferral. The existing Effect row model still compares two clients at initial enter and a provider switch. A new fixed history uses one client's plain expected row, waits for its public `onEnter` event, then checks that `DbClient.dehydrate()` contains the source row and key. Before the change, the dehydration assertion received no Collection chunk. After the change, it passes. The effect now uses ordinary client materialization in its post-commit setup and has no deferred-source resume or rollback path. A controlled probe of the former setup reached a query-start error followed by a different resume error, showing why that cleanup could replace the original exception. Removing the resume path eliminates that second throw from Effect setup; the probe does not establish error ordering for unrelated source factories.

A fixed same-hash history mounts a concrete query without a client, then changes that mounted hook to an unbound descriptor query with the same stable plan hash. It checks the public missing-client error at the attempted consumption cut, before any prior row can be returned. The test passes. Hash equality itself is intentional: the earlier two-client oracle and nested preload witness require one descriptor plan and each client's concrete form to share semantic identity. This witness covers the ordinary derived-identity hook path, not an explicit caller-provided `queryKey`.

A focused core placement witness checks the inner source's IR immediately after a client-aware builder places a standalone descriptor Query. Before the change it observed `descriptorRef`; afterward it observes `collectionRef`. The existing two-client nested preload witness checks public rows at a later consumption cut. The placement witness does not claim public-row coverage for every nested form. A separate focused React regression checks that an Effect query function returning `undefined` reports a clear invalid-query error; before the change it threw a property-access TypeError. Both DB and React packages build, 54 focused DB tests, 253 neighboring subquery/union/join/include tests, and the full 376-test React suite pass with no Vitest type errors.

The review's repeated-preparation work is real: a controlled three-prepare probe observed three source materialization calls. The ordinary React path prepares once per render, so the claim of several preparations per render is too broad. A bound-builder cache would have to preserve per-render source deferral and account for mutable exported IR; this audit does not establish a safe cache law or implement one. Compiler entry collects concrete sources before later `descriptorRef` branches, while direct IR traversal and Effect source extraction can still reach their own missing-client checks. The generic core error deliberately omits a React-only provider instruction; the existing core test protects that cross-framework wording. Public row behavior for descriptor joins, unions, and includes remains open.

## Scope and preparation-work follow-up

User decision on 2026-10-08: descriptor binding in Vue, Solid, and Angular adapters is outside this work's contract. Those adapters have no DbClient input. Their callers use concrete Collections. Svelte has a DbProvider path and remains an open receiving-adapter witness in the coverage map. This decision changes the coverage classification, not the current adapter behavior.

The warm-client preparation probe on Node 24.19.0 used seven timed batches per shape. It called `prepareLiveQueryValue` with a new deferred set on each iteration. A concrete-Collection plan provided the same-shape comparison. Median prepare times were 0.61 versus 0.43 microseconds for one source, 0.98 versus 0.45 for one source under 16 nested queries, and 5.22 versus 2.99 for a 64-source union. Adding prepared-query identity gave 0.86 versus 0.73, 5.21 versus 4.57, and 13.57 versus 10.58 microseconds for those shapes. A counter observed one resolver call per descriptor source per preparation; the warm client reused its Collections. This isolated microbenchmark does not measure a React render or provider work. The measured extra work does not justify a bound-builder cache in this PR. A representative application profile showing material render cost would reopen that optimization and require a render-abandonment witness.

## Follow-up audit: placement, React diagnostics, and resolver lifetime

Reviewed semantic head: 34c600230 (2026-10-08); the fixes below began from ebe0dcc6d. A client-aware builder must bind every descriptor that it places before returning that query clause. The focused placement driver observes source-ref kinds inside the query callback, before `prepareLiveQueryValue` can rebind the returned tree. Its independent expected list names two union branches and direct, nested, materialized, and conditional include positions. Before the fix, union placement yielded two `descriptorRef` sources and includes retained a descriptor child. After the fix, all named positions yield `collectionRef`; the original standalone union builders remain unbound. This is a finite IR-placement check, not a public-row oracle. The two-client descriptor oracle and nested preload witness retain their public-row authority. Union and include rows under separate clients remain open in the coverage map.

The React descriptor oracle's no-client history now requires the thrown message to name `DbProvider` at the attempted consumption cut, before a same-hash concrete query's prior rows can be reused. The previous message failed that assertion. A separate `useLiveQueryEffect` test reaches the same no-provider boundary after commit. The core missing-client test still requires framework-neutral wording. These checks cover the React remedy and core boundary, not every adapter diagnostic.

An on-demand source whose `unloadSubset` throws supplies a controlled Effect cleanup failure. Before the hook change, cleanup discarded the rejected `dispose()` result without reporting the source error; after the change, React logs that exact error. `Effect.dispose()` already attaches an internal rejection handler, so the review's unhandled-rejection claim is stronger than the evidence supports. The focused test checks one unmount and one failing release callback; it does not claim a general disposal-history oracle.

The resolver-lifetime issue remains open. A controlled public-path probe prepared a descriptor Query with a render deferral set, drained that set, then added a new descriptor join and subscribed to the resulting live query. The new source stayed `idle` and its sync callback ran zero times while the live query stayed `loading`. A candidate change that made the returned builder retain a normal client resolver started that source after release, but a distinguishing probe added the join *before* release and showed provider sync starting while the render was still abandonable. The candidate was removed. The design must define when a prepared builder's continuation stops using render deferral, with a witness for source start before release, after release, and after an abandoned render. The descriptor-binding owner and the live-query deferred-acquisition owner are the receiving boundaries; the current finite oracle does not encode that transition.

The hash/equivalence difference is deliberate: stable query identity uses descriptor and concrete Collection IDs alike, while compiler subquery cache comparison inspects bound structure only after concrete-source collection. The same-hash, no-client React witness rejects reuse of old rows. The exported `IR.From` descriptor variant is covered by the minor changeset. The exported compiler's both-invalid input can report alias reuse before the missing-client error, while normal live-query construction reports the missing client first; no error-precedence contract selects one result for that mixed-invalid input. The lazy-target descriptor guard is unreachable from normal compilation after source collection, but keeps direct calls on the exported `From` type fail-fast and narrows that union for the remaining code.
