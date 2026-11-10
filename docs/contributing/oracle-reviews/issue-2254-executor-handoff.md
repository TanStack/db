# Executor replacement preserves transaction callers

Decision `offline-disposal-handoff-2026-11-10`, 2026-11-10. Authority: the
maintainer chose to preserve optimistic mutations during executor
reconfiguration and authorized encoding that contract before finding a fix.
Logout separately cleans up account-scoped Collections. Source report:
[issue #2254](https://github.com/TanStack/db/issues/2254).

This record applies to the working change based on
`ea3c920c1540486d0fb7410e089baa3a1583299c` (`origin/main` at worktree creation).
The production repair is confined to `OfflineExecutor.ts`; no core transaction,
provider, storage-adapter, or leadership behavior changes.

Working-source SHA-256 at final C01/O01 verification:

- `packages/offline-transactions/src/OfflineExecutor.ts`: `b71e2fdd6a023d791ee4557c49223b7623aa002f8bc0157278ec19e81eb4354b`
- `packages/offline-transactions/tests/interruption-handoff-oracle.ts`: `181c96b50cfa39bff9fcdb59379b88af287ba8ed9adb17e325f11a7f617bb176`

The initial evidence block below predates C01/O01. Its source hashes were
`f5e836180ee6f4fe93bb735279884d9b6d71160022ee69c8c3c74bdac21f9079`
and `7a33a402d3be04b697d516a756c368a6a5df237c26cb602827bce9123411f069`,
respectively. The final review evidence is appended below; it supersedes the
initial campaign counts and replay coordinates without erasing their history.

## Law and experiment

Disposal retires processing resources. It does not cancel admitted durable
transactions, reject their callers, or end their optimistic state on surviving
Collections. When a successor replays those transactions over the same outbox
and retains every configured Collection under its existing registry key in the
same runtime/package copy, it settles the
original callers with each transaction's provider/storage outcome. New adapter
objects over the same store do not change that obligation. Unrelated Collection
objects waiting for the same ID must remain independent.

The README's settlement boundary still applies: success requires mutation
function fulfillment and acknowledged outbox deletion. Permanent failure and
storage failure retain their existing rejection rules. Subscriber errors during
restoration cleanup cannot strand another executor's caller. Core's optimistic-history
contract still decides publication: source writes can queue behind persisting
mutations, and a failed restored snapshot can roll back conflicting pending
snapshots without canceling their durable work.

A sibling defect found during self-review needed another oracle-first cycle:
a restored transaction, two replacements, and a subscriber throwing during
restoration cleanup left the intermediate executor's waiter pending. The added
generated dimension failed before the cleanup-error repair (seed `20261110`,
path `10:3:3`, law `caller settlement` at `completed`). The fault is armed only
on final restored-snapshot cleanup. A live manual core commit can legitimately
throw a subscriber error while its public receipt fulfills; that separate
contract belongs to the core transaction-ownership oracle. No expectation was
changed to require those two results to agree.

The old interruption oracle restarted with fresh Collections and expressly
allowed old callers to remain pending after disposal. It enforced its narrower
contract correctly. Its driver recorded manual commit results without the old
public receipts or visible optimistic rows needed for the selected handoff law.
The companion `interruption-handoff-oracle.ts`, imported by that primary owner,
adds the missing retained-Collection histories and observations.

The independent model folds authored base rows, provider results and optimistic
rows in transaction order. It does not use production completion maps,
schedulers, restoration state, or Collection state to compute expectations.
`completed` combines provider settlement and deletion acknowledgement or failure;
`answered` distinguishes the provider's source write before held deletion. These
are observation abstractions, not executor lifecycle states.

## Initial evidence block, before C01/O01

- **Law:** decision above; README Tracking Submission Status; core optimistic
  history contract for queued source writes and pending-snapshot rollback.
- **Reach:** 120 generated histories plus eleven constructed histories per campaign,
  with fixed campaign seed `20261110` and a random campaign at the same budget.
  The fixed/random counts from the final package run were:

  | Declared state | Fixed | Random |
  | --- | ---: | ---: |
  | manual path | 17 | 21 |
  | explicit auto-commit path | 15 | 16 |
  | default auto-commit path | 19 | 19 |
  | action path | 26 | 24 |
  | live starting transactions | 77 | 80 |
  | restored starting transactions | 54 | 51 |
  | successor | 121 | 112 |
  | new adapter object | 100 | 100 |
  | deletion failure | 89 | 96 |
  | shared keys with peers | 44 | 47 |
  | throwing restoration-settlement subscriber | 23 | 28 |

  Each path's constructed history forces live transactions and two replacements.
  Restored histories do not count toward API creation-path reach. Provider and
  deletion gates must be reached; missing premises throw separately from a
  refinement mismatch. Fixed histories are not included in these reach counts.
- **RED:** on unchanged production, the extended interruption owner failed at
  `completed`, law `caller settlement`: expected `fulfilled`, received `pending`.
  Seed `20261110`, path `0:1:1:1:1` reduced to one manual transaction and one
  replacement. The fixed default-auto reproduction failed at the same cut.
  Every manual/auto/default/action handoff witness and the restored handoff
  witness failed at caller settlement. All no-disposal controls and the 13 old
  interruption tests passed. An earlier metadata projection failure was a
  recorder defect and is not product RED evidence.
- **GREEN:** the repaired package passes 418 tests in 24 files, including both
  handoff campaigns, fixed histories, and calibrations. The four core
  optimistic-history test files pass 366 tests. Package typecheck passes.
- **Mutants:** restoring instance-only production fails `caller settlement` at
  `completed`; rejecting waiters on disposal fails that law at `disposed`;
  omitting old restoration cleanup fails `optimistic lifetime` at `completed`;
  a global ID broker fails `scope isolation` at `completed`. A fifth mutant that lets a restoration subscriber exception abort delivery
  fails caller settlement at the same cut. All five are named
  assertion failures, not timeouts or setup errors. The shared-key extension
  also rejects the original implementation. Trace calibrations reject one
  abandoned caller, dropped optimism, and success before deletion acknowledgement.
- **Limits:** bounded to one to three transactions, replacements and old waiters;
  shared or disjoint keys in one controlled Collection; sequential executors
  without overlapping issued provider work. The older interruption owner still
  varies disposal timing before admission, while queued, and after issue.
  This does not prove cross-tab promise transport, native storage durability,
  provider idempotency, exactly-once execution by independent leaders, or
  arbitrary schedules. Fresh Collection objects do not inherit old callers.

The initial investigation used source aliases for DB and IVM under jsdom. The
package's normal committed configuration independently passed its tests. With
workspace dependencies installed and built, run from the worktree root:

```sh
cd packages/offline-transactions
../../node_modules/.bin/vitest run --config vite.config.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
cd ../..
node_modules/.bin/tsc --noEmit --project packages/offline-transactions/tsconfig.test.json
node scripts/agent-lint-feedback.mjs --event=stop
```

The earlier 366 core optimistic-history tests passed under the source-alias
configuration. A later attempt under the normal DB configuration stopped during
setup because the filtered local installation lacks `fake-indexeddb/auto`; it
ran no tests. With DB development dependencies installed, the portable command
from `packages/db` is:

```sh
../../node_modules/.bin/vitest run --config vite.config.ts tests/optimistic-history --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
```

The RED used the same source aliases under Node with the package's browser API
stubs. The final package run uses jsdom as the normal package config does. A
seed-and-path replay of the RED ran directly with
`TANSTACK_DB_ORACLE_PROPERTY=offline.disposal-handoff`,
`TANSTACK_DB_ORACLE_SEED=20261110`, and
`TANSTACK_DB_ORACLE_PATH=0:1:1:1:1`. Fixed regressions reuse the same model,
production driver and check.

## Repair and code weight

A module-local WeakMap indexes executors with outstanding completion or
restoration ownership by Collection identity. A result reaches matching IDs
among those executors, cleans up each restoration, and releases registration
when that executor has no outstanding ownership. Disposal leaves that ownership
live. Weak keys do not create a global root retaining abandoned Collections.
The existing bounded settled-ID history remains per executor.

The repair merges duplicated success/failure completion logic into one settlement
operation. A subscriber exception during restoration cleanup is collected until
every waiting executor receives its outcome; registration is released despite
that exception. Sharing only by adapter identity would miss new adapter objects;
sharing by ID globally would violate isolation. Disposing with rejection would
violate the selected optimistic lifetime. Those simpler alternatives do not
satisfy the distinguishing histories.

The repository size script ran with `--packages offline-transactions --files
--no-scenarios`. Its combined wildcard exports report zero change because the
web and native entries' overlapping exports omit the changed API from that
aggregate. Supplemental production bundles of each exported entry separately,
with dependencies external, esbuild minification, gzip level 9, and brotli
quality 11, measure the actual cost:

| Entry | Base gzip | Repaired gzip | Delta gzip | Delta brotli |
| --- | ---: | ---: | ---: | ---: |
| web | 9218 | 9473 | +255 | +235 |
| React Native | 9504 | 9756 | +252 | +230 |

The typical app scenarios do not import offline-transactions. The full scenario
build was unavailable because the focused dependency installation lacks Query
Core; no scenario size claim is made. Tests and contract documentation grow
separately from these shipped bytes.

## Oracle guide audit (self-review)

| Requirement | Evidence |
| --- | --- |
| ORC-001 | Named maintainer decision, public settlement contract, explicit boundaries above. |
| ORC-002 | Stateless prefix fold over authored rows and planned outcomes; no production semantic helper. |
| ORC-003 | Opening law and limits; grammar, model, driver, observations and comparison explained beside code. |
| ORC-004 | The fixed default-auto trace reconstructs the report. API path distinguishes wrapper admission, origin distinguishes pending from persisting optimism, replacements change callback ownership, waiter count detects partial transfer, facade defeats adapter identity, outcomes distinguish success from rejection, shared keys exercise rollback composition, deletion failure distinguishes provider return from durable success, and a throwing restoration subscriber distinguishes complete delivery from an exception-aborted fanout. Ranges include the singleton/no-replacement control and three peers/replacements/waiters. A provider result without durable admission and two simultaneously issued executors are excluded from this grammar. |
| ORC-005 | Real startOfflineExecutor, all four APIs, real outbox serialization, public receipts/waiters/rows, controlled provider and deletion gates. The source of completion and the waiting executors have Collection identity and transaction ID by the promised cut; the baseline lacked routing, not provider outcome information. |
| ORC-006 | Five production mutants and three trace calibrations fail at the named law/cut. |
| ORC-007 | Equal fixed/random budgets; captured seed-and-path RED replay runs directly. |
| ORC-008 | Prefix settlement and provider-answer cuts are distinguishable while deletion is held. Live/restored origin is distinguishable when sync writes arrive or a pending peer rolls back. No further production queue state is needed for this ordered grammar. |
| ORC-009 | completed/answered abstractions are declared above; row projection omits virtual attribution, which core owns, but preserves IDs and authored values. |
| ORC-010 | Evidence is copied before cleanup. Bounded waits report missing premises separately. Cleanup releases provider/deletion gates and executors, rolls back remaining live/restored test transactions, cleans Collections, and retains secondary cleanup diagnostics. |
| ORC-011 | No named remaining shared semantic fault needs a second formulation. No-disposal controls, core's separate optimistic-history model, and mutants supply independent neighboring checks. This is a self-review, not an independent audit. |
| ORC-012 | This source record names the exact baseline, changed production file, and evidence boundary. |
| ORC-013 | No-disposal versus replacement; provider-held versus deletion-held versus completed; same ID on unrelated Collections; live versus restored snapshots; shared versus disjoint keys distinguish wrong consequences. |
| ORC-014 | Limited to controlled provider/storage response behavior. No claim that a real provider or native storage engine supplies these premises. |
| ORC-015 | Eleven declared states, measured above, with constructed histories and per-path reach. |
| ORC-016 | Fixed histories and calibrations use the shared law; no ordinary unit tests in the companion. |

All numbered requirements apply except the conditional independent-second-
formulation trigger in ORC-011 and cross-real-provider claim in ORC-014.

## Independent review and C01/O01 enforcement repair, 2026-11-10

The independent production review found C01: sharing any configured Collection
was enough to transfer a transaction outcome. Its ordinary-API witness admitted
one UUID transaction on `oldRows`, disposed that executor, and replayed the same
outbox with `freshRows` plus an unchanged ancillary Collection. The old commit
fulfilled and its optimistic row disappeared. Without ancillary overlap, the old
commit stayed pending and its row stayed optimistic. This contradicted the
README's explicit fresh-Collection boundary. O01 identified the missing grammar
dimension: the earlier isolation witness changed its sole Collection and store
together, so it could not detect partial configuration overlap.

The enforcement repair requires every configured entry of the waiting executor
to retain its registry key and Collection object in the completing executor.
It adds no transaction state and preserves new adapter objects over the same
outbox. The promise is about retaining configured Collections. Changing an
unrelated configured Collection does not gain a stronger handoff guarantee.
Registry keys matter because outbox serialization stores those keys.

The same handoff grammar now varies whether the final replacement retains or
replaces the affected Collection while an unused ancillary Collection survives.
It records original callers and rows separately after replacement. Four fixed
histories reconstruct the ordinary-API finding, and constructed histories
require measured reach for each replaced manual/auto/default/action path.

A separate model correction preserves an existing neighboring law. The first
extended model incorrectly required all old optimistic rows to survive failures
after a fresh Collection replaced the affected object. A generated restored
history disproved that formulation: seed `20261110`, path `12:0:1:2:2:3`, one
fulfilled provider call followed by deletion failure. The old per-ID waiter
stayed pending, but its pending restored snapshot rolled back by conflict.
This was a model failure, not a second production repair.

The authority is independent of that output: the public
[applyMutations contract](../../reference/interfaces/Transaction.md#applymutations)
defines the same item by `globalKey`; the public
[rollback cascade contract](../../guides/error-handling.md#transaction-rollback-cascading)
and core optimistic-history law distinguish pending peers from persisting
transactions. The established `collection.test.ts` witness “releases a settled
transaction from two Collection instances that share an id” explicitly records
shared global keys across those objects. Serialized mutations retain their
global keys. The corrected model therefore permits this pending-snapshot
cascade while keeping old per-ID callers pending; old live persisting
transactions keep their optimistic rows. Fresh-object completion isolation does
not suppress core's conflict law.

### Final evidence block

- **Law:** the original maintainer decision and README identity boundary;
  every waiting executor's configured Collection must remain under the same
  registry key for successor handoff. Ancillary overlap cannot authorize
  completion across a changed affected Collection.
- **Reach:** 120 generated plus seventeen constructed histories per campaign,
  with equal fixed/random run budgets and all seventeen minimums met. The final
  normal package run reported:

  | Declared state | Fixed | Random |
  | --- | ---: | ---: |
  | manual path | 24 | 22 |
  | explicit auto-commit path | 17 | 20 |
  | default auto-commit path | 20 | 16 |
  | action path | 20 | 16 |
  | live starting transactions | 81 | 74 |
  | restored starting transactions | 56 | 63 |
  | successor | 119 | 118 |
  | new adapter object | 103 | 105 |
  | deletion failure | 95 | 100 |
  | shared keys with peers | 51 | 42 |
  | throwing restoration-settlement subscriber | 24 | 27 |
  | retained affected Collection | 76 | 66 |
  | replaced affected Collection | 43 | 52 |
  | replaced manual path | 7 | 10 |
  | replaced explicit auto-commit path | 5 | 12 |
  | replaced default auto-commit path | 8 | 8 |
  | replaced action path | 7 | 6 |

- **RED:** before editing production for C01, the extended normal-config
  handoff selection failed six tests at `completed`, law `scope isolation`:
  fixed/random campaigns and all four fixed API witnesses. Twenty neighboring
  checks passed; the thirteen older interruption tests were outside this
  selection. Fixed campaign seed `20261110`, path `12:0:0:0:1:1:1:1` reduced
  to one live manual transaction, one replacement, and the shared ancillary
  Collection. The old caller fulfilled instead of remaining pending.
- **GREEN:** the final normal package command above passes **423 tests in 24
  files**, including all twenty-seven handoff checks, four calibrations, both
  campaigns, and older interruption coverage. Typecheck, production build,
  touched-source ESLint, `git diff --check`, and the exact node lint-feedback
  script pass. An independent oracle re-review also passes all twenty-seven
  handoff checks and accepts C01/O01 closure within the declared grammar.
- **Mutant:** a test-only Vite transform removes only the configuration
  containment conjunct, restoring the reviewed any-overlap routing. Direct
  seed/path replay `20261110` / `12:0:0:0:1:1:1:1` fails `scope isolation` at
  `completed`, expected `pending`, received `fulfilled`. The identical replay
  passes on repaired production. An initial transform regex mismatch was a
  setup failure with no tests run, not a mutant kill; the corrected transform
  reaches the named comparison.
- **Original defect replay:** a separate test-only transform supplies
  `origin/main`'s `OfflineExecutor.ts` at the recorded baseline. With the final
  grammar, seed `20261110`, path `0:1:1:1:1:1` directly reproduces
  `caller settlement` at `completed`, expected `fulfilled`, received `pending`.
  The baseline selection has nine named failures and eighteen passing checks.
  The earlier shorter replay coordinates remain historical evidence only.
- **Limits:** one transaction-bearing Collection plus an unused ancillary
  Collection, one to three transactions and old waiters, zero to three
  replacements, sequential issued
  provider work, controlled storage/provider, and one runtime/package copy.
  Changes to other configured identities or registry keys and transactions
  affecting several Collections are not generated. The sufficient condition
  remains retention of every configured entry; no claim for partial affected
  retention follows. H01's accepted scope is the maintainer's same-outbox,
  ordinary-UUID handoff decision. Independent manually seeded equal IDs in
  separate outboxes have no established outbox-scoped identity contract and
  receive no claim here; this is an evidence boundary, not a refuted defect.

The final RED, GREEN and mutant use the normal package test configuration.
From `packages/offline-transactions`, the focused command is:

```sh
../../node_modules/.bin/vitest run --config vite.config.ts \
  tests/interruption-settlement-oracle.property.test.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2 \
  -t 'offline.disposal-handoff'
```

For direct replay, set `TANSTACK_DB_ORACLE_PROPERTY=offline.disposal-handoff`,
`TANSTACK_DB_ORACLE_SEED=20261110` and `TANSTACK_DB_ORACLE_PATH` to the relevant
path above. The original-production experiment replaces only that source module
with the recorded baseline; the C01 mutant removes only
`Object.entries(owner.config.collections).every(...)` and its preceding `&&`.
The executed experiments used separate Vite-transform configurations and cache
directories, leaving checkout production unchanged. A preliminary shared-cache
replay did not reproduce the original defect; the separate original-source
configuration above did reproduce the same caller-settlement violation.

The ORC audit above remains applicable with these additions: ORC-004 adds the
retained/fresh affected-Collection dimension and its four reconstructed API
witnesses; ORC-005 observes both Collection scopes at successor completion;
ORC-006 adds the any-overlap mutant and retired-live-row calibration; ORC-008/009
distinguish current callers/rows from callers/rows on the original Collection;
ORC-013 adds the retained-versus-fresh boundary; ORC-015 measures all seventeen
states. ORC-002 remains independent: the model folds authored rows and core's
declared conflict rule, not production routing or completion ownership.


## Gap CLI follow-up, 2026-11-10

This follow-up supersedes the earlier local-readiness checkpoint. Production
remains at SHA-256 `b71e2fdd6a023d791ee4557c49223b7623aa002f8bc0157278ec19e81eb4354b`.
The handoff companion is now
`c9b6cd79b72f567593d2b0c2b6390fe4ddc01277184f36613b4a997e5a0326d8`.

The initial gap run exposed G01, an ownership declaration gap. The interruption
owner drove completion and restoration but declared neither receiving entry.
The CLI therefore mutated `settleTransaction` using only the settlement owner's
tests. Deleting `owners.add(owner)` survived even though the handoff check
rejects that design. Declaring the wait, completion, action and restoration
entries routes their static call trees to the handoff owner. Changed-line
operator kills rose from twenty to thirty-seven of forty-four. No production
or model expectation changed for this repair.

G02 was a missing history dimension: all restored executors had an old waiter.
That waiter masked missing restoration-only ownership. The accepted optimistic
lifetime law does not depend on a caller reading a promise. The grammar now
varies zero to three explicit old waiters and constructs a retained-Collection
replacement history with restored optimism and no old waiter. The comparison
still judges the same public rows and outcomes. Both mutants that remove
restoration registration or restoration membership now fail `optimistic lifetime`.
A third registration-condition mutant also fails with the expanded grammar.

The new grammar retains the original defect: original production fails at
`completed` / `caller settlement`, campaign seed `20261110`, shrink path
`0:1:1:1:1:1`, now with zero explicit old waiters. The original live receipt is
still pending rather than fulfilled. Direct seed-and-path replay shrinks zero
times and reports the same law. These experiments preceded any hypothetical
production repair; this follow-up changes only test coverage and declarations.

The final complete CLI command, from the worktree root, was:

```sh
node_modules/.bin/oracle-gaps --env-prefix TANSTACK_DB_ORACLE \
  --package packages/offline-transactions --source src/OfflineExecutor.ts \
  --diff-base ea3c920c1540486d0fb7410e089baa3a1583299c --seed 20261110 --contexts 2 \
  --out /private/tmp/evaluate-2254-gap-final
```

It tested 295 operator mutants across the source file: 138 law kills, 155 gaps
(including nine production crashes), and two unowned warnings. Within changed
lines, forty of forty-four mutants are law kills and four survive with no
observed difference. Before the repairs, only twenty changed-line mutants were
law kills. The full report retains 151 gaps on unchanged lines; this follow-up
does not assess or refute those gaps. Operator mutation results supplement the
six earlier authored designs; they do not replace them.

Four changed-line gaps remain **confirmed-open**, rather than equivalent or
approved limits:

| Mutant key within `src/OfflineExecutor.ts#OfflineExecutor.settleTransaction` | Missing observation / next witness |
| --- | --- |
| `delete-call:cleanupErrors . push ( cleanupError )` (M229) | The driver provokes a subscriber exception but does not judge error reporting after fanout. Establish the promised public error-reporting cut and observe it through processing. |
| `if-false:if ( cleanupErrors . length > 0 ) throw cleanupErrors [ 0 ]` (M238) | Same reporting gap; settlement and optimistic rows alone do not judge propagated diagnostics. |
| `if-false:if ( owner . pendingTransactionPromises . size === 0 && owner . restorationTransactions . size === 0 ) { ... }` (M231) | Registration release is not measured. Establish a resource-lifetime observation that can distinguish retention through a surviving Collection. |
| `delete-call:completionOwners . get ( collection ) ?. delete ( owner )` (M236) | Same release gap. No garbage-collection or equivalence claim follows from public-row equality. |

The primary owner is the interruption settlement oracle and its handoff
companion. The coverage map records these four gaps. They are not observed
baseline product failures, but the report is not clean and does not establish
whole-PR readiness. No new logging, garbage-collection or partial-retention law
was silently adopted to remove them.

Normal-config validation now passes **424 tests in 24 files**, with typecheck
and touched-source ESLint passing. There are 120 generated plus eighteen
constructed histories in each handoff campaign; all eighteen reach minimums
are met. The normal package run reports:

| Declared state | Fixed | Random |
| --- | ---: | ---: |
| deletion failure | 89 | 103 |
| new adapter | 107 | 107 |
| origin live | 87 | 76 |
| origin restored | 51 | 62 |
| path action | 31 | 21 |
| path auto | 15 | 24 |
| path default | 20 | 15 |
| path manual | 21 | 16 |
| replaced action path | 13 | 7 |
| replaced affected Collection | 49 | 39 |
| replaced auto path | 5 | 7 |
| replaced default path | 10 | 6 |
| replaced manual path | 7 | 5 |
| restored optimism without a waiter | 17 | 20 |
| retained affected Collection | 73 | 82 |
| shared keys | 45 | 44 |
| successor | 122 | 121 |
| throwing settlement subscriber | 25 | 30 |

The earlier ORC audit remains applicable. ORC-004/015 now include zero-waiter
restored ownership and eighteen states. ORC-005 adds correct CLI owner routing;
ORC-006 records two focused restoration mutant kills and forty changed-line
operator kills. ORC-007 retains a verified original-defect direct replay on this
grammar. ORC-012 remains incomplete for the four open observations named above;
no whole-PR readiness claim is made.


## Remaining gap closure, 2026-11-10

This entry resolves G03 and G04 from the preceding four-gap inventory. It
supersedes that inventory's open status, while retaining the original report
and every earlier experiment. Production is unchanged at SHA-256
`b71e2fdd6a023d791ee4557c49223b7623aa002f8bc0157278ec19e81eb4354b`. The handoff companion is
`792c875fe1162d28ed63633fbf391a23118aec1f3b51c43f51962b258787f639`. The parent commit remains
`ea3c920c1540486d0fb7410e089baa3a1583299c`.

**Law and authority.** Public `Transaction.touchCollection()` says that every
tracked Collection recomputes before the first error is thrown. Restored
snapshot settlement invokes that method. Forwarding its exception through the
existing execution batch must preserve delivery of all callers' independently
owed outcomes. The public Collection `deferDataRefresh` promise is the real
execution batch on the connectivity path. The observation records the injected
Error's identity there; it prescribes no console message, sink, or log count.
The README's `dispose()` resource-release promise supplies the second law.
Outstanding callers and snapshots justify retention while pending. After every
outcome and disposal, surviving Collections must not retain the retired
executor's configured resources.

**Oracle changes.** The existing handoff driver now records actual subscriber
throws and whether their Error identity leaves the processing promise. A
conditional comparison rejects a swallowed exception after complete delivery.
The additional `offline.disposal-handoff-resources` campaign shares the same
grammar fields, model, production driver and refinement check. Its generated
language retains Collections, admits one to three transactions, replaces the
executor one to three times, and acknowledges every deletion. It varies the
existing API paths, live/restored origins, shared keys, waiter counts, adapter
facades, provider outcomes and throwing subscribers. The full handoff campaign
still judges failed deletion and fresh-Collection isolation.

The resource observer supplies a unique detector subclass only to the first
executor through public configuration. Node/V8 `queryObjects` performs full
GC, counting one held instance before disposal and zero after all outcomes.
The driver returns before the final observation, clears its test-owned executor
and detector arrays, and retains active Collection objects until after the
heap observation. No completion registry is inspected and no GC deadline is
asserted. This is a real Node/V8 receiving witness, not a claim about browser
GC or absence of every possible retained object.

**Reach.** The ordinary fixed-seed handoff campaign still enters all eighteen
required states; its throwing-subscriber state is entered 25 times. The heap
campaign has twelve generated plus seven constructed histories in each
campaign. Fixed-seed required counts are: manual 4, auto 1, default 2, action 3,
live origin 10, restored origin 9, and settled retained Collections 19. Every
resource history compares both its held and released heap observations.

**RED and mutant.** The preceding complete CLI run accepted all four operators.
With these new observations, the focused command below rejects every one on a
fixed-seed route. These are law verdicts, not crashes, setup errors or timeouts.
No production repair was required.

```sh
node_modules/.bin/oracle-gaps --env-prefix TANSTACK_DB_ORACLE \
  --package packages/offline-transactions --source src/OfflineExecutor.ts \
  --diff-base ea3c920c1540486d0fb7410e089baa3a1583299c --seed 20261110 --contexts 2 \
  --only OfflineExecutor.ts:M229,OfflineExecutor.ts:M231,OfflineExecutor.ts:M236,OfflineExecutor.ts:M238 \
  --out /private/tmp/evaluate-2254-gap-four
```

| Mutant | Stable key suffix in `OfflineExecutor.settleTransaction` | Rejecting property and law |
| --- | --- | --- |
| M229 | `delete-call:cleanupErrors . push ( cleanupError )` | `offline.disposal-handoff`, subscriber error propagation |
| M238 | `if-false:if ( cleanupErrors . length > 0 ) throw cleanupErrors [ 0 ]` | same |
| M231 | `if-false:if ( owner . pendingTransactionPromises . size === 0 && owner . restorationTransactions . size === 0 ) { ... }` | `offline.disposal-handoff-resources`, resource release |
| M236 | `delete-call:completionOwners . get ( collection ) ?. delete ( owner )` | same |

**GREEN.** Both unmutated CLI passes succeeded, with no nondeterministic tests.
Typecheck and touched-source ESLint passed. Both new comparison dimensions also
have checker calibrations: discard an observed subscriber exception, or retain
a detector after every outcome. A fresh independent oracle review found no
confirmed blocker and specifically checked source authority, model independence,
resource-observer sensitivity, grammar scope and cleanup. Final changed-line
CLI and normal package verification are recorded in the next entry.

**Limits and audit.** The heap observation concerns the first retired executor's
configured detector in Node/V8; it does not count every possible resource or
require release before unfinished work settles. Controlled storage/provider
limits and the existing sequential-runtime handoff boundary remain unchanged.
The earlier full-source run's 151 gaps on unchanged lines remain unassessed.
Closing these four survivors does not establish a clean full-source gap report.
ORC-001/003/005 add the two authorities and their observation cuts; ORC-002
continues to derive outcomes independently and uses no registry state;
ORC-004 adds a constructive retained/fully settled subgrammar (fresh Collections
and unfinished deletion prefixes remain in the broader campaign); ORC-006 adds
two calibrations and four mutant kills; ORC-007 keeps fixed/random parity and
the registry's direct seed/path interface; ORC-008/009 adds only observed error
propagation and a configured-resource reachability measurement, not a second
production state machine; ORC-010 releases fixture-owned references before GC
and cleans Collections afterward; ORC-011 has no named shared-semantic fault
requiring a second judgment; ORC-013 distinguishes retained-before-outcome from
released-after-all-outcomes and throwing from nonthrowing subscribers;
ORC-014 uses actual Node/V8 collection with no browser claim; ORC-015 declares
all seven required resource states; ORC-016 keeps calibration and all fixed or
constructed histories on the shared judgment. The numbered review record
fulfills ORC-012 for this extension.


### Final changed-line verification

The final changed-line CLI rerun (run `9ce87afd8086`) rejects **44 of 44**
operator mutants with law verdicts on reproducible routes. There are zero
crashes and zero gaps in that explicitly selected set. This is a partial
source run: it includes every mutant whose `inDiff` field was true in the
preceding full-source report, while production's hash and origin/main base
remain unchanged. No unassessed unchanged-line result is promoted to closed.

```sh
node_modules/.bin/oracle-gaps --env-prefix TANSTACK_DB_ORACLE \
  --package packages/offline-transactions --source src/OfflineExecutor.ts \
  --diff-base ea3c920c1540486d0fb7410e089baa3a1583299c --seed 20261110 --contexts 2 \
  --only OfflineExecutor.ts:M197,OfflineExecutor.ts:M198,OfflineExecutor.ts:M199,OfflineExecutor.ts:M200,OfflineExecutor.ts:M201,OfflineExecutor.ts:M202,OfflineExecutor.ts:M203,OfflineExecutor.ts:M204,OfflineExecutor.ts:M205,OfflineExecutor.ts:M206,OfflineExecutor.ts:M207,OfflineExecutor.ts:M208,OfflineExecutor.ts:M209,OfflineExecutor.ts:M210,OfflineExecutor.ts:M211,OfflineExecutor.ts:M212,OfflineExecutor.ts:M213,OfflineExecutor.ts:M214,OfflineExecutor.ts:M215,OfflineExecutor.ts:M216,OfflineExecutor.ts:M217,OfflineExecutor.ts:M218,OfflineExecutor.ts:M219,OfflineExecutor.ts:M220,OfflineExecutor.ts:M221,OfflineExecutor.ts:M222,OfflineExecutor.ts:M223,OfflineExecutor.ts:M224,OfflineExecutor.ts:M225,OfflineExecutor.ts:M226,OfflineExecutor.ts:M227,OfflineExecutor.ts:M228,OfflineExecutor.ts:M229,OfflineExecutor.ts:M230,OfflineExecutor.ts:M231,OfflineExecutor.ts:M232,OfflineExecutor.ts:M233,OfflineExecutor.ts:M234,OfflineExecutor.ts:M235,OfflineExecutor.ts:M236,OfflineExecutor.ts:M237,OfflineExecutor.ts:M238,OfflineExecutor.ts:M239,OfflineExecutor.ts:M241 \
  --out /private/tmp/evaluate-2254-gap-changed
```

Normal package verification passes **429 tests in 24 files** with two workers.
All eighteen handoff reach requirements and all seven heap-campaign reach
requirements pass in both ordinary campaigns. Resource reach is:

| Required state | Fixed | Random |
| --- | ---: | ---: |
| path manual | 4 | 1 |
| path auto | 1 | 6 |
| path default | 2 | 3 |
| path action | 3 | 3 |
| origin live | 10 | 13 |
| origin restored | 9 | 6 |
| settled retained Collections | 19 | 19 |

The broader handoff campaign observes throwing settlement subscribers 25 times
in the fixed campaign and 32 times in the random campaign. The original
production replay still fails `completed` / `caller settlement`, with a pending
original live receipt instead of fulfillment. It replays campaign seed
`20261110`, shrink path `0:1:1:1:1:1`, shrinking zero times. Thus the new resource
and diagnostic observations do not erase the original defect's witness.

Validation commands:

```sh
# From packages/offline-transactions
../../node_modules/.bin/vitest run --config vite.config.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
# From the worktree root
node_modules/.bin/tsc --noEmit --project packages/offline-transactions/tsconfig.test.json
pnpm_config_verify_deps_before_run=false pnpm lint:changed
git diff --check
```

G03 and G04 are `fixed-now`: both were enforcement gaps, both now reject the
wrong designs, and neither required changing production or choosing a new
logging/GC policy. The lossless scratch ledger retains all 295 operators and
each earlier result: 138 previously rejected by law, four newly fixed, and
153 outside-this-diff/untriaged entries (151 gaps and two unowned warnings).
This is closure of the four changed-code survivors. The existing unassessed
full-source findings remain explicit; no clean full-source or universal
resource-release claim follows. Changes remain uncommitted pending the earlier
prep-pr confirmation.


## Full-source gap ownership

Verified implementation commit: `bcb55a9e7689421d18af460d6ac8606fe11fc0d5`.
The following release/evidence commit adds no implementation or oracle change.

This entry supersedes every earlier statement that 151 unchanged-line findings
remain unassessed. The maintainer required ownership of those findings, and the
full source was evaluated without an age-based exclusion. No production change
was made during this expansion. The original handoff repair remains the only
shipped behavior change.

Final gap CLI run `1c2a9145625b` uses the same production SHA-256
as the C01/O01 repair. It tests all 295 operators, with eight receiving oracle
files, 17 ordinary test files, campaign seed `20261110`, and two contexts:

```sh
node_modules/.bin/oracle-gaps --env-prefix TANSTACK_DB_ORACLE \
  --package packages/offline-transactions --source src/OfflineExecutor.ts \
  --diff-base ea3c920c1540486d0fb7410e089baa3a1583299c --seed 20261110 --contexts 2 \
  --out /private/tmp/evaluate-2254-gap-owned-final
```

**Results:** 275 named-law kills, zero production crashes, zero timeouts,
15 survivors, and five unreached operators. All 44 changed-line operators fail
named laws. The raw CLI therefore retains 20 gap labels. Each has an explicit
source/authority disposition below; the result is not a zero-gap tool score.
The scratch lossless ledger preserves all 295 operators and each prior outcome:
138 already covered, 137 enforcement gaps fixed now, and 20 proposed obligations
refuted under the existing contract. Nothing remains untriaged or deferred.

### Residual operators and their actual distinctions

| Operators | Judgment and evidence |
| --- | --- |
| M43 | Required factory field `storage: null` becomes undefined. Both select the same no-storage path, and the private field is never read afterward. The declared TypeScript return shape rejects the missing field. |
| M62, M63 | The internal fallback's `isLeader` method is never called or exposed. Admission uses `requestLeadership`. Removing the required interface member is also type-invalid. |
| M65 | Listener setup has one call after nonnull election construction and a successful request. No legal call reaches a null election. |
| M72 | Loss clears the retry timer, and follower execution cannot arm one. The additional pause on actual gain has no timer to cancel. Duplicate reports return earlier. |
| M131 | The private replay operation is called only after executor installation. No public operation clears that executor. |
| M148 | Optional boolean values agree. For undefined, core supplies the same auto-commit default. Null is outside the optional-boolean input contract. |
| M242 | The private rollback default is unused: its sole caller always supplies an explicit boolean. |
| M82, M95, M101, M127, M135, M184 | These specific setup, batch, or storage diagnostics have no promised delivery/count/wording. Console observers can distinguish them. Public rejection and documented named-mutation logging obligations remain checked. |
| M88, M90 | Idle reconnect can briefly install an empty-batch promise. The barrier contract protects pending work, without promising immediate null identity during an idle notification. |
| M100 | Empty-scheduler execution has no normal provider or caller work. A previously fatal executor can add an unpromised warning, so this is not globally equivalent. |
| M129 | Startup raw-string normalization is unspecified. Rejection and injected Error identity stay checked. No exact startup message requirement is added. |
| M123 | An added follower read can reject initialization when that read fails. This is observable, not equivalent. The guide permits rejection for an initial read failure and promises the leader's restoration, without a no-follower-read guarantee. |
| M266 | The paired-null invariant holds for ordinary configuration values. A throwing `jitter` getter can interrupt construction after outbox installation. The mutant can then clear storage and reject, instead of returning. This disproves global equivalence. No public-control policy after malformed configuration aborts initialization is established or added. |

Eight operators have typed-domain/call-path equivalence arguments. Twelve
change observations without violating an established stronger promise. The
last two concrete differences remain available for future law design. They are
not hidden by a generic equivalence label or promoted into new product rules.

### Added enforcement and receiving paths

The interruption owner imports generated API/control, settled-ID horizon, and
coordination/barrier companions. Environment selection and bounded startup
observations have a separate receiving unit, so another owner's waiting test
cannot erase an initialization-completion verdict. New generated dimensions
cover default/custom storage and election, diagnostic shape and error provenance,
late initialization readers, leader/follower API options, all four creation
paths, empty/queued/running controls, fatal admission refusal, the 1,000-ID
horizon, duplicate/stale events, optional cleanup, and overlapping barriers.

The existing issue also names registry growth as its trigger. The handoff
grammar now adds Collections during sequential replacements while retaining
every original registry key/object. An exact-registry-size mutant fails
`caller settlement` on this path. Original production still fails the final
grammar at `completed` / `caller settlement`, campaign seed `20261110`, shrink
path `0:1:1:1:1:1`, without further shrinking.

The real QueryClient/QueryDB production driver supplies stale refetches during
restored durable replay to the same barrier model and comparison. It observes
pending/refreshed public receipts, fresh rows, actual stale backend delivery,
and actual deferred subscription. M98 and M99 both fail `query refresh
settlement`; exact null identity is not the law. Local persisting transactions
have an existing fetch-settlement escape hatch, which this oracle preserves.
This Node/jsdom witness uses installed Query Core 5.90.20, inside the declared
peer range, because the configured development version 5.107.1 was unavailable.
It does not claim execution against 5.107.1, native browser events, or remote
storage durability. No dependency manifest or lockfile change is included.

Independent authority review removed four unsupported newly added constraints:
action variables as extra provider fields, exact-null completed barriers,
startup string normalization, and recent-ID rejection wording. Error identity,
action `onMutate` input, blocking behavior, actual receiving receipt settlement,
and rejection itself remain checked. These corrections retire no previously
accepted product law. Independent final source review found no supported new
oracle defect and explicitly challenged M123/M266's equivalence claims.

### Final verification and reach

Normal package verification passes **462 tests in 25 files**, with two workers.
All declared states reach their enforced minimum in both normal campaigns.
The following counts come from that normal run, not the mutation tool's
reseeded campaigns. Each row below contains every measured state for its
property and campaign.

- `offline.disposal-handoff`, fixed seed 20261110: `{"deletion failure":95,"grown registry":61,"new adapter":105,"origin live":83,"origin restored":56,"path action":25,"path auto":13,"path default":24,"path manual":21,"replaced action path":7,"replaced affected Collection":46,"replaced auto path":6,"replaced default path":15,"replaced manual path":6,"restored optimism without a waiter":19,"retained affected Collection":74,"shared keys":43,"successor":120,"throwing settlement subscriber":25}`.
- `offline.disposal-handoff`, random seed: `{"deletion failure":103,"grown registry":56,"new adapter":108,"origin live":80,"origin restored":59,"path action":18,"path auto":20,"path default":22,"path manual":20,"replaced action path":6,"replaced affected Collection":39,"replaced auto path":5,"replaced default path":7,"replaced manual path":8,"restored optimism without a waiter":20,"retained affected Collection":85,"shared keys":34,"successor":124,"throwing settlement subscriber":33}`.
- `offline.executor-environment`, fixed seed 20261110: `{"built-in storage probe":66,"coordination broadcast":3,"coordination custom":36,"coordination fallback":4,"coordination locks":4,"disposal during leadership":17,"disposal during storage":15,"follower":10,"initial leadership callback":37,"initialization rejection":17,"leadership failure without leadership":10,"localstorage fallback error":4,"offline without callback":10,"online-only without callback":6,"probe failure without leadership":3,"startup failure without init reader":10,"storage blocked indexeddb":3,"storage blocked localstorage":5,"storage custom":33,"storage failure callback":24,"storage indexeddb":8,"storage localstorage":6,"storage none":30,"storage quota indexeddb":4,"storage quota localstorage":4,"storage unavailable no reason":10,"storage unknown":4}`.
- `offline.executor-environment`, random seed: `{"built-in storage probe":59,"coordination broadcast":5,"coordination custom":39,"coordination fallback":4,"coordination locks":1,"disposal during leadership":9,"disposal during storage":17,"follower":6,"initial leadership callback":39,"initialization rejection":23,"leadership failure without leadership":11,"localstorage fallback error":4,"offline without callback":10,"online-only without callback":4,"probe failure without leadership":2,"startup failure without init reader":14,"storage blocked indexeddb":2,"storage blocked localstorage":3,"storage custom":30,"storage failure callback":24,"storage indexeddb":12,"storage localstorage":7,"storage none":28,"storage quota indexeddb":3,"storage quota localstorage":3,"storage unavailable no reason":14,"storage unknown":3}`.
- `offline.disposal-handoff-resources`, fixed seed 20261110: `{"grown registry":6,"new adapter":11,"origin live":10,"origin restored":9,"path action":3,"path auto":1,"path default":2,"path manual":4,"restored optimism without a waiter":3,"retained affected Collection":19,"settled retained Collections":19,"shared keys":3,"successor":19,"throwing settlement subscriber":4}`.
- `offline.disposal-handoff-resources`, random seed: `{"grown registry":11,"new adapter":8,"origin live":15,"origin restored":4,"path action":4,"path auto":1,"path default":6,"path manual":4,"restored optimism without a waiter":0,"retained affected Collection":19,"settled retained Collections":19,"shared keys":6,"successor":19,"throwing settlement subscriber":1}`.
- `offline.settled-id-window`, fixed seed 20261110: `{"at horizon":5,"below horizon":8,"beyond horizon":6,"path action":3,"path auto":4,"path default":4,"path manual":8}`.
- `offline.settled-id-window`, random seed: `{"at horizon":7,"below horizon":4,"beyond horizon":8,"path action":6,"path auto":4,"path default":7,"path manual":2}`.
- `offline.executor-api`, fixed seed 20261110: `{"action":6,"auto":9,"custom key":25,"default":18,"follower":19,"follower action":2,"follower auto":4,"follower default":10,"follower manual":3,"generated key":13,"leader":19,"leader action":4,"leader auto":5,"leader default":8,"leader manual":2,"manual":5,"metadata":27,"unknown action":3,"unknown transaction":10}`.
- `offline.executor-api`, random seed: `{"action":6,"auto":9,"custom key":24,"default":12,"follower":17,"follower action":2,"follower auto":5,"follower default":6,"follower manual":4,"generated key":10,"leader":17,"leader action":4,"leader auto":4,"leader default":6,"leader manual":3,"manual":7,"metadata":25,"unknown action":5,"unknown transaction":12}`.
- `offline.executor-controls`, fixed seed 20261110: `{"clear":11,"empty before initialization":30,"fatal second admission":7,"held provider":6,"queued provider":23,"remove":12}`.
- `offline.executor-controls`, random seed: `{"clear":15,"empty before initialization":30,"fatal second admission":7,"held provider":10,"queued provider":23,"remove":8}`.
- `offline.executor-coordination-lifecycle`, fixed seed 20261110: `{"callback absent":14,"callback present":31,"dispose constructor":9,"dispose election":9,"dispose ready":27,"duplicate report":25,"leader cleanup absent":8,"leader cleanup present":37,"stale report":27}`.
- `offline.executor-coordination-lifecycle`, random seed: `{"callback absent":12,"callback present":33,"dispose constructor":10,"dispose election":12,"dispose ready":23,"duplicate report":23,"leader cleanup absent":14,"leader cleanup present":31,"stale report":23}`.
- `offline.executor-connectivity-query-db`, fixed seed 20261110: `{"pending refresh barrier":16,"query deferred by barrier":16,"query refresh settled":16,"stale refetch delivered":16}`.
- `offline.executor-connectivity-query-db`, random seed: `{"pending refresh barrier":16,"query deferred by barrier":16,"query refresh settled":16,"stale refetch delivered":16}`.
- `offline.executor-connectivity-barrier`, fixed seed 20261110: `{"idle reconnect":9,"older completion over newer barrier":5,"own barrier released":17,"pending refresh barrier":26,"retired callback":9}`.
- `offline.executor-connectivity-barrier`, random seed: `{"idle reconnect":7,"older completion over newer barrier":5,"own barrier released":17,"pending refresh barrier":28,"retired callback":11}`.

The normal typecheck, production build, explicit ESLint/Prettier checks,
`pnpm lint:changed`, and diff whitespace checks pass. No oracle run budget was lowered
or removed. The prior ORC-001–016 handoff audit still applies. The added owners
state their laws and authorities beside independent projections (ORC-001–003),
provide generated and constructed boundary histories with bounded domains and
explicit invalid exclusions (004, 008, 009, 013, 015), drive public APIs and the
real QueryDB receiver (005, 014), and run common-comparison calibrations plus
fixed/random campaigns and direct replay (006, 007, 016). Their cleanup preserves
public failure observations (010). No new shared-fault hypothesis requiring an
independent second model was identified (011). This exact-source record supplies
the requirement accounting and finite closure boundary (012).

Final source hashes for the reviewed implementation and new executable owners:

- `packages/offline-transactions/src/OfflineExecutor.ts`: `b71e2fdd6a023d791ee4557c49223b7623aa002f8bc0157278ec19e81eb4354b`.
- `packages/offline-transactions/tests/interruption-handoff-oracle.ts`: `a0560c3b74f8988d26c7c251048ef4aa945c68d6f62e0fc15cf5f0b252c73b4f`.
- `packages/offline-transactions/tests/executor-api-oracle.ts`: `f79bd3b3e3e5b57dfc30ca50f8e008a0eecae042e23e6eebb7137058407f8d09`.
- `packages/offline-transactions/tests/executor-environment-oracle.ts`: `b94c9a6734e2e510adc2dae7add3049da0f5d9cae861f7f96bdc2a562da7b986`.
- `packages/offline-transactions/tests/executor-environment-oracle.property.test.ts`: `9c16434c7e7a0e05c8c51bd625ca00209e7e5f15112b4352d04537690b963016`.
- `packages/offline-transactions/tests/executor-lifecycle-oracle.ts`: `863a2639a7b4f2a221c3580dd040ba91c74dad718cf7f7e9db28c61a70483d85`.
- `packages/offline-transactions/tests/settled-id-window-oracle.ts`: `41d958ec333349f41d77a34cc953a578479f70caac8089ddcae232c089574e99`.
- `packages/query-db-collection/tests/offline-executor-refresh-driver.ts`: `b26a314dfa8741e0e1e9ef48b4a2cfac4b63277a1b00c07d2ed71037d099ba56`.

## Replay manifest repair

CI on `c9b569f7578e969639f1c5d1d9ac4f7e050d9751` rejected the nine newly
registered properties because their receiving files were absent from the shared
replay manifest. The existing `named oracle replay manifest` comparison failed
`names an owner for every registered property` with those nine names (115 other
replay tests passed). This was an omitted registration, not an offline product
failure or a reason to relax the comparison.

The repair adds each receiving file and its directly imported property module
to `packages/db/tests/oracle-replay-manifest.ts`. All 69 manifest tests pass with
the unchanged comparison. Each of the nine new properties also passes its real
guarded command with campaign seed `20261110` and path `0`; each reports exactly
one execution and a completed, non-failing witness for the requested property.
This includes the resource and real QueryDB receiving paths. The offline source,
models, history grammars, comparisons, and run budgets are unchanged, so the
full-source mutation results above remain applicable.

The local manifest-only run used a scratch Vitest config without the unrelated
IndexedDB setup because this worktree lacks the installed `fake-indexeddb`
package. The guarded property runs used their normal package config. Full replay
suite validation remains a CI gate; the local setup failure is not a test pass.

## CodeRabbit follow-up: issued outcomes and barrier observations

Review `5846173360` covered `c9b569f7578e969639f1c5d1d9ac4f7e050d9751`.
Evaluation started on `4bc9978e787a10cf7ed95e7921edd2eb56139425`. That intervening
commit changed only replay registration and evidence. All four inline findings
remain applicable; the raw review and mutable summary are preserved locally.

CR01 corrects the focused command to `vite.config.ts`, as used by the recorded
package verification. `vitest.config.ts` is a distinct configuration that loads
browser/UUID fixtures. Guarded replay also passes under that default configuration;
these executions are distinguished rather than treated as identical environments.
CR02 pins every documented gap command to baseline
`ea3c920c1540486d0fb7410e089baa3a1583299c`. The historical runs used `origin/main`
when it named that exact commit; the displayed commands now reproduce that
baseline even after fetching. No historical result was rerun or reclassified
merely by changing the displayed revision.

CR03 is an enforcement gap in the same handoff contract: an issued predecessor
can finish after disposal while its successor waits for leadership. A successor
with added Collections registered a per-ID waiter but did not receive that old
executor's outcome. Only one executor issues provider work, so this case does
not require concurrent-leader semantics. The previous grammar always completed
work on the final successor and could not expose the reversed delivery direction.

- **Law:** Every pending caller in the retained-Collection handoff receives the
  transaction outcome, including a successor waiting for leadership. Authority:
  README Tracking Submission Status and decision
  `offline-disposal-handoff-2026-11-10`.
- **Reach:** `offline.disposal-issued-handoff` reuses the handoff model and
  comparison. It generates one transaction, all four creation APIs, live/restored
  optimism, either provider outcome, zero to three explicit old waiters, one to
  three replacements, adapter-object replacement, and registry growth. Each
  campaign has 24 generated plus eleven constructed histories. The initial
  nine-state run reached both issued boundaries 33 times per campaign; final
  eleven-state counts, including deletion and subscriber failures, follow below.
- **RED:** Before production changed, the new normal-config campaigns failed
  `caller settlement` at `completed`. Fixed campaign seed `20261110`, path
  `3:0:0:0:0:0` shrank to a live manual transaction, one replacement, no explicit
  old waiter, and an added Collection. The successor was pending instead of
  fulfilled. The neighboring handoff/resource and connectivity selections passed
  **43 tests**, including both real QueryDB campaigns, before production changed.
- **GREEN:** Matching permits either registry to retain all entries of the
  other. This lets a retired executor deliver to a growing successor as well as
  a successor deliver to its predecessor. The new property passes both campaigns;
  its guarded seed/path replay records one execution and a completed witness.
  The full offline package passes **466 tests in 25 files**.
- **Mutant:** Restoring only the old directional compatibility check fails
  `caller settlement` at `completed` with that same seed/path. The existing
  retained/fresh affected-Collection histories continue to enforce scope
  isolation; an ancillary overlap alone remains insufficient.
- **Limits:** The added crossing has one issued transaction and retained affected
  Collections. It includes failed deletion and throwing settlement subscribers.
  Existing campaigns own queued suffixes and fresh-Collection isolation. The new crossing
  does not claim multiple simultaneous issued executors or cross-tab promises.

CR04 was a false-green observation, not a new product policy. The real QueryDB
production driver used one settlement flag for every barrier, and did not attach
its first recorder until after `provider held`. A test-only transform temporarily
installed `Promise.resolve()` at that capture and restored the actual held
barrier afterward. The unchanged recorder accepted the whole direct replay
(seed `20261110`, path `0`). That establishes a wrong intermediate checkpoint
that the public QueryDB receipt's later comparison did not catch.

The repaired recorder samples each promise with its own outcome object, drains its
settlement reaction chain, and retries if the public field changes identity. The
same injected observation now fails `refresh barrier` at `provider held`.
Normal real QueryDB campaigns remain green, with all four declared states reached
16 times per campaign. Seven supplemental tests in the ordinary
`offline-executor-refresh-observer.test.ts` exercise absence, pending, fulfillment,
rejection, replacement by a pending promise, and removal during a reaction.
A chained-settlement witness first rejected a one-microtask sampler; the final
recorder yields a task turn before checking identity and settlement.
They do not replace the shared generated comparison or its real receiving path.

The summary's docstring suggestion (CR05) reports an external default 80% rule;
the repository has no such numeric policy. The applicable requirement is literate
oracle prose, already present beside the model, grammar, driver and comparison.
The suggested mandatory percentage is refuted as a repository violation; useful
function explanations are retained, including the new containment and promise
observer helpers. The generic unit-test generation suggestion (CR06) adds no
behavioral finding; the seven targeted observer checks preserve its useful testing
idea without placing unit tests in an oracle. The independent simplification
follow-up (S01) moves resource-campaign prose back beside its grammar; it changes
no executable rule.

All four concrete CodeRabbit findings are fixed. The reviewer found a real
missing delivery direction and a recorder defect that later snapshots hid; its
suggested small repairs were useful. Hire recommendation: yes, with independent
oracle verification of the proposed fixes. The automatic numeric docstring gate
has no repository authority. Loss accounting: four fixed concrete findings,
one refuted mandatory-policy claim, and one generic testing suggestion preserved
in the targeted observer tests. No design decision or authorized repair from this first review is
deferred. The applicable ORC audit above remains in force: this addition reuses
independent judgment (ORC-002), adds the missing history crossing (ORC-004), observes
its intermediate outcome with a named violation and actual reach (ORC-005/015),
and rejects both the old implementation and a false-green recorder
(ORC-006/010). No contract, comparison or run budget was narrowed.


### Final issued-handoff reach and independent follow-up

The final `offline.disposal-issued-handoff` campaign includes failed deletion
and a throwing restored-settlement subscriber. The fixed and random campaigns
use the same 24 generated plus eleven constructed histories, model, production
driver, comparison, and run budget. The final selected run passes four tests
(two campaigns, calibration, determinism); 73 unrelated tests stand aside.
All declared states and additional measured states are reported here:

- offline.disposal-issued-handoff fixed seed 20261110: `{"deletion failure":20,"grown registry":20,"issued deletion failure":20,"issued subscriber exception":9,"new adapter":17,"origin live":20,"origin restored":15,"path action":8,"path auto":3,"path default":3,"path manual":6,"restored optimism without a waiter":2,"retained affected Collection":35,"retired provider issued":35,"successor":35,"successor awaiting leadership":35,"throwing settlement subscriber":9}`.
- offline.disposal-issued-handoff random seed: `{"deletion failure":20,"grown registry":19,"issued deletion failure":20,"issued subscriber exception":6,"new adapter":19,"origin live":25,"origin restored":10,"path action":9,"path auto":7,"path default":5,"path manual":4,"restored optimism without a waiter":2,"retained affected Collection":35,"retired provider issued":35,"successor":35,"successor awaiting leadership":35,"throwing settlement subscriber":6}`.

The independent follow-up found two useful extensions. D01 showed that yielding
one microtask could misread a promise that settled through a reaction chain.
The ordinary observer test first failed, then passed when the recorder yielded
one task turn. All seven observer tests pass. D02 requested deletion failure and
subscriber exceptions while the retired provider finishes before successor
leadership. Both now occur in the generated grammar and pass the common check.
The one-direction mutant still fails `caller settlement` at `completed` with
the expanded grammar. These repairs preserve the existing laws and their cuts.

Final source SHA-256 values for this follow-up:

- `packages/offline-transactions/src/OfflineExecutor.ts`: `dff0f5fd93b50da54451cc6570fe010f43bd6962eda209336667b55dd2f05da9`.
- `packages/offline-transactions/tests/interruption-handoff-oracle.ts`: `b0be84ce61f9d737f70f8e28601a2bbf8ac65c213597a4eea84e8adc06c0be23`.
- `packages/query-db-collection/tests/offline-executor-refresh-driver.ts`: `7bd232c635cd507a9984780df10fa148d61adcafa8a4d1ab8761ac9b22a080ee`.

### Copied-outbox decision

CodeRabbit review `5846348062`, on
`4bc9978e787a10cf7ed95e7921edd2eb56139425`, raised CR07 outside the inline diff.
A controlled probe admitted a UUID transaction into outbox A, disposed its
executor, copied the pending row into independent outbox B, and replayed B with
the same transaction ID and Collection objects. The original caller fulfilled;
A retained its row and B became empty. This is an observed cross-settlement,
not an equivalence or isolation claim. The API supplies no durable outbox
identity with which to distinguish those stores from replacement adapter
objects over one store.

Decision record `offline-copied-outbox-limit-2026-11-10`: the maintainer chose
“Keep copying/migration outside this PR.” The promised receiving path remains
executor replacement over the same retained outbox. Independent copied stores,
migration lineage, and an isolation guarantee between them are an accepted
limit of this change. The README states the consequence explicitly. No
persisted-format or public-API change introduces an outbox identity here.
The Offline execution oracle owner retains this limit. A future migration or
copied-store isolation contract must define identity and add generated
same-store/copy histories before changing production. CR07 is accepted-design
for this scope; its reproduced behavior remains recorded.


### Follow-up loss audit

The raw first and second CodeRabbit reviews, their inline comments, mutable
summary, and independent follow-up are reconciled in the local lossless ledger.
Nine raw review items comprise five fixed items (CR01–04 and CR06), one refuted
mandatory docstring-percentage claim (CR05), the accepted copied-outbox limit
(CR07), and two preserved duplicates (CR08–09). Three independent suggestions
(S01, D01, D02) are fixed. Total: twelve items = eight fixed + one refuted + one
accepted-design + two duplicates. The initial pending dispositions and complete
original claims remain in history. No raw item or sibling finding disappears
because it was minor, duplicated, or outside the inline diff. All four displayed
gap commands now pin the baseline. No product-law decision remains pending.


### CI lint-scope reach repair

CI on `4bc9978e787a10cf7ed95e7921edd2eb56139425` failed its Lint job because
`scripts.lint-scope` reached `hook-production` only once, below its declared
minimum of two. The two property tests passed their behavior comparisons;
the suite's reach assertion correctly rejected insufficient enforcement.
The exact CI random seed `1392514884` reproduces the failure locally with the
unchanged grammar. This is a grammar gap in lint selection coverage, not an
offline product failure.

The repair adds one constructed history per campaign. It draws a skeleton from
the campaign seed and fixes its shape to `free` and hook kind to `production`,
so another shape cannot replace the hook target. The same independent graph
model, real temporary-repository driver, and scope comparisons judge it.
This guarantees at least one production-hook history in each of the two
campaigns. The random run budget stays 24, all earlier constructions remain,
and the reach minimum stays two. The original grammar is the removal mutant:
with that construction absent, the same seed reports `hook-production (1)`.
With it present, the exact command passes both tests and the reach assertion.

```sh
TANSTACK_DB_ORACLE_SEED=1392514884 TANSTACK_DB_ORACLE_REACH_REPORT=1 \
pnpm_config_verify_deps_before_run=false pnpm exec vitest run \
  --config scripts/oracle-scripts.vitest.config.mjs \
  scripts/lint-scope-oracle.property.test.js --maxWorkers=2
```

This changes no lint-selection law, production script, model, public observation,
or excluded history. The normal fixed/random campaign's complete reach counts
are retained below. Existing conformance obligations remain: the construction
uses the shared judgment (ORC-002/016), stays in the legal grammar with fresh
skeletons (004), exercises the real CLI (005), and makes reach mandatory (015).
No provider or framework receiving claim is added (014), and no new reference
state or shared-fault hypothesis triggers ORC-008/011.

Normal verification uses fixed campaign seed `2234` and random campaign seed
`1147628925`. Both property tests and the mandatory reach assertion pass.
Aggregate counts across the two campaigns (24 generated + nine constructed
histories in each) are:

`{"direct-dependent":51,"transitive-dependent":45,"re-export-dependent":2,"oracle-dependent":9,"oracle-edit":35,"unrelated-edit":27,"production-boundary":18,"plugin-version-edit":3,"plugin-integrity-edit":8,"plugin-dependency-edit":7,"lockfile-edit":11,"settings-edit":7,"hook-lockfile-same-plugin":3,"large-lockfile-same-plugin":4,"missing-base-lockfile":27,"untracked-dependent":22,"js-oracle":30,"hook-oracle":7,"hook-support":25,"hook-driver":11,"hook-production":4,"hook-rule":19,"worktree-session":35,"worktree-own-rule":8,"scratch-directory":11}`.


## Final reviewed-source audit

Run `fd3da244acf0` repeats the complete source campaign after the issued-outcome
repair and barrier-recorder correction. It uses the final offline source hash
`dff0f5fd93b50da54451cc6570fe010f43bd6962eda209336667b55dd2f05da9`
and the final handoff/receiving hashes above. The production source and those
oracles did not change during this run. The earlier interrupted campaign is
excluded: it was stopped and its temporary files removed before these stable
measurements. Normal package tests and independent mutant transforms did not
run beside this final campaign.

```sh
node_modules/.bin/oracle-gaps --env-prefix TANSTACK_DB_ORACLE \
  --package packages/offline-transactions --source src/OfflineExecutor.ts \
  --diff-base ea3c920c1540486d0fb7410e089baa3a1583299c \
  --seed 20261110 --contexts 2 \
  --out /private/tmp/evaluate-2254-gap-reviewed-stable
```

The final inventory has **298 operators: 278 killed, 15 survived, and five
unreached**. All **47 changed-line operators** are killed. There are zero
production crashes, timeouts, exclusions, or nondeterministic routes. The raw
tool report therefore still has **20 gap labels**; this is not a zero-gap run.
Each residual uniquely matches a prior adjudicated operator by function,
operator kind, original expression, and replacement. The delivery-direction
repair changes none of those residual functions. Eight are equivalent within
the stated typed or call-path domain. Twelve change observations without an
established stronger promise. The distinctions and authority analysis in the
full-source ownership audit remain explicit, including follower-read failure
and controls after partial failed initialization.

The tool names a law in 268 kills. Ten other kills have `(unnamed)` metadata
and a reproducible assertion route, retained by test name in the raw results.
Earlier blanket references to every kill as a *named* law overstate that
metadata. The correct claim is 278 reproducible assertion kills, of which 268
name the law in the tool report. No crash or timeout supplies a kill.

The residual mapping below preserves the old evidence IDs and the final
operator IDs. Full expressions, stable keys, raw routes and current verdicts
remain in the task-local result and disposition files; the prior sections
supply each contract rationale.

| Final operator | Earlier operator | Disposition |
| --- | --- | --- |
| `OfflineExecutor.ts:M45` | `OfflineExecutor.ts:M43` | typed/call-path equivalence |
| `OfflineExecutor.ts:M64` | `OfflineExecutor.ts:M62` | typed/call-path equivalence |
| `OfflineExecutor.ts:M65` | `OfflineExecutor.ts:M63` | typed/call-path equivalence |
| `OfflineExecutor.ts:M67` | `OfflineExecutor.ts:M65` | typed/call-path equivalence |
| `OfflineExecutor.ts:M74` | `OfflineExecutor.ts:M72` | typed/call-path equivalence |
| `OfflineExecutor.ts:M84` | `OfflineExecutor.ts:M82` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M90` | `OfflineExecutor.ts:M88` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M92` | `OfflineExecutor.ts:M90` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M97` | `OfflineExecutor.ts:M95` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M102` | `OfflineExecutor.ts:M100` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M103` | `OfflineExecutor.ts:M101` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M125` | `OfflineExecutor.ts:M123` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M129` | `OfflineExecutor.ts:M127` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M131` | `OfflineExecutor.ts:M129` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M133` | `OfflineExecutor.ts:M131` | typed/call-path equivalence |
| `OfflineExecutor.ts:M137` | `OfflineExecutor.ts:M135` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M150` | `OfflineExecutor.ts:M148` | typed/call-path equivalence |
| `OfflineExecutor.ts:M186` | `OfflineExecutor.ts:M184` | observable difference without a stronger promise |
| `OfflineExecutor.ts:M245` | `OfflineExecutor.ts:M242` | typed/call-path equivalence |
| `OfflineExecutor.ts:M269` | `OfflineExecutor.ts:M266` | observable difference without a stronger promise |

All detected findings are owned and adjudicated; none is dismissed because it
predates this branch. No known reachable violation of the accepted handoff law
remains in the declared histories and observations. This bounded result is not
a proof of arbitrary histories or a new promise about copied outboxes,
malformed configuration, diagnostic wording, idle barrier identity, native
storage, or cross-tab callers. The accepted copied-outbox decision above and
the receiving-path limits continue to apply.


### Final local verification

The final normal package run passes 466 tests across 25 files. The offline
TypeScript check, production build, explicit ESLint, Prettier, and diff whitespace
checks pass. A final guarded replay on the expanded issued-handoff grammar uses
campaign seed `20261110` and path `3:0:0:0:0:0`; it records one property execution,
four completed non-failing predicate evaluations, and a successful child exit.
The earlier one-direction mutant failure applies to these same final source and
oracle hashes. The seven observer tests and settled-barrier mutant evidence also
use the final recorder hash. No oracle run budget was lowered or removed.
The local dependency recovery remains excluded from commits: only
`@tanstack/solid-start` uses the local 1.169.5-to-1.169.4 override; Query Core
uses the installed 5.90.20 within the supported peer range instead of unavailable
5.107.1. Neither is part of the production change or the release changeset.


The final reviewed implementation is commit `b633f501d7297cfbac9db041ca0dd09a773bf47a`. The final
`pnpm lint:changed` run passes with no oracle lint or run-budget report.
Subsequent evidence-only edits do not change the tested source, model, grammar,
production driver, comparison, or configuration. CI and external-review status
are reported separately for the final pushed PR head.
