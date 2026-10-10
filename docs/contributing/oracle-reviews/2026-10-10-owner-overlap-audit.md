# Oracle law ownership overlap review — 2026-10-10

Reviewed baseline: `4bd66cf8ee72cf2c318878995222415b0452b031`.
Carry-forward base: `f7ac2c63a3cabc864caf38b7a4e966088cfe73bb`.
This review focuses on prose and ownership, with the follow-up test-integrity
repairs described below. It is not a full ORC-012 conformance audit.

## Scope and method

At the reviewed baseline, we read the law, authority, model, history,
production-path, observation, and limit prose in all 194 tracked oracle-named
TypeScript and JavaScript paths under `packages/` and `examples/`. That
inventory contains 165 test, spec, or suite modules, four type-test files,
and 25 companion modules. We also read the two package `ORACLE.md` files and
the adjacent `where-prefilter-property-visibility.test.ts` generated-history
file. The baseline inventory is reproducible with:

```sh
git ls-tree -r --name-only 4bd66cf8ee72cf2c318878995222415b0452b031 -- packages examples \
  | rg -i 'oracle' | rg '\.(ts|tsx|js|jsx)$'
```

Within that output, paths matching `\.test\.`, `\.spec\.`, or `suite` are
runner modules. The four `\.test-d\.ts` paths are type tests. The remaining
paths are companion modules. These disjoint groups contain 165, four, and 25
paths respectively.

Untracked review copies and historical review records were not counted as
current executable owners. For each apparent overlap we compared the promised
law, legal history, production path, and public observation checkpoint. Shared
words or a shared model are insufficient to call two checks duplicates.

Between the reviewed baseline and the carry-forward base, three oracle-named
files were added and twelve existing oracle-named files changed. We read the
new files, the changed files' law and owner prose, and the affected coverage-map
entries. The additions are:

- [Facade rollback](../../../packages/db/tests/query/bucket-facade-rollback-oracle.property.test.ts)
  owns internal flush rollback and bounded row-read work. The existing
  includes-Collection owner checks public facade lifecycle and events.
- [Alias shadowing](../../../packages/db/tests/query/includes-alias-shadowing-oracle.test.ts)
  checks finite exact public keys and captured references. The scope-identity
  grammar owns broader alpha-renaming histories.
- [Leader-close OPFS](../../../packages/browser-db-sqlite-persistence/e2e/leader-close-oracle.opfs.spec.ts)
  receives manual source-backed recovery in real Chromium tabs. Controlled
  coordinator and persistence models and the Electric SDK receiver have
  different provider and observation boundaries.

The twelve modified paths fall into three ownership groups:

- Browser coordinator, per-Collection coordinator, persisted wrapper, and
  SQLite core oracles add leader-close and exact-receipt histories. Controlled
  routing, Collection publication, durable SQLite evidence, and the OPFS host
  receiver remain separate boundaries.
- Includes recomputation, scope identity, and Collection-valued includes add
  legal alias shadowing, exact public-key delegation, and a facade retry
  witness. The alpha-renaming model, exact-key companion, facade rollback
  owner, and public Collection receiver retain distinct checkpoints.
- Proxy native methods, proxy revert, deep equality, Electric recovery, and
  oracle configuration add native-mutator/revert, persisted-snapshot comparison,
  peer-notice ordering, and campaign registration checks. They do not create a
  second owner for those laws.

The complete 194-file prose review remains tied to its baseline. This
carry-forward review covers the changed ownership prose and affected entries;
it does not claim a full conformance audit of every newly added assertion.
None of these changes calls for merging the owners in the table below.

## Ownership decisions

