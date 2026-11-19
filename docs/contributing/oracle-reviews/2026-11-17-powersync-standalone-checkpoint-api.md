# PowerSync standalone checkpoint event proposal: 2026-11-17

The user chose to prepare a supported SDK event API and keep TanStack Direct's same-connection health repair pending its release. This local SDK proposal is reviewable separately. It changes neither TanStack production nor the installed SDK.

## Checkout and patch

- Checkout: `/private/tmp/pr-2377-powersync-checkpoint-api`.
- Repository: `https://github.com/powersync-ja/powersync-js`.
- Exact upstream base: `3601c03398e34639632101fd22c6247e9495b3ae` (`main`, standalone version 0.1.1).
- Local branch: `review/complete-checkpoint-events`; changes remain uncommitted.
- Patch: [complete checkpoint events](2026-11-17-powersync-checkpoint-events.patch), also retained in `.review-2377/sdk-event-api/standalone-checkpoint-events.patch`.
- Patch SHA-256: `56dc1d2a5360d061e916370b3412695503053a0e25d5dda1c4184718381cf556`.
- `git apply --check --reverse` confirms that the saved patch matches the local working changes.

No `AGENTS.md` exists in the checkout, `/private/tmp`, `/private` or `/`. The checkout's existing standalone tests, public subscription APIs, README and formatting configuration guided the implementation. No dependency installation, manifest change, lockfile change, publication, push, commit or message to the SDK maintainers occurred.

## Proposed contract

`PowerSyncClient.subscribeCheckpoint(listener, options?)` returns an idempotent unsubscribe callback. `CheckpointListenerOptions`, exported from the public entry point, has optional `onError(error)`.

A callback runs after a complete checkpoint is applied for the current sync connection. Row snapshots and current-generation stream synchronization state have been updated. It runs even when the checkpoint changes no rows, the table is empty, status remains `ready`, or some leased streams still have errors. Consumers call their relevant `lease.waitForSync()` to distinguish healthy and failed streams.

Partial checkpoint applications and completions from superseded connections do not emit this notification. Subscription does not invoke the callback immediately, start sync, or keep sync running. Existing `subscribeStatus` and its ready-to-ready suppression remain unchanged. Dispatch snapshots the checkpoint registrations: observers added during checkpoint notification begin with the next checkpoint, observers removed before their turn are skipped, and every callback checks that its connection is still active. A status or earlier checkpoint observer may synchronously stop or replace the connection, which suppresses the remaining old-generation notifications while preserving rows already applied.

Synchronous listener exceptions go to optional `onError`; exceptions from that diagnostic callback are isolated as well. Neither interrupts checkpoint processing or another checkpoint observer. Returned asynchronous promises remain caller-owned; the API documents synchronous exception handling.

The implementation adds one observer set, a subscription method with isolated callbacks, and notification at the existing complete-checkpoint boundary. It does not infer checkpoint completion from table changes or status changes. A README example and minor Changeset accompany the public API.

## Evidence

The tests were written before the API implementation. Two focused histories failed because `subscribeCheckpoint` was absent. The initial implementation passed all 27 standalone client tests: 20 existing tests and 7 added cases. Independent review then found two missing reentry dimensions. Six lifecycle cases now cover those gaps; the corrected final suite passes all 33 tests: 20 existing and 13 added cases.

| Added case | Observation |
| --- | --- |
| Empty table, healthy → stream error → healthy on one connection | Three complete-checkpoint callbacks; one ready status notification; current lease verdict changes healthy/failed/healthy; no table-change callback repairs the missing event. |
| Retained nonempty table, same sequence without row changes | The same three callbacks and lease verdicts, with identical retained rows and no reconnect. |
| Pending local write plus partial checkpoint | No complete event while blocked or on the partial application; one new event after the held complete checkpoint applies. |
| Observer lifecycle | Subscription does not start sync or retain the connection; repeated unsubscribe is safe and prevents later notifications. |
| Throwing listener without diagnostic callback | A second observer receives subsequent events and the connection stays ready without reconnecting. |
| Throwing listener with a throwing diagnostic callback | The diagnostic receives the original exception; the second observer and connection remain healthy. |
| Superseded connection | Its buffered rows remain applied, preserving existing behavior, but it emits no complete event for the new stream generation; the current connection's completed checkpoint emits the event. |
| Reentry from status or checkpoint observer, stopping or replacing sync (four cases) | Every remaining observer is skipped for the retired signal; a replacement connection later notifies its own checkpoint. |
| Observer unregisters and registers itself during dispatch | One callback on the current checkpoint; the new registration begins with the next checkpoint. |
| Earlier observer removes a later observer | The removed callback is skipped even though dispatch uses a registration snapshot. |

A hostile mutant gated notification on `event.changes.updatedRows.size`. Both empty/nonempty recovery histories rejected it with event-count assertion failures. The empty history observed zero callbacks; the retained-row history observed only its first callback. This distinguishes the proposed complete-checkpoint boundary from a table-change callback. The mutant was restored, and the final full suite passed 33/33. A second hostile mutant removed the current-membership check from snapshot dispatch; the removed-observer history rejected it at its callback-count assertion. Both mutants are restored.

