# RFC #1659 Workstream 5B: RED oracle ledger

## Frozen baseline and scope

- Repository/worktree: `powersync-v2-main/.worktrees/rfc-1659-ws5b-driver-fairness-oracle`
- Branch: `rfc-1659-ws5b-driver-fairness-oracle`
- `HEAD`, `origin/main`, merge base, and `github/main`: `76d766e84afbfcde2900a661233dd59e1decd5c2`
- Baseline production driver: `packages/browser-db-sqlite-persistence/src/wa-sqlite-driver.ts`; its single promise FIFO is unchanged.
- Required guidance read in full before task work: root `AGENTS.md`, `docs/contributing/oracle-tests.md`, and `docs/contributing/oracle-coverage.md`.
- Issue #1752: open, updated `2026-08-19T20:42:53Z`; reports a shared WA-SQLite/OPFS FIFO persist storm delaying hydration.
- RFC #1659: open; Workstream 5 authorizes an explicit bounded-fairness oracle and requires the current persist-first storm as a fault control.
- PR #1837 is evidence-only: open/clean, base `7f6b6438cd3a5b2cfc54ea1d8ad8a2102ea9d699`, head `83fc42f3ef98c11d49c097ec07ca8040259ac147`, updated `2026-09-17T13:36:35Z`. Its files are offline-runtime work, not the browser driver's FIFO. No code or history was borrowed from it or any other candidate.
- Phase 1 plus the explicitly approved circular-gate repair only. No production source, old RFC branch, merge, rebase, or cherry-pick was used. Nothing was committed or pushed.

## Oracle card

**Law and source.** RFC #1659 says queued persist work must not starve cold hydration on the shared browser driver. The approved executable law permits the non-preemptible persist already running when hydration is requested, then bounds completed persists at every public hydration-completion checkpoint. The maintainer-approved bound is `K = 1` additional persist between successive complete logical cold-hydrate units.

**Authority limit.** The maintainer chose `K = 1` and one complete logical cold hydrate, including setup operations, as the priority unit. This does not authorize priority for all reads, a bidirectional policy, transaction preemption, or changes to generic `SQLiteDriver` FIFO/transaction semantics. A query-only priority queue remains insufficient because genuinely cold startup performs registry/schema/metadata/index setup as well as row loading and local application.

**Legal ordered histories.** The generated input is an explicit sequence of logical `{ kind: hydrate | persist, id, payload }` work, not a tuple of counts. A storm's first item is the persist already non-preemptibly running; the remaining two to seven cold hydrates and one to six additional persists are randomly interleaved. Persist transactions contain one to three legal insert mutations. Every hydrate carries one independently generated collection identity and two independently specified seed rows. A seed connection closes before a fresh adapter/driver admits the generated history. Only unrelated persist tables are prewarmed.

**Independent ordered reference.** The reference consumes only the explicit history. It preserves FIFO identity order within the persist and hydrate lanes. At hydrate checkpoint `i`, its permitted completed-persist prefix is the already-running persist plus at most `i*K` subsequent persist identities from the history. It also derives the exact expected hydrate identity and minimum pending-persist count. It does not inspect or call the production FIFO. Public row expectations are derived independently from the history's seed payload and compared exactly, including collection identity, missing/extra rows, row order, IDs, and values.

**Production path and reach.** The fixture uses the real `BrowserWASQLiteDriver`, `createSQLiteCorePersistenceAdapter`, `persistedCollectionOptions`, `createCollection`, and public `preload()` path over one shared database. The circular gate was surgically revised after explicit approval: it records each logical hydrate only after the public `preload()` request returns its Promise, and releases the held `BEGIN IMMEDIATE` after all such requests are pending. It no longer requires underlying registry queries to overtake the held non-preemptible persist. A test-only delegating `SQLiteDriver` still records every actual driver method admission, and the database wrapper separately records raw SQL dequeue order; neither schedules production observations.

**Checkpoints.** Each public hydration completion records its logical completion ordinal, exact completed persist identities, bounded pending count, and raw dequeue count. Actual hydrated rows are captured from `collection.toArray` after public `preload()` completion; expected rows are never returned as observations. Wall-clock duration is never a verdict.

