// The common live query: a filter, an order, and a limit over one source.
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  localOnlyCollectionOptions,
} from '@tanstack/db'

const todos = createCollection(
  localOnlyCollectionOptions({ getKey: (todo) => todo.id }),
)
const open = createLiveQueryCollection((q) =>
  q
    .from({ todo: todos })
    .where(({ todo }) => eq(todo.done, false))
    .orderBy(({ todo }) => todo.createdAt)
    .limit(20),
)
console.log(open.toArray)
