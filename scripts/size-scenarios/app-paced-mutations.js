// The typical app, plus debounced mutations through the React adapter.
import { debounceStrategy } from '@tanstack/db'
import { usePacedMutations } from '@tanstack/react-db'
import { todos } from './app.js'

export * from './app.js'

export function useRenameTodo() {
  return usePacedMutations({
    onMutate: ({ id, title }) =>
      todos.update(id, (draft) => {
        draft.title = title
      }),
    mutationFn: ({ transaction }) =>
      fetch(`/api/todos`, {
        method: `PATCH`,
        body: JSON.stringify(transaction.mutations.map((m) => m.modified)),
      }),
    strategy: debounceStrategy({ wait: 500 }),
  })
}