**Neutral and hostile controls.** The neutral lane uses a fresh adapter with no queued persists and proves exact public rows plus a real persisted-row query. The hostile lane wraps the real `BrowserWASQLiteDriver` in a test-only global-FIFO scheduler, then traverses the same core adapter, persisted collection, and `preload()` fixture. This preserves the current persist-first fault even after production becomes fair and must be killed by the semantic checker. A separate synthetic observation calibrates the checker only.

**Failure preservation.** All holds are released and all started promises are settled before collection/driver cleanup. Driver, collection, Node-directory, and OPFS cleanup failures are captured separately. The Node helper freezes the primary assertion before removing its directory. The browser page freezes the reached observation and semantic violation before OPFS cleanup. A cleanup failure is appended to an existing primary failure and can never relabel a reached checkpoint as setup failure.

## Deterministic package-path receipts

### Neutral reach

```sh
../../node_modules/.bin/vitest run tests/shared-driver-fairness-oracle.test.ts \
  -t 'reaches cold hydration' \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=verbose
```

Result: PASS, one selected test. Three fresh-adapter cold hydrates completed; all six actual public rows exactly matched their independently specified seed rows; persisted-row SELECT reach was observed; cleanup diagnostics were empty.

### Narrow fixed semantic RED

```sh
../../node_modules/.bin/vitest run tests/shared-driver-fairness-oracle.test.ts \
  -t 'completes a pending cold hydrate' \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=verbose
```

Fixed history: `persist-0, persist-1, persist-2, hydrate-0`, with two mutations in each persist.

Result: intended semantic FAIL at `fixed-persist-storm-hydrate-0`. Actual public rows and reach controls passed first. All three persists completed and zero remained pending; the candidate allowed only `persist-0` completed and required at least two pending. Cleanup diagnostics: `[]`. This was neither setup, timeout, typecheck, nor cleanup failure.

### Generated ordered-history semantic RED and replay

```sh
../../node_modules/.bin/vitest run tests/shared-driver-fairness-oracle.test.ts \
  -t 'generated ordered' \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=verbose

TANSTACK_DB_DRIVER_FAIRNESS_SEED=165905 \
TANSTACK_DB_DRIVER_FAIRNESS_PATH=0 \
../../node_modules/.bin/vitest run tests/shared-driver-fairness-oracle.test.ts \
  -t 'generated ordered' \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=verbose
```

Both commands reproduce seed `165905`, path `0`, without shrinking: six hydrates, four persists, three mutations per persist, token history `p0,h3,h0,h4,p1,h1,p2,p3,h2,h5`. The executable kind history is `P,H,H,H,P,H,P,P,H,H`. Actual at the first public hydrate checkpoint: four completed, zero pending. The ordered candidate reference permitted only `persist-0` completed and required at least three pending. All actual public rows matched before the semantic verdict; cleanup diagnostics: `[]`.

### Hostile persist-first controls

```sh
../../node_modules/.bin/vitest run tests/shared-driver-fairness-oracle.test.ts \
  -t 'persist-first' \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=verbose
```

Result: PASS, two selected tests. The executable scheduling mutant admitted four persists then one cold hydrate through the real browser-driver/core/persisted/preload fixture. The checkpoint observed all four persists complete, zero pending, exact public rows, and no cleanup failure; the checker killed it. The separate synthetic calibration was also rejected with maximum completed `1` and minimum pending `3`.

## Real Chrome/OPFS receipt

The checked-in fixture uses `openBrowserWASQLiteOPFSDatabase`, its dedicated worker, WA-SQLite, and `OPFSCoopSyncVFS` in installed Google Chrome. Its Vite config deliberately excludes WA-SQLite from dependency prebundling so the real sibling WASM is served. The Playwright channel defaults to installed Chrome locally, bundled Chromium in CI, and accepts `PLAYWRIGHT_CHANNEL` as an explicit override.

The existing `browser-single-tab-persisted-collection.e2e.test.ts` uses `createWASQLiteTestDatabase` backed by Node `better-sqlite3`; it earns driver/package evidence only and is not counted as OPFS evidence.

The permanent checked-in package script was executed as:

```sh
npm run test:opfs-fairness
```

The repository's global `pnpm` launcher hangs before printing even its version, so the equivalent documented workspace spelling, `pnpm --filter @tanstack/browser-db-sqlite-persistence test:opfs-fairness`, could not invoke the same script locally. The exact lockfile package was already present and was linked package-locally: `@playwright/test` and CLI version `1.60.0`. The package script, config, real Chrome, loopback Vite server, worker, and OPFS fixture all executed. The launcher defect is retained as external setup evidence and is not semantic RED.

