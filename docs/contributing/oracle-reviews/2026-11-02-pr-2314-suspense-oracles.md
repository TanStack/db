# PR #2314: Suspense oracle follow-up

Reviewed executable revision: `138ab262192930f7783173b681c05bf6dcdd78a7`.
Original receivers and unchanged production: `a215be0d9baa98d165dae75eeec7680a14939659`.
This record adds evidence to the [earlier review](2026-10-30-pr-2314-high-effort-review.md); it does not revise its historical results.

## Law and authority

The maintainer's 2026-10-30 independent-caller decision requires compatible local
Collection options for Suspense sharing. Undefined options are absent. The
indexing model also treats an omitted mode as off. These are existing laws;
this follow-up changes only their test grammar and React receiving drivers.

Property presence and source delivery are separate dimensions. The local model
normalizes the declaration name `undefined` to `absent`, while the driver retains
the actual property. The indexing model already judges both settings equally.
For example, same-key callers declaring `{ query }` and
`{ query, getKey: undefined }` must share; another defined callback must separate
them. The same normalization applies to `defaultIndexType` and `autoIndex`.

The other missing witness was two independently suspended callers. Previously
the source was ready and the first caller had committed before the second
mounted. The new histories withhold source writes and readiness until both
separate Suspense boundaries show their fallbacks. The driver then releases
delivery and compares each committed output with the existing sharing and
configuration models. The indexing receiver also compares exact rows and
retains its option-retention/rebind checks.

## Grammar, reach and limits

The original 882 histories remain. The bounded extension adds 144 presence
histories and 48 pending histories, for 1,074 total:

| Receiver | Original | Presence | Pending | Total |
| --- | ---: | ---: | ---: | ---: |
| Local options | 348 | 120 | 24 | 492 |
| Indexing | 534 | 24 | 24 | 582 |

Presence histories compare omission with explicit undefined in both caller
orders, for every owned option, all three identity relations, and both cache
scopes. Defined options, invalid eager admission, explicit-off normalization,
distinct same-name constructors, retained first options, and identity changes
remain in the grammar. Invalid declarations still have no output identity.

Pending histories cross derived/same/different keys with both scopes. The local
receiver selects equal/different `onUpdate` references and `gcTime` scalars.
The indexing receiver starts with off/BasicIndex and varies its peer over
off/eager and BasicIndex/BTreeIndex. Keeping these representative histories
avoids doubling the entire ready matrix. Removing either option dimension loses
a declared reach; adding an undefined declaration does not admit the unsupported
`singleResult: other` case.

Each history retains its original comparison reach. Pending histories additionally
require one source start, two distinct visible fallbacks, and source status
`loading` before delivery. Aggregate reach prevents deletion of the pending lane
or either representative option dimension. The observed counts **per scope**
are identical for the unscoped and DbClient drivers:

| Receiver | Both suspended | Shared output | Separate outputs | Other reached states |
| --- | ---: | ---: | ---: | --- |
| Local options | 12 | 4 | 8 | callback-options 6; scalar-options 6 |
| Indexing | 12 | 2 | 10 | mode-change 6; constructor-change 6 |

These are controlled eager-source schedules at real React boundaries, not a
claim about arbitrary Suspense schedules. Abandonment, rejection while pending,
cleanup races, SSR/hydration timing, pending getKey/schema conflicts, and
downstream index maintenance are outside this addition. Existing owners retain
their coverage; no run budget or accepted expectation was reduced.

## RED, GREEN and hostile controls

Unchanged production passes all extended comparisons. There is no new production
defect or repair. RED here demonstrates that each former false-green receiver
now detects the named wrong implementation. Each mutant was applied alone to
the unchanged production source in the isolated review checkout and restored.

| Mutant | Original receivers | Extended receivers | Outcome |
| --- | --- | --- | --- |
| Remove undefined-property deletion from the local key | 882 pass | 88 assertion failures, 986 pass | 80 local and 8 indexing sharing comparisons reject unequal output references for equivalent declarations. |
| Reuse and memoize a pending entry without qualifying its key | 882 pass | 36 assertion failures, 1,038 pass | 16 local and 20 indexing cases reject wrong committed config or forbidden sharing. All failures are in pending histories. |

