# Mutation Log Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Phase 1 core vertical slice from RFC #1625: committed sync updates always advance collection base state while active transaction mutations are projected over the base and stable visible-state change events are emitted.

**Architecture:** Keep `Transaction` and `PendingMutation` as the lifecycle and mutation primitives. Add a focused mutation projection/diff layer inside `@tanstack/db` collection state so visible state is computed from `syncedData` plus active transaction mutations, rather than from scattered optimistic maps and delayed sync branches. This plan intentionally does not add `accepted`/`observed`, `$hasPendingWrites`, `$writeStatus`, `needs-resolution`, offline durability, or stable identity; those are follow-up phases.

**Tech Stack:** TypeScript, Vitest, `@tanstack/db` core collection state/sync managers.

## Global Constraints

- Preserve current public write APIs: `collection.insert/update/delete`, `createTransaction`, `mutationFn`, `transaction.mutations`, and `isPersisted.promise` continue to work during this Phase 1 slice.
- Preserve current settlement semantics: a transaction settles when `mutationFn` resolves successfully; adapters that need sync echo before settlement keep `mutationFn` pending.
- Do not redesign sync writer APIs (`begin` / `write` / `commit`).
- Do not add operation lifecycle states or public operation APIs.
- Do not add `accepted`, `observed`, `awaitTxId` replacement, or transport-confirmation state.
- Use existing `PendingMutation` data first. Full patch replay, nested path semantics, array patches, and conflict detection are out of scope.
- Prioritize correctness and clear invariants over micro-optimization. Use dirty-key sets to constrain recomputation, but avoid reintroducing delayed-sync special cases.
- Follow `AGENTS.md`: avoid `any` in new public code, prefer precise types, add tests for bugs, and keep abstractions small.

---

## Scope Check

The RFC covers multiple phases. This plan implements only **Phase 1: core vertical slice**:

1. Add regression tests that describe the target sync/mutation reconciliation behavior.
2. Add a small internal projection helper around existing `PendingMutation`s.
3. Refactor `CollectionStateManager.commitPendingTransactions()` so committed sync updates always apply to `syncedData` immediately.
4. Preserve stable materialized change events by diffing previous visible state against next visible state for affected keys.
5. Keep existing APIs and settlement semantics intact.

Separate plans should cover later public status APIs, `needs-resolution`, bounded failed mutation history, and offline durability.

## File Structure

- Modify: `packages/db/src/collection/state.ts`
  - Owns core synced state, optimistic state, pending sync transactions, and change-event generation.
  - Add small internal helpers for active mutation projection and visible-state diffing.
  - Remove the normal-sync blocking branch for `persisting` transactions.

- Modify: `packages/db/tests/collection.test.ts`
  - Update the existing test that currently asserts sync is not applied while a transaction is persisting.
  - Add direct collection-state regression coverage for immediate sync application under an active mutation.

- Modify: `packages/db/tests/query/live-query-collection.test.ts`
  - Add regression coverage that a derived/live-query collection receives unrelated synced rows while a source collection has a pending optimistic mutation.

- Optional modify: `packages/db/tests/collection-subscribe-changes.test.ts`
  - Add regression coverage for the source collection `subscribeChanges` stream if the collection-level tests do not already assert event shape strongly enough.

No new public source files are required for Phase 1. If `state.ts` becomes too unwieldy during implementation, create an internal helper file `packages/db/src/collection/mutation-projection.ts`, but only after Task 2 makes the desired helper boundaries clear.

---

### Task 1: Add direct regression tests for immediate sync application while persisting

**Files:**
- Modify: `packages/db/tests/collection.test.ts`

**Interfaces:**
- Consumes: existing `createCollection`, `createTransaction`, `PendingMutation`, `MutationFn`, `getStateEntries` helper in `collection.test.ts`.
- Produces: failing tests that define Phase 1 semantics for base sync application and visible projection while a transaction is `persisting`.

- [ ] **Step 1: Rename and rewrite the existing delayed-sync test**

In `packages/db/tests/collection.test.ts`, replace the test currently named:

