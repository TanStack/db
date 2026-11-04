# GC direct-start reach repair

The commit first adding this record binds its evaluated test source. The
baseline for the CI reproduction is `1344ee84901bb797f98bfb486aaf3480822b0f44`.

The Angular PR's core test shard failed because a random GC campaign generated
no `write-started-sync` history. The source and model were unchanged by that
PR. This follow-up repairs the existing oracle's sampling gap without changing
the retention contract, production code, assertions, or reach requirements.

## Law and repair

Authority remains `BaseCollectionConfig.gcTime` and the shared model in
`collection-gc-retention-oracle.ts`. Direct insertion can start an idle
Collection's sync; persisting transactions retain it, and their release respects
the startup handoff deadline. The existing driver compares public retirement,
rows, and transaction states against independent logical holds and deadlines.

Previously, the mixed generator selected one of 15 focused scenarios and then
a direct-insertion boolean, inside a weighted mixture with two other grammars.
A legal run could omit direct startup entirely. Each normal fixed/random
campaign now first generates ten direct-start histories using the existing
startup scenario and its random parameters. The original 250 mixed histories
still run with the same generator and seed/path coordinates. Explicit path
replays skip the extra prefix and run only the requested mixed history.

This adds coverage of an existing receiving path. It does not relax the model,
count fixed examples as generated reach, or replace interaction histories.
Configured delays, ages, outcomes, and sibling transactions still vary in the
prefix. The same model, production driver, and comparisons execute both parts.

## Evidence block

- **Law:** the existing retention and startup-handoff law applies to a
  Collection whose first direct insert starts sync.
- **Reach:** the required state remains in `boundaryStates`, with minimum one.
  The normal fixed/random campaigns reached it 15 and 17 times respectively;
  all other declared states also reached their minimum. Each campaign adds ten
  generated direct-start histories while preserving its 250 mixed histories.
- **RED:** on the unchanged oracle, seed 706 reproduced CI's reach failure:
  `write-started-sync (0)`. All sampled observations passed; the failure was the
  independent reach guard, not a production mismatch or a timeout.
- **GREEN:** the GC oracle file passed all nine tests, including fixed/random
  campaigns and reconstruction witnesses. Seed 706 passed after the repair.
  The replay suite and GC file together passed 50 tests. Focused ESLint and
  a typecheck of the two changed test modules passed on Node 24.8.0.
- **Mutant:** temporarily omit the generated prefix while retaining the
  refactored mixed generator. Seed 706 again fails `write-started-sync (0)`.
  This confirms that the prefix repairs reach and that the original mixed
  generator still reproduces the missing-state trace. The mutant was restored.
- **Limits:** this repairs generation reach for one existing path, not a new
  product defect. It does not guarantee every other random reach state by
  construction, change the current controlled idle-host assumptions, or expand
  native-browser/provider coverage.

Reproduction command from the repository root:

```sh
TANSTACK_DB_ORACLE_SEED=706 pnpm --filter @tanstack/db exec vitest run tests/collection-gc-retention-oracle.property.test.ts -t 'preserves retention across transaction phases' --coverage.enabled=false
```

Guarded path replay also passed from `packages/db` with property
`collection-lifecycle.gc-retention-boundaries`, seed 706 and path `0`:
one completed matching witness, one execution, and no generated prefix.

The grammar refactor only adds an optional startup selector to the existing
scenario factory. Its default produces the original mixed arbitrary. No model
state, model rule, legal action, comparison checkpoint, or fixed reconstruction
input changed. The ten-case prefix participates in both normal campaigns with
the same budget; the 250-case mixed budget is preserved. This supplements the
earlier GC owner records rather than replacing their evidence or limits.

Grammar controls preserve gcTime 1/10/49/50/51/100ms, ages 0–80ms, sibling
holds, and completion/failure/rollback outcomes from the original startup lane.
Removing the prefix reconstructs the seed-706 miss. Removing forced direct
insertion loses this receiving path; removing parameter variation would reduce
it to a pinned trace. The prefix excludes unrelated focused lanes and keeps
the existing action-legality checks and cleanup. There is no new model state
or second expectation, and no concrete shared-model fault requiring another
formulation was identified. The native-host premise is unchanged and remains
outside this sampling repair. Ordinary reconstruction tests still use the
shared model/driver/comparison; no unit tests were added to the oracle.
