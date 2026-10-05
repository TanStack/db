import { isDeepStrictEqual } from 'node:util'
import { D2, MultiSet, output, serializeValue } from '@tanstack/db-ivm'
import { Temporal } from 'temporal-polyfill'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { getQueryIR } from '../../src/query/builder/query-ir.js'
import { createCollection } from '../../src/collection/index.js'
import { count as countRows } from '../../src/query/builder/functions.js'
import { compileExpression } from '../../src/query/compiler/evaluators.js'
import { compileQuery } from '../../src/query/compiler/index.js'
import { getEqualityValueIdentity } from '../../src/query/equality-value-identity.js'
import {
  Query,
  and,
  createLiveQueryCollection,
  eq,
} from '../../src/query/index.js'
import { queriesMatchForCaching } from '../../src/query/compiler/query-equivalence.js'
import {
  getLoadSubsetDemandKey,
  getQueryIdentity,
} from '../../src/query/ir-stable-identity.js'
import {
  CollectionRef,
  Func,
  PropRef,
  QueryRef,
  UnionFrom,
  Value,
} from '../../src/query/ir.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { CollectionImpl } from '../../src/collection/index.js'
import type { QueryIR } from '../../src/query/ir.js'

/**
 * Query identity may erase syntax only when compiled output stays observable-
 * equivalent.
 *
 * The model builds pairs of query IRs across explicit projection, nested query,
 * implicit join/union, and empty grouping forms. Fresh D2 graphs materialize
 * both queries over the same finite source rows. Equal identity is permitted
 * only when complete output bags—including lexical keys and multiplicity—match;
 * output-sensitive aliases remain part of identity.
 *
 * Result mutants remove peers, collapse identity, corrupt aliases or weights,
 * and require the checker to fail. This calibrates the implication that matters:
 * equal QueryIdentity implies equal compiled results, not merely equal hashes.
 *
 * Equality-value identity (D2 keyed state) and equality-operand identity
 * (query IR) must partition supported values alike. The value-pair grammar
 * declares expected equality independently, then checks both identity paths
 * at key construction. Fixed pairs also check public group rows after initial
 * publication. This law does not claim that SQL NULL matches a row.
 */

type User = { id: number; label: string }
type Post = { id: number; userId: number; title: string }
type Row = User | Post
type Form =
  | 'explicit-join'
  | 'explicit-nested'
  | 'implicit-join'
  | 'implicit-union'
  | 'empty-group'
type ResultMutant =
  | 'alias'
  | 'missing-peer'
  | 'constant-identity'
  | 'shared-wrong-output'
  | 'fractional-weight'
const forms: Array<Form> = [
  'explicit-join',
  'explicit-nested',
  'implicit-join',
  'implicit-union',
  'empty-group',
]

function expectBag(
  actual: ReadonlyArray<unknown>,
  expected: ReadonlyArray<unknown>,
) {
  const remaining = [...actual]
  for (const value of expected) {
    const index = remaining.findIndex((entry) =>
      isDeepStrictEqual(entry, value),
    )
    expect(
      index,
      'complete expected row including lexical keys',
    ).toBeGreaterThanOrEqual(0)
    remaining.splice(index, 1)
  }
  expect(remaining, 'no extra rows or duplicate multiplicity').toStrictEqual([])
}