```ts
it(`synced updates should *not* be applied while there's a persisting transaction`, async () => {
```

with this test body:

```ts
it(`applies unrelated synced inserts while a transaction is persisting`, async () => {
  const emitter = mitt()

  const collection = createCollection<{ id: number; value: string }>({
    id: `sync-while-persisting-unrelated`,
    getKey: (item) => item.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit }) => {
        // @ts-expect-error don't trust Mitt's typing and this works.
        emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
          begin()
          changes.forEach((change) => {
            write({
              type: change.type,
              // @ts-expect-error test intentionally emits partial sync payloads
              value: change.changes,
            })
          })
          commit()
        })
      },
    },
  })

  const mutationFn: MutationFn = ({ transaction }) => {
    emitter.emit(`update`, [
      { type: `insert`, changes: { id: 2, value: `synced value` } },
    ])

    expect(getStateEntries(collection)).toEqual([
      [1, { id: 1, value: `optimistic value` }],
      [2, { id: 2, value: `synced value` }],
    ])

    emitter.emit(`update`, transaction.mutations)
    return Promise.resolve()
  }

  const tx = createTransaction({ mutationFn })

  tx.mutate(() =>
    collection.insert({
      id: 1,
      value: `optimistic value`,
    }),
  )

  expect(getStateEntries(collection)).toEqual([
    [1, { id: 1, value: `optimistic value` }],
    [2, { id: 2, value: `synced value` }],
  ])

  await tx.isPersisted.promise

  expect(getStateEntries(collection)).toEqual([
    [1, { id: 1, value: `optimistic value` }],
    [2, { id: 2, value: `synced value` }],
  ])
})
```

- [ ] **Step 2: Add a same-key overlay regression test**

Add this test immediately after the previous one:

```ts
it(`keeps optimistic visible value when synced update for the same key arrives while persisting`, async () => {
  const emitter = mitt()

  const collection = createCollection<{ id: number; value: string }>({
    id: `sync-while-persisting-same-key`,
    getKey: (item) => item.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit }) => {
        begin()
        write({ type: `insert`, value: { id: 1, value: `base value` } })
        commit()

        // @ts-expect-error don't trust Mitt's typing and this works.
        emitter.on(`*`, (_, changes: Array<PendingMutation>) => {
          begin()
          changes.forEach((change) => {
            write({
              type: change.type,
              // @ts-expect-error test intentionally emits partial sync payloads
              value: change.changes,
            })
          })
          commit()
        })
      },
    },
  })

  const mutationFn: MutationFn = ({ transaction }) => {
    emitter.emit(`update`, [
      { type: `update`, changes: { id: 1, value: `server value` } },
    ])

    expect(getStateEntries(collection)).toEqual([
      [1, { id: 1, value: `optimistic value` }],
    ])
    expect(collection._state.syncedData.get(1)).toEqual({
      id: 1,
      value: `server value`,
    })

    emitter.emit(`update`, transaction.mutations)
    return Promise.resolve()
  }

  const tx = collection.update(1, (draft) => {
    draft.value = `optimistic value`
  }, { mutationFn })

  expect(getStateEntries(collection)).toEqual([
    [1, { id: 1, value: `optimistic value` }],
  ])

  await tx.isPersisted.promise

  expect(getStateEntries(collection)).toEqual([
    [1, { id: 1, value: `optimistic value` }],
  ])
})
```

If `collection.update(..., { mutationFn })` is not a valid overload in this codebase, write the same test using `createTransaction({ mutationFn })` and `tx.mutate(() => collection.update(1, draft => { ... }))`:

```ts
const tx = createTransaction({ mutationFn })
tx.mutate(() =>
  collection.update(1, (draft) => {
    draft.value = `optimistic value`
  }),
)
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
pnpm --filter @tanstack/db test -- tests/collection.test.ts -t "persisting"
```

Expected before implementation:

- The rewritten unrelated insert test fails because row `2` is not visible while the transaction is `persisting`.
- The same-key test may fail because `syncedData` is not updated until the transaction completes.

- [ ] **Step 4: Commit the failing tests**

```bash
git add packages/db/tests/collection.test.ts
git commit -m "test: capture sync while persisting reconciliation target"
```

---

### Task 2: Add derived/live-query regression coverage for the stable change stream

**Files:**
- Modify: `packages/db/tests/query/live-query-collection.test.ts`

**Interfaces:**
- Consumes: existing `createCollection`, `createLiveQueryCollection`, `eq`, `flushPromises`, and `stripVirtualProps` test utilities.
- Produces: failing test proving derived collections receive unrelated synced rows while a source collection has a pending optimistic mutation.

- [ ] **Step 1: Add the failing live-query test**

Append this test inside `describe('createLiveQueryCollection', ...)` in `packages/db/tests/query/live-query-collection.test.ts`:

```ts
it(`shows unrelated synced source rows in a live query while a source mutation is persisting`, async () => {
  type Todo = { id: number; text: string; projectId: number }
  type SyncPayload = { type: `insert` | `update` | `delete`; value?: Todo; key?: number }

  const syncListeners: Array<(payload: SyncPayload) => void> = []

  const todos = createCollection<Todo, number>({
    id: `live-query-sync-while-persisting-source`,
    getKey: (todo) => todo.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit }) => {
        begin()
        write({ type: `insert`, value: { id: 1, text: `one`, projectId: 1 } })
        commit()

        syncListeners.push((payload) => {
          begin()
          if (payload.type === `delete`) {
            write({ type: `delete`, key: payload.key! })
          } else {
            write({ type: payload.type, value: payload.value! })
          }
          commit()
        })
      },
    },
  })

  const projectTodos = createLiveQueryCollection((q) =>
    q.from({ todo: todos }).where(({ todo }) => eq(todo.projectId, 1)),
  )

  await projectTodos.preload()

  expect(
    Array.from(projectTodos.state.values()).map((row) => stripVirtualProps(row)),
  ).toEqual([{ id: 1, text: `one`, projectId: 1 }])

  let resolveMutation!: () => void
  const mutationSettled = new Promise<void>((resolve) => {
    resolveMutation = resolve
  })

  const tx = createTransaction<Todo>({
    mutationFn: async () => {
      syncListeners[0]!({
        type: `insert`,
        value: { id: 2, text: `two`, projectId: 1 },
      })
      await mutationSettled
    },
  })

  tx.mutate(() =>
    todos.update(1, (draft) => {
      draft.text = `one optimistic`
    }),
  )

  await flushPromises()

  expect(
    Array.from(projectTodos.state.values()).map((row) => stripVirtualProps(row)),
  ).toEqual([
    { id: 1, text: `one optimistic`, projectId: 1 },
    { id: 2, text: `two`, projectId: 1 },
  ])

  resolveMutation()
  await tx.isPersisted.promise
  await flushPromises()

  expect(
    Array.from(projectTodos.state.values()).map((row) => stripVirtualProps(row)),
  ).toEqual([
    { id: 1, text: `one optimistic`, projectId: 1 },
    { id: 2, text: `two`, projectId: 1 },
  ])
})
```

- [ ] **Step 2: Run the focused live-query test and verify it fails**

Run:

```bash
pnpm --filter @tanstack/db test -- tests/query/live-query-collection.test.ts -t "unrelated synced source rows"
```

Expected before implementation:

- The test fails because row `2` does not appear in `projectTodos` while the source mutation is still `persisting`.

- [ ] **Step 3: Commit the failing live-query test**

```bash
git add packages/db/tests/query/live-query-collection.test.ts
git commit -m "test: capture live query sync during pending mutation"
```

---

### Task 3: Add internal helpers for visible-state snapshots and transaction mutation projection

**Files:**
- Modify: `packages/db/src/collection/state.ts`

**Interfaces:**
- Consumes: `Transaction`, `PendingMutation`, existing `syncedData`, existing `isThisCollection` helper.
- Produces: internal helpers used by `recomputeOptimisticState()` and `commitPendingTransactions()`:
  - `private collectActiveTransactions(): Array<Transaction<any>>`
  - `private projectMutationOntoVisibleState(visible: Map<TKey, TOutput>, mutation: PendingMutation<any>): void`
  - `private captureVisibleStateForKeys(keys: Set<TKey>): Map<TKey, TOutput>`
  - `private diffVisibleStateForKeys(previous, keys): Array<InternalChangeMessage<TOutput, TKey>>`

- [ ] **Step 1: Import `PendingMutation` as a type**

In `packages/db/src/collection/state.ts`, update the type import from `../types` to include `PendingMutation`:

```ts
import type {
  ChangeMessage,
  CollectionConfig,
  OptimisticChangeMessage,
  PendingMutation,
} from '../types'
```

- [ ] **Step 2: Add active transaction helper**

Inside `CollectionStateManager`, near `isThisCollection`, add:

```ts
  private collectActiveTransactions(): Array<Transaction<any>> {
    const activeTransactions: Array<Transaction<any>> = []

    for (const transaction of this.transactions.values()) {
      if (![`completed`, `failed`].includes(transaction.state)) {
        activeTransactions.push(transaction)
      }
    }

    return activeTransactions
  }
