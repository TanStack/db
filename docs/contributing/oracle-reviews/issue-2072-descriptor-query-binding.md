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
