Here’s a thorough code review of **PR #499 — “feat: Add flexible matching strategies for electric-db-collection (#402)”** for `@tanstack/electric-db-collection`.

---

## TL;DR

Great direction. The three matching modes (txid, custom function, and “void/timeout”) make Electric integration much more adaptable without forcing backend changes. The stream wiring and tests are mostly solid. A few correctness and API-shape nits to address before merge:

* **Memory‑safety:** pending match handlers aren’t removed on timeout; potential leaks.
* **Browser typing:** avoid `NodeJS.Timeout`.
* **Commit semantics:** `awaitMatch` resolves on *change* not *commit*; txid waits for `up-to-date`. Consider aligning semantics or documenting the difference.
* **API consistency:** `MatchingStrategy` includes a `type` discriminator that isn’t used; handler return types repeat the union instead of the alias; no way to pass a timeout for the “void” strategy.
* **Breaking change labeling:** error classes were removed but the changeset is “patch”; consider bumping minor (even in 0.x) for clarity.

Sources for all the statements below are from the PR description, diff, and updated files. ([GitHub][1])

---

## What’s strong

* **Design:** The feature set is thoughtfully incremental: keep txid for precise matching; allow a heuristic path (`matchFn`); provide a lowest-friction “void” mode for prototypes. The stream subscriber cleanly feeds both the transactional writer and the new matcher store. ([GitHub][2])
* **DX:** Re‑exporting `isChangeMessage`/`isControlMessage` so custom matchers don’t need to import directly from `@electric-sql/client` is a nice touch. ([GitHub][2])
* **Tests:** You added coverage for txid tracking, “void” behavior, and custom matcher success/timeout paths; you also validated that `awaitMatch` is exposed via `utils`. Good signal. ([GitHub][3])

---

## Correctness & lifecycle

1. **Leaked match handlers on timeout.**
   In `awaitMatch`, the `setTimeout` rejects the promise, but the associated entry in `pendingMatches` is never deleted. That leaves the matcher in memory until a future message happens to scan and (not) match it again. Add cleanup on timeout.

   **Suggested change (sketch):**

   ```ts
   const matchId = crypto.randomUUID?.() ?? Math.random().toString(36);

   const onTimeout = () => {
     pendingMatches.setState(current => {
       const next = new Map(current);
       next.delete(matchId);
       return next;
     });
     reject(new Error(`Timeout waiting for custom match function`));
   };
   const timeoutId = setTimeout(onTimeout, timeout);
   ```

   And make sure you also `clearTimeout` and delete on any early reject path. ([GitHub][2])

2. **Abort semantics.**
   You already wire `shapeOptions.signal` into an internal `AbortController` for the `ShapeStream`, but pending `awaitMatch` promises aren’t canceled on abort and `awaitTxId` just “wins” via timeout. If the stream aborts, it’d be better UX to reject outstanding waits with an `AbortError` (or a custom error) and clear `pendingMatches`.

   **Idea:** on `abortController.signal`:

   ```ts
   abortController.signal.addEventListener('abort', () => {
     pendingMatches.setState(current => {
       current.forEach(m => {
         clearTimeout(m.timeoutId);
         m.reject(new DOMException('Aborted', 'AbortError'));
       });
       return new Map(); // clear all
     });
   });
   ```

   ([GitHub][2])

3. **Commit vs. first sight semantics.**

   * `awaitTxId` resolves only after `up-to-date` when the txid gets committed into `seenTxids` (you add txids to a temp set and only commit them to `seenTxids` at `up-to-date`).
   * `awaitMatch` resolves immediately on the first matching *change* message, not on `up-to-date`.

   This asymmetry can surprise users: an `onInsert` that returns `{ matchFn }` will mark a mutation “persisted” before the transaction is committed locally (and before “ready”), unlike `{ txid }`. Either:

   * **Document this difference clearly** in the JSDoc examples and docs (that `awaitMatch` means “server echoed the change”, not “fully committed batch”), or
   * **Normalize behavior**: require the first `up-to-date` after the match before resolving `awaitMatch`.

   Normalization could look like: set a “matched” flag in the handler on a message; actually resolve on the *subsequent* `up-to-date`. (You already track `hasUpToDate` per batch.) ([GitHub][2])

---

## Types & API shape

4. **Avoid `NodeJS.Timeout`.**
   This package runs in browsers. Prefer `ReturnType<typeof setTimeout>` for cross‑env typing. You use `NodeJS.Timeout` in the `pendingMatches` map. Change it accordingly. ([GitHub][2])

5. **Make the strategy type first-class and consistent.**
   You declare `MatchingStrategy<T>` with a `type` discriminator, but you don’t use it in handler return types or in runtime checks; your examples also omit `type`. This is confusing.

   **Pick one path and stick to it**:

   * **Option A (discriminated union):**

     ```ts
     export type MatchingStrategy<T extends Row> =
       | { type: 'txid'; txid: Txid | Txid[] }
       | { type: 'custom'; matchFn: MatchFunction<T>; timeout?: number }
       | { type: 'void'; timeout?: number };

     type HandlerResult<T extends Row> = MatchingStrategy<T>;
     onInsert?: (...) => Promise<HandlerResult<ResolveType>>;
     ```

     And update `processMatchingStrategy` to switch on `result.type` with a backward‑compat shim:

     ```ts
     // legacy shape: { txid } | { matchFn } | {}
     const normalized = normalizeLegacy(result);
     switch (normalized.type) { ... }
     ```

   * **Option B (duck-typed union, no `type` field)**: then **remove** the `type` field from the alias to avoid drift and just export the structural union you actually accept.

   Right now it’s both, which makes the public API muddy. ([GitHub][2])