```

- [ ] **Step 3: Add mutation projection helper**

Below `collectActiveTransactions`, add:

```ts
  private projectMutationOntoVisibleState(
    visible: Map<TKey, TOutput>,
    mutation: PendingMutation<any>,
  ): void {
    if (!this.isThisCollection(mutation.collection) || !mutation.optimistic) {
      return
    }

    switch (mutation.type) {
      case `insert`:
      case `update`:
        visible.set(mutation.key, mutation.modified as TOutput)
        break
      case `delete`:
        visible.delete(mutation.key)
        break
    }
  }
```

This intentionally uses `modified` for Phase 1. Patch replay from `changes` is a follow-up.

- [ ] **Step 4: Add key-scoped visible-state capture helper**

Below `projectMutationOntoVisibleState`, add:

```ts
  private captureVisibleStateForKeys(keys: Set<TKey>): Map<TKey, TOutput> {
    const visible = new Map<TKey, TOutput>()

    for (const key of keys) {
      const value = this.syncedData.get(key)
      if (value !== undefined) {
        visible.set(key, value)
      }
    }

    for (const transaction of this.collectActiveTransactions()) {
      for (const mutation of transaction.mutations) {
        if (keys.has(mutation.key as TKey)) {
          this.projectMutationOntoVisibleState(visible, mutation)
        }
      }
    }

    return visible
  }
