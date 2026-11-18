# Local adapter receiving inventory

This inventory precedes the receiving-test edits. The review checkout is
`powersync-standalone-package`; all receiving work in this report is test-only.

| Law | Local-only | LocalStorage | Authority and receiving boundary |
| --- | --- | --- | --- |
| Complete eager reload replaces omitted rows and changed values | Does not transfer: reload keeps the only copy of authored rows | Applies | Glossary reload and snapshot transaction; LocalOnly guide, initialData; LocalStorage startup restores the complete stored snapshot |
| Successful local handler confirms authored mutations; rejection rolls back | Applies | Applies, with author-order persistence | Both local adapter guides, Direct Local Mutations and Mutation Handlers; existing local-only direct-write and LocalStorage write-order owners |
| Same provider peers retain independent ownership | Independent Collections have no shared provider | Applies to one Storage object/key and to native storage-event delivery | LocalStorage guide, Synchronization; existing peers owner |
| Cleanup releases provider callbacks and held receipt continuations | No provider callback or asynchronous receipt continuation | Native storage listener and same-tab subscription belong to one sync run | Glossary cleanup; LocalStorage guide and existing peers owner |
| Terminal eager `fail()` rejects the initial gate | No remote failure source | Does not transfer to synchronous read/parser failure: these throw and crash | Glossary crash versus loading error; LocalStorage guide malformed snapshots and storage failure |
| Row decoder refuses or rekeys a provider row | No decoder | Parser owns a complete storage snapshot, not a row callback | LocalStorage guide parser and stored snapshot validation |
| PowerSync stream-parameter, priority, network lease union and checkpoint confirmation | No such provider boundary | No such provider boundary | Local adapter public configuration types and guides |

The replacement-law rival is a local-only Collection seeded with `old`, then
given an accepted `new` insert. Reload must retain both. Applying the remote
next-result mask would delete the user's only copy and violate the documented
contract. The automatic-confirmation rival is a successful handler that returns
an ignored legacy value without an explicit confirmation utility: local
adapters still confirm the authored row, whereas remote adapters require their
separate confirmation operation.

The shared eager-reload model, grammar, observation cuts, comparisons, and
calibrations are reused unchanged by the LocalStorage Node and actual Chromium
Storage receivers. Each receiver supplies actual public adapter options and
changes the stored complete snapshot while the retired run has no listener.
The test does not synthesize Collection rows or fulfill an adapter receipt.

## Frozen receiving evidence

Base HEAD: `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`. Native runtime:
Node `24.19.0`, Chrome `157.0.8103.79`, one Vitest worker. LocalOnly and
LocalStorage production are unchanged. The versioned
[snapshot](2026-11-17-cross-adapter-local-stores-snapshot.json) records SHA-256
for every owned test file, the shared reload owner and production source, and
the execution logs. Other agents own the shared test modules and registries.

From `packages/db`:

```sh
node ../../node_modules/vitest/vitest.mjs run tests/local-storage-eager-reload-oracle.property.test.ts tests/local-only-direct-write-oracle.test.ts tests/local-storage-write-order-oracle.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=dot
node ../../node_modules/vitest/vitest.mjs run --config vitest.local-stores.config.ts --maxWorkers=1 --reporter=dot
```

Node: **1,663 passed** in three files. Chromium: **1,552 passed** in one file.
The browser process uses the actual native `localStorage` object and actual
`window` Storage listener API. Sandbox localhost access initially failed with
`listen EPERM`; the authorized native-host run then passed. Registration-only
failures before central property IDs were added are setup failures, not product
RED results.

The existing `local-storage.write-order` keeps every one of its **1,449**
enumerated histories. Its law, history grammar, model and comparison moved to
`local-storage-write-order-oracle.ts`; its public Collection loop moved to
`local-storage-write-order-driver.ts`. The old filename registers the original
property. The native registration supplies real Storage to the same loop and
receives the same 1,449 judgments. The only driver changes are the Storage/key
and event-host seam, failure-preserving cleanup shared with browser drivers,
and removal of the fixture key after cleanup. No write is synthesized and no
expected answer is copied into the receiving page.