6. **Allow timeout for the void strategy.**
   There’s no way to express a custom timeout for “void” except by returning `{}` and eating the default 3s. If you keep a discriminated union, support `{ type: 'void', timeout?: number }`. If you keep duck‑typing, allow `{ timeout: number }` when neither `txid` nor `matchFn` is present, and reflect that in the type. Also update docs/tests. ([GitHub][2])

7. **Minor TS hygiene.**
   Some `Promise` returns in the raw view are un-annotated; ensure you type them as `Promise<boolean>` (or a branded `void` type) for `awaitTxId`/`awaitMatch` so `utils` are precise. (The diff suggests boolean; make it consistent.) ([GitHub][4])

---

## Tests

8. **Add a cleanup test for match timeouts.**
   After an `awaitMatch` timeout, ensure a subsequent message does not cause any lingering handler to resolve. (This implicitly checks that the entry was removed.) You can expose a test‑only hook to read `pendingMatches.size`, but even a behavioral test (e.g., ensure a later message doesn’t flip an already failed promise or create console errors) helps. ([GitHub][3])

9. **Commit-order test for custom match.**
   Add a test asserting that `isPersisted.promise` for a custom matcher does **not** resolve before `up-to-date` **if** you decide to normalize behavior; alternatively, assert/document the opposite if you keep “first sight” semantics. Your current custom‑match test sends `up-to-date` almost immediately after the change message, which doesn’t disambiguate the intended behavior. ([GitHub][3])

10. **Void-timeout configurability test.**
    If you add `{ type: 'void', timeout }`, test with a short timeout to avoid 3s sleeps in CI. ([GitHub][3])

---

## Minor nits

* Spelling in comments: “therefor” → “therefore”; “will not be **triggers**” → “will not be **triggered**.” (In the stream error comment.) ([GitHub][4])
* Consider `crypto.randomUUID()` for the `matchId` where available. Fall back to `Math.random().toString(36)`. ([GitHub][2])

---

## Packaging / changeset

* You **removed** exported error classes (`ElectricInsert/Update/DeleteHandlerMustReturnTxIdError`) from `src/errors.ts` and they are re-exported in `src/index.ts`, so this *does* change the public surface. The changeset currently marks a **patch** bump; I’d recommend at least a **minor** bump for clearer signaling, even in 0.x. (If you consider the package beta and reserve the right to break on patch, at least call this out in the release note.) ([GitHub][2])

---

## Suggested code edits (condensed)

**Type and handler returns, with void timeout and consistent alias:**

```ts
export type MatchingStrategy<T extends Row> =
  | { type: 'txid'; txid: Txid | Txid[] }
  | { type: 'custom'; matchFn: MatchFunction<T>; timeout?: number }
  | { type: 'void'; timeout?: number };

type HandlerResult<T extends Row> = MatchingStrategy<T>; // single source of truth

onInsert?: (params: InsertMutationFnParams<ResolveType>) => Promise<HandlerResult<ResolveType>>;
onUpdate?: (params: UpdateMutationFnParams<ResolveType>) => Promise<HandlerResult<ResolveType>>;
onDelete?: (params: DeleteMutationFnParams<ResolveType>) => Promise<HandlerResult<ResolveType>>;
```

**Cross‑env timeout type:**

```ts
type TimeoutHandle = ReturnType<typeof setTimeout>;
...
timeoutId: TimeoutHandle;
```

**Timeout cleanup & abort behavior for awaitMatch (outline):**

```ts
const matchId = crypto.randomUUID?.() ?? Math.random().toString(36);

const onTimeout = () => {
  pendingMatches.setState(cur => {
    const next = new Map(cur);
    next.delete(matchId);
    return next;
  });
  reject(new Error(`Timeout waiting for custom match function`));
};
const timeoutId = setTimeout(onTimeout, timeout);

abortController.signal.addEventListener('abort', () => {
  clearTimeout(timeoutId);
  pendingMatches.setState(cur => {
    const next = new Map(cur);
    const m = next.get(matchId);
    if (m) {
      m.reject(new DOMException('Aborted', 'AbortError'));
      next.delete(matchId);
    }
    return next;
  });
});
```

**Optional**: align `awaitMatch` with commit semantics by resolving only on the next `up-to-date` after a successful `matchFn`.

---

## Overall

This is a meaningful improvement to Electric’s ergonomics in TanStack DB. With the small lifecycle/typing fixes and either (a) normalized semantics or (b) clearly documented semantics for `awaitMatch`, this will be a strong, flexible API for a range of backends.

If you want, I can turn the above into concrete PR suggestions against your branch (one commit per bullet: API, cleanup, tests). The core logic looks good; it just needs some edge‑case polish before release. ([GitHub][2])

[1]: https://github.com/TanStack/db/pull/499 "feat: Add flexible matching strategies for electric-db-collection (#402) by KyleAMathews · Pull Request #499 · TanStack/db · GitHub"
[2]: https://github.com/TanStack/db/pull/499.diff "patch-diff.githubusercontent.com"
[3]: https://github.com/TanStack/db/raw/match-stream/packages/electric-db-collection/tests/electric.test.ts "raw.githubusercontent.com"
[4]: https://github.com/TanStack/db/raw/match-stream/packages/electric-db-collection/src/electric.ts "raw.githubusercontent.com"

