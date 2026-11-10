# Lifecycle raw-commit and completion-handoff evidence

Base: `c351fc04d7f70dc59bf92ecbed310f899b9511cd`. This record covers the
lifecycle grammar, lifecycle-history driver and lifecycle boundary oracle.
Production was edited only by ROOT. No install, commit or source swap was
performed by this agent.

## Law and distinguishing predictions

Authority: the October 30 maintainer decision recorded in
`docs/contributing/oracle-reviews/2026-10-30-raw-collection-publication-decision.md`.
Applied source transactions determine raw subscriber rows. A pending or failed
acquisition cannot suppress an explicit raw snapshot callback or retract an
applied source transaction. Caller results, acquisition ownership, readiness
and complete-result publication remain separate obligations.

The former lifecycle grammar counted an explicit snapshot callback only when
the replay publication barrier was closed. It now counts that callback during
pending and failed replay too. The async-restart driver folds fixture-authored
source transactions into independent keyed maps and compares the subscriber
after each individual settlement. Thus a first accepted replacement commit
must appear before a sibling settles, including when that sibling later fails.
Exact caller values and error identities, signals, releases, status transitions,
callback ordering and terminal fencing remain checked.

Cleanup is not an applied source transaction. A raw subscriber may retain its
previous rows after cleanup until an applied transaction reconciles them. The
cleaned-up demand grammar preserves an empty on-demand loader that returns
without a commit; its caller fulfills while its raw fold retains the old row.
An adjacent history commits an actual empty transaction and must remove that
row. Eager readiness independently establishes the complete eager source.
Both histories retain strict caller-settlement checks.

## Internal handoff and its limits

Each generated input runs the complete default raw history. It also runs a
controlled receiver of `truncateReplayPublication` through the first cleanup
or unsubscription. Source cleanup crashes a dependent live query; retaining
this synthetic receiver through a source restart would not establish a legal
public graph path. Real graph results belong to the live-query receiving owner.

The model's publication barrier combines restart acquisition and truncate
replay. The internal pending/failed publication flags describe truncate replay
only. Completion promises are observed separately from raw callback counts.
After the last logical owner retires, the internal wait must settle; fulfillment
and cancellation with `AbortError` are both permitted. Public caller outcomes
remain strict and are not covered by that implementation freedom.

Two checker calibrations supply wrong recorded completion observations to this
same model, driver and comparison: fulfillment before completion, and a wait
that stays pending after successful completion. Both are rejected at the
completion assertion. They do not modify production.

## Executed results

`lifecycle-raw-commit-green4.{stdout,stderr}.log`: exit 0, 211 tests passed in
38.64 seconds. This includes all 112 lifecycle boundary tests, both completion
calibrations, and the fixed/random generated lifecycle campaigns. No run budget
was reduced. This full run precedes only the diagnostic reporting change from
`console.info` to `process.stdout.write`.

`lifecycle-raw-commit-reaches2.{stdout,stderr}.log`: exit 0, four selected tests
passed in 32.14 seconds. The final reporting code runs both 400-history
demand-change campaigns and both completion calibrations. Pinned examples and
shrinking do not contribute to the reported generated reach or its minimum.
The fixed seed is `1657005`; the other campaign is unseeded.

| Declared state | Fixed | Random |
| --- | ---: | ---: |
| Raw snapshot during unresolved replay | 209 | 224 |
| Pending completion handoff | 349 | 356 |
| Rejected completion handoff | 145 | 125 |
| Fulfilled completion handoff | 79 | 92 |
| Cleanup or unsubscription abort | 17 | 17 |
| Change retires several owners during replay | 194 | 208 |
| Held replacement covers a failed owner | 14 | 19 |
| Judging between releases would publish prematurely | 7 | 6 |
| Judging between releases would fail prematurely | 23 | 23 |

The machine-readable counts are in `lifecycle-raw-commit-reaches.json`.

Final focused TypeScript, ordinary ESLint and the changed-file oracle hook all
exit 0 with empty stdout/stderr logs. Their filenames begin
`lifecycle-raw-commit-typecheck`, `lifecycle-raw-commit-eslint` and
`lifecycle-raw-commit-oracle-lint`. The TypeScript config extends the ordinary
DB test config and includes the three owned lifecycle files and their imports;
it is not a whole-repository typecheck.

