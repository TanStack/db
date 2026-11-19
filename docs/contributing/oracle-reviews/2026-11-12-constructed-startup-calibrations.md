# Direct constructed histories for persisted startup calibrations

This change adopts the e2af13a preview of TanStack/oracles, including #31.
Both root packages and the db package use that exact preview. It requires
DB #2421's removal of `declareOracle`, so the initial review base is
d2f9fbd5b60f16792536ed2d2ee47d2385a47cff. This change adds no compatibility
shim and changes no shipped Collection code.

The reviewed shared registrar has SHA256
`0bcb26d2e07bbf1fc2683599a63dcabf80ef45147ee999295c9e9c32cd33c3c8`.
The versioned record and its commit identify the reviewed change. The other
executable edits are dependency pins and their lockfile resolutions.

## Law and construction

The shared persisted-startup owner retains READY-3/PUB-7 replacement,
network-first fallback, startup durability and ordinary startup batching.
Its independent set model, drivers, cuts, fixed histories, declared states,
and per-campaign 80-history budgets are unchanged. Its construction-obligation
comparison is retained for generated and shrunk histories.

Each calibration now selects a constructed history directly. Missing-state
controls select the construction for their own state. The truncate control
selects a nonempty batch. Stale-membership corruption selects an omission.
Fallback corruption selects saved rows with the source held past the deadline.
Durability controls additionally require `startupDurable:` in the difference,
and saved-row loss requires `fallback:`.

Two additional randomized constructions guarantee a changed overlapping row,
once before restore and once after fallback. The source changes that row from
value 1 to 2 even when a peer alone owned its saved version. This prevents a
bound persistence-loss control from selecting an empty or unchanged result
where no source write would be necessary. The constructions retain surrounding
generated membership and optional actions. Both enter existing declared states.

## Validation

Full runtime selections passed on controlled and real Node SQLite persistence
hosts. Each receiver uses its real production adapter entry and the shared
comparison at fallback, first result, first durability, refresh and reopen.

| Receiver | Passed tests | Passed calibrations |
| --- | ---: | ---: |
| PowerSync | 562 | 40 |
| Query | 624 | 42 |
| RxDB | 250 | 34 |
| TrailBase | 208 | 28 |
| Convex | 208 | 28 |
| Electric | 208 | 28 |
| Total | 2,060 | 200 |

Each package ran `node ../../node_modules/vitest/vitest.mjs run` with its
`tests/persisted-startup-conformance-oracle*` file and `--maxWorkers=2`.
PowerSync kept normal coverage and Vitest type checking. Other runtime runs
disabled those two options. A separate `tsc --noEmit` with PowerSync's project
also passed. Both fixed-seed 2367 and random campaigns report reach for the
new constructions on both hosts. All 40 original PowerSync calibration names
match the successful bound selection exactly.

The deliberately wrong traces and persistence-loss drivers still reject under
their named laws. Scoped persistence loss must still drop an actual write in
the hydration scope on the applicable real SQLite schedule. No production
repair is part of this change, so there is no production RED/GREEN claim.

An independent review challenged construction legality, distinguishing writes,
fault applicability, observation cuts, model independence and budget retention.
Its final result and bounded executable checks are appended below.

Formatting, whitespace and PowerSync project types pass. `pnpm lint:changed`
reports no ESLint finding, but exits 1 on 13 removed-budget warnings from its
main-based comparison of #2421. That PR explains those migrations in its body.
The task-only comparison with d2f9fbd5b reports zero removed or lowered budgets.

## Local timing and limits

The complete old 40-calibration selection did not finish before interruption
at 312.54 seconds. It produced no final test verdict, so this is an elapsed
lower bound, not a passing baseline or an exact full-run speedup. The bound
40-calibration selection passed in 6.331 seconds.

A complete matched selection of the source-key-transform missing-state
calibration on both hosts passed before and after: 26.28 seconds versus
1.462 seconds, about 18 times faster. The earlier run used DB main 01f7b324c
and oracles 84cd34a. The later run uses #2421's migration plus these edits and
oracles e2af13a. The relevant Collection code, model and driver behavior are
unchanged across those bases. These are single local runs with other sessions
active. They do not establish total release time or a CI latency guarantee.

The old timing command's `time -l` could not read `kern.clockrate` in the
sandbox and returned 1 after the successful Vitest run. The JSON records both
tests as passed. Later timings use a subprocess timer without that syscall.
No before/after heap or aggregate-memory claim follows from these runs.

The shared owner's three-key eager grammar and provider limits remain.
Chromium OPFS receiving witnesses are unchanged and were not rerun for this
test-registrar change. Other DB calibration families retain their existing
search until separately bound. Calibration construction seeds are stable and
derived from the property id and calibration name.

## Applicable rubric checks

