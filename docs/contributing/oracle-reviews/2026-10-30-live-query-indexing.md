# Explicit indexing on live-query Collections

Base: `bfd1da1a7e752d66fd667adfd3cdf54f60732b22`.
Decision: the maintainer accepted explicit output indexing options while
preparing the fix for [issue #2292](https://github.com/TanStack/db/issues/2292)
on 2026-10-30. This record applies to the accompanying indexing change.

## Law and boundary

`autoIndex` and `defaultIndexType` on live-query configuration apply to its
output Collection through `createLiveQueryCollection`,
`createCollection(liveQueryCollectionOptions(...))`, and framework hook config
objects. Omission keeps indexing off. A constructor alone supports manual
indexes. Eager indexing requires an explicit constructor. Source Collection
settings remain unchanged. These extend the existing Collection indexing
contract; they introduce no source inheritance or client-wide default.

The previous indexing owners correctly tested source Collection settings and
reader selection. They did not construct an intermediate live-query Collection
with indexing settings through these convenience APIs. The missing dimension
was the configuration entry point, rather than the index implementation.

## Pre-edit inventory and RED

Production remained unchanged until both the core and real framework receiving
comparisons ran. The core owner is
`packages/db/tests/query/custom-index-order-selection-oracle.test.ts`.
The hook handoff uses `packages/db/tests/conformance/indexing-config-oracle.ts`
through each framework's existing real driver.

Core command:

```sh
pnpm --filter @tanstack/db exec vitest run --coverage.enabled=false --maxWorkers=2 tests/index-suggestion-oracle.test.ts tests/query/custom-index-order-selection-oracle.test.ts
```

On the base: 14 failed, 30 passed. Failures showed lost constructors, eager
becoming off, and missing rejection of eager without a constructor. Both
construction paths failed. Defaults and existing diagnostic/selection witnesses
passed. A separate compile-time run rejected the new literal config properties
on both convenience APIs and `LiveQueryHookConfig`.

Framework RED results: React 14 failed and four defaults passed across two
registrations; Preact, Vue, Solid, Svelte, and Angular each had seven failed
and two defaults passed. All final runs reached assertions without setup or
cleanup errors.

Framework command shape (Svelte uses `conformance.svelte.test.ts`):

```sh
pnpm --filter @tanstack/react-db exec vitest run --coverage.enabled=false --maxWorkers=2 tests/conformance.test.tsx -t 'hook config applies output indexing'
```

React, Preact, Vue, Solid, Svelte, and Angular supply their native hook and
settled flush cut. Constructors come from each driver's DB module realm.
Svelte consumes built package output, so its RED first builds unchanged DB and
its GREEN rebuilds the repair. A module-resolution setup failure is not counted
as a RED result.

## GREEN, reach, and hostile controls

The core command plus `tests/query/live-query-indexing.test-d.ts` passes 45
tests, including literal config acceptance and retained inferred row types.
The adjacent `tests/query/live-query-collection.test.ts` and
`tests/live-query-options.test.ts` pass 146 tests.

Full framework conformance passes 667 tests: React 211, Preact 103, Vue 110,
Solid 71, Svelte 107, and Angular 65. All six packages also pass
`pnpm exec tsc --noEmit --pretty false`. Svelte's test first rebuilds DB;
React's type check first builds react-db for its router imports.

Reach is one history per core configuration, 18 total. Hook receiving reach
is one per configuration and registration, 63 total: 56 output reads and seven
admission rejections. Each reach has a minimum of one and fails if missing.
The matrix is exhaustively registered, including both React registrations.

Two temporary source mutants run the core selection owner and fail at its
assertions. Removing both config assignments reproduces 14 failures with ten
neighboring passes. Inferring eager mode from a supplied constructor produces
eight failures (`eager` where `off` is required), with 16 passes. These are
assertion rejections, not timeouts or setup failures. The source is restored
exactly before final validation. No mutant is committed.

Before the Suspense follow-up, `pnpm lint:changed` and `git diff --check` passed.
`pnpm size:compare --packages db`
reports +26 gzip bytes and -42 brotli bytes for the full DB export bundle.
The typical app adds 25 gzip bytes and 15 brotli bytes. At that stage, the only runtime additions
were the two output config assignments. Reusing Collection indexing and
validation adds no helper, branch, retained state, or recovery machinery.
There is no duplicated runtime logic to remove on this boundary; a broad config
spread would also copy query-only options into the Collection config.

## Grammar and judgment

The core grammar exhausts 18 configurations: omitted/off/eager mode, omitted/
BasicIndex/BTreeIndex constructor, and direct/options construction. Each case
requires one declared reach. Legal cases compare public config and index
constructors. They read two projected numeric fields with both null placements,
repeat a consumer, apply a source update, and read again. Full array sorting
independently predicts the two-row windows. `optimizedOnly` snapshots require
an eligible reader for eager mode. The invalid eager/no-constructor cases
compare admission rejection.

The hook grammar exhausts nine configurations per driver registration. It
checks output config, a downstream filter, automatic index creation or manual
constructor use, and source settings after the real framework flush. Each
configuration declares its own reach for each receiving path.

Removing mode loses default/off distinction. Removing constructor loses manual
configuration and eager admission. Removing path admits a direct-only fix.
The two fields and null placements reject a single predeclared-index solution.
Source updates distinguish creation from later index maintenance. Invalid
admission is tested explicitly rather than excluded. Bounds are two index
implementations, finite numeric/null values, two-row windows, and one update.

## Limits

This change does not claim benchmark timings, complete backend paging,
arbitrary custom constructors/comparators, options changed after hook mount,
or framework rendering before the settled flush cut. Existing index selection
and provider oracles retain those responsibilities. The configuration grammar
is bounded exhaustive enumeration, so random-campaign/replay requirements do
not apply. The model is stateless recomputation; it copies no production index
or query-planning classifier. No concrete missing-source-information hypothesis
arises for these ready in-memory Collections.

## Guide audit

- ORC-001–005: the accepted Collection contract and maintainer decision supply
  authority; bounded settings grammar, real constructors, native flush cuts,
  and full-recomputation windows are visible beside the executable checks.
- ORC-006: pre-edit RED rejects dropping either option; hostile calibration and
  repaired results are recorded below.
- ORC-007: random campaign requirements do not apply to bounded enumeration.
- ORC-008–009: the model adds no state machine or model-only lifecycle concept.
- ORC-010: core uses `withOracleCleanup`; framework witnesses use the existing
  scenario lifetime. Both preserve primary and secondary cleanup failures.
- ORC-011: no additional shared-fault hypothesis needs a second formulation.
  Public windows already compare with a structurally different full sort.
- ORC-012–015: this versioned record, per-configuration reach, real receiving
  drivers, and neighboring defaults/admission checks bound the evidence.
- ORC-016: generated configurations share one judgment; concrete TypeScript
  inference assertions live in a separate ordinary type test.

## Review follow-up: independent Suspense consumers

Independent review found one missing receiving path after the initial repair.
Two initial React Suspense bindings for the same source/query could share the
first output Collection and silently receive its indexing settings. Executed
witnesses distinguished off from eager/Basic and Basic from BTree. The initial
non-Suspense receiving matrix did not include peer cache reuse. This path was
not part of the original pre-edit gate; its shared grammar extension and RED
precede the cache repair.

The accepted output-settings law applies to each initially mounted binding.
The repair qualifies React's local Suspense cache by effective indexing mode
and exact constructor identity. Portable query identity and DbClient row-cache
identity stay the same. A mounted binding keeps its bound options until query
identity changes, as the existing bound-options contract requires.

Review also examined a warm DbClient preload that accepts unused eager/no-type
settings after a valid preload. Cold construction rejects; warm reuse returns
only cached rows and constructs no output Collection. The Collection
construction law does not require validation of unused index declarations on
that path. This PR adds no broader preload-admission policy.


The extended shared grammar receives 534 two-binding histories through React
Suspense: 486 built-in configurations and 48 distinct same-name constructor
histories. Both unscoped and DbProvider-scoped caches run derived identity,
same explicit key, and different explicit key histories. Each binding's
admission and declared settings are checked independently; the first admitted
binding is checked again after the second. Compatible settings also retain
existing Collection sharing, including omitted versus explicit off.

Before the cache repair, 264 histories failed at config/admission comparisons
and 270 passed. Each scope had 116 built-in and 16 same-name failures. All 178
different-key controls passed. No setup, cleanup, or type failures supplied
that RED. After repair, the 534 histories and neighboring source-ID/Suspense
suites pass together: 948 tests. The final six-framework conformance rerun
passes 667 tests, and all six package TypeScript checks pass again.

Each of 267 histories per cache scope reaches both admissions and the
post-second first-binding check. There are 480 valid and 54 expected-rejected
admissions in each position. The retained-output comparison therefore runs in
480 histories, conditional on first admission; rejected first declarations do
not count as retained output observations. All 534 histories complete the
conditional checkpoint. There are 56 compatible-sharing histories and 178
different-key histories.


Two temporary cache mutants calibrate this receiver. Removing the indexing
qualifiers reproduces 264 assertion failures with 270 passes. Using constructor
names instead of reference tokens fails 16 same-name comparisons, with 518
passes. Neither fails by setup, cleanup, or timeout. Exact source restoration
is followed by a clean 534-history GREEN run.

Final `pnpm size:compare --packages db,react-db`: DB +26 gzip/-42 brotli bytes,
React +36 gzip/+38 brotli bytes; typical app +63 gzip/+31 brotli bytes. The cache
repair reuses the existing weak object-identity tokens and removes the empty-
source key branch. It adds no map, lifecycle state, retry, or default policy.
The small byte increase pays for preserving each initial binding's explicit
settings while retaining compatible sharing.

The final independent review found no remaining code or oracle defect. Its two
editorial observations are resolved here: retained output counts exclude first
admission rejection, and final runtime/size evidence includes the React repair.
The simplification review proposed no edits. Final lint and diff checks pass;
the new guide example also passes the targeted documentation snippet checker.

Reviewed content fingerprint: `36e3373439814c25f940c96c79a6f294344b2d2d049d12c545b1f7ca0a863a66` (SHA-256 of each sorted
changed package/test path, NUL, byte length, NUL, and contents, followed by the
guide and coverage-map changes in the same sorted path list; excludes this
record and local research notes). Base remains the commit named above.
