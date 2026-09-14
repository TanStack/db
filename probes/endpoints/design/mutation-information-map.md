# What happens now: mutation information and handoffs

Substrate map completed 2026-09-11. Specimen: the saved oracle case with two identically ordered, initially empty Todo query collections and one optimistic insert into the first. No new application run was performed.

**Evidence labels:** “Receipt” means a saved executed result; “source” means inspected code, not observed runtime timing; “missing” means not supplied by this inspected path. This trace does not infer all framework capabilities from the prototype.

## Parts and sequence

| Step | Part and handoff | Information present | Boundary or missing observation |
| --- | --- | --- | --- |
| 1. Recognize declarations | `transformBoundEndpoints` checks bindings/captures and calls `extract` for queries — source | Declaration name, component/module identity, source hash, constrained handler syntax, recognized projection/predicate/order facts | Extractor assumptions include trusted fixture auth and unchecked wire types. Mutation capture validation is not mutation read/write analysis. The binder does not invoke the separate catalog-backed `check` function. |
| 2. Generate client/server bindings | Compiler generates Start server functions and client bind calls — source | Query client bind receives declaration ID, RPC reference, and order fields. Mutation bind receives ID, RPC reference, and authored `onMutate` | General query dependencies, complete mutation effects, and patch capability are not emitted. `endpointSourceHash` is source provenance, not a committed database revision or result baseline. |
| 3. Create and consume collections | Per-DbClient runtime caches by declaration ID; collection/query keys include fixture scope. Generated component uses `useLiveQuery` — source | Bare collection handles, scope, stored instances, subscriptions, comparator, RPC-backed full result read | Runtime cache membership is not an active-demand registry. Public DB subscriber signals exist but this runtime does not use them for recipient selection. Query inputs here are empty objects, not general parameterized instances. |
| 4. Invoke insert | Synchronous action opens a DB transaction and executes `onMutate`, then starts commit — source | Captured local collection writes and authored optimistic row, owned by a Transaction | Local writes identify directly touched collections; they do not prove all server effects or all affected queries. No hidden mutation queue is present in this runtime path. |
| 5. Observe optimistic result | Oracle prepares independent tentative reference state and snapshots both collections — receipt | First collection has `new-0`; second is empty, though the reference expects the inserted row in both | Saved case fails at this checkpoint. It establishes the propagation gap, not later server or refetch behavior in this failed execution. |
| 6. Execute server mutation | Generated fixture validates request, requires user, waits at the test write gate, inserts Todo, returns `{ok:true}` — source continuation | Input and scope; application/server code determines actual write | This response supplies no row effects, query results, dependency closure, or database observation revision. The recorded failing run does not demonstrate this continuation completed. |
| 7. Refetch captured targets | Runtime awaits mutation RPC, then `Promise.all` of each captured collection's refetch — source continuation | Direct target handles and full query result responses; read retries are configured to three | No cross-query recipient discovery. Successful independent reads do not by themselves specify a common database snapshot or group publication boundary. |
| 8. Declare persistence outcome | Transaction mutation function completes only after its awaited RPC/refetch work — source continuation | Action returns a Transaction immediately; persistence is separately awaitable through its promise | A read error after a committed write must not be interpreted as evidence that the write never committed. Exact cross-collection notification/rollback timing was not measured by this trace. |

The trace records two distinct rejection points. The extractor returns `not checked` plus a reason for unsupported grammar. The bound compiler then throws `ENDPOINT_BOUND_UNSUPPORTED` when extraction is not checked. That is current compile-time rejection, not a general “run this endpoint with conservative delivery” facility.

The separate extractor `check` function can use schema/catalog evidence to assess a selected key and total SQL ordering. Its existence does not mean the bound compiler uses that evidence: the inspected call site uses `extract`. Likewise, a hash of handler source does not establish the revision of returned database rows.

## Three missing observations or contracts

1. **What establishes each optimization's prerequisites?** The actual client boundary carries IDs, scope, order, RPC references, and local intent. The path does not supply general dependency evidence, effect closure, query coverage, or update baselines. A future design needs to show the provenance and limits of whatever additional information it uses. Successful compilation alone cannot stand in for those separate facts.

2. **What executes when analysis declines?** The current query binder rejects unsupported extraction. It does not demonstrate a conservative endpoint mode. A supported fallback needs a defined recipient scope, authoritative observation, and error path. Full refetch can obtain missing result data; it cannot manufacture exact earlier optimism or justify excluding unknown recipients. The user has selected bounded support, but has not selected the fallback API or UI behavior.

3. **When do consumers count and when do their states publish?** Direct local targets and cached instances are visible in this code. The endpoint path does not establish demand during preload/activation, coherent publication across targets, or how observations interact with other pending mutations. This trace cannot turn parallel refetch into proof of a shared snapshot. Those contracts remain distinct from removing a mutation queue.

## Control and limits

The saved failure and the source continuation are explicitly separated. The oracle receipt fails before the later stages, so the table does not claim to be one fully observed end-to-end execution. The code was inspected as it stands; no compiler, browser, or database tests were rerun for this map.

**Distortion:** A linear trace can suggest one total event order and one complete information boundary. Real subscribers, requests, other mutations, and external writers can overlap. The narrow Todo fixture also hides multi-table semantics and general authorization. Missing metadata in this prototype is not proof that it cannot be obtained by another design.

Sources: [saved operation](../integrated-todo/evidence/e2e-current/coherence/sequence.json), [saved failure](../integrated-todo/evidence/e2e-current/coherence/replay.json), [generated handlers and consumers](../integrated-todo/tests/oracles/program.mjs), [oracle driver](../integrated-todo/tests/oracles/driver.mjs), [bound compiler](../integrated-todo/bound-transform.mjs), [extractor and separate check](../track-a-analysis/probe.mjs), [runtime](../integrated-todo/src/runtime.ts), and [public subscriber count](../../../packages/db/src/collection/index.ts:425).
