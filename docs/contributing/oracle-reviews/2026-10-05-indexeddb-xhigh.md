# IndexedDB xhigh review evaluation

This record evaluates the 15 code-reading findings supplied for PR #1179 at
`6ad2edc429720601ecc9b4c1b19bc2bc27b0dabd`. The reviewer reported no test
execution. Evaluation began at `eb4b8751f09b6b3c1dce0708cd0953e3e13bb37d`, whose
only additional change was the minification cache. The repaired implementation
and executable evidence are committed at
`b6f763ffe3b6319218e565d682d461cc030cbf7f`. This document adds no runtime change.

## Reviewer assessment

**Hire for code review.** The review found consequential persistence defects
beside a substantial green suite: id overrides, missing version metadata, local
write ordering, and deletion/recreation. Its coverage across runtime, test
integrity and API diagnostics was useful. The top findings deserved priority.

Its evidence quality was incomplete: no execution was reported, and several
claims combine an observation with an unstated product policy. Old-connection
failure is a consequence of the explicitly approved recreation policy. A stale
deletion clears public rows but does not delete the recreated durable data.
The unused error classes were already documented as unused constructors.
Duplicate builds are real, but an intermittent CI failure caused by their overlap
was not reproduced. Sequential request admission is measurable; an elapsed-time
speedup was not measured. These qualifications affect severity and scope, not
whether the review's surviving ideas should be retained.

## Finding ledger

Paths in this table are relative to `packages/indexeddb-db-collection`, except
where stated. IDs preserve the source order; no findings were merged.