Neutral real-OPFS result: PASS. Two fresh-adapter cold hydrates returned four exact actual public rows, persisted-row SELECT reach was observed, and driver plus OPFS cleanup diagnostics were empty.

Fixed real-OPFS storm semantic RED:

- History: five persists followed by four cold hydrates; two mutations per persist.
- Logical completion order: `persist-0` through `persist-4`, then `hydrate-0` through `hydrate-3`.
- First hydrate checkpoint: all five persists completed, zero pending, raw dequeue count `111`.
- Candidate allowed only `persist-0` completed and required at least four pending.
- Total: `53` actual driver admissions and `113` raw SQL dequeues.
- Driver cleanup diagnostics `[]`; OPFS cleanup diagnostics `[]`.
- Page status reached `complete`; the fixture reported the frozen semantic observation after cleanup. This was not setup, wall-clock, browser, typecheck, or cleanup failure.

## Static and hygiene receipts

- Package-local `@playwright/test`: resolved version `1.60.0`; package-local CLI reports `Version 1.60.0`.
- Package TypeScript: PASS, `tsc --noEmit -p tsconfig.json`.
- Prettier: PASS for every new/changed package source/config file. The repository lockfile's existing full-file format differs from current Prettier; the three-line importer edit preserves adjacent lockfile style.
- ESLint: PASS for oracle, Node test, OPFS page/spec, and configs.
- `git diff --check`: PASS.
- Production-source diff under `packages/browser-db-sqlite-persistence/src` and `packages/db-sqlite-persistence-core/src`: empty.

## Coverage limits

- The Node fixture uses a real `BrowserWASQLiteDriver` but a `better-sqlite3` database handle. It proves deterministic package scheduling and SQLite results, not browser or OPFS behavior.
- The Chrome receipt proves the same fixed order through a real worker/WA-SQLite/OPFS path. It is one finite browser/origin/topology and does not establish multi-tab OPFS ownership, elapsed performance, every browser, or statement-batching throughput.
- The oracle establishes starvation order and bounded pending work only. It does not choose a batching implementation, permit transaction preemption, weaken atomic commit, or prove that statement batching solves the issue's root cost.
- `preload()` request is the logical hydrate-admission checkpoint and its completion is the public hydration-completion checkpoint. Actual driver admissions and raw dequeues remain separate reach evidence; the gate no longer requires a registry query to overtake the held non-preemptible persist.
- The generated RED campaign stops at its first deterministic counterexample. Its unchanged broad history domain becomes a multi-run GREEN obligation after an approved fix.

## Production-fix gate

Production code must not change until all of the following are true:

1. Maintainer explicitly chooses the fairness quantum/bound (accepts `K = 1` or supplies another finite value) and states whether the scheduled unit is a logical hydrate spanning cold setup or only individual driver reads.
2. If only individual reads receive priority, the oracle is revised before production work so it does not falsely require cold setup writes to inherit an unapproved lane. If logical hydrate priority is chosen, the owning API/lane boundary is recorded before implementation.
3. Independent read-only loss audit reports PASS on this final Phase 1 diff, receipts, replay, failure-preserving cleanup, real-path hostile control, and scope.
4. Maintainer gives explicit Phase 2 production-fix approval after reviewing the decision above.

After approval, the smallest correctly owned fix must preserve the unchanged fixed/generated/OPFS inputs and checkpoints, keep an already-running transaction non-preemptible, make all three fairness oracles GREEN, and retain transaction atomicity. Focused/full package suites, typecheck/build/lint/format/replay/cleanup, and a second independent loss audit are then required.

## Frozen content hashes

The final non-ledger content hashes and combined manifest hash are recorded here after the last test-only edit. The ledger is hashed separately in the independent audit receipt to avoid a self-referential value.

<!-- HASH_RECEIPTS -->

