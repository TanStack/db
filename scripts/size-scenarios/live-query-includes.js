// A live query whose rows include a child query.
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  localOnlyCollectionOptions,
  toArray,
} from '@tanstack/db'

const users = createCollection(
  localOnlyCollectionOptions({ getKey: (user) => user.id }),
)
const todos = createCollection(
  localOnlyCollectionOptions({ getKey: (todo) => todo.id }),
)
const withTodos = createLiveQueryCollection((q) =>
  q.from({ user: users }).select(({ user }) => ({
    name: user.name,
    todos: toArray(
      q.from({ todo: todos }).where(({ todo }) => eq(todo.userId, user.id)),
    ),
  })),
)
console.log(withTodos.toArray)
