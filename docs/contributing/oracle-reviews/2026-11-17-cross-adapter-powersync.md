# Native PowerSync receiving review

This pass judges `packages/powersync-db-collection` separately from Direct
PowerSync. Production remained unchanged while the receiving inventory and
tests were assembled. Its SQLite-to-Collection boundary is the authority;
external Sync Streams belong to user `onLoad` and `onLoadSubset` hooks.

## Pre-edit inventory

The eager reload receiver uses real `@powersync/node` SQLite, and its browser
counterpart uses `@powersync/web`. Persisted startup receives controlled,
Node SQLite and Chromium worker/OPFS wrapper stores separately from source
SQLite. Existing eager reload baseline: 103/103, default Node 24,
`--maxWorkers=1`; log `.review-2377/native-powersync-existing-reload-baseline.log`.

Applicable laws include complete eager replacement on reload, deferred
persisted receipt cleanup, hook ownership and callback isolation, applied
subset settlement, and fatal deserialization within a refused sync batch.
Native `syncBatchSize` explicitly permits earlier initial batches to stream,
so refusal cannot revoke already-applied prior batches.

Direct stream lease health, stream priority forwarding, remote confirmation,
and active join waiting for a remote checkpoint are unsuitable native
assumptions. Native eager reads an already-populated local SQLite table. Native
deserialization may transform IDs; its existing startup receiver deliberately
maps `provider:key` to `key`. Changed-ID refusal is Direct-specific authority.

Initial receipt cleanup uses real persisted deferred acceptance. Native
`commit()` supplies no cancellation signal and eager startup waits for
`whenSyncAccepted`; a core accepted receipt held by optimistic work is a
different premise. The new common receiver records the actual wrapper receipt,
then the shared initial-receipt model compares cleanup after application and
cleanup while that receipt is pending. It records actual host detached errors.

Pre-edit SHA-256:

| Native production file | SHA-256 |
| --- | --- |
| `src/powersync.ts` | `c4960f0c00aae28400de1811285458995c5b61591bd7ce42353f99ad6ab47068` |
| `src/PowerSyncTransactor.ts` | `62fc82ef7d0647651973429e289a7b12f2245f340ebf3e102ff0095ddecfb98a` |
| `src/definitions.ts` | `27c13705a302ab0aba2dbc0b776b3e74bdee90c4fb4487a63bc10e1fe6c11d2f` |

## Evidence

The original reviewed head is
`92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`. The new native production drivers
use the installed Node SQLite and browser PowerSync SDKs. Every normal native
command uses Node 24 and `--maxWorkers=1`.

| Original-production receiver | Result | Log in `.review-2377/` |
| --- | --- | --- |
| Existing eager reload | 103 passed | `native-powersync-existing-reload-baseline.log` |
| Existing eager health, unchanged 400-run budget | 106 passed | `native-powersync-existing-health-baseline.log` |
| Existing persisted startup | 562 passed | `native-powersync-existing-persisted-startup-baseline.log` |
| Initial receipt, controlled and real Node SQLite persistence | 56 passed | `native-powersync-initial-receipt-original-registered.log` |
| Initial receipt, browser worker/OPFS persistence | 28 passed | `native-powersync-initial-receipt-original-browser.log` |
| Hooks, Node SQLite, including cleanup-helper examples | 255 passed | `native-powersync-hooks-provider-cut.log` |
| Hooks, browser SQLite | 253 passed | `native-powersync-hooks-provider-cut-browser.log` |
| Decoder targeted Node | 4 failed, 2 passed | `native-powersync-batch-decode-provider-cut-targeted.log` |
| Decoder targeted browser | 4 failed, 2 passed | `native-powersync-batch-decode-provider-cut-targeted-browser.log` |