```

- [ ] **Step 5: Add visible-state diff helper**

Below `captureVisibleStateForKeys`, add:

```ts
  private diffVisibleStateForKeys(
    previousVisibleState: Map<TKey, TOutput>,
    keys: Set<TKey>,
  ): Array<InternalChangeMessage<TOutput, TKey>> {
    const events: Array<InternalChangeMessage<TOutput, TKey>> = []

    for (const key of keys) {
      const previousValue = previousVisibleState.get(key)
      const nextValue = this.get(key)

      if (previousValue === undefined && nextValue !== undefined) {
        events.push({ type: `insert`, key, value: nextValue })
      } else if (previousValue !== undefined && nextValue === undefined) {
        events.push({ type: `delete`, key, value: previousValue })
      } else if (
        previousValue !== undefined &&
        nextValue !== undefined &&
        !deepEquals(previousValue, nextValue)
      ) {
        events.push({
          type: `update`,
          key,
          value: nextValue,
          previousValue,
        })
      }
    }

    return events
  }
```

- [ ] **Step 6: Run typecheck via tests and expect existing behavior to remain mostly unchanged**

Run:

```bash
pnpm --filter @tanstack/db test -- tests/collection.test.ts -t "should apply optimistic updates by default"
```

Expected:

- The command may still fail because Task 1 tests are failing, but it should not fail with TypeScript syntax/type errors from the new helpers.

- [ ] **Step 7: Commit helper scaffolding**

```bash
git add packages/db/src/collection/state.ts
git commit -m "refactor: add mutation projection helpers"
```

---

### Task 4: Refactor `recomputeOptimisticState()` to use the mutation projection helper

**Files:**
- Modify: `packages/db/src/collection/state.ts`

**Interfaces:**
- Consumes: `collectActiveTransactions()` and `projectMutationOntoVisibleState()` from Task 3.
- Produces: one shared mutation projection path for optimistic recomputation and sync reconciliation.

- [ ] **Step 1: Replace manual active transaction collection**

In `recomputeOptimisticState()`, replace this block:

```ts
    const activeTransactions: Array<Transaction<any>> = []

    for (const transaction of this.transactions.values()) {
      if (![`completed`, `failed`].includes(transaction.state)) {
        activeTransactions.push(transaction)
      }
    }
