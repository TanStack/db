import { describe, expect, it } from 'vitest'
import { CollectionImpl } from '../../src/collection/index.js'
import { Query, getQueryIR } from '../../src/query/builder/index.js'
import {
  add,
  and,
  avg,
  caseWhen,
  coalesce,
  concat,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  isUndefined,
  length,
  like,
  lower,
  max,
  not,
  or,
  sum,
  upper,
} from '../../src/query/builder/functions.js'
import {
  UnhashableQueryIRError,
  getStableQueryIRHash,
} from '../../src/query/ir-stable-identity.js'
import type { QueryIR } from '../../src/query/ir.js'

interface User {
  id: number
  name: string
  email?: string | null
  active: boolean
  age: number
  salary: number
  status: `active` | `inactive`
  teamId: string
  departmentId: number | null
  createdAt: Date
  profile?: {
    skills: Array<string>
    experience: {
      years: number
    }
  }
  blob?: Uint8Array
  largeViewCount?: bigint
}

interface Post {
  id: number
  userId: number
  title: string
  published: boolean
  views: number
  createdAt: Date
}

const usersCollection = new CollectionImpl<User>({
  id: `users`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

const postsCollection = new CollectionImpl<Post>({
  id: `posts`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

const structuredQueries: Array<[string, () => QueryIR]> = [
  [
    `basic collection source`,
    () => getQueryIR(new Query().from({ user: usersCollection })),
  ],
  [
    `captured primitive where value`,
    () => {
      const status = `active` as const
      return getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.status, status)),
      )
    },
  ],
  [
    `boolean expression tree`,
    () =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .where(({ user }) =>
            and(
              eq(user.active, true),
              or(gt(user.age, 30), not(isNull(user.email))),
            ),
          ),
      ),
  ],
  [
    `array membership and undefined checks`,
    () =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .where(({ user }) =>
            and(
              inArray(user.teamId, [`eng`, `design`]),
              not(isUndefined(user.profile)),
            ),
          ),
      ),
  ],
  [
    `date bigint and typed array values`,
    () =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .where(({ user }) =>
            and(
              gte(user.createdAt, new Date(`2024-01-01T00:00:00.000Z`)),
              gt(user.largeViewCount, 9007199254740993n),
              eq(user.blob, new Uint8Array([1, 2, 3])),
            ),
          ),
      ),
  ],
  [
    `plain object values`,
    () =>
      getQueryIR(
        new Query().from({ user: usersCollection }).where(({ user }) =>
          eq(user.profile, {
            experience: { years: 5 },
            skills: [`ts`, `db`],
          }),
        ),
      ),
  ],
  [
    `nested select and computed expressions`,
    () =>
      getQueryIR(
        new Query().from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          displayName: concat(upper(user.name), ` <`, lower(user.email), `>`),
          score: add(user.salary, 1000),
          fallbackEmail: coalesce(user.email, `missing@example.com`),
          meta: {
            active: user.active,
            nameLength: length(user.name),
          },
        })),
      ),
  ],
  [
    `conditional projection select`,
    () =>
      getQueryIR(
        new Query().from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          profile: caseWhen(
            gt(user.age, 18),
            {
              label: `adult`,
              email: user.email,
            },
            {
              label: `minor`,
              email: null,
            },
          ),
        })),
      ),
  ],
  [
    `top-level alias spread select`,
    () =>
      getQueryIR(
        new Query().from({ user: usersCollection }).select(({ user }) => user),
      ),
  ],
  [
    `locale orderBy options`,
    () =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .orderBy(({ user }) => user.name, {
            direction: `asc`,
            nulls: `last`,
            stringSort: `locale`,
            locale: `en-US`,
            localeOptions: { sensitivity: `base`, numeric: true },
          }),
      ),
  ],
  [
    `groupBy aggregates and selected orderBy`,
    () =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .groupBy(({ user }) => user.teamId)
          .select(({ user }) => ({
            teamId: user.teamId,
            userCount: count(user.id),
            avgAge: avg(user.age),
            totalSalary: sum(user.salary),
            latestSignup: max(user.createdAt),
          }))
          .having(({ $selected }) => gt($selected.userCount, 1))
          .orderBy(({ $selected }) => $selected.avgAge, `desc`),
      ),
  ],
  [
    `join query`,
    () =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .join(
            { post: postsCollection },
            ({ user, post }) => eq(user.id, post.userId),
            `left`,
          )
          .where(({ post }) => eq(post.published, true))
          .select(({ user, post }) => ({
            userId: user.id,
            postTitle: post.title,
          })),
      ),
  ],
  [
    `subquery join`,
    () =>
      getQueryIR(
        new Query()
          .from({
            post: new Query()
              .from({ post: postsCollection })
              .where(({ post }) => gt(post.views, 100)),
          })
          .join(
            {
              activeUser: new Query()
                .from({ user: usersCollection })
                .where(({ user }) => eq(user.status, `active`)),
            },
            ({ post, activeUser }) => eq(post.userId, activeUser.id),
            `inner`,
          ),
      ),
  ],
  [
    `unioned source object`,
    () =>
      getQueryIR(
        new Query().unionAll({ user: usersCollection, post: postsCollection }),
      ),
  ],
  [
    `unioned query branches`,
    () =>
      getQueryIR(
        new Query().unionAll(
          new Query().from({ user: usersCollection }).select(({ user }) => ({
            id: user.id,
            label: user.name,
          })),
          new Query().from({ post: postsCollection }).select(({ post }) => ({
            id: post.id,
            label: post.title,
          })),
        ),
      ),
  ],
  [
    `includes subquery`,
    () =>
      getQueryIR(
        new Query().from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          posts: new Query()
            .from({ post: postsCollection })
            .where(({ post }) => eq(post.userId, user.id))
            .select(({ post }) => ({
              id: post.id,
              title: post.title,
            })),
        })),
      ),
  ],
  [
    `pagination shape`,
    () =>
      getQueryIR(
        new Query()
          .from({ post: postsCollection })
          .where(({ post }) => like(post.title, `%db%`))
          .orderBy(({ post }) => post.createdAt, `desc`)
          .offset(20)
          .limit(10),
      ),
  ],
]

