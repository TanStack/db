import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  caseWhen,
  createLiveQueryCollection,
  eq,
  gt,
  toArray,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { OutputWithVirtual } from '../utils.js'

type User = {
  id: number
  name: string
  age: number
  active: boolean
}

type Post = {
  id: number
  userId: number
  title: string
}

type OutputWithVirtualKeyed<T extends object> = OutputWithVirtual<
  T,
  string | number
>

function createUsers() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `case-when-type-users`,
      getKey: (user) => user.id,
      initialData: [],
    }),
  )
}

function createPosts() {
  return createCollection(
    mockSyncCollectionOptions<Post>({
      id: `case-when-type-posts`,
      getKey: (post) => post.id,
      initialData: [],
    }),
  )
}

describe(`caseWhen types`, () => {
  test(`infers scalar branch values`, () => {
    const users = createUsers()
    const query = createLiveQueryCollection((q) =>
      q.from({ user: users }).select(({ user }) => ({
        id: user.id,
        category: caseWhen(gt(user.age, 18), `adult`, `minor`),
        maybeAdult: caseWhen(gt(user.age, 18), `adult`),
      })),
    )

    const result = query.toArray[0]!

    expectTypeOf(result).toMatchTypeOf<
      OutputWithVirtualKeyed<{
        id: number
        category: string
        maybeAdult: string | null
      }>
    >()
  })

  test(`infers scalar variadic branch values`, () => {
    const users = createUsers()
    const query = createLiveQueryCollection((q) =>
      q.from({ user: users }).select(({ user }) => ({
        id: user.id,
        withDefault: caseWhen(
          gt(user.age, 25),
          `senior`,
          gt(user.age, 18),
          `adult`,
          `minor`,
        ),
        withoutDefault: caseWhen(
          gt(user.age, 25),
          `senior`,
          gt(user.age, 18),
          `adult`,
        ),
      })),
    )

    const result = query.toArray[0]!

    expectTypeOf(result).toMatchTypeOf<
      OutputWithVirtualKeyed<{
        id: number
        withDefault: string
        withoutDefault: string | null
      }>
    >()
  })

  test(`infers conditional projection values`, () => {
    const users = createUsers()
    const query = createLiveQueryCollection((q) =>
      q.from({ user: users }).select(({ user }) => {
        const adultProfile = caseWhen(gt(user.age, 18), {
          id: user.id,
          name: user.name,
        })
        return {
          id: user.id,
          adultProfile,
        }
      }),
    )

    const result = query.toArray[0]!

    expectTypeOf(result).toMatchTypeOf<
      OutputWithVirtualKeyed<{
        id: number
        adultProfile:
          | {
              id: number
              name: string
            }
          | undefined
      }>
    >()
  })

  test(`infers includes inside conditional projection values`, () => {
    const users = createUsers()
    const posts = createPosts()
    const query = createLiveQueryCollection((q) =>
      q.from({ user: users }).select(({ user }) => ({
        id: user.id,
        adultProfile: caseWhen(gt(user.age, 18), {
          id: user.id,
          postTitles: toArray(
            q
              .from({ post: posts })
              .where(({ post }) => eq(post.userId, user.id))
              .select(({ post }) => post.title),
          ),
        }),
      })),
    )

    const result = query.toArray[0]!

    expectTypeOf(result).toMatchTypeOf<
      OutputWithVirtualKeyed<{
        id: number
        adultProfile:
          | {
              id: number
              postTitles: Array<string>
            }
          | undefined
      }>
    >()
  })

  test(`infers projection variadic branch values`, () => {
    const users = createUsers()
    const query = createLiveQueryCollection((q) =>
      q.from({ user: users }).select(({ user }) => ({
        id: user.id,
        profile: caseWhen(
          gt(user.age, 25),
          {
            kind: `senior`,
            id: user.id,
          },
          gt(user.age, 18),
          {
            kind: `adult`,
            name: user.name,
          },
          {
            kind: `minor`,
            active: user.active,
          },
        ),
        maybeProfile: caseWhen(
          gt(user.age, 25),
          {
            kind: `senior`,
            id: user.id,
          },
          gt(user.age, 18),
          {
            kind: `adult`,
            name: user.name,
          },
        ),
      })),
    )

    const result = query.toArray[0]!

    expectTypeOf(result).toMatchTypeOf<
      OutputWithVirtualKeyed<{
        id: number
        profile:
          | {
              kind: string
              id: number
            }
          | {
              kind: string
              name: string
            }
          | {
              kind: string
              active: boolean
            }
        maybeProfile:
          | {
              kind: string
              id: number
            }
          | {
              kind: string
              name: string
            }
          | undefined
      }>
    >()
  })

  test(`accepts source alias conditions`, () => {
    const users = createUsers()
    const posts = createPosts()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .join(
          { post: posts },
          ({ user, post }) => eq(user.id, post.userId),
          `left`,
        )
        .select(({ user, post }) => ({
          id: user.id,
          postStatus: caseWhen(post, `has-post`, `no-post`),
        })),
    )

    const result = query.toArray[0]!

    expectTypeOf(result).toMatchTypeOf<
      OutputWithVirtualKeyed<{
        id: number
        postStatus: string
      }>
    >()
  })
})
