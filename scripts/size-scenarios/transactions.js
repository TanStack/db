// Optimistic mutations through an explicit transaction and an action.
import {
  createCollection,
  createOptimisticAction,
  createTransaction,
  localOnlyCollectionOptions,
} from '@tanstack/db'

const todos = createCollection(
  localOnlyCollectionOptions({ getKey: (todo) => todo.id }),
)
const tx = createTransaction({ mutationFn: async () => {} })
tx.mutate(() => todos.insert({ id: 1, done: false }))
const complete = createOptimisticAction({
  onMutate: (id) => todos.update(id, (draft) => (draft.done = true)),
  mutationFn: async () => {},
})
complete(1)
