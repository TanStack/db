# Completed query snapshot publication: bounded review

Reviewed implementation: `ebc048a1c4db1d10518d32d47d24708325f7acba`.
The feature first landed locally at `401a91ad904643c9eb6c174f2d783b2c21703469`.
The reviewed head merges upstream `7538afd2f`; the only conflict was the private
minifier name map, regenerated with the existing checker. Feature source and
test logic are unchanged by that merge, and the receiving suites were rerun.
The following evidence-only commit changes this record and its coverage link;
it does not change the reviewed runtime or tests. This is a self-review using
oracle-authoring and oracle-review, not an independent reviewer verdict.

## Law and authority

This is a proposed opt-in contract, authorized by the application use case and
stated in `packages/db/src/query/live/ARCHITECTURE.md`, “Completed query
snapshots.” It does not reclassify ordinary progressive publication as a bug.
With `snapshotPublication: 'complete'`, a consumer retains one completed result
while current source coverage or reachable demand is unsettled. First completion
atomically replaces restored output, including empty output. Later demand also
holds publication; updates over already-covered data keep normal behavior.

A matching completed persisted result can supply local restore readiness for
its graph. A peer reading a source directly keeps its own restore obligation.
An empty database is not a completed cached query. Query errors cannot become
network fallback, including when the network deadline is zero.

## Independent judgment, histories and receiving cuts

The persisted-readiness owner recomputes the selected LEFT join from plain input
arrays. It chooses the previous result until the controlled completion cut.
The source-completion grammar, persistence adapter and observer drive production;
they do not compute the expected join through the production compiler.
The unordered driver compares rows in key order while preserving the complete
publication sequence. It does not claim ordered iteration coverage.

The new finite campaign has 150 histories: 128 initial cases, 18 receiving-path
cases, two optimistic rollback cases, and two later-demand cases. Each history
runs its comparisons; this is enumeration rather than random generation.
The initial product crosses empty/nonempty saved data, completion metadata,
window match, child result, completion order, failure and parent removal.
The receiving cases cover a saved same-key row through the direct, derived and
shared-source peer paths. Removing those paths would lose the independent peer
restore obligation or inherited restore boundary. Later-demand cases hold the
actual new provider acquisition while applying source rows and draining the
controlled adapter's local work. They then check the complete replacement after
that acquisition settles. An acquisition may not fulfill before establishing
its applied rows. The optimistic histories compare after the persisted
publication of rollback, rather than assuming a wrapping adapter is synchronous.

The initial matrix's RED run preceded the first publication implementation.
It used the prototype spelling `initialSnapshot`; the final option became
`snapshotPublication` when the later-demand contract was added. The cold-error
and zero-deadline error witnesses preceded their respective repairs. Additional
derived, peer and optimistic receiving histories were added during refinement;
the original RED run does not establish those receiving paths. Their executed
GREEN runs and hostile controls are separate evidence, not a claim that the
first RED covered every path.

## Executed evidence

Runtime: Node 22.20.0, repository-pinned pnpm 11.1.0. Dependencies were installed
with a frozen lockfile for the DB, persistence-core, React and query-collection
dependency graphs. Unrelated mobile examples were not installed.

- **RED, initial matrix:** current-main implementation after retiring the old
  provisional option, commit `ed641874`. All 128 new matrix cases failed their
  public snapshot/readiness comparisons before implementation.
- **RED, cold source failure:** without unavailable-snapshot handling, initial
  rendering remained pending after network failure and a completed empty local
  read with no completion certificate. The bounded outcome comparison failed.
- **RED, zero-deadline query failure:** four direct/derived receiving cases
  resolved initial rendering instead of rejecting the failed query. Two peer
  controls already rejected. The race guard makes all six agree with the law.
- **GREEN:** the full persisted-readiness owner passes **186 tests**, comprising
  its existing 36 tests and the new 150 histories.
- **GREEN, neighboring contracts:** eleven DB files pass **930 tests**: live-query
  Collections, ordered-source state, ordered lifecycle, pagination, options,
  observer snapshots, observer histories, stable identity and the newly merged
GC retention/transaction/mutation oracles. The existing
  fixed and random campaigns execute unchanged. The React hook suite passes
  **60 tests**. This is regression evidence, not a new framework scheduling law.
- **GREEN, tooling:** DB IVM, DB, persistence-core and React builds; DB and
  persistence-core TypeScript; changed-file ESLint, oracle lint, mangle-cache
  validation and diff checks.

The package commands are:

```sh
pnpm --filter @tanstack/db-ivm build
pnpm --filter @tanstack/db build
pnpm --filter @tanstack/db-sqlite-persistence-core build
pnpm --filter @tanstack/react-db build
pnpm --dir packages/db-sqlite-persistence-core exec vitest run tests/persisted-readiness-oracle.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
pnpm --dir packages/db exec vitest run tests/query/live-query-collection.test.ts tests/query/ordered-source-loader-state-oracle.test.ts tests/query/ordered-lifecycle-oracle.property.test.ts tests/query/pagination-oracle.property.test.ts tests/live-query-options.test.ts tests/live-query-observer-snapshot-oracle.property.test.ts tests/live-query-observer-history-oracle.property.test.ts tests/query/ir-stable-identity-oracle.test.ts tests/collection-gc-retention-oracle.property.test.ts tests/collection-gc-transaction-oracle.property.test.ts tests/collection-gc-mutation-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
pnpm --dir packages/react-db exec vitest run tests/useLiveQuery.test.tsx --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
pnpm exec tsc --noEmit -p packages/db/tsconfig.json
pnpm exec tsc --noEmit -p packages/db-sqlite-persistence-core/tsconfig.json
pnpm lint:changed packages/db-sqlite-persistence-core/tests/persisted-readiness-oracle.test.ts packages/db/tests/query/ir-stable-identity-oracle.test.ts
```

## Hostile controls

All controls were restored before the implementation commit. Each relevant
package was rebuilt when the control changed packaged runtime code.

| Control | Executed result and classification |
| --- | --- |
| Remove the complete-publication hold | Seven selected histories fail, including public cached-row preservation/readiness comparisons. This is an observed wrong publication/eligibility answer, not a setup failure. |
| Hold only before first publication | Both later-demand histories fail their bounded final-convergence comparison after the held acquisition settles. The new row remains absent; this is evidence of the progress boundary, not proof that a transient flash occurred. |
| Treat a source as seen regardless of inherited restore boundary | All six peer histories fail the early persisted-readiness comparison: a direct peer incorrectly inherits another view's certificate. |
| Omit publication policy from derived identity | The two-policy identity matrix fails: unequal policies receive one reusable config identity. |

The stable-identity owner compares all four policy pairs against simple policy
equality. It exercises runtime identity, not generation of portable persistence
ids. The published sources retain the controls' correct counterparts.

## Rubric and limits

| Requirement | Bounded assessment |
| --- | --- |
| ORC-001/002 | New optional policy and limits are explicit; array recomputation and policy equality are independent of production classifiers. |
| ORC-003/005 | Contract, finite grammar, production driver and public comparisons remain visible in the primary owners. Adapter recording checks rows and completion metadata in one truncating transaction. |
| ORC-004 | Finite products and receiving grammars name each axis and its lost distinction. Empty output, same-key replacement and obsolete child demand after parent removal are present. Fulfillment before applied rows is excluded as nonconforming provider behavior. |
| ORC-006 | The four controls above fail the intended comparisons. The initial-only control is a bounded progress failure and is reported separately from immediate wrong-value answers. |
| ORC-007/015 | The added grammars are explicitly finite, not important generated properties; random campaign/replay and generated reach requirements do not apply to them. Existing generated DB campaigns still run. |
| ORC-008/009 | The model retains only input rows, completion, optimistic overlay and later completion. Pending versus completed changes the permitted public result. Shared terms follow the glossary. |
| ORC-010 | The existing cleanup aggregator preserves the primary mismatch and secondary cleanup failures. Controlled acquisitions and mutations are released before Collections are cleaned up. |
| ORC-011/013 | Peer/direct versus inherited paths distinguish restore obligations; empty/nonempty and matching/mismatched windows reject row-count and unconditional-certificate rules. No separate SQL formulation is claimed. |
| ORC-012/014 | This record identifies the reviewed implementation and controlled boundaries. Native/provider handoff is unestablished, not inferred from a controlled adapter. |
| ORC-016 | New cases replay the shared model/driver/comparison. The identity extension is a finite reusable equality law, not source-string inspection or concrete type assertions. |

Known limits remain with the persisted-readiness owner: actual SQLite/OPFS
restart and crash durability, physical worker/browser scheduling, arbitrary
provider histories, cross-framework timing, Collection-valued persisted includes,
unknown/incompatible resume-evidence histories for this new query composition,
and arbitrary query identity migration. The runtime checks consistent resume
evidence; the new driver supplies that premise. Existing SQLite evidence owners
do not by themselves prove this new composition at a native receiving boundary.
The caller still owns persistence id/schema and access scope, and ordered cached
output needs a durable comparator. This draft makes no universal bug-class
closure, provider isolation or “no flashing” claim.

## Production cost

`pnpm size:compare --base upstream/main --packages db,react-db,db-sqlite-persistence-core --files`
compares against upstream `7538afd2f`. The typical app grows by **423 gzip bytes
(0.5%)**; the DB export bundle grows by **442 gzip bytes (0.4%)**. React and
persistence-core package bundles are unchanged.

The implementation extends existing demand/publication gates and metadata,
rather than retaining a second query cache or lifecycle. Observer traversal
inherits one restore boundary while preserving direct peer obligations and leaf
error classification. Removing the new completion/window or restore-context
distinctions fails the witnesses above, so these branches cannot simply be
collapsed into the prior policy. Tests and contract documentation account for
the larger source diff; their bytes are not shipped.