- `f31c08caf480f5b4e639bac0e2d189a2a6922c70dc3477bff2ac4a082e24af34` `package.json`
- `7bc690c092c30d6c2dc15d2aff7254c92ede3080f68f1006a97a6a3edf57df9b` `tsconfig.json`
- `a094af45b23210b6635683abe999814d53d24411f6f76000157cd57e205be7d9` `pnpm-lock.yaml`
- `fd8a9c633966b8d5531f95ed9465ceb95923550aa5f552c05f7864ac1d9bf9a1` `shared-driver-fairness.opfs.html`
- `a0ac7e13416f6164cf134a240f6b044cb661d98c85991ccff6486cac4c07882f` `shared-driver-fairness.opfs.spec.ts`
- `88ef755a14918ecbf289b9d8e0753012fa1d932bec08be940ed81d9f292606d7` `shared-driver-fairness.opfs.ts`
- `0676bc5223bd00c99a0aa77e7199225a3dedecfddfe590953845f40721094140` `playwright.opfs.config.ts`
- `666ac24f0c6e18f0d4d1e71995b5f6046e4c75918292a1b1896a87eb0cb69890` `shared-driver-fairness-oracle.test.ts`
- `f2446d5e7d8ddbf028dd3fa7252db95bde87bee1d54b40238e91ee675cabaf3d` `shared-driver-fairness-oracle.ts`
- `f9e7b499046544834f0d0cbbc7f9af0c9e92858d99b8bd974f6f51587c1e4550` `vite.opfs.config.ts`
- Tracked binary diff hash (package manifest, package tsconfig, lockfile): `a30c60f449a3332fbdd1824540f9b18fa7b47aa2b5799f8e5fe939c3e40622b9`
- Combined ordered SHA-256 manifest hash for all ten non-ledger files above, from the listed paths in order via `shasum -a 256 ... | shasum -a 256`: `a26caffcdfbac67187b59f8c8054702abe086f97290ede212d4d2861b78b89b5`

## Independent loss-audit status

`PASS` on baseline/HEAD/origin-main/merge-base `76d766e84afbfcde2900a661233dd59e1decd5c2`. The independent read-only auditor reproduced the fixed/generated/replay semantic RED, executable mutant and checker-control PASS, package typecheck PASS, and real Chrome/OPFS neutral PASS plus semantic RED. It verified no production-source diff, every prior failure-preservation correction, the combined non-ledger manifest hash, tracked diff hash, and pre-receipt ledger hash `c157b60497f982a9b638a01d461a5340f3dddedde6871b88b5e15ac4649aeb0e`.

No production authorization follows from this PASS. The numeric fairness quantum and logical-hydrate versus individual-read scheduling unit remain maintainer decisions, followed by explicit Phase 2 approval.

## Phase 2 gate-blocker receipt

On `2026-09-18`, the maintainer approved `K = 1` with one complete logical cold hydrate, including registry/schema/metadata setup and local row application, as the non-preemptive priority unit. The intended ownership was a driver-shared two-lane scheduler in the SQLite core adapter, an explicit same-adapter scoped hydrate lease in the persisted runtime, and an unchanged generic `SQLiteDriver` FIFO/transaction contract.

The frozen Phase 1 gate is incompatible with that exclusive unit:

1. The fixture starts persist `P0` and holds its real `BEGIN IMMEDIATE` inside `BrowserWASQLiteDriver`.
2. A correct logical-operation scheduler leaves `P0` non-preemptible and queues hydrate `H0` as the next complete adapter operation.
3. The unchanged fixture releases `P0` only after the `collection_registry` query from every hydrate (`H0` through `Hn`) has already been admitted to that same driver FIFO.
4. Because an exclusive `H0` cannot begin and admit its registry query until `P0` completes, `P0` waits for `H0` admission while `H0` waits for `P0`: the frozen gate cannot reach its semantic checkpoint.

Starting every hydrate callback early would satisfy the admission gate only by overlapping/interleaving multiple logical hydrate units. A duplicate probe query, SQL-text priority inference, or hidden driver-wrapper introspection would be test-shaped and would not implement the approved contract. These alternatives were rejected.

Phase 2 therefore stopped before runtime wiring, verification, commit, push, or prep-PR. All partial scheduling scaffolding was removed with targeted patches. Production-source diff is empty, `git diff --check` passes, and every frozen non-ledger Phase 1 witness hash still matches. Resolution requires either a surgical oracle-gate revision that observes logical hydrate admission without requiring all underlying registry queries before `P0` release, or an explicit maintainer redefinition allowing overlapping hydrate scopes. The former is recommended.

## Approved circular-gate repair and repeated RED boundary

