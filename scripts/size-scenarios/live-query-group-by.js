// A live query that groups and aggregates.
import {
  count,
  createCollection,
  createLiveQueryCollection,
  localOnlyCollectionOptions,
} from '@tanstack/db'

const todos = createCollection(
  localOnlyCollectionOptions({ getKey: (todo) => todo.id }),
)
const perUser = createLiveQueryCollection((q) =>
  q
    .from({ todo: todos })
    .groupBy(({ todo }) => todo.userId)
    .select(({ todo }) => ({ userId: todo.userId, total: count(todo.id) })),
)
console.log(perUser.toArray)
