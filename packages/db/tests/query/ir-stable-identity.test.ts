import { describe, expect, it, vi } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
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
import {
  UnhashableQueryIRError,
  getLoadSubsetDemandKey,
  getQueryIdentity,
  getStableExpressionHash,
  getStableQueryIRHash,
  getStableValueHash,
} from '../../src/query/ir-stable-identity.js'
import {
  CollectionRef,
  Func,
  IncludesSubquery,
  PropRef,
  QueryRef,
  UnionAll,
  Value,
} from '../../src/query/ir.js'
import {
  compileExpression,
  toBooleanPredicate,
} from '../../src/query/compiler/evaluators.js'
import { isLoadSubsetRequestSubsumedBy } from '../../src/query/predicate-utils.js'
import { createRuntimeReferenceIdentityFactory } from '../../src/query/runtime-reference-identity.js'
import type { BasicExpression, QueryIR } from '../../src/query/ir.js'
import type { LoadSubsetOptions } from '../../src/types.js'

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

const referenceSemanticPairArbitrary = fc.oneof(
  fc
    .array(fc.integer())
    .map((values): [unknown, unknown] => [[...values], [...values]]),
  fc
    .dictionary(fc.string(), fc.integer())
    .map((value): [unknown, unknown] => [{ ...value }, { ...value }]),
  fc
    .array(fc.tuple(fc.string(), fc.integer()))
    .map((entries): [unknown, unknown] => [new Map(entries), new Map(entries)]),
  fc
    .array(fc.integer())
    .map((values): [unknown, unknown] => [new Set(values), new Set(values)]),
  fc
    .int16Array()
    .map((value): [unknown, unknown] => [
      new Int16Array(value),
      new Int16Array(value),
    ]),
)

