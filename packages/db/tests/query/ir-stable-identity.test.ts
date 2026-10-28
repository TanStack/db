// Unit tests for stable query identity, demand keys, and runtime reference
// identity: fixed scenarios whose expectations are literal values or
// production identity equalities. The law and its oracle are owned by
// ir-stable-identity-oracle.test.ts; the shared fixtures live in
// ir-stable-identity-support.ts.
import { describe, expect, it, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'
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
  lt,
  max,
  not,
  or,
  subtract,
  sum,
  upper,
} from '../../src/query/builder/functions.js'
import { include } from '../../src/query/index.js'
import {
  UnhashableQueryIRError,
  getLoadSubsetDemandKey,
  getQueryIdentity,
  getStableQueryIRHash,
  getStableValueHash,
} from '../../src/query/ir-stable-identity.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import {
  compileExpression,
  toBooleanPredicate,
} from '../../src/query/compiler/evaluators.js'
import {
  createRuntimeReferenceIdentityFactory,
  getRuntimeReferenceIdentity,
} from '../../src/query/runtime-reference-identity.js'
import { createValueIdentity } from '../../src/query/equality-value-identity.js'
import {
  createAlphaRenamedImplicitJoinQuery,
  createProfileValueQuery,
  createProjectedExpressionQuery,
  getProjectedExpressionIdentity,
  postsCollection,
  usersCollection,
} from './ir-stable-identity-support.js'
import type { User } from './ir-stable-identity-support.js'
import type { OrderBy, QueryIR } from '../../src/query/ir.js'
import type { LoadSubsetOptions } from '../../src/types.js'

describe(`stable runtime value hashing`, () => {
  it(`normalizes object key order`, () => {
    expect(getStableValueHash([`todos`, { status: `open`, page: 1 }])).toBe(
      getStableValueHash([`todos`, { page: 1, status: `open` }]),
    )
  })

  it(`reports the path of an unhashable query key value`, () => {
    expect(() =>
      getStableValueHash([`todos`, { predicate: () => true }], `queryKey`),
    ).toThrow(/queryKey\[1\]\.predicate/)
  })
})

