import { describe, expect, it } from "vitest"
import { createCollection } from "../../src/collection/index.js"
import { createLiveQueryCollection } from "../../src/query/index.js"
import { createDeferred } from "../../src/deferred"

interface Todo {
  id: string
  createdAt: number
  completed: boolean
}

describe(`Live query with many queued optimistic updates`, () => {
  it(`keeps live query results aligned with collection state`, async () => {
    const pendingPersists: Array<ReturnType<typeof createDeferred<void>>> = []

    let syncBegin: (() => void) | undefined
    let syncWrite: ((change: { type: string; value: Todo }) => void) | undefined
    let syncCommit: (() => void) | undefined

    const todos = createCollection<Todo>({
      id: `queued-optimistic-updates`,
      getKey: (todo) => todo.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          syncBegin = begin
          syncWrite = (change) => write({ ...change })
          syncCommit = commit

          begin()
          ;[
            { id: `1`, createdAt: 1, completed: false },
            { id: `2`, createdAt: 2, completed: false },
            { id: `3`, createdAt: 3, completed: false },
            { id: `4`, createdAt: 4, completed: false },
            { id: `5`, createdAt: 5, completed: false },
          ].forEach((todo) =>
            write({
              type: `insert`,
              value: todo,
            })
          )
          commit()
          markReady()
        },
      },
      onUpdate: async ({ transaction }) => {
        const deferred = createDeferred<void>()
        pendingPersists.push(deferred)
        await deferred.promise

        syncBegin?.()
        transaction.mutations.forEach((mutation) => {
          syncWrite?.({
            type: mutation.type,
            value: mutation.modified,
          })
        })
        syncCommit?.()
      },
    })

    await todos.preload()

    const liveTodos = createLiveQueryCollection({
      query: (q) =>
        q.from({ todo: todos }).orderBy(({ todo }) => todo.createdAt, `desc`),
      startSync: true,
      getKey: (row) => (`todo` in row ? row.todo.id : (row as Todo).id),
    })

    await liveTodos.preload()

    const ensureConsistency = (id: string) => {
      const base = todos.get(id)
      const liveRow = liveTodos.get(id)
      const live =
        liveRow && `todo` in liveRow ? (liveRow as any).todo : liveRow
      expect(live?.completed).toBe(base?.completed)
    }

    const firstBatch = [`1`, `2`, `3`, `4`, `5`, `1`, `3`, `5`]
    const secondBatch = [`2`, `4`, `1`, `2`, `3`, `4`, `5`]

    for (const id of firstBatch) {
      todos.update(id, (draft) => {
        draft.completed = !draft.completed
      })

      await Promise.resolve()

      ensureConsistency(id)
    }

    // Simulate going back online: resolve a subset of pending persists
    const toResolveNow = pendingPersists.splice(0, 4)
    for (const deferred of toResolveNow) {
      deferred.resolve()
      await Promise.resolve()
    }

    for (const id of secondBatch) {
      todos.update(id, (draft) => {
        draft.completed = !draft.completed
      })

      await Promise.resolve()

      ensureConsistency(id)
    }

    // resolve pending persistence callbacks to avoid dangling promises
    pendingPersists.forEach((deferred) => deferred.resolve())
  })

  it(`should still emit optimistic changes while sync commit is in progress`, async () => {
    const todos = createCollection<Todo>({
      id: `commit-blocked`,
      getKey: (todo) => todo.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({
            type: `insert`,
            value: { id: `1`, createdAt: 1, completed: false },
          })
          commit()
          markReady()
        },
      },
      onUpdate: async () => {},
    })

    await todos.preload()

    const liveTodos = createLiveQueryCollection({
      query: (q) =>
        q.from({ todo: todos }).orderBy(({ todo }) => todo.createdAt, `desc`),
      startSync: true,
      getKey: (row) => (`todo` in row ? row.todo.id : (row as Todo).id),
    })

    await liveTodos.preload()

    const state = (todos as any)._state

    // Simulate long-running sync commit
    state.isCommittingSyncTransactions = true

    todos.update(`1`, (draft) => {
      draft.completed = true
    })

    const liveRow = liveTodos.get(`1`)
    const live = liveRow && `todo` in liveRow ? (liveRow as any).todo : liveRow

    expect(live?.completed).toBe(true)
  })
})