## Preserved failures and provenance

The compressed handoff reports two assertion REDs on unchanged production:
missing raw snapshot callback after failed restart, and a hidden first restarted
source commit. Exact invocations and capture files were absent from this agent's
resumed context. This record does not present that handoff statement as a
separate file-backed RED result. ROOT was informed of the provenance limit.
The primary raw-commit and real-adapter RED evidence is recorded separately.

The intermediate `green1`, `green2` and `green3` logs remain diagnostic evidence,
not successful verification. They exposed an introduced eager-readiness
regression: publish old; cleanup; request a snapshot; restart while eager source
readiness is held; apply `truncate({ markReady: false })`. The Collection remains
loading and the caller pending, but the subscription incorrectly became ready.
The empty no-demand replay drained into `setReadyIfIdle`, which ignored the
detached eager wait. ROOT reports the eight corresponding pristine-source cases
pass. ROOT removed that unnecessary no-demand replay; all eight pass in the
full final run. Their readiness assertion was not relaxed.

The earlier diagnostic runs also caught test-boundary mistakes in the newly
added handoff checks: graph retention flags were incorrectly expected on a
default raw receiver and on restart acquisition, and an internal wait's exact
fulfillment was required after its last owner retired. The final driver names
those boundaries explicitly, preserves every raw history, and checks actual
public caller outcomes independently.

## Commands and source bindings

From `packages/db`, the full run was:

```sh
/usr/local/bin/node ../../node_modules/vitest/vitest.mjs run --config /tmp/collection-publication-core.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --fileParallelism=false tests/collection-subscription-lifecycle-history-oracle.property.test.ts tests/collection-subscription-lifecycle-oracle.test.ts
```

The final reach run uses that command with only the history file and
`-t 'judges a replay once per demand change|corrupted.*replay completion observation'`.
The config merges the ordinary DB config and aliases DB-IVM to this worktree's
source. Existing missing Expo tsconfig warnings remain nonfatal diagnostics.

Final SHA-256 bindings:

| File under `packages/db/tests/` | SHA-256 |
| --- | --- |
| `collection-subscription-lifecycle-grammar-oracle.ts` | `48a4a1cd20eb1ebebeef1ae3b71dc8f45ed677262007519cefb52e186105191e` |
| `collection-subscription-lifecycle-history-oracle.property.test.ts` | `114f7772365aaa04e0efddcf063ea5ddfade594cf5726dab2757397c777d1ceb` |
| `collection-subscription-lifecycle-oracle.test.ts` | `5b6cadb89e94070bb5238d2ea8cfbfe3fa6155a818c7803d425dbd03c0da902a` |

These controlled lifecycle results do not establish real Query/persistence
receiving behavior, sibling graph barriers, arbitrary optimistic histories,
or universal closure. Those obligations retain their existing owners. The
production hostile mutant and complete behavior-change evidence belong to
ROOT's combined review record; this record supplies lifecycle GREEN, measured
generated reach, and completion-checker calibration.

## Ordinary lifecycle follow-up

ROOT's broader regression run found twelve obsolete row-retention expectations
in `packages/db/tests/collection-subscription-lifecycle.test.ts`. Four cases
apply replay version 2 before reentrant cleanup; their raw fold must retain
version 2. Eight cases apply a truncate while obsolete work remains; the raw
fold must become empty immediately and remain empty when an aborted attempt
settles without writing. Only those three expected row expressions and their
explanatory prose changed. Acquisition counts, readiness, errors, exact unload
ownership and cleanup fencing checks remain unchanged. The shared grammar and
model were not edited for this follow-up, and no production defect was found.

`lifecycle-ordinary-raw-commit.{stdout,stderr}.log`: exit 0, all 26 tests passed
in 1.13 seconds, using the full-run command above with only that ordinary file.
Ordinary ESLint, the changed-file oracle hook and `git diff --check` also pass;
the lint log pairs start with `lifecycle-ordinary-raw-commit-eslint` and
`lifecycle-ordinary-raw-commit-oracle-lint` and are empty.
