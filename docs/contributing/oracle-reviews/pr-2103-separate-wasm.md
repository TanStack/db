# PR #2103 separate WASM asset review

- Base: `origin/main` at the PR's merge base.
- Production reviewed at `3a7d88102`. The commit that adds this record changes
  only oracles, tests, and documentation, so production is the same.
- Oracles:
  - The OPFS open outcome oracle,
    `packages/browser-db-sqlite-persistence/tests/opfs-open-outcome-oracle.ts`.
    Its jsdom driver is `tests/opfs-open-outcome-oracle.test.ts` and its
    Chromium driver is `e2e/opfs-open-outcome-oracle.e2e.test.ts`.
  - The install-layout oracle,
    `packages/browser-db-sqlite-persistence/e2e/install-layout-oracle.e2e.test.ts`.
- Supporting checks: `e2e/wasm-package-consumer.e2e.test.ts` (build output,
  export map, classic worker, `about:srcdoc`, cross-origin page),
  `e2e/bundler-consumers.e2e.test.ts` (webpack 5 and Next.js consumers), and
  `tests/opfs-database.test.ts`.

## Contract and evidence

The README promises how an open settles. A capability failure in the asset
lookup, worker start, or WASM load rejects with `PersistenceUnavailableError`.
The open deadline rejects a pending open with `TimeoutError`, and an abort
rejects it with the abort reason; both cover every step. A failed or
interrupted open terminates the worker it started, and a step that completes
after the open settled starts no worker.

The README also states which installs open in Vite development. A pre-bundled
copy asks the dev server for its assets by package name from the app root. It
opens when the root resolves that name, loads the root's copy when another copy
is installed, and otherwise rejects with `PersistenceUnavailableError`.
Excluding the specifier that the importer uses serves the copy in place.

Earlier rounds of this PR found these defects against that contract, each with
a failing witness before its repair: the deadline and abort did not cover the
lookup; a failed lookup, an `about:srcdoc` frame, and a refused Worker
constructor rejected with raw errors; a missing WASM file was reported as an
internal error; a cache directory named `dist` skipped the needed lookup; and
an excluded transitive install still ran the lookup. The two oracles in this
record replace the fixed witnesses that stated their own expected results.

The install-layout model disagreed with the README in two places. Two
installed copies open with the root copy's assets instead of rejecting, and an
npm alias must be excluded by its alias name. The README was corrected; the
model was not changed to match production.

## Calibration

Each control was a temporary source mutation, rebuilt and reverted after the
run. "Assertion failure" means the refinement check failed with an observation
diff, not a timeout.

| Control | Owner and driver | Classification |
| --- | --- | --- |
| Asset lookup not raced against the deadline and abort | Open outcome, Chromium | Assertion failure in both interrupted histories: settlement `pending` one task after the interruption (about 120 ms) |
| Same | Open outcome, jsdom | Unreached path: this driver has no lookup |
| Interrupted open starts a worker when the lookup completes late | Open outcome, Chromium | Assertion failure in both interrupted histories; the failing field was not inspected |
| Worker reports a WASM load failure as an internal error | Open outcome, Chromium | Assertion failure in the WASM-failure history |
| Same | Open outcome, jsdom | Unreached path: the driver supplies the worker's response |
| Refused Worker constructor's error escapes unclassified | Open outcome, Chromium and jsdom | Assertion failure in the refused-worker history, in both drivers |
| Rejects before making the asset lookup | Open outcome, Chromium | Assertion failure on `reached.lookup` only (inspected); settlement and worker counts matched. The first attempt was a setup failure: an unconditional `throw` did not compile, so the old build ran |
| Lookup runs even when the copy is served in place | Install layout | Assertion failure in exactly the excluded transitive, alias, and two-copy cases |
| Built package starts a module worker | Bundler consumers | Assertion failure in all six webpack and Next.js cases (`workerTypes`) |
| Lookup runs without a Vite client on the page | Bundler consumers | Assertion failure in the four Next.js cases; equivalent within the two webpack cases, because webpack emits the worker and WASM into one directory and the moved-code check skips the lookup |
| Production builds keep the dev-only lookup (the code before the production gate) | Bundler consumers, Vite consumer | Assertion failure in the webpack production and both Next.js production cases and in the Vite consumer's production build (`shipsViteLookup`) |
| Worker accepts an opener from another version (the code before the version check) | Install layout | Assertion failure in the three pre-bundled two-version cases: the open succeeded with the other copy's worker |
| Worker reports a refused OPFS storage root as internal (the code before the storage check) | Worker diagnostics | Assertion failure in the storage-root examples and both campaigns: `INTERNAL` with the bare browser message |
| Worker sends a `PersistenceUnavailableError` message with its prefix (the code before the fix) | Worker diagnostics | Assertion failure on the response text; the opener showed the prefix twice |

