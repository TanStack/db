# Direct endpoint exports

The compiler accepts `const { query, mutation } = endpoints(dbClient)` at module
scope, including `export const` declarations. Consumers import real collections
and synchronous actions. Component-local declarations remain supported.

Collection creation no longer starts reads. `endpointScope` accepts a string or
a synchronous getter, resolved on demand. Cache ownership is per DbClient; the
runtime pins its first valid scope and rejects a different one before dispatch.
Kitchen resolves its session in the existing authenticated route and reloads on
logout. A server-rendered app still needs request-scoped clients.

## Lifecycle repair

Changing declarations to start idle exposed a gap: refreshing one collection
also covers retained collections that have never started. Query's direct-write
utilities need their sync context initialized. Installing authority now starts
that context before writing, without waiting on a preload inside persistence.

The first browser campaign preloaded every collection before its assertions and
missed this state. Module-export programs now preload only their first collection
and compare all retained baselines against PGlite. The `omit-cold-start` fault
removes the initialization in a disposable runtime. The expanded oracle reports
`retained-baseline-after-demand`: the first collection contains its row while
the other two are empty. Its receipt records applied, reached, and intended
rejection. The same replay passes with the fix.

## Verification

- Compiler/lifecycle contracts pass, including inert declarations before login,
  scope changes, and classified rejection of exported binder functions.
- Generated SQL campaign: 10 scenarios × 3 sequences plus fixed controls;
  20 compilations, 176 operations, 300 settled collection comparisons.
- Browser campaign: 9 programs, 63 operations, 126 optimistic/settled comparisons,
  plus initial-demand comparisons; 36 production client assets/maps scanned.
- Cold replay: expected red, then 2 operations and 6 comparisons green.
- Kitchen: production build, typecheck, lint, 104 compiled SQL comparisons,
  240 browser collection comparisons, anonymous imports with no endpoint reads,
  and 33 production client files scanned without server markers.

[Receipts](./evidence/module-exports/) include the complete replay and source
fingerprints. Run the replay with:

```sh
ENDPOINT_ORACLE_MUTANT=omit-cold-start node tests/oracles/compiled-browser.mjs \
  --replay evidence/module-exports/cold-replay.json
node tests/oracles/compiled-browser.mjs \
  --replay evidence/module-exports/cold-replay.json
```

Kitchen removes its endpoint factory, initialization/access helpers, and write
wrappers. Routes import endpoint exports directly, tag helpers only build inputs,
and the shared recipe-card query is a module export.
