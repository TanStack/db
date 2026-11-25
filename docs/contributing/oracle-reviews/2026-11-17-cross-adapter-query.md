# Query DB receiving inventory

Test-only inventory recorded before adding receivers. Production entry:
`packages/query-db-collection/src/query.ts#queryCollectionOptions` at PR head
`92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`. No Query production changes are
authorized in this phase.

## Applicable laws and observation cuts

| Family | Receiving path and existing owner | Planned evidence |
| --- | --- | --- |
| Complete eager reload | Real QueryClient/QueryObserver; shared eager-reload model/checker | Add a receiver of a complete cached result. Observe held source entry, reload fulfillment, and final rows, including omissions, changed overlap, empty results, and persisting optimistic inserts. |
| Persisted startup | `persisted-startup-conformance-oracle.test.ts` receives shared persisted-startup law with a real QueryClient | Preserve the existing five cache/fetch origins and restore schedules; targeted Node run. Existing shared Node SQLite and browser OPFS receiving registrations remain the real-storage evidence. |
| Mutation confirmation | `documented-mutations-oracle.test.ts` and `ownership-confirmation.oracle.test.ts` receive shared confirmation models through real QueryClient | Preserve Query's explicit refetch/write confirmation and accepted-versus-applied cuts. No PowerSync checkpoint policy. |
| Query health | `failing-queries-oracle.test.ts` | Preserve latest failure per failing Query, error identity sharing, partial recovery, and plain/persisted paths. |
| Ownership, cache and cancellation | ownership lifecycle/settlement/bottom/upper owners; documented Query cancellation contract | Inventory existing boundaries; do not treat one Collection's explicit cleanup as provider-wide shutdown. |

The new reload receiver supplies its changed authoritative result with public
`QueryClient.setQueryData` while core holds the next sync invocation before
adapter entry. Query's cleanup removes the prior tracked Query. The receiver
therefore installs a new complete cached result after retirement, rather than
depending on a late fetch to repair omission. `staleTime: Infinity` makes that
cached result legal without an unrelated automatic fetch.

## Rejected policy transfers and rivals

The eager push-source family is inapplicable: Query is a cache/fetch adapter,
not a live table-union source (`db-adapter-conformance/MIGRATION.md`). Changing
only a backend response before reload does not make a stale cached response
illegal. A legal rival is a successful cache value followed by a changed backend
and a disabled or infinitely fresh Query: its first complete result can be the
cache value. The reload receiver changes the actual public cache input instead.

The generic decode-refusal terminal policy is unsuitable after Query readiness.
`docs/collections/query-collection.md`, Errors, requires both fetch and result
application failures to be retryable `failureReason` values after readiness; a
later successful application clears them. The distinguishing rival is valid
rows, a throwing `select` on refetch, then valid rows: Query retains ready rows
and its observer and can recover in that same run. PowerSync's stopped parse
policy would reject this legal recovery.

The on-demand stream error-frame policy is also unsuitable. Query's accepted
contract holds the latest error for each failing Query, retaining a shared Error
while any Query still holds it. Two successive errors for one Query replace the
first, rather than retaining all reports until recovery. The existing exhaustive
`failing-queries` oracle owns that judgment.

Fresh initial fetch failure is terminal for that Query sync run, but a cached
successful result changes the premise: a later fetch failure is a retryable
post-ready problem. Any future generic initial-gate receiver must retain this
distinction. No terminal cached-refetch assertion is added here.

## Evidence

The inventory above preceded the test edits. The following append-only entry records the resulting test-only slice.


## Test-only evidence, 2026-11-17

No Query production file changed. `src/query.ts` SHA256 remains
`1a794774e60d3c1dbacd515d0350b048557714adf80d6e3b9d42e7250841754b`.
Node was v24.19.0; every receiving command used `--maxWorkers=1`.

