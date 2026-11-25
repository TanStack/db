# Electron reload recording follow-up

Parent: `16c1a7ec3e3087f27d3f8c42ecddd821e8da67ad`. This record accompanies
the test-only follow-up. No library production file or oracle budget changes.

## Finding and repair location

CI's desktop determinism run reported election terms before startup reads and
a managed generation claim. The first execution passed. The same real Electron
suite also passed locally before this repair. The exact CI cause remains
unconfirmed; these results do not establish a persistence scheduling defect.

Inspection found an independent instrument defect: one-way SQL notices had no
recording-frame identity or sequence. A delayed notice could enter another
history, and a main-process reply did not establish delivery of earlier notices.
The repair belongs to the receiving recorder. Source laws, the reload model,
comparisons, fixed histories and generated budgets remain unchanged.

Main now tags statements with its recording frame, sequence and immutable app
session. It retains the ordered frame buffer. Renderer replay fills delivery
gaps and deduplicates notifications by sequence. Distinct statements with equal
SQL and parameters remain distinct. Closed-session callbacks cannot record into
the current session. Recording start is acknowledged before actors start.

Independent review found a second interval: a statement between the last trace
reply and recording stop could disappear if its notification arrived late.
Main stop now atomically disables recording and returns the final old-frame
buffer. The renderer merges it before retiring the frame. The shared driver
captures its final log after acknowledged stop. The reviewer reproduced the
old omission, verified the new tail control, and found no further supported
issue in the final bounded change.

## Evidence block

- **Law:** `ReloadHost.record` records every statement in database execution
  order; stop includes statements through its acknowledged main-process cut.
  Delayed retired-frame notices contribute nothing. This is an instrument law,
  not an additional library scheduling promise.
- **Reach:** `sqlite-reload.electron.sql-recording` generates two to six initial
  statements plus a new-sequence tail. SQL and parameter values vary independently
  from sequence. Each fixed/fresh campaign records 25 constructed and 100 random
  reaches for each of four states: retired frame, sequence gap, buffer replay
  and stop tail. Five builders and per-state missing-reach calibrations enforce
  the premises. Equal SQL under different sequence IDs remains in the model.
- **RED:** forwarding unscoped notices fails the shared `recording frame`
  comparison. Before the stop repair, the expanded tail grammar fails 17 checks
  with no type error; its final record lacks a main statement. Ancillary
  type-collector and sandbox Electron launch failures supply no RED evidence.
- **GREEN:** the final recording and in-process reload families pass 60 checks
  with no type errors. The actual Electron reload suite and determinism pass
  2/2 in 41.88 seconds. Full Electron package `tsc --noEmit` passes. The Browser
  reload receiver over Node SQLite passes 35 checks after the shared driver's
  asynchronous-recording extension.
- **Mutant:** restoring the old unscoped callback fails `recording frame` after
  an explicit transform-load marker. Retiring the frame before the final stop
  reply fails the stop-tail comparison. Neither result relies on a timeout or
  setup failure.
- **Limits:** this model judges recorder transport fidelity, not arbitrary IPC
  schedules, provider behavior or library progress. The actual Electron run
  receives the existing shared fixed reload histories. Its managed-source grant
  premise still does not prove that an earlier renderer preload had reached
  main-process claim admission. This follow-up makes no stronger claim about
  that timing, and does not identify the original CI failure's exact cause.

## Grammar and review controls

The authored statement list independently predicts the completed frame; the
model has no sequence buffer, session classifier or recorder helper. An early
retired notice and an out-of-order current notice have empty prefixes. The
tail repeats the first statement under a new sequence, so omitting it cannot
be excused as deduplication. It executes after every intermediate replay.

Removing frame identity admits retired SQL; removing sequence ordering exposes
the gap; removing replay loses delayed statements; retiring before stop loses
the tail. The grammar admits identical SQL/parameters as distinct statements,
but excludes invalid nonpositive or duplicate authored sequence IDs. The latter
are transport redelivery only. Intermediate empty-prefix and final full-list
comparisons retain order, multiplicity and parameter fidelity. Wrong-order and
missing-state calibrations challenge the same comparison. Replay registration
retains seed and shrink-path entry points. A direct replay with seed `2205`,
path `0:0:0:0:0:0:0` and unit `random seed: all recording cuts 1` rejects the
early-retirement mutant at `recorded SQL`, under `recording frame` (one failed,
24 skipped). The explicit transform marker confirms that the mutant loaded.

ORC-001 through ORC-007 and ORC-012 through ORC-016 apply and are supported by
the law, independent list model, literate grammar, actual helper driver,
intermediate/final comparisons, wrong-result controls, two equal-budget
campaigns, required reach and real Electron receiving execution above.
ORC-008 does not apply: the model is a stateless projection of authored SQL.
ORC-009 uses the local term recording frame only for this fixture's interval;
it is not a Collection sync run. ORC-010 retains a failing receiver's raw
observation and separates pre-checkpoint launch failures from law violations.
ORC-011 has no additional shared semantic-fault hypothesis: authored statements
and a transport sequence buffer already use different formulations.

From `packages/electron-db-sqlite-persistence`, with Node 22:

```sh
pnpm exec vitest run tests/reload-sql-recording-oracle.test.ts tests/reload-class-oracle.test.ts
pnpm exec vitest run --config vitest.e2e.config.ts tests/reload-class-oracle.electron.e2e.test.ts
pnpm exec tsc --noEmit
```

CI subsequently caught an invalid replay-manifest tuple: an empty suffix added
a trailing dot to the property ID. Splitting the tuple into its actual prefix
and suffix repairs registration. The complete `db/tests/oracle-replay.test.ts`
suite passes 124 tests with no type errors after that mechanical correction.

## Adapter receiver runner shutdown

CI on `3c11391ff` passed all 31 other checks, including actual desktop Electron,
the Node 22 matrix and the aggregate Test gate. The adapter-browser runner
received an external shutdown signal after 65 minutes. Its log still showed
generated native PowerSync decoder histories progressing immediately before
shutdown, with no assertion failure. The aggregate E2E gate correctly failed.
This is infrastructure evidence, not a semantic GREEN result or an identified
library defect. Earlier attempts also recorded runner failures.

The E2E workflow now partitions the same receiver command with Vitest's
`--shard=1/4` through `--shard=4/4`. All four matrix jobs remain dependencies
of the aggregate E2E gate. Each shard gets a separate runner and artifact name.
The file selection, models, comparisons, campaigns, construction counts and
budgets are unchanged. No library production code changes.

An actual Vitest CLI discovery run selected the full 34-file receiver portfolio
exactly once across the four shards (9, 9, 8 and 8 files). The witness used a
nonmatching test-name filter and compared the four JSON reports' `testResults`
against the unsharded file inventory. It proves partition completeness only:
the 5,918 discovered tests were deliberately skipped in that local witness.
`vitest list --filesOnly` ignores the shard flag in this installed version, so
the initial list-only attempt supplies no partition evidence. Workflow YAML
parsing and formatting also pass. CI must still supply each shard's semantic
result before merge.