async function runShapes(
  form: Form,
  aliases: [string, string, string, string],
  label: string,
  mutant?: ResultMutant,
) {
  const users = createCollection<User>({
    getKey: (row) => row.id,
    sync: { sync: () => {} },
  })
  const posts = createCollection<Post>({
    getKey: (row) => row.id,
    sync: { sync: () => {} },
  })
  const initialUsers: Array<User> = [
    { id: 1, label },
    { id: 2, label: 'unmatched peer' },
  ]
  // Two identical projected rows deliberately preserve bag multiplicity.
  const initialPosts: Array<Post> = [
    { id: 10, userId: 1, title: 'same title' },
    { id: 11, userId: 1, title: 'same title' },
    { id: 12, userId: 99, title: 'orphan' },
  ]
  const makeQuery = (userAlias: string, postAlias: string) => {
    const user = new CollectionRef(
      users as unknown as CollectionImpl,
      userAlias,
    )
    const post = new CollectionRef(
      posts as unknown as CollectionImpl,
      postAlias,
    )
    const query: QueryIR =
      form === 'implicit-union'
        ? { from: new UnionFrom([user, post]) }
        : form === 'empty-group'
          ? { from: user, groupBy: [] }
          : form === 'explicit-nested'
            ? {
                from: new QueryRef(
                  {
                    from: user,
                    select: {
                      id: new PropRef([userAlias, 'id']),
                      label: new PropRef([userAlias, 'label']),
                    },
                  },
                  postAlias,
                ),
                select: {
                  id: new PropRef([postAlias, 'id']),
                  label: new PropRef([postAlias, 'label']),
                },
              }
            : {
                from: user,
                join: [
                  {
                    type: 'inner',
                    from: post,
                    on: new Func('eq', [
                      new PropRef([userAlias, 'id']),
                      new PropRef([postAlias, 'userId']),
                    ]),
                  },
                ],
                ...(form === 'explicit-join'
                  ? {
                      select: {
                        userId: new PropRef([userAlias, 'id']),
                        label: new PropRef([userAlias, 'label']),
                        title: new PropRef([postAlias, 'title']),
                      },
                    }
                  : {}),
              }
    const graph = new D2()
    const userInput = graph.newInput<[number, Row]>()
    const postInput = graph.newInput<[number, Row]>()
    const { pipeline } = compileQuery(
      query,
      {
        [user.sourceId]: userInput,
        [userAlias]: userInput,
        [post.sourceId]: postInput,
        [postAlias]: postInput,
      },
      { [users.id]: users, [posts.id]: posts },
      {},
      {},
      new Set(),
      {},
      () => {},
    )
    const bag: Array<{ row: unknown; count: number }> = []
    pipeline.pipe(
      output((message) => {
        for (const [[, [value]], weight] of message.getInner()) {
          const row: unknown = structuredClone(value)
          let entry = bag.find((item) => isDeepStrictEqual(item.row, row))
          if (!entry) {
            entry = { row, count: 0 }
            bag.push(entry)
          }
          entry.count += mutant === 'fractional-weight' ? weight * 1.25 : weight
        }
      }),
    )
    graph.finalize()
    const read = () => {
      for (const entry of bag) {
        // Unit inputs produce exact integer bag counts. Array lengths alone
        // would silently truncate a malformed fractional output weight.
        expect(Number.isSafeInteger(entry.count)).toBe(true)
        expect(entry.count).toBeGreaterThanOrEqual(0)
      }
      return bag.flatMap(({ row, count }) =>
        Array.from({ length: count }, () => structuredClone(row)),
      )
    }
    const send = (before?: User, after?: User) => {
      if (!before) {
        userInput.sendData(
          new MultiSet(initialUsers.map((row) => [[row.id, { ...row }], 1])),
        )
        postInput.sendData(
          new MultiSet(initialPosts.map((row) => [[row.id, { ...row }], 1])),
        )
      } else {
        userInput.sendData(
          new MultiSet([
            [[before.id, { ...before }], -1],
            [[after!.id, { ...after! }], 1],
          ]),
        )
      }
      graph.run()
      return read()
    }
    return { query, send, userAlias, postAlias }
  }
  return withHistoryCleanup(
    () => {
      // Always compile and run both forms; identity never chooses the driver.
      const left = makeQuery(aliases[0], aliases[1])
      const right = makeQuery(aliases[2], aliases[3])
      const initialOutputs = [left.send(), right.send()]
      const explicit = form.startsWith('explicit')
      const identities = [
        getQueryIdentity(left.query),
        getQueryIdentity(right.query),
      ]
      if (mutant === 'constant-identity') identities[1] = identities[0]!
      expect(
        identities[0] === identities[1],
        'output-sensitive identity law',
      ).toBe(explicit)
      const expected = (
        rows: Array<User>,
        userAlias: string,
        postAlias: string,
      ): Array<unknown> => {
        if (form === 'explicit-nested') return rows.map((row) => ({ ...row }))
        if (form === 'empty-group')
          return rows.map((row) => ({ [userAlias]: { ...row } }))
        if (form === 'implicit-union')
          return [
            ...rows.map((row) => ({ [userAlias]: { ...row } })),
            ...initialPosts.map((row) => ({ [postAlias]: { ...row } })),
          ]
        return rows.flatMap((user) =>
          initialPosts
            .filter((post) => post.userId === user.id)
            .map((post) =>
              explicit
                ? { userId: user.id, label: user.label, title: post.title }
                : { [userAlias]: { ...user }, [postAlias]: { ...post } },
            ),
        )
      }
      const check = (outputs: Array<Array<unknown>>, rows: Array<User>) => {
        if (mutant === 'alias') outputs[1]![0] = { wrongAlias: outputs[1]![0] }
        if (mutant === 'missing-peer') outputs[1]!.pop()
        if (mutant === 'shared-wrong-output') {
          outputs[0] = [{ wrong: true }]
          outputs[1] = [{ wrong: true }]
        }
        expectBag(outputs[0]!, expected(rows, left.userAlias, left.postAlias))
        expectBag(outputs[1]!, expected(rows, right.userAlias, right.postAlias))
        if (explicit) expectBag(outputs[0]!, outputs[1]!)
      }
      check(initialOutputs, initialUsers)
      const updated: User = { ...initialUsers[0]!, label: label + '-updated' }
      check(
        [
          left.send(initialUsers[0], updated),
          right.send(initialUsers[0], updated),
        ],
        [updated, initialUsers[1]!],
      )
      return Promise.resolve()
    },
    () => [() => users.cleanup(), () => posts.cleanup()],
  )
}

