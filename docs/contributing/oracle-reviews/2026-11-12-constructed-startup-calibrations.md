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