describe(`semantic expression identity`, () => {
  const age = new PropRef<number>([`user`, `age`])
  const active = new PropRef<boolean>([`user`, `active`])

  it(`normalizes associative, commutative, and idempotent boolean forms`, () => {
    const adult = new Func<boolean>(`gte`, [age, new Value(18)])
    const enabled = new Func<boolean>(`eq`, [active, new Value(true)])
    const nested = new Func<boolean>(`and`, [
      enabled,
      new Func<boolean>(`and`, [adult, enabled]),
    ])
    const flat = new Func<boolean>(`and`, [adult, enabled])

    expect(getProjectedExpressionIdentity(nested)).toBe(
      getProjectedExpressionIdentity(flat),
    )
    expect(getProjectedExpressionIdentity(new Func(`or`, [adult, adult]))).toBe(
      getProjectedExpressionIdentity(new Func(`or`, [adult])),
    )
  })

  it(`keeps a boolean wrapper when duplicate operands coerce their result`, () => {
    const bareAge = new PropRef<number>([`user`, `age`])
    const duplicateAnd = new Func<boolean>(`and`, [bareAge, bareAge])
    const row = { user: { age: 18 } }

    expect(toBooleanPredicate(compileExpression(bareAge)(row))).toBe(false)
    expect(toBooleanPredicate(compileExpression(duplicateAnd)(row))).toBe(true)
    expect(getProjectedExpressionIdentity(duplicateAnd)).not.toBe(
      getProjectedExpressionIdentity(bareAge),
    )
  })

  it(`normalizes equality and reversed inequalities`, () => {
    expect(
      getProjectedExpressionIdentity(new Func(`eq`, [age, new Value(18)])),
    ).toBe(getProjectedExpressionIdentity(new Func(`eq`, [new Value(18), age])))
    expect(
      getProjectedExpressionIdentity(new Func(`gt`, [age, new Value(18)])),
    ).toBe(getProjectedExpressionIdentity(new Func(`lt`, [new Value(18), age])))
  })

  it(`preserves order-sensitive function arguments`, () => {
    expect(
      getProjectedExpressionIdentity(new Func(`subtract`, [age, new Value(1)])),
    ).not.toBe(
      getProjectedExpressionIdentity(new Func(`subtract`, [new Value(1), age])),
    )
  })

  it(`does not initialize runtime reference identities during module evaluation`, async () => {
    const getRandomValues = vi.fn((values: Uint32Array) => values)
    vi.stubGlobal(`crypto`, { getRandomValues })
    vi.resetModules()

    try {
      const { getRuntimeReferenceIdentity: getFreshRuntimeReferenceIdentity } =
        await import(`../../src/query/runtime-reference-identity.js`)

      expect(getRandomValues).not.toHaveBeenCalled()

      getFreshRuntimeReferenceIdentity({})
      getFreshRuntimeReferenceIdentity({})

      expect(getRandomValues).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it(`does not reuse reference identities across runtimes`, () => {
    const firstRuntime = createRuntimeReferenceIdentityFactory()
    const secondRuntime = createRuntimeReferenceIdentityFactory()

    expect(firstRuntime({ a: 1 })).not.toEqual(secondRuntime({ b: 2 }))
  })

  it(`allocates runtime entropy only when the first identity is requested`, () => {
    const getRandomValues = vi.fn((values: Uint32Array) => values)
    vi.stubGlobal(`crypto`, { getRandomValues })
    try {
      const runtime = createRuntimeReferenceIdentityFactory()
      expect(getRandomValues).not.toHaveBeenCalled()

      runtime({})
      runtime({})
      expect(getRandomValues).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it(`keeps symbol identities stable and distinct`, () => {
    const first = Symbol(`value`)
    const second = Symbol(`value`)

    expect(getRuntimeReferenceIdentity(first)).toEqual(
      getRuntimeReferenceIdentity(first),
    )
    expect(getRuntimeReferenceIdentity(first)).not.toEqual(
      getRuntimeReferenceIdentity(second),
    )
  })

  it(`does not retain symbols in strong identity maps when weak symbol keys are supported`, () => {
    const NativeMap = Map
    const stronglyStoredSymbols = new Set<symbol>()
    class TrackingMap<K, V> extends NativeMap<K, V> {
      override set(key: K, value: V): this {
        if (typeof key === `symbol`) stronglyStoredSymbols.add(key)
        return super.set(key, value)
      }
    }
    const local = Symbol(`local`)
    const registered = Symbol.for(
      `tanstack-db-runtime-reference-test-${Date.now()}`,
    )

    vi.stubGlobal(`Map`, TrackingMap)
    try {
      const runtime = createRuntimeReferenceIdentityFactory()
      runtime(local)
      runtime(registered)
    } finally {
      vi.unstubAllGlobals()
    }

    expect(stronglyStoredSymbols).not.toContain(local)
    expect(stronglyStoredSymbols).not.toContain(registered)
  })

  it(`keeps correct symbol identity when weak symbol keys are unavailable`, () => {
    const NativeWeakMap = WeakMap
    class ObjectOnlyWeakMap<K extends object, V> extends NativeWeakMap<K, V> {
      override set(key: K, value: V): this {
        if (typeof key === `symbol`) {
          throw new TypeError(`Symbols cannot be weak keys`)
        }
        return super.set(key, value)
      }
    }
    const first = Symbol(`value`)
    const second = Symbol(`value`)

    vi.stubGlobal(`WeakMap`, ObjectOnlyWeakMap)
    try {
      const runtime = createRuntimeReferenceIdentityFactory()

      expect(runtime(first)).toEqual(runtime(first))
      expect(runtime(first)).not.toEqual(runtime(second))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it(`scopes opaque value identities to their owner`, () => {
    const firstScope = createValueIdentity()
    const secondScope = createValueIdentity()
    const first = Symbol(`value`)
    const second = Symbol(`value`)

    expect(firstScope.equality(first)).toEqual(firstScope.equality(first))
    expect(firstScope.equality(first)).not.toEqual(firstScope.equality(second))
    expect(firstScope.equality(first)).not.toEqual(secondScope.equality(first))
  })

  it(`falls back when the runtime crypto object lacks getRandomValues`, () => {
    vi.stubGlobal(`crypto`, {})
    try {
      const runtime = createRuntimeReferenceIdentityFactory()

      expect(runtime({ a: 1 })).toEqual([
        `runtimeReference`,
        expect.any(String),
        1,
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe(`loadSubset demand identity`, () => {
  it(`preserves legacy nested-ref identity and distinguishes explicit qualification`, () => {
    const nested = new PropRef([`profile`, `score`])
    const qualified = new PropRef([`profile`, `score`], `profile`)

    expect(getLoadSubsetDemandKey({ where: nested })).toBe(
      `{"type":"loadSubsetDemand","query":{"type":"loadSubsetQuery","where":{"type":"ref","path":[["string","profile"],["string","score"]]}}}`,
    )
    expect(getLoadSubsetDemandKey({ where: qualified })).not.toBe(
      getLoadSubsetDemandKey({ where: nested }),
    )
    expect(JSON.stringify(nested)).toBe(
      `{"path":["profile","score"],"type":"ref"}`,
    )
  })

  it(`gives an unqualified ref no source alias property`, () => {
    expect(Object.hasOwn(new PropRef([`profile`]), `sourceAlias`)).toBe(false)
    expect(
      Object.hasOwn(
        new PropRef([`profile`, `score`], `profile`),
        `sourceAlias`,
      ),
    ).toBe(true)
  })

  const id = new PropRef<string>([`id`])
  const group = new PropRef<string>([`group`])
  const first = new Func<boolean>(`eq`, [id, new Value(`a`)])
  const second = new Func<boolean>(`eq`, [group, new Value(`x`)])
  const orderBy: NonNullable<LoadSubsetOptions[`orderBy`]> = [
    {
      expression: id,
      compareOptions: { direction: `asc`, nulls: `first` },
    },
    {
      expression: group,
      compareOptions: { direction: `desc`, nulls: `last` },
    },
  ]

  it(`includes the exact requested window`, () => {
    const narrow = { where: first, orderBy, limit: 10, offset: 5 }
    const wide = { where: first, orderBy, limit: 20, offset: 0 }

    expect(getLoadSubsetDemandKey(narrow)).not.toBe(
      getLoadSubsetDemandKey(wide),
    )
  })

  it(`normalizes predicates but preserves orderBy sequence`, () => {
    const left = new Func<boolean>(`and`, [first, second])
    const right = new Func<boolean>(`and`, [second, first])

    expect(getLoadSubsetDemandKey({ where: left, orderBy })).toBe(
      getLoadSubsetDemandKey({ where: right, orderBy }),
    )
    expect(getLoadSubsetDemandKey({ where: left, orderBy })).not.toBe(
      getLoadSubsetDemandKey({ where: right, orderBy: [...orderBy].reverse() }),
    )
  })

  it(`includes cursor shape and excludes runtime owners`, () => {
    const cursor = {
      whereFrom: new Func<boolean>(`gt`, [id, new Value(`a`)]),
      whereCurrent: first,
      lastKey: `a`,
    }
    const firstOwner = new AbortController()
    const secondOwner = new AbortController()
    const subscription = {} as NonNullable<LoadSubsetOptions[`subscription`]>

    expect(
      getLoadSubsetDemandKey({
        where: first,
        cursor,
        signal: firstOwner.signal,
        subscription,
      }),
    ).toBe(
      getLoadSubsetDemandKey({
        where: first,
        cursor,
        signal: secondOwner.signal,
      }),
    )
    expect(getLoadSubsetDemandKey({ where: first, cursor })).not.toBe(
      getLoadSubsetDemandKey({
        where: first,
        cursor: { ...cursor, lastKey: `b` },
      }),
    )
  })

  it(`uses the base query key for an unconstrained owner-only demand`, () => {
    expect(getLoadSubsetDemandKey({})).toBeUndefined()
    expect(getLoadSubsetDemandKey({ offset: 0 })).toBeUndefined()
    expect(
      getLoadSubsetDemandKey({ signal: new AbortController().signal }),
    ).toBeUndefined()
    expect(getLoadSubsetDemandKey({ where: first, offset: 0 })).toBe(
      getLoadSubsetDemandKey({ where: first }),
    )
  })

  it.each([
    [`function`, () => `value`, () => `value`],
    [`symbol`, Symbol(`value`), Symbol(`value`)],
  ])(`uses runtime reference identity for %s demand values`, (_name, a, b) => {
    const field = new PropRef<unknown>([`row`, `value`])
    const demand = (value: unknown): LoadSubsetOptions => ({
      where: new Func(`eq`, [field, new Value(value)]),
    })

    expect(getLoadSubsetDemandKey(demand(a))).toBe(
      getLoadSubsetDemandKey(demand(a)),
    )
    expect(getLoadSubsetDemandKey(demand(a))).not.toBe(
      getLoadSubsetDemandKey(demand(b)),
    )
  })

  it(`uses exact custom comparator identity for order terms`, () => {
    const compare = (a: string, b: string) => a.length - b.length
    const orderByFor = (candidate: typeof compare): OrderBy => [
      {
        expression: new PropRef([`row`, `label`]),
        compareOptions: {
          direction: `asc` as const,
          nulls: `first` as const,
          stringSort: `custom`,
          compare: candidate,
        },
      },
    ]
    const queryFor = (candidate: typeof compare): QueryIR => ({
      ...getQueryIR(new Query().from({ user: usersCollection })),
      orderBy: [
        {
          expression: new PropRef([`user`, `name`]),
          compareOptions: {
            direction: `asc`,
            nulls: `first`,
            stringSort: `custom`,
            compare: candidate,
          },
        },
      ],
    })
    const clone = (a: string, b: string) => a.length - b.length

    expect(getLoadSubsetDemandKey({ orderBy: orderByFor(compare) })).toBe(
      getLoadSubsetDemandKey({ orderBy: orderByFor(compare) }),
    )
    expect(getLoadSubsetDemandKey({ orderBy: orderByFor(compare) })).not.toBe(
      getLoadSubsetDemandKey({ orderBy: orderByFor(clone) }),
    )
    expect(getQueryIdentity(queryFor(compare))).toBe(
      getQueryIdentity(queryFor(compare)),
    )
    expect(getQueryIdentity(queryFor(compare))).not.toBe(
      getQueryIdentity(queryFor(clone)),
    )
  })

  it.each([
    [`signed zero`, -0, 0],
    [`invalid Date`, new Date(Number.NaN), new Date(Number.NaN)],
    [
      `Temporal.PlainDate`,
      Temporal.PlainDate.from(`2024-01-15`),
      Temporal.PlainDate.from(`2024-01-15`),
    ],
    [
      `Temporal.Duration`,
      Temporal.Duration.from(`PT1H`),
      Temporal.Duration.from(`PT1H`),
    ],
    [
      `large cross-constructor binary`,
      new Uint8Array(129).fill(7),
      Buffer.from(new Uint8Array(129).fill(7)),
    ],
  ])(
    `uses comparison semantics for equivalent %s values`,
    (_label, firstValue, secondValue) => {
      const value = new PropRef<unknown>([`row`, `value`])
      const firstPredicate = new Func<boolean>(`eq`, [
        value,
        new Value(firstValue),
      ])
      const secondPredicate = new Func<boolean>(`eq`, [
        value,
        new Value(secondValue),
      ])

      expect(
        compileExpression(firstPredicate)({ row: { value: secondValue } }),
      ).toBe(true)
      expect(getProjectedExpressionIdentity(firstPredicate)).toBe(
        getProjectedExpressionIdentity(secondPredicate),
      )
      expect(getLoadSubsetDemandKey({ where: firstPredicate })).toBe(
        getLoadSubsetDemandKey({ where: secondPredicate }),
      )
      expect(getQueryIdentity(createProfileValueQuery(firstValue))).toBe(
        getQueryIdentity(createProfileValueQuery(secondValue)),
      )
    },
  )
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
          posts: include(
            new Query()
              .from({ post: postsCollection })
              .where(({ post }) => eq(post.userId, user.id))
              .select(({ post }) => ({
                id: post.id,
                title: post.title,
              })),
          ),
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

  it(`keeps aliases that define an implicit joined result shape`, () => {
    expect(
      getQueryIdentity(createAlphaRenamedImplicitJoinQuery(`user`, `post`)),
    ).not.toBe(
      getQueryIdentity(
        createAlphaRenamedImplicitJoinQuery(`account`, `article`),
      ),
    )
  })

  it(`keeps aliases that define an implicit union-source result shape`, () => {
    const usersAndPosts = getQueryIR(
      new Query().unionAll({
        user: usersCollection,
        post: postsCollection,
      }),
    )
    const accountsAndArticles = getQueryIR(
      new Query().unionAll({
        account: usersCollection,
        article: postsCollection,
      }),
    )

    expect(usersAndPosts.from.type).toBe(`unionFrom`)
    expect(getQueryIdentity(usersAndPosts)).not.toBe(
      getQueryIdentity(accountsAndArticles),
    )
  })

  it(`keeps aliases when an empty groupBy still selects a namespaced row`, () => {
    const createQuery = (alias: string) =>
      getQueryIR(
        new Query()
          .from({ [alias]: usersCollection } as Record<
            string,
            typeof usersCollection
          >)
          .groupBy(() => []),
      )

    expect(getQueryIdentity(createQuery(`user`))).not.toBe(
      getQueryIdentity(createQuery(`account`)),
    )
  })

  it(`keeps output-producing runtime values exact`, () => {
    const bufferExpression = new Func(`concat`, [new Value(Buffer.from([65]))])
    const uint8Expression = new Func(`concat`, [
      new Value(new Uint8Array([65])),
    ])

    expect(compileExpression(bufferExpression)({})).toBe(`A`)
    expect(compileExpression(uint8Expression)({})).toBe(`65`)
    expect(
      getQueryIdentity(createProjectedExpressionQuery(bufferExpression)),
    ).not.toBe(
      getQueryIdentity(createProjectedExpressionQuery(uint8Expression)),
    )

    expect(
      getQueryIdentity(createProjectedExpressionQuery(new Value(-0))),
    ).not.toBe(getQueryIdentity(createProjectedExpressionQuery(new Value(0))))

    const firstObject = { value: 1 }
    const secondObject = { value: 1 }
    expect(
      getQueryIdentity(createProjectedExpressionQuery(new Value(firstObject))),
    ).not.toBe(
      getQueryIdentity(createProjectedExpressionQuery(new Value(secondObject))),
    )
    expect(compileExpression(new Value(firstObject))({})).toBe(firstObject)
    expect(compileExpression(new Value(secondObject))({})).toBe(secondObject)
  })

  it(`shares identity across equivalent predicate formulations`, () => {
    const left = getQueryIR(
      new Query()
        .from({ user: usersCollection })
        .where(({ user }) => and(eq(user.status, `active`), gt(user.age, 18))),
    )
    const right = getQueryIR(
      new Query()
        .from({ user: usersCollection })
        .where(({ user }) => and(lt(18, user.age), eq(`active`, user.status))),
    )

    expect(getQueryIdentity(left)).toBe(getQueryIdentity(right))
  })

  it(`normalizes the implicit conjunction order of repeated where clauses`, () => {
    const left = getQueryIR(
      new Query()
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.status, `active`))
        .where(({ user }) => gt(user.age, 18)),
    )
    const right = getQueryIR(
      new Query()
        .from({ user: usersCollection })
        .where(({ user }) => gt(user.age, 18))
        .where(({ user }) => eq(user.status, `active`)),
    )
    const duplicate = getQueryIR(
      new Query()
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.status, `active`))
        .where(({ user }) => gt(user.age, 18))
        .where(({ user }) => eq(user.status, `active`)),
    )

    expect(getQueryIdentity(left)).toBe(getQueryIdentity(right))
    expect(getQueryIdentity(left)).toBe(getQueryIdentity(duplicate))
  })

  it(`normalizes the implicit conjunction order of repeated having clauses`, () => {
    const left = getQueryIR(
      new Query()
        .from({ user: usersCollection })
        .groupBy(({ user }) => user.teamId)
        .select(({ user }) => ({
          teamId: user.teamId,
          userCount: count(user.id),
          averageAge: avg(user.age),
        }))
        .having(({ $selected }) => gt($selected.userCount, 1))
        .having(({ $selected }) => gt($selected.averageAge, 18)),
    )
    const right = getQueryIR(
      new Query()
        .from({ user: usersCollection })
        .groupBy(({ user }) => user.teamId)
        .select(({ user }) => ({
          teamId: user.teamId,
          userCount: count(user.id),
          averageAge: avg(user.age),
        }))
        .having(({ $selected }) => gt($selected.averageAge, 18))
        .having(({ $selected }) => gt($selected.userCount, 1)),
    )

    expect(getQueryIdentity(left)).toBe(getQueryIdentity(right))
  })

  it(`includes a query plan's result window`, () => {
    const createQuery = (limit: number) =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .orderBy(({ user }) => user.age)
          .limit(limit),
      )

    expect(getQueryIdentity(createQuery(10))).not.toBe(
      getQueryIdentity(createQuery(20)),
    )
  })

  it(`elides the default query offset`, () => {
    const base = getQueryIR(new Query().from({ user: usersCollection }))
    const offsetZero = getQueryIR(
      new Query().from({ user: usersCollection }).offset(0),
    )

    expect(getQueryIdentity(base)).toBe(getQueryIdentity(offsetZero))
  })

  it(`preserves function-argument and orderBy-clause order`, () => {
    const subtractAge = getQueryIR(
      new Query()
        .from({ user: usersCollection })
        .orderBy(({ user }) => subtract(user.age, 1))
        .orderBy(({ user }) => user.name),
    )
    const subtractFromOne = getQueryIR(
      new Query()
        .from({ user: usersCollection })
        .orderBy(({ user }) => subtract(1, user.age))
        .orderBy(({ user }) => user.name),
    )
    const reversedClauses = getQueryIR(
      new Query()
        .from({ user: usersCollection })
        .orderBy(({ user }) => user.name)
        .orderBy(({ user }) => subtract(user.age, 1)),
    )

    expect(getQueryIdentity(subtractAge)).not.toBe(
      getQueryIdentity(subtractFromOne),
    )
    expect(getQueryIdentity(subtractAge)).not.toBe(
      getQueryIdentity(reversedClauses),
    )
  })

  it(`preserves semantically significant union source ordering`, () => {
    const usersThenPosts = getQueryIR(
      new Query().unionAll({ user: usersCollection, post: postsCollection }),
    )
    const postsThenUsers = getQueryIR(
      new Query().unionAll({ post: postsCollection, user: usersCollection }),
    )

    expect(getStableQueryIRHash(usersThenPosts)).not.toBe(
      getStableQueryIRHash(postsThenUsers),
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

  it(`uses evaluator semantics for invalid Date and Temporal values`, () => {
    expect(getQueryIdentity(createProfileValueQuery(new Date(`invalid`)))).toBe(
      getQueryIdentity(createProfileValueQuery(new Date(`also invalid`))),
    )
    expect(
      getQueryIdentity(
        createProfileValueQuery(Temporal.PlainDate.from(`2026-08-24`)),
      ),
    ).toBe(
      getQueryIdentity(
        createProfileValueQuery(Temporal.PlainDate.from(`2026-08-24`)),
      ),
    )
  })

  it(`normalizes object property ordering in structural value hashes`, () => {
    expect(
      getStableValueHash({
        skills: [`ts`, `db`],
        experience: { years: 5 },
      }),
    ).toBe(
      getStableValueHash({
        experience: { years: 5 },
        skills: [`ts`, `db`],
      }),
    )
  })

  it(`keeps runtime values disjoint from internal identity tags`, () => {
    const createQuery = (value: unknown) =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.profile, value as never)),
      )

    const hashes = [
      undefined,
      { type: `undefined` },
      [`undefined`],
      Number.NaN,
      { type: `number`, value: `NaN` },
      new Date(`2024-01-01T00:00:00.000Z`),
      { type: `Date`, value: `2024-01-01T00:00:00.000Z` },
    ].map((value) => getStableQueryIRHash(createQuery(value)))

    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it(`preserves __proto__ as a normal object key`, () => {
    const withProtoKey = JSON.parse(`{"__proto__":{"value":true}}`) as object
    const withoutProtoKey = {}
    const createQuery = (value: object) =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.profile, value as never)),
      )

    expect(getStableQueryIRHash(createQuery(withProtoKey))).not.toBe(
      getStableQueryIRHash(createQuery(withoutProtoKey)),
    )
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

  it.each([
    [`function`, () => `Tanner`, () => `Tanner`],
    [`symbol`, Symbol(`name`), Symbol(`name`)],
  ])(`keeps %s query values distinct by reference`, (_name, a, b) => {
    const query = (value: unknown) =>
      getQueryIR(
        new Query()
          .from({ user: usersCollection })
          .where(({ user }) => eq(user.name, value as never)),
      )

    expect(getStableQueryIRHash(query(a))).toBe(getStableQueryIRHash(query(a)))
    expect(getStableQueryIRHash(query(a))).not.toBe(
      getStableQueryIRHash(query(b)),
    )
  })

  it(`accepts opaque object values by reference`, () => {
    const circularValue: Record<string, unknown> = {}
    circularValue.self = circularValue

    class OpaqueValue {
      value = `Tanner`
    }

    expect(() =>
      getQueryIdentity(createProfileValueQuery(circularValue)),
    ).not.toThrow()
    expect(() =>
      getQueryIdentity(createProfileValueQuery(new OpaqueValue())),
    ).not.toThrow()
  })
})