- ORC-001/002/003: existing contract, independent models and named cuts remain.
- ORC-004/013/015: new constructions retain legal randomized surrounding
  histories and force changed overlap at each selected schedule. Both normal
  campaigns exercise them and report their existing states.
- ORC-005/014: all six actual Node receivers pass on both persistence hosts.
  No additional real-browser or remote-replication result is claimed.
- ORC-006: all 200 shared calibrations pass their designated rejection.
- ORC-007: fixed/random campaign budgets and direct replay remain unchanged.
- ORC-008/009/011: no model state, vocabulary abstraction or reference semantic
  rule changes. No new shared-model fault hypothesis arose in this task.
- ORC-010: existing cut recording and cleanup remain. The initial missing-export
  collection failure is recorded as setup failure, never as a mutant kill.
- ORC-012/016: this record preserves scope and limits. All registrations remain
  in `oracleProperty`; no unit tests or handwritten expected answers are added.

## Independent review result

A fresh reviewer found no supported defect at the registrar hash above.
It reconstructed the saved-a=1 / returned-a=2 durability obligation, including
a surviving peer, independently from the model implementation. Its scratch
harness sampled each actual receiver arbitrary with seed 2367 and 1,000 inputs
per builder. All 80,000 constructed outputs retained grammar membership, fresh
identity, named reach and construction obligations. All 88,000 synthetic
corruptions applied and rejected under their required law and difference.
Those synthetic traces establish checker discrimination, not provider reach.

The reviewer also independently ran the complete bound calibration selections
for Query (42), RxDB (34), Convex (28), Electric (28) and TrailBase (28), on both
hosts. All 160 passed. Query's run also reported no type errors. It did not
repeat PowerSync's run, the full generated campaigns, direct replay or browsers.
Its initial scratch VM encountered a cross-realm plain-record rejection.
Running the scratch harness in one realm repaired that setup error. Neither
that error nor the earlier missing-export collection error is a product defect.

## Dependency compatibility follow-up

The independent prep review inspected DB head
`50d706106ece90933fdaf590fab4d6c24362a92e` against the base named above.
It found two receiving defects outside the six startup owners: generated path
callers omitted the new unit coordinate, and campaign hooks interpreted the
new individual units as complete campaigns. The dependency anchor is root
`package.json:56`, mirrored at `packages/db/package.json:72`; the initial raw
review incorrectly gave line 71 for the mirror. The original review and
historical commands remain unchanged. These repairs change test registration,
replay transport and campaign accounting; shipped code, models, comparisons,
fixed histories, run budgets and existing minima remain unchanged.

### Replay selection

The unchanged guarded replay suite reproduced the registration defect with
24 failed and 94 passed tests. Generated PROPERTY/SEED/PATH callers now name
the intended random unit, while enumerated commands clear an inherited unit.
The replay manifest and current instructions carry the same distinction.
The first repaired full suite passed all 120 tests. Missing and nonexistent
units reject before execution; an inherited unit does not contaminate the
advertised enumerated command. Existing path translations retain the named
construction rather than silently selecting generated histories.
Six final permanent controls passed: missing/wrong generated unit and four
actual browser-alias cases, including filtered, unknown-property and conflict
rejections. The current inline instructions distinguish generated, enumerated
and direct fast-check paths. Original numeric commands retain their historical
coordinates and are labeled before any required translation.
The final combined replay suite passed all 124 tests in 217.05 seconds.

The compiler calibration helper also required the prerequisite migration's
native callback transport. Its test-only host executes native framework
registration and preserves shared configuration side effects. Clean utility
admission passes, `utility-no-guard` fails the intended comparison, and a wrong
unit rejects at registration. These are separately classified outcomes; a
registration or loader error is never a calibration kill.
The current native type clean control passes with unit
`random seed: all admitted type forms`; `schema-output-rejection` then rejects
at the intended schema assertion with TS2578, rather than a loader or unrelated
type failure. Multiplier/timeout registration checks also pass.

### Campaign hooks

The original ordered-loader construction failed its unchanged campaign
minimum: one executed history could not satisfy deferred-refill count 5.
Shared test-only classifiers now distinguish `fixed seed N: generated`,
`random seed: generated` and determinism units. The audit migrated all affected
hooks, including random-only prefixes and minima, exact fixed-seed cases,
shared browser/includes callbacks, and script aggregate exclusions.

The same loader property then passed all 11 units. Its fixed generated unit
executed exactly 200 histories, with deferred-refill/reset-continuation reach
85/58; its random unit executed 400, with reach 156/116. Both unchanged minima
of 5 ran. Restoring the old selector in an execution-only transform reproduced
the constructed-unit failure. Corrupting only the random generated count
immediately before its real assertion failed at 0 < 5, proving that the random
gate remains active. Seven core hook-owner files passed 1,477 tests and five
neighbor files passed 622, including the previously failing determinism units.
Three scratch classifier contract checks passed. These isolated Node checks
disabled coverage/typecheck and supplement the normal package CI checks.