The targeted decoder failures name only missing terminal sync health and an
unreleased change watcher. They reach the real schema refusal after the
provider read; they are neither setup errors nor timeouts. The two passing
controls preserve valid transformed values and previously accepted initial
pages. Full corrected original-production campaigns remain pending at this
checkpoint. No native production repair or bug-class closure is claimed here.

## Hook ownership instrument

`tests/hook-lifecycle-oracle.ts` owns an independent token-count model: one
successful entered hook returns one cleanup obligation. The authored hook
outcome determines the loading or request boundary. It does not model the
adapter's trigger revisions, demand map, or provider session.

The grammar spans eager/on-demand mode; synchronous/asynchronous success,
throw/reject; cleanup or subset release while a hook is pending; synchronous
or asynchronous returned cleanup; empty/nonempty rows; and an actual applied
receipt held by an optimistic transaction. Legal normalization excludes a
subset release in eager mode and a pending retirement of a nonpending hook.
Fifteen declared states each have five fresh randomized builders. Both normal
campaigns run the same 12-history budget, with seed 2377 and an unseeded
campaign. The shared framework also checks each builder's generated outputs;
missing-state controls corrupt each declared state's observation.

The first instrument waited for `cleanupCalls > 0`; that would turn a dropped
callback into a setup timeout. Independent review rejected that wait. The
revised instrument releases the authored hook and drains real SQLite work,
then records a missing callback as an observation. Browser startup also showed
that schema entry alone precedes complete trigger setup. Successful active
histories now wait for the real SDK `createDiffTrigger` call to settle, then
cross an actual SQLite transaction boundary. They never poll expected load or
cleanup outcomes before the decisive observation.

The applied-receipt cut keeps real optimistic work pending until provider
setup has settled. An earlier cut let an early-fulfillment mutant survive
because unrelated SQL setup still delayed its return. At the corrected cut,
that mutant fulfills with only the optimistic row visible while its actual
receipt remains pending. The shared comparison rejects it.

Two isolated source copies demonstrate semantic kills without editing shared
production: dropping the eager returned cleanup fails `returned cleanup
ownership differs`; omitting the subset applied-receipt await fails `load
fulfilled before its rows applied` and `subset load escaped its actual held
applied receipt`. Both failures occur at `after hook cleanup`, law `hook
ownership`; neither is a timeout or setup failure. The observations are in
`native-powersync-hook-isolated-mutants-final.log`.

Independent reviewer `oracle_adversarial` approved the hook semantic slice
after inspecting both real-host GREEN runs and both isolated mutants. The
approved SHA-256 values are:

| Hook file | SHA-256 |
| --- | --- |
| `tests/hook-lifecycle-oracle.ts` | `bea8829f4729f16e0d6d67d33aec75693150fe8140cead1a222b62402975a104` |
| `tests/hook-lifecycle-driver.ts` | `1260907741a265bbed9f565dffb7111aa91ceff5dc8f21319306c52d616107bd` |
| `tests/hook-lifecycle-oracle-suite.ts` | `f1b7db6c96d5712ddbe76c6b67cc8e4e810206e3e5f21192c585f37e6740efb3` |

## Decoder admission instrument

`tests/batch-decode-oracle.ts` derives application rows from authored input
values, independently of user validation and adapter writes. The native
contract declares deserialization inconsistency fatal. This differs from a
user subset hook's request-local refusal. Accepted earlier initial pages stay
visible because `syncBatchSize` permits initial streaming. The refused page
contributes no new public rows.

SQLite scan order is unspecified. A recorder forwards original provider SQL
reads unchanged and records the input page order. The model consumes only
these source facts, never Collection commits or production classifications.
It permits a nondecreasing sequence of complete admitted-page prefixes,
including the prior baseline, duplicate snapshots and coalesced cuts. The
final snapshot must contain every accepted page. Partial pages and A/B/A
regressions are rejected. Only adjacent identical callback snapshots are
collapsed in the returned record; callback cardinality is outside this law.

