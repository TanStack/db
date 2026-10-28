// Compiled by group-keys-typescript-modes.test.ts with noImplicitAny on and off.
import { createLiveQueryCollection, groupKeys } from '../../src/index.js'
import type { Collection, ContextFromSource } from '../../src/index.js'

type User = { id: number; name: string }
declare const users: Collection<User, number>

export const grouped = createLiveQueryCollection((q) =>
  q
    .from({ user: users })
    .groupBy(groupKeys(({ user }) => user.name))
    .select(({ user }) => ({ name: user.name })),
)

// Group keys built outside `.groupBy()` pass the context explicitly.
type UserQuery = ContextFromSource<{ user: typeof users }>
export const nameKeys = groupKeys<UserQuery>(({ user }) => user.name)
export const regrouped = createLiveQueryCollection((q) =>
  q
    .from({ user: users })
    .groupBy(nameKeys)
    .select(({ user }) => ({ name: user.name })),
)