On `2026-09-18`, the maintainer approved the recommended surgical gate revision. Only `shared-driver-fairness-oracle.ts` changed: the fixture now observes the logical public `preload()` requests and releases `P0` after they are all pending. The scenario histories, independent reference, `K = 1` verdicts, seed/replay, public row values, completion checkpoints, neutral/hostile controls, cleanup logic, browser fixture, and every other non-ledger witness remain byte-for-byte unchanged. Production-source diff remains empty.

Repeated receipts at this revised boundary:

- Neutral Node reach: PASS; three hydrate requests/completions, six exact actual public rows, persisted-row query reach, cleanup `[]`.
- Fixed Node history: semantic RED at `fixed-persist-storm-hydrate-0`; three completed persists, zero pending, versus maximum one and minimum two; exact rows reached first; cleanup `[]`.
- Generated and explicit replay (`seed 165905`, `path 0`): both semantic RED on the unchanged counterexample and first hydrate checkpoint; four completed, zero pending, versus maximum one and minimum three; cleanup `[]`.
- Executable persist-first package-path mutant and synthetic checker calibration: PASS; both were rejected for the intended fairness violation, with exact public rows and cleanup `[]` for the executable control.
- Real installed Chrome, worker WA-SQLite, and `OPFSCoopSyncVFS`: neutral PASS; storm semantic RED with five completed, zero pending, versus maximum one and minimum four. Logical completion order remained all five persists then all four hydrates; `53` driver admissions, `113` raw dequeues, driver cleanup `[]`, OPFS cleanup `[]`.
- Package TypeScript, ESLint, Prettier check, working/staged `git diff --check`: PASS. Playwright result artifacts were removed after their semantic contents were recorded; no package-local result/report directory remains.

The first unprivileged browser attempt failed before fixture startup because the sandbox denied loopback listen with `EPERM`; it is classified as setup-only. The explicitly permitted rerun reached both real-browser checkpoints above. This setup failure is not semantic RED.

The revised test-only boundary is now frozen at the hashes above. Production scheduling remains blocked until a fresh independent read-only loss audit reports PASS on this boundary.

## Revised RED independent loss-audit PASS receipt

The fresh independent read-only auditor reported `PASS — no blockers` on the
revised logical-request gate before production work resumed. The exact audited
pre-receipt ledger SHA-256 was
`45ad59441ab46cd001557b189db5520ad8786a436f10f24bdd3115bcd2c25132`.

The auditor independently confirmed:

- baseline, `HEAD`, `origin/main`, and merge base
  `76d766e84afbfcde2900a661233dd59e1decd5c2`;
- an empty production-source diff and no commit, push, PR, WS5A, PR #1487, or
  PR #1837 integration at the audited boundary;
- only the approved logical-`preload()` gate changed, while histories, the
  `K = 1` reference, checkpoints, values, controls, replay, cleanup, and the
  browser fixture remained unchanged;
- Node neutral and hostile controls PASS; fixed semantic RED `3 complete / 0
pending` versus `max 1 / min 2`; generated and replay semantic RED `4 / 0`
  versus `max 1 / min 3`;
- fresh installed Chrome, worker, WA-SQLite, and OPFS neutral PASS plus storm
  semantic RED `5 / 0` versus `max 1 / min 4`, with `53` driver admissions,
  `113` raw dequeues, and both cleanup arrays empty;
- package static checks and workspace cleanup PASS;
- frozen tracked-diff SHA-256
  `a30c60f449a3332fbdd1824540f9b18fa7b47aa2b5799f8e5fe939c3e40622b9`
  and combined non-ledger manifest SHA-256
  `a26caffcdfbac67187b59f8c8054702abe086f97290ede212d4d2861b78b89b5`.

This durable receipt opens the already-approved WS5B production gate. It does
not claim GREEN or authorize prep-pr, commit, push, PR, or merge work.

## Phase 2 GREEN implementation boundary

The approved production implementation keeps `SQLiteDriver` transaction FIFO
and non-preemption semantics intact while adding an opt-in, driver-shared K=1
logical scheduler in the SQLite core adapter. A branded promise emitted by the
browser WA-SQLite driver allows transparent driver wrappers to retain the
capability; the hostile global-FIFO wrapper intentionally does not. The core
adapter owns one hydrate queue and one regular queue for all adapters sharing
that driver. A complete scoped hydrate is the scheduling unit. When both lanes
remain queued, one regular operation is admitted between completed hydrates.

