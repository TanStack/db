# Oracle law ownership overlap review — 2026-10-10

Reviewed baseline: `4bd66cf8ee72cf2c318878995222415b0452b031`.
Carry-forward base: `f7ac2c63a3cabc864caf38b7a4e966088cfe73bb`.
This is a prose and ownership review, not a full ORC-012 conformance audit or
runtime test result.

## Scope and method

At the reviewed baseline, we read the law, authority, model, history,
production-path, observation, and limit prose in all 194 tracked oracle-named
TypeScript and JavaScript paths under `packages/` and `examples/`. That
inventory contains 164 test, spec, or suite modules, four type-test files,
and 26 companion modules. We also read the two package `ORACLE.md` files and
the adjacent `where-prefilter-property-visibility.test.ts` generated-history
file. The
baseline inventory is reproducible with:

```sh
git ls-tree -r --name-only 4bd66cf8ee72cf2c318878995222415b0452b031 -- packages examples \
  | rg -i 'oracle' | rg '\.(ts|tsx|js|jsx)$'
```

Untracked review copies and historical review records were not counted as
current executable owners. For each apparent overlap we compared the promised
law, legal history, production path, and public observation checkpoint. Shared
words or a shared model are insufficient to call two checks duplicates.

On the carry-forward base, three oracle-named files were added. We read their
law and owner prose and the updated coverage-map entries:

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

These additions do not change the ownership decisions below. The complete
194-file prose review remains tied to its baseline; the carry-forward check is
limited to these additions and their affected owner entries.

## Ownership decisions

| Shared claim or surface | Canonical owner and companion boundary | Decision |
| --- | --- | --- |
| Failed Collection replay keeps a public snapshot private | [Lifecycle publication](../../../packages/db/tests/collection-subscription-lifecycle-publication-oracle.property.test.ts) owns exact public rows and batches. [Replay](../../../packages/db/tests/collection-subscription-replay-oracle.property.test.ts) applies that law to replay generations and same-key source writes. | Keep both. Fresh-key and same-key post-failure witnesses reject different faults. |
| Exact subset demand and applied abort | [IR identity](../../../packages/db/tests/query/ir-stable-identity-oracle.test.ts) owns key construction; [load subset](../../../packages/db/tests/query/load-subset-oracle.property.test.ts) owns runtime sharing, retry, and readiness; [transaction refinement](../../../packages/db/tests/query/load-subset-transaction-refinement-oracle.test.ts) owns the abort cut around sync acceptance and publication. | Keep all three production cuts. Point the broader campaign to the precise boundary owner. |
| Ordered window rows | [Pagination](../../../packages/db/tests/query/pagination-oracle.property.test.ts) owns general ordered-window rows and publication. [Ordered work](../../../packages/db/tests/query/ordered-work-oracle.property.test.ts) checks the same rows while bounding eager indexed and joined work. [Query DB's cursor model](../../../packages/query-db-collection/tests/cursor-pagination/model-oracle.ts) owns opaque backend paging through a different adapter path. | Keep row checks at both paths so a work bound cannot pass by dropping rows. |
| Optimistic whole-row state and settlement | [Optimistic history](../../../packages/db/tests/optimistic-history-oracle.ts) supplies the shared base/intent/source-queue model. [Same-key composition](../../../packages/db/tests/optimistic-composition-oracle.test.ts) exhausts a three-update matrix; [transaction ownership](../../../packages/db/tests/transaction-ownership-oracle.property.test.ts) owns release across two Collections. Outcome and publication drivers reuse the history model. | Keep the distinct matrix and observation drivers; do not count each shared-model replay as a new law. |
| Correlated includes | [Includes](../../../packages/db/tests/query/includes-oracle.property.test.ts) owns broad nested recomputation. Query-shape, temporal demand, facade, publication, projection, and work owners exercise narrower architecture laws or checkpoints. | Keep the architecture's owner split. The focused input-boundary tests are regression witnesses, not another model owner. |
| D2 value identity and top-K | [Hash identity](../../../packages/db-ivm/tests/hash-identity-oracle.property.test.ts) owns identity. [Flat hash](../../../packages/db-ivm/tests/hash-oracle.property.test.ts) checks equal-hash consequences and sampled digest diagnostics. The [TopKRelation checker](../../../packages/db-ivm/tests/operators/topk-relation-oracle.ts) requires unit weights for fractional-index output; ordinary top-K cases using it supply unit support, while ordinary top-K can retain multiplicity. | Clarify both scope statements; retain distinct hash graph, retry, and top-K production paths. |
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

No executable expectation, model transition, generator, or production path was
removed. This review found no pair with the same complete law, legal history,
production path, and observation cut that should be merged into one test file.

## Validation

At the reviewed baseline, Vitest discovered the renamed file and both type
assertions passed. That package-wide typecheck exited with unrelated missing
`@playwright/test` and `fake-indexeddb` declarations. Dependency installation
in the carry-forward worktree failed with a private npm-proxy 403, so the
typecheck was not rerun there. Prettier accepted every edited file, all new
review links resolved locally, and `git diff --check` passed. No runtime tests
or hostile mutants were run.

## Remaining review work

Several oracle-named files still need a clearer opening contract or authority
source. The clearest are `query/ir-stable-identity-oracle.test.ts`, the two
ordered-source-loader oracles, `query/derived-delete-reconciliation-oracle.test.ts`,
the two top-K batch/fractional files, and several SQLite and provider owners.
Those are literate-prose gaps, not evidence of duplicate ownership. The
sampled distinct-digest checks in the hash files can fail on an allowed 32-bit
collision; they need a separate decision about diagnostic versus contractual
failure.