```

with:

```ts
    const activeTransactions = this.collectActiveTransactions()
```

- [ ] **Step 2: Replace manual active mutation switch**

In `recomputeOptimisticState()`, replace the loop body that manually switches on `mutation.type` for active optimistic transactions:

```ts
        if (mutation.optimistic) {
          switch (mutation.type) {
            case `insert`:
            case `update`:
              this.optimisticUpserts.set(
                mutation.key,
                mutation.modified as TOutput,
              )
              this.optimisticDeletes.delete(mutation.key)
              break
            case `delete`:
              this.optimisticUpserts.delete(mutation.key)
              this.optimisticDeletes.add(mutation.key)
              break
          }
        }
```

with this helper-based code:

```ts
        if (mutation.optimistic) {
          const projected = new Map<TKey, TOutput>()
          for (const [key, value] of this.optimisticUpserts) {
            projected.set(key, value)
          }
          for (const key of this.optimisticDeletes) {
            projected.delete(key)
          }

          this.projectMutationOntoVisibleState(projected, mutation)

          if (mutation.type === `delete`) {
            this.optimisticUpserts.delete(mutation.key)
            this.optimisticDeletes.add(mutation.key)
          } else {
            const projectedValue = projected.get(mutation.key)
            if (projectedValue !== undefined) {
              this.optimisticUpserts.set(mutation.key, projectedValue)
              this.optimisticDeletes.delete(mutation.key)
            }
          }
        }