const outputExpressionPairArbitrary: fc.Arbitrary<{
  first: BasicExpression
  second: BasicExpression
}> = fc.oneof(
  fc.integer().map((value) => ({
    first: new Value(value),
    second: new Value(value),
  })),
  fc.string().map((value) => ({
    first: new Func(`concat`, [new Value(value)]),
    second: new Func(`concat`, [new Value(value)]),
  })),
  fc.uint8Array({ minLength: 1, maxLength: 8 }).map((value) => ({
    first: new Func(`concat`, [new Value(Buffer.from(value))]),
    second: new Func(`concat`, [new Value(new Uint8Array(value))]),
  })),
  fc.constant({
    first: new Value(-0),
    second: new Value(0),
  }),
)

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
  type EquivalentExpressionPair = {
    original: BasicExpression<boolean>
    equivalent: BasicExpression<boolean>
  }

  const comparisonPairArbitrary: fc.Arbitrary<EquivalentExpressionPair> = fc
    .record({
      operator: fc.constantFrom<`gt` | `gte` | `lt` | `lte`>(
        `gt`,
        `gte`,
        `lt`,
        `lte`,
      ),
      threshold: fc.integer(),
    })
    .map(({ operator, threshold }) => {
      const inverse: Record<`gt` | `gte` | `lt` | `lte`, string> = {
        gt: `lt`,
        gte: `lte`,
        lt: `gt`,
        lte: `gte`,
      }
      return {
        original: new Func<boolean>(operator, [age, new Value(threshold)]),
        equivalent: new Func<boolean>(inverse[operator], [
          new Value(threshold),
          age,
        ]),
      }
    })
  const equalityPairArbitrary: fc.Arbitrary<EquivalentExpressionPair> = fc
    .boolean()
    .map((value) => ({
      original: new Func<boolean>(`eq`, [active, new Value(value)]),
      equivalent: new Func<boolean>(`eq`, [new Value(value), active]),
    }))
  const membershipPairArbitrary: fc.Arbitrary<EquivalentExpressionPair> = fc
    .uniqueArray(fc.integer(), { minLength: 1, maxLength: 8 })
    .map((values) => ({
      original: new Func<boolean>(`in`, [age, new Value(values)]),
      equivalent: new Func<boolean>(`in`, [
        age,
        new Value([...values].reverse().concat(values[0]!)),
      ]),
    }))
  const atomicExpressionPairArbitrary = fc.oneof(
    comparisonPairArbitrary,
    equalityPairArbitrary,
    membershipPairArbitrary,
  )
  const equivalentExpressionPairArbitrary = fc.oneof(
    { weight: 3, arbitrary: atomicExpressionPairArbitrary },
    {
      weight: 2,
      arbitrary: fc
        .tuple(
          fc.constantFrom(`and`, `or`),
          atomicExpressionPairArbitrary,
          atomicExpressionPairArbitrary,
        )
        .map(([operator, left, right]) => ({
          original: new Func<boolean>(operator, [
            left.original,
            new Func<boolean>(operator, [right.original, left.original]),
          ]),
          equivalent: new Func<boolean>(operator, [
            right.equivalent,
            left.equivalent,
          ]),
        })),
    },
  )

  it(`normalizes associative, commutative, and idempotent boolean forms`, () => {
    const adult = new Func<boolean>(`gte`, [age, new Value(18)])
    const enabled = new Func<boolean>(`eq`, [active, new Value(true)])
    const nested = new Func<boolean>(`and`, [
      enabled,
      new Func<boolean>(`and`, [adult, enabled]),
    ])
    const flat = new Func<boolean>(`and`, [adult, enabled])

    expect(getStableExpressionHash(nested)).toBe(getStableExpressionHash(flat))
    expect(getStableExpressionHash(new Func(`or`, [adult, adult]))).toBe(
      getStableExpressionHash(new Func(`or`, [adult])),
    )
  })

  it(`keeps a boolean wrapper when duplicate operands coerce their result`, () => {
    const bareAge = new PropRef<number>([`user`, `age`])
    const duplicateAnd = new Func<boolean>(`and`, [bareAge, bareAge])
    const row = { user: { age: 18 } }

    expect(toBooleanPredicate(compileExpression(bareAge)(row))).toBe(false)
    expect(toBooleanPredicate(compileExpression(duplicateAnd)(row))).toBe(true)
    expect(getStableExpressionHash(duplicateAnd)).not.toBe(
      getStableExpressionHash(bareAge),
    )
  })

  it(`normalizes equality and reversed inequalities`, () => {
    expect(getStableExpressionHash(new Func(`eq`, [age, new Value(18)]))).toBe(
      getStableExpressionHash(new Func(`eq`, [new Value(18), age])),
    )
    expect(getStableExpressionHash(new Func(`gt`, [age, new Value(18)]))).toBe(
      getStableExpressionHash(new Func(`lt`, [new Value(18), age])),
    )
  })

  it(`preserves order-sensitive function arguments`, () => {
    expect(
      getStableExpressionHash(new Func(`subtract`, [age, new Value(1)])),
    ).not.toBe(
      getStableExpressionHash(new Func(`subtract`, [new Value(1), age])),
    )
  })

  fcTest.prop([
    equivalentExpressionPairArbitrary,
    fc.record({ age: fc.integer(), active: fc.boolean() }),
  ])(`canonical expression grammar preserves semantics`, (pair, sample) => {
    const row = { user: sample }

    expect(compileExpression(pair.original)(row)).toBe(
      compileExpression(pair.equivalent)(row),
    )
    expect(getStableExpressionHash(pair.original)).toBe(
      getStableExpressionHash(pair.equivalent),
    )
  })

  fcTest.prop([referenceSemanticPairArbitrary])(
    `keeps reference-semantic values distinct across identity and coverage`,
    ([first, second]) => {
      const value = new PropRef<unknown>([`row`, `value`])
      const firstPredicate = new Func<boolean>(`eq`, [value, new Value(first)])
      const secondPredicate = new Func<boolean>(`eq`, [
        value,
        new Value(second),
      ])
      const row = { row: { value: first } }

      expect(compileExpression(firstPredicate)(row)).toBe(true)
      expect(compileExpression(secondPredicate)(row)).toBe(false)
      expect(getStableExpressionHash(firstPredicate)).not.toBe(
        getStableExpressionHash(secondPredicate),
      )
      expect(
        getLoadSubsetDemandKey({ where: firstPredicate, limit: 1 }),
      ).not.toBe(getLoadSubsetDemandKey({ where: secondPredicate, limit: 1 }))
      expect(
        isLoadSubsetRequestSubsumedBy(
          { where: firstPredicate, limit: 1 },
          { where: secondPredicate, limit: 1 },
        ),
      ).toBe(false)
    },
  )

  it(`does not reuse reference identities across runtimes`, () => {
    const firstRuntime = createRuntimeReferenceIdentityFactory()
    const secondRuntime = createRuntimeReferenceIdentityFactory()

    expect(firstRuntime({ a: 1 })).not.toEqual(secondRuntime({ b: 2 }))
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

  fcTest.prop([
    fc.uniqueArray(fc.oneof(fc.integer(), fc.string(), fc.boolean()), {
      minLength: 1,
      maxLength: 8,
    }),
  ])(`treats IN candidates as a set`, (candidates) => {
    const value = new PropRef<unknown>([`row`, `value`])
    const ordered = new Func<boolean>(`in`, [value, new Value(candidates)])
    const reordered = new Func<boolean>(`in`, [
      value,
      new Value([...candidates].reverse().concat(candidates[0]!)),
    ])

    for (const candidate of candidates) {
      const row = { row: { value: candidate } }
      expect(compileExpression(ordered)(row)).toBe(
        compileExpression(reordered)(row),
      )
    }
    expect(getStableExpressionHash(ordered)).toBe(
      getStableExpressionHash(reordered),
    )
    expect(getLoadSubsetDemandKey({ where: ordered })).toBe(
      getLoadSubsetDemandKey({ where: reordered }),
    )
  })
})