The initial-gate receiver additionally receives the shared terminal judgment for
uncached `fresh` and `reload` entries. Both are generated separately, with and
without a successful new-run recovery. The shared entry is deliberately outside
that receiver: a peer with a successful cached value can later fail a fetch,
and a new Collection can still obtain that valid cached value and become ready.
This is the Query Errors/cache contract, not an exception to a terminal law.

The failing-Query reference computation and checker moved unchanged into
`failing-queries-oracle.ts`; its production driver moved into
`failing-queries-driver.ts`. The existing 2,592 four-fetch histories, declared
states, model and comparisons remain registered. A new generated receiver runs
the same latest-error model/checker for select refusals. It also checks ready
status, retained user row data, and the two observed Queries. Each of its ten
states is constructed separately on plain and persisted paths. Reach is credited
only after the actual select hook consumes the injected errors. Reserved row
virtual fields belong to the virtual-props oracle; all other row fields are
retained in the recorded user-data comparison.

### Commands and classifications

Commands below ran from their named package directory. Logs are under
`.review-2377/` in the reviewed worktree.

| Command | Result | Log |
| --- | --- | --- |
| Query: `pnpm exec vitest run --coverage.enabled=false --maxWorkers=1 tests/eager-reload-conformance-oracle.property.test.ts tests/failing-queries-oracle.test.ts tests/persisted-startup-conformance-oracle.test.ts tests/documented-mutations-oracle.test.ts` | GREEN, 3,562 tests in five runtime/typecheck files before the additive gate registration | `query-cross-node-final.log` |
| Query: `pnpm exec vitest run --coverage.enabled=false --maxWorkers=1 tests/eager-reload-conformance-oracle.property.test.ts` | GREEN, final reload + initial-gate slice 130/130 | `query-gate-node.log` |
| Browser: `pnpm exec vitest run --config vitest.adapter-oracles.config.ts --coverage.enabled=false --maxWorkers=1 e2e/query-cross-adapter-oracle.browser.test.ts` | GREEN, 180/180 on real Chromium; persisted select histories use real OPFS SQLite | `query-cross-browser-final.log` |
| Query: `pnpm exec tsc --noEmit -p tsconfig.json` | GREEN | `query-cross-typecheck.log` |
| Targeted ESLint over the eleven-file slice | GREEN | `query-cross-lint.log` |

The first browser attempt failed to open localhost (`listen EPERM`) before any
property ran: SETUP FAILURE, not RED. The approved localhost-enabled run then
revealed a test-checkpoint defect: raw Query.fetch plus one timer turn did not
wait for OPFS application, so recovery was observed too early. Select histories
now use the refreshed subset load's applied-settlement contract. No expected
health value is polled. The shrunk history is retained as a fixed history of the
same model/driver/checker: one select refusal followed by three valid results.

Direct browser replay of that captured trace passed once:

```sh
TANSTACK_DB_ORACLE_SEED=430943292 TANSTACK_DB_ORACLE_PATH=0:1:2:1:1:1:1 TANSTACK_DB_ORACLE_PROPERTY=query-db.select-failures.chromium-opfs TANSTACK_DB_ORACLE_UNIT='random seed: generated' pnpm exec vitest run --config vitest.adapter-oracles.config.ts --coverage.enabled=false --maxWorkers=1 e2e/query-cross-adapter-oracle.browser.test.ts -t '^query-db\.select-failures\.chromium-opfs(?: | > )random seed: generated$'
```

Log: `query-select-opfs-replay.log`. This was a checkpoint repair, not evidence
of a Query production defect. The first whole-slice runs also rejected a wrong
row projection that included reserved virtual fields in expected user data;
that was a test-model boundary mismatch, corrected before the final campaigns.

### Law, reach, RED, GREEN, mutant, limits

