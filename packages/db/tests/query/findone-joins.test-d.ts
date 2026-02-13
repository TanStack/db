import { describe, expectTypeOf, test } from 'vitest'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { OutputWithVirtual } from '../utils.js'

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

type OutputWithVirtualKeyed<T extends object> = OutputWithVirtual<
  T,
  string | number
>

const todoCollection = createCollection(
  mockSyncCollectionOptions<Todo>({
    id: `test-todos-findone-joins`,
    getKey: (todo) => todo.id,
    initialData: [],
  }),
)

const todoOptionsCollection = createCollection(
  mockSyncCollectionOptions<TodoOption>({
    id: `test-todo-options-findone-joins`,
    getKey: (opt) => opt.id,
    initialData: [],
  }),
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
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId),
          )
          .findOne(),
    })

    expectTypeOf(query.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtualKeyed<{
          todo: OutputWithVirtualKeyed<Todo>
          todoOptions: OutputWithVirtualKeyed<TodoOption> | undefined
        }>
      >
    >()
  })

  test(`findOne() with innerJoin should infer correct types`, () => {
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: todoCollection })
          .where(({ todo }) => eq(todo.id, `test-id`))
          .innerJoin(
            { todoOptions: todoOptionsCollection },
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId),
          )
          .findOne(),
    })

    expectTypeOf(query.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtualKeyed<{
          todo: OutputWithVirtualKeyed<Todo>
          todoOptions: OutputWithVirtualKeyed<TodoOption>
        }>
      >
    >()
  })

  test(`findOne() before join should infer correct types`, () => {
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: todoCollection })
          .where(({ todo }) => eq(todo.id, `test-id`))
          .findOne()
          .leftJoin(
            { todoOptions: todoOptionsCollection },
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId),
          ),
    })

    expectTypeOf(query.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtualKeyed<{
          todo: OutputWithVirtualKeyed<Todo>
          todoOptions: OutputWithVirtualKeyed<TodoOption> | undefined
        }>
      >
    >()
  })

  test(`findOne() with rightJoin should infer correct types`, () => {
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: todoCollection })
          .where(({ todo }) => eq(todo.id, `test-id`))
          .rightJoin(
            { todoOptions: todoOptionsCollection },
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId),
          )
          .findOne(),
    })

    expectTypeOf(query.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtualKeyed<{
          todo: OutputWithVirtualKeyed<Todo> | undefined
          todoOptions: OutputWithVirtualKeyed<TodoOption>
        }>
      >
    >()
  })

  test(`findOne() with fullJoin should infer correct types`, () => {
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: todoCollection })
          .where(({ todo }) => eq(todo.id, `test-id`))
          .fullJoin(
            { todoOptions: todoOptionsCollection },
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId),
          )
          .findOne(),
    })

    expectTypeOf(query.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtualKeyed<{
          todo: OutputWithVirtualKeyed<Todo> | undefined
          todoOptions: OutputWithVirtualKeyed<TodoOption> | undefined
        }>
      >
    >()
  })

  test(`findOne() with multiple joins should infer correct types`, () => {
    type TodoTag = {
      id: string
      todoId: string
      tag: string
    }

    const todoTagsCollection = createCollection(
      mockSyncCollectionOptions<TodoTag>({
        id: `test-todo-tags-findone-multi`,
        getKey: (tag) => tag.id,
        initialData: [],
      }),
    )

    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: todoCollection })
          .leftJoin(
            { todoOptions: todoOptionsCollection },
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId),
          )
          .innerJoin({ tag: todoTagsCollection }, ({ todo, tag }) =>
            eq(todo.id, tag.todoId),
          )
          .findOne(),
    })

    expectTypeOf(query.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtualKeyed<{
          todo: OutputWithVirtualKeyed<Todo>
          todoOptions: OutputWithVirtualKeyed<TodoOption> | undefined
          tag: OutputWithVirtualKeyed<TodoTag>
        }>
      >
    >()
  })

  test(`findOne() with select() and joins should infer correct types`, () => {
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: todoCollection })
          .leftJoin(
            { todoOptions: todoOptionsCollection },
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId),
          )
          .select(({ todo, todoOptions }) => ({
            todoText: todo.text,
            optionText: todoOptions?.optionText,
          }))
          .findOne(),
    })

    expectTypeOf(query.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtualKeyed<{
          todoText: string
          optionText: string | undefined
        }>
      >
    >()
  })

  test(`findOne() before select() with joins should infer correct types`, () => {
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ todo: todoCollection })
          .leftJoin(
            { todoOptions: todoOptionsCollection },
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId),
          )
          .findOne()
          .select(({ todo, todoOptions }) => ({
            todoText: todo.text,
            optionText: todoOptions?.optionText,
          })),
    })

    expectTypeOf(query.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtualKeyed<{
          todoText: string
          optionText: string | undefined
        }>
      >
    >()
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
            ({ todo, todoOptions }) => eq(todo.id, todoOptions.todoId),
          )
          .limit(1),
    })

    expectTypeOf(query.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtualKeyed<{
          todo: OutputWithVirtualKeyed<Todo>
          todoOptions: OutputWithVirtualKeyed<TodoOption> | undefined
        }>
      >
    >()
  })
})
