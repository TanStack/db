Below is an engineer‑level review focused on API design, correctness, DX, tests, docs and long‑term maintainability.

---

## 1  High‑level assessment

| Aspect           | Verdict                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| API DX           | **Improved** – callback style is more idiomatic (“transaction‑like”)                                                                           |
| Back‑compat      | **Breaking** for anyone passing an array to `writeBatch`; mitigated by patch‑level release note but deserves a **minor** bump instead of patch |
| Implementation   | Works, but relies on a single module‑level `activeBatchContext`, which introduces edge‑cases (see §2)                                          |
| Tests            | Existing suite updated; happy‑path covered, but no async / re‑entrancy coverage                                                                |
| Docs & Changeset | Excellent, very thorough – new collections guide, meta, partial fetch pattern, etc. ([GitHub][1])                                              |
| Overall          | Worth merging after small fixes / clarifications below                                                                                         |

---

## 2  Implementation feedback

### 2.1 Global `activeBatchContext`

````ts
let activeBatchContext: { operations: SyncOperation[]; ctx: SyncContext } | null = null
``` :contentReference[oaicite:1]{index=1}

* **Cross‑collection contamination** – If two collections call `writeBatch` concurrently (e.g. inside separate micro‑tasks), the second call overwrites the first context. Consider:
  ```ts
  collectionA.utils.writeBatch(() => { … });
  collectionB.utils.writeBatch(() => { … });
````

Both execute synchronously today, but any `await` inside a batch callback (even accidentally) would interleave queue micro‑tasks and create undefined behaviour.

- **Recommendation**
  - Keep the context on the collection instance instead of a module global:

    ```ts
    class ManualSyncUtils { private _batchCtx?: { … } }
    ```

    or

  - Introduce a `WeakMap<Collection, BatchCtx>` keyed by the collection returned from `ensureContext()`.

### 2.2 Synchronous‑only contract

`writeBatch` accepts `() => void`, and the implementation does **not** await the callback. If a user writes:

```ts
await collection.utils.writeBatch(async () => {
  await somethingAsync()
  collection.utils.writeInsert(…)
})
```

nothing is batched; the insert runs after the context is cleared. This is subtle and will bite users.

- **Recommendation**
  - Either:
    - Accept `() => void` **and** explicitly throw if the callback returns a `Promise`, or
    - Change the signature to `() => void | Promise<void>` and await it.

### 2.3 Nested batches

Calling `writeBatch` inside another batch silently resets the outer `activeBatchContext`. You might instead:

```ts
if (activeBatchContext) {
  return callback() // treat as no‑op or push to outer ctx?
}
```

…but most libraries throw to make the developer aware.

### 2.4 Atomicity semantics

If the callback throws, `performWriteOperations` is skipped (good), but partial direct writes issued **before** the throw remain queued in `activeBatchContext.operations` until finally cleared (they are lost). That matches “all‑or‑nothing”, but we should document it explicitly.

### 2.5 Type safety

`operations: Array<any>` in `activeBatchContext` drops generics you worked hard to express elsewhere. Preserve them with generics or by re‑using `SyncOperation<TRow, …>`.

---

## 3  API & release‑management notes

1. **Version bump** – Converting the argument type of a public method is a semver‑**minor** (breaking) change, not a patch. The generated changeset currently says `"patch"` ([GitHub][1]).

2. **Migration path** – Provide a codemod example or upgrade snippet in the release notes:

   ```ts
   // before
   utils.writeBatch([{ type: "insert", data }])

   // after
   utils.writeBatch(() => {
     utils.writeInsert(data)
   })
   ```

3. **Async guardrails** – Whichever path you choose in §2.2, highlight it prominently in the README to avoid misuse.

---

## 4  Test coverage suggestions

- **Async callback** – Expect a thrown error or correct batching behaviour.
- **Cross‑collection concurrency** – Simulate two collections calling `writeBatch` in the same tick and ensure isolation.
- **Nested batch** – Verify error or merge semantics.

The existing duplicate‑key and non‑existent‑item assertions look good ([GitHub][1]).

---

## 5  Documentation

Fantastic job on the new **Query Collection** guide and the partial‑fetch pattern. One small nit: the incremental sync example writes the last sync time to `localStorage` without guarding against SSR; maybe add a comment that this runs only in the browser.

---

## 6  Misc nits

- `manual-sync.ts` – tiny typo in comment `Array>` should be `Array<…>`.
- Consider adding `eslint-plugin-restrict-imports` rule to prevent someone importing `manual-sync.ts` internals directly.

---

### **TL;DR**

Great ergonomic improvement and thorough docs/tests. Address the global‑state edge cases (or, at minimum, document sync‑only support), decide on async callback semantics, bump to a minor version, and this will be rock‑solid.

[1]: https://github.com/TanStack/db/pull/378.patch "patch-diff.githubusercontent.com"
