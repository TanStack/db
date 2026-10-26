# Main merge and size comparison, 2026-10-26

Measured merge: `ed22e033c335dd6a3e3b84290a0961885a7bfd9f`. Main: `5649a07d468117891193c2e4cde9c7706308b1cd`.
The merge's other parent is `b4955406a57e0032caffd7d494ca66799c45dd00`.

## Integration contract and evidence

The existing SSR law remains: the first browser view reproduces the rendered
server rows and readiness. An infinite query uses the identity of its initial
window for that transport. Authority: `docs/guides/ssr.md`, the existing
`ssr-snapshot-admission-oracle.ts`, and its React receiving driver in
`descriptor-query-binding-oracle.test.tsx`.

Main moved infinite-query binding into core. The merge carries the original
window query's hash through that binding and passes its client and hash to the
window controller. It retains the server snapshot callback and main's reclaim,
identity, and render-rejection boundaries.

RED: the first merge resolution computed the hash from a newly created
Collection instead of the query. The unchanged SSR oracle rejected it in seven
checks: prepared query admission, first browser rows/readiness for ready and
cold/loading sources, and the fixed and random campaigns. This attempted
simplification is the hostile wrong design: its generated Collection ID cannot
name the preloaded query window across server and browser. The repair retains
the initial query hash instead. The same receiving comparisons are GREEN.
No oracle row or readiness expectation was weakened.

Main's shared React identity law rejects an unkeyed opaque query with
`UnhashableQueryIRError` during preparation. Its authority is the identity
contract in `packages/db/tests/conformance/contract.ts` from main. Two older
warm/cold streaming checks expected a later custom SSR error. Their assertion
now requires the earlier error class. Keyed controls still require successful
rendering and transported rows. This changes error precedence to the law
merged from main; it does not permit untransported rows.

The existing infinite SSR grammar reached the following states in normal runs:

| State | Fixed | Random |
| --- | ---: | ---: |
| Cold/loading | 19 | 22 |
| Unbacked ready-empty | 5 | 6 |
| Unbacked rows | 43 | 42 |
| Prepared query result | 18 | 17 |
| Normalized ready source | 12 | 18 |
| Normalized partial source | 23 | 15 |
| Pending query | 19 | 26 |
| Server write | 29 | 35 |
| Browser write | 27 | 31 |
| Same-query browser preload | 14 | 16 |

Validation: 701 React runtime tests, 482 scoped core tests, 109 Svelte tests,
13 additional Svelte server-to-browser receiving tests, and 9 Router tests:
1,314 tests. Normal staged lint, oracle lint, production error erasure,
error-document consistency, private-name cache checks, and the minified public
API check passed. The size builds also completed. Vitest's optional in-test
typechecker reported cross-package fixture/rootDir errors; these runtime runs
use `--typecheck.enabled=false`. This is not a claim of a clean full typecheck.

This bounded integration run does not establish all framework scheduling paths
or close the earlier whole-PR evidence gaps. Their existing owners and limits
remain in the coverage map.

## Shipped bytes against main

Vite packages and app scenarios use `pnpm size:compare --exact-base --files
--packages db,react-db,react-router-with-db`. Dependencies are external for
package bundles; scenarios inline their workspace dependencies and leave React
and TanStack Query external. All use production definitions, minification,
gzip level 9, and Brotli level 11.

| Bundle | Main gzip | Merge gzip | Gzip change | Brotli change |
| --- | ---: | ---: | ---: | ---: |
| db | 103207 | 104108 | +901 (+0.9%) | +737 |
| react-db | 4921 | 4964 | +43 (+0.9%) | +44 |
| react-router-with-db | 943 | 968 | +25 (+2.7%) | +27 |
| app | 102142 | 102608 | +466 (+0.5%) | +350 |
| app-effect | 104582 | 105075 | +493 (+0.5%) | +450 |
| app-group-by | 102034 | 102482 | +448 (+0.4%) | +378 |
| app-includes | 102215 | 102686 | +471 (+0.5%) | +408 |
| app-join | 102212 | 102683 | +471 (+0.5%) | +387 |
| app-local-storage | 105055 | 105520 | +465 (+0.4%) | +383 |
| app-optimistic-action | 102288 | 102755 | +467 (+0.5%) | +570 |
| app-paced-mutations | 103326 | 103785 | +459 (+0.4%) | +497 |
| svelte-db | 2220 | 2231 | +11 | +11 |

Svelte uses its own `svelte-package` build rather than Vite library mode. Its
package measurement compiles packaged `.svelte` and `.svelte.js` modules in
production client mode, then bundles every export with esbuild and external
package dependencies. It uses the same compression settings as the Vite
package measurements. It is a package measurement, not a Svelte app scenario.

The typical app grows by 466 gzip bytes (0.5%) and 350 Brotli bytes. The
all-exports package measurements are separate views and must not be added to
that app's size. Tests and this evidence document are outside shipped bundles.
This task measures the merge; it does not attempt a new size optimization.

The package proxy returned HTTP 403 for a newly locked tool dependency and
public npm was unavailable. Both source trees therefore used identical cached
build tools: Vite 7.3.6, esbuild 0.28.1, and TypeScript 5.9.3. The measurement
compares the exact main and merge sources with that common toolchain; it does
not certify a fresh installation of the merged lockfile. The normal commit
lint hook passed with pnpm's dependency auto-install disabled.
