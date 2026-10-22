// An Effect that reacts to a live query's changes.
import {
  createCollection,
  createEffect,
  localOnlyCollectionOptions,
} from '@tanstack/db'

const todos = createCollection(
  localOnlyCollectionOptions({ getKey: (todo) => todo.id }),
)
createEffect({
  query: (q) => q.from({ todo: todos }),
  onBatch: (batch) => console.log(batch),
})
