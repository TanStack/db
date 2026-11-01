# Observer row-container sharing evidence

This independent PR starts from upstream main at
`15d2d2d328db6f5a4ea0f1a48528c6c5137a1716`. It contains no Angular source or
framework-version change. Observer source SHA-256:
`abb037706e51c05174cb61170afc314f4ac804f611d8da4bc6b7edc6bc20e120`.
The primary owner is `live-query-observer-snapshot-oracle.property.test.ts`.

- **Law:** metadata-only status/health changes replace the full snapshot while
  retaining its data array and lazy state Map. Writes still replace containers,
  and retained snapshots keep their capture-time rows. The maintainer approved
  this optimization on 2026-11-01; LiveQuerySnapshot documents the new guarantee.
- **Reach:** `live-query-observer.row-container-sharing` executes 12 shared
  examples and 40 generated histories per fixed/random campaign. Both campaigns
  reach status-only and health-only transitions in 52 histories each. The fixed
  campaign reaches attached/detached 26/26, granular/wholesale 31/21, empty rows
  in 11 histories, and same-key value writes in 40. Read order varies between
  data-first and state-first. Every history becomes ready before health reports.
- **RED:** from `packages/db`, run
  `../../node_modules/.bin/vitest --run --coverage.enabled=false tests/live-query-observer-snapshot-oracle.property.test.ts -t 'metadata snapshots'`
  with unchanged production. Both campaigns reject a fresh empty array at the
  loading-to-ready transition; fixed seed 1101, shrink path `0:0:0:0`.
  A first fixture attempted health reporting before readiness and failed setup;
  the grammar was corrected with a legal readiness prefix before recording RED.
- **GREEN:** the observer ordinary/history/hydration/retained-snapshot suites
  pass 100 tests. The unchanged Angular adapter also passes 89 tests with one
  existing TODO against this observer. ESLint, oracle lint, focused TypeScript,
  private-member mangle validation, and package build pass on the independent
  branch with Node 24.8.0 and pnpm 11.1.0. The documentation snippet check reports
  no new failures across 804 examples. Full-workspace pnpm test is not claimed.
- **Mutant:** reusing containers solely by row count fails on two writes to key
  `a`: the second value stays stale despite unchanged membership (seed 1101,
  path `0:0:1:2`). The shared model's row assertion rejects it. The final code is
  restored and the same oracle passes. Earlier point-in-time calibration also
  rejects a getter that reads current Collection rows instead of captured rows.
- **Limits:** the new lane covers synchronous direct Collections, zero through
  three string-keyed rows, both observer modes and attach states. Existing
  ordered/findOne histories and hydration tests protect neighboring behavior;
  order-only changes retain the existing observer layout witnesses. No new
  framework, browser-rendering, SSR-scheduler, or external-provider claim.

## Implementation and release impact

One bounded row cache contains captured entries, their array, and a lazy Map.
Full snapshots capture that cache rather than forwarding through old snapshots,
so metadata updates neither rebuild row containers nor retain an unbounded chain
of full snapshots. Unchanged entry recaptures preserve identity. When a row
revision is unchanged, entry comparison still notices layout-only changes and
supports the existing revisionless-input path. Value-only writes cannot hide
behind layout identity. The private-member mangle cache includes the new field.

The size comparison reports db +28 gzip bytes and -21 brotli bytes against the
same upstream production source. The one row cache is necessary to preserve a
lazy Map without forwarding chains; the entry-update branch was simplified
alongside it. Tests and this evidence are development-only. A patch Changeset
releases the shared observer optimization independently of the Angular PR.

The Angular branch separately projects row-state identity before copying its
Map. Both changes together were tested through Angular's generated metadata
receiving histories before the split. That integration evidence does not turn
this core-only PR into a framework contract: Angular's independent PR owns its
receiving behavior and can merge in either order.

## Oracle rubric assessment

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 | Maintainer-approved structural sharing and the LiveQuerySnapshot contract; limits above. |
| ORC-002 | The existing key/version model changes only on writes; metadata references are compared through a metamorphic relation. |
| ORC-003 | Contract prose, modelRows, grammar, real observer driver, and checkRead remain visible in the existing owner. |
| ORC-004 | Shared examples reconstruct metadata, empty rows, and same-key updates. Removing mode, attachment, cardinality, read order, or action kinds loses a distinct cache/laziness path. Health reports before readiness are excluded by the prefix. |
| ORC-005 | Actual observer getSnapshot before/after each metadata or write receipt, followed by retained-snapshot reads. |
| ORC-006 | Unchanged production and the same-cardinality mutant fail at the intended reference/value checks. |
| ORC-007 | Fixed seed 1101 and unseeded campaigns use identical examples, grammar, budget, and checker; shared replay variables select the property and shrink path. |
| ORC-008 | No production cache state is mirrored; the model retains only key/version rows. |
| ORC-009 | Snapshot explicitly projects data/state across direct and virtual query rows; glossary terms are preserved. |
| ORC-010 | finishHistory preserves primary and cleanup failures. |
| ORC-011 | No additional named shared semantic fault; retained old snapshots independently reject in-place Map mutation. |
| ORC-012 | This record identifies the production source and independent branch boundary. |
| ORC-013 | Metadata transitions require sharing, while same-key value writes require replacement. |
| ORC-014 | Core-only synchronous Collection boundary; no unverified host/provider transfer is claimed. |
| ORC-015 | Eight declared reach states, including metadata transitions and value-only changes. |
| ORC-016 | Fixed and generated histories use the same model and comparison; ordinary examples remain in the ordinary test file. |