The grammar covers eager/on-demand × initial/live × valid/throw/issues,
transformed IDs, Date/boolean values, fresh/overlapping live keys, first/last
refusal positions and a previously accepted initial page. Eighteen states
each have five fresh randomized builders, the shared generated-builder checks,
missing-state controls, 12 generated histories and fixed/random campaigns.
One to six rows and batch sizes one to four bound this model. The driver uses
a synchronous Standard Schema because an asynchronously converted throwing
validator would test a different unsupported premise.

An initial comparison demanded exactly one callback per page. Independent
review identified the readiness callback as a permitted repeated snapshot;
the comparison now checks monotonic coherent prefixes. Early full runs also
revealed an initial checkpoint before real SDK setup completed. The driver
now waits for that actual setup completion, just as the hook instrument does.
Earlier full-run timing failures are instrument defects and are not counted
as production bugs.

## Failure fidelity

`tests/receiving-cleanup.ts` retains a completed public observation and appends
secondary teardown diagnostics. The shared comparison checks the product law
first, then the distinct `receiving cleanup` law. Bound controls show both a
valid product cut with a cleanup diagnostic and a wrong product cut whose
original mismatch stays primary. Ordinary helper tests inject real cleanup
errors, including setup plus teardown failure. Node process and browser
detached errors remain observable on the initial-receipt receiving paths.

The expanded instrument freeze is
`.review-2377/native-receiving-expanded-snapshot.sha256`: 38 production,
registration, host, model, driver and supporting files. It records the original
production hash above. Other agents own global registration and shared files;
later integration hashes must be refreshed explicitly rather than silently
reusing this checkpoint.

## Final pre-repair instrument checkpoint

The decoder's corrected one-batch original campaigns completed with 115
failures/189 passes in Node and 108 failures/196 passes in Chromium, out of
304 tests per host. All 104 Node and 100 browser semantic `Difference`
records name missing fatal sync health and watcher release. The remaining
failures are bound calibration baselines that already violate the product law;
they are not calibration kills. No setup timeout, premature loading cut or
determinism mismatch remains in those results. Logs:
`native-powersync-batch-decode-provider-cut-original.log` and
`native-powersync-batch-decode-provider-cut-original-browser.log`.

Direct replay was checked on unchanged source: property
`adapter.powersync.batch-decode`, seed `2377`, path `0:2:2:2:2:2`, unit
`random seed: generated eager:live:issues 1`. It ran one requested comparison,
skipped the normal campaigns and retained the same health/watcher difference.
The command and RED are in `native-powersync-batch-decode-original-replay.log`.

Independent review approved that bounded one-batch decoder slice, excluding
the initial-receipt recorder pending its separate repair. The coordinating
review then required adjacent continuations before a production repair.
Every refusal history now corrects actual SQLite rows, asks for both a
nonempty and an empty new subset, and explicitly cleans up and restarts. The
empty request can fulfill without a decoder call, so repeated decoder refusal
cannot accidentally enforce the admission law. The current run must retain
its rows and exact terminal cause, admit no new decoding, and reject both new
requests. New requests may use a descriptive stopped error; their Error object
identity is not a promised result. A new run reads independent fresh application keys,
becomes ready and clears the retired error. This is restart after cleanup;
it does not claim retained reload replacement.

The extended grammar has 21 declared states, each with five fresh constructed
builders and generated-builder missing-state checks. Its pre-repair snapshot
contains 39 files at
`.review-2377/native-receiving-final-instrument-snapshot.sha256` (manifest
SHA-256 `645da849a3349239345a03cbefe2f741f895f92f74237a89ccf32485f5c1cbe5`).
The expanded original campaigns completed with 143 failures/211 passes in
Node and 140 failures/214 passes in Chromium, out of 354 tests per host.
All 128 Node and 126 browser semantic failures name the intended missing
terminal health/cause, retained watcher and resumed work. Forty-five Node and
44 browser failures also name later subset admission. Remaining failures are
bound controls whose clean history already violates the product law; these
are not calibration kills. Explicit restart recovery did not produce a
mismatch. Logs are `native-powersync-batch-decode-final-original.log` and
`native-powersync-batch-decode-final-original-browser.log`.

