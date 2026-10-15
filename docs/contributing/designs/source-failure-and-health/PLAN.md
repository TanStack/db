# Plan: final initial errors and the source health channel

Status: implemented on `feat/source-health-channel`; the pull request is next.
It ships as one pull request, because it is a breaking change and a
significant product change. It replaces #2129. Later decisions (2026-10-14):
a crashed Collection ends every live query and Effect above it; terminal local
persistence failures crash; `request` stays the public phase name; a live
query's Collection health includes its request errors. `markError` means the sync adapter gave up in both phases, so `reportError` has no `final` option and nothing warns; query-db's error utilities and the infinite query's `error` field give way to Collection health.

Branch: `feat/source-health-channel` (worktree
`.worktrees/source-health-channel`).

## 1. Decisions (maintainer, 2026-10-13)

1. **A retry that succeeds is a success.** While the sync adapter retries, it reports
   nothing. The Collection stays `loading`. (Already in #2127 for Electric.)
2. **`markError` is final for its sync run.** A sync adapter calls it only when
   it gives up. The framework never heals a sync run: no `error` → `ready`.
3. **Recovery is the app's job.** `cleanup()` then `preload()`, a refetch, or a
   user refresh starts a fresh attempt. The framework adds no retries.
4. **A final initial error reaches every consumer with its cause**: readiness
   waits and one-shot reads reject, live queries enter error for every shape,
   Suspense throws, Effects are disposed through `onSourceError`, and
   subscribers get `lastError` and `loadSubset:error`.
5. **`status` is only the initial gate.** After the first ready, a sync
   failure is metadata on the Collection. The data stays, even if it grows
   stale.
6. **`useLiveQuery` returns an `errors` tree** for every collection the query
   depends on. It always has the same shape, shows whether each node is in
   error, and carries detailed error info, so apps can parse it.
7. A buggy source or an app with endless retries can still look stuck. That is
   a plugin or app problem, not a framework guarantee.
8. Generated API reference docs are produced on release by an automated pull
   request. Do not edit them in this pull request.

Rationale and controls: `README.md` (failure-law grammar, `SourceFailure.tla`,
10 configurations) and `HEALTH-CANDIDATE.md` plus `SourceHealth.tla` (health
channel, 6 configurations). The user-facing target is `USER-DOCS-DRAFT.md`
(candidate v2).

## 2. Target design (candidate v2)

Summarized from `USER-DOCS-DRAFT.md`; that file is the source of truth for
names and shapes.

- **Two axes.** Gate: `status` (`idle | loading | ready | error |
  cleaned-up`), decided only by an attempt's initial sync. Health: per
  Collection, changed only by its sync adapter after Collection readiness.
- **Adapter API.** Sync params gain `reportError(error)` and
  `reportHealthy()`. `markError` means the sync adapter gave up: an initial
  error before Collection readiness, a final health error after it.
  `markReady()` after `markError()` in one sync run throws.
- **Collection surface.** `collection.health` and a `health:change` event.
- **Error info.** `{ phase: 'initial' | 'sync' | 'request', final, name,
  message, code?, at, cause }`. Everything except `cause` is JSON-safe.
- **Error tree.** `ErrorTreeNode = { alias, collectionId, kind: 'source' |
  'live-query' | 'include', status, isError, hasErrors, error, instances?,
  sources }`.
  - One node per query alias, in query order, fixed by the query definition
    (fracture F-a). A self-join appears once per alias.
  - An include has one node for all its per-row child Collections, with
    `instances: { total, inError }`.
  - Nested live queries recurse.
  - Healthy nodes are present with `isError: false`.
- **Final flag** (fracture F-b). `final: true` means the sync adapter stopped
  trying; only a restart clears it. `reportHealthy()` cannot clear it.
- **Request errors** (fracture F-c). A load for new demand that fails after
  Collection readiness sets `phase: 'request'` on the live-query node that issued it. The
  Collection stays healthy. It clears when that demand later settles or is
  released.
- **Hooks.** Return `errors` beside `data`. `isError` keeps meaning "the
  initial gate is `error`". Docs lead with `errors.hasErrors` for stale data.
- **Effects.** `onHealthChange(errors)` after Collection readiness; no disposal.
  Initial gate errors still dispose through `onSourceError`.
- **SSR.** `errors` is not dehydrated; the client builds its own tree.

## 3. Work breakdown

### 3.1 Core: `packages/db`

- [ ] `collection/lifecycle.ts`: remove `error` → `ready` from the valid
      transitions. `markReady()` after `markError()` in the same sync run
      throws. Keep `error` → `cleaned-up` and `idle`.
- [ ] `collection/lifecycle.ts` / `sync.ts`: add Collection health state, `reportError`,
      `reportHealthy`, the `final` rule, and reset on cleanup and restart.
      Scope the callbacks to the sync-run epoch so a stale sync run cannot
      report.
- [ ] `collection/events.ts`: add `health:change` to `AllCollectionEvents`.
      Define the payload (previous, current) and the ordering: same tick,
      after `status:change` when both change (the ordering is still to be
      checked).
- [ ] `types.ts`: `SyncConfig` params, `CollectionErrorInfo`,
      `ErrorTreeNode`, and the `Collection.health` and `errors` types.
- [ ] `markError` after the first ready: forward to
      `reportError(error, { final: true })` and warn in development.
- [ ] `query/live/collection-config-builder.ts`:
  - [ ] a Collection entering `error` before the live query's initial-query readiness stays
        a gate error for every shape (root, join, include alike);
  - [ ] remove the `erroredSourceIds` recovery path (line ~1131) and its
        status-based healing;
  - [ ] post-readiness Collection health does not change the live query's status or
        rows;
  - [ ] build and maintain the `errors` tree: per-alias nodes, include
        roll-ups, nested live-query relay, and request errors;
  - [ ] `failDemand` and `recordSubsetError`: before ready, terminal (gate);
        after ready, a request error on the live-query node, cleared on
        settle or release.
- [ ] `collection/subscription.ts`: keep `lastError` and `loadSubset:error`
      for every rejected load (#2129 review C8). Do not detach demand for
      recovery.
- [ ] `query/effect.ts`: `onHealthChange`; no disposal after Collection readiness.
- [ ] `live-query-adapter.ts` and `live-query-observer.ts`: add `errors` to
      the snapshot and status flags, so every framework adapter gets it from
      one place. Keep `isError` as the gate.
- [ ] `query/live/pooled-live-query*`: decide and implement health for
      pooled views that share sources (open question).
- [ ] `query/live/ARCHITECTURE.md`: replace #2129's law 16 with the final
      error law and the health channel law. Update the cleanup and restart
      section.

### 3.2 Adapters

- [ ] **Electric** (`electric-db-collection/src/electric.ts`, 9 call
      sites):
  - [ ] post-readiness `markError` at `:2628` and `:2708` becomes `reportError`
        (`final` per site);
  - [ ] `reportHealthy()` after the next successful up-to-date following a
        problem;
  - [ ] the SDK give-up path: before Collection readiness, `markError`; after it,
        `reportError(..., { final: true })`. This extends #2127's E1 fix.
- [ ] **query-db** (`query-db-collection/src/query.ts`, 6 sites):
  - [ ] a failed refetch after readiness calls `reportError`; a successful
        result after a problem calls `reportHealthy()`;
  - [ ] `:2556`: no `markReady()` when the status is `error` (V1);
  - [ ] keep `utils.lastError`, `utils.isError`, and `utils.errorCount`, and
        state how they relate to Collection health (assay compromise).
- [ ] **PowerSync** (`powersync-db-collection/src/powersync.ts`, 6 sites):
      a failed tracking rebuild at `:826` calls `reportError`; a successful
      rebuild at `:813` calls `reportHealthy()` instead of `markReady()` (V2, post-readiness health).
- [ ] **TrailBase** (`trailbase-db-collection/src/trailbase.ts`, 4 sites):
      post-readiness stream failures call `reportError`. Check them against the
      #2126 fix.
  - [ ] A stream that ends, whether it closes or errors, reports
        `reportError(error, { final: true })` after Collection readiness. The
        adapter does not resubscribe. The `trailbase` SDK (0.10.0) has no
        reconnect or resume: `subscribe` is one `fetch` stream, and
        `subscribeWs` closes without retrying. A correct reconnect would
        have to subscribe again and re-list every active subset. The
        maintainer decided to leave reconnect to the TrailBase maintainers.
  - [ ] Update the stream-end lane in `tests/lifecycle-oracle.property.test.ts`
        (added in #2126) from "rows stay, later changes are not delivered"
        to also expect a final health error.
- [x] **RxDB** (`rxdb-db-collection/src/rxdb.ts`): no change. V10 is
      closed by inspection: RxDB is eager and has no `loadSubset`, so a final
      error has no pending subset loads; its only failure path is the initial
      fetch, which calls `markError` before Collection readiness and rejects
      readiness waiters under the core initial-error law. Open: the
      `rxCollection.$` subscription has no error handler, so an RxDB stream
      failure after readiness is not reported at all. Reporting it as a final
      health error needs an RxDB fault a test can drive; owner: RxDB adapter,
      witness: an observable error after readiness.
- [ ] **Persistence** (`db-sqlite-persistence-core/src/persisted.ts`, 19
      sites):
  - [ ] forward upstream Collection health; keep local storage failures on
        `persistedError`;
  - [ ] follower tabs learn the leader's upstream health through the
        coordinator (open question);
  - [ ] check the browser and Electron hosts, and the node host.
- [ ] Local-only and local-storage Collections: confirm they never need
      health, and document it.

### 3.3 Framework hooks

- [ ] React, Vue, Solid, Svelte, and Angular return `errors` from every
      live-query hook, including infinite-query hooks and
      `useLiveSuspenseQuery`.
- [ ] Suspense: throws only for the initial gate, never for post-ready
      health.
- [ ] Decide whether `errors` keeps stable node identity for memoization
      (open question).

### 3.4 Tests and oracles

- [ ] Flip the #1751 healing tests on purpose: each one that asserts
      `error` → `ready` becomes "stays `error`; recovery needs a restart".
      Search `collection-errors.test.ts`, live-query recovery tests, and
      query-db and PowerSync recovery tests.
- [ ] A new oracle owner for the health channel, from `SourceHealth.tla`'s
      properties: stable shape, mirroring through nested live queries, only
      the source clears, gate independence after ready, gate explained by a
      node, `final` not clearable, and request errors that clear on settle or
      release. Extend the topology beyond the TLA model: a collection reached
      by two aliases, includes with per-row children, and pooled views.
- [ ] Model D (`includes-temporal-oracle.test.ts`): rework the source-error
      lane to the final-error law. Start from `evidence/
      model-d-source-error-grammar.patch` (the C4, C5, and C6 grammar
      dimensions: truncate during the error, ready → error, exact
      acquisitions, and every `source-ready` position). Under the new law,
      `source-ready` after `source-error` in one sync run is illegal, so those
      histories become "restart, then recover".
- [ ] Shared framework conformance suite (`packages/db/tests/conformance/`):
      a health scenario, so all five drivers check `errors` the same way.
- [ ] Adapter witnesses: each adapter reports post-ready failures through
      health and keeps its rows. Electric adds SDK give-up cases through the
      real SDK (missing headers, retry exhaustion).
- [ ] Mutant calibration for each new law, including the TLA weakenings:
      health flips status, nested live query doesn't relay, framework clears,
      healthy nodes dropped, failure clears rows, heal on ready, framework
      retry.
- [ ] Rerun the #2129 review probes in `evidence/
      pr-2129-review-probes.test.ts.txt` against the new law. Several
      expectations change, because recovery now needs a restart.

### 3.5 Hand-written docs (not generated reference)

- [ ] `docs/guides/error-handling.md`: rewrite the collection error sections
      around the two axes. Remove the contradiction between line ~361 (manual
      recovery) and line ~534 (a refetch recovers).
- [ ] `docs/guides/collection-options-creator.md`: the adapter rules from
      `USER-DOCS-DRAFT.md` (stay silent while retrying; `markError` only when
      giving up before Collection readiness; `reportError` and `reportHealthy` after readiness;
      never drop rows).
- [ ] `docs/guides/live-queries.md`: the `errors` tree and the
      `isError` / `errors.hasErrors` callout.
- [ ] `docs/guides/sqlite-persistence.md`, `docs/guides/offline-transactions.md`:
      upstream Collection health against `persistedError`.
- [ ] `docs/errors.md`: the `markReady`-after-`markError` contract error,
      and any new error code.
- [ ] `docs/collections/electric-collection.md`: `onError` retries are
      silent; a give-up is final; post-readiness health.
- [ ] `docs/collections/local-storage-collection.md`: check its error-state
      wording.
- [ ] `docs/collections/query-collection.md` (if present): how `utils` relate
      to health; recovery by restart.
- [ ] Package skills: `packages/db/skills/db-core/custom-adapter/SKILL.md`
      (remove "later successful work in the same sync run can call
      `markReady()` to recover", line ~349, since recovery now requires a restart), and the React, Vue, Solid, and
      Angular skill files. Confirm with the maintainer that these package
      skills are in scope.
- [ ] Package READMEs that mention `isError` (for example
      `packages/angular-db/README.md`).
- [ ] `docs/contributing/oracle-coverage.md`: the new health owner, and the
      Model D source-error lane.
- [ ] `docs/contributing/oracle-reviews/progressive-source-readiness.md`:
      record the decided law and the companion fixes (#2126, #2127, #2128).
      #2129 carried this update and is being replaced.

### 3.6 Release

- [ ] Changeset: a breaking change for `@tanstack/db` and every adapter that
      changes. Include a migration guide:
  - an initial error no longer heals; recover with `cleanup()` and
    `preload()`;
  - after Collection readiness, failures no longer move a Collection or a live
    query to `error`; read `errors`;
  - adapter authors: `reportError` and `reportHealthy`;
  - `markReady()` after `markError()` now throws.
- [ ] PR body: the decisions above, the design, the evidence, and the
      breaking changes.

## 4. Order of work

1. Merge #2126, #2127, and #2128 after their review findings.
2. Close #2129 in favor of this pull request, and move its review-record
   update here.
3. Core lifecycle and the health channel, with the health oracle first (RED,
   then GREEN).
4. Live queries: the gate for every shape, then the error tree, then
   request errors.
5. Effects, then the observer and status flags, then the hooks and the
   conformance suite.
6. Adapters, one at a time, each with witnesses.
7. Docs, then the changeset and the PR body, then review and CI.

## 5. Open questions

- The `health:change` ordering relative to `status:change` (proposed: same
  tick, after it). Model-check it before relying on it.
- How follower tabs learn the leader's upstream health.
- Health for pooled live queries that share sources.
- Stable node identity in `errors` for memoization.
- Which semver bump the packages get, given the 0.x line.
- Whether the shipped package skills are in scope for edits.

## 6. Carried from the reviews

- #2129 C1, C2, C3, C7, C9, C10, and S1 concerned recovery machinery that this
  design removes. Recheck them against the new law using the probes in
  `evidence/`.
- #2129 C8 (keep reporting `lastError` and `loadSubset:error`) is decided
  yes. It is in 3.1.
- #2129 C4, C5, and C6 (Model D grammar gaps) carry over in 3.4.
- #2127 E1 (an SDK give-up must be reported) is fixed in #2127 for the
  initial gate. The post-readiness half is in 3.2.
