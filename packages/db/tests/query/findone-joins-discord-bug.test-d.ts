import { describe, expectTypeOf, test } from "vitest"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { createCollection } from "../../src/collection/index.js"
import { mockSyncCollectionOptions } from "../utils.js"

// Direct reproduction of the Discord bug report

type Todo = {
  id: string
  text: string
  order: number
}

type TodoOption = {
  id: string
  todoId: string
  optionText: string
}

const todoCollection = createCollection(
  mockSyncCollectionOptions<Todo>({
    id: `test-todos-discord-bug`,
    getKey: (todo) => todo.id,
    initialData: [],
  })
)

const todoOptionsCollection = createCollection(
  mockSyncCollectionOptions<TodoOption>({
    id: `test-todo-options-discord-bug`,
    getKey: (opt) => opt.id,
    initialData: [],
  })
)

describe(`Discord Bug: findOne() with joins`, () => {
  test(`findOne() after leftJoin should not have never type`, () => {
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: todoCollection })
          .where(({ todo }) => eq(todo.id, `test-id`))
          .orderBy(({ todo }) => todo.order, `asc`)
          .leftJoin(
            { todoOptions: todoOptionsCollection },
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId)
          )
          .findOne(),
    })

    // The key assertion: query.data should NOT be never
    // It should be the joined result or undefined
    type QueryData = typeof query.toArray
    type IsNever<T> = [T] extends [never] ? true : false
    type DataIsNever = IsNever<QueryData>

    // This will fail if QueryData is never
    expectTypeOf<DataIsNever>().toEqualTypeOf<false>()

    // Also verify the structure is correct
    expectTypeOf(query.toArray).not.toBeNever()
  })

  test(`limit(1) works as baseline (should not be never)`, () => {
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: todoCollection })
          .where(({ todo }) => eq(todo.id, `test-id`))
          .orderBy(({ todo }) => todo.order, `asc`)
          .leftJoin(
            { todoOptions: todoOptionsCollection },
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId)
          )
          .limit(1),
    })

    // This should work fine (baseline)
    expectTypeOf(query.toArray).not.toBeNever()
  })
})