describe('query identity agrees with compiled lexical output shape', () => {
  it.each(forms)(
    'preserves full results and multiplicity for %s',
    async (form) => {
      await runShapes(form, ['user', 'post', 'account', 'article'], 'author')
    },
  )
  it.each([101600, undefined])(
    'varies safe aliases and payloads, seed=%s',
    async (seed) => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...forms),
          fc.shuffledSubarray(
            ['user', 'post', 'account', 'article', 'writer', 'entry'],
            { minLength: 4, maxLength: 4 },
          ),
          fc.string({ maxLength: 8 }),
          (form, aliases, label) =>
            runShapes(form, aliases as [string, string, string, string], label),
        ),
        seed === undefined
          ? oraclePropertyOptions(60, `query-identity.compiled-output`)
          : { numRuns: oracleRuns(60), seed },
      )
    },
  )
  it.each([
    'alias',
    'missing-peer',
    'constant-identity',
    'shared-wrong-output',
    'fractional-weight',
  ] as const)(
    'rejects captured %s against independent results',
    async (mutant) => {
      const form = mutant === 'missing-peer' ? 'explicit-join' : 'implicit-join'
      await runShapes(form, ['user', 'post', 'account', 'article'], 'author')
      await expect(
        runShapes(
          form,
          ['user', 'post', 'account', 'article'],
          'author',
          mutant,
        ),
      ).rejects.toMatchObject({ name: 'AssertionError' })
    },
  )
})

type EqualityPair = {
  label: string
  left: unknown
  right: unknown
  equal: boolean
}

function equalityKey(value: unknown): string {
  return serializeValue(getEqualityValueIdentity(value))
}

function equalityOperandKey(value: unknown): string {
  const where = new Func(`eq`, [
    new PropRef([`row`, `value`]),
    new Value(value),
  ])
  const key = getLoadSubsetDemandKey({ where })
  if (key === undefined) throw new Error(`equality predicate lost its key`)
  return key
}

