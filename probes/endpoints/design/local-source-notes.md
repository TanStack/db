# Local source notes — frozen for Research Survey

Read 2026-09-11 at HEAD e188ab47eb0301a8be5ec2c2d29b2b76e1a710e0 plus current uncommitted oracle/retry work. No runtime or tests changed for this survey.

## Source record

- L1: `probes/endpoints/integrated-todo/src/runtime.ts`; SHA-256 `b46e83fbaead55dafd1623c9ee8b5c81db8cbd1d7f3ed2677c7301fe7b2044bd`.
- L2: `probes/endpoints/integrated-todo/bound-transform.mjs`; SHA-256 `fb2fc7f288a621ae5c06f363963983ef1fc8b2d568e361a9f944d7cca026158f`.
- L3: `probes/endpoints/integrated-todo/tests/oracles/README.md`; SHA-256 `838a97d32a04d1ec8a05ec00a2bba7d56aa5f63792b5331585d7c875190d1d44`.
- L4: `probes/endpoints/integrated-todo/evidence/e2e-current/coherence/sequence.json`; SHA-256 `efb6ae13d8e0f6e61784deab4cf99d466bc4e063b726e3c24e59c8499714f340`.
- L5: `docs/collections/query-collection.md`; SHA-256 `256afcc48e476e880816c6dc78f28d00068da8d9a96351acc202dc6c36db2af2`.
- L6: `docs/guides/mutations.md`; SHA-256 `327a806b6461c6511858a31f8c52f822315fcf14862d315f01b7b7b1c68a2539`.
- L7: `docs/guides/live-queries.md`; SHA-256 `bb18b22c128c085bdae445e7e2180c7edaf9365bafc88d64e3894f27e1712808`.

## Typed observations

- L1/O1 — Code observation: Query Collection identity is endpoint declaration ID plus fixture scope; runtime collection caching is keyed by endpoint ID within one DbClient runtime. Query rows key by id. Declaration identity is not a base-table row-sharing relation.
- L1/O2 — Code observation: bindQuery accepts RPC and a createdAt/id order list. run captures direct collection mutations, invokes one mutation RPC, awaits only directly touched collections' refetches, and returns a Transaction synchronously. Reads now default to three retries. No propagation registry exists here.
- L2/O3 — Code observation: the compiler checks trusted Todo query bindings, extracts selected-field/order facts, and sends only supported order metadata into bindQuery. Server handlers remain in Start server functions; onMutate stays client-side. Endpoint IDs use source-module/component/declaration names. No general client membership predicate, projection inverse, table provenance protocol, or server snapshot revision is emitted.
- L3,L4/O4 — Test record: two independently declared empty queries with the same supported order, then one insertion into collection zero, leave the other collection empty. This is an observed known missing Endpoints feature. The oracle does not yet generate projection/window/concurrent-history cases.
- L5/O5 — Primary local documentation: eager queryFn results replace complete collection state. On-demand loading accepts query predicates/order/window options. Separate endpoint results must not overwrite each other as if each were complete shared state. Direct synced writes and writeBatch are available, but later full fetch results still govern state.
- L6/O6 — Primary local documentation: custom actions can mutate multiple collections within one transaction and await both synchronization paths. This supports a possible coordination mechanism, not automatic discovery of equivalent rows or affected queries.
- L7/O7 — Primary local documentation: live queries evaluate over source collections; structured query IR supplies React query identity, while opaque logic needs explicit identity. This is client-query behavior, not proof the Endpoints compiler understands arbitrary server logic.

## User-owned constraints and correction

- Bare listTodos is an ordinary writable collection with a query overlay. No public listTodos.collection or extra source handle.
- Optimistic actions return transactions synchronously; do not await them in the UI or add an implicit framework mutation queue.
- Use DB queries for client filtering; keep server code out of client artifacts.
- Cross-endpoint propagation is known missing functionality, now a design subject.
- Latest correction: exhausted API read retries may surface a client error. The previous oracle prose that treats unavailable synchronization as unconditional exact-PG failure is historical, not the current user-approved requirement. Choosing retained rows after that error remains unspecified.

## Coverage and limits

Public docs and current prototype source were inspected. No correlated live-query materialization internals were read or analyzed, and no core-DB bug is asserted. Fixture Alice/Bob scopes are not a production authorization protocol. Existing runtime behavior is separated from proposed design requirements. Generated examples beyond the oracle grammar will be labeled hypothetical, not tested.

## Source addendum: user-added activity question

Read before analytical freeze, 2026-09-11. These are additional facts from the same checkout, not a change to implementation.

- L8/O8 — Code observation: Collection exposes public subscriberCount and on('subscribers:change', callback). The event reports previous and current counts. Subscription changes drive sync start/GC timing; collection status and cached existence are distinct from current subscriber count. The inspected getter/events do not define which preloads or pending transactions Endpoints should treat as synchronization demand.
- The prototype's Map records created collections; it is not by itself an active-consumer registry. A proposed endpoint registry can observe the public signals without reading private DB maps. No registry was implemented.
- `packages/db/src/collection/index.ts`; SHA-256 `ac37e4c26c1f4ee846e5268d1e84efa2a951272faecdeab314301b399898a89a`.
- `packages/db/src/collection/events.ts`; SHA-256 `63688948bab6500a3f1b1d6784226868f2542921b4a35775742a57376e95d41d`.
- `packages/db/src/collection/changes.ts`; SHA-256 `5b7d84cec2ca70d89ef5f097dca3c995157a9cd3d6cd1d7f1c703dd84686b1ac`.
