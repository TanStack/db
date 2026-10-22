// A Collection with local writes and a change subscription, and no queries.
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'

const todos = createCollection(
  localOnlyCollectionOptions({ getKey: (todo) => todo.id }),
)
todos.subscribeChanges((changes) => console.log(changes))
todos.insert({ id: 1, done: false })
todos.update(1, (draft) => {
  draft.done = true
})
todos.delete(1)