function assertEqualityPartition({ label, left, right, equal }: EqualityPair) {
  expect(equalityKey(left) === equalityKey(right), `${label}: D2 key`).toBe(
    equal,
  )
  expect(
    equalityOperandKey(left) === equalityOperandKey(right),
    `${label}: IR operand key`,
  ).toBe(equal)
  const predicate = new Func(`eq`, [new Value(left), new Value(right)])
  expect(compileExpression(predicate)({}), `${label}: predicate result`).toBe(
    left == null || right == null ? null : equal,
  )
}

// These pairs state the relation before either identity function runs. Fresh
// nested objects retain reference identity; only Date, Temporal and byte views
// have the value equality promised by the query contract.
const sharedSymbol = Symbol(`same`)
const sharedFunction = () => 1
const fixedEqualityPairs: Array<EqualityPair> = [
  { label: `signed zero`, left: -0, right: 0, equal: true },
  { label: `NaN`, left: NaN, right: NaN, equal: true },
  {
    label: `invalid Date and NaN`,
    left: new Date(Number.NaN),
    right: NaN,
    equal: true,
  },
  {
    label: `valid Date and timestamp`,
    left: new Date(1_700_000_000_000),
    right: 1_700_000_000_000,
    equal: true,
  },
  { label: `null and undefined`, left: null, right: undefined, equal: false },
  { label: `bigint and number`, left: 1n, right: 1, equal: false },
  { label: `infinities`, left: Infinity, right: -Infinity, equal: false },
  { label: `empty string`, left: ``, right: ``, equal: true },
  { label: `different strings`, left: `alpha`, right: `beta`, equal: false },
  { label: `same-prefix strings`, left: `ab`, right: `ac`, equal: false },
  {
    label: `binary and reserved-looking string`,
    left: new Uint8Array([1]),
    right: `\u0000tanstack-db:binary:\u0001`,
    equal: false,
  },
  {
    label: `different Temporal types`,
    left: Temporal.PlainDate.from(`2024-01-15`),
    right: Temporal.PlainDateTime.from(`2024-01-15T00:00`),
    equal: false,
  },
  {
    label: `different Temporal dates`,
    left: Temporal.PlainDate.from(`2024-01-15`),
    right: Temporal.PlainDate.from(`2024-01-16`),
    equal: false,
  },
  {
    label: `different Date timestamps`,
    left: new Date(100),
    right: new Date(101),
    equal: false,
  },
  {
    label: `different bytes`,
    left: Buffer.from([1, 2]),
    right: new Uint8Array([1, 3]),
    equal: false,
  },
  {
    label: `empty binary encodings`,
    left: Buffer.from([]),
    right: new Uint8Array(),
    equal: true,
  },
  {
    label: `different typed-array constructors`,
    left: new Int8Array([1]),
    right: new Uint8Array([1]),
    equal: false,
  },
  {
    label: `same symbol`,
    left: sharedSymbol,
    right: sharedSymbol,
    equal: true,
  },
  {
    label: `different symbols`,
    left: Symbol(`same`),
    right: Symbol(`same`),
    equal: false,
  },
  {
    label: `same function`,
    left: sharedFunction,
    right: sharedFunction,
    equal: true,
  },
  {
    label: `fresh functions`,
    left: () => 1,
    right: () => 1,
    equal: false,
  },
]