describe(`stable QueryIR identity smoke test`, () => {
  it(`can derive identity for representative structured query shapes`, () => {
    expect(structuredQueries).toHaveLength(17)

    const hashes = structuredQueries.map(([name, createQuery]) => {
      const hash = getStableQueryIRHash(createQuery())
      expect(hash, name).toContain(`"type":"query"`)
      expect(() => JSON.parse(hash), name).not.toThrow()
      return hash
    })

    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it(`does not depend on collection object identity when ids match`, () => {
    const otherUsersCollection = new CollectionImpl<User>({
      id: `users`,
      getKey: (item) => item.id,
      sync: { sync: () => {} },
    })

    const createQuery = (collection: CollectionImpl<User>) =>
      getQueryIR(
        new Query()
          .from({ user: collection })
          .where(({ user }) => eq(user.status, `active`)),
      )

    expect(getStableQueryIRHash(createQuery(usersCollection))).toBe(
      getStableQueryIRHash(createQuery(otherUsersCollection)),
    )
  })

  it(`changes identity when captured structured values change`, () => {
    const createQuery = (status: User[`status`]) =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.status, status)),
      )

    expect(getStableQueryIRHash(createQuery(`active`))).not.toBe(
      getStableQueryIRHash(createQuery(`inactive`)),
    )
  })

  it(`normalizes object property ordering inside values`, () => {
    const left = getQueryIR(
      new Query().from({ user: usersCollection }).where(({ user }) =>
        eq(user.profile, {
          skills: [`ts`, `db`],
          experience: { years: 5 },
        }),
      ),
    )

    const right = getQueryIR(
      new Query().from({ user: usersCollection }).where(({ user }) =>
        eq(user.profile, {
          experience: { years: 5 },
          skills: [`ts`, `db`],
        }),
      ),
    )

    expect(getStableQueryIRHash(left)).toBe(getStableQueryIRHash(right))
  })

  it(`rejects functional query variants`, () => {
    const queries = [
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .fn.where(({ user }) => user.active),
      ),
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .fn.select(({ user }) => ({ id: user.id })),
      ),
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .groupBy(({ user }) => user.teamId)
          .select(({ user }) => ({
            teamId: user.teamId,
            userCount: count(user.id),
          }))
          .fn.having(({ $selected }) => $selected.userCount > 1),
      ),
    ]

    for (const query of queries) {
      expect(() => getStableQueryIRHash(query)).toThrow(UnhashableQueryIRError)
    }
  })

  it(`rejects opaque runtime values inside otherwise structured expressions`, () => {
    const circularValue: Record<string, unknown> = {}
    circularValue.self = circularValue

    class OpaqueValue {
      value = `Tanner`
    }

    const queries = [
      [
        `function value`,
        getQueryIR(
          new Query()
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.name, (() => `Tanner`) as never)),
        ),
        /function value/,
      ],
      [
        `symbol value`,
        getQueryIR(
          new Query()
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.name, Symbol(`name`) as never)),
        ),
        /symbol value/,
      ],
      [
        `circular value`,
        getQueryIR(
          new Query()
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.profile, circularValue as never)),
        ),
        /circular value/,
      ],
      [
        `invalid date`,
        getQueryIR(
          new Query()
            .from({ user: usersCollection })
            .where(({ user }) =>
              eq(user.createdAt, new Date(`invalid`) as never),
            ),
        ),
        /invalid Date/,
      ],
      [
        `class instance`,
        getQueryIR(
          new Query()
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.name, new OpaqueValue() as never)),
        ),
        /non-plain object value/,
      ],
    ] as const

    for (const [name, query, message] of queries) {
      expect(() => getStableQueryIRHash(query), name).toThrow(
        UnhashableQueryIRError,
      )
      expect(() => getStableQueryIRHash(query), name).toThrow(message)
    }
  })
})