Those full campaigns used an overly strong additional identity check for new
request errors. Independent review found no authority for that identity. The
final comparison removes only that check, retaining original refusal identity,
stable terminal health cause, rejection and both admission paths. Grammar,
production paths and checkpoints are unchanged. A targeted original-source run
on both hosts verifies the reviewed comparison before the production gate.
The amended 39-file manifest is
`.review-2377/native-receiving-reviewed-instrument-snapshot.sha256` (SHA-256
`0baa5eeb747d9d3485fbd31d274395c824e239c2eaf4d291643a94b39a1b306e`).
Native production is still the pre-edit hash above at this checkpoint.

The initial-receipt recorder was repaired separately. Its former early
`receipt.then` rejection observer could consume the event being tested. It
now stores the actual wrapper receipt, holds the actual persisted restore
read for the pending schedule, lets cleanup and eight native task turns run,
and only then observes its actual settlement. The live detached-error array
survives source and outer storage disposal. Node drains native event turns
before printing. Chromium drains in `finally` and removes its listener last.
The claim is the declared deferred-before-acceptance refusal and neighboring
after-application schedule; this is not a claim to reject every removal of a
production catch handler.

Repaired receipt runs: Node 60/60 and Chromium 30/30, including bound real
late-failure controls. Node injects a detached rejection after storage close
and a nonzero worker exit after its completed record. Chromium injects an
actual storage-close failure and a detached rejection during teardown. The
same shared check names a sole teardown diagnostic `receiving cleanup`, while
retaining detached-error product mismatch as primary when both occur. Logs:
`native-powersync-initial-receipt-late-recorder.log` and
`native-powersync-initial-receipt-late-recorder-browser.log`.

The shared receipt registrar gained optional fault labels and difference
strings so browser failures do not claim to be worker exits. Defaults and
fault modes remain unchanged. Its SHA-256 is
`5dad5ea2a99124612e3399c5b0e71ecb350c151ef275b7ae521238a85876489e`.

### Declared hook reach in the approved original runs

Each value counts constructed and ordinary generated histories, excluding
fixed histories and controls. The fixed seed is 2377 on both hosts.

| State | Node fixed | Node random | Browser fixed | Browser random |
| --- | --- | --- | --- | --- |
| eager sync | 6 | 7 | 6 | 7 |
| eager async | 8 | 8 | 8 | 10 |
| eager throw | 6 | 5 | 6 | 5 |
| eager reject | 6 | 5 | 6 | 7 |
| eager cleanup pending | 13 | 10 | 13 | 13 |
| on-demand sync | 5 | 6 | 5 | 5 |
| on-demand async | 13 | 16 | 13 | 12 |
| on-demand throw | 5 | 6 | 5 | 7 |
| on-demand reject | 7 | 6 | 7 | 6 |
| on-demand cleanup pending | 8 | 9 | 8 | 8 |
| on-demand release pending | 10 | 9 | 10 | 7 |
| applied held | 5 | 8 | 5 | 5 |
| asynchronous cleanup | 33 | 32 | 33 | 31 |
| empty source | 14 | 25 | 14 | 13 |
| nonempty source | 73 | 62 | 73 | 74 |

## Bounded native decoder repair

The independent continuation gate approved the exact 39-file manifest
`0baa5eeb747d9d3485fbd31d274395c824e239c2eaf4d291643a94b39a1b306e`
before the first production edit. Its complete file hashes are preserved in
[`2026-11-17-cross-adapter-powersync-pre-edit-snapshot.json`](2026-11-17-cross-adapter-powersync-pre-edit-snapshot.json).
The final targeted original-source comparison produced three semantic REDs
and six GREEN controls on each host. Its logs are
`native-powersync-batch-decode-reviewed-original-targeted.log` and
`native-powersync-batch-decode-reviewed-original-targeted-browser.log`.

