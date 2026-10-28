# SSR observer code isolation

This follow-up starts at `7b4d1c00f8737e19d6ace7a6ecce8ce7c5830eb2`, after
merging main `5649a07d468117891193c2e4cde9c7706308b1cd` into PR #2229. The
commit containing this record also contains its production and oracle changes.

## Law and repair

The maintainer requested that applications without SSR avoid shipping SSR
fixes. Previously the shared observer class contained server admission,
render-time capture, hydration reconciliation, and stream handoff even when no
DbClient was imported. Runtime guards prevented execution but not inclusion.
The repair moves that implementation to `live-query-observer-client.ts`,
instantiated by DbClient through a type-only boundary in the shared observer.
The existing hydration state and transitions are relocated, not replaced with
a second state machine. React delegates streaming discovery through this
boundary too. Existing runtime laws and oracle judgments stay unchanged.

DbClient's current API includes hydrate/dehydrate and streaming support on one
class. A browser application using DbClient only for descriptors still retains
that implementation. Eliminating that cost requires an explicit SSR opt-in API
and a migration; this follow-up preserves the existing API. No universal
no-SSR-code claim is made for DbClient applications.

## Executable evidence

- **Reach:** the finite grammar enumerates all six combinations of three React
  hook entries (ordinary, Suspense, infinite) and DbClient absent/present.
  Each bundles real built ESM with production defines. The oracle observes the
  final code and positive `bytesInOutput` for the transport module, rather than
  merely inputs visited during tree shaking.
- **RED:** `node scripts/ssr-bundle-oracle.mjs`, before production edits, failed
  `useLiveQuery client-only bundle must exclude _captureServerQuery`.
- **GREEN:** that command passes all six programs after extraction. All plain
  hook bundles exclude the entire transport implementation; each DbClient
  control retains it and both admission/capture operations.
- **Mutant:** `node scripts/ssr-bundle-oracle.mjs --calibrate` deliberately retains
  DbClient in a plain program. It reaches and fails the same absence assertion;
  it is an assertion rejection, not a setup failure or timeout.
- **Runtime:** 171 core tests cover observer snapshots, observer histories,
  focused observer behavior, DbClient, and hydration authority. All 701 React
  runtime tests pass, including generated SSR receiving histories and actual
  React hydration. Svelte's admission, actual server-to-browser handoff, and
  hydration suites pass 32 tests. Router passes nine tests.
- **Published output:** the minified public API check passes 108 error names,
  query results, live updates, and index metadata. Production error erasure and
  mangle-cache checks pass. These runs disable Vitest's optional test-file
  typecheck; minified package builds generate declarations, but this is not a
  claim of a full repository typecheck.
- **Limits:** the bundle law covers the six enumerated esbuild programs, not
  every framework or bundler. Runtime laws remain with their existing owners.
  A separate opt-in SSR API is needed for client-only DbClient applications.
  No new generated runtime law or grammar is claimed, so random campaigns,
  shrinking, and new generated reach requirements do not apply to this finite
  build oracle. Its expected inclusion follows declared imports, independently
  of the observer's implementation. Its calibration rejects the concrete
  unwanted inclusion. No second reference formulation is needed to judge
  whether the measured output contains that implementation.

## Shipped bytes

`node scripts/size-compare.mjs --packages db,react-db --files` compares identical
production build tools against main `5649a07d4`. It uses the cached baseline and
the same dependency-tool substitution documented in
[the merge report](2026-10-26-main-merge-size.md).

| Bundle | Main gzip | Before extraction | After extraction | After versus main |
| --- | ---: | ---: | ---: | ---: |
| Typical app | 102142 | 102608 | 101791 | -351 |
| DB, every export retained | 103207 | 104108 | 104427 | +1220 |
| React, every export retained | 4921 | 4964 | 4942 | +21 |

The typical app loses 817 gzip bytes versus the previous PR head and is 282
Brotli bytes below main. Its observer contribution falls by 2207 minified bytes
relative to main. The new transport module contributes zero bytes to this app.
The remaining collection admission/ownership changes are runtime fixes used by
client-only applications, not SSR code.

The full DB bundle grows 319 gzip bytes versus the previous PR head because the
client/observer boundary adds delegation and host callbacks. It retains all SSR
exports by definition. This is an explicit tradeoff, not a package-level saving.
The first attempted refactor moved only admission/capture: it left the app 330
gzip bytes above main and the full DB bundle 995 bytes above main. Moving the
remaining hydration and stream implementation removes the broader client-only
cost. Keeping the old monolithic class is smaller when retaining every export,
but fails the maintainer's plain-app isolation requirement.

Tests add one finite bundle oracle and its CI registration. Contract and review
documentation grow separately from production code; neither ships in app bundles.
