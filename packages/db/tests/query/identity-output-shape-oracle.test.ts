import { isDeepStrictEqual } from 'node:util'
import { runInNewContext } from 'node:vm'
import { D2, MultiSet, output } from '@tanstack/db-ivm'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { getLiveQueryHash } from '../../src/live-query-options.js'
import { compileQuery } from '../../src/query/compiler/index.js'
import { compileExpression } from '../../src/query/compiler/evaluators.js'
import {
  getLoadSubsetDemandKey,
  getQueryIdentity,
  getStableValueHash,
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
 * Fault drivers remove peers, collapse identity, corrupt aliases or weights,
 * and require the checker to fail. This calibrates the implication that matters:
 * equal QueryIdentity implies equal compiled results, not merely equal hashes.
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
type Fault =
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
  fault?: Fault,
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
                    left: new PropRef([userAlias, 'id']),
                    right: new PropRef([postAlias, 'userId']),
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
          entry.count += fault === 'fractional-weight' ? weight * 1.25 : weight
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
      if (fault === 'constant-identity') identities[1] = identities[0]!
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
        if (fault === 'alias') outputs[1]![0] = { wrongAlias: outputs[1]![0] }
        if (fault === 'missing-peer') outputs[1]!.pop()
        if (fault === 'shared-wrong-output') {
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
    async (fault) => {
      const form = fault === 'missing-peer' ? 'explicit-join' : 'implicit-join'
      await runShapes(form, ['user', 'post', 'account', 'article'], 'author')
      await expect(
        runShapes(
          form,
          ['user', 'post', 'account', 'article'],
          'author',
          fault,
        ),
      ).rejects.toMatchObject({ name: 'AssertionError' })
    },
  )
})

/**
 * Views with the same element type, bytes, and trusted local built-in conversion
 * denote the same ordering operand. A changed conversion can change `gt` and
 * must keep the demand and query identities distinct. Foreign views use
 * reference identity when their conversion provenance is uncertain. The model
 * uses native relational comparison on finite row values. The grammar varies
 * bytes and tag ownership,
 * then checks explicit conversion overrides and spoofed byte accessors. The
 * driver compiles the predicate and computes identities. Equality has a
 * separate law: equal keys must not combine candidates with different indexed
 * bytes, even when a custom iterator reports the same values. It compares
 * those observations after each call.
 * Constructor names do not belong to the denotation.
 */