const equalityPairArbitrary: fc.Arbitrary<EqualityPair> = fc.oneof(
  fc.integer().map((value) => ({
    label: `number`,
    left: value,
    right: value + 1,
    equal: false,
  })),
  fc.oneof(
    fc.string().map((value) => ({
      label: `equal string`,
      left: value,
      right: value,
      equal: true,
    })),
    fc.string({ minLength: 2 }).map((value) => ({
      label: `same-prefix strings`,
      left: value,
      right: `${value.slice(0, -1)}${value.endsWith(`a`) ? `b` : `a`}`,
      equal: false,
    })),
  ),
  fc.boolean().map((value) => ({
    label: `boolean`,
    left: value,
    right: !value,
    equal: false,
  })),
  fc
    .tuple(
      fc.integer({ min: -8_639_999_999_999_000, max: 8_639_999_999_999_000 }),
      fc.constantFrom(0, 1, 1_000),
    )
    .map(([timestamp, delta]) => ({
      label: `Date`,
      left: new Date(timestamp),
      right: new Date(timestamp + delta),
      equal: delta === 0,
    })),
  fc
    .tuple(fc.integer({ min: 1, max: 27 }), fc.constantFrom(0, 1, 12))
    .map(([day, delta]) => ({
      label: `Temporal.PlainDate`,
      left: Temporal.PlainDate.from({ year: 2024, month: 1, day }),
      right: Temporal.PlainDate.from({ year: 2024, month: 1, day }).add({
        days: delta,
      }),
      equal: delta === 0,
    })),
  fc
    .tuple(fc.uint8Array({ minLength: 1, maxLength: 140 }), fc.boolean())
    .map(([bytes, equal]) => {
      const right = new Uint8Array(bytes)
      if (!equal) right[0] = right[0]! ^ 1
      return {
        label: `Buffer and Uint8Array`,
        left: Buffer.from(bytes),
        right,
        equal,
      }
    }),
  fc.array(fc.integer(), { maxLength: 5 }).map((values) => ({
    label: `fresh nested arrays`,
    left: [{ values }],
    right: [{ values: [...values] }],
    equal: false,
  })),
  fc.dictionary(fc.string(), fc.integer(), { maxKeys: 5 }).map((value) => {
    const shared = { nested: value }
    return {
      label: `same nested object`,
      left: shared,
      right: shared,
      equal: true,
    }
  }),
)

describe(`equality-value and IR operand identity agree`, () => {
  it.each(fixedEqualityPairs)(`partitions $label as declared`, (pair) => {
    assertEqualityPartition(pair)
  })

  it.each(fixedEqualityPairs)(
    `materializes $label into the declared public groups`,
    async ({ left, right, equal }) => {
      const source = createCollection(
        mockSyncCollectionOptions<{ id: number; value: unknown }>({
          id: `equality-identity-public-groups`,
          getKey: (row) => row.id,
          initialData: [
            { id: 1, value: left },
            { id: 2, value: right },
          ],
        }),
      )
      const groups = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ source })
            .groupBy(({ source: row }) => row.value)
            .select(({ source: row }) => ({
              value: row.value,
              count: countRows(row.id),
            })),
      })
      await withHistoryCleanup(
        () => {
          expect(groups.size).toBe(equal ? 1 : 2)
          expect(groups.toArray.map((row) => row.count).sort()).toStrictEqual(
            equal ? [2] : [1, 1],
          )
          return Promise.resolve()
        },
        () => [() => groups.cleanup(), () => source.cleanup()],
      )
    },
  )

  it.each([20260928, undefined])(
    `agrees across the supported value grammar, seed=%s`,
    async (seed) => {
      await fc.assert(
        fc.asyncProperty(equalityPairArbitrary, (pair) => {
          assertEqualityPartition(pair)
          return Promise.resolve()
        }),
        seed === undefined
          ? oraclePropertyOptions(160, `query-identity.equality-partition`)
          : { numRuns: oracleRuns(160), seed },
      )
    },
  )
})

/**
 * AND is commutative, associative and idempotent, but changing an operand can
 * change the output. The feature request extends the existing identity law to
 * compound joins. This finite grammar varies syntax and direct/from/joined
 * QueryRef boundaries. The independent model is a nested loop over numeric
 * rows; fresh public Collections must match it before identity is compared.
 * These are initial-publication witnesses, not arbitrary cache histories.
 */
