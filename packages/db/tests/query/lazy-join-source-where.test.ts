import { afterEach, describe, expect, it } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  not,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetOptions } from '../../src/types.js'

type TodoList = { id: number }
type Todo = { id: number; listId: number; assigneeId: number }
type User = { id: number; active: boolean }

const todoListRows: Array<TodoList> = [{ id: 1 }, { id: 2 }]
const todoRows: Array<Todo> = [
  { id: 1, listId: 1, assigneeId: 7 },
  { id: 2, listId: 1, assigneeId: 8 },
  { id: 3, listId: 2, assigneeId: 9 },
]
// Users 10 and 11 are assigned no todo: a keyed load must not ask for them.
const userRows: Array<User> = [
  { id: 7, active: true },
  { id: 8, active: false },
  { id: 9, active: true },
  { id: 10, active: true },
  { id: 11, active: true },
]

let sequence = 0
const cleanups: Array<() => void | Promise<void>> = []

function createEagerCollection<T extends { id: number }>(
  name: string,
  rows: Array<T>,
) {
  const collection = createCollection<T, number>({
    id: `lazy-join-where-${name}-${sequence++}`,
    getKey: (row) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) write({ type: `insert`, value: row })
        commit()
        markReady()
      },
    },
  })
  cleanups.push(() => collection.cleanup())
  return collection
}

