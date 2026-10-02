# React source Collection ID reuse oracle review

Reviewed semantic head: `27560e3a4d1a0f76b12cf5bed720e4ab03485bb2`

## Claim and limit

The reported bug used a mounted `useLiveQuery({ query })` hook. A new source Collection reused the old source's ID. The hook returned rows from the old source because derived query identity used the ID. The user selected a fail-fast contract: one mounted derived-identity hook rejects a different source Collection object with a previously used ID in the same `DbClient` scope. The old hook must unmount before the application reuses that ID in a new hook. Separate hooks may use same-ID sources. Their Suspense cache entries must remain distinct.

The public hook and Suspense wrappers are the production paths. The observation cuts are a rerender error for a mounted-hook collision and the public row for separate Suspense hooks. The controlled sources do not prove real SQLite persistence, DbClient SSR preload or streaming, explicit `queryKey`, legacy dependency arrays, or direct Collection input. The coverage map assigns those limits to this owner or the existing integration owners.

The oracle keeps five responsibilities close together. Its opening states the contract, model, limits, and observation cuts. Its `Binding` histories and `expectedCollision` relation define the reference judgment. Each test constructs a bounded legal history. The driver renders the public React hooks. Assertions compare the thrown error or public row at the rerender or settled-render boundary.

## Guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass. The issue reports the ID-based stale query. The user selected fail-fast replacement in a mounted hook. The oracle and coverage map state the boundary and excluded paths. |
| ORC-002 independent judgment | Pass. `expectedCollision` compares prior and next source object references for each client scope. It does not import the production token map, IR hash, or cache-key logic. Public-row checks also distinguish separate Suspense sources. |
| ORC-003 visible responsibilities | Pass. The opening contract and model, bounded test histories, public hook driver, and error or row comparisons are visible in the oracle file. |
| ORC-004 generated grammar | Not applicable. These are fixed legal histories, not a generated-history coverage claim. |
| ORC-005 production path and observation | Pass. Tests render `useLiveQuery` or `useLiveSuspenseQuery`. They assert a thrown collision before stale rows or exact public row values after React renders. |
| ORC-006 calibration | Pass. The original production file fails the mounted A-to-B collision test at its error assertion. A temporary cache-key mutant that restores the ID-only client cache fails both client-scoped Suspense row tests: the second render shows `first` instead of `second`. Both results are assertion failures at the intended checkpoints. The production file was restored after each run. |
| ORC-007 fixed and random campaigns | Not applicable. No important generated property is claimed. |
| ORC-008 model minimality | Pass. The pairwise model retains source object, ID, and client scope. A → other ID → B with A's ID distinguishes full mounted-hook history from a model that remembers only the current source. A client switch and return distinguish retained scope bindings from one global binding. |
| ORC-009 vocabulary mapping | Pass. `Binding` is a model-only pair of a production source Collection and an optional `DbClient` scope. The model's history array represents mounted-hook source observations; it does not copy production refs or caches. |
| ORC-010 failure fidelity and cleanup | Not triggered by shrinking or normalized capture. Tests compare the synchronous error or exact row before test cleanup. One controlled source cleanup intentionally logs the dependent live-query error; its following collision assertion remains the primary check. |
| ORC-011 second formulation | Pass for the named cache fault. The mounted-hook relation judges object reuse through an error. Independent Suspense histories judge separate hook ownership through public rows, including an initial suspended retry. |
| ORC-012 review evidence | Pass. This record names the reviewed semantic head, all guide outcomes, original and adjacent witnesses, mutant results, and limits. |
| ORC-013 boundary witness | Pass. Same object and new ID rerenders are accepted. A different object with a prior ID rejects directly, after another ID, after cleanup, and when two same-ID sources occur within one query. Separate hooks remain legal and show their own rows. |
| ORC-014 controlled premise handoff | Not triggered for a real-provider claim. The oracle claims controlled React identity behavior only. Real persisted SQLite remains outside its evidence. |

## Loss audit and closeout

