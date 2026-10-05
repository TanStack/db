import { createCollection, eq, localOnlyCollectionOptions } from '@tanstack/db'
import { renderHook, waitFor } from '@solidjs/testing-library'
import { expect, it } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery'

type Todo = { id: string; text: string; done: boolean }

function makeTodos() {
  return createCollection(
    localOnlyCollectionOptions<Todo>({
      getKey: (todo) => todo.id,
      initialData: [{ id: '1', text: 'Write a test', done: false }],
    }),
  )
}

it('removes completed todos from the Solid query', async () => {
  const todos = makeTodos()
  const { result, cleanup } = renderHook(() =>
    useLiveQuery((q) =>
      q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
    ),
  )
  try {
    await waitFor(() => expect(result()).toMatchObject([{ id: '1' }]))
    const tx = todos.update('1', (draft) => {
      draft.done = true
    })
    await tx.isPersisted.promise
    await waitFor(() => expect(result()).toEqual([]))
  } finally {
    cleanup()
    await todos.cleanup()
  }
})