The repair catches only `deserializeSyncRow` refusal. A run-local marker
keeps the original thrown value, calls `fail()`, aborts its watcher and joins
the existing tracking-disposal ownership. Reconciliation, queued changes,
releases and new subset admission cannot resume that run. Ordinary user hook
rejection and retryable SQL tracking errors keep their existing boundaries.
Cleanup followed by restart creates a fresh run-local marker.

The frozen repaired source SHA-256 is
`7781cf0834530b48cd7be9db052261964866bf92a6a44adb2c15fe0aa6e282de`.
An initial TypeScript narrowing issue was corrected without changing the
model: a small throwing helper checks run-local failure after asynchronous
boundaries. Targeted typecheck and ESLint both pass. Full receiving and
neighboring results are recorded after their completion below.

### Source mutants

All source mutants ran from isolated copies; shared native production stayed
at the repaired hash. A Vite resolver substituted only the copied native
`src/index.ts` for the same production driver. Stack traces confirm entry
into each copied source. They use the reviewed model, grammar, recorder and
comparison rather than separate expected answers.

| Source mutant | SHA-256 | Result at `after native source batch`, law `native batch decoding` |
| --- | --- | --- |
| Original implementation | `c4960f0c00aae28400de1811285458995c5b61591bd7ce42353f99ad6ab47068` | Three semantic failures and six passing controls: terminal health/cause, watcher, resumed work and later admission |
| Fail health but omit fatal abort/disposal | `7bb50a1daec0adb696b3e237d6cc61349f62355c4874131fc65ea0cc0428fbfa` | Three semantic failures and six passing controls: retained change watcher |
| Fulfill a new subset after fatal refusal | `1cb68281060d92f3fa61ada4e08a5d183c7e5d54122461df9cbf20b203d56b78` | Two semantic failures and seven passing controls: later subset admission |

These are comparison kills, not setup errors, crashes or timeouts. Logs are
`native-powersync-decoder-original-isolated-mutant.log`,
`native-powersync-decoder-health-only-isolated-mutant.log`, and
`native-powersync-decoder-stopped-load-isolated-mutant.log`.

### Declared decoder reach after repair

The 21-state grammar has an enforced minimum of five constructed histories
per campaign, with fresh object identity per builder and a separate generated
builder check. Counts below include constructions and ordinary generated
histories, excluding fixed histories and controls.

| State | Node fixed | Node random | Browser fixed | Browser random |
| --- | --- | --- | --- | --- |
| eager:initial:valid | 6 | 5 | 6 | 6 |
| eager:initial:throw | 11 | 9 | 11 | 9 |
| eager:initial:issues | 12 | 11 | 12 | 13 |
| eager:live:valid | 7 | 9 | 7 | 8 |
| eager:live:throw | 10 | 10 | 10 | 8 |
| eager:live:issues | 11 | 14 | 11 | 11 |
| on-demand:initial:valid | 7 | 5 | 7 | 6 |
| on-demand:initial:throw | 10 | 7 | 10 | 9 |
| on-demand:initial:issues | 12 | 15 | 12 | 18 |
| on-demand:live:valid | 8 | 8 | 8 | 8 |
| on-demand:live:throw | 11 | 9 | 11 | 11 |
| on-demand:live:issues | 12 | 15 | 12 | 10 |
| transformed-key | 59 | 57 | 59 | 63 |
| live-overlap | 29 | 35 | 29 | 24 |
| live-fresh | 30 | 30 | 30 | 32 |
| refusal-first | 34 | 36 | 34 | 39 |
| refusal-last | 56 | 61 | 56 | 59 |
| accepted-earlier-page | 19 | 17 | 19 | 21 |
| corrected-source-after-refusal | 89 | 90 | 89 | 89 |
| restart-after-refusal | 89 | 90 | 89 | 89 |
| empty-subset-after-refusal | 45 | 46 | 45 | 48 |

