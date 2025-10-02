import { describe, expect, it } from "vitest"
import { createCollection } from "../../src/collection/index.js"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { createTransaction } from "../../src/transactions.js"

interface User {
  id: number
  name: string
}

interface Task {
  id: number
  userId: number
  title: string
}

describe(`live query scheduler`, () => {
  it(`runs the live query graph once per transaction that touches multiple collections`, async () => {
    const users = createCollection<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const tasks = createCollection<Task>({
      id: `test-tasks`,
      getKey: (task) => task.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const assignments = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: users })
          .join({ task: tasks }, ({ user, task }) => eq(user.id, task.userId))
          .select(({ user, task }) => ({
            userId: user.id,
            taskId: task?.id,
            title: task?.title,
          })),
    })

    await assignments.preload()

    const batches: Array<Array<{ type: string; value: any }>> = []
    const subscription = assignments.subscribeChanges((changes) => {
      batches.push(changes)
    })

    const transaction = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    transaction.mutate(() => {
      users.insert({ id: 1, name: `Alice` })
      tasks.insert({ id: 1, userId: 1, title: `Write tests` })
    })

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1)
    expect(batches[0]![0]).toMatchObject({
      type: `insert`,
      value: {
        userId: 1,
        taskId: 1,
        title: `Write tests`,
      },
    })

    subscription.unsubscribe()
    transaction.rollback()
  })
})