| ID | Original claim and suggested action | Evidence and technical verdict | PR action | Durable value and destination |
| --- | --- | --- | --- | --- |
| XH-01 | `src/indexeddb.ts:739`: slow update A overwrites later fast B; both report persisted. | Confirmed at public and raw durable cuts: B then A, both completed. Mutation ordering required a decision; the maintainer approved author order within one Collection. | **fixed-now**, P1. Handlers run concurrently; successful persistence reserves and follows invocation order. Rejections release the next position. | `tests/local-write-order-oracle.test.ts`: 146 cases, completion permutations, rejection masks, repeated/disjoint keys, delete/reinsert, held predecessor, synchronous handler reentry. Native held insert/update witness in all three engines. |
| XH-02 | `:722`: overriding `id` after options construction silently saves nothing; use Collection reference. | Confirmed: `isPersisted` fulfilled with an empty store. The options-captured id differed from the real Collection id. | **fixed-now**, P1. Match the receiving Collection reference, retained across cleanup. | Compatibility owner: options/Collection id placement crossed with automatic/manual/after-cleanup acceptance; raw storage and fresh restore. |
| XH-03 | `:678`: restored rows without `_versions` cause duplicate inserts on peer update and ignore peer delete. | Both confirmed. Update entered Collection error; deletion left the restored row visible. | **fixed-now**, P1. Version metadata no longer decides membership. Reconcile durable values as full updates and missing values as deletes. | Transport owner: none/mixed/all initial metadata, numeric/string keys, update/delete, duplicate delivery and untouched anchor. |
| XH-04 | `:791`: export/restore fails for a transforming schema; output and input types differ. | Confirmed string-to-Date output rejection. Import's existing contract is schema input, and arbitrary transforms have no inverse. | **fixed-now** documentation, P2. Qualify direct round trips and explain explicit conversion. No trusted-output API was added. | API test checks output rejection without changing storage, then explicit inverse conversion and equal export. A separate output-restore API remains a maintainer design option. |
| XH-05 | `:440`: missing `_versions` passes option validation; fail early with `ObjectStoreNotFoundError`. | Confirmed using a pre-existing native store reopened at the same version. No upgrade callback creates metadata. | **fixed-now**, P2. Validate both required stores before constructing options. | API test distinguishes existing native schema from factory-created schema. |
| XH-06 | `:652`: a peer upgrade closes the connection; later notification errors old Collections/live queries. | Same-path probe confirms old source and dependent query error while a fresh descriptor stays usable. This follows the previously approved automatic-close/recreate policy. | **deferred** alternative lifecycle design. Retain the approved behavior; document the background-read consequence. | Transport connection owner and coverage map: a different retirement/status/restart API needs an explicit contract and old/fresh/downstream witnesses. |
| XH-07 | `:638`: stale name-only deletion message wipes a recreated database; add incarnation protection. | Partly confirmed: old deletion success callback held across recreation clears fresh public rows; raw durable rows survive. | **fixed-now**, P1. Maintainer approved connection-scoped deletion authority from native deletion or local initiation. No persisted epoch was introduced. | Transport owner and native two-page tests: native deletion completes, fresh descriptor writes, old success callback releases, real notification arrives, public/durable/fresh-restored rows remain equal. |
| XH-08 | `:629`: null/malformed messages reject listeners or error Collections. | Confirmed null TypeError outside the catch and malformed-key Collection error. | **fixed-now**, P2. Validate the protocol envelope before routing or storage work. | Transport owner: null/primitives/missing fields/invalid kinds/key carriers/key values plus an unseen durable row reached by a valid neighboring message. |
| XH-09 | `src/wrapper.ts:54`: contextual Error loses native error name/cause. | Confirmed native VersionError became Error with no cause. Request errors also lost identity. | **fixed-now**, P2. Contextual errors preserve the original cause; callback rejection identity remains intact. | Wrapper owner compares exact request-error cause, synchronous cross-realm cause and native open failure. |
| XH-10 | `src/errors.ts:3`: five exported classes are never thrown; adapter errors extend Error. | Confirmed source inventory and failed native-error instanceof probe. Existing docs explicitly disclaimed that hierarchy. | **fixed-now**, P3. Maintainer approved removing unused constructors, exports and reference pages. | README and wrapper cause contract; no new exception hierarchy or changed callback identity. |
| XH-11 | Root `test:oracles` uses arbitrary existing `db/dist`, fails fresh and leaves coverage enabled. | Confirmed: hiding db/dist fails package resolution before any test runs. Other adapters' tsconfig source paths corroborate the missing setup. | **fixed-now**, P2. Dedicated runtime/type source configuration; oracle commands disable coverage. | Complete runtime/type suite passes with db, db-ivm and adapter dist absent. Build-consuming declaration tests remain separate. |
| XH-12 | Package `test` rebuilds all dependencies after CI already builds them, potentially racing other readers. | Duplicate build and concurrent CI topology confirmed from scripts. The claimed intermittent CI failure was not reproduced. | **fixed-now**, P2. Default tests never build. Root package checks build after runtime suites; CI reuses completed builds after its runtime group. | `test:package`, `vitest.package.config.ts`, root test script and `scripts/ci-tests.mjs`; published consumer validation remains covered. |
| XH-13 | `:552`: every put/delete awaited serially; enqueue the batch and await native completion. | Ten-row import issues 20 requests but only one before the first succeeds. Improved request admission is proven; elapsed speedup is unmeasured. | **fixed-now**, P3. Queue native writes in the existing transaction and retain transaction completion/abort as settlement. | Settlement owner checks 0/1/10 rows, exact 2N request count and admission before first success; existing clone/abort matrices retain atomicity. |
| XH-14 | `:481`: unused collectionVersion, timestamp, stored updatedAt and phantom `_TKey` add cost. | Source search confirms no semantic readers. Persisted updatedAt has an observation in the existing persistence tests; generic position is public. | **deferred** stored-format/public-type cleanup, P3. Removed unused notification fields now; retained stored updatedAt and generic position. | Persistence owner must receive old/new record compatibility; declaration consumers must receive generic-arity changes. Both remain listed in the coverage map. |
| XH-15 | `:775`: estimatedSize is origin usage, not database size. | Confirmed: empty database returns a mocked origin usage of 987654321 bytes. | **fixed-now** documentation, P3. Property, guide and README state origin scope; name retained for compatibility. | Focused API witness and DatabaseInfo reference; no database-size guarantee or fabricated estimate. |

## Changes and GREEN results

The repair started with failing executable witnesses rather than adopting all
review claims as policy. Three decisions were explicitly approved: automatic
write order, connection-scoped deletion, and removal of unused error exports.
Import remains a schema-input API. No separate backup API was implemented.

At the implementation snapshot:

- **314 runtime/type tests** pass across 11 files, with coverage and no unhandled
  errors or type diagnostics. This includes **146** local-order cases.
- **12** published-declaration tests pass after ESM/CJS builds, using Node16,
  NodeNext and Bundler consumers without skipping library type checking.
- **54** browser cases pass, 18 each in Chromium, Firefox and WebKit, including
  existing fixed/fresh campaigns and hostile controls.
- The complete runtime/type suite passes with all three dist directories
  temporarily absent: **313 tests** before the final schema-contract example
  was added. Each directory was restored in a finally block.
- TypeScript, ESLint, formatting, private-member cache safety and CI group
  assignment checks pass.

Commands from the package directory were the direct installed Vitest,
TypeScript, ESLint and Playwright CLIs. `pnpm --filter
@tanstack/indexeddb-db-collection test:package` ran the package build and consumer
lane. As recorded in earlier evidence, the local registry cannot supply tracked
Rollup 4.64.0; local builds use cached 4.59.0. The lockfile was not changed.
These are local results; remote CI is tracked separately.