| Shared claim or surface | Canonical owner and companion boundary | Decision |
| --- | --- | --- |
| Failed Collection replay keeps a public snapshot private | [Lifecycle publication](../../../packages/db/tests/collection-subscription-lifecycle-publication-oracle.property.test.ts) owns exact public rows and batches. [Replay](../../../packages/db/tests/collection-subscription-replay-oracle.property.test.ts) applies that law to replay generations and same-key source writes. | Keep both. Fresh-key and same-key post-failure witnesses reject different faults. |
| Exact subset demand and applied abort | [IR identity](../../../packages/db/tests/query/ir-stable-identity-oracle.test.ts) owns key construction; [load subset](../../../packages/db/tests/query/load-subset-oracle.property.test.ts) owns runtime sharing, retry, and readiness; [transaction refinement](../../../packages/db/tests/query/load-subset-transaction-refinement-oracle.test.ts) owns the abort cut around sync acceptance and publication. | Keep all three production cuts. Point the broader campaign to the precise boundary owner. |
| Ordered window rows | [Pagination](../../../packages/db/tests/query/pagination-oracle.property.test.ts) owns general ordered-window rows and publication. [Ordered work](../../../packages/db/tests/query/ordered-work-oracle.property.test.ts) checks the same rows while bounding eager indexed and joined work. [Query DB's cursor model](../../../packages/query-db-collection/tests/cursor-pagination/model-oracle.ts) owns opaque backend paging through a different adapter path. | Keep row checks at both paths so a work bound cannot pass by dropping rows. |
| Optimistic whole-row state and settlement | [Optimistic history](../../../packages/db/tests/optimistic-history-oracle.ts) supplies the shared base/intent/source-queue model. [Same-key composition](../../../packages/db/tests/optimistic-composition-oracle.test.ts) exhausts a three-update matrix; [transaction ownership](../../../packages/db/tests/transaction-ownership-oracle.property.test.ts) owns release across two Collections. Outcome and publication drivers reuse the history model. | Keep the distinct matrix and observation drivers; do not count each shared-model replay as a new law. |
| Correlated includes | [Includes](../../../packages/db/tests/query/includes-oracle.property.test.ts) owns broad nested recomputation. Query-shape, temporal demand, facade, publication, projection, and work owners exercise narrower architecture laws or checkpoints. | Keep the architecture's owner split. The focused input-boundary tests are regression witnesses, not another model owner. |
| D2 value identity and top-K | [Hash identity](../../../packages/db-ivm/tests/hash-identity-oracle.property.test.ts) owns identity. [Flat hash](../../../packages/db-ivm/tests/hash-oracle.property.test.ts) checks equal-hash consequences for flat equivalent constructions. The [TopKRelation checker](../../../packages/db-ivm/tests/operators/topk-relation-oracle.ts) requires unit weights for both numeric- and fractional-index output; ordinary top-K cases using it supply unit support, while ordinary top-K can retain multiplicity. | Clarify both scope statements; retain distinct hash graph, retry, and top-K production paths. |
| Provider and framework receiving | Core/controlled models own their laws; IndexedDB browser specs, SQLite/OPFS hosts, Electric SDK delivery, and backend Collection E2E suites receive named premises. Shared framework contracts own row/page semantics while React and Vue drivers observe their own render cuts. | Keep receiving witnesses. Do not credit a controlled seam as native-host or framework timing evidence. |
| Opaque pagination no-peek candidate | The cursor-pagination owners retain the shipped peek-ahead contract. [No-peek integration](../../../packages/query-db-collection/tests/cursor-pagination-oracle.no-peek.integration.test.ts) exercises a test-only candidate against the full-relation model. | List it as experimental, separate from shipping coverage. |

The only filename correction is
`virtual-row-legacy-guard-oracle.test-d.ts` to
[virtual-row-legacy-guard.test-d.ts](../../../packages/db/tests/virtual-row-legacy-guard.test-d.ts).
It contains concrete type assertions, not an independent model or reusable
checker. The independent virtual-row
type-shape owner remains `query/virtual-row-fields-oracle.test-d.ts`.

## Repairs made during this review

- Named the primary and receiving owners in the replay, load-subset,
  ordered-work, flat-hash, and notification oracle prose.
- Corrected the indexed-DB portfolio's controlled-versus-native scope and
  three receiving-spec paths in the coverage map.
- Classified backend Collection E2E separately from framework conformance,
  listed the live-query notification owner and the no-peek experiment, and
  linked the same-key optimistic composition witness.
- Corrected stale Electric SDK receiving references and inaccurate prose about
  LocalStorage same-tab authority, direct change-event settlement, row metadata,
  and fractional top-K multiplicity.
- Removed collision-sensitive distinct-digest assertions from the flat-hash
  and identity owners. The identity model still checks `equalHashValues` for
  distinct values, including a forced digest collision and a digest-only
  hostile mutant.
- Tightened the proxy-revert native-history checker: an equal-valued `f` may
  appear in `getChanges()` only after a live write to `f`. A spurious-field
  report is a hostile control for this assertion.

No production code changed. Collision-sensitive controls and their generators
were removed; the proxy-revert checker gained an assertion. This review found
no pair with the same complete law, legal history, production path, and
observation cut that should be merged into one test file.

## Validation

At the reviewed baseline, Vitest discovered the renamed file and both type
assertions passed. The `@tanstack/db` package-wide typecheck exited with
unrelated missing `@playwright/test` and `fake-indexeddb` declarations and was
not rerun in the carry-forward worktree. Dependency installation there failed
with a private npm-proxy 403. Using the existing checkout's dependencies,
focused worktree runs passed: 91 flat-hash and hash-identity tests, four
hash-session replay tests, 61 legacy hash examples, and 48 proxy-revert tests.
The `@tanstack/db-ivm` typecheck passed.
The proxy run used a minimal Vitest configuration because
the package's normal setup requires the unavailable `fake-indexeddb` package.
The digest-only and spurious-field hostile controls both failed their intended
checker assertions. Prettier accepted every edited file, all new review links
resolved locally, and `git diff --check` passed. No provider E2E tests ran.

## Remaining review work

Several oracle-named files still need a clearer opening contract or authority
source. The clearest are `query/ir-stable-identity-oracle.test.ts`, the two
ordered-source-loader oracles, `query/derived-delete-reconciliation-oracle.test.ts`,
the two top-K batch/fractional files, and several SQLite and provider owners.
Those are literate-prose gaps, not evidence of duplicate ownership. Follow-up
review removed the collision-sensitive distinct-digest assertions. The identity
owner still checks distinct values through `equalHashValues`, including under
forced digest collisions.
