// A live query that joins two sources.
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  localOnlyCollectionOptions,
} from '@tanstack/db'

const todos = createCollection(
  localOnlyCollectionOptions({ getKey: (todo) => todo.id }),
)
const users = createCollection(
  localOnlyCollectionOptions({ getKey: (user) => user.id }),
)
const assigned = createLiveQueryCollection((q) =>
  q
    .from({ todo: todos })
    .join({ user: users }, ({ todo, user }) => eq(todo.userId, user.id))
    .select(({ todo, user }) => ({ title: todo.title, owner: user.name })),
)
console.log(assigned.toArray)