The persisted runtime threads a deliberately unscheduled scoped adapter through
cold startup metadata, index bootstrap, row hydration, buffered transaction
flushes, gap recovery, and reloads. Browser and Electron leader-local
coordinator paths accept that same scoped adapter. Index lifecycle work outside
a hydrate and ordinary persistence continue through the regular lane.

### Lock-order correction

An initial full browser-conformance run found six deterministic timeouts. A
temporary diagnostic probe isolated a real lock inversion: an on-demand
`loadSubset` held the hydrate scheduler while waiting for `applyMutex`, while an
update held `applyMutex` while waiting for a regular scheduled persistence
operation. The final code consistently acquires `applyMutex` before entering a
hydrate scope for startup, resume-baseline hydration, `loadSubset`, and
`forceReloadSubset`. Applied-receipt waiting remains outside the scheduler
scope, and `hydrateBaseline` no longer reacquires the mutex. All temporary
`WS5B-PROBE`/`WS5B-RUNTIME` diagnostics were removed before final verification.

### Final GREEN receipts

- Exact formerly deadlocked browser case, `should maintain query state during
data changes`: `1/1` PASS.
- Full browser persisted conformance: `113/113` PASS.
- Unchanged fixed, generated, neutral, executable-hostile, and synthetic
  fairness oracle: `5/5` PASS.
- Explicit unchanged replay, seed `165905`, path `0`: `1/1` PASS without
  shrinking.
- Index bootstrap plus both hydration-buffer replay controls: `3/3` PASS.
- Full runtime packages with package typecheck disabled in Vitest: SQLite core
  `96/96`, Browser `39/39`, Electron `27/27` PASS.
- Direct package TypeScript for SQLite core, Browser, and Electron: PASS.
- Dependency-order builds for db-ivm, db, SQLite core, Browser, and Electron:
  PASS.
- Fresh installed Chrome, worker, WA-SQLite, and OPFS verification: neutral and
  storm `2/2` PASS. Both fixtures reached their semantic checkpoints and empty
  cleanup diagnostics.
- Focused ESLint: zero errors; one unchanged `require-await` warning remains on
  `applyTargetedInvalidationUnsafe`.
- Prettier check, `git diff --check`, temporary-probe scan, and generated
  result/coverage cleanup: PASS.

The repository's global `pnpm` launcher still hangs during workspace discovery,
including for `pnpm --version`. Final package commands therefore used the exact
installed workspace binaries directly; the real OPFS lane used the checked-in
`npm run test:opfs-fairness` script. This is launcher/setup evidence only and
does not weaken any semantic result.

### Final candidate content hashes

The frozen RED/oracle files retain their recorded hashes. The final GREEN
candidate contains the following fifteen non-ledger files in this exact order:

- `f31c08caf480f5b4e639bac0e2d189a2a6922c70dc3477bff2ac4a082e24af34` `packages/browser-db-sqlite-persistence/package.json`
- `d054c227abf7e5a87ef64779be5edea11a339d3d10967ca037243f038e36c3e5` `packages/browser-db-sqlite-persistence/src/browser-coordinator.ts`
- `747614816fc80b16bf5547c7ab571834568fc4786310f6f9ddfcf266b0ffd088` `packages/browser-db-sqlite-persistence/src/wa-sqlite-driver.ts`
- `7bc690c092c30d6c2dc15d2aff7254c92ede3080f68f1006a97a6a3edf57df9b` `packages/browser-db-sqlite-persistence/tsconfig.json`
- `22a2b48d0a9a52f010b4913521e0d7a5f923cd4706d5d2a915630d9772caf69b` `packages/db-sqlite-persistence-core/src/persisted.ts`
- `86d58d2f0f7da96eda80d0b760721cefb8afb3334872310ed5c61da7016a5bf4` `packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts`
- `9f6d09f27a0e0e0ccd53b5421b7f0df33fe860baaf42a8e47c34dfd8f52125be` `packages/electron-db-sqlite-persistence/src/electron-coordinator.ts`
- `a094af45b23210b6635683abe999814d53d24411f6f76000157cd57e205be7d9` `pnpm-lock.yaml`
- `fd8a9c633966b8d5531f95ed9465ceb95923550aa5f552c05f7864ac1d9bf9a1` `packages/browser-db-sqlite-persistence/e2e/shared-driver-fairness.opfs.html`
- `a0ac7e13416f6164cf134a240f6b044cb661d98c85991ccff6486cac4c07882f` `packages/browser-db-sqlite-persistence/e2e/shared-driver-fairness.opfs.spec.ts`
- `88ef755a14918ecbf289b9d8e0753012fa1d932bec08be940ed81d9f292606d7` `packages/browser-db-sqlite-persistence/e2e/shared-driver-fairness.opfs.ts`
- `0676bc5223bd00c99a0aa77e7199225a3dedecfddfe590953845f40721094140` `packages/browser-db-sqlite-persistence/playwright.opfs.config.ts`
- `666ac24f0c6e18f0d4d1e71995b5f6046e4c75918292a1b1896a87eb0cb69890` `packages/browser-db-sqlite-persistence/tests/shared-driver-fairness-oracle.test.ts`
- `f2446d5e7d8ddbf028dd3fa7252db95bde87bee1d54b40238e91ee675cabaf3d` `packages/browser-db-sqlite-persistence/tests/shared-driver-fairness-oracle.ts`
- `f9e7b499046544834f0d0cbbc7f9af0c9e92858d99b8bd974f6f51587c1e4550` `packages/browser-db-sqlite-persistence/vite.opfs.config.ts`

