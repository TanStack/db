import { describe, expect, it } from "vitest"
import { createCollection } from "../../src/collection/index.js"
import { createLiveQueryCollection } from "../../src/query/index.js"
import { createDeferred } from "../../src/deferred"

type Todo = {
  id: number
  title: string
  completed: boolean
  createdAt: number
}

describe(`live query with long persisting optimistic mutations`, () => {
  it(`keeps live query inserts in sync with collection state`, async () => {
    const pendingPersists: Array<ReturnType<typeof createDeferred<void>>> = []

    const todoCollection = createCollection<Todo>({
      id: `todos-offline-test`,
      getKey: (todo) => todo.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      onInsert: async () => {
        const deferred = createDeferred<void>()
        pendingPersists.push(deferred)
        await deferred.promise
      },
    })

    await todoCollection.preload()

    const liveTodoCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: todoCollection })
          .orderBy(({ todo }) => todo.createdAt, `asc`),
      getKey: (row) => (`todo` in row ? row.todo.id : (row as Todo).id),
    })

    await liveTodoCollection.preload()

    const expectConsistency = (id: number) => {
      const base = todoCollection.get(id)
      const liveRow = liveTodoCollection.get(id)
      const live = (
        liveRow && `todo` in liveRow
          ? liveRow.todo
          : (liveRow as Todo | undefined)
      ) as Todo | undefined
      expect(base).toBeDefined()
      expect(live).toBeDefined()
      expect(live?.title).toBe(base?.title)
      expect(live?.completed).toBe(base?.completed)
    }

    const insertCount = 12

    for (let i = 0; i < insertCount; i++) {
      todoCollection.insert({
        id: i + 1,
        title: `item-${i}`,
        completed: false,
        createdAt: i,
      })

      await Promise.resolve()

      expect(todoCollection.size).toBe(i + 1)
      expect(liveTodoCollection.size).toBe(i + 1)
      expectConsistency(i + 1)
    }

    // Resolve persists to avoid dangling promises
    pendingPersists.forEach((deferred) => deferred.resolve())
  })
})
