# Sighted donor perturbation: established IndexedDB wrappers

2026-10-06. Target: TanStack DB PR #1179, IndexedDB adapter. Source inspection began on the pending refinement and was confirmed against pushed `e6a2b8b48`. The parent subsequently merged origin/main; it reports no IndexedDB source changes in that merge. This report does not claim to audit that merge.

## Method and evidence boundary

This is a **sighted, home-adjacent donor survey**, as requested. It is not blind distant-domain donor transfer. The researcher knew the target and read its glossary, oracle guide, coverage map, IndexedDB ORACLE.md, retirement/deletion-queue owners, native receiving suite, wrapper and adapter. The field-lab donor-perturb instrument requires fit judgments and nearby failed transfers; those appear for every inventory item below. No separate researchers, Field Log, or product changes were used.

The selected repositories are mature, widely used examples of four different abstractions: a database/query wrapper, a native-shaped Promise wrapper, a minimal key/value wrapper, and a multi-backend storage wrapper. GitHub metadata retrieved during this survey reported:

| Donor | Created | Stars at survey | Inspected package version | Immutable source revision |
| --- | --- | ---: | --- | --- |
| Dexie | 2014-02-26 | 14,626 | 4.4.6 | [`9282725a40bb659dca8e5971970243ef48238811`](https://github.com/dexie/Dexie.js/tree/9282725a40bb659dca8e5971970243ef48238811) |
| idb | 2015-08-06 | 7,417 | 8.0.4 | [`654c746bef13f9fe7f5871e03ac58015cebace5a`](https://github.com/jakearchibald/idb/tree/654c746bef13f9fe7f5871e03ac58015cebace5a) |
| idb-keyval | 2016-08-11 | 3,248 | 6.3.0 | [`17a69a1165bef486d88950cb47d3913744f038ac`](https://github.com/jakearchibald/idb-keyval/tree/17a69a1165bef486d88950cb47d3913744f038ac) |
| localForage | 2013-10-31 | 25,810 | 1.10.0 | [`fb78c77ee583fb727a558c439b5174aca38c5924`](https://github.com/localForage/localForage/tree/fb78c77ee583fb727a558c439b5174aca38c5924) |

Package versions identify the checked-out source; they are not claims that these exact commits were published. Stars establish selection context, not correctness. Donor suites were read, **not run**. Two small source probes were run with Node 24.19.0 and the target's fake-indexeddb 6.2.5: one target wrapper probe and one donor negative-transfer probe. No browser result is inferred from those probes. Regression names below are verified source labels; the linked issue discussions were not separately audited.

“Complete inventory” below means every retained mechanism from this bounded source survey, including covered and rejected transfers. It does not mean every donor test, historical issue, browser behavior, or possible bug has been examined. Source clones and probes are retained in `/tmp/pr1179-donors/`.

## Result

One target defect was measured: application assignment to a native transaction's `oncomplete` or `onabort` erases the wrapper's settlement observer and leaves its Promise pending after the native transaction ends. The most valuable additional tests are richer clone-preserving row values, simultaneous first database opens, user-controlled names, and canceled-versus-uncanceled native request errors. Native abnormal closure, nested input identity, same-key cross-Collection updates, suspension/lost notifications, and post-durable failures were already declared open boundaries; the donors strengthen their motivation but do not make them new discoveries.

The source-linked inventory uses these dispositions:

- **Measured bug:** executed target counterexample under the stated provider.
- **Coverage addition:** current law appears sufficient; add a distinguishing history/checkpoint, then determine RED/GREEN.
- **Existing boundary:** already tracked as unproved or undecided; donor does not close it.
- **Covered:** an identified target owner already receives the relevant mechanism within its declared bounds.
- **Design proposal:** would change the API, recovery policy, or product semantics; no automatic implementation recommendation.
- **Rejected transfer:** donor behavior belongs to another contract.

## Full retained inventory

### DP01 — Native observer composition preserves wrapper settlement

**Source fact.** idb implements `tx.done` with additive `complete`, `error`, and `abort` listeners, removes them on settlement, and caches the Promise independently of application event-handler properties ([implementation][I-observers]). Its public contract says `tx.done` is the transaction-completion signal ([contract][I-done]). This is verified code/contract evidence; idb's inspected `done` test only checks that the Promise exists, so it is not credited as a comprehensive donor law test.

**Target and result — measured bug, [fit: solid].** `executeTransaction` at `wrapper.ts:290–299` assigns `transaction.oncomplete` and `transaction.onabort`, then passes the same transaction to the public callback. The callback can legitimately assign either property. The target Promise remains pending after actual native completion/abort and after the application's observer ran. The parent independently reproduced the probe.

| Native outcome | Application observation method | Observer calls | Target caller at post-event checkpoint |
| --- | --- | ---: | --- |
| complete | addEventListener | 1 | fulfilled with callback result 42 |
| complete | oncomplete assignment | 1 | pending |
| abort | addEventListener | 1 | rejected with aborted transaction |
| abort | onabort assignment | 1 | pending |

The checkpoint awaits an independent native terminal listener and one subsequent event-loop turn; it does not infer native completion from a timeout. The Promise has no remaining completion observer in the failing variant.

**Receiving law/owner.** Extend the wrapper owner: callback result AND native completion remain separately necessary and sufficient even when application code registers ordinary native observers. Cross complete/abort, callback resolve/reject, property assignment/reassignment/nulling and additive registration. Observe the native event, callback result, caller result/error identity, durable rows, and observer count. Keep the independent native observer outside the property under challenge. An internal-observer-property mutant must fail at caller settlement.

**Negative control.** Assigning an application observer does not grant permission to suppress all event listeners with deliberate `stopImmediatePropagation`, or to demand success after abort. Do not copy idb's immediate rejection on every bubbling `error` without examining DP05.

Reproduce: `node --experimental-strip-types /tmp/pr1179-donors/wrapper-listener-probe.mjs`. Receipt: `/tmp/pr1179-donors/wrapper-listener-probe.log`. No product file was changed.

### DP02 — Abnormal native closure is its own event

**Source fact.** idb documents `terminated()` for abnormal browser closure and explicitly distinguishes ordinary `db.close()` ([API][I-open]). Dexie's native `onclose` path identifies regression #2186: its public open-state used to remain true after the close event; the repair routes it through closure with auto-open permitted ([source][D-close]). idb-keyval invalidates its cached connection Promise on native `close`; its source comment cites Safari closure, which is implementation rationale rather than a measured Safari reproduction in this survey ([source][K-store]).

**Target — existing boundary and contract extension, [fit: solid] for detecting the event; [fit: reach] for automatic reopen.** Managed closure presently covers explicit descriptor close and `versionchange` from upgrade/delete. It does not register native `close`. The coverage map already names abnormal native termination separately. The donor supplies a concrete fourth event dimension, not a newly unlisted defect.

**Receiving witness.** If the immediate-error/retained-snapshot contract is extended to native termination, add idle/ready/loading/admitted-write/accepted-sync prefixes. First use the provider's actual forced-close facility, not mere event dispatch; it must abort native work and close admission. Check actual commit/abort outcomes, no late read publication, complete error suffix, rejected late startup and caller-time rows. Then acquire an honest native receiving witness or retain an explicit controlled-provider limit.

**Negative control.** Native `close` is not emitted by ordinary `db.close()`. Simulating a `close` event on a still-open database does not establish forced termination semantics. Do not transfer Dexie's or idb-keyval's automatic reopen: TanStack's approved managed-close contract requires new descriptors/Collections.

### DP03 — A pending blocker can be observable without becoming failure

**Source fact.** idb exposes separate `blocked`, `blocking`, and terminal outcomes; tests check version numbers and distinguish delayed blocker release from immediate auto-close ([tests][I-blocked]). localForage logs a blocked deletion separately from native success ([source][L-delete]).

**Target — covered settlement law; optional design proposal, [fit: solid].** Wrapper and deletion-queue owners already prove blocked requests stay pending and receipts require native success. The current open/delete APIs expose no blocked diagnostic callback. A user cannot distinguish a blocked request from other pending native work through that Promise alone.

**Possible affordance.** Add an optional diagnostic hook with operation/name/oldVersion/newVersion only if desired. Its oracle must prove hook delivery does not resolve/reject/cancel the operation and hook failures do not claim native success.

**Negative control.** A blocked event is not a timeout or lock-acquisition failure. It does not authorize an in-memory fallback, cancellation, or reopening loop.

### DP04 — Request progress, callback settlement, and native completion are different cuts

**Source fact.** idb documents `tx.done` and warns against awaiting unrelated asynchronous work inside a native transaction ([completion][I-done], [lifetime][I-lifetime]). Dexie separately implements and tests an explicit `waitFor` capability ([tests][D-wait]).

**Target — covered, [fit: solid].** The wrapper owner already crosses request success then abort, callback delay after native completion, and readwrite late callback rejection with durable rows retained. Retirement owners observe native commit and source confirmation at caller success. No new oracle owner is justified for these same laws.

**Remaining useful handoff.** The wrapper's arbitrary-async-callback cases are controlled-provider evidence; a small real-browser pair with only IDB awaits versus a deliberately unrelated task would establish that exact lifetime premise. Existing ordinary native adapter tests do not prove every low-level callback path.

**Negative control.** Do not promise rollback after a callback rejects following native commit. Do not import Dexie's keepalive as if native async callbacks already keep a transaction active.

### DP05 — A handled request error need not be an aborted transaction

**Source fact.** Dexie's `eventError-transaction-catch` and `eventError-request-catch` tests distinguish an uncaught duplicate-unique request, which aborts, from a caught request error followed by a successful sibling request and committed transaction ([tests][D-errors]). The transfer is the event-versus-outcome distinction, not Dexie's Promise interception machinery.

**Target — coverage addition, [fit: solid].** The low-level public callback receives native requests/stores. A request `error` handler can call `preventDefault()`, permitting native continuation; merely attaching a Promise catch has different native semantics. The current wrapper correctly waits for terminal abort/complete rather than rejecting on each bubbled request error, but inspected tests do not distinguish these two native histories. DP01's repair should preserve that distinction.

**Receiving witness.** Wrapper owner: establish a unique index using the supported low-level upgrade API, queue a failing add and valid neighbor, cross native request-error cancellation versus no cancellation, and callback success versus rejection. Compare the exact committed subset in the canceled-error case, full rollback in the abort case, caller receipt and native terminal event. A mutant that rejects on every transaction `error` should fail the committed case.

**Negative control.** Catching a rejected Promise is not automatically native `preventDefault`. Adapter-managed batch writes still promise all-or-nothing and intentionally expose no request-error interception. Do not add partial acceptance there.

### DP06 — Atomic batch law must survive synchronous clone errors

**Source fact.** idb-keyval advertises atomic `setMany` and queues puts in one native transaction ([source][K-batch]). Its inspected tests cover ordinary and empty batches but contain no corresponding synchronous-clone rollback witness ([tests][K-tests]). Dexie's bulk failure regressions intentionally preserve successful rows outside an enclosing all-or-nothing transaction, including failure positions on either side of an internal >50-item path ([regressions][D-bulk]).

**Target — covered, [fit: solid] for failure-position grammar; rejected transfer for partial success.** Target settlement already covers first/middle/last clone failure in automatic/manual/import batches, durable rows and versions, no success notification, an ordinary successful suffix and restore. Request-admission counts protect bulk queuing. This is stronger relevant evidence than “the donor uses one transaction.”

**Executed negative-transfer control.** Against pinned idb-keyval source + fake-IDB, `setMany([['prefix', valid], ['bad', function]])` rejected `DataCloneError` but a subsequent read found the valid prefix. The synchronous exception escapes before a transaction observer/abort is installed. This survey does not claim a native-browser reproduction. Reproduce with `/tmp/pr1179-donors/keyval-atomicity-probe.mjs`; receipt has the same basename `.log`.

**Negative control.** Never transplant Dexie's documented partial-bulk success into TanStack import/acceptance. Never treat idb-keyval's atomic documentation or one-transaction structure as proof of clone-error rollback. Donor internal thresholds do not justify a 50/51 target test unless target production has that threshold.

### DP07 — Failed opening cannot leave partial schema or poison later use

**Source fact.** Dexie tests an exception after an earlier migration and reopens to verify the original version, plus failed population leaving no created database ([tests][D-upgrade-errors]). idb-keyval clears the cached opening Promise on rejection ([source][K-store]).

**Target — covered in the applicable API, [fit: solid].** Wrapper failed-upgrade/lower-version histories already compare original rows/schema, reject at native error, and permit later successful use. `createIndexedDB` does not own a cached open Promise, so cached-rejection recovery is not another state to add.

**Negative control.** The donor's multiple content-migration callbacks are not a promised createIndexedDB migration API. Neither retrying a `VersionError` with a different version nor deleting a failed database is a neutral repair.

### DP08 — Simultaneous first initialization is different from concurrent writes

**Source fact.** localForage has a specific test starting four same-store instances before initialization and issuing independent writes immediately ([test][L-concurrent]). This is separate from its test of concurrent operations on already created instances.

**Target — coverage addition, [fit: solid].** The inspected target harness creates its first database and then additional descriptors sequentially. Existing cross-tab histories begin from established descriptors. Add two/three simultaneous `createIndexedDB` calls against an absent name with the same version and complete store declaration; immediately start their Collections and author disjoint writes.

**Receiving witness.** Compatibility owner plus a native page/worker receiving case: verify all opens settle, every descriptor has the complete requested native schema, each Collection reaches readiness only after its establishing read, no orphan handle blocks the later managed upgrade, all disjoint writes survive, and a fresh restore matches authored rows. Cross different database names as the independence control.

**Negative control.** Two same-version initializers requesting different store sets do not promise a union: only the opener that creates/upgrades the database can create stores. The documented “declare all stores up front” rule remains authoritative. Do not silently add version bump/retry machinery to make conflicting declarations work.

### DP09 — Preserve structured-clone value types through an unrelated row update

**Source fact.** Dexie regression #1890 stores a nested `BigInt64Array`, changes an unrelated timestamp, and asserts the value remains a `BigInt64Array` afterward ([test][D-values]). localForage explicitly tests ArrayBuffer, odd-length buffers, Blob and typed arrays ([tests][L-values]). idb tests NaN as a value and Date-bearing objects ([tests][I-values]).

**Target — coverage addition, [fit: solid] for documented accepted cloneable values.** Main target grammars use bounded scalar fields; the schema-transform example checks Date in export/import but not unchanged rich fields through automatic update, peer invalidation and fresh Collection restore. This leaves a common serialization/proxy boundary largely unexercised without requiring a mutable-input identity policy.

**Receiving witness.** Add a small independent authored value corpus (Date, ArrayBuffer, offset typed-array/DataView, BigInt64Array when available, Blob, nested arrays; Map/Set only if the Collection value contract admits them). Write once, update only a scalar sibling, receive through another descriptor, export, clear/import via valid schema input, then reopen. Assert type/bytes/date timestamp and unchanged content at every cut, not JSON equality or object identity. Pair each with a genuinely uncloneable function at the same nested position and require atomic rejection.

**Negative control.** Native structured cloning does not preserve custom class prototypes, arbitrary identity, functions, or accessors as live behavior. localForage's undefined-to-null normalization is a cross-driver contract and must not be copied. Worker/page transport serialization must not erase the value distinctions before comparison.

### DP10 — Ordinary user-controlled names are a grammar dimension

**Source fact.** Dexie regression #1920 uses an index named `constructor` and checks both open and actual query/write use ([test][D-names]). Its exact failure concerns schema dictionaries, not TanStack's implementation.

**Target — coverage addition, [fit: plausible].** The target public store names are nonempty strings except `_versions`; it builds a plain-object store record and compound metadata keys. Existing cases use ordinary names. Add a metamorphic renaming law for legal database/store names such as `constructor`, `__proto__`, `toString`, Unicode, delimiters and lexically adjacent names; preserve the same authored row/metadata isolation law through import/clear and peer delivery.

**Receiving witness.** Compatibility owner should prove these names actually reach native creation, store-record lookup, version-prefix traversal and notification routing. Include more than one store so an overbroad prefix scan is observable.

**Negative control.** `_versions` remains reserved and empty names remain rejected. Dexie's support for index/compound-key syntax is not transferable to the Collection configuration. This survey did not reproduce a target name bug.

### DP11 — Update serialization is not atomic read-modify-write across Collections

**Source fact.** idb-keyval `update` reads and writes in one readwrite transaction. Its test runs three concurrent increments and expects 3; its README distinguishes this from separate get/set calls ([implementation/test][K-update], [explanation][K-update-doc]).

**Target — existing boundary; potential design proposal, [fit: solid] for the distinction.** The approved local-order law preserves mutation order inside one Collection. It does not make two stale Collection snapshots increment a shared counter atomically. Whole-row persistence after arbitrary user handlers cannot inherit idb-keyval's read-inside-the-storage-transaction semantics.

**Possible affordance.** Decide whether to offer a separate storage-level atomic mutation API, explicit compare-and-swap, or only document whole-row conflict behavior. An oracle would need native serialization of concurrent same-key updates and legal results computed from one coherent order, not acceptance of each field against a different possible order.

**Negative control.** Do not change ordinary Collection update to run arbitrary user code in an IndexedDB transaction, silently merge whole rows, or claim cross-Collection atomicity from the single-Collection acceptance queue. Disjoint-key preservation is already covered.

### DP12 — Caller-owned returned objects can poison cached observations

**Source fact.** Dexie regression #2309 mutates a returned object in place, puts it, and requires another live-query emission and a new reference under two cache modes ([test][D-alias]).

**Target — existing boundary/design decision, [fit: plausible].** The target coverage map already leaves nested mutable input identity open. This donor names a concrete failure mechanism: if expected and observed values share a mutable reference, the mutation can disappear from comparisons or suppress notification. Current detached scalar model rows do not settle the richer ownership policy.

**Receiving witness after policy.** Distinguish an authored input, a public Collection value, export output and native read clone. Mutate one after submission/observation; compare independently frozen authored values at the promised capture cut, subsequent durable values and every public event. Cross mutation before native `put` versus after it. Preserve both aliasing and detached controls.

**Negative control.** A library promising immutable Collection values need not adopt Dexie's supported mutate-and-put flow. Do not simply demand new references on every no-op update; that changes event/identity semantics.

### DP13 — Worker execution needs its own host receiving witness

**Source fact.** localForage tests actual dedicated-worker and service-worker persistence and same-origin iframe use ([worker][L-worker], [service worker][L-serviceworker], [iframe][L-iframe]). One service-worker registration case is explicitly skipped. Dexie also has a dedicated-worker regression #76 ([test][D-worker]).

**Target — coverage addition or support-policy clarification, [fit: plausible].** The wrapper resolves globalThis.indexedDB and the compatibility owner simulates no ambient globals/custom factory. Native receiving cases currently use same-origin pages. If worker use is supported, transfer the same persistence/notification/managed-close laws into a real dedicated worker and a page. Start with explicit writes and peer restore; service-worker restart and lifetime are a separate extension.

**Negative control.** Simulating `window` absence in Vitest is not a real worker witness. Same-origin iframe success does not establish cross-origin or partitioned-storage sharing. Do not copy service-worker background-delivery promises from an active-worker unit test.

### DP14 — Store and descriptor isolation must survive reuse and removal

**Source fact.** localForage verifies same-key values in separate instances, own-store-only clear/iteration, and drop/recreate behavior ([scope tests][L-isolation], [drop tests][L-drop]). idb-keyval repeats operations against default/custom stores ([tests][K-tests]).

**Target — covered within the current API, [fit: solid].** Target compatibility/persistence already distinguish database/store/Collection identity, typed keys, shared descriptors across DbClients, cleanup of one sync run, untouched versions and per-Collection manual acceptance. Administrative deletion deliberately removes the whole database; source snapshots remain on errored old Collections and fresh storage is empty.

**Negative control.** localForage `dropInstance(storeName)` is not TanStack administrative delete-by-name. Do not reintroduce Collection deletion authority or erase sibling stores to imitate the donor's convenience API.

### DP15 — Reconnection and backend fallback are choices, not mandatory robustness

**Source fact.** localForage retries native transaction creation once for absent/InvalidState/NotFound connections and may upgrade a missing store; multiple instances receive the replacement connection ([source][L-reconnect]). Its 1.5 changelog records an engine selection change making existing Safari data appear missing because reads moved from WebSQL to IndexedDB ([history][L-history]).

**Target — rejected transfer, [fit: reach].** Approved behavior is sticky error after managed connection closure, fresh descriptors/Collections for reuse, and no timeout/in-memory fallback. Automatic schema repair, restart or alternate backend introduces a new source of truth and contradicts that policy. Donors show why these policies must be explicit.

**Negative control.** A blocked open is not evidence IndexedDB is unavailable. An empty new backend is not evidence the original database was empty. Failed ordinary writes must not resolve “persisted” through an implicit volatile fallback.

### DP16 — Native commit and crash durability are separate claims

**Source fact.** Dexie exposes a transaction-durability option and tests native `transaction.durability` for default/strict/relaxed when Chromium supports it ([tests][D-durability]). Those assertions check option propagation, not physical power-loss survival.

**Target — existing boundary plus optional affordance, [fit: solid] for the distinction.** Target `isPersisted` evidence is native transaction completion; physical crash is explicitly outside the oracle. A configurable native durability hint could be useful, but is a separate API decision, compatibility check and performance tradeoff.

**Receiving witness if added.** Check actual native transaction option propagation per write path and supported engine, preserving the same atomicity/settlement oracle. Keep crash testing separate.

**Negative control.** `strict` is not a proof against quota, eviction, site-data clearing or device failure. Neither a native commit event nor a synthetic page close demonstrates physical durability.

### DP17 — Package consumers need runtime evidence distinct from declarations

**Source fact.** localForage's changelog records adding `module` in 1.8.0 and reverting it in 1.8.1 because it broke builds; dedicated Browserify/Webpack runners are retained ([history][L-history], [browserify runner][L-browserify], [webpack runner][L-webpack]).

**Target — declared packaging boundary, [fit: solid].** The target's 12 consumer cases compile ESM/CJS declarations through symlinked builds, explicitly excluding tarball completeness. They do not execute the installed package in a consuming app. Do not discount those type tests; add the different observation if claiming publish readiness.

**Receiving witness.** Pack the candidate, install into a disposable consumer, run minimal ESM import and CJS require against a supplied fake factory, and include one actual browser-bundler import. Assert public exports and simple persistence, no source aliases or workspace rescue. Keep supported module-resolution tests separately.

**Negative control.** A root build or TypeScript noEmit success does not prove runtime exports or tarball files. No need to import every historical bundler merely because localForage did.

### DP18 — Native error taxonomy must remain inspectable

**Source fact.** idb-keyval asserts named native failures for invalid clone inputs; idb passes request errors through. Dexie deliberately has its own typed hierarchy ([keyval tests][K-errors], [idb implementation][I-observers], [Dexie error handling][D-errors]).

**Target — covered, [fit: solid].** Current wrapper tests preserve exact native `cause`, including cross-realm synchronous exceptions, request-error identity and admission paths. The maintainer explicitly chose removal of unused exported specialized errors. More donor exception classes are not an uncovered target requirement.

**Negative control.** String-matching one provider's error text or requiring every DOMException to satisfy the local realm's `instanceof Error` weakens portability. Do not copy Dexie's hierarchy against the approved target API decision.

## Recommended order

1. Repair DP01 through the wrapper owner. Its measured history fits the existing settlement contract, so it does not require a new recovery design. Preserve DP05's terminal-event distinction during the repair.
2. Add a small law-based coverage extension for DP05, DP08, DP09 and DP10. These change history/value dimensions, not the adapter architecture. Keep failures on the old source/mutants separate from green additions that only close an evidence gap.
3. Clarify native abnormal-close behavior (DP02), mutable-value ownership (DP12), and worker support (DP13) before borrowing donor recovery/identity behavior. These are existing or newly explicit boundaries, not excuses to assert they work.
4. Treat blocked diagnostics, atomic storage updates, durability hints and new migration/reconnect APIs as optional design proposals. Mature wrappers demonstrate their usefulness and costs; they do not authorize those changes here.
5. Add the disposable packed runtime consumer when claiming package release completeness (DP17), without replacing the existing declaration lane.

No donor mechanism found here closes the known lost-notification/suspension or post-durability-send-failure boundaries. Those remain under their current owners. No claim about every possible cross-tab failure follows from this finite survey.

## Immutable source index

[I-observers]: https://github.com/jakearchibald/idb/blob/654c746bef13f9fe7f5871e03ac58015cebace5a/src/wrap-idb-value.ts#L69-L94
[I-done]: https://github.com/jakearchibald/idb/blob/654c746bef13f9fe7f5871e03ac58015cebace5a/README.md#L239-L252
[I-open]: https://github.com/jakearchibald/idb/blob/654c746bef13f9fe7f5871e03ac58015cebace5a/README.md#L74-L129
[I-blocked]: https://github.com/jakearchibald/idb/blob/654c746bef13f9fe7f5871e03ac58015cebace5a/test/open.ts#L118-L168
[I-lifetime]: https://github.com/jakearchibald/idb/blob/654c746bef13f9fe7f5871e03ac58015cebace5a/README.md#L171-L198
[I-values]: https://github.com/jakearchibald/idb/blob/654c746bef13f9fe7f5871e03ac58015cebace5a/test/main.ts#L147-L200
[K-store]: https://github.com/jakearchibald/idb-keyval/blob/17a69a1165bef486d88950cb47d3913744f038ac/src/index.ts#L12-L37
[K-batch]: https://github.com/jakearchibald/idb-keyval/blob/17a69a1165bef486d88950cb47d3913744f038ac/src/index.ts#L84-L100
[K-tests]: https://github.com/jakearchibald/idb-keyval/blob/17a69a1165bef486d88950cb47d3913744f038ac/test/index.ts#L329-L433
[K-update]: https://github.com/jakearchibald/idb-keyval/blob/17a69a1165bef486d88950cb47d3913744f038ac/test/index.ts#L435-L484
[K-update-doc]: https://github.com/jakearchibald/idb-keyval/blob/17a69a1165bef486d88950cb47d3913744f038ac/README.md#L131-L163
[K-errors]: https://github.com/jakearchibald/idb-keyval/blob/17a69a1165bef486d88950cb47d3913744f038ac/test/index.ts#L120-L172
[D-close]: https://github.com/dexie/Dexie.js/blob/9282725a40bb659dca8e5971970243ef48238811/src/classes/dexie/dexie-open.ts#L140-L150
[D-wait]: https://github.com/dexie/Dexie.js/blob/9282725a40bb659dca8e5971970243ef48238811/test/tests-transaction.js#L812-L909
[D-errors]: https://github.com/dexie/Dexie.js/blob/9282725a40bb659dca8e5971970243ef48238811/test/tests-exception-handling.js#L48-L106
[D-upgrade-errors]: https://github.com/dexie/Dexie.js/blob/9282725a40bb659dca8e5971970243ef48238811/test/tests-exception-handling.js#L179-L252
[D-bulk]: https://github.com/dexie/Dexie.js/blob/9282725a40bb659dca8e5971970243ef48238811/test/tests-live-query.js#L809-L879
[D-values]: https://github.com/dexie/Dexie.js/blob/9282725a40bb659dca8e5971970243ef48238811/test/tests-misc.js#L513-L537
[D-names]: https://github.com/dexie/Dexie.js/blob/9282725a40bb659dca8e5971970243ef48238811/test/tests-misc.js#L539-L559
[D-alias]: https://github.com/dexie/Dexie.js/blob/9282725a40bb659dca8e5971970243ef48238811/test/tests-live-query.js#L881-L920
[D-worker]: https://github.com/dexie/Dexie.js/blob/9282725a40bb659dca8e5971970243ef48238811/test/tests-open.js#L245-L321
[D-durability]: https://github.com/dexie/Dexie.js/blob/9282725a40bb659dca8e5971970243ef48238811/test/tests-chrome-transaction-durability.js#L14-L85
[L-delete]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/src/drivers/indexeddb.js#L960-L1022
[L-reconnect]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/src/drivers/indexeddb.js#L316-L402
[L-history]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/CHANGELOG.md#L1-L72
[L-concurrent]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/test/test.api.js#L1517-L1590
[L-values]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/test/test.datatypes.js#L325-L636
[L-worker]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/test/test.webworkers.js
[L-serviceworker]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/test/test.serviceworkers.js
[L-iframe]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/test/test.iframes.js
[L-isolation]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/test/test.api.js#L984-L1034
[L-drop]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/test/test.api.js#L1938-L2119
[L-browserify]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/test/runner.browserify.js
[L-webpack]: https://github.com/localForage/localForage/blob/fb78c77ee583fb727a558c439b5174aca38c5924/test/runner.webpack.js

## Parent evaluation and implementation disposition

The source survey above is preserved against its frozen target. It supplied
primary-source mechanisms and explicit limits, independently reproduced the
home defect, and challenged a donor's advertised atomicity rather than treating
maturity as correctness. This is strong, useful sighted research; it is not an
exhaustive audit or a blind selection experiment. I would use this reviewer for
another bounded source comparison. Donor suites were not executed.

| ID | Parent disposition | Evidence or receiving destination |
| --- | --- | --- |
| DP01 | fixed-now | New wrapper-settlement oracle: 12 original-source assertion failures, 8 controls; additive native listeners preserve wrapper and application observers. |
| DP02 | design-decision | Native abnormal close remains a separate existing ownership boundary; no automatic reopen adopted. |
| DP03 | accepted-design | Blocked calls remain pending; diagnostics are an optional API proposal. |
| DP04 | already-covered | Existing wrapper callback/native outcome cases pass; broader browser callback-lifetime evidence remains explicitly bounded. |
| DP05 | fixed-now (test gap) | Canceled and uncanceled native request errors now reach the independent settlement model; rejecting every request error fails the committed-neighbor assertion. |
| DP06 | already-covered | First/middle/last rollback and durable-prefix checks; donor negative-control probe preserved. |
| DP07 | already-covered | Failed-upgrade retained schema/rows and successful suffix checks. |
| DP08 | confirmed-open coverage gap | Compatibility owner: simultaneous initial opens with identical complete declarations; native receiving witness needed. No product counterexample reported. |
| DP09 | confirmed-open coverage gap | Persistence owner: independent structured-clone type/byte corpus across unrelated updates, peers and restore. No product counterexample reported. |
| DP10 | confirmed-open coverage gap | Compatibility owner: metamorphic legal database/store renaming and metadata isolation. No product counterexample reported. |
| DP11 | accepted-design | Approved ordering is within one Collection; atomic cross-Collection read-modify-write would be a new API. |
| DP12 | design-decision | Rich mutable-value ownership remains separate from detached scalar oracle expectations. |
| DP13 | design-decision | Worker support and a native worker receiving lane require an explicit host scope. |
| DP14 | already-covered | Existing store, descriptor, DbClient, version and administrative-deletion isolation laws. |
| DP15 | refuted transfer | Reconnect/backend fallback conflicts with the approved sticky managed-closure contract. |
| DP16 | accepted-design | Native commit is the current receipt; physical-crash durability and hints are separate claims. |
| DP17 | confirmed-open coverage gap | Package consumer owner: disposable packed ESM/CJS runtime and browser-bundler consumption. Current 12 cases are declaration evidence. |
| DP18 | already-covered | Exact native cause identity and approved removal of unused errors. |

Accounting: 18 = 2 fixed-now + 5 already-covered + 3 accepted-design +
3 design-decision + 4 confirmed-open coverage gaps + 1 refuted transfer.
There are no deferred items. The four new coverage proposals have not been
implemented or claimed green in this research task. No new affordance or recovery
policy was adopted. This distinguishes completed donor research from completion
of all possible follow-up work it identified.

`wrapper-settlement-oracle.test.ts` contains 20 observer histories and two
request-error neighbors. Registration syntax is absent from its two-fact outcome
model. Each case checks actual terminal events, independently read durable rows,
caller state after event continuations, callback release and application observer
calls. Callback-rejection identity and late rejection after commit retain the
existing wrapper owner. The repair adds two net production lines and no state.
The obsolete utility-deletion paragraph in ORACLE.md was also corrected to the
already implemented administrative contract.

The [donor evidence directory](https://github.com/TanStack/db/blob/main/review-evidence/donor-survey/README.md)
retains probes and RED/GREEN receipts. The provider limit for the new observer
matrix is fake-IDB; the existing native browser suite is a separate regression
check, not a claim that all 22 new histories were run in browsers.

Final regression checks after the observer repair: 2,428 adapter runtime/type
cases, all 156 native browser cases, changed-file lint, formatting and whitespace
checks passed. The earlier merged-core 300 cases and 12 declaration consumers
remain separate receipts; this repair changes neither core nor exported types.


## Receiving update: obvious coverage port

The prior disposition table is the frozen research result. The subsequent
[port audit](2026-10-06-indexeddb-donor-port.md) records implementation of DP08,
DP09, DP10 and DP17, with three assertion-killed production mutants and packed
resolver controls. DP09's native WebKit Blob-preservation cells remain unproved:
the local raw provider rejects Blob preparation, so those cells now establish
truthful rejection and a healthy suffix. No new recovery or ownership policy was
adopted. DP02, DP12 and DP13 still require the stated product decisions.


## Approved follow-up

The later [follow-up audit](2026-10-06-indexeddb-donor-followup.md) records the
approved closure/capture/worker contracts, optional blocked diagnostics, core
typed-key repair, and completed native naming and persistent-WebKit Blob evidence.
The earlier findings above retain their original revision and evidence boundary.