**Law:** Complete Query results determine membership and values on reload;
uncached first-load failures are terminal for their sync run; post-ready select
failures preserve ready row data, retain the latest error per failing Query, and
permit same-run recovery. Authorities are the glossary reload/initial-gate
contracts, Query collection Errors/refetch/cache documentation, and existing
R21/R22 latest-error decisions.

**Reach:** Every normal campaign enforces a minimum of one randomized
construction for each of 11 reload states, four uncached gate states, and ten
path-specific select states. Each construction has a missing-state calibration,
and the shared checker separately enforces generated-builder obligations. The
following tables give additional random/generated campaign counts (fixed
histories are excluded). Plain/select and persisted/select use the same laws.

| Path/property | Campaign | Reach counts |
| --- | --- | --- |
| Node: `query-db.select-failures.node-sqlite` | fixed seed 2377 | `{"persisted: a Query fails again with a new error while its failure is listed":8,"persisted: a Query fails with the error value another Query lists":7,"persisted: a Query recovers while another lists the same error value":5,"persisted: a Query recovers while another's failure stays listed":8,"persisted: select refusal":16,"plain: a Query fails again with a new error while its failure is listed":14,"plain: a Query fails with the error value another Query lists":9,"plain: a Query recovers while another lists the same error value":6,"plain: a Query recovers while another's failure stays listed":7,"plain: select refusal":24}` |
| Node: `query-db.select-failures.node-sqlite` | random seed | `{"persisted: a Query fails again with a new error while its failure is listed":9,"persisted: a Query fails with the error value another Query lists":7,"persisted: a Query recovers while another lists the same error value":7,"persisted: a Query recovers while another's failure stays listed":10,"persisted: select refusal":18,"plain: a Query fails again with a new error while its failure is listed":11,"plain: a Query fails with the error value another Query lists":6,"plain: a Query recovers while another lists the same error value":2,"plain: a Query recovers while another's failure stays listed":6,"plain: select refusal":21}` |
| Node: `adapter.query.complete-result-reload` | fixed seed 2367 | `{"changed-overlap":17,"empty-result":14,"fresh":21,"fresh-held":14,"no-mutation":34,"omitted-row":22,"persisting-mutation":46,"reload-empty":28,"reload-empty-held":13,"reload-retained":31,"reload-retained-held":19}` |
| Node: `adapter.query.complete-result-reload` | random seed | `{"changed-overlap":16,"empty-result":19,"fresh":23,"fresh-held":13,"no-mutation":31,"omitted-row":24,"persisting-mutation":49,"reload-empty":28,"reload-empty-held":19,"reload-retained":29,"reload-retained-held":17}` |
| Gate Node: `adapter.query.complete-result-reload` | fixed seed 2367 | `{"changed-overlap":17,"empty-result":14,"fresh":21,"fresh-held":14,"no-mutation":34,"omitted-row":22,"persisting-mutation":46,"reload-empty":28,"reload-empty-held":13,"reload-retained":31,"reload-retained-held":19}` |
| Gate Node: `adapter.query.complete-result-reload` | random seed | `{"changed-overlap":16,"empty-result":18,"fresh":19,"fresh-held":11,"no-mutation":37,"omitted-row":22,"persisting-mutation":43,"reload-empty":26,"reload-empty-held":16,"reload-retained":35,"reload-retained-held":16}` |
| Gate Node: `adapter.query.initial-gate` | fixed seed 2377 | `{"queryFn:fresh":12,"queryFn:fresh:recovery":4,"queryFn:reload":18,"queryFn:reload:recovery":11}` |
| Gate Node: `adapter.query.initial-gate` | random seed | `{"queryFn:fresh":9,"queryFn:fresh:recovery":1,"queryFn:reload":21,"queryFn:reload:recovery":12}` |
| Chromium: `adapter.query.complete-result-reload.chromium` | fixed seed 2367 | `{"changed-overlap":17,"empty-result":14,"fresh":21,"fresh-held":14,"no-mutation":34,"omitted-row":22,"persisting-mutation":46,"reload-empty":28,"reload-empty-held":13,"reload-retained":31,"reload-retained-held":19}` |
| Chromium: `adapter.query.complete-result-reload.chromium` | random seed | `{"changed-overlap":14,"empty-result":14,"fresh":29,"fresh-held":19,"no-mutation":32,"omitted-row":15,"persisting-mutation":48,"reload-empty":28,"reload-empty-held":14,"reload-retained":23,"reload-retained-held":15}` |
| Chromium: `query-db.select-failures.chromium-opfs` | fixed seed 2377 | `{"persisted: a Query fails again with a new error while its failure is listed":8,"persisted: a Query fails with the error value another Query lists":7,"persisted: a Query recovers while another lists the same error value":5,"persisted: a Query recovers while another's failure stays listed":8,"persisted: select refusal":16,"plain: a Query fails again with a new error while its failure is listed":14,"plain: a Query fails with the error value another Query lists":9,"plain: a Query recovers while another lists the same error value":6,"plain: a Query recovers while another's failure stays listed":7,"plain: select refusal":24}` |
| Chromium: `query-db.select-failures.chromium-opfs` | random seed | `{"persisted: a Query fails again with a new error while its failure is listed":7,"persisted: a Query fails with the error value another Query lists":8,"persisted: a Query recovers while another lists the same error value":4,"persisted: a Query recovers while another's failure stays listed":6,"persisted: select refusal":16,"plain: a Query fails again with a new error while its failure is listed":12,"plain: a Query fails with the error value another Query lists":3,"plain: a Query recovers while another lists the same error value":3,"plain: a Query recovers while another's failure stays listed":9,"plain: select refusal":23}` |
| Chromium: `adapter.query.initial-gate.chromium` | fixed seed 2377 | `{"queryFn:fresh":12,"queryFn:fresh:recovery":4,"queryFn:reload":18,"queryFn:reload:recovery":11}` |
| Chromium: `adapter.query.initial-gate.chromium` | random seed | `{"queryFn:fresh":15,"queryFn:fresh:recovery":8,"queryFn:reload":15,"queryFn:reload:recovery":6}` |


