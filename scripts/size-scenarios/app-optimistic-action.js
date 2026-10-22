// The typical app, plus an optimistic action.
import { createOptimisticAction } from '@tanstack/db'
import { todos } from './app.js'

export * from './app.js'

export const completeTodo = createOptimisticAction({
  onMutate: (id) =>
    todos.update(id, (draft) => {
      draft.done = true
    }),
  mutationFn: (id) => fetch(`/api/todos/${id}/complete`, { method: `POST` }),
})
