# Conversion CI follow-up

PR #2403 first ran at `2fabfb3ec8c085e1c42754868c7d78607dc1b425`.
The IVM package's ESLint command rejected the hash-graph import order.
Running the full Preact package command also exposed implicit parameter types
in the conditional array of width-change calibrations. The earlier focused
Preact run had passed without reporting those source diagnostics.

The repairs move one type-only import and explicitly type the calibration's
trace and history. TypeScript's `transpileModule`, with ESNext module/target
and Preact JSX settings, emits byte-identical JavaScript for both files before
and after these repairs. The models, histories, run budgets, observations and
comparisons are unchanged. The source-bound mutation records retain their
original reviewed blobs; these two subsequent type-only edits do not claim a
new mutation run.

Validation after the repairs:

- The native IVM ESLint command passes for the hash-graph owner; its 15 tests
  pass with no type errors.
- The default Preact package command passes all 357 tests, with no type or
  source errors and coverage enabled.
- Native Preact ESLint and formatting pass for the changed files.
- Full local workspace lint passes IVM and DB, then encounters two unchanged
  Electric support type-assertion diagnostics in the partial local install.
  Those files are unchanged from merged main and are not edited here. Final
  clean-install CI supplies the full-workspace lint result.

Commands run from the worktree root:

```sh
pnpm --filter @tanstack/db-ivm exec eslint tests/hash-graph-oracle.property.test.ts
pnpm --filter @tanstack/db-ivm exec vitest run tests/hash-graph-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/preact-db test --maxWorkers=2
pnpm --filter @tanstack/preact-db exec eslint tests/window-render-oracle.test.tsx
```