**RED:** No Query production defect is claimed. Unchanged Query production
passes these receiving laws. The setup/checkpoint failures above are classified
separately and were repaired only in test machinery.

**GREEN:** The final receiving campaigns and direct replay above pass before any
Query production change. Existing persisted startup, documented mutations and
all four-fetch health histories also pass.

**Mutant:** Final calibrations reject a dropped still-failing Query error,
terminal resource release after a recoverable select refusal, detached browser
errors, and every missing constructed select state. Shared reload calibrations
reject an inverted snapshot declaration, corrupted raw before/fulfillment/final
rows, a missing optimistic overlay and source acceptance. Shared gate
calibrations reject incorrectly pending or fulfilled terminal loads and missing
generated states. These are intended-comparison assertion failures, not timeouts
or setup failures. There is no claim of a Query production mutant campaign.

**Limits:** Three reload source keys and one disjoint optimistic insert;
uncached fresh/reload gates with one optional new-run recovery; two on-demand
Queries and four settled select/refetch steps. No remote backend or network
freshness, generic stream error policy, arbitrary schema/parser, delayed
application interleavings, native storage fault, exhaustive intermediate
publication, or shared cached-success terminal-failure claim. Existing broader
Query ownership, ordered pagination, confirmation and persisted-startup owners
remain responsible for their documented domains. No Query bug-class closure or
universal adapter-completeness claim follows from this slice.

### Rubric audit