Strict scoped typechecking of the public source, React entry and standalone tests exited 0. `git diff --check` passes. Formatting used the checkout's existing options without its SQL/embed plugins, which are unnecessary for these changed files. One unrelated formatter rewrite was restored to keep the patch focused.

Artifacts in `.review-2377/sdk-event-api/` include `red.log`, `green.log`, `mutant.log`, `reentry-red.log`, `membership-mutant.log`, `types.log`, the archived initial patch, exact local runner configuration, `source-hashes.txt`, `verification.json` and the patch. Earlier configuration/fixture setup failures are excluded from the RED evidence.

## Independent review corrections

Independent reviewer `oracle_diff_enforcement` executed two P2 counterexamples against the initial API patch (SHA-256 `fba1eaaf06621e1e2cdecad5120acd1fef5cbc6d3f9d8457511f482a52ae887a`, archived as `initial-checkpoint-events.patch`).

1. A public ready-status callback could release the last lease or change the stream union after the old active-signal check, so the new observer was notified for an idle or superseded connection. Earlier tests retired the connection outside callbacks and missed that reentry boundary. Four new histories vary status/checkpoint trigger and stop/restart action. All four failed their notification-count assertions before the repair.
2. A checkpoint observer could unregister and register itself into the live observer set during iteration, receiving repeated callbacks from one checkpoint. Without a finite cap this could loop indefinitely. Earlier tests unsubscribed outside dispatch and missed registration during notification. The bounded self-registration history failed `expected 1, received 3` before repair. The adjacent remove-later-observer history already passed and protects the original immediate-unsubscribe behavior under the new snapshot implementation.

These six histories were added before repairing the initial API source. `reentry-red.log` records five assertion failures, one passing neighbor and 27 skipped tests, without setup failure or timeout. The repair snapshots registrations, checks current membership, and checks the per-connection abort signal before each callback. Stopping sync and every generation restart synchronously abort that signal. The loop returns whether the connection is still active, and row application remains before this notification phase. The README and JSDoc state the dispatch semantics.

Independent reviewer `oracle_diff_enforcement` approved the corrected frozen patch at SHA-256 `56dc1d2a5360d061e916370b3412695503053a0e25d5dda1c4184718381cf556`, verified all five source hashes, and independently ran the complete client suite (33 passed), strict scoped typechecking (exit 0) and diff check (exit 0). The reviewer confirmed both original P2 witnesses now fail under the initial API patch and pass under the repaired dispatch, with no remaining actionable issue. Approval covers this local API proposal; upstream catalog-toolchain CI, real browser/provider behavior and the future TanStack repair remain outside the result.

## Exact commands and toolchain

The checkout reuses the available local runtime through ignored, read-only dependency symlinks. It does not modify the installed dependency. The installed `@powersync/shared-internals` 1.6.0 source is byte-identical to the entire checkout's `packages/shared-internals/src`, checked with `diff -qr`.

From the SDK checkout:

```sh
/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config .review-vitest.config.ts test/client.test.ts --reporter=dot

/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target esnext --module NodeNext --moduleResolution NodeNext --types node packages/standalone/src/index.ts packages/standalone/src/react.ts packages/standalone/test/client.test.ts
```

The test-only local config selects `packages/standalone` and its explicit tsconfig. The reused Vite 8 transformer otherwise traverses the monorepo's Nuxt project reference, whose generated `.nuxt/tsconfig.json` is absent. The local config is ignored and excluded from the proposed patch; an exact copy is saved with the artifacts.

Runtime: Node 26.13.1, Vitest 5.1.0, TypeScript 5.9.3. The SDK catalog requests Vitest ^4.1.10 and TypeScript ^6.0.3. These tools were reused locally instead of installing the whole SDK monorepo. The local results establish the listed cases under that toolchain; upstream CI must run the patch with its catalog toolchain before release. No remote-service or native-browser test was run for this SDK proposal.

## Exact changed source hashes

```text
2b07eb41b4594499e685b0cca1344f8e42db71bb3557462713605d72fbb0d0ab  packages/standalone/src/client.ts
bb9a33ecf4bca479d088d3eee775ac1ae00dca29100813c6dde6f30d653cab51  packages/standalone/src/index.ts
f1b628958db88bbaecd4a8f920a799031b3a572c5fa2a68eda5b6da60c452845  packages/standalone/test/client.test.ts
a052d0035632e4e1d44ec7213c863f88450156c546c3997193705ffa8b8ce1f2  packages/standalone/README.md
df4fcf93b5ce0b7ac6d9143767b761eb4cba42bba222b8ca5aae4a44ce4d11d6  .changeset/complete-checkpoint-observer.md
```

## TanStack receiving follow-up

The existing Direct health oracle remains RED for a stream failure followed by a healthy unchanged or empty checkpoint on the same connection. Its ownership and coverage limits remain with the TanStack eager/on-demand instruments. This SDK proposal does not close that TanStack bug class.

After the API is reviewed and released, update the Direct adapter's dependency and use `subscribeCheckpoint` to recheck the relevant retained leases. Cleanup must unsubscribe and stale sync runs must not publish health. Then rerun the already-reviewed fixed/random histories, exact replays, receiving paths and hostile mutants to establish TanStack GREEN and successful recovery reach. No polling fallback or installed-package patch is introduced while awaiting the release.
