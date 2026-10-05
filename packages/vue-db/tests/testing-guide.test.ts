import { createCollection, eq, localOnlyCollectionOptions } from '@tanstack/db'
import { effectScope, nextTick } from 'vue'
import { expect, it, vi } from 'vitest'
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

it('removes completed todos from the Vue query', async () => {
  const todos = makeTodos()
  const scope = effectScope()
  try {
    const query = scope.run(() =>
      useLiveQuery((q) =>
        q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
      ),
    )!
    await vi.waitFor(async () => {
      await nextTick()
      expect(query.data.value).toMatchObject([{ id: '1' }])
    })
    const tx = todos.update('1', (draft) => {
      draft.done = true
    })
    await tx.isPersisted.promise
    await vi.waitFor(async () => {
      await nextTick()
      expect(query.data.value).toEqual([])
    })
  } finally {
    scope.stop()
    await todos.cleanup()
  }
})