describe(`loadSubset demand identity`, () => {
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
      expect(getStableExpressionHash(firstPredicate)).toBe(
        getStableExpressionHash(secondPredicate),
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

const postsCollection = new CollectionImpl<Post>({
  id: `posts`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

function createProfileValueQuery(value: unknown): QueryIR {
  return {
    ...getQueryIR(new Query().from({ user: usersCollection })),
    where: [
      new Func<boolean>(`eq`, [
        new PropRef([`user`, `profile`]),
        new Value(value),
      ]),
    ],
  }
}

function createAlphaRenamedJoinQuery(
  userAlias: string,
  postAlias: string,
): QueryIR {
  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      userAlias,
    ),
    join: [
      {
        type: `inner`,
        from: new CollectionRef(
          postsCollection as unknown as ConstructorParameters<
            typeof CollectionRef
          >[0],
          postAlias,
        ),
        left: new PropRef([userAlias, `id`]),
        right: new PropRef([postAlias, `userId`]),
      },
    ],
    where: [
      new Func(`eq`, [new PropRef([postAlias, `published`]), new Value(true)]),
    ],
    select: {
      userId: new PropRef([userAlias, `id`]),
      postTitle: new PropRef([postAlias, `title`]),
    },
    orderBy: [
      {
        expression: new PropRef([postAlias, `createdAt`]),
        compareOptions: { direction: `desc`, nulls: `last` },
      },
    ],
  }
}

function createAlphaRenamedImplicitJoinQuery(
  userAlias: string,
  postAlias: string,
): QueryIR {
  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      userAlias,
    ),
    join: [
      {
        type: `inner`,
        from: new CollectionRef(
          postsCollection as unknown as ConstructorParameters<
            typeof CollectionRef
          >[0],
          postAlias,
        ),
        left: new PropRef([userAlias, `id`]),
        right: new PropRef([postAlias, `userId`]),
      },
    ],
  }
}

function createProjectedExpressionQuery(expression: BasicExpression): QueryIR {
  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      `user`,
    ),
    select: { value: expression },
  }
}

