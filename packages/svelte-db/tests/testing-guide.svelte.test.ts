import { createCollection, eq, localOnlyCollectionOptions } from '@tanstack/db'
import { flushSync } from 'svelte'
import { expect, it, vi } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'

type Todo = { id: string; text: string; done: boolean }

function makeTodos() {
  return createCollection(
    localOnlyCollectionOptions<Todo>({
      getKey: (todo) => todo.id,
      initialData: [{ id: '1', text: 'Write a test', done: false }],
    }),
  )
}

it('removes completed todos from the Svelte query', async () => {
  const todos = makeTodos()
  let readTodos!: () => Array<Todo>
  const dispose = $effect.root(() => {
    const query = useLiveQuery((q) =>
      q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
    )
    readTodos = () => query.data
  })
  try {
    await vi.waitFor(() => {
      flushSync()
      expect(readTodos()).toMatchObject([{ id: '1' }])
    })
    const tx = todos.update('1', (draft) => {
      draft.done = true
    })
    await tx.isPersisted.promise
    await vi.waitFor(() => {
      flushSync()
      expect(readTodos()).toEqual([])
    })
  } finally {
    dispose()
    await todos.cleanup()
  }
})