### Legacy browser replay

A separate inherited prerequisite defect affected browser replay aliases.
The alias installed environment coordinates after shared configuration had
cached them. This exact command, from the browser persistence package, ran
16 tests including both complete campaigns before repair:

```sh
TANSTACK_DB_DRIVER_FAIRNESS_SEED=165905 TANSTACK_DB_DRIVER_FAIRNESS_PATH=0 node ../../node_modules/vitest/vitest.mjs run tests/shared-driver-fairness-oracle.test.ts -t 'browser.shared-driver-fairness' --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false
```

The alias now validates its coordinates and configures the shared selection
before property registration. The identical command passes one test and skips
15; conflicting canonical and legacy units reject. This receiving defect is
distinct from the dependency's new required-unit registration failure.

The original full alias log was overwritten during local work; its exact
command, observed output excerpt and timing survive in the raw review record.
The repair plan was sent before editing, while its stable ledger entry was
appended afterward. This record does not claim an earlier append or a complete
preserved original log. The broad DB run overlapped extraction of the shared
configuration wrapper; that wrapper preserves its default configuration call.
The broad run is therefore separate evidence for the nonalias paths it loaded.

### Historical calibration helper

Fresh review found a separate inherited loader problem in the helper's
documented `ownerRef` branch: old owners imported removed reach/replay helpers.
The script now materializes those companions and configuration from the same
owner revision under ignored `.context`, and uses `node --import tsx` for that
legacy transport. Both advertised old owners load and register successfully.
Current native registration still uses the pinned framework and shared config.

An old owner runs against the current production tree. Both old clean controls
and the local-utils/query-status controls now reach the compiler but fail the
same old exact published-row shape comparison after accepted API changes.
This is separate from the repaired module-loader defect and supplies
no historical mutant kill. The archived
[type-review commands](pr-2259-persisted-option-types.md#helper-compatibility-follow-up-2026-11-12)
remain tied to their recorded source revisions. No historical production type
overlay or old model rule is introduced to manufacture a passing baseline.

### Final bounded review and package checks

Fresh review found no remaining supported defect in the campaign classifiers,
unit selection, alias refresh or native callback transport. Independent
bounded checks also reproduced the generated and constructed path translation
on actual fast-check streams. This does not replace receiving-owner execution.
The normal DB CI command passed 216 files and 20,008 tests with no type errors
and 87.89% coverage; its subsequent IndexedDB selection passed three files and
19 tests. Full repository `pnpm lint:check` passed with warnings only. These are
local package results, separate from the final pushed-head CI verdict.

The follow-up retains ORC-007 campaign parity and direct replay, ORC-010's
distinction between setup and law failures, and ORC-015 reach enforcement.
It establishes no new production behavior, native-browser persistence result,
remote-provider result or runtime improvement. The six startup owners' model,
driver and registrar evidence above remains a separate bounded claim.

### Final local compatibility verification

The three script suites subsequently completed successfully: 182 tests across
three files in 889.98 seconds, including determinism, calibrations and final
census checks. Combined targeted hook validation is 2,281 tests across 15 files.
The final guarded replay suite passes all 124 tests. The normal local `db-1`
CI job passes 20,008 tests with no type errors and then 19 IndexedDB package
tests. Full package lint, targeted script lint, repository formatting and
whitespace checks pass. The main-based budget reporter still emits the 13
inherited migration warnings; no new budget reduction belongs to this PR.
These local results do not replace CI on the final pushed head.

The compatibility source below is based on reviewed head
`50d706106ece90933fdaf590fab4d6c24362a92e`; hashes identify the repaired files
that the final local checks exercised. The subsequent replay-comment changes
produce identical parsed TypeScript when comments are removed.

| File | SHA-256 |
| --- | --- |
| `packages/db/tests/oracle-config.ts` | `af98aa869b7f7913f42f0ccdfcb33c28c8ee3f21b368ce3d582185308b4a0c9b` |
| `packages/db/tests/oracle-replay.test.ts` | `fa09fc96e3b49c273d7ced4fb9f584151ee8cb213291b1b1f2376b7f6e372193` |
| `packages/db/tests/oracle-replay-manifest.ts` | `c61b281dd165ea7318d3001c75a7f800077d78e16108cbc38c62980de0195f72` |
| `packages/browser-db-sqlite-persistence/tests/browser-property-registration-oracle.ts` | `d9c911faa1451ee3fc4f8a35324078c22a783ee4310970b8b68852d97026e3fb` |
| `scripts/calibrate-persisted-option-types.mjs` | `ec2a7e3b73821357046427aaad59aea7fb155da5d505468e25f0b5b9651c142f` |
