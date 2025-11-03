import { describe, expectTypeOf, test } from "vitest"
import { createLiveQueryCollection, eq } from "../../src/query/index.js"
import { createCollection } from "../../src/collection/index.js"
import { mockSyncCollectionOptions } from "../utils.js"

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
    id: `test-todos-findone-joins`,
    getKey: (todo) => todo.id,
    initialData: [],
  })
)

const todoOptionsCollection = createCollection(
  mockSyncCollectionOptions<TodoOption>({
    id: `test-todo-options-findone-joins`,
    getKey: (opt) => opt.id,
    initialData: [],
  })
)

describe(`findOne() with joins`, () => {
  test(`findOne() after leftJoin should infer correct types`, () => {
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

    // Verify query result is properly typed (not never)
    type QueryData = typeof query.toArray
    type IsNever<T> = [T] extends [never] ? true : false
    type DataIsNever = IsNever<QueryData>

    expectTypeOf<DataIsNever>().toEqualTypeOf<false>()
    expectTypeOf(query.toArray).not.toBeNever()
  })

  test(`limit(1) should infer array type`, () => {
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

    // Verify query result is properly typed as array
    expectTypeOf(query.toArray).not.toBeNever()
  })
})
