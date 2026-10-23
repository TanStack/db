// Compiled by operator-typescript-modes.test.ts with noImplicitAny on and off.
import {
  createLiveQueryCollection,
  eq,
  groupKeys,
  innerJoin,
  joinOf,
  leftJoin,
} from '../../src/index.js'
import type { Collection, ContextFromSource } from '../../src/index.js'

type User = { id: number; name: string }
type Post = { id: number; userId: number; title: string }
declare const users: Collection<User, number>
declare const posts: Collection<Post, number>
declare const type: `left` | `inner`

export const joined = createLiveQueryCollection((q) =>
  q
    .from({ user: users })
    .join(
      leftJoin({ post: posts }, ({ user, post }) => eq(user.id, post.userId)),
    )
    .join(
      innerJoin({ again: posts }, ({ user, again }) =>
        eq(user.id, again.userId),
      ),
    )
    .join(
      joinOf(type, { third: posts }, ({ user, third }) =>
        eq(user.id, third.userId),
      ),
    )
    .select(({ user, post }) => ({ name: user.name, title: post.title })),
)

export const grouped = createLiveQueryCollection((q) =>
  q
    .from({ user: users })
    .groupBy(groupKeys(({ user }) => user.name))
    .select(({ user }) => ({ name: user.name })),
)

// A reusable operator built outside `.join()` passes its context explicitly.
type UserQuery = ContextFromSource<{ user: typeof users }>
export const withPosts = leftJoin<{ post: typeof posts }, UserQuery>(
  { post: posts },
  ({ user, post }) => eq(user.id, post.userId),
)
export const reused = createLiveQueryCollection((q) =>
  q
    .from({ user: users })
    .join(withPosts)
    .select(({ user, post }) => ({ name: user.name, title: post.title })),
)
