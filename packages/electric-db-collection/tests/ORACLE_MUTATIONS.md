# Electric oracle mutation ledger

Run each mutation alone from `packages/electric-db-collection`, confirm the
named test fails, then restore the source before trying the next mutation.
The baseline command is:

```sh
pnpm test:oracles
```

1. Collection-local evidence

   In `src/electric.ts`, replace `consumeDescriptorEvidence()` with
   `descriptorEvidence` when a bound sync is created.

   Killed by: `generated process grammar preserves lifecycle and
concurrent-collection isolation`.

2. Stale callback isolation

   In `src/electric.ts`, remove the active-lifecycle term from either
   `processMessages` lifecycle guard.

   Killed by: `settles every startup, hydration, snapshot availability,
commit, and cleanup permutation` and `keeps stream cleanup and stale
callbacks scoped to their lifecycle`.

3. Acknowledgement liveness

   In `src/electric.ts`, delay `seenTxids`, `seenSnapshots`, and matched-message
   publication until a pending applied receipt resolves.

   Killed by: `txid tracking > should simulate the complete flow` and the
   direct-persistence-handler flow tests. Those handlers must receive stream
   acknowledgement before the parked optimistic transaction can finish.

4. Durable convergence

   In `runPersistedTrace` in `electric-oracle.property.test.ts`, make the
   wrapped `applyCommittedTx` resolve without calling the saved adapter method.

   Killed by: `denotational reference, Electric, persisted Electric, and query
adapters converge across controls and publication epochs`.

Use this focused form while iterating:

```sh
pnpm exec vitest run tests/electric-oracle.property.test.ts -t '<killing test>'
```

These mutants test the named laws. They do not claim exhaustive mutation
coverage of the package.
