# Observer hydration campaign conversion

The baseline is `0c45b987fcdc8c7401bdffede82260e59a79ac5d`. Production is
unchanged. The converted oracle's SHA-256 is
`0c4899cdb5e5c53ce967a36af79744fc9fb3ab877d2a6d7873b90b631f83c58f`.
The source commit is `b973af061893f3ccba38743f3784d77668562e47`.
No complete mutation preservation comparison is available; this record makes no
mutation preservation claim. The user's subsequent instruction makes this a
mechanical API migration with focused native, type, and lint validation, without
a complete mutation comparison as an integration gate.

## Law and observation

The existing hydration contract remains: an observer retains its hydration seed
while a ready Collection has held subset work. When that work settles without
rows or status changing, the observer shows the local rows and announces that
snapshot. Both granular and wholesale consumers are required. The authority is
the oracle's existing hydration handoff contract and the SSR guide; the Svelte
transported-page receiver supplies the same premise through retained live-query
Collections. The terminal-status campaign retains its existing architecture-law
16, cleanup, restart, and announcement judgments.

The subset production driver now records the original cuts instead of asserting
inline: immediately after external subset demand, after seeded attachment while
the subset is held, and after controlled settlement. The model derives held and
settled snapshots from the authored hydration and local rows. Source status and
subset-loading observations check the premise; they do not choose the model's
owed rows. The comparison also checks the listener's last snapshot and, for a
granular consumer, the rows rebuilt from delivered changes. It checks earlier
recorded observations before reporting a missing later cut.

## Histories, run budgets, and reach

The subset grammar is unchanged: hydration row count 1..3, local row count 0..3,
and version 0..3. Every history performs the controlled held-to-settled path.
Each consumer retains its own fixed-seed and random campaigns, fixed seed 2345,
and eight generated histories per campaign. Each campaign adds a constructed
history that retains the generated dimensions. All four campaigns reported nine
entries in each state: `ready while subset held` and `subset-only handoff`.

The old shared replay name `live-query-observer.hydration-subset-handoff` is
replaced by `.granular` and `.wholesale` names. A run-budget report that calls the
old key removed reflects this split; each of the two eight-run consumer
campaigns remains. No run budget is reduced. The terminal campaign keeps its
100-run budget and fixed seeds 20260 and -88123.

The terminal campaign records each constructed builder invocation's obligations
in a WeakMap keyed by its fresh history. Its model derives actual entries from
the recorded source transitions. The comparison enforces the obligations for
fresh generated and shrunk outputs, as well as the seed-derived examples that
the pinned framework itself associates. The subset comparison enforces both
required states on every history because every legal input performs both steps.

## RED and GREEN

The terminal reach calibration removes the detached readiness transition from a
constructed history's recorded source input. With the independent reach check
removed, the calibration fails because the check passes this wrong observation;
the diagnostic names `constructed history: readiness while detached` and law
`constructed reach`. Restoring the independent check makes this calibration and
the complete owner pass. The saved RED log is
`.cache/oracle-conversion-recovery/observer-hydration/generated-reach-red.log`.
That calibration exercises a seed-derived construction; it does not by itself
establish enforcement on freshly generated constructions.

A separate source-preserving control captures the actual owner's property
options and runs its existing native factory, grammar, model, production driver,
and comparison. The first invocation of each builder remains honest, so all 11
seed-derived constructions enter every required state. Only later freshly
generated detached-readiness constructions have their recorded readiness entry
omitted. Under the original native-only enforcement, seed 20260 passes despite
eight generated histories missing `ready-under-seed:detached`. With the shared
check restored, the same campaign fails after 24 histories, campaign seed 20260,
path `23:0:0:0:0`, at `constructed states`, law `constructed reach`; shrinking
retains that law. The reduced history is an empty hydration seed followed by
`ready; restart`, with a granular consumer and eager source. This is a named
comparison rejection, not a setup failure or timeout. The control changes no
tracked source bytes. Its fixture, raw logs, and counts are retained in
`.cache/oracle-conversion-recovery/observer-hydration/generated-only/`.

The same harness checks failure fidelity through the actual native factory. If
the driver records the missing transition and then throws a unique error, the
check's virtual checkpoint `constructed states` cannot establish an earlier
observed failure. The framework retains the exact late driver error. This
control passes and records the exact error-identity result in `fidelity.json`.

With the omission wrapper absent, a guarded replay of the actual owner at the
RED campaign's coordinates, seed 20260 and path `23:0:0:0:0`, passes. Its witness
reports exactly one completed execution, `numRuns: 1`, `failed: false`, and one
entry in `ready-under-seed:detached`. The clean source hashes match the saved
final snapshots. The command is:

```sh
cd packages/db
TANSTACK_DB_ORACLE_PROPERTY=live-query-observer.hydration-terminal TANSTACK_DB_ORACLE_SEED=20260 TANSTACK_DB_ORACLE_PATH=23:0:0:0:0 node --import tsx tests/oracle-replay.ts tests/live-query-observer-hydration-oracle.property.test.ts --maxWorkers=1 --coverage.enabled=false
```

The subset calibrations use the same model, production driver, and comparison
to reject a missing held-state observation, a premature handoff to local rows,
and a settled snapshot that is never announced. These are corrupted-observation
mutants rejected by named laws, rather than setup failures or timeouts.

Final focused validation passed 47 tests with zero type errors:

```sh
cd packages/db
pnpm_config_verify_deps_before_run=false pnpm exec vitest run tests/live-query-observer-hydration-oracle.property.test.ts --maxWorkers=1 --coverage.enabled=false
```

