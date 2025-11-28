import { bench, describe } from "vitest"
import {
  Query,
  and,
  count,
  eq,
  getQueryFingerprint,
  gt,
  lt,
  or,
  sum,
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
  tags: Array<string>
  metadata: { source: string; version: number }
}

type User = {
  id: number
  name: string
  age: number
  email: string
}

const sampleTodos: Array<Todo> = [
  {
    id: 1,
    text: `Task 1`,
    completed: false,
    priority: 1,
    createdAt: new Date(`2024-01-01`),
    tags: [`work`, `urgent`],
    metadata: { source: `api`, version: 1 },
  },
]

const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, age: 25, email: `alice@example.com` },
]

const todosCollection = createCollection(
  mockSyncCollectionOptions<Todo>({
    id: `todos-bench`,
    getKey: (todo) => todo.id,
    initialData: sampleTodos,
  })
)

const usersCollection = createCollection(
  mockSyncCollectionOptions<User>({
    id: `users-bench`,
    getKey: (user) => user.id,
    initialData: sampleUsers,
  })
)

// Pre-build queries for benchmarking
const simpleQuery = new Query().from({ todos: todosCollection })

const simpleWhereQuery = new Query()
  .from({ todos: todosCollection })
  .where(({ todos }) => eq(todos.completed, false))

const complexWhereQuery = new Query()
  .from({ todos: todosCollection })
  .where(({ todos }) =>
    and(
      gt(todos.priority, 1),
      lt(todos.priority, 10),
      or(eq(todos.completed, false), eq(todos.text, `important`))
    )
  )

const selectQuery = new Query()
  .from({ todos: todosCollection })
  .select(({ todos }) => ({
    id: todos.id,
    text: todos.text,
    done: todos.completed,
    prio: todos.priority,
  }))

const orderByLimitQuery = new Query()
  .from({ todos: todosCollection })
  .where(({ todos }) => eq(todos.completed, false))
  .orderBy(({ todos }) => todos.priority, `desc`)
  .limit(10)
  .offset(5)

const joinQuery = new Query()
  .from({ todos: todosCollection })
  .join({ users: usersCollection }, ({ todos, users }) =>
    eq(todos.id, users.id)
  )
  .select(({ todos, users }) => ({
    todoId: todos.id,
    todoText: todos.text,
    userName: users.name,
  }))

const groupByQuery = new Query()
  .from({ todos: todosCollection })
  .groupBy(({ todos }) => todos.completed)
  .select(({ todos }) => ({
    completed: todos.completed,
    count: count(),
    totalPriority: sum(todos.priority),
  }))

const fullComplexQuery = new Query()
  .from({ todos: todosCollection })
  .join({ users: usersCollection }, ({ todos, users }) =>
    eq(todos.id, users.id)
  )
  .where(({ todos, users }) =>
    and(
      gt(todos.priority, 1),
      lt(users.age, 50),
      or(eq(todos.completed, false), eq(users.name, `Alice`))
    )
  )
  .select(({ todos, users }) => ({
    id: todos.id,
    text: todos.text,
    userName: users.name,
    userAge: users.age,
  }))
  .orderBy(({ todos }) => todos.priority, `desc`)
  .limit(20)
  .offset(0)

// Pre-compute QueryIRs
const simpleIR = getQueryIR(simpleQuery)
const simpleWhereIR = getQueryIR(simpleWhereQuery)
const complexWhereIR = getQueryIR(complexWhereQuery)
const selectIR = getQueryIR(selectQuery)
const orderByLimitIR = getQueryIR(orderByLimitQuery)
const joinIR = getQueryIR(joinQuery)
const groupByIR = getQueryIR(groupByQuery)
const fullComplexIR = getQueryIR(fullComplexQuery)

describe(`getQueryFingerprint performance`, () => {
  bench(`simple query (just from)`, () => {
    getQueryFingerprint(simpleIR)
  })

  bench(`simple where query`, () => {
    getQueryFingerprint(simpleWhereIR)
  })

  bench(`complex where query (nested and/or)`, () => {
    getQueryFingerprint(complexWhereIR)
  })

  bench(`select query (4 fields)`, () => {
    getQueryFingerprint(selectIR)
  })

  bench(`orderBy + limit + offset query`, () => {
    getQueryFingerprint(orderByLimitIR)
  })

  bench(`join query with select`, () => {
    getQueryFingerprint(joinIR)
  })

  bench(`groupBy query with aggregates`, () => {
    getQueryFingerprint(groupByIR)
  })

  bench(`full complex query (join + where + select + orderBy + limit)`, () => {
    getQueryFingerprint(fullComplexIR)
  })
})

describe(`end-to-end fingerprint (query build + IR extraction + fingerprint)`, () => {
  bench(`simple query e2e`, () => {
    const q = new Query().from({ todos: todosCollection })
    const ir = getQueryIR(q)
    getQueryFingerprint(ir)
  })

  bench(`complex query e2e`, () => {
    const q = new Query()
      .from({ todos: todosCollection })
      .where(({ todos }) =>
        and(gt(todos.priority, 1), eq(todos.completed, false))
      )
      .orderBy(({ todos }) => todos.priority, `desc`)
      .limit(10)
    const ir = getQueryIR(q)
    getQueryFingerprint(ir)
  })

  bench(`full complex query e2e`, () => {
    const q = new Query()
      .from({ todos: todosCollection })
      .join({ users: usersCollection }, ({ todos, users }) =>
        eq(todos.id, users.id)
      )
      .where(({ todos, users }) =>
        and(
          gt(todos.priority, 1),
          lt(users.age, 50),
          or(eq(todos.completed, false), eq(users.name, `Alice`))
        )
      )
      .select(({ todos, users }) => ({
        id: todos.id,
        text: todos.text,
        userName: users.name,
      }))
      .orderBy(({ todos }) => todos.priority, `desc`)
      .limit(20)
    const ir = getQueryIR(q)
    getQueryFingerprint(ir)
  })
})
