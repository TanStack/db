# Independent integrated-compiler validation

**The modified compiler preserves the tested safety classes and query/mutation caller behavior in this isolated fixture.** This is not another test of the integrated Todo's DB lifecycle.

Frozen integrated compiler SHA-256:

`1a37bef295df877fa0ddb356e4e66c41ccaccd0978be96792d98e933eb45f239`

`transform.mjs` and `snapshots/initial-transform.mjs` are byte-identical copies of `probes/endpoints/integrated-todo/transform.mjs`. `evidence/source-final.json` confirms the app still matched at completion. `node tests/source.mjs` fails if the app compiler changes; refresh the snapshot and rerun the suite before claiming results for a new revision.

All writes and server processes for this validation stayed in this directory. No integrated-app files or server state were changed. The fixture authors both `query` and `mutation` plus a TSX component in `src/endpoint.tsx`. `src/runtime.ts` is an explicit stub implementing the generated `makeQuery`/`makeMutation` descriptor interface. Its callback displays a string; it does not implement TanStack DB collections, optimistic transactions, settlement or auth. Database/auth imports contain sentinel stubs.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Retained server helper | Pass: classified build rejection | `evidence/green-safety.json` |
| Side-effect-only server import | Pass: classified build rejection | Same |
| `.server.ts` naming policy | Pass: classified build rejection | Same |
| Server helper through shared module | Pass: classified build rejection | Same |
| Server side effect through shared module | Pass: classified build rejection | Same |
| Browser JS and emitted production maps | Pass: no server/auth/database sentinel | `evidence/green-built-maps.json` |
| Composed source correspondence | Pass: query, mutation and callback map to authored lines | Same; strings map to opening delimiter, not each interior character |
| Dev served endpoint inline map | Pass: code and map omit server source | `evidence/green-dev-delivery.json` |
| Direct server and raw/url requests | Pass: diagnostic 500 with no server source in body | `evidence/dev-rejection.json` |
| Unsupported and malformed TSX endpoint | Pass: diagnostic 500 with no server source in body | `evidence/green-grammar-error.json` |
| Actual dev browser query + mutation | Pass: two POST 200 responses, correct query/mutation output and callback | `evidence/dev-browser.log` |
| Actual production browser query + mutation | Pass: same behavior against built assets | `evidence/production-browser.log` |
| Authored fixture types | Pass | `evidence/types.log` |
| Query-only transform / wrong query binding | Pass / explicit rejection | `evidence/query-only.log` |
| App compiler matches tested snapshot | Pass | `evidence/source-final.json` |

The initial read identified a query-only early return. The Todo worker fixed it before this snapshot was taken, and the query-only test passes against the frozen version. No red runtime reproduction of that already-fixed version is claimed.

The first browser baseline after deliberate dev errors was blocked by Vite's retained error overlay. Its failed transcript is preserved in `evidence/dev-browser-after-error-probes.log`. Restarting only this fixture's dev server cleared that expected-error state, and the fresh baseline passed. This is not a claim of seamless dev error recovery or same-page HMR.

## Reproduce

Run from this directory and keep tests serial: the safety and grammar tests temporarily edit **only this fixture** and restore it in `finally`.

Dependencies were reused through the local `node_modules -> ../node_modules` link. Exact resolved versions/paths are in `evidence/versions.json`; no fresh package installation was tested.

```sh
node tests/source.mjs
npm run test:build

# Terminal 1
npm run dev
# Terminal 2
npm run test:dev
# Stop and restart this fixture's dev server to clear deliberate error overlays.
npm run test:browser

# Production preview, after test:build generated the map-enabled build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4292
# Another terminal
PROBE_URL=http://127.0.0.1:4292 node tests/browser.mjs
node tests/source.mjs
```

The isolated dev port is **4291**, preview **4292**. Browser tests use installed Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Scoped sandbox escalation was needed to listen on loopback and launch the browser. Both validation servers were stopped after testing.

## Versions and limits

Node 24.5.0; Start/plugin-core 1.159.5; Start client/server-core 1.159.4; Vite 7.3.2; TypeScript 5.9.3; React/React DOM 19.2.4; Zod 4.3.6; MagicString 0.30.21; trace-mapping 0.3.31; Playwright 1.60.0; Chrome 152.0.7977.83.

The compiler's phase-2 limits remain: explicit server-module classification, a bounded declaration grammar, and a dev inline-map policy measured through Vite's `response.end`. This does not prove unmarked/static/virtual-module safety, arbitrary streaming/compressed responses, all websocket/error payloads, exhaustive source-map accuracy or optimized parsing cost. The app's real data flow, transaction lifetime, rollback, scopes and post-write refetch are validated separately by the integration workers.