### Rubric evidence and limits

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Native definitions authorize fatal deserialization, legal output transforms and streamed initial pages. Glossary status, health, cleanup and applied settlement define the receiving cuts. |
| ORC-002 | Models use authored input rows and hook outcomes. Provider page order is an input fact. Neither model imports adapter classification or scheduling decisions. |
| ORC-003 | Model files lead with laws and limits; directly named drivers and suites explain histories, public observations and cuts beside code. |
| ORC-004 | The grammar reconstructs the reported initial/live refusal and pending-hook witnesses. Each axis changes readiness, permitted rows, cleanup ownership or continuation. Bounds and excluded asynchronous validators, remote streams and retained reload are explicit. |
| ORC-005 | Real Node and browser SDK SQLite supply reads and change notifications. Actual provider setup, write-lock and receipt cuts precede comparison. No concrete missing-input hypothesis remains at these cuts. |
| ORC-006 | Bound partial-page, regression, cleanup-diagnostic and reach controls; actual dropped-hook/early-fulfillment mutants; and the three decoder source mutants above reject at named comparisons. Invalid original calibration baselines are uncredited. |
| ORC-007 | Shared registration executes identical seed-2377 and unseeded campaigns with budget 12. The checked direct seed/path/unit replay reproduces the original named law. These properties do not use `fc.commands`, so command replay paths do not apply. |
| ORC-008 | Page-prefix position retains the distinction between coherent progress and A/B/A regression. Hook retirement differs from active completion because late returned cleanup is still owned. Same-run refusal and explicit new-run recovery permit different future actions. |
| ORC-009 | Source SQL pages are provider inputs; public snapshots are Collection values. Hook tokens abstract returned cleanup ownership and do not reproduce the adapter's demand records. |
| ORC-010 | Completed observations retain late cleanup diagnostics. Bound real host faults and helper tests preserve primary mismatch separately; workers and browser listeners remain active through teardown. |
| ORC-011 | No unresolved shared-semantic-fault hypothesis requiring a second formulation was identified. Authored output values and the independent prefix judgment are separate from production schemas and transactions. |
| ORC-012 | This versioned record and pre-edit snapshot retain gate, hashes, commands, RED/GREEN status, review corrections, mutants and bounded limits. Final production review remains a separate gate. |
| ORC-013 | Neighbors distinguish initial eager failure from ready-source health, hook refusal from decoder fatality, accepted earlier pages from a refused page, held application from fulfilled loads, stopped work from explicit restart, and empty from nonempty later demand. |
| ORC-014 | Node and browser reuse one judgment per law. Actual source SQLite and actual controlled/Node/worker-OPFS wrapper storage supply their named premises; no deployed-service claim is made. |
| ORC-015 | Hook 15-state and decoder 21-state campaigns enforce five fresh constructions per state and separate generated-builder checks; count tables and missing-state controls are recorded above. Receipt uses the unchanged shared four-state grammar. |
| ORC-016 | Fixed histories and fault controls replay shared drivers and judgments. Ordinary cleanup helper examples remain in `receiving-cleanup.test.ts`. |

The decoder evidence covers one native table, one initial read or live SQL
transaction, one to six rows, synchronous schema success/throw/issues, legal
key/Date/boolean transforms, same-run corrected-source opportunity, new
empty/nonempty requests and cleanup/restart. It does not establish retained
reload refusal, persisted decoder publication, arbitrary concurrent subset
owners, local mutation confirmation, every storage implementation or deployed
PowerSync replication. Those neighboring contracts retain their existing
oracle owners; no broader class closure is claimed.

### Final receiving evidence