```

If this local `projected` map feels too indirect during implementation, keep the existing switch and only use `collectActiveTransactions()` in this task. The important review gate is that Task 3 helpers compile and can be used by `commitPendingTransactions()` in Task 5.

- [ ] **Step 3: Run optimistic mutation tests**

Run:

```bash
pnpm --filter @tanstack/db test -- tests/collection.test.ts -t "optimistic"
```

Expected:

- Existing optimistic tests pass except the newly added Task 1 target tests may still fail until Task 5.
- If unrelated optimistic tests fail, revert Step 2 and keep only Step 1 in this task.

- [ ] **Step 4: Commit the recompute cleanup**

```bash
git add packages/db/src/collection/state.ts
git commit -m "refactor: share active transaction collection"
```

---

### Task 5: Apply committed sync transactions immediately and emit visible-state diffs

**Files:**
- Modify: `packages/db/src/collection/state.ts`

**Interfaces:**
- Consumes: `captureVisibleStateForKeys()` and `diffVisibleStateForKeys()` from Task 3.
- Produces: target reconciliation behavior for committed sync while transactions are `persisting`.

- [ ] **Step 1: Remove persisting-transaction gating for normal sync commits**

In `commitPendingTransactions()`, keep the initial calculation of committed and uncommitted sync transactions, but remove the condition that prevents processing when `hasPersistingTransaction` is true.

Replace:

```ts
    if (!hasPersistingTransaction || hasTruncateSync || hasImmediateSync) {
```

with:

```ts
    if (committedSyncedTransactions.length > 0) {
```

Then remove `hasPersistingTransaction`, `hasImmediateSync`, and `hasTruncateSync` only if TypeScript reports they are unused. Keep `hasTruncateSync` if truncate-specific code still needs it.

- [ ] **Step 2: Capture previous visible state for changed keys before applying sync**

Immediately after `changedKeys` is built and before any sync operations mutate `syncedData`, insert:

```ts
      const previousVisibleState = this.captureVisibleStateForKeys(changedKeys)
```

If `changedKeys` is currently built after truncate snapshot logic, move only the `changedKeys` collection loop earlier; do not move truncate application itself.

- [ ] **Step 3: Use previous visible state for event diffing**

Find the section that currently initializes or uses `currentVisibleState` / `preSyncVisibleState` for comparing previous and next visible values. Replace the fallback capture logic:

```ts
      let currentVisibleState = this.preSyncVisibleState
      if (currentVisibleState.size === 0) {
        currentVisibleState = new Map<TKey, TOutput>()
        for (const key of changedKeys) {
          const currentValue = this.get(key)
          if (currentValue !== undefined) {
            currentVisibleState.set(key, currentValue)
          }
        }
      }
```

with:

```ts
      const currentVisibleState =
        this.preSyncVisibleState.size > 0
          ? this.preSyncVisibleState
          : previousVisibleState
```

This preserves existing truncate/pre-captured behavior while making normal sync commits compare against the visible state before base mutation.

- [ ] **Step 4: Ensure active optimistic mutations are reprojected after sync base mutation**

Keep the existing block that clears `optimisticUpserts` / `optimisticDeletes` and reapplies active transactions. If implementation simplifies this block, the replacement must preserve this exact switch for active transactions:

```ts
      for (const transaction of this.transactions.values()) {
        if (![`completed`, `failed`].includes(transaction.state)) {
          for (const mutation of transaction.mutations) {
            if (
              this.isThisCollection(mutation.collection) &&
              mutation.optimistic
            ) {
              switch (mutation.type) {
                case `insert`:
                case `update`:
                  this.optimisticUpserts.set(
                    mutation.key,
                    mutation.modified as TOutput,
                  )
                  this.optimisticDeletes.delete(mutation.key)
                  break
                case `delete`:
                  this.optimisticUpserts.delete(mutation.key)
                  this.optimisticDeletes.add(mutation.key)
                  break
              }
            }
          }
        }
      }
```

Do not change update projection from `modified` to `changes` in this task.

- [ ] **Step 5: Remove or neutralize delayed-sync-only event branch**

If `commitPendingTransactions()` has an `else` branch for `hasPersistingTransaction` that emits events without mutating `syncedData`, delete it. After Step 1, all committed sync transactions should use the normal sync application path.

The resulting shape should be:

```ts
    if (committedSyncedTransactions.length > 0) {
      // apply sync to syncedData
      // reproject active optimistic mutations
      // diff previous visible state against next visible state
      // emit events
      this.pendingSyncedTransactions = uncommittedSyncedTransactions
    }
```

- [ ] **Step 6: Run the Task 1 tests**

Run:

```bash
pnpm --filter @tanstack/db test -- tests/collection.test.ts -t "sync while persisting"
```

Expected:

- `applies unrelated synced inserts while a transaction is persisting` passes.
- `keeps optimistic visible value when synced update for the same key arrives while persisting` passes.

- [ ] **Step 7: Run broader collection sync tests**

Run:

```bash
pnpm --filter @tanstack/db test -- tests/collection.test.ts tests/collection-subscribe-changes.test.ts
```

Expected:

- Existing tests pass or expose tests that encoded the old delayed-sync contract.
- For each old-contract failure, update the test only if the new RFC semantics make the old assertion wrong.

- [ ] **Step 8: Commit immediate sync reconciliation**

```bash
git add packages/db/src/collection/state.ts packages/db/tests/collection.test.ts packages/db/tests/collection-subscribe-changes.test.ts
git commit -m "fix: apply sync while projecting active mutations"
```

---

### Task 6: Verify stable change events for source subscriptions and live queries

**Files:**
- Modify: `packages/db/tests/collection-subscribe-changes.test.ts`
- Modify: `packages/db/tests/query/live-query-collection.test.ts`
- Modify: `packages/db/src/collection/state.ts` only if these tests reveal event-shape bugs.

**Interfaces:**
- Consumes: reconciliation behavior from Task 5.
- Produces: tests proving materialized visible-state transitions emit stable events into source subscriptions and live queries.

- [ ] **Step 1: Add source `subscribeChanges` regression test if missing**

Search `packages/db/tests/collection-subscribe-changes.test.ts` for a test that already covers committed sync while an optimistic transaction is persisting.

Run:

```bash
rg -n "persisting|pending optimistic|sync while" packages/db/tests/collection-subscribe-changes.test.ts
```

If no equivalent test exists, add this test near the other optimistic/synced mixed tests:

```ts
it(`emits visible-state changes for unrelated sync while a mutation is persisting`, async () => {
  const syncListeners: Array<(value: { id: number; value: string }) => void> = []

  const collection = createCollection<{ id: number; value: string }>({
    id: `subscribe-sync-while-persisting`,
    getKey: (item) => item.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit }) => {
        syncListeners.push((value) => {
          begin()
          write({ type: `insert`, value })
          commit()
        })
      },
    },
  })

  const received: Array<ChangeMessage<{ id: number; value: string }, number>> = []
  collection.subscribeChanges((changes) => {
    received.push(...changes)
  })

  let resolveMutation!: () => void
  const mutationSettled = new Promise<void>((resolve) => {
    resolveMutation = resolve
  })

  const tx = createTransaction<{ id: number; value: string }>({
    mutationFn: async () => {
      syncListeners[0]!({ id: 2, value: `synced` })
      await mutationSettled
    },
  })

  tx.mutate(() => collection.insert({ id: 1, value: `optimistic` }))

  expect(received.map((event) => ({ type: event.type, key: event.key }))).toEqual([
    { type: `insert`, key: 1 },
    { type: `insert`, key: 2 },
  ])

  resolveMutation()
  await tx.isPersisted.promise
})
```

If `ChangeMessage` is not imported in this test file, add:

```ts
import type { ChangeMessage } from '../src/types'
```

Use the correct relative path for the file; from `packages/db/tests/collection-subscribe-changes.test.ts`, the path is `../src/types`.

- [ ] **Step 2: Run source subscription regression**

Run:

```bash
pnpm --filter @tanstack/db test -- tests/collection-subscribe-changes.test.ts -t "unrelated sync while a mutation is persisting"
```

Expected:

- The new source subscription test passes after Task 5.

- [ ] **Step 3: Run live-query regression from Task 2**

Run:

```bash
pnpm --filter @tanstack/db test -- tests/query/live-query-collection.test.ts -t "unrelated synced source rows"
```

Expected:

- The live-query test passes.

- [ ] **Step 4: Fix event-shape bugs if tests fail**

If source subscription gets no insert for key `2`, inspect `commitPendingTransactions()` and ensure:

```ts
this.indexes.updateIndexes(events)
this.changes.emitEvents(events, true)
```

run for committed sync while transactions are `persisting`.

If live query gets source row `2` but in the wrong order, make the test order-insensitive by sorting IDs before assertion:

```ts
const rows = Array.from(projectTodos.state.values())
  .map((row) => stripVirtualProps(row))
  .sort((a, b) => a.id - b.id)