describe(`compound join identity and output`, () => {
  for (const boundary of [`direct`, `from`, `joined`] as const) {
    it(`retains every equality across ${boundary}`, async () => {
      const leftRows = [
        { id: 1, a: 1, b: 2, c: 9 },
        { id: 2, a: 1, b: 3, c: 8 },
      ]
      const rightRows = [
        { id: 10, a: 1, b: 2, c: 3 },
        { id: 11, a: 1, b: 3, c: 7 },
      ]
      const left = createCollection(
        mockSyncCollectionOptions({
          id: `compound-identity-left`,
          getKey: (row: (typeof leftRows)[number]) => row.id,
          initialData: leftRows,
        }),
      )
      const right = createCollection(
        mockSyncCollectionOptions({
          id: `compound-identity-right`,
          getKey: (row: (typeof rightRows)[number]) => row.id,
          initialData: rightRows,
        }),
      )
      const cleanups: Array<() => Promise<void>> = [
        () => left.cleanup(),
        () => right.cleanup(),
      ]
      await withHistoryCleanup(
        async () => {
          const own = <T extends { cleanup: () => Promise<void> }>(
            live: T,
          ): T => {
            cleanups.unshift(() => live.cleanup())
            return live
          }
          const makeQuery = (
            variant: `base` | `reordered` | `nested` | `different`,
          ) => {
            const joined = new Query()
              .from({ left })
              .innerJoin({ right }, ({ left: l, right: r }) => {
                const a = eq(l.a, r.a)
                const b = eq(l.b, variant === `different` ? r.c : r.b)
                if (variant === `reordered`)
                  return and(eq(r.b, l.b), eq(r.a, l.a))
                if (variant === `nested`) return and(b, and(a, b))
                return and(a, b)
              })
              .select(({ left: l, right: r }) => ({
                leftId: l.id,
                rightId: r.id,
              }))
            if (boundary === `direct`)
              return {
                ir: getQueryIR(joined),
                live: own(createLiveQueryCollection({ query: joined })),
              }
            if (boundary === `from`) {
              const query = new Query()
                .from({ result: joined })
                .select(({ result }) => ({
                  leftId: result.leftId,
                  rightId: result.rightId,
                }))
              return {
                ir: getQueryIR(query),
                live: own(createLiveQueryCollection({ query })),
              }
            }
            const query = new Query()
              .from({ anchor: left })
              .innerJoin({ result: joined }, ({ anchor, result }) =>
                eq(anchor.id, result.leftId),
              )
              .select(({ result }) => ({
                leftId: result.leftId,
                rightId: result.rightId,
              }))
            return {
              ir: getQueryIR(query),
              live: own(createLiveQueryCollection({ query })),
            }
          }
          const queries = {
            base: makeQuery(`base`),
            reordered: makeQuery(`reordered`),
            nested: makeQuery(`nested`),
            different: makeQuery(`different`),
          }
          for (const [variant, { live }] of Object.entries(queries)) {
            await live.preload()
            const expected = leftRows.flatMap((l) =>
              rightRows
                .filter(
                  (r) =>
                    l.a === r.a &&
                    l.b === (variant === `different` ? r.c : r.b),
                )
                .map((r) => ({ leftId: l.id, rightId: r.id })),
            )
            expectBag(
              live.toArray.map(({ leftId, rightId }) => ({ leftId, rightId })),
              expected,
            )
          }
          const { base, reordered, nested, different } = queries
          expect(getQueryIdentity(base.ir)).toBe(getQueryIdentity(reordered.ir))
          expect(getQueryIdentity(base.ir)).toBe(getQueryIdentity(nested.ir))
          expect(
            getQueryIdentity(base.ir),
            `different later operand changes identity`,
          ).not.toBe(getQueryIdentity(different.ir))
          expect(
            queriesMatchForCaching(base.ir, different.ir),
            `different later operand cannot reuse a subquery`,
          ).toBe(false)
        },
        () => cleanups,
      )
    })
  }
})
