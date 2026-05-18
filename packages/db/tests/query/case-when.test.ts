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

function childRows(collection: any): Array<any> {
  return [...collection.toArray].map((row) => stripVirtualPropsAndSymbols(row))
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

  test(`short-circuits scalar branches at the first matching condition`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          label: caseWhen(
            gt(user.age, 10),
            `first`,
            gt(user.age, 20),
            `second`,
            `fallback`,
          ),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { id: 1, label: `first` },
      { id: 2, label: `first` },
      { id: 3, label: `first` },
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
      { id: 2, adultProfile: null },
      { id: 3, adultProfile: { id: 3, name: `Charlie`, label: `adult` } },
    ])
  })

  test(`selects projection objects with type fields`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          profile: caseWhen(
            gt(user.age, 18),
            {
              type: `val`,
              label: user.name,
            },
            {
              type: `minor`,
              label: user.name,
            },
          ),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { id: 1, profile: { type: `val`, label: `Alice` } },
      { id: 2, profile: { type: `minor`, label: `Bob` } },
      { id: 3, profile: { type: `val`, label: `Charlie` } },
    ])
  })

  test(`selects null conditional projection branch values`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          nullableProfile: caseWhen(gt(user.age, 18), null, {
            id: user.id,
            label: `minor`,
          }),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { id: 1, nullableProfile: null },
      { id: 2, nullableProfile: { id: 2, label: `minor` } },
      { id: 3, nullableProfile: null },
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
      { id: 2, adultProfile: null },
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

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([{ status: `active`, total: 2 }])
  })

  test(`selects conditional projection objects with aggregates in grouped queries`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .groupBy(({ user }) => user.active)
        .select(({ user }) => ({
          active: user.active,
          profile: caseWhen(
            gt(count(user.id), 1),
            {
              kind: `many`,
              total: count(user.id),
            },
            {
              kind: `few`,
              total: count(user.id),
            },
          ),
        })),
    )

    await query.preload()

    const rows = query.toArray
      .map((row) => stripVirtualPropsAndSymbols(row))
      .sort((a, b) => Number(a.active) - Number(b.active))

    expect(rows).toEqual([
      { active: false, profile: { kind: `few`, total: 1 } },
      { active: true, profile: { kind: `many`, total: 2 } },
    ])
  })

  test(`uses grouped refs inside conditional aggregate projections`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .groupBy(({ user }) => user.active)
        .select(({ user }) => ({
          active: user.active,
          profile: caseWhen(
            eq(user.active, true),
            {
              kind: `active`,
              groupedActive: user.active,
              total: count(user.id),
            },
            {
              kind: `inactive`,
              groupedActive: user.active,
              total: count(user.id),
            },
          ),
        })),
    )

    await query.preload()

    const rows = query.toArray
      .map((row) => stripVirtualPropsAndSymbols(row))
      .sort((a, b) => Number(a.active) - Number(b.active))

    expect(rows).toEqual([
      {
        active: false,
        profile: { kind: `inactive`, groupedActive: false, total: 1 },
      },
      {
        active: true,
        profile: { kind: `active`, groupedActive: true, total: 2 },
      },
    ])
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
        .join(
          { post: posts },
          ({ user, post }) => eq(user.id, post.userId),
          `left`,
        )
        .select(({ user, post }) => ({
          id: user.id,
          title: caseWhen(post, post.title, `none`),
          postProfile: caseWhen(post, {
            title: post.title,
          }),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { id: 1, title: `Alice post`, postProfile: { title: `Alice post` } },
      { id: 4, title: `none`, postProfile: null },
    ])
  })

  test(`uses scalar caseWhen inside join conditions`, async () => {
    const users = createUsersCollection()
    const posts = createPostsCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .join(
          { post: posts },
          ({ user, post }) =>
            eq(caseWhen(eq(user.active, true), user.id, -1), post.userId),
          `inner`,
        )
        .select(({ user, post }) => ({
          userId: user.id,
          title: post.title,
        }))
        .orderBy(({ post }) => post.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { userId: 1, title: `Alice post A` },
      { userId: 1, title: `Alice post B` },
      { userId: 3, title: `Charlie post` },
    ])
  })

  test(`rejects projection caseWhen in expression contexts`, () => {
    const users = createUsersCollection()

    expect(() => caseWhen({ id: 1 } as any, `bad`)).toThrow(
      /caseWhen\(\) conditions must be expression-like values/,
    )

    expect(() => caseWhen([true] as any, `bad`)).toThrow(
      /caseWhen\(\) conditions must be expression-like values/,
    )

    expect(() =>
      createLiveQueryCollection((q) =>
        q.from({ user: users }).where(({ user }) =>
          caseWhen(gt(user.age, 18), {
            id: user.id,
          }),
        ),
      ),
    ).toThrow(/Invalid where\(\) expression/)

    expect(() =>
      createLiveQueryCollection((q) =>
        q.from({ user: users }).orderBy(({ user }) =>
          caseWhen(gt(user.age, 18), {
            id: user.id,
          }),
        ),
      ),
    ).toThrow(/caseWhen\(\) cannot be used inside expressions/)
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

  test(`materializes direct toArray includes inside conditional branches`, async () => {
    const users = createCollection(
      mockSyncCollectionOptions<User>({
        id: `case-when-direct-include-users`,
        getKey: (user) => user.id,
        initialData: [
          { id: 1, name: `Alice`, age: 30, active: true },
          { id: 2, name: `Bob`, age: 17, active: false },
          { id: 4, name: `Dana`, age: 42, active: true },
        ],
      }),
    )
    const posts = createPostsCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          postTitles: caseWhen(
            gt(user.age, 18),
            toArray(
              q
                .from({ post: posts })
                .where(({ post }) => eq(post.userId, user.id))
                .orderBy(({ post }) => post.id)
                .select(({ post }) => post.title),
            ),
          ),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(
      query.toArray.map((row) => stripVirtualPropsAndSymbols(row)),
    ).toEqual([
      { id: 1, postTitles: [`Alice post A`, `Alice post B`] },
      { id: 2, postTitles: undefined },
      { id: 4, postTitles: [] },
    ])
  })

  test(`materializes Collection includes inside conditional projection branches`, async () => {
    const users = createUsersCollection()
    const posts = createPostsCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => {
          const profile = {
            id: user.id,
            name: user.name,
            label: `adult`,
            posts: q
              .from({ post: posts })
              .where(({ post }) => eq(post.userId, user.id))
              .orderBy(({ post }) => post.id)
              .select(({ post }) => ({
                title: post.title,
              })),
          }

          return {
            id: user.id,
            profile: caseWhen(gt(user.age, 18), profile, `none`),
          }
        })
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    const alice = query.toArray[0]!
    const bob = query.toArray[1]!
    const charlie = query.toArray[2]!
    expect(alice.profile).not.toBe(`none`)
    expect(charlie.profile).not.toBe(`none`)
    if (alice.profile === `none` || charlie.profile === `none`) {
      throw new Error(`Expected adult profiles to be projected objects`)
    }
    expect({
      id: alice.profile.id,
      name: alice.profile.name,
      label: alice.profile.label,
    }).toEqual({
      id: 1,
      name: `Alice`,
      label: `adult`,
    })
    expect(childRows(alice.profile.posts)).toEqual([
      { title: `Alice post A` },
      { title: `Alice post B` },
    ])
    expect(bob.profile).toBe(`none`)
    expect({
      id: charlie.profile.id,
      name: charlie.profile.name,
      label: charlie.profile.label,
    }).toEqual({
      id: 3,
      name: `Charlie`,
      label: `adult`,
    })
    expect(childRows(charlie.profile.posts)).toEqual([
      { title: `Charlie post` },
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
          fallbackProfile: caseWhen(
            gt(user.age, 100),
            { kind: `ancient` },
            {
              id: user.id,
              name: user.name,
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
