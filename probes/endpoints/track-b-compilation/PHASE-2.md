# Phase 2 — Safety regressions and source correspondence

**The measured leaks now fail safely under an explicit module policy.** Shared imports, the actual dev/production RPC and the authored callback still work. Source-map tests found two further source-disclosure paths, and error-response tests found another; those measured cases are also red/green.

This remains a probe. It does not infer which arbitrary modules contain secrets, provide a production plugin, or prove the integrated Todo.

## Red/green evidence

All paths below are under `evidence/phase-2/`. Original phase-1 evidence is unchanged. `phase-1/` preserves the old compiler, runtime test and report. `phase-2-snapshots/before-grammar-preflight.mjs` preserves the intermediate compiler before the final error-response fix.

| Regression | Red observation | Green observation |
| --- | --- | --- |
| Retained server helper | Build exits 0; browser JS contains database sentinel | Build exits 1 with `ENDPOINT_SERVER_IMPORT_IN_CLIENT` |
| Side-effect-only server import | Build exits 0; browser JS contains side-effect sentinel | Same classified rejection |
| Transitive server helper/side effect through shared module | Class extension beyond the original two examples | Both reject; `.server.ts` naming-policy case also rejects |
| Transform source correspondence | Original transform returns `map:null`; assertion fails | Five authored tokens recover exact original line/column |
| Production browser `.map` | JS is clean, but `.map.sourcesContent` embeds original handler | Client maps keep mappings and omit embedded original content; all emitted client JS/maps pass sentinel scan |
| Dev inline map | HTTP 200 endpoint JS is clean, inline map embeds 454-character original source | Actual delivered inline map has no embedded server source |
| Server module rejection response | Transform-hook failure echoes server source in Vite error response | Load-hook rejection occurs before source is read; direct and `?raw` error responses omit source |
| Unsupported/malformed endpoint error response | Extra property and syntax error both echo original endpoint source | Client load preflight rejects both before active transform source can enter the response |

`red-safety.json` records the original two red failures; the safety command exited 1. `green-safety.json` records all five final classified rejections. A generic build failure does **not** pass this test. `red-built-maps.json` / `green-built-maps.json`, `red-dev-delivery.json` / `green-dev-delivery.json`, `red-grammar-error.json` / `green-grammar-error.json` and the error-response logs preserve the other results.

## What changed

`serverBoundary` uses public Vite environment/load hooks. The fixture explicitly declares `src/server-helper.ts` and `src/server-side-effect.ts` server-only; files named `*.server.ts` (and supported JS/TS variants) also qualify. Any such module reached in the client environment is rejected before loading its source. This covers direct and transitive imports and catches side effects even when their value is unused. Ordinary `shared.ts` remains valid and runs in the client callback and server handler.

The guard does not infer sensitivity from a function name or a sentinel. An unmarked arbitrary module is outside its guarantee. Canonical file paths handle the configured local files; other bundler virtual-module schemes and plugins are not established by this probe.

The transform now assembles preserved authored spans with MagicString instead of regenerating every property through Babel. The direct transform map recovers exact positions for the input schema, handler expression, server string and client callback. Actual composed Start/Vite maps recover endpoint line 9 for the server literal and line 7 for the callback; the bundler maps each string to its opening delimiter, one column before the inner text. Server source names carry Start's `?tss-serverfn-split` suffix. These are tested token/line correspondences, not proof for every generated position. New adapter code has no authored equivalent.

Production client output uses Rollup `sourcemapExcludeSources: true`. Client debugging keeps source locations but no embedded authored source. Server maps retain source content and must remain server artifacts. The dev probe filters inline map comments from Vite's `response.end` output because later Vite map composition can restore sources omitted earlier. Malformed map comments are dropped. This is a bounded dev middleware experiment, not a production response-filter implementation.

Declared endpoint source is validated in the client load hook so known grammar/parser errors do not cause Vite to echo the entire endpoint as active transform source. The transform still validates again; this duplicates parsing and span assembly and has no performance measurement. `?raw` and `?url` endpoint imports reject before source loading.

## Preserved behavior

