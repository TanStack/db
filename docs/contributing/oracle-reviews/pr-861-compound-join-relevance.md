# PR #861: relevance after merging current main

Assessment date: 2026-10-05.

The feature remains relevant, but this branch is not ready to merge. Current
main still rejects `and(eq(...), eq(...))` in a join callback. Issue #593 and
PR #861 were both open when inspected. The two correctness gaps below remain
open; this update does not claim a bug-class repair.

## Revision and update

- Original PR head: `82d50c00e580aeeabd54756b9efe61ca750e53cd`.
- Main used: `4070864414f26212dcef20e2537057bff8e21535`.
- Evaluated merge: `9838e88f78a8571f214874a587c6373318030b2f`.
- Local branch: `codex/compound-joins-861`; no remote push.

The merge preserves both histories. Conflicts in the builder, join compiler,
and optimizer were resolved against current compiler interfaces. Compound
joins retain the PR's full-source loading behavior and JSON key construction.
The compiler analyzes every operand before choosing parent routing. Existing
single-condition equality and lazy-demand handling remain on main's path.

The five PR tests now compare their selected fields explicitly, since public
rows also expose virtual properties. Their expected selected values and
multiplicities are unchanged. Test key callbacks infer row types instead of
using `any`; examples intended as inner joins now call `innerJoin` explicitly.

## Confirmed blockers

### Compound keys violate operand equality

`createJoinKeyExtractor` in `packages/db/src/query/compiler/joins.ts` serializes
raw operands with `JSON.stringify`. Fixed public-query witnesses show:

| Operands | Single equality control | Compound join |
| --- | --- | --- |
| Two distinct `{ n: 1 }` objects | No match | Incorrect match |
| `Infinity` and `-Infinity` | No match | Incorrect match |
| `new Date(0)` and its ISO string | No match | Incorrect match |
| `1n` and `1n` | One match | Throws during preload |

The first three fail exact selected-row assertions after preload. The BigInt
case passes its single-equality control, then fails in the compound compiler
before it can publish the expected row. These are production failures, not
mutation-test kills or successful bug fixes.

The smallest repair is to preserve the established equality identity for each
operand before encoding the tuple. The primary test owner is
`packages/db/tests/query/cold-join-reconciliation-oracle.test.ts`, which
explicitly excludes compound syntax today. Extend its value domain and
replacement histories across single and compound forms. Preserve nullish
non-matching behavior and distinguish partial tuple matches. The PR's test
named for null values currently supplies no null operands, so its passing
result provides no null-operand evidence.

### Query identity drops additional conditions

`canonicalizeJoin` in `packages/db/src/query/ir-stable-identity.ts` and
`normalizeQuery` in `packages/db/src/query/compiler/query-equivalence.ts`
serialize only the primary `left` and `right` expressions.

Two queries over the same sources share the first equality but use different
second fields. Fresh queries return `[{ id: 1 }]` and `[]`, respectively.
Nevertheless, `getQueryIdentity` returns the same identity and
`queriesMatchForCaching` returns true. Both identity assertions fail. This
violates the law that equal query identity implies equal compiled results.
The witness checks the identity boundary; it does not claim to exercise every
consumer cache or a framework hook.

The primary owner is
`packages/db/tests/query/identity-output-shape-oracle.test.ts`. Add compound
query pairs with equal primary and unequal additional conditions, then check
identity against independently compiled output. Extend coverage to compiler
subquery reuse. Existing forms never vary an additional condition.

## Validation and limits

- The six focused join/builder/subquery/equality/identity suites pass 265 tests.
- The DB and IVM packages build; the DB TypeScript check and changed-file lint pass.
- The five opt-in diagnostic tests fail on the two blockers above.
- Replacing only the merged builder file with main's exact builder makes the
  original compound-join example fail at join admission. The file was restored
  immediately afterward. This is a builder-boundary witness, not a separate
  all-main checkout run.

Dependency installation was attempted with the frozen lockfile. The configured
proxy returned 403 and public npm returned 503. Validation used the primary
checkout's installed external dependencies, linked into this worktree, and
built this worktree's own DB/IVM packages. It is not a clean frozen-install CI
receipt. Uninstalled Expo examples emitted configuration warnings; the named
builds and successful test runs exited zero.

No full monorepo or framework suite was run. Compound on-demand acquisition,
parent-correlated includes, nested subqueries, and incremental replacement
histories are not established by the five original examples. The coverage-map
follow-up records their receiving owners. No existing oracle was weakened.

Relative to main, the evaluated merge adds 140 and removes 33 production-source
lines (net +107, including source comments), adds 392 test lines, and retains
an 18-line changeset. This assessment and its replay artifact are separate
documentation weight.

## Reproduce the diagnostics

The adjacent `.probe.ts.txt` file contains ordinary failing tests, excluded
from the normal test discovery. From the repository root:

```sh
cp docs/contributing/oracle-reviews/pr-861-compound-join-relevance.probe.ts.txt packages/db/tests/query/compound-join-relevance.probe.test.ts
cd packages/db
node ../../node_modules/vitest/vitest.mjs run tests/query/compound-join-relevance.probe.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

After inspection, remove only that copied diagnostic file. The five failures
are expected on the evaluated revision. Do not count these as passing tests.
