import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  caseWhen,
  createLiveQueryCollection,
  eq,
  gt,
  toArray,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'

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

const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, age: 30, active: true },
  { id: 2, name: `Bob`, age: 17, active: false },
  { id: 3, name: `Charlie`, age: 22, active: true },
]

const samplePosts: Array<Post> = [
  { id: 1, userId: 1, title: `Alice post A` },
  { id: 2, userId: 1, title: `Alice post B` },
  { id: 3, userId: 2, title: `Bob post` },
  { id: 4, userId: 3, title: `Charlie post` },
]

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `case-when-users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
    }),
  )
}

function createPostsCollection() {
  return createCollection(
    mockSyncCollectionOptions<Post>({
      id: `case-when-posts`,
      getKey: (post) => post.id,
      initialData: samplePosts,
    }),
  )
}

function stripVirtualPropsAndSymbols(value: any): any {
  if (Array.isArray(value)) {
    return value.map((entry) => stripVirtualPropsAndSymbols(entry))
  }

  if (value && typeof value === `object`) {
    const out: Record<string, any> = {}
    for (const [key, entry] of Object.entries(stripVirtualProps(value))) {
      out[key] = stripVirtualPropsAndSymbols(entry)
    }
    return out
  }

  return value
}

describe(`caseWhen`, () => {
  test(`returns scalar branch values`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          category: caseWhen(gt(user.age, 18), `adult`, `minor`),
          maybeActive: caseWhen(eq(user.active, true), `active`),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { id: 1, category: `adult`, maybeActive: `active` },
      { id: 2, category: `minor`, maybeActive: null },
      { id: 3, category: `adult`, maybeActive: `active` },
    ])
  })

  test(`works in where and orderBy expressions`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .where(({ user }) => caseWhen(eq(user.active, true), true, false))
        .orderBy(({ user }) => caseWhen(eq(user.name, `Alice`), 0, user.age))
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
        })),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { id: 1, name: `Alice` },
      { id: 3, name: `Charlie` },
    ])
  })

  test(`selects conditional projection objects`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          adultProfile: caseWhen(gt(user.age, 18), {
            id: user.id,
            name: user.name,
            label: `adult`,
          }),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { id: 1, adultProfile: { id: 1, name: `Alice`, label: `adult` } },
      { id: 2, adultProfile: undefined },
      { id: 3, adultProfile: { id: 3, name: `Charlie`, label: `adult` } },
    ])
  })

  test(`materializes includes inside conditional projection branches`, async () => {
    const users = createUsersCollection()
    const posts = createPostsCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          profile: caseWhen(
            gt(user.age, 18),
            {
              id: user.id,
              name: user.name,
              label: `adult`,
              postTitles: toArray(
                q
                  .from({ post: posts })
                  .where(({ post }) => eq(post.userId, user.id))
                  .orderBy(({ post }) => post.id)
                  .select(({ post }) => post.title),
              ),
            },
            eq(user.name, `Bob`),
            {
              id: user.id,
              name: user.name,
              label: `minor`,
              postTitles: toArray(
                q
                  .from({ post: posts })
                  .where(({ post }) => eq(post.userId, user.id))
                  .orderBy(({ post }) => post.id)
                  .select(({ post }) => post.title),
              ),
            },
          ),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      {
        id: 1,
        profile: {
          id: 1,
          name: `Alice`,
          label: `adult`,
          postTitles: [`Alice post A`, `Alice post B`],
        },
      },
      {
        id: 2,
        profile: {
          id: 2,
          name: `Bob`,
          label: `minor`,
          postTitles: [`Bob post`],
        },
      },
      {
        id: 3,
        profile: {
          id: 3,
          name: `Charlie`,
          label: `adult`,
          postTitles: [`Charlie post`],
        },
      },
    ])
  })
})