expect(rows).toEqual([
  { id: 1, text: `one optimistic`, projectId: 1 },
  { id: 2, text: `two`, projectId: 1 },
])
```

- [ ] **Step 5: Commit stable change event tests/fixes**

```bash
git add packages/db/src/collection/state.ts packages/db/tests/collection-subscribe-changes.test.ts packages/db/tests/query/live-query-collection.test.ts
git commit -m "test: verify stable changes during sync reconciliation"
```

---

### Task 7: Update stale tests/comments that encode delayed sync semantics

**Files:**
- Modify: `packages/db/tests/collection.test.ts`
- Modify: `packages/db/tests/collection-subscribe-changes.test.ts`
- Modify: `packages/db/src/collection/state.ts`
- Search-only: all `packages/db/tests/**/*.ts`

**Interfaces:**
- Consumes: behavior from Tasks 5 and 6.
- Produces: test suite comments and names aligned with the new immediate-sync semantics.

- [ ] **Step 1: Search for old delayed-sync language**

Run:

```bash
rg -n "not be applied|isn't applied|delayed|held while|persisting transaction|sync while persisting|pending sync" packages/db/tests packages/db/src/collection/state.ts
```

- [ ] **Step 2: Update comments that describe old behavior**

For comments equivalent to:

```ts
// The sync commit is held while the local insert transaction is persisting.
```

replace with:

```ts
// Sync commits apply to base immediately; active optimistic mutations still determine visible state.
```

For comments equivalent to:

```ts
// we're still in the middle of persisting a transaction, so sync is not applied
```

replace with:

```ts
// we're still in the middle of persisting a transaction, but sync still advances base state
```

- [ ] **Step 3: Update test names that assert old behavior**

Rename tests with old behavior names. Examples:

```ts
it(`synced updates should *not* be applied while there's a persisting transaction`, ...)
```

becomes:

```ts
it(`applies synced updates while projecting active transaction mutations`, ...)
```

Do not rewrite unrelated tests.

- [ ] **Step 4: Run old-language search again**

Run:

```bash
rg -n "should \*not\* be applied|isn't applied|held while the local|because.*persisting.*not applied" packages/db/tests packages/db/src/collection/state.ts
```

Expected:

- No matches for comments/test names that encode the removed behavior.

- [ ] **Step 5: Commit wording cleanup**

```bash
git add packages/db/tests packages/db/src/collection/state.ts
git commit -m "test: update sync reconciliation expectations"
```

---

### Task 8: Run validation and document Phase 1 status

**Files:**
- Modify: `docs/rfcs/2026-06-25-mutation-log-reconciliation.md` only if implementation discoveries require wording changes.
- No source changes expected unless validation finds bugs.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: validated Phase 1 implementation branch ready for review.

- [ ] **Step 1: Run focused DB tests**

Run:

```bash
pnpm --filter @tanstack/db test -- tests/collection.test.ts tests/collection-subscribe-changes.test.ts tests/query/live-query-collection.test.ts
```

Expected:

- PASS.

- [ ] **Step 2: Run full `@tanstack/db` test suite**

Run:

```bash
pnpm --filter @tanstack/db test
```

Expected:

- PASS.

- [ ] **Step 3: Search for accidental public API additions**

Run:

```bash
git diff origin/main...HEAD -- packages/db/src/index.ts packages/db/src/types.ts packages/db/src/transactions.ts
```

Expected:

- No new public operation lifecycle API.
- No `accepted` or `observed` type/API.
- No public `db.operations` or `db.mutations` API in Phase 1.

- [ ] **Step 4: Inspect final diff for split sync/optimistic branches**

Run:

```bash
git diff origin/main...HEAD -- packages/db/src/collection/state.ts | sed -n '1,260p'
```

Check manually:

- Normal committed sync does not return early only because a transaction is `persisting`.
- There is no event-only branch that emits sync changes without mutating `syncedData`.
- Active transaction mutations are still projected over base.
- Truncate-specific logic still has tests covering preserved optimistic state.

- [ ] **Step 5: Commit any final fixes**

If Step 1-4 required changes:

```bash
git add packages/db/src packages/db/tests docs/rfcs/2026-06-25-mutation-log-reconciliation.md
git commit -m "fix: finalize mutation log reconciliation slice"
```

If no changes were required, do not create an empty commit.

- [ ] **Step 6: Prepare implementation summary**

Write this summary in the PR description or final handoff:

```md
## Summary