The loss audit found three missing distinctions. The final oracle adds two same-ID sources in one query, mounted-hook reuse after source cleanup, and a `DbProvider` A → B → A scope history. A code review found that the client-scoped Suspense cache reused an ID-only key across separate hooks. The final oracle checks both a committed sibling hook and an initial suspended retry. A temporary ID-only cache-key mutant failed both checks.

The original witness is the mounted A(id=x) → B(id=x) rerender. Adjacent histories include A(id=x) → C(id=y) → B(id=x), a changed predicate, source cleanup while mounted, same-query duplicate IDs, client scope changes, and separate Suspense hooks. The claim covers these legal React histories and their public error or row observations. It does not assert that an ID is globally unique across hooks or clients. No reachable in-scope counterexample was found in this bounded audit.

The focused oracle passed 12 tests. The related React hook and Suspense suites passed 120 tests in five files. Lint and the React DB package build passed. This is sampled and bounded evidence, not a universal proof of every React schedule.

## 2026-10-02 collision-path addendum

Reviewed semantic head: `ebf7c785bc42f6dd1d652b296a3de7e15ec310a5`.
The earlier review above remains evidence for its own head. This addendum
evaluates the new sync-start deferral witness and fix.

**Law and boundary.** A mounted derived-identity hook rejects a source object
that reuses a remembered ID. If the rejected render also materialized a
different shared `DbClient` descriptor, it must release the descriptor's
sync-start deferral. A later direct Collection reader must be able to start
sync and observe the descriptor's row. This is a controlled React render and
ErrorBoundary history, observed through the public hook error, Collection
status, and row after the later reader subscribes. It does not claim that all
possible render exceptions release deferrals.

**RED/GREEN and distinguishing histories.** At prior head `c5a1bd9f4`, the
ErrorBoundary caught the expected collision, but the later direct reader stayed
`idle` and the descriptor sync callback had run zero times. The same test at
`ebf7c785b` reached `ready`, returned the exact shared row, and counted one
sync start. The existing same-source, new-ID, same-ID collision, client-scope,
and Suspense controls remained green. The old implementation is the relevant
hostile design: it passes the original collision assertion but fails at the
later reader's public status checkpoint.

| Requirement | Addendum outcome |
| --- | --- |
| ORC-001 | Pass. The reported deferred-sync leak and the existing mounted-hook contract supply authority; the coverage map names the React owner and its limits. |
| ORC-002 | Pass. The expected later `ready` status and row follow from a distinct reader's public Collection contract, not the production deferral flag or token map. |
| ORC-003 | Pass. The oracle prologue states this law and its limit; the fixed history, React driver, and public assertions are in one file. |
| ORC-004 | Not applicable. The new history is fixed, with no generated coverage claim. |
| ORC-005 | Pass. The driver uses `useLiveQuery`, a real `DbClient` descriptor, a real ErrorBoundary, and a later direct reader. |
| ORC-006 | Pass. The prior production implementation fails at `idle` versus `ready`; the same case passes after the fix. |
| ORC-007 | Not applicable. No important generated property was added. |
| ORC-008 | Pass. The model needs only a remembered same-ID binding, a distinct shared descriptor, a rejected render, and a later reader; it does not copy sync-manager state. |
| ORC-009 | Pass. The new prose uses source Collection, sync-start deferral, and Collection status with the glossary meanings. |
| ORC-010 | Pass. The test checks the caught error and later reader before test cleanup, with no error normalization or shrinking. |
| ORC-011 | Not triggered by a shared-fault hypothesis for this new boundary; the later direct reader is a separate path from the rejected derived hook. |
| ORC-012 | Pass. This versioned addendum identifies the exact reviewed semantic head, all requirement outcomes, original wrong design, and remaining limits. |
| ORC-013 | Pass for the named collision condition. A same-source or fresh-ID rerender stays legal; a same-ID replacement rejects, while its unrelated descriptor remains usable. |
| ORC-014 | Not triggered for a real-provider claim. The source sync is controlled; persisted SQLite and streaming remain outside this owner. |