function createAlphaRenamedNestedQuery(
  innerAlias: string,
  outerAlias: string,
): QueryIR {
  const inner: QueryIR = {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      innerAlias,
    ),
    select: {
      id: new PropRef([innerAlias, `id`]),
      status: new PropRef([innerAlias, `status`]),
    },
  }
  return {
    from: new QueryRef(inner, outerAlias),
    where: [
      new Func(`eq`, [
        new PropRef([outerAlias, `status`]),
        new Value(`active`),
      ]),
    ],
    select: { id: new PropRef([outerAlias, `id`]) },
  }
}

function createUnionDerivedNestedQuery(outerAlias: string): QueryIR {
  const users = new Query()
    .from({ user: usersCollection })
    .select(({ user }) => ({ id: user.id, kind: user.status }))
  const posts = new Query()
    .from({ post: postsCollection })
    .select(({ post }) => ({ id: post.id, kind: post.title }))
  const union = new Query()
    .unionAll(users, posts)
    .where(({ kind }) => eq(kind, `active`))

  return getQueryIR(
    new Query().from({ [outerAlias]: union } as Record<string, typeof union>),
  )
}

function createUnionDerivedNestedOutputQuery(outerAlias: string): QueryIR {
  const users = new Query()
    .from({ user: usersCollection })
    .select(({ user }) => ({ profile: { id: user.id } }))
  const posts = new Query()
    .from({ post: postsCollection })
    .select(({ post }) => ({ profile: { id: post.id } }))
  const union = new Query()
    .unionAll(users, posts)
    .where(({ profile }) => eq(profile.id, 1))

  return getQueryIR(
    new Query().from({ [outerAlias]: union } as Record<string, typeof union>),
  )
}

function createUnionDerivedIncludesQuery(parentAlias: string): QueryIR {
  const firstPosts = new Query()
    .from({ post: postsCollection })
    .select(({ post }) => ({ id: post.id, userId: post.userId }))
  const secondPosts = new Query()
    .from({ otherPost: postsCollection })
    .select(({ otherPost }) => ({
      id: otherPost.id,
      userId: otherPost.userId,
    }))
  const childQuery = getQueryIR(new Query().unionAll(firstPosts, secondPosts))
  const posts = new IncludesSubquery(
    childQuery,
    new PropRef([parentAlias, `id`]),
    new PropRef([`userId`]),
    `posts`,
    undefined,
    undefined,
    `array`,
  )

  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      parentAlias,
    ),
    select: {
      id: new PropRef([parentAlias, `id`]),
      posts,
    },
  }
}

function createCorrelatedUnionIncludesQuery(parentAlias: string): QueryIR {
  const createBranch = (childAlias: string): QueryIR => ({
    from: new CollectionRef(
      postsCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      childAlias,
    ),
    select: {
      profile: { id: new PropRef([childAlias, `id`]) },
      userId: new PropRef([childAlias, `userId`]),
      parentAge: new PropRef([parentAlias, `age`]),
    },
  })
  const childQuery: QueryIR = {
    from: new UnionAll([createBranch(`firstPost`), createBranch(`secondPost`)]),
    where: [new Func(`eq`, [new PropRef([`profile`, `id`]), new Value(1)])],
  }
  const posts = new IncludesSubquery(
    childQuery,
    new PropRef([parentAlias, `id`]),
    new PropRef([`userId`]),
    `posts`,
    undefined,
    [new PropRef([parentAlias, `age`])],
    `array`,
  )

  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      parentAlias,
    ),
    select: {
      id: new PropRef([parentAlias, `id`]),
      posts,
    },
  }
}