describe('binary query value identity', () => {
  it('rejects changed foreign prototype methods before calling them', () => {
    const witnesses = [
      runInNewContext(`
        let calls = 0
        Object.getPrototypeOf(Uint8Array.prototype).toString = function () {
          calls++
          return calls === 1 ? '1' : '9'
        }
        ;({ value: new Uint8Array([1]), calls: () => calls })
      `),
      runInNewContext(`
        let calls = 0
        Object.getPrototypeOf(Uint8Array.prototype).join = function () {
          calls++
          return calls === 1 ? '1' : '9'
        }
        ;({ value: new Uint8Array([1]), calls: () => calls })
      `),
      runInNewContext(`
        let calls = 0
        Object.prototype.valueOf = function () {
          calls++
          return this
        }
        ;({ value: new Uint8Array([1]), calls: () => calls })
      `),
      runInNewContext(`
        let calls = 0
        Object.prototype.toString = function () {
          calls++
          return calls === 1 ? '[object DataView]' : '9'
        }
        ;({ value: new DataView(new Uint8Array([1]).buffer), calls: () => calls })
      `),
    ] as Array<{ value: ArrayBufferView; calls: () => number }>

    for (const { value, calls } of witnesses) {
      expect(() => getStableValueHash(value)).toThrow(
        'view with custom conversion',
      )
      expect(calls()).toBe(0)
    }
  })

  it('rejects an own DataView tag getter before it can change conversion', () => {
    const foreign = runInNewContext(`
      let calls = 0
      const value = new DataView(new Uint8Array([1]).buffer)
      Object.defineProperty(value, Symbol.toStringTag, {
        get() {
          calls++
          return calls <= 3 ? 'DataView' : 'Changed'
        },
      })
      ;({ value, calls: () => calls })
    `) as { value: DataView; calls: () => number }

    expect(() => getStableValueHash(foreign.value)).toThrow(
      'view with custom conversion',
    )
    expect(foreign.calls()).toBe(0)
  })

  it('does not trust conversion methods changed in another realm', () => {
    const foreignArray = runInNewContext(`
      Object.getPrototypeOf(Uint8Array.prototype).toString = () => '9'
      new Uint8Array([1])
    `) as Uint8Array
    const foreignDataView = runInNewContext(`
      Object.prototype.toString = () => '9'
      new DataView(new Uint8Array([1]).buffer)
    `) as DataView
    const foreignJoinedArray = runInNewContext(`
      Object.getPrototypeOf(Uint8Array.prototype).join = () => '9'
      new Uint8Array([1])
    `) as Uint8Array
    const foreignTaggedDataView = runInNewContext(`
      const value = new DataView(new Uint8Array([1]).buffer)
      Object.defineProperty(value, Symbol.toStringTag, { value: 'A' })
      value
    `) as DataView
    const field = new PropRef<ArrayBufferView>(['row', 'value'])
    const predicate = (value: ArrayBufferView) =>
      new Func<boolean>('gt', [field, new Value(value)])

    for (const [host, foreign, row, hostResult, foreignResult] of [
      [new Uint8Array([1]), foreignArray, new Uint8Array([5]), true, false],
      [
        new Uint8Array([1]),
        foreignJoinedArray,
        new Uint8Array([5]),
        true,
        false,
      ],
      [
        new DataView(new Uint8Array([1]).buffer),
        foreignDataView,
        new DataView(new Uint8Array([1]).buffer),
        false,
        true,
      ],
      [
        new DataView(new Uint8Array([1]).buffer),
        foreignTaggedDataView,
        new DataView(new Uint8Array([1]).buffer),
        false,
        true,
      ],
    ] as const) {
      const input = { row: { value: row } }
      expect(compileExpression(predicate(host))(input)).toBe(hostResult)
      expect(compileExpression(predicate(foreign))(input)).toBe(foreignResult)
      expect(() => getStableValueHash(foreign)).toThrow(
        'view with custom conversion',
      )
      expect(getLoadSubsetDemandKey({ where: predicate(foreign) })).not.toBe(
        getLoadSubsetDemandKey({ where: predicate(host) }),
      )
    }
  })

  it('keeps recognized Buffer copies hashable without merging conversions', () => {
    const createRealmBuffer = () =>
      runInNewContext(`
        class RealmBuffer extends Uint8Array {
          toString() { return Array.prototype.join.call(this, ',') }
        }
        RealmBuffer
      `) as typeof Uint8Array
    const firstRealmBuffer = createRealmBuffer()
    const secondRealmBuffer = createRealmBuffer()
    const changedRealmBuffer = createRealmBuffer()
    changedRealmBuffer.prototype.toString = () => '9'
    const first = new firstRealmBuffer([1])
    const second = new secondRealmBuffer([1])
    const changed = new changedRealmBuffer([1])
    class CustomConversion extends secondRealmBuffer {
      override toString(): string {
        return '9'
      }
    }

    // Browser Buffer polyfills can recognize Buffers from another realm or
    // bundled copy while their prototype methods are different objects.
    vi.stubGlobal('Buffer', {
      isBuffer: (value: unknown) =>
        value instanceof firstRealmBuffer ||
        value instanceof secondRealmBuffer ||
        value instanceof changedRealmBuffer,
      prototype: firstRealmBuffer.prototype,
    })
    try {
      expect(new Uint8Array([5]) > first).toBe(new Uint8Array([5]) > second)
      expect(new Uint8Array([5]) > first).toBe(true)
      expect(new Uint8Array([5]) > changed).toBe(false)
      expect(getStableValueHash(second)).not.toBe(getStableValueHash(first))
      expect(getStableValueHash(changed)).not.toBe(getStableValueHash(first))
      expect(getLiveQueryHash(undefined, [second])).not.toBe(
        getLiveQueryHash(undefined, [first]),
      )
      expect(getLiveQueryHash(undefined, [second])).toBe(
        getLiveQueryHash(undefined, [second]),
      )
      expect(() => getStableValueHash(new CustomConversion([1]))).toThrow(
        'view with custom conversion',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not merge Buffers whose shadowed length changes ordering', () => {
    const normal = Buffer.from([65, 66])
    const ownLength = Buffer.from([65, 66])
    Object.defineProperty(ownLength, 'length', { value: 1 })
    const inheritedLength = Buffer.from([65, 66])
    Object.setPrototypeOf(
      inheritedLength,
      Object.create(Buffer.prototype, { length: { value: 1 } }),
    )
    const row = { row: { value: Buffer.from([65, 66]) } }
    const collection = createCollection<{ id: number; value: Buffer }>({
      getKey: (value) => value.id,
      sync: { sync: () => {} },
    })
    const source = new CollectionRef(
      collection as unknown as CollectionImpl,
      'row',
    )
    const field = new PropRef<Buffer>(['row', 'value'])
    const predicate = (value: Buffer) =>
      new Func<boolean>('gt', [field, new Value(value)])
    const identity = (value: Buffer) =>
      getQueryIdentity({ from: source, where: [predicate(value)] })

    expect(compileExpression(predicate(normal))(row)).toBe(false)
    for (const shortened of [ownLength, inheritedLength]) {
      expect(compileExpression(predicate(shortened))(row)).toBe(true)
      expect(() => getStableValueHash(shortened)).toThrow(
        'view with custom conversion',
      )
      expect(getLoadSubsetDemandKey({ where: predicate(shortened) })).not.toBe(
        getLoadSubsetDemandKey({ where: predicate(normal) }),
      )
      expect(identity(shortened)).not.toBe(identity(normal))
    }
  })

  it.each([101610, undefined])(
    'uses built-in element type and bytes for inherited typed-array behavior, seed=%s',
    async (seed) => {
      class InheritedUint8Array extends Uint8Array {}
      class InheritedInt16Array extends Int16Array {}
      class TaggedUint8Array extends Uint8Array {
        constructor(bytes: Uint8Array) {
          super(bytes)
          Object.defineProperty(this, Symbol.toStringTag, {
            value: 'custom-view-tag',
          })
        }
      }
      const collection = createCollection<{ id: number; value: Uint8Array }>({
        getKey: (row) => row.id,
        sync: { sync: () => {} },
      })
      const source = new CollectionRef(
        collection as unknown as CollectionImpl,
        'row',
      )
      const field = new PropRef<ArrayBufferView>(['row', 'value'])
      const predicate = (value: ArrayBufferView) =>
        new Func<boolean>('gt', [field, new Value(value)])
      const query = (value: ArrayBufferView): QueryIR => ({
        from: source,
        where: [predicate(value)],
      })

      await withHistoryCleanup(
        async () => {
          await fc.assert(
            fc.asyncProperty(
              fc.uint8Array({ minLength: 0, maxLength: 8 }),
              fc.boolean(),
              (bytes, customTag) => {
                const base = new Uint8Array(bytes)
                const inherited = customTag
                  ? new TaggedUint8Array(bytes)
                  : new InheritedUint8Array(bytes)
                for (const row of [
                  new Uint8Array([0]),
                  bytes,
                  new Uint8Array([255]),
                ]) {
                  const expected = row > base
                  expect(row > inherited).toBe(expected)
                  expect(
                    compileExpression(predicate(base))({ row: { value: row } }),
                  ).toBe(expected)
                  expect(
                    compileExpression(predicate(inherited))({
                      row: { value: row },
                    }),
                  ).toBe(expected)
                }

                expect(getStableValueHash(inherited)).toBe(
                  getStableValueHash(base),
                )
                expect(getQueryIdentity(query(inherited))).toBe(
                  getQueryIdentity(query(base)),
                )
                expect(
                  getLoadSubsetDemandKey({ where: predicate(inherited) }),
                ).toBe(getLoadSubsetDemandKey({ where: predicate(base) }))
                expect(getStableValueHash(Buffer.from(bytes))).not.toBe(
                  getStableValueHash(base),
                )

                // Equality reads indexed bytes. Iteration is user-overridable
                // and must not give unequal predicates the same identity.
                const equalCandidate = new Uint8Array([...bytes, 1])
                const differentCandidate = new Uint8Array([...bytes, 9])
                Object.defineProperty(differentCandidate, Symbol.iterator, {
                  value: function* () {
                    yield* equalCandidate
                  },
                })
                const sameCandidate = new Uint8Array(equalCandidate)
                Object.defineProperty(sameCandidate, Symbol.iterator, {
                  value: function* () {
                    yield 9
                  },
                })
                const equalBuffer = Buffer.from(equalCandidate)
                const differentBuffer = Buffer.from(differentCandidate)
                Object.defineProperty(differentBuffer, Symbol.iterator, {
                  value: function* () {
                    yield* equalCandidate
                  },
                })
                const differentLength = new Uint8Array(equalCandidate)
                Object.defineProperty(differentLength, 'byteLength', {
                  value: 0,
                })
                const nanLengthA = new Uint8Array(equalCandidate)
                const nanLengthB = new Uint8Array(equalCandidate)
                Object.defineProperty(nanLengthA, 'byteLength', { value: NaN })
                Object.defineProperty(nanLengthB, 'byteLength', { value: NaN })
                for (const operator of ['eq', 'in'] as const) {
                  const equalityPredicate = (candidate: Uint8Array) =>
                    new Func<boolean>(operator, [
                      field,
                      new Value(operator === 'in' ? [candidate] : candidate),
                    ])
                  const expectedRow = { row: { value: equalCandidate } }
                  const matches = (candidate: Uint8Array) =>
                    compileExpression(equalityPredicate(candidate))(expectedRow)
                  const identity = (candidate: Uint8Array) =>
                    getQueryIdentity({
                      from: source,
                      where: [equalityPredicate(candidate)],
                    })
                  const demandKey = (candidate: Uint8Array) =>
                    getLoadSubsetDemandKey({
                      where: equalityPredicate(candidate),
                    })
                  const baseIdentity = identity(equalCandidate)
                  const baseDemandKey = demandKey(equalCandidate)

                  expect(matches(equalCandidate)).toBe(true)
                  expect(matches(sameCandidate)).toBe(true)
                  expect(matches(equalBuffer)).toBe(true)
                  expect(matches(differentCandidate)).toBe(false)
                  expect(matches(differentBuffer)).toBe(false)
                  expect(matches(differentLength)).toBe(false)
                  const nanRow = { row: { value: nanLengthA } }
                  expect(
                    compileExpression(equalityPredicate(nanLengthA))(nanRow),
                  ).toBe(true)
                  expect(
                    compileExpression(equalityPredicate(nanLengthB))(nanRow),
                  ).toBe(false)
                  expect(identity(sameCandidate)).toBe(baseIdentity)
                  expect(identity(equalBuffer)).toBe(baseIdentity)
                  expect(identity(differentCandidate)).not.toBe(baseIdentity)
                  expect(identity(differentBuffer)).not.toBe(baseIdentity)
                  expect(identity(differentLength)).not.toBe(baseIdentity)
                  expect(identity(nanLengthA)).not.toBe(identity(nanLengthB))
                  expect(demandKey(sameCandidate)).toBe(baseDemandKey)
                  expect(demandKey(equalBuffer)).toBe(baseDemandKey)
                  expect(demandKey(differentCandidate)).not.toBe(baseDemandKey)
                  expect(demandKey(differentBuffer)).not.toBe(baseDemandKey)
                  expect(demandKey(differentLength)).not.toBe(baseDemandKey)
                  expect(demandKey(nanLengthA)).not.toBe(demandKey(nanLengthB))
                }
                return Promise.resolve()
              },
            ),
            seed === undefined
              ? oraclePropertyOptions(60, `query-identity.typed-array-subclass`)
              : { numRuns: oracleRuns(60), seed },
          )

          const data = new ArrayBuffer(2)
          new Uint8Array(data).set([1, 2])
          const baseInt16 = new Int16Array([257])
          const inheritedInt16 = new InheritedInt16Array([257])
          expect(getStableValueHash(inheritedInt16)).toBe(
            getStableValueHash(baseInt16),
          )
          expect(getQueryIdentity(query(inheritedInt16))).toBe(
            getQueryIdentity(query(baseInt16)),
          )
          expect(
            getLoadSubsetDemandKey({ where: predicate(inheritedInt16) }),
          ).toBe(getLoadSubsetDemandKey({ where: predicate(baseInt16) }))

          class ConvertedUint8Array extends Uint8Array {
            override toString(): string {
              return '9'
            }
          }
          const base = new Uint8Array([1])
          const converted = new ConvertedUint8Array([1])
          const row = new Uint8Array([5])
          expect(
            compileExpression(predicate(base))({ row: { value: row } }),
          ).toBe(true)
          expect(
            compileExpression(predicate(converted))({ row: { value: row } }),
          ).toBe(false)
          expect(getQueryIdentity(query(converted))).not.toBe(
            getQueryIdentity(query(base)),
          )
          expect(
            getLoadSubsetDemandKey({ where: predicate(converted) }),
          ).not.toBe(getLoadSubsetDemandKey({ where: predicate(base) }))
          expect(getLoadSubsetDemandKey({ where: predicate(converted) })).toBe(
            getLoadSubsetDemandKey({ where: predicate(converted) }),
          )
          expect(() => getStableValueHash(converted)).toThrow(
            'view with custom conversion',
          )

          class JoinedUint8Array extends Uint8Array {
            override join(): string {
              return '9'
            }
          }
          const joined = new JoinedUint8Array([1])
          expect(
            compileExpression(predicate(joined))({ row: { value: row } }),
          ).toBe(false)
          expect(getLoadSubsetDemandKey({ where: predicate(joined) })).not.toBe(
            getLoadSubsetDemandKey({ where: predicate(base) }),
          )
          for (const method of ['valueOf', Symbol.toPrimitive] as const) {
            const altered = new Uint8Array([1])
            Object.defineProperty(altered, method, { value: () => 9 })
            expect(
              compileExpression(predicate(altered))({ row: { value: row } }),
            ).toBe(false)
            expect(
              getLoadSubsetDemandKey({ where: predicate(altered) }),
            ).not.toBe(getLoadSubsetDemandKey({ where: predicate(base) }))
          }

          class SpoofedBufferUint8Array extends Uint8Array {
            constructor() {
              super([9])
              Object.defineProperty(this, 'buffer', {
                value: new Uint8Array([1]).buffer,
              })
            }
          }
          const spoofedBuffer = new SpoofedBufferUint8Array()
          const spoofedOffset = new Uint8Array(
            new Uint8Array([9, 1]).buffer,
            0,
            1,
          )
          Object.defineProperty(spoofedOffset, 'byteOffset', { value: 1 })
          const spoofedLength = new Uint8Array([1, 9])
          Object.defineProperty(spoofedLength, 'byteLength', { value: 1 })
          const byteBase = new Uint8Array([1])
          const byteRow = new Uint8Array([1, 5])
          for (const spoofed of [spoofedBuffer, spoofedOffset, spoofedLength]) {
            expect(byteRow > byteBase).toBe(true)
            expect(byteRow > spoofed).toBe(false)
            expect(
              compileExpression(predicate(spoofed))({
                row: { value: byteRow },
              }),
            ).toBe(false)
            expect(getStableValueHash(spoofed)).not.toBe(
              getStableValueHash(byteBase),
            )
            expect(getQueryIdentity(query(spoofed))).not.toBe(
              getQueryIdentity(query(byteBase)),
            )
            expect(
              getLoadSubsetDemandKey({ where: predicate(spoofed) }),
            ).not.toBe(getLoadSubsetDemandKey({ where: predicate(byteBase) }))
          }

          const nodeBuffer = Buffer.alloc(1, 9)
          Object.defineProperty(nodeBuffer, 'buffer', {
            value: Buffer.alloc(1, 1).buffer,
          })
          expect(getStableValueHash(nodeBuffer)).not.toBe(
            getStableValueHash(Buffer.alloc(1, 1)),
          )

          const spoofedDataView = new DataView(new Uint8Array([9]).buffer)
          Object.defineProperty(spoofedDataView, 'buffer', {
            value: new Uint8Array([1]).buffer,
          })
          const spoofedDataViewOffset = new DataView(
            new Uint8Array([9, 1]).buffer,
            0,
            1,
          )
          Object.defineProperty(spoofedDataViewOffset, 'byteOffset', {
            value: 1,
          })
          const spoofedDataViewLength = new DataView(
            new Uint8Array([1, 9]).buffer,
          )
          Object.defineProperty(spoofedDataViewLength, 'byteLength', {
            value: 1,
          })
          const dataViewBase = new DataView(new Uint8Array([1]).buffer)
          for (const spoofed of [
            spoofedDataView,
            spoofedDataViewOffset,
            spoofedDataViewLength,
          ]) {
            expect(getStableValueHash(spoofed)).not.toBe(
              getStableValueHash(dataViewBase),
            )
          }

          const plainDataView = new DataView(data)
          const taggedDataView = new DataView(data)
          Object.defineProperty(taggedDataView, Symbol.toStringTag, {
            value: 'AAA',
          })
          expect(
            compileExpression(predicate(plainDataView))({
              row: { value: plainDataView },
            }),
          ).toBe(false)
          expect(
            compileExpression(predicate(taggedDataView))({
              row: { value: plainDataView },
            }),
          ).toBe(true)
          expect(getQueryIdentity(query(taggedDataView))).not.toBe(
            getQueryIdentity(query(plainDataView)),
          )
          expect(
            getLoadSubsetDemandKey({ where: predicate(taggedDataView) }),
          ).not.toBe(
            getLoadSubsetDemandKey({ where: predicate(plainDataView) }),
          )
          expect(() => getStableValueHash(taggedDataView)).toThrow(
            'view with custom conversion',
          )
        },
        () => [() => collection.cleanup()],
      )
    },
  )
})