| Requirement | Outcome |
| --- | --- |
| ORC-001–003 | Authorities and limits appear beside shared/local laws; latest-per-Query model stays independent; prose names grammar, production path and applied public cut. |
| ORC-004 | Constructors rebuild all four error distinctions on both paths; retained fixed OPFS recovery is in the same grammar. Removing a subset loses shared ownership, repeats lose replacement/recovery, select loses application refusal, persistence loses wrapping/real storage. Only subsets 1/2 and four steps are legal; a third subset or fifth step is excluded. |
| ORC-005 | Real QueryClient/QueryObserver receives controlled queryFn results; actual select invocation gates reach; actual refreshed load settlement supplies the application cut. Full user row data, status, observer count and identity-projected health are recorded. |
| ORC-006 | Bound wrong-error/resource/browser controls plus shared reload/gate calibrations reject at their named comparisons. |
| ORC-007 | Same fixed-seed/random campaigns and budgets run on each path; captured seed+path+unit replay executed once and passed. |
| ORC-008 | No reference-state rule changed: latest errors, ordered unique values and retained identity mapping moved intact. The stage/host receiving dimensions change production entry, not expected error semantics. |
| ORC-009 | Error-value numbers map actual object identity before transport; stage/host labels are test-only. Sync run, reload, first gate and applied settlement use glossary meanings. |
| ORC-010 | Production driver streams steps before cleanup; withOracleCleanup preserves primary/secondary failures. Browser transport delivers product observations before diagnostics. Shared raw reload cleanup fidelity is maintained by its owner. |
| ORC-011 | No new shared semantic-fault hypothesis requires a second reference model. Explicit cached-ready and retryable-select rivals reject unsuitable donor policies. |
| ORC-012–014 | This exact-slice record bounds claims. Plain, controlled persistence, native Node SQLite and actual Chromium/OPFS share the same model/checker; no remote service claim. Terminal/retryable and fresh/cached distinctions have nearby rival cases. |
| ORC-015 | Every required state has a randomized fresh-object builder, actual path reach and a missing-state control. All final counts meet minimum one. |
| ORC-016 | Fixed recovery and all generated histories use the same model/driver/checker. No standalone unit assertion was added. |

### Frozen test slice

Manifest-string SHA256: `92985e25c34425baaff43b161f04f2b5dbd08451b16de5318ecaa8f348c2f9ca`.
The manifest excludes this append-only report and the independently maintained
shared model/config modules. Review those dependencies at their own frozen slice.

```text
0a4818bca2a3710f7d6cbf489a4c4647812c20a74bd00b8bc133ed46c906872f  packages/browser-db-sqlite-persistence/e2e/query-cross-adapter-oracle.browser.test.ts
fbac9ff5221ea8bf4f018daf000596635aa47ea7f27c49340735a3a11d626573  packages/browser-db-sqlite-persistence/e2e/query-cross-adapter-receiving.opfs.html
23af740ad9bcf8fef4633e9058fd6b6a1f1f9c693557933515a8ed90fc312057  packages/browser-db-sqlite-persistence/e2e/query-cross-adapter-receiving.opfs.ts
702a073749e842663fcbf5883a6bd30c2661cf0ad734d3e182ec96e6df685671  packages/query-db-collection/package.json
acf84278a55e34881b7f3518bcbeb744abcacd73c5b07afe55bf5d60f9f641da  packages/query-db-collection/tests/eager-reload-conformance-oracle.property.test.ts
3fb9ee458ff26cd823a9e03d8d6c9eeee62f1359d9782a797f73425630009046  packages/query-db-collection/tests/eager-reload-driver.ts
3629ddc60606616c6400df7dcdb1ba7303c34ff0bf3c8baee470f36d9d46b65b  packages/query-db-collection/tests/failing-queries-driver.ts
575203863300496115af9799428129d347385fef53b958fceb9414458d0cbae4  packages/query-db-collection/tests/failing-queries-oracle.test.ts
1e471d8922ea698f5b7bf4156d634af0fa0a3367ed2783ebd93462fad1447cff  packages/query-db-collection/tests/failing-queries-oracle.ts
0d477ccb80d1731ca264b7108cd942243ae97e508fdc7f16c547e1accb002d82  packages/query-db-collection/tests/select-failures-oracle-suite.ts
742228c4020c6e503ab94c1da0593e6f6427c04e4bf1cab2be4e322dffd21911  packages/query-db-collection/vitest.config.ts
```


