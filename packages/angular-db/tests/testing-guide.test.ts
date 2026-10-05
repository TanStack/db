import { createCollection, eq, localOnlyCollectionOptions } from '@tanstack/db'
import { TestBed } from '@angular/core/testing'
import { expect, it, vi } from 'vitest'
import { injectLiveQuery } from '../src/index'

type Todo = { id: string; text: string; done: boolean }

function makeTodos() {
  return createCollection(
    localOnlyCollectionOptions<Todo>({
      getKey: (todo) => todo.id,
      initialData: [{ id: '1', text: 'Write a test', done: false }],
    }),
  )
}

it('removes completed todos from the Angular query', async () => {
  const todos = makeTodos()
  try {
    const query = TestBed.runInInjectionContext(() =>
      injectLiveQuery((q) =>
        q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
      ),
    )
    await vi.waitFor(() => expect(query.data()).toMatchObject([{ id: '1' }]))
    const tx = todos.update('1', (draft) => {
      draft.done = true
    })
    await tx.isPersisted.promise
    await vi.waitFor(() => expect(query.data()).toEqual([]))
  } finally {
    TestBed.resetTestingModule()
    await todos.cleanup()
  }
})