- Ordered combined non-ledger content-manifest SHA-256:
  `b1b151dfd40cade3da4c30c2418642787bbf2a37a6a4f08106d8ea4f1fe9e9be`.
- Tracked binary diff SHA-256 for the eight modified tracked files:
  `516ef26f49204b7e36f437dba92667193dd2221ab366473e343ae8f5fc8c5573`.

`HEAD` remains the frozen baseline
`76d766e84afbfcde2900a661233dd59e1decd5c2`. Nothing has been committed,
pushed, or prepared as a PR. A fresh independent read-only final loss audit is
required before this GREEN boundary may advance to prep-pr.

## Final independent GREEN loss-audit PASS receipt

The fresh independent read-only auditor reported `PASS` on the frozen GREEN
candidate. The exact audited pre-receipt hashes were:

- candidate content manifest:
  `b1b151dfd40cade3da4c30c2418642787bbf2a37a6a4f08106d8ea4f1fe9e9be`;
- tracked binary diff:
  `516ef26f49204b7e36f437dba92667193dd2221ab366473e343ae8f5fc8c5573`;
- ledger:
  `bbf71465e6e4cf5e877c8e180810ed93b51f9deeda2395c416eaf65bf7e09d27`.

The auditor independently confirmed every frozen RED/oracle per-file hash and
reproduced fairness `5/5`, replay seed `165905` path `0` `1/1`, browser
conformance `113/113`, SQLite core/Browser/Electron `96/96 + 39/39 + 27/27`,
index/bootstrap-buffer controls `3/3`, all three package typechecks, and real
installed Chrome/worker/WA-SQLite/OPFS `2/2` including cleanup assertions. The
initial sandboxed OPFS attempt failed to bind loopback with `EPERM`; the
permitted rerun passed, so that first attempt remains setup-only evidence.

Independent semantic inspection confirmed K=1 alternation, non-preemptible
running transactions, the unscheduled scoped hydration adapter preventing
recursive scheduling, capability preservation through transparent promise
wrappers while the hostile FIFO wrapper remains unbranded, mutex-before-
scheduler lock ordering, scoped index/buffer/gap-recovery paths, and Browser and
Electron leader-local adapter propagation. ESLint had zero errors, Prettier and
diff checks passed, and only the existing `require-await` warning remained.

Workspace status was exactly eight modified tracked files plus the expected
eight untracked ledger/oracle files, with nothing staged and no package-local
test-result contamination. Two `.last-run.json` receipts existed only under
`/private/tmp`. The auditor did not rerun builds in its read-only pass; the
coordinator's final dependency-order five-build PASS above remains the build
receipt.

Residual coverage limits remain the single installed-Chrome/single-origin
topology. During the audit, local `github/main` had advanced to
`dffb17f34a5e0448b7d72f85d11e35ac8a0d4265`; the candidate `HEAD`,
`origin/main`, and merge base remained the frozen baseline
`76d766e84afbfcde2900a661233dd59e1decd5c2`. Any later prep-pr phase must fetch
and reconcile current main under its own approval gate. This PASS freezes WS5B
GREEN and does not authorize prep-pr, commit, push, PR creation, or merge.
