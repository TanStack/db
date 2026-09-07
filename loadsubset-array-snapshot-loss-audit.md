# Array snapshot extraction: loss-audit

**Bounded null:** this static pass found no supported baseline behavior or test assertion dropped by the array-loop extraction from `4b248b47` to `3623df29`. No recovered loss item or dropping rule was established.

The selected instrument was Field Lab’s Hidden-signal recovery assay (`loss-audit`), run once in a fresh child context at medium, bounded scope. Prior reviews, audits, and TODO material were not read. No child delegation occurred.

## Frozen sources and control

Only these two source files were inspected, through frozen `git show` output in `/Users/kylemathews/programs/tanstack-db/.worktrees/codex-loadsubset-minimal-stack`:

- **S:** `packages/db/src/query/subset-dedupe.ts`, baseline `4b248b47` and candidate `3623df29`.
- **T:** `packages/db/tests/query/subset-dedupe.test.ts`, the same two revisions.

Pointers below are revision-qualified blob line numbers, not claims about the live checkout. Each source was traced against its candidate version. The source and test file shared this child context; they were not isolated from each other. Applicable instructions were read separately. No live source, old output, dependency implementation, or external source was used.

The frozen reduction replaces two descriptor-reading loops with `snapshotArray(value, snapshotElement, context)`. The supplied claim preserves the different membership and ordering policies, nonarray handling, holes, descriptor safety, rejection text, opaque identity, and existing tests. `cloneExpression` is unchanged.

## Source preservation trace

| Baseline item and support | Candidate location and trace | Dropped item |
| --- | --- | --- |
| Membership returns a nonarray unchanged: `4b248b47:S:164–165`. | `3623df29:S:164–165` retains the same early return. No helper or comparable snapshot runs for a nonarray membership operand. | None found. |
| Membership snapshots only the outer array, applying `snapshotComparable` to each own data element: `4b248b47:S:166–175`. Opaque values, including nested arrays, retain identity through `S:144–161`. | `3623df29:S:166` selects `snapshotComparable`; `S:179–188` constructs and fills the outer array. The comparable implementation remains unchanged at `S:144–161`. Nested arrays still reach its opaque-reference return. | None found. |
| Ordering recursively snapshots array elements and applies comparable handling to nonarrays: `4b248b47:S:178–189`. | `3623df29:S:169–171` retains the nonarray branch and passes `snapshotOrdering` itself as the helper callback. `S:186` calls it for each present data element, preserving recursive descent. | None found. |
| Sparse arrays keep their length and holes; inherited indices are not read: `4b248b47:S:166–169,180–183`. | `3623df29:S:179–182` uses the same array allocation, increasing-index loop, own-property descriptor lookup, and missing-descriptor skip. The loop still reads `value.length` at allocation and each condition; extraction does not replace this with enumeration or iteration. | None found. |
| Own accessors cause a `TypeError` before their getter runs, with policy-specific text: `4b248b47:S:168–173,182–187`. | `3623df29:S:181–186` keeps the descriptor-value guard before element processing. Call-site strings at `S:166,171` produce exactly `Cannot snapshot membership candidate accessor` and `Cannot snapshot ordering operand accessor`. | None found. |
| Date and byte snapshots, Buffer treatment, and opaque-reference fallback: `4b248b47:S:144–161,192–203`. | `3623df29:S:144–161,191–202` preserves these bodies. The helper changes neither comparison-domain checks nor the value passed to them. | None found. |
| Expression-context selection and propagation: `4b248b47:S:99–141`. | `3623df29:S:99–141` is unchanged, including membership’s second-argument rule, equality routing, ordering names, and inherited context. The extraction does not merge these policies. | None found. |

The visible compression removes duplicate loop text. It retains the two distinct element policies as callbacks and the two rejection labels as arguments; neither distinction vanishes into the shared helper.

## Test preservation trace

The baseline test source yields no removed behavioral assertion. `4b248b47:T:14–375` remains at `3623df29:T:14–375`, including transport/reset behavior, mutable equality values, opaque cursor identity, cross-realm bytes, and membership wrapper snapshots. These are preserved fixtures, not fresh execution evidence.

- The import reorder at `T:1–2` retains both imports. The tuple mutation at `4b248b47:T:381` becomes `3623df29:T:381` without the redundant nonnull assertion; the mutation and expected `[1, [2]]` at `T:383` remain.
- The membership accessor fixture at `4b248b47:T:386–397` survives as the `in` row at `3623df29:T:386–405`. It keeps the own accessor at index zero and rejection text, adds an ordering row, and asserts that the getter was never called. Parameterization does not omit the former membership assertion.
- New sparse fixtures at `3623df29:T:407–433` cover both policies, a length-three array with only own index one, an inherited getter at index zero, absent own indices zero and two, and a copied Date whose value survives source mutation.
- New depth fixtures at `3623df29:T:435–454` explicitly retain the policy split: membership preserves the nested array reference and observes its Date mutation; ordering copies both the nested array and Date and retains the original time.

No test-level compression or category merge was found to erase a baseline expectation.

## Evidence and limits

**Supplied evidence, not rerun here:** baseline 24 passed / 0 failed; candidate 103 passed / 0 failed; zero skips; types and lint passed. These totals do not establish identical suite selection or independent reproduction by this child. No tests, builds, type checks, lint checks, source edits, or commits were performed.

This is a static correspondence result for the selected extraction, not a proof of all runtime behavior. Stack use and recursion limits after adding a helper call were not measured. Dependency behavior and callers outside the two-file bundle were not examined.

The added fixtures use `in` and `gt`, ordinary finite arrays, one nested-array level, and Date leaves. They do not themselves exercise every ordering operator, deeper nesting, proxies, or all nonarray comparison domains. Those limits do not establish a new loss.

The operation may hide differences by organizing the scan around the supplied preservation claim and the same small fixture shapes used by the change. Reading implementation and tests in one context also makes their omissions correlated. The returned null is confined to the source-supported items traced above; it carries no ranking, redesign, recommendation, or merge judgment.