The first mutant replaces `if (value === undefined) delete options[key]; else if (...)`
with `if (...)` in `getSourceQualifiedSuspenseKey`; it retains the preceding
`autoIndex ??= 'off'` normalization. Thus the constructor-presence cases detect
it while the separate mode normalization remains valid.

The second replaces only the cache lookup with the following decision. It
models a permissive pending-cache fallback that memoizes the first loading
entry under another caller's exact key:

```ts
function getCachedCollection() {
  const exact = suspenseCollections?.get(suspenseKey!)
  if (exact) return exact.collection
  if (!suspenseCollections || !suspenseKey ||
      !getPreparedSources(preparedQueryValue, dbClient, `useLiveQuery`)
        .some((source) => source.status === `loading`)) return undefined
  const pending = [...suspenseCollections.values()].find(
    ({ collection }) => collection.status === `loading`,
  )
  if (pending) suspenseCollections.set(suspenseKey, pending)
  return pending?.collection
}
```

Instrumentation recorded 36 executions of the wrong pending-alias decision.
The old histories never reach that decision. The new failures occur at existing
public config/identity comparisons after both fallbacks. No timeout, setup
failure or unrelated runtime exception is counted as a rejection. Initial
dependency-resolution setup attempts are excluded. The final isolated runs
restored all source/test files and left that checkout clean.

GREEN receipts: 1,074 focused histories; 1,554 tests across six React receiver
files; 744 tests across three DB indexing/admission files. React TypeScript,
ESLint, Prettier, `git diff --check` and `pnpm lint:changed` pass. No production
file changed, so this addition has no shipped-byte cost.

Focused replay, from `packages/react-db` (use the same two files for each
isolated source mutant):

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 ../../node_modules/.bin/vitest run \
  tests/suspense-indexing-config-oracle.test.tsx \
  tests/suspense-local-options-oracle.test.tsx \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2 \
  --disableConsoleIntercept
```

Task-local raw receipts are `/tmp/2314-oracle-{undefined,pending}-{old,final}.log`,
`/tmp/2314-oracle-extensions-{final-green,db,reach-receipt}.log`, and
`/tmp/2314-oracle-mutations.json`. This versioned record retains the verdict-critical
edits, counts and observation cuts independently of those temporary files.

## Review requirements

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Existing independent-caller authority above; explicit finite limits. |
| ORC-002 | Expectations use declaration names and independent indexing rules, not the production key, cache or normalizer. |
| ORC-003 | Both receivers explain presence, held delivery, committed outputs and omitted schedules beside their code. |
| ORC-004 | Both property-presence orders reconstruct the witness. Callback/scalar and mode/constructor dimensions have separate reach. Bounds and excluded invalid declarations are above. |
| ORC-005 | Real React hooks, two visible fallbacks before held writes, then the existing output comparisons. The source facts are supplied before the claimed committed-row cut. |
| ORC-006 | Each mutant survives the original receivers and fails extended comparisons. Categories and counts are above. |
| ORC-007 | Not applicable: exhaustive finite enumeration, not a random property. Full-file replay command above. |
| ORC-008 | No stateful reference model changed. Undefined adds an input representation of existing absence, not a new product state. |
| ORC-009 | Declaration names represent exact runtime refs/scalars; undefined and omission map to one effective declaration. Pending means source writes/readiness remain held before either commit. |
| ORC-010 | Shared cleanup preserves the primary mismatch, releases held delivery, unmounts roots and cleans outputs/client/source. No shrinking is used. |
| ORC-011 | No plausible shared semantic fault needing another formulation was identified. The normalization model is independent of the production key loop. |
| ORC-012 | This record pins executable and original revisions, all requirements, witnesses, mutants and limits. |
| ORC-013 | Defined versus omitted/undefined declarations distinguish the equality boundary; pending shared and separate outputs distinguish both reuse consequences. |
| ORC-014 | Both cache scopes receive the same models through real React; the controlled premise remains explicitly limited to an eager source with held writes. |
| ORC-015 | Per-history reach plus per-scope aggregate counts above; each pending representative dimension is required. |
| ORC-016 | New cases reuse the existing models and comparisons. No standalone expected-answer regressions were added. |

An independent reviewer found no blocking issue by source inspection. Its
suggestion to distinguish callback/scalar reach was applied, along with separate
mode/constructor reach. That reviewer did not independently rerun the campaigns.