// An on-demand source that serves every loadSubset from its full table, as
// a server would, and records the options each load receives.
function createOnDemandCollection<T extends { id: number }>(
  name: string,
  rows: Array<T>,
) {
  const loads: Array<LoadSubsetOptions> = []
  const collection = createCollection<T, number>({
    id: `lazy-join-where-${name}-${sequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loads.push(options)
            begin()
            for (const row of rows) {
              if (collection.has(row.id)) continue
              write({ type: `insert`, value: row })
            }
            commit()
            return Promise.resolve()
          },
        }
      },
    },
  })
  cleanups.push(() => collection.cleanup())
  return { collection, loads }
}

// Lazy demand is the only part of a load that names join keys, so a keyed
// load is one whose predicate mentions `id IN (...)`.
function describeLoad(options: LoadSubsetOptions): string {
  return JSON.stringify(options.where)
}

function hasKeyFilter(options: LoadSubsetOptions, keys: Array<number>) {
  const where = describeLoad(options)
  return where.includes(`"name":"in"`) && where.includes(JSON.stringify(keys))
}

describe(`lazy join source where`, () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  it(`include: a where on the lazy joined side keeps the join-key filter`, async () => {
    const todoLists = createEagerCollection(`todo-lists`, todoListRows)
    const todos = createEagerCollection(`todos`, todoRows)
    const { collection: users, loads } = createOnDemandCollection(
      `users`,
      userRows,
    )

    const live = createLiveQueryCollection((q) =>
      q.from({ list: todoLists }).select(({ list }) => ({
        id: list.id,
        todos: toArray(
          q
            .from({ todo: todos })
            .where(({ todo }) => eq(todo.listId, list.id))
            .innerJoin({ assignee: users }, ({ todo, assignee }) =>
              eq(todo.assigneeId, assignee.id),
            )
            .where(({ assignee }) => eq(assignee.active, true))
            .select(({ todo, assignee }) => ({
              id: todo.id,
              assignee: assignee.id,
            })),
        ),
      })),
    )
    cleanups.push(() => live.cleanup())
    await live.preload()
    await flushPromises()

    expect(loads.length).toBeGreaterThan(0)
    for (const load of loads) {
      expect(hasKeyFilter(load, [7, 8, 9]), describeLoad(load)).toBe(true)
    }
    expect(
      live.toArray
        .map((list) => ({
          id: list.id,
          assignees: [...list.todos].map((todo) => todo.assignee).sort(),
        }))
        .sort((a, b) => a.id - b.id),
    ).toEqual([
      { id: 1, assignees: [7] },
      { id: 2, assignees: [9] },
    ])
  })

  it(`include: a where on the parent-filtered side keeps the join-key filter`, async () => {
    const todoLists = createEagerCollection(`todo-lists`, todoListRows)
    const todos = createEagerCollection(`todos`, todoRows)
    const { collection: users, loads } = createOnDemandCollection(
      `users`,
      userRows,
    )

    const live = createLiveQueryCollection((q) =>
      q.from({ list: todoLists }).select(({ list }) => ({
        id: list.id,
        todos: toArray(
          q
            .from({ todo: todos })
            .where(({ todo }) => eq(todo.listId, list.id))
            .where(({ todo }) => not(eq(todo.assigneeId, 8)))
            .innerJoin({ assignee: users }, ({ todo, assignee }) =>
              eq(todo.assigneeId, assignee.id),
            )
            .select(({ todo, assignee }) => ({
              id: todo.id,
              assignee: assignee.id,
            })),
        ),
      })),
    )
    cleanups.push(() => live.cleanup())
    await live.preload()
    await flushPromises()

    expect(loads.length).toBeGreaterThan(0)
    for (const load of loads) {
      expect(hasKeyFilter(load, [7, 9]), describeLoad(load)).toBe(true)
    }
  })

  it(`leftJoin: a where on the lazy joined side keeps the join-key filter`, async () => {
    const todos = createEagerCollection(`todos`, todoRows)
    const { collection: users, loads } = createOnDemandCollection(
      `users`,
      userRows,
    )

    const live = createLiveQueryCollection((q) =>
      q
        .from({ todo: todos })
        .leftJoin({ assignee: users }, ({ todo, assignee }) =>
          eq(todo.assigneeId, assignee.id),
        )
        .where(({ assignee }) => eq(assignee.active, true))
        .select(({ todo, assignee }) => ({
          id: todo.id,
          assignee: assignee.id,
        })),
    )
    cleanups.push(() => live.cleanup())
    await live.preload()
    await flushPromises()

    expect(loads.length).toBeGreaterThan(0)
    for (const load of loads) {
      expect(hasKeyFilter(load, [7, 8, 9]), describeLoad(load)).toBe(true)
    }
  })

  // A joined subquery whose filter reads the parent is not a source filter:
  // it must stay routed by parent, so each list sees only its own team's
  // assignees.
  it(`include: a joined subquery that reads the parent row keeps its parent filter`, async () => {
    const todoLists = createEagerCollection(`team-todo-lists`, [
      { id: 1, team: `a` },
      { id: 2, team: `b` },
    ])
    const todos = createEagerCollection(`team-todos`, [
      { id: 1, listId: 1, assigneeId: 7 },
      { id: 2, listId: 1, assigneeId: 8 },
      { id: 3, listId: 2, assigneeId: 7 },
      { id: 4, listId: 2, assigneeId: 8 },
    ])
    const users = createEagerCollection(`team-users`, [
      { id: 7, team: `a` },
      { id: 8, team: `b` },
    ])

    const live = createLiveQueryCollection((q) =>
      q.from({ list: todoLists }).select(({ list }) => ({
        id: list.id,
        todos: toArray(
          q
            .from({ todo: todos })
            .where(({ todo }) => eq(todo.listId, list.id))
            .innerJoin(
              {
                assignee: q
                  .from({ assignee: users })
                  .where(({ assignee }) => eq(assignee.team, list.team)),
              },
              ({ todo, assignee }) => eq(todo.assigneeId, assignee.id),
            )
            .select(({ assignee }) => ({ id: assignee.id })),
        ),
      })),
    )
    cleanups.push(() => live.cleanup())
    await live.preload()

    expect(
      live.toArray
        .map((list) => ({
          id: list.id,
          assignees: [...list.todos].map((assignee) => assignee.id),
        }))
        .sort((a, b) => a.id - b.id),
    ).toEqual([
      { id: 1, assignees: [7] },
      { id: 2, assignees: [8] },
    ])
  })
})