`dev-browser.log` and `production-browser.log` record actual installed Chrome POST 200 calls, correct server output, callback output `optimistic:shared:test`, and no page errors. Empty text produces a serialized schema error over HTTP 200 with no handler result; that is Start RPC behavior, not an HTTP validation-status adapter.

`run.log` / `results.json` repeat handler/helper edits, rename/delete, old RPC replay and clean builds. These are dev-server invalidation **with full page reload**, not same-page HMR/state preservation. Old RPC URLs still return 500 `action is not a function`, rather than a graceful 404. The final load-preflight addition was followed by the dev and production baseline browser checks and all final safety/map/grammar/type checks.

Type checking still rejects wrong caller inputs and proves the authored result's string field. Generated code is compiled by Vite but is not independently typechecked. The callback displays a string; no DB transaction, rollback or mutation settlement was added.

## Why phase 1 missed the classes

Phase 1 observed import leakage but treated it as an expected passing experiment. It lacked a safety assertion requiring a recognized rejection for server-reachable browser imports. The new regression makes the original compiler fail, and adds transitive paths to prevent a fix confined to the reported direct imports.

The original artifact scan covered `.js` only. A source map is also a delivered artifact and can contain the complete pre-extraction endpoint. Tests now inspect production `.map` files and actual dev inline maps separately. Successful exclusion must cover both code and metadata.

Checking only the HTTP status and diagnostic code missed source echoed in error payloads. The new tests inspect the rejection body for both a server module and invalid endpoint source. They distinguish a successful rejection from a rejection that discloses the rejected code.

## Commands

Run serially from this probe directory; several tests mutate and restore fixtures in `finally`. Do not overlap browser tests with the safety fixture mutations.

```sh
node tests/grammar.mjs
node tests/correspondence.mjs
node tests/safety.mjs
node tests/built-maps.mjs
node node_modules/typescript/bin/tsc --noEmit

# Terminal 1: local dev server
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4179
# Terminal 2
node tests/dev-delivery.mjs
node tests/dev-rejection.mjs
node tests/dev-grammar-error.mjs
node tests/run.mjs
node tests/browser.mjs

# A map-enabled production build and server
PROBE_SOURCEMAP=1 node node_modules/vite/bin/vite.js build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4180
# Another terminal
PROBE_URL=http://127.0.0.1:4180 node tests/browser.mjs
```

For red replay, stop dev servers first. `node tests/replay-red.mjs` temporarily installs the saved phase-1 compiler/config and asserts that the current safety command fails, then restores them. `node tests/replay-map-red.mjs` makes one explicit test mutation to disable the production map-content policy and asserts that the map safety command fails, then restores it. These replay wrappers expect the inner test's failure; the safety tests themselves always fail on leakage. The wrappers are supplied for reproduction; the dated red evidence records the original direct test runs, not a claim that these wrappers were run.

The dev-map red occurred after span maps were added but before response filtering. The error-body red occurred with transform-hook rejection, and the invalid-endpoint red occurred before load preflight. These stages are identified explicitly rather than pretending the original phase-1 compiler generated source maps.

## Versions and remaining limits

Versions are unchanged except for direct additions MagicString **0.30.21** and trace-mapping **0.3.31**. Start/plugin-core **1.159.5**, client/server-core **1.159.4**, Vite **7.3.2**, TypeScript **5.9.3**, Node **24.5.0**, Playwright **1.60.0**, installed Chrome **152.0.7977.83**. Cached dependency resolutions are in `dependencies.txt`; the phase-1 fresh-install/lockfile limitation remains.

The grammar accepts the trusted direct top-level `const mutation({...})` form with exactly input/handler/onMutate and inline methods. Tests reject import aliases, wrong runtime imports, non-const declarations, spreads, nested calls, binding aliases, duplicate fields, generated-binding collisions and method receiver semantics. This is not arbitrary-JavaScript analysis or a production parser contract.

Not tested: unmarked sensitive modules, public/static files, arbitrary virtual imports, streaming/compressed dev responses, all websocket/error payload classes, same-page HMR, races during rapid edits, exhaustive source-map accuracy, import-policy performance, authentication, request/SSR binding, move-stable identity, serialization completeness, real database dependencies or integrated Todo behavior. The dev delivery claim is specifically the measured Vite inline maps delivered through `response.end`.