The LocalStorage reload registrations each execute the shared owner's 103 test
units. At seed 2367, its 80 generated histories reached omitted-row **22**,
changed-overlap **17**, empty-result **14**, retained reload **31** and retained
reload with held mutation **19** times on both hosts. All eleven generated
constructions reach their declared state and the corresponding missing-reach
controls fail. The separate random campaigns also passed. The snapshot records
their full reach logs.

`local-only.handler-confirmation` extends the existing direct-write owner with
one held real application handler. Its generated histories cross operation,
fulfillment/rejection, four ignored legacy returns, optional disjoint peer and
short string values. The comparison observes optimistic rows while the handler
is held, exact rows and exact rejection object inside `when('settled')`, and
rows after reload. All **24** operation/decision/return constructions reached
their states. The fixed seed's 80 generated histories additionally hit all 24
states; some random cells were absent, so the random campaign alone is not
credited with that coverage.

Hostile controls reject an actual adapter-boundary omission of automatic
confirmation writes, wrong settled rows, lost rows after reload, and each
missing generated local-handler state. The shared reload controls reject an
actual inversion of `begin({ snapshot: true })` on retained rows, wrong raw
before-source/fulfillment/final rows, a lost optimistic overlay, absent commit
acceptance and every missing construction state. These are rejected controls
on unchanged production, not a product bug-fix RED/GREEN claim. No local-store
production defect was found in this slice.

Guarded direct replays each recorded exactly one nonzero successful execution:

```sh
TANSTACK_DB_ORACLE_PROPERTY=adapter.local-storage.eager-reload.node TANSTACK_DB_ORACLE_SEED=2367 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated' node --import tsx tests/oracle-replay.ts tests/local-storage-eager-reload-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=dot
TANSTACK_DB_ORACLE_PROPERTY=local-only.handler-confirmation TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated' node --import tsx tests/oracle-replay.ts tests/local-only-direct-write-oracle.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=dot
TANSTACK_DB_ORACLE_PROPERTY=adapter.local-storage.eager-reload.chromium TANSTACK_DB_ORACLE_SEED=2367 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated' node --import tsx tests/oracle-replay.ts tests/local-storage-eager-reload-oracle.browser.test.ts --config vitest.local-stores.config.ts --maxWorkers=1 --reporter=dot
```

The order owner is enumerated, so it receives the full 1,449-case campaign
instead of seed/path replay. Scoped ESLint and strict TypeScript over the new
receiving files and their imports passed with no diagnostics. Root owns the
final branch-wide `pnpm lint:changed` gate.

## Oracle review record

| Rubric | Receiving evidence or limit |
| --- | --- |
| ORC-001 | Public local adapter guides and glossary authorize the laws; the inventory rejects remote-only transfers. |
| ORC-002 | Reload retains its independent mask model. Local handler expectations fold a declared operation into plain rows. Order retains its independent author-order fold. |
| ORC-003 | Models and comparisons stay in oracle owners; Storage/page/adapter code records actual observations. |
| ORC-004 | Generated local handler operation/outcome/return/peer/value dimensions; shared reload grammar unchanged; complete bounded order enumeration preserved. |
| ORC-005 | Public adapter factories and Collection operations, settlement-waiter snapshots and actual stored bytes/fresh restores. |
| ORC-006 | Actual snapshot-declaration and automatic-confirmation omission controls, raw wrong-result controls, and declared-reach removal controls are rejected. |
| ORC-007 | Fixed and random campaigns share the same law and check; three guarded replays prove execution. Order is explicitly enumerated. |
| ORC-008 | Local handler model applies one operation; it reproduces no production queue, handler wrapper or direct-write classifier. |
| ORC-009 | Uses Collection, sync run, reload, snapshot transaction, optimistic state and settlement as defined in the glossary. |
| ORC-010 | Drivers preserve primary failures while running cleanup. Native browser diagnostics feed the shared receiving judgment. No detached receipt continuation is invented for local-only. |
| ORC-011 | No concrete shared semantic-fault hypothesis needing another formulation arose; cross-host agreement is credited only to the native handoff, not independent semantics. |
| ORC-012 | Exact commands, code and log fingerprints, reaches, rejected controls and limits are recorded here and in the snapshot. Independent review follows this author record. |
| ORC-013 | Empty replacement, omission, changed overlap, held optimistic insert and ignored legacy returns distinguish the relevant boundary rivals. |
| ORC-014 | Actual Chromium Storage receives the same reload and author-order observations, models and comparisons. Remote replication and cross-tab event delivery are not inferred. |
| ORC-015 | Eleven shared reload states and 24 local handler constructions have enforced generated reach and omission controls. Order preserves all finite histories. |
| ORC-016 | New properties use reusable independent models and shared comparisons; supporting drivers/pages own no expected answers. Existing direct-write fixed witnesses are unchanged. |

