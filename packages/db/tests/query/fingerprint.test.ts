import { beforeEach, describe, expect, test } from "vitest"
import {
  Query,
  and,
  eq,
  getQueryFingerprint,
  gt,
  lt,
  or,
} from "../../src/query/index.js"
import { getQueryIR } from "../../src/query/builder/index.js"
import { createCollection } from "../../src/collection/index.js"
import { mockSyncCollectionOptions } from "../utils.js"

type Todo = {
  id: number
  text: string
  completed: boolean
  priority: number
  createdAt: Date
}

type User = {
  id: number
  name: string
  age: number
}

const sampleTodos: Array<Todo> = [
  {
    id: 1,
    text: `Task 1`,
    completed: false,
    priority: 1,
    createdAt: new Date(`2024-01-01`),
  },
  {
    id: 2,
    text: `Task 2`,
    completed: true,
    priority: 2,
    createdAt: new Date(`2024-01-02`),
  },
]

const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, age: 25 },
  { id: 2, name: `Bob`, age: 30 },
]

function createTodosCollection() {
  return createCollection(
    mockSyncCollectionOptions<Todo>({
      id: `todos`,
      getKey: (todo) => todo.id,
      initialData: sampleTodos,
    })
  )
}

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
    })
  )
}

describe(`getQueryFingerprint`, () => {
  let todosCollection: ReturnType<typeof createTodosCollection>
  let usersCollection: ReturnType<typeof createUsersCollection>

  beforeEach(() => {
    todosCollection = createTodosCollection()
    usersCollection = createUsersCollection()
  })

  test(`same query produces same fingerprint`, () => {
    const query1 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))

    const query2 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).toBe(fp2)
  })

  test(`different where values produce different fingerprints`, () => {
    const query1 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.priority, 1))

    const query2 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.priority, 2))

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`different operators produce different fingerprints`, () => {
    const query1 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => gt(todos.priority, 5))

    const query2 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => lt(todos.priority, 5))

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`different collections produce different fingerprints`, () => {
    const query1 = new Query().from({ todos: todosCollection })

    const query2 = new Query().from({ users: usersCollection })

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`different limit values produce different fingerprints`, () => {
    const query1 = new Query().from({ todos: todosCollection }).limit(10)

    const query2 = new Query().from({ todos: todosCollection }).limit(20)

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`different offset values produce different fingerprints`, () => {
    const query1 = new Query().from({ todos: todosCollection }).offset(0)

    const query2 = new Query().from({ todos: todosCollection }).offset(10)

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`different order by produce different fingerprints`, () => {
    const query1 = new Query()
      .from({ todos: todosCollection })
      .orderBy(({ todos }) => todos.priority, `asc`)

    const query2 = new Query()
      .from({ todos: todosCollection })
      .orderBy(({ todos }) => todos.priority, `desc`)

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`different select fields produce different fingerprints`, () => {
    const query1 = new Query()
      .from({ todos: todosCollection })
      .select(({ todos }) => ({ id: todos.id }))

    const query2 = new Query()
      .from({ todos: todosCollection })
      .select(({ todos }) => ({ id: todos.id, text: todos.text }))

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`compound where clauses produce different fingerprints when values change`, () => {
    const query1 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) =>
        and(gt(todos.priority, 1), eq(todos.completed, false))
      )

    const query2 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) =>
        and(gt(todos.priority, 2), eq(todos.completed, false))
      )

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`handles Date values correctly`, () => {
    const date1 = new Date(`2024-01-01`)
    const date2 = new Date(`2024-01-02`)

    const query1 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => gt(todos.createdAt, date1))

    const query2 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => gt(todos.createdAt, date2))

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`same Date values produce same fingerprint`, () => {
    const date1 = new Date(`2024-01-01`)
    const date2 = new Date(`2024-01-01`)

    const query1 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => gt(todos.createdAt, date1))

    const query2 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => gt(todos.createdAt, date2))

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).toBe(fp2)
  })

  test(`handles array values in inArray-style predicates`, () => {
    const query1 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => or(eq(todos.priority, 1), eq(todos.priority, 2)))

    const query2 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => or(eq(todos.priority, 1), eq(todos.priority, 3)))

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`handles null and undefined values`, () => {
    const query1 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.text, null as any))

    const query2 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.text, undefined as any))

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`handles boolean values`, () => {
    const query1 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, true))

    const query2 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`handles string values`, () => {
    const query1 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.text, `hello`))

    const query2 = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.text, `world`))

    const fp1 = getQueryFingerprint(getQueryIR(query1))
    const fp2 = getQueryFingerprint(getQueryIR(query2))

    expect(fp1).not.toBe(fp2)
  })

  test(`fingerprint is deterministic across multiple calls`, () => {
    const makeQuery = () =>
      new Query()
        .from({ todos: todosCollection })
        .where(({ todos }) =>
          and(gt(todos.priority, 5), eq(todos.completed, false))
        )
        .orderBy(({ todos }) => todos.createdAt, `desc`)
        .limit(10)

    const fingerprints = Array.from({ length: 10 }, () =>
      getQueryFingerprint(getQueryIR(makeQuery()))
    )

    // All fingerprints should be identical
    expect(new Set(fingerprints).size).toBe(1)
  })
})