The updated oracle passed 13 cases. The oracle plus the surrounding React hook
and Suspense suites passed 100 cases; ESLint and Prettier passed. A separate
TypeScript project check was blocked by missing `@tanstack/query-core` and
`@standard-schema/spec` dependencies in this checkout, while Vitest reported
no type errors for the tested files. A bounded 32-ID diagnostic showed linear
retention in one mounted hook; the coverage map records that unresolved space
policy. No claim of space-bounded ID history is made.

## 2026-10-02 multiple startup failures and main integration

Reviewed semantic head: `639bcd16fdb5db83fc11c3d53a94aa2d7e4c19fa`.
This entry supplements the earlier heads. It covers the merge with main
`06cab6fc7b808acfbfb3af1eb2fc1fdc3c9f0fa8` and the deferred-startup
failure that CodeRabbit retained after the collision-path fix.

**Law and boundary.** If a rejected derived-identity render defers several
shared source Collections, one failing sync start must not prevent later
Collections from starting. The hook reports the first startup error after it
attempts each pending Collection once. A later direct reader observes the
healthy source's `ready` status and row. This is a controlled React render,
ErrorBoundary, and direct-reader history. It does not establish behavior for
every render exception or a real persisted source.

**RED/GREEN.** At prior head `0da7eae89`, two deferred sync starts threw
across React's retry. The later healthy Collection stayed `idle`; its sync
callback had not run. The new case failed at the public `ready` assertion.
At `639bcd16f`, the same case reaches `ready`, returns the exact healthy row,
and counts one healthy sync start. The two failing starts each run once.
This rejects the plausible wrong design that stops draining at the first
startup error. The existing one-failure collision case and source-binding,
client-scope, and Suspense cases also pass. The merged production path keeps
main's source-object-keyed pooled partitions and the PR's source-qualified
Suspense keys.

| Requirement | Addendum outcome |
| --- | --- |
| ORC-001 | Pass. The mounted-hook collision contract and the public direct-reader startup obligation authorize the expected result; the coverage map bounds the claim. |
| ORC-002 | Pass. The expected `ready` status and row come from the public Collection behavior, independent of the hook's deferral set and drain algorithm. |
| ORC-003 | Pass. The oracle prologue, fixed history, real React driver, and public assertions keep the five responsibilities visible together. |
| ORC-004 | Not applicable. No generated-history coverage is claimed. |
| ORC-005 | Pass. The driver uses `useLiveQuery`, a `DbClient` descriptor, an ErrorBoundary, and a later direct reader; it checks status and row after subscription. |
| ORC-006 | Pass. The old sequential drain fails at `idle` versus `ready`; the same history passes with the new drain. |
| ORC-007 | Not applicable. No important generated property was added. |
| ORC-008 | Pass. The fixed history distinguishes failed and healthy source roles without modeling production's deferral set. |
| ORC-009 | Pass. The prose and assertions use source Collection, sync start, and Collection status with the glossary meanings. |
| ORC-010 | Pass. The test observes the caught error and later reader before cleanup; it has no shrinking or error normalization. |
| ORC-011 | No shared-fault hypothesis requires a second formulation; the later direct reader is a separate public path. |
| ORC-012 | Pass for this bounded repair. This record identifies the reviewed head, prior wrong design, observation cut, and limits. |
| ORC-013 | Pass for the named startup boundary. The prior one-failure case reaches a later reader; this two-failure case distinguishes full draining from stopping after React's retry. |
| ORC-014 | Not triggered for a real-provider claim. The controlled source sync callbacks are the declared premise. |

The source-ID oracle passed 14 cases, six surrounding React hook and Suspense
files passed 110 cases, and the React TypeScript project check passed after
restoring workspace dependency links. The pooled-query oracle, GC, and identity
suites passed on the merged main. The scope remains the controlled React paths
listed in the coverage map; the bounded-navigation space policy, persisted
SQLite sources, and DbClient SSR preload or streaming remain open there.
