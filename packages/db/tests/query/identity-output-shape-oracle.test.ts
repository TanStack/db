import { isDeepStrictEqual } from 'node:util'
import { D2, MultiSet, output } from '@tanstack/db-ivm'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { compileQuery } from '../../src/query/compiler/index.js'
import { getQueryIdentity } from '../../src/query/ir-stable-identity.js'
import {
  CollectionRef,
  PropRef,
  QueryRef,
  UnionFrom,
} from '../../src/query/ir.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import type { CollectionImpl } from '../../src/collection/index.js'
import type { QueryIR } from '../../src/query/ir.js'

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
