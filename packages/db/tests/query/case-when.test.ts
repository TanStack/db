import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  caseWhen,
  count,
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

  test(`returns scalar variadic branch values`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          tier: caseWhen(
            gt(user.age, 25),
            `senior`,
            gt(user.age, 18),
            `adult`,
            `minor`,
          ),
          unmatched: caseWhen(
            eq(user.name, `Nobody`),
            `nobody`,
            eq(user.age, 99),
            `ancient`,
          ),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { id: 1, tier: `senior`, unmatched: null },
      { id: 2, tier: `minor`, unmatched: null },
      { id: 3, tier: `adult`, unmatched: null },
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

  test(`selects conditional projection objects with ref spreads`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          adultProfile: caseWhen(gt(user.age, 18), {
            ...user,
            label: `adult`,
          }),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      {
        id: 1,
        adultProfile: {
          id: 1,
          name: `Alice`,
          age: 30,
          active: true,
          label: `adult`,
        },
      },
      { id: 2, adultProfile: undefined },
      {
        id: 3,
        adultProfile: {
          id: 3,
          name: `Charlie`,
          age: 22,
          active: true,
          label: `adult`,
        },
      },
    ])
  })

  test(`works in groupBy and having expressions`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .groupBy(({ user }) =>
          caseWhen(eq(user.active, true), `active`, `inactive`),
        )
        .having(({ user }) => caseWhen(gt(count(user.id), 1), true, false))
        .select(({ user }) => ({
          status: caseWhen(eq(user.active, true), `active`, `inactive`),
          total: count(user.id),
        })),
    )

    await query.preload()

    expect(query.toArray.map((row) => stripVirtualPropsAndSymbols(row))).toEqual(
      [{ status: `active`, total: 2 }],
    )
  })

  test(`uses source alias refs as conditions after a left join`, async () => {
    const users = createCollection(
      mockSyncCollectionOptions<User>({
        id: `case-when-source-alias-users`,
        getKey: (user) => user.id,
        initialData: [
          { id: 1, name: `Alice`, age: 30, active: true },
          { id: 4, name: `Dana`, age: 16, active: false },
        ],
      }),
    )
    const posts = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `case-when-source-alias-posts`,
        getKey: (post) => post.id,
        initialData: [{ id: 1, userId: 1, title: `Alice post` }],
      }),
    )
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .join({ post: posts }, ({ user, post }) => eq(user.id, post.userId), `left`)
        .select(({ user, post }) => ({
          id: user.id,
          title: caseWhen(post, post.title, `none`),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { id: 1, title: `Alice post` },
      { id: 4, title: `none` },
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

  test(`materializes includes inside default conditional projection branches`, async () => {
    const users = createUsersCollection()
    const posts = createPostsCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          fallbackProfile: caseWhen(gt(user.age, 100), { kind: `ancient` }, {
            id: user.id,
            name: user.name,
            postTitles: toArray(
              q
                .from({ post: posts })
                .where(({ post }) => eq(post.userId, user.id))
                .orderBy(({ post }) => post.id)
                .select(({ post }) => post.title),
            ),
          }),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      {
        id: 1,
        fallbackProfile: {
          id: 1,
          name: `Alice`,
          postTitles: [`Alice post A`, `Alice post B`],
        },
      },
      {
        id: 2,
        fallbackProfile: {
          id: 2,
          name: `Bob`,
          postTitles: [`Bob post`],
        },
      },
      {
        id: 3,
        fallbackProfile: {
          id: 3,
          name: `Charlie`,
          postTitles: [`Charlie post`],
        },
      },
    ])
  })
})