At source `7781cf0834530b48cd7be9db052261964866bf92a6a44adb2c15fe0aa6e282de`,
the complete new receiving slice passes: **669/669 Node** and **637/637
Chromium**. The Node slice includes the cleanup helper examples, controlled
and real SQLite wrapper persistence; Chromium includes real source SQLite
and worker/OPFS wrapper persistence. Both include all decoder and hook
calibrations, whose clean baselines now pass.

From `packages/powersync-db-collection`:

```sh
pnpm exec vitest run tests/batch-decode-conformance-oracle.property.test.ts tests/hook-lifecycle-conformance-oracle.property.test.ts tests/receiving-cleanup.test.ts tests/initial-receipt-conformance-oracle.property.test.ts --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false
pnpm exec tsc --noEmit -p tests/initial-receipt.tsconfig.json
```

From `packages/browser-db-sqlite-persistence`:

```sh
pnpm exec vitest run --config vitest.adapter-oracles.config.ts e2e/native-powersync-batch-decode-oracle.browser.test.ts e2e/native-powersync-hooks-oracle.browser.test.ts e2e/native-powersync-initial-receipt-oracle.browser.test.ts --maxWorkers=1
```

GREEN logs: `native-powersync-repair-receiving-green-v2.log` and
`native-powersync-repair-receiving-green-browser-v2.log`. Types and targeted
ESLint both exit 0 in `native-powersync-repair-types-v2.log` and
`native-powersync-repair-eslint-v2.log`. Repository `pnpm lint:changed` exits
0 in `native-powersync-final-lint-changed.log`.

The final 39-file manifest SHA-256 is
`4704e028f0ae43de6751f4660e405ed766960a4873fedd911f0fd1e55744e827`,
preserved in
[`2026-11-17-cross-adapter-powersync-final-snapshot.json`](2026-11-17-cross-adapter-powersync-final-snapshot.json).
Comparison with the pre-edit instrument gate shows one changed file: native
`src/powersync.ts`. Model, grammar, recorder, comparison and support hashes
remain unchanged. Independent reviewer `oracle_adversarial` verified every
hash, both full GREEN logs and all three isolated decoder source kills, and
approved this bounded repair and instrument. Independent production review and
the wider existing-neighbor suite remain separate final checks.

The wider existing-neighbor suite subsequently passed **1,081/1,081 tests in
11 files** (`native-powersync-repair-neighbors-green.log`). It includes
PowerSync integration, on-demand sync, load hooks, correctness, readiness and
transactor examples; existing eager health with its unchanged 400-run budget;
eager reload; and persisted startup, baseline lifecycle and capability laws.
Its command, from the native package, is:

```sh
pnpm exec vitest run tests/powersync.test.ts tests/on-demand-sync.test.ts tests/load-hooks.test.ts tests/eager-live-source-conformance-oracle.property.test.ts tests/eager-reload-conformance-oracle.property.test.ts tests/persisted-startup-conformance-oracle.property.test.ts tests/initial-readiness-exposure.test.ts tests/transactor-readiness.test.ts tests/correctness.test.ts tests/persisted-baseline-lifecycle-oracle.test.ts tests/persisted-capability-conformance-oracle.test.ts --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false
```

Independent production reviewer `parse_oracle_author` approved exact source
`7781cf0834530b48cd7be9db052261964866bf92a6a44adb2c15fe0aa6e282de`
after verifying all 39 final manifest hashes, both full receiving GREEN logs
and all three source-mutant kills. The reviewer independently ran 51 selected
decoder/refusal/restart and ordinary cleanup/hook/rebuild/release neighbors;
all passed. The separate scoped verdict is
[`2026-11-18-native-powersync-production-independent-review.md`](2026-11-18-native-powersync-production-independent-review.md).

The evidence closes the declared bounded refusal class at the native
SQLite-to-Collection boundary: complete-page admission, terminal failure and
owned watcher release, no same-run corrected-source or new-request resumption,
and explicit cleanup/restart recovery. It does not expand the limits listed
above into a universal claim about native PowerSync.