Limits: no arbitrary simultaneous local handlers, manual transactions, schema
values, cross-tab event scheduling, Storage faults, parser failures, native
listener cardinality measurement, or held commit-receipt cancellation is added
by this slice. Existing LocalStorage order/peer/value-fidelity and Collection
lifecycle/optimistic owners retain those neighboring responsibilities. The
shared eager gate's remote `fail()` policy and PowerSync streams/checkpoints
remain deliberately outside these local receiving registrations.

## Independent-review repair: completed observation transport

The independent reviewer reproduced an ORC-010 gap in the initial native
write-order bridge. An actual accepted update reached `held after release 1`,
`settled` and `fresh restore`, then fixture `removeItem` threw. Because the page
awaited the driver before returning its raw observations, transport rejected and
discarded those completed checkpoints. This was a receiving-harness defect;
the local adapter production was unchanged.

The additive shared `retainOracleCleanupObservation` helper now retains a
completed raw result and every separate teardown diagnostic, runs all cleanup
steps, and preserves an incomplete body failure as the AggregateError cause.
The LocalStorage loop emits cleanup diagnostics after its product checkpoints;
the native page transports the same collector used by the receiving-harness
tests. The checker judges product rows before those secondary diagnostics.

Ordinary harness controls cover successful teardown, all cleanup steps after
multiple failures, an incomplete body plus teardown failure, a cleanup-only
violation, and a wrong raw public snapshot plus actual teardown failure. The
last two controls also run through the actual Chromium page with a Storage
wrapper that removes the native key before throwing. The paired control keeps
the `settled` product mismatch primary while retaining the teardown diagnostic.
These controls have no separate product expectation: they call the existing
write-order model and check.

After the repair, Node **1,668 passed** in five files (the original 1,663 plus
five ordinary harness tests). Native Chromium **1,554 passed** in two files
(the original 1,552 plus two native teardown controls). The same one-worker
commands above now additionally include `tests/local-storage-receiving-cleanup.test.ts`
and `tests/oracle-cleanup.test.ts` for Node; the browser config includes its two
ordinary native controls. Scoped ESLint and strict receiving-file TypeScript
remain clean. The revised snapshot replaces the author freeze only after this
append; independent re-review follows the repaired fingerprints.

## Independent verdict

`oracle_enforcement` independently approved the repaired fourteen-file slice.
It verified every current owned/shared/log fingerprint, inspected the actual
collector, cleanup envelope and product-first comparison, and reran the five
ordinary cleanup/handoff controls successfully. It verified the 1,668 Node and
1,554 Chromium logs, all original 1,449 enumerated order judgments and the three
guarded replay records. The original ORC-010 finding is closed. It found no
further supported product, law-suitability or enforcement defect within the
declared limits. The reviewer edited no files.

Package wiring keeps native tests in the explicit browser config. A final
`vitest list --filesOnly` check confirmed that the default package config lists
the Node receiver and excludes both native local-store files. With
`test.dir: './tests'`, the initial `tests/*.browser.test.ts` exclusion did not
match; the package uses `**/*.browser.test.ts`. The snapshot's `packageWiring`
section records the package scripts, TypeScript config, Vite config and discovery
log fingerprints separately from the independently reviewed semantic slice.