Production weight is **+102/-133 lines, net -31**, including removal of unused
constructors. Tests and configuration add independent evidence; the much larger
negative documentation diff removes the five obsolete generated API pages.

## RED evidence and checker calibration

With the new tests/configuration retained, replacing the two production modules
with their `eb4b8751f` contents gives **47 assertion failures / 209 passes**:

| Owner | Intended assertion failures |
| --- | ---: |
| Local ordering | 28 |
| Transport boundaries | 10 |
| Collection identity compatibility | 3 |
| Request admission/atomic settlement | 2 |
| Native error causes | 3 |
| Required metadata-store admission | 1 |

No timeouts or setup failures are counted in those 47. Restoring the fixed
modules makes the comparisons pass. The two new native tests each fail in all
three engines: stale deletion yields an empty public snapshot, and the later
local write reaches storage while the earlier handler is held. All six failures
occur at the intended assertions; all six pass with the repair.

An initial deletion probe accidentally allowed fake-IDB to call the original
success callback directly. It did not reach the held-receipt premise and was not
credited as a refutation. Correcting the event-property control reached the
failure. An initial full browser run used a blocker after the first automatic
write; the new automatic queue made that fixture schedule deadlock. The omission
witness now uses explicit manual acceptance to admit both native transactions
before the blocker, retaining its original full-row and publication assertions.
Its automatic-order responsibility is covered by the separate new native test.

## Oracle guide audit

| Requirement | Evidence or applicability |
| --- | --- |
| ORC-001 | Approved local order/deletion laws; existing persistence, input validation and native transaction contracts; bounded limits stated beside each owner. |
| ORC-002 | Authored row folds and independent raw IDB observations; expected results do not read adapter caches or returned payloads. |
| ORC-003 | Opening/adjacent prose distinguishes law, model, legal cases, production driver and observation cuts. |
| ORC-004 | New matrices are bounded enumeration, not claims of generated grammar coverage. Existing fixed/fresh generated owners are unchanged and run green. All six orders/eight masks are explicit; metadata and identity axes retain their independent witnesses. |
| ORC-005 | Actual Collection APIs, real handler gates, raw storage and public/peer/fresh restore cuts. Native callback counters prove real notification delivery. |
| ORC-006 | 47 original-source assertion failures and six native original-source failures reach the intended checkpoints. |
| ORC-007 | No new important generated property; existing fixed/fresh/replay machinery remains in use. New local-order claim is finite enumeration. |
| ORC-008 | Local reference stores authored effects and decision positions; changing either can change the final accepted fold. It does not model a second persistence queue. |
| ORC-009 | Mutation order, handler settlement, native completion, Collection status and publication are distinct. The local fold is a stated abstraction of accepted whole-row effects. |
| ORC-010 | Existing harness preserves primary/cleanup diagnostics; held local gates release before assertions and native evidence remains runner-owned. |
| ORC-011 | Public/raw storage/fresh restore are separate observations that reject optimistic-only agreement and adapter-export-only false greens. |
| ORC-012 | This record identifies the exact implementation commit, RED/GREEN receipts and remaining owners; the coverage map preserves unresolved design boundaries. |
| ORC-013 | Held predecessor versus released predecessor, valid neighbor versus malformed message, missing versus present metadata, old versus recreated descriptor, and zero/one/many requests distinguish the asserted cuts. |
| ORC-014 | Native ordering and deletion/recreation premises are received in all three engines. The callback hold is explicit test control; uncontrolled tab suspension, quota, eviction and physical crash remain unproved. |

## Deferred design and loss audit

XH-06 retains the approved connection-retirement policy. XH-14 retains the
stored-field and public-generic compatibility question. Their destinations are
in the IndexedDB section of `oracle-coverage.md`. XH-04's separate trusted-output
restore API remains an optional design question; the documentation now describes
the existing input API correctly, and the invalid-input preservation witness is
retained. No new restore API is implied by a corrected example.

The audit returned to all 15 raw findings, including the cleanup and diagnostics
items. Counts: **13 fixed-now + 2 deferred = 15**. There are no duplicates,
unaccounted items, or missing reproduction evidence for claimed behavioral
fixes. The build-race failure and elapsed performance claims remain explicitly
unmeasured rather than reported as reproduced. This is bounded evidence, not a
claim that every cross-tab history is correct. Cross-Collection ordering,
utility/automatic ordering, pending writes across cleanup/restart, lost
notifications, nested mutable values, and physical crash durability keep their
existing coverage-map owners.