The complete replay suite first passed 117 controls and found one source-name
mapping failure. Naming the two consumer properties with literal mode/id tuples
fixed that failure. Registry equality, owner source mapping, and replay command
working-directory checks then passed together: three tests, zero type errors.
Guarded replays of the terminal property and both consumer properties, each at
campaign seed 42 and path 0, reported exactly one completed execution with
`numRuns: 1` and `failed: false`; fixed campaigns and unrelated properties were
skipped. Formatting, full ESLint on the four edited files, and `git diff --check`
passed. Raw logs and source hashes are retained under
`.cache/oracle-conversion-recovery/observer-hydration/`.

`pnpm lint:changed` returned 1 with three run-budget reports and no rule
diagnostics. The hydration report is the replay-name split explained above.
The other two reports concern the inherited Preact window property and
OP-SQLite fixed seed 165903; they are outside this draft. This is not a green
branch-wide lint result.

## Remaining mutation comparison

Run the complete owning source census twice, with the same pin, environment
prefix, campaign seed, settings, and production source bytes. The package's
declarations own `src/live-query-observer.ts`, `src/client.ts#DbClient.hydrate`,
and
`src/collection/subscription.ts#CollectionSubscription.handleCollectionCleanup`.
The third entry includes the cleanup/restart receiving path and its declared
static reference tree. The planned report instruments all three complete source
files; it does not exclude other functions in those files. Static instrumentation
with the pinned framework and its own TypeScript 5.9.3 produces 2,105 mutants:
393 in the observer, 657 in the client, and 1,055 in the subscription. This is a
static count, not executed mutation evidence. The exact static census is retained
in `static-census.json` beside its script.

The baseline's four files and hashes are retained in the ignored evidence
directory under `before/` and `before-hashes.json`. The converted four files are
retained under `after/` and their hashes in `final-evidence.json`. Restore those
baseline snapshots for BEFORE, and restore the converted bytes for AFTER. Use
independent cold CLI processes without
`--daemon`: the e1fb504 disk cache does not include the environment prefix in
its identity. Do not use a cache entry with unknown prefix provenance.

```sh
./node_modules/.bin/oracle-gaps --package packages/db --source src/live-query-observer.ts,src/client.ts,src/collection/subscription.ts --env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1 --out .cache/oracle-conversion-recovery/observer-hydration/gap-before
./node_modules/.bin/oracle-gaps --package packages/db --source src/live-query-observer.ts,src/client.ts,src/collection/subscription.ts --env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1 --out .cache/oracle-conversion-recovery/observer-hydration/gap-after
```

Compare exact stable mutant keys, require every BEFORE kill to remain killed,
and inspect all other changed outcomes. Preserve any old checkpoint rejection
that the legacy runner classified as a crash. Neither a partial census nor a
wrong-prefix cached capture establishes preservation. These commands describe
the required comparison; they do not establish completed evidence.

### Interrupted cold attempt

The first cold BEFORE process started at 20:08:49.234528 UTC on November 10,
2026. It exited by SIGKILL at 20:25:00.185607 UTC, after 16 minutes 11 seconds.
It was still in the first unmutated capture pass, at
`query/virtual-row-fields-types-oracle.test.ts`, and had produced no mutation
rows. The last captured tests passed. There was no CLI exception or OOM line.
Its last measured RSS was about 1.33 GiB. A narrow system-log query found no
runner-specific termination or memory-pressure record. The termination cause is
unknown. These observations do not establish a resource diagnosis.

The final source snapshots were restored and their hashes checked. The failed
output, log, process state, and runtime provenance remain under `gap-before/`,
`gap-before.log`, `pair-state.json`, and `loaded-runtime-provenance.json` in the
ignored evidence directory. They are incomplete execution evidence and cannot
support a preservation claim.

A maintainer-coordinated restart began at 20:32:30.466765 UTC. The supervised
pair preserves the same complete scope and settings. It records process IDs,
parents, exit codes, and signals, and restores the converted source in its final
cleanup. An independent monitor samples the wrapper, CLI, and descendants every
20 seconds. Its output uses the distinct `gap-before-restart1/` and
`gap-after-restart1/` directories. Native capture archiving hit the host's
`EMFILE` watcher limit; a stat-based watcher retains raw failure and verdict
rows with each capture's mutant state. Neither watcher changes the runner or
framework.

The user then requested that complete comparisons move to parallel CI. The
restart was intentionally stopped through the supervisor's supported TERM
cleanup. The intent was recorded at 20:52:26.838147 UTC, before signaling; this
is an intentional CI offload, not a spontaneous runner failure. The baseline
had passed file 116 and advanced to capture 120, but had no mutation rows.
The four final source snapshots were restored exactly; their hashes were
verified at 20:52:53.622613 UTC. The wrapper's signal 15 and resulting exit 1
reflect that requested stop. The capture, process, and host-memory watchers then
exited successfully; a final process query found no owned wrapper, CLI, or
esbuild descendant.

The restart's maximum sampled CLI RSS was 8,631,584 KiB. Contemporaneous host
samples reported 82% free memory and no swap activity. These samples do not
diagnose the original termination. The intentional-stop record is
`ci-offload-stop-restart1.json`; raw partial artifacts remain alongside it.
Neither local attempt establishes a complete baseline or mutation preservation.
Any future preservation claim requires fresh cold BEFORE and AFTER runs over
the same 2,105 exact sites. That comparison is not a gate for the subsequently
requested mechanical migration.

## Limits

This is a controlled plain Collection witness, with one held subset and bounded
row counts. It does not claim arbitrary provider schedules or new real-host
coverage. Existing receiving witnesses retain their own obligations. The
conversion has no production behavior change, and no claim that every mutation
gap in the three source files is closed.