The reject-before-lookup control shows why the observation records reach.
Without `reached`, that history would have passed.

No control was run for the worker-script failure history added in this
round. Production passed it unchanged, and a control that ignores the Worker
`error` event would leave the open pending and fail by timeout.

## Requirements

| Requirement | Outcome |
| --- | --- |
| ORC-001 Contract authority and limits | Each oracle opens with its law, the README as authority, and its limits. |
| ORC-002 Independent judgment | The open model is a decision rule over the history. The layout model reads two facts from the installed tree, the importer's specifier and the Node resolution of the package name from the app root, and imports no production code. |
| ORC-003 Distinguishable responsibilities | The open oracle keeps law, grammar, model, and comparison in one module and each driver in its own file. The layout oracle keeps model, cases, installer, and driver in separate sections. |
| ORC-004 Grammar controls | Both grammars are bounded exhaustive products. Open histories: a held lookup or silent initialization must be interrupted, a history that fails early fixes later steps, and an interruption in the same turn as a failing step is excluded because no law orders the two. Layout cases: every layout with three cache directories while pre-bundled, every layout excluded by import name, an alias excluded by package name, and every layout in production. |
| ORC-005 Production path and observation | Chromium drives the public opener from a built package in a consumer app; jsdom drives it from source. `reached` is the positive execution witness for the lookup, worker start, and initialization. |
| ORC-006 Calibration | See the table above. |
| ORC-007 Random campaigns | Not applicable: no history is randomly generated. |
| ORC-008 Model minimality | Not applicable: both models are stateless functions of one history or case. |
| ORC-009 Vocabulary | The open model's "worker start" combines Worker construction and script load, and "deciding step" is a model term; the module prose declares both. |
| ORC-010 Failure fidelity and cleanup | No shrinking. Drivers release held lookups and close their browser context or page in `finally`, after the comparison input is recorded. |
| ORC-011 Second formulation | Not applicable: no reviewer named a fault that the model and production could share. |
| ORC-013 Reusable boundary law | Not applicable: neither oracle is cited as protecting a law outside this package. |
| ORC-014 Controlled premises | The jsdom WASM failure response is a controlled premise; the Chromium driver's real WASM 404 is its receiving witness. The Chromium refused-worker init script is controlled; the consumer check's cross-origin page supplies a real refusal. |
| ORC-015 Declared reach | Each driver checks that its product covers the outcomes it declares, and each history's observation compares production reach with the model. |
| ORC-016 Law-only oracle files | The oracle files hold no unit tests; fixed checks stay in the consumer test file. |

## Limits

A manual probe ran the packaged consumer under Vite development and preview in
Playwright's Firefox 150, which opened and queried SQLite, and WebKit 26.4,
which refuses the OPFS storage root even on a blank page. With the storage
check, WebKit's open rejects with `PersistenceUnavailableError`; before it,
the open reported an internal error. Real Safari was checked by hand
separately.

Both oracles cover Vite only, in Chromium. The bundler consumer checks add
webpack 5 builds and Next.js with Turbopack and webpack, in development and
production, as fixed receiving witnesses. Nothing covers webpack-dev-server,
Rspack, Parcel, esbuild, other browsers, an open from inside a worker, or a
Vite client injected without a script `src`. The README states the last two as
cases that need the exclusion.

The Vite production builds in these tests run with `NODE_ENV=production`.
Vitest sets `NODE_ENV=test`, and a Vite build under it keeps development code,
so the Vite consumer check first reported a lookup that a real `vite build`
drops.

While the bundler checks were written, webpack and Turbopack first resolved
the workspace packages to their sources through each package's tsconfig
paths. Published packages ship no tsconfig, so the checks install the built
workspace packages as published packages instead.

Open questions that need a product decision: no law orders an interruption
against a step that fails in the same turn, and two installed copies of
different versions can pair one copy's opener with the other's worker without
a version check.
