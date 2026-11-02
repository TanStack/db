# Declared reach machinery (PR #2290)

This record applies to the executable oracle at commit `590588a65`. It is
append-only: a later change adds an entry with its own commit and does not
edit an earlier one. It records the evidence behind the
`oracle.declared-reach` owner in the coverage map's "Oracle tooling" section.

## Entry 1: commit `590588a65`

### Scope and laws

The oracle owns these laws of `createOracleReach`, `runOracleCampaign`,
`oracleRandomParameters`, and `oraclePropertyOptions`. Authority is ORC-015,
ORC-007, issue #2287, and maintainer decisions in the PR #2290 session.

| Law | Authority | Generated witness |
| --- | --- | --- |
| A history counts once per declared state it enters | ORC-015 | repeats within a history |
| A reach call for an undeclared state, or before the first history, throws and counts nothing | maintainer decision | undeclared index, early reaches |
| Invalid options throw at creation | maintainer decision | minimums 0, -1, and 1.5. Fixed counts -1 and 0.5. A state declared twice |
| The check fails below the minimum | ORC-015 | minimums 1 to 3 |
| A fixed history is one begun with `fixed: true`. The check fails for a state that no fixed history entered. An extra fixed history counts as fixed. Too few fixed histories report only the stop | #2287, maintainer decision | fixed marks per history, an unfixed history first, extra and missing fixed histories |
| A seed-only run checks reach, any path replay in the process skips it, an explicit `replaying` overrides the environment | maintainer decisions | four run kinds, optional override |
| Examples come on top of the base runs, a replay keeps its seed, a path replay of the property keeps its path and runs once | #2287, ORC-007 | run kinds, base runs 1 to 200, up to five examples, the process multiplier |
| `runOracleCampaign` runs fixed-seed and random campaigns, or one replay campaign, passes each its parameters, reports each passing campaign, and rejects an invalid environment | ORC-007, ORC-015 | run kinds, a fixed seed, three invalid environments |

The law discovery behind this table, with the receiving-path inventory and
tension scan, found that the earlier oracle stated only the fixed-example law.
Reviews then found the other laws one round at a time.

### Experiments

RED results. Each was run on the parent of its production change with the
extended oracle:

- Option validation: the oracle failed at fixed ledger 9 (`minimum: 0`), where
  the reach did not throw.
- Fixed marks: with validation in place, the parent's reach failed at fixed
  ledger 12, where the model of that draft expected a throw. With the final
  model, a mutant that restores the parent's positional counting fails at
  fixed ledger 13, an unfixed history before the fixed one.
- An extra fixed history: an intermediate draft threw for it. The oracle
  failed with that throw, and a mutant hunt showed that the throw replaced the
  original assertion failure while fast-check shrank an example. The model
  now credits the extra history, and production no longer throws.
- Early reach, the stopped-run report, and seed-only checks in
  `createOracleReach` and `runOracleCampaign` failed on their parents in the
  same way, in earlier commits of this PR.

Limit on order: the first commit of this PR changed the seed-only rule and
added `fixedHistories` before this oracle existed. Their RED results were run
afterward against that commit's parent. They are not a pre-change gate.

GREEN result at `590588a65`, from `packages/db`:

```sh
pnpm exec vitest run --maxWorkers=2 --coverage.enabled=false \
  tests/declared-reach-oracle.property.test.ts \
  tests/source-health-oracle.test.ts tests/oracle-reach.test.ts \
  tests/oracle-campaign.test.ts tests/mutation-handler-types-oracle.test.ts
```

All 556 tests pass with no type errors. The declared-reach property runs 200
generated ledgers and 14 fixed ledgers. The 14 fixed ledgers enter its 14
declared reach states in every run.

Mutants. Each changed one decision in the machinery, ran the declared-reach
oracle, and was restored. All 23 failed at an assertion of the intended
comparison (`reach verdict`, `campaign observation`, `run parameters`, or
`property options under this process`):

- Fixed counting by position, extra fixed histories not credited.
- Accepting minimum 0, a fractional fixed count, or a duplicate state.
- An ignored campaign fixed seed, a replay campaign without its seed, a path
  replay campaign without `numRuns: 1`, a wrong `ORACLE_REACH` minimum,
  accepting a non-numeric campaign path.
- An ignored `replaying` override, accepting an undeclared state, counting an
  early reach.
- Skipping reach only for the named replay property, skipping reach in a
  seed-only run, in `createOracleReach` or in `runOracleCampaign`, checking
  reach in a campaign path replay.
- Dropping `examples` in `oraclePropertyOptions`, dropping the replay seed and
  path with examples, letting examples displace random runs.
- Naming states after a stopped run, removing the fixed-history check,
  counting a state twice in one history.

A first draft of the extra-fixed mutant capped a counter that is only compared
with the declared count. It survived, and it is equivalent by that invariant.
A separate run with `TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=2` rejected a mutant
that ignores the multiplier.

Receiving paths. With the new rules, the complete suites of `db` (385 files,
24,216 tests), `db-sqlite-persistence-core`, `offline-transactions`,
`electric-db-collection`, `svelte-db`, `convex-db-collection`, `preact-db`,
and `db-ivm` pass. One `db` file, `mutation-handler-types-oracle.test.ts`,
declared each state six times on purpose and threw. It now declares each
once, and its counts are unchanged. `react-db` passes every test, with type
errors from unbuilt packages in this checkout. Two `query-db-collection` files
and `browser-db-sqlite-persistence` need native SQLite bindings that this
checkout lacks, so only CI runs them.

### Rubric outcomes

- ORC-001, ORC-003: the oracle's opening prose states each law, its authority,
  and its limits. The model, grammar, drivers, and checks have their own
  comments.
- ORC-002: the model recomputes counts and failures from the ledger and reads
  the environment on its own. It imports no production helper.
- ORC-004: the grammar reconstructs every known witness above as a fixed
  ledger. Its ranges and invalid values are listed in the law table.
- ORC-005, ORC-006: the drivers call the real entry points and compare whole
  observations. The mutants above classify as assertion failures.
- ORC-007: the property runs through `oraclePropertyOptions` with fixed
  ledgers, and replays through `oracle.declared-reach` in the replay manifest.
- ORC-008: the model keeps a fixed mark per history. The unfixed-first ledger
  shows that position alone cannot replace it.
- ORC-009: "ledger" and "run kind" are model-only terms. The oracle maps them
  to histories and replay environments.
- ORC-010: the extra-fixed rule exists so that a shrinking rerun cannot
  replace the original failure.
- ORC-011: no shared-fault hypothesis needs a second formulation.
- ORC-013: each conditional law has a premise case and a neighbor among the
  fixed ledgers (for example, a fixed miss that a later unfixed history enters).
- ORC-014: not applicable. No provider premise.
- ORC-015: 14 declared states, each entered in every run.
- ORC-016: the oracle file has one generated property and no unit tests.

### Open and limits

- Other reach properties are not measured for chance misses, about twenty set
  examples inside their base runs, and a campaign reach cannot declare fixed
  histories. Owner: #2289.
- A path replay also skips reach in a property that the replay does not name.
- After a late property failure, the check still reports missed states.
- Not judged: reporter keys, the rejection of an unregistered property, and
  the compile-time rule that a call without examples returns no `examples`
  key. Type-aware lint is that rule's only witness.
- Before the merge with main, one local batch failed 1 of 512 tests and its log
  was lost. It did not recur in 12 reruns. Its cause is unknown.