function createAlphaRenamedIncludesQuery(
  parentAlias: string,
  childAlias: string,
): QueryIR {
  const childQuery: QueryIR = {
    from: new CollectionRef(
      postsCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      childAlias,
    ),
    select: {
      id: new PropRef([childAlias, `id`]),
      title: new PropRef([childAlias, `title`]),
    },
  }
  const posts = new IncludesSubquery(
    childQuery,
    new PropRef([parentAlias, `id`]),
    new PropRef([childAlias, `userId`]),
    `posts`,
    [
      new Func(`eq`, [
        new PropRef([parentAlias, `status`]),
        new Value(`active`),
      ]),
    ],
    [new PropRef([parentAlias, `id`])],
    `array`,
  )
  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      parentAlias,
    ),
    select: {
      id: new PropRef([parentAlias, `id`]),
      posts,
    },
  }
}

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

  fcTest.prop([
    fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), {
      minLength: 4,
      maxLength: 4,
    }),
  ])(`does not depend on lexical source aliases`, (aliases) => {
    const [firstUser, firstPost, secondUser, secondPost] = aliases

    expect(
      getQueryIdentity(createAlphaRenamedJoinQuery(firstUser!, firstPost!)),
    ).toBe(
      getQueryIdentity(createAlphaRenamedJoinQuery(secondUser!, secondPost!)),
    )
    expect(
      getQueryIdentity(createAlphaRenamedNestedQuery(firstUser!, firstPost!)),
    ).toBe(
      getQueryIdentity(createAlphaRenamedNestedQuery(secondUser!, secondPost!)),
    )
    expect(
      getQueryIdentity(createAlphaRenamedIncludesQuery(firstUser!, firstPost!)),
    ).toBe(
      getQueryIdentity(
        createAlphaRenamedIncludesQuery(secondUser!, secondPost!),
      ),
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

  fcTest.prop([outputExpressionPairArbitrary])(
    `equal query identities imply equal projected expression results`,
    ({ first, second }) => {
      const firstIdentity = getQueryIdentity(
        createProjectedExpressionQuery(first),
      )
      const secondIdentity = getQueryIdentity(
        createProjectedExpressionQuery(second),
      )

      if (firstIdentity === secondIdentity) {
        expect(
          Object.is(
            compileExpression(first)({}),
            compileExpression(second)({}),
          ),
        ).toBe(true)
      }
    },
  )

  fcTest.prop([
    fc
      .stringMatching(/^[a-z][a-z0-9]{0,8}$/)
      .filter(
        (alias) =>
          alias !== `kind` && alias !== `profile` && alias !== `userId`,
      ),
  ])(`does not bind union-derived output fields to outer aliases`, (alias) => {
    expect(getQueryIdentity(createUnionDerivedNestedQuery(`kind`))).toBe(
      getQueryIdentity(createUnionDerivedNestedQuery(alias)),
    )
    expect(
      getQueryIdentity(createUnionDerivedNestedOutputQuery(`profile`)),
    ).toBe(getQueryIdentity(createUnionDerivedNestedOutputQuery(alias)))
    expect(getQueryIdentity(createUnionDerivedIncludesQuery(`userId`))).toBe(
      getQueryIdentity(createUnionDerivedIncludesQuery(alias)),
    )
    expect(
      getQueryIdentity(createCorrelatedUnionIncludesQuery(`profile`)),
    ).toBe(getQueryIdentity(createCorrelatedUnionIncludesQuery(alias)))
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

  fcTest.prop([referenceSemanticPairArbitrary])(
    `keeps queries distinct when captured values compare by reference`,
    ([first, second]) => {
      const firstQuery = createProfileValueQuery(first)
      const secondQuery = createProfileValueQuery(second)
      const firstPredicate = firstQuery.where![0] as BasicExpression<boolean>
      const secondPredicate = secondQuery.where![0] as BasicExpression<boolean>
      const row = { user: { profile: first } }

      expect(compileExpression(firstPredicate)(row)).toBe(true)
      expect(compileExpression(secondPredicate)(row)).toBe(false)
      expect(getQueryIdentity(firstQuery)).not.toBe(
        getQueryIdentity(secondQuery),
      )
    },
  )

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

  it(`rejects function and symbol values inside structured expressions`, () => {
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
    ] as const

    for (const [name, query, message] of queries) {
      expect(() => getStableQueryIRHash(query), name).toThrow(
        UnhashableQueryIRError,
      )
      expect(() => getStableQueryIRHash(query), name).toThrow(message)
    }
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
