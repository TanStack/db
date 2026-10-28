// Hand-written equality pairs that pin the value relation, and the public group
// rows they produce. identity-output-shape-oracle.test.ts owns the law and its
// generated campaign.
import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { count as countRows } from '../../src/query/builder/functions.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { mockSyncCollectionOptions } from '../utils.js'
import { assertEqualityPartition } from './identity-output-shape-support.js'
import type { EqualityPair } from './identity-output-shape-support.js'

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
})
