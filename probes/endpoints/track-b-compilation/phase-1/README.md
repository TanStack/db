# Track B: Start compilation probe

A bounded pre-transform produces working Start RPC calls and retains an optimistic callback. **It does not establish a safe server boundary for arbitrary endpoint modules:** a retained server helper and a side-effect-only import both leak into production browser chunks.

This is a disposable mini Start app with one authored inline mutation, not the RFC Todo. The DB and auth functions are named sentinel stubs, and the optimistic callback returns a displayed string. No TanStack DB collection, transaction settlement, authentication or Track A metadata is integrated.

## Run

Work from `probes/endpoints/track-b-compilation` in this worktree. Actual dependencies and absolute resolutions are recorded in `evidence/dependencies.txt` and `evidence/start-dependencies.txt`.

```sh
# Fresh installation route is NOT TESTED; network npm install stalled and was stopped.
npm install --ignore-scripts --no-audit --no-fund
# The tested offline fallback links existing read-only packages into this probe:
node tests/link-cached-dependencies.mjs /Users/kylemathews/programs/tanstack-db/node_modules/.pnpm

# Terminal 1
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4179
# Terminal 2; requires Chrome, defaults to the macOS application path
node tests/run.mjs
# Matrix restores source fixtures and creates a clean baseline build on success.
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4180
# Another terminal
PROBE_URL=http://127.0.0.1:4180 node tests/browser.mjs
```

`CHROME_PATH` overrides the Chrome executable. Playwright's matching bundled Chromium was absent; the probe used installed Google Chrome. Loopback listening and browser launch needed scoped sandbox escalation. No host credentials were used. No fresh install or portable lockfile was established; direct versions are pinned, but transitive reproduction relies on the recorded existing pnpm installation.

## Observed results

The tests were specified in `TEST-PLAN.md` before implementation. `tests/run.mjs` asserts successes **and** the two expected leak counterexamples. A green script exit therefore does not mean the transform is safe.

| Test | Result | Evidence/limit |
| --- | --- | --- |
| Authored caller input/output types | Pass | `tsc --noEmit`; invalid input assignments require errors, result.text is string |
| Actual browser -> dev server -> browser | Pass | POST 200, correct shared text and server markers |
| Actual browser -> built Start server -> browser | Pass | `evidence/production-browser.log`; preview serves built assets |
| Runtime schema rejection | Pass | Empty text returns serialized schema error with HTTP 200 and no handler result (Start RPC semantics) |
| Optimistic callback execution | Pass | Browser displays `optimistic:shared:test` before/alongside server result; not a DB transaction |
| Baseline browser exclusion | Pass | All emitted client JS searched; no server/DB/auth sentinel; server JS retains required implementation |
| Shared import | Pass | `shared()` retained and executes in client callback and server handler |
| Retained server helper reference | **Fail** | `DATABASE_ONLY_SENTINEL` appears in client JS; Start did not reject this ordinary module |
| Side-effect-only import | **Fail** | `SIDE_EFFECT_ONLY_SENTINEL` appears in client JS |
| Handler/helper edits on dev server | Pass with scope | Subsequent full page reload and POST use v2 behavior; same-page HMR/state preservation not tested |
| Rename declaration | Pass with scope | New RPC works; old RPC replay returns 500 `action is not a function`; clean build has no old name |
| Delete declaration | Pass with scope | Reloaded UI removes endpoint; old RPC replay returns same 500; clean build has no old server implementation |
| Modified clean production build | Pass | Client exclusion, v2 server implementation, no old handler/name; actual modified production request not separately tested |
| Source maps | Not tested | Transform returns `map:null`; authored source hash/span and generated declaration recorded, not a compiler correspondence proof |
| Full import-graph proof | Not tested | Emitted JS scanning measures fixture sentinels; not exhaustive traversal of all module dependencies |
| Auth/SSR/client binding, replay, move-stable identity, serialization completeness, DB settlement | Not tested | Separate integration contracts |

Machine results: `evidence/results.json`. Build transcripts preserve baseline, modified, retained-reference, side-effect and deletion cases. The fake database/auth names prove reachability behavior for these modules, not exclusion of real database/auth packages.

## Mechanism and supported grammar

`transform.mjs` is a standard Vite `enforce:'pre'` plugin. It rewrites a top-level `const addTodo = mutation({...})` into `createServerFn({method:'POST'}).inputValidator(...).handler(...)` plus a callable wrapper with the authored `onMutate` property. Start's own compiler handles the generated `createServerFn` declaration. No private `compilerTransforms` option is used.

The server adapter maps Start's validated `data` to `{body:data}` and maps `res.json(value)` to a plain returned value. This is **Start RPC**, not a portable Fetch/Express response adapter: headers, status, streaming, Request identity and middleware semantics are unsupported.

The trusted fixture grammar uses a single exported top-level const, direct identifier `mutation`, literal object properties, an inline handler and callback, and local imports. Identifier binding is not resolved: any callee named mutation would match. Aliases, shadowing, spreads, computed keys, multiple declarations per statement, nested declarations, arbitrary closure extraction and cross-file analysis are outside the contract. The transform's lack of source maps also makes it unsuitable as the source-location producer for Track A repairs.

The public surface used is Vite plugin hooks and Start's public server-function/config APIs. Successful recognition of this pre-transform order is measured for Start 1.159.5/Vite 7.3.2 only; it is not a compatibility promise from Start. Generated RPC names/URLs remain Start-owned and change on rename. The private compiler transform hook was not tried because a public pre-transform sufficed for this bounded test.

## Versions and rejected assumptions

Start and start-plugin-core resolve to **1.159.5**; start-client-core and start-server-core resolve to **1.159.4**. Router 1.159.5, Vite 7.3.2, TypeScript 5.9.3, React/React DOM 19.2.4, Zod 4.3.6, Babel parser 7.29.0/generator 7.29.1, Playwright 1.60.0, installed Chrome 152.0.7977.83. Executed matrix Node **24.5.0** (`evidence/runtime.txt`); an initial host shell reported 22.13.1 before the per-directory runtime resolved. The first build was also observed with the initial shell; all final matrix checks used the recorded 24.5.0 runtime.

The default client entry resolved through the external cached package path but returned a route 404 in the initial dev browser probe. An explicit local `src/client.tsx` entry fixed the observed hydration failure. The underlying cause was not isolated; do not generalize it as an upstream Start bug.

The first type probe returned `unknown`; making the fixture `res.json` generic restored output inference. That establishes the authored declaration type only. Generated code passes Vite compilation, but no separate generated-source TypeScript checker was run.

Handler removal alone is rejected as the server-safety rule. The smallest next decision is whether supported endpoint modules must enforce a strict import/usage boundary, or whether a transform must compute and reject server-reachable client references. Neither defense is implemented here. Select and test that boundary before composing with analysis or the integrated Todo.