## Review amendment: product verdict before browser diagnostics

Independent law review approved the eleven-file initial slice above for its
bounded receiving claims. Independent enforcement review then found that the
select checker compared detached browser diagnostics after health but before
row/status/resource observations. A wrong completed product observation plus a
later browser diagnostic could therefore report the later diagnostic as primary.

The amendment moves browser diagnostics after every product comparison. Two
bound calibrations now combine a wrong row snapshot or missing observers with a
secondary detached browser rejection and require the product's `retryable select
refusal` law at `step` to remain primary. Before the comparison repair, all four
Node calibrations failed because they reported `receiving errors` instead
(`query-review-fidelity-red.log`): intended-check assertion RED for this oracle
repair, with no production edit. Afterward the complete select campaigns and
calibrations pass, controlled/native Node 104/104
(`query-review-fidelity-green.log`), and both new actual Chromium calibrations
pass (`query-review-fidelity-browser-green.log`, 2/2, other 180 tests unselected).
The full 180-test browser campaigns and 3,562/130 Node results above retain their
receiving evidence; this amendment changes comparison priority/calibration only.

Only `packages/query-db-collection/tests/select-failures-oracle-suite.ts`
changed after the original freeze. Its new SHA256 is
`2305f36505b43451deaa53cc29f662a6d60d1d193726e9ae4335f04e90d9e266`.
All other ten hashes remain as above. The amended eleven-file manifest-string
SHA256 is `349e2abbbd2f07dadaa24356cd466bb402928f391cfe68686b18595f8b23eaa5`.

### Independent amendment verdicts

Both independent reviewers approved the amended eleven-file fingerprint above.
`oracle_adversarial` verified all eleven hashes, inspected the changed comparison
and bound combined-fault controls, and retained its earlier semantic-law verdict.
`oracle_diff_enforcement` independently verified the same hashes and executed
both combined-fault controls on controlled and native Node paths: **4 passed**,
with strict types clean. Its earlier independent actual Chromium/OPFS recovery
replay also remains valid. Neither reviewer reported an outstanding finding in
this bounded Query slice. This approval covers the named receiving instruments;
it does not establish blanket adapter-portfolio closure or a Query production
bug-class repair.

## Review amendment: Query replacement mutant

Binding the shared replacement calibration to the fixed retained-row to empty
reload history exposed an equivalent mutant. Removing Query's snapshot
declaration still produced the correct result because Query also emits omission
deletes. The shared run recorded **131 passed, 1 failed** in
`.review-2377/shared-reload-final-query.log`: the calibration correctly rejected
its claim that this particular mutation must violate `complete eager result`.
This was a calibration-applicability failure, not a Query production defect.

The receiving wrapper now disables both replacement mechanisms, only in the
target sync run, at the public sync boundary. It removes `snapshot: true` and
omission delete messages. Node and Chromium use the same wrapper through the
shared production driver; neither the row model nor the product comparison
changes. The bound calibration now rejects this actual incomplete replacement.
The registration names the mechanism `snapshot-and-sweep` so it cannot silently
fall back to the snapshot-only mutant again.

On Node 24.19.0 with one worker, the complete Query reload/gate file passes
**132/132**, with no type errors. The complete Chromium reload property passes
**105/105**, with 79 unrelated tests unselected. Both fixed and random campaigns
retain all eleven reload states with a constructed minimum of one per state.
Strict Query TypeScript and scoped ESLint pass. The commands are:

```sh
# packages/query-db-collection
node ../../node_modules/vitest/vitest.mjs run tests/eager-reload-conformance-oracle.property.test.ts --coverage.enabled=false --maxWorkers=1
pnpm exec tsc --noEmit -p tsconfig.json

