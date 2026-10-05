import { createCollection, eq, localOnlyCollectionOptions } from '@tanstack/db'
import { act, renderHook, waitFor } from '@testing-library/react'
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

// Runnable companion to docs/guides/testing.md. This uses the same source imports as the framework suite.
it('removes completed todos from the React query', async () => {
  const todos = makeTodos()
  const { result, unmount } = renderHook(() =>
    useLiveQuery((q) =>
      q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
    ),
  )
  try {
    await waitFor(() =>
      expect(result.current.data).toMatchObject([{ id: '1' }]),
    )
    await act(async () => {
      const tx = todos.update('1', (draft) => {
        draft.done = true
      })
      await tx.isPersisted.promise
    })
    await waitFor(() => expect(result.current.data).toEqual([]))
  } finally {
    unmount()
    await todos.cleanup()
  }
})