- committed sync now advances base state even while local transactions are persisting
- active transaction mutations continue to project over base for visible state
- source collection change events are emitted from visible-state transitions
- live-query collections receive unrelated synced source rows during pending optimistic mutations

## Validation

- pnpm --filter @tanstack/db test -- tests/collection.test.ts tests/collection-subscribe-changes.test.ts tests/query/live-query-collection.test.ts
- pnpm --filter @tanstack/db test
```

---

## Self-Review

### Spec coverage

- Immediate sync/base application: Tasks 1 and 5.
- Stable materialized change stream: Tasks 2, 5, and 6.
- Current APIs preserved: Tasks 5 and 8.
- No `accepted`/`observed`/transport lifecycle: Task 8 checks public diffs.
- Mutation log as indexed `PendingMutation`s, not operation state machine: Tasks 3-5.
- Patch replay deferred: Task 5 explicitly keeps `modified` projection.
- Offline/status/failure history deferred: Scope Check and Task 8 keep them out of Phase 1.

### Placeholder scan

No `TBD`, `TODO`, or unspecified implementation steps are intentionally left. If an implementer chooses the optional helper-file split, they must keep the same helper signatures from Task 3.

### Type consistency

The plan consistently uses existing `Transaction`, `PendingMutation`, `MutationFn`, `ChangeMessage`, `TOutput`, and `TKey` vocabulary. No independent operation status type is introduced.