# packages/browser-db-sqlite-persistence
pnpm exec vitest run --config vitest.adapter-oracles.config.ts --coverage.enabled=false --maxWorkers=1 e2e/query-cross-adapter-oracle.browser.test.ts -t '^adapter\.query\.complete-result-reload\.chromium(?: | > )'
```

Four of the eleven owned files changed after the prior approved fingerprint:

```text
3b7c7be3776abce56d06d0b34b6bdd1151ffe27c48bf4de372a3a3015b921f05  packages/browser-db-sqlite-persistence/e2e/query-cross-adapter-oracle.browser.test.ts
866660cc9eeffbbd9cdf2febccd63a47385213975818a692e99eac3b5f32d070  packages/browser-db-sqlite-persistence/e2e/query-cross-adapter-receiving.opfs.ts
680fc3e901542b7348c1da775b47c81a3ae1522ec5ea59ccb75ce5afb1f39ce5  packages/query-db-collection/tests/eager-reload-conformance-oracle.property.test.ts
0ab452670ea72df22bfb68f1b84a400a323c1abbd58b2b815978b0ea473e31ce  packages/query-db-collection/tests/eager-reload-driver.ts
```

The other seven retain their previous hashes. The updated eleven-file
manifest-string SHA256 is
`2fb244cb915113108eb306edffa0ca237109c97266ac2fbd1501e521dfe6b293`.
Shared driver, comparison and cleanup dependencies remain in their separate
root-owned review slice. No production file changed, no run budget decreased,
and the receiving limits above still apply.

The identical commands were rerun with captured logs after a further shared
calibration was added: **133 Node tests passed**, **106 Chromium reload tests
passed** (79 unrelated tests unselected). The eleven owned hashes above remain
unchanged. These latest runs are in `.review-2377/query-replacement-node-final.log`
(SHA256 `043b9ccda7a1f4adf93701982e7780e5c705bcb71051d92e937a36ba7054ec1f`)
and `.review-2377/query-replacement-browser-final.log`
(SHA256 `94ff7891d723c1dfea6523616ef8e73ad8d8677f9505a4756cf42cfb8accc147`).
They used shared reload driver SHA256
`c7ecabfb9981254872362ec73af663c828fa2827c603ae1712318855c1c29327`
and shared suite SHA256
`fea78064cacbb60db6e8668fb04350cd9723618e64b125f3dd0aff6c1dc4cf6c`.
Their final shared-dependency review remains separate.

Independent enforcement rereview approved the eleven-file amendment, verified
every hash and unchanged Query production, and independently ran five selected
Node controls plus the actual Chromium replacement calibration (one passed,
183 unrelated tests unselected at that earlier shared-dependency revision).
It confirmed that both actual replacement mechanisms are removed only in the
target run, and that the unchanged shared comparison rejects the incomplete
replacement rather than an equivalent implementation.

Independent adversarial rereview also approved owned manifest
`2fb244cb915113108eb306edffa0ca237109c97266ac2fbd1501e521dfe6b293`,
reverified every owned hash, and checked both latest captured log hashes. It
confirmed that the target-run-only mutant now corrupts complete replacement
while preserving the shared model and comparison. Both prior Query approvals
and the diagnostic-priority amendment remain valid; final root-owned shared
dependencies retain their separate review gate.

## Receiving checkpoint: already installed Query cache result

The complete-result reload receiver has a synchronous source-delivery premise.
The shared driver holds entry to the target sync run while it awaits
`sdk.replace(next)`. Query's fixture calls the real
`QueryClient.setQueryData` there, before the new observer exists. Thus the
target run, for both fresh and reload histories, enters with the entire
authoritative result already installed in the cache. `staleTime: Infinity`
and `gcTime: Infinity` exclude refetch and cache-collection timers from this
source fixture. The reload receiver performs no persistence, remote I/O, or
delayed provider delivery, including when run in Chromium. The separate
persisted select-failure and startup families retain their own receiving
receipts and real-storage paths.

Source inspection establishes the corresponding receiving cut independently
of Collection readiness, expected rows, or a `markReady` callback. In
`packages/query-db-collection/src/query.ts`, `subscribeToQuery` synchronously
passes a successful `observer.getCurrentResult()` to its result handler, and
the sync entry point processes current results again immediately after
`subscribeToQueries()`. Target source delivery therefore finishes before that
sync invocation returns. The fixture declares this provider cut with a
`propagate()` method that resolves immediately and never consults a Collection
outcome. Optimistic/deferred application may still wait for
microtasks; the shared recorder separately waits for actual applied receipts
after releasing the mutation gate. A reload's warmup baseline can fetch an
immediately fulfilled promise, but its target run always receives the already
installed cache result.

This is the bounded premise for this Query receiving fixture. It establishes
neither a scheduling guarantee for arbitrary Query clients nor a delivery cut
for delayed provider callbacks. Later changes to the shared recorder keep
their separate snapshot and review gate; the earlier captured results above
remain evidence for their recorded shared dependency hashes.

After the shared driver made `propagate()` required and removed its prewait on
the tested ready/commit outcome, both affected Query receiving commands above
were rerun on Node 24.19.0 with one worker: **133 Node tests passed**, **106
actual Chromium reload tests passed** (79 unrelated tests unselected), and
strict Query TypeScript passed. These runs used shared driver SHA256
`3e178cd5823a690646f98301701fb84b4eee8fb6cbd7cde0f8b2a70ba6e96b0e`,
model `f77417e0111a8db3716208061dce81cdc53dff63096b12bde71ba79bc1fda3cb`,
and suite `fea78064cacbb60db6e8668fb04350cd9723618e64b125f3dd0aff6c1dc4cf6c`.
The captured Node log `.review-2377/query-provider-cut-node-final.log` has
SHA256 `ef2ddc4a4a3d012e987a17df1efe5e58d85900bf3234a790676e9d821e5e694b`;
the Chromium log `.review-2377/query-provider-cut-browser-final.log` has
SHA256 `f7bdd6116fa3f3768c942893da6d53d98118dc7b83cc2dfe8de469316bf1c231`.

Only the owned Query reload driver changed in this amendment, to SHA256
`3d0801a4020ec9b92a05e3e9c99dc5abc4ca481a9b4eb70580978c8d0ce72d00`.
The updated eleven-file manifest-string SHA256 is
`8eb7271a18cba47c85945f2057db90889a173849aaac7305310eb76b37c80f72`.
No production file changed and no campaign budget decreased. Independent
verdicts for this amendment are recorded separately below.

Independent adversarial rereview approved exact eleven-file manifest
`8eb7271a18cba47c85945f2057db90889a173849aaac7305310eb76b37c80f72`,
verified every hash, and followed the preinstalled cache success through both
synchronous production result handlers. It confirmed that immediate provider
completion does not depend on Collection readiness or commit and that actual
application remains separately observed through receipts. It also inspected
the exact 133-test Node and 106-test Chromium captured logs and their hashes,
and verified the recorded shared driver and suite. The approval is bounded to
this Query fixture's receiving cut; the shared implementation and calibration
gate remain separate.

Independent enforcement rereview also approved the same eleven-file manifest
and Query reload driver, verified every hash, and inspected the two immediate
`getCurrentResult()` production paths. It independently executed actual Query
fresh-empty, retained-to-empty reload, and empty reload with a held optimistic
transaction: all three passed the shared comparison under shared driver
`3e178cd5823a690646f98301701fb84b4eee8fb6cbd7cde0f8b2a70ba6e96b0e`.
Both independent reviewers therefore approved this bounded receiving-cut
amendment. Broader adapter receiving claims and the shared final verdict remain
separate.
