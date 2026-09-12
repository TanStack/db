import { expect, it } from 'vitest'
import { BTreeIndex, createCollection, createLiveQueryCollection } from '../src'
import { Func, PropRef, Value } from '../src/query/ir'
import { makeInfiniteOnDemandSource } from './conformance/infinite-on-demand'
import { selectedRow } from './conformance/result-laws'
import type { LoadSubsetOptions } from '../src'

const runtime = { BTreeIndex, createCollection }
const rows = [1, 4, 2, 3].map((rank) => ({
  id: `${rank}`,
  rank,
  label: `row${rank}`,
}))
const rankRef = () => new PropRef([`rank`])
const orderBy = (): NonNullable<LoadSubsetOptions[`orderBy`]> => [
  {
    expression: rankRef(),
    compareOptions: { direction: `desc`, nulls: `first` },
  },
]
const cursor = () => ({
  whereFrom: new Func(`lt`, [rankRef(), new Value(3)]),
  whereCurrent: new Func(`eq`, [rankRef(), new Value(3)]),
})

it.each([
  { name: `prefix`, options: { orderBy: orderBy(), limit: 2 }, ranks: [3, 4] },
  {
    name: `offset`,
    options: { orderBy: orderBy(), offset: 1, limit: 2 },
    ranks: [2, 3],
  },
  {
    name: `suffix`,
    options: { orderBy: orderBy(), cursor: cursor(), offset: 3, limit: 2 },
    ranks: [1, 2],
  },
  {
    name: `boundary`,
    options: { where: new Func(`eq`, [rankRef(), new Value(3)]) },
    ranks: [3],
  },
  {
    name: `reversed boundary`,
    options: { where: new Func(`eq`, [new Value(3), rankRef()]) },
    ranks: [3],
  },
])(
  `serves the complete $name request with independent literal rows`,
  async ({ options, ranks }) => {
    const { collection, calls } = makeInfiniteOnDemandSource(runtime, rows)
    try {
      await collection._sync.loadSubset(options)
      expect(
        [...collection.values()]
          .sort((a, b) => a.rank - b.rank)
          .map(selectedRow),
      ).toEqual(
        ranks.map((rank) => ({ id: `${rank}`, rank, label: `row${rank}` })),
      )
      expect(calls).toHaveLength(1)
    } finally {
      await collection.cleanup()
    }
  },
)

const invalidRequests: Array<LoadSubsetOptions> = [
  {},
  {
    orderBy: [
      {
        expression: rankRef(),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ],
  },
  {
    orderBy: [
      {
        expression: new PropRef([`other`]),
        compareOptions: { direction: `desc`, nulls: `first` },
      },
    ],
  },
  { orderBy: orderBy(), limit: -1 },
  { orderBy: orderBy(), offset: 0.5 },
  { orderBy: orderBy(), limit: Infinity },
  { where: new Func(`lt`, [rankRef(), new Value(3)]) },
  { where: new Func(`eq`, [rankRef(), new Value(true)]) },
  { where: new Func(`eq`, [rankRef(), new Value(3)]), limit: 1 },
  {
    orderBy: orderBy(),
    cursor: { ...cursor(), whereCurrent: new Func(`unknown`, []) },
  },
  {
    orderBy: orderBy(),
    cursor: {
      ...cursor(),
      whereFrom: new Func(`and`, [
        new Value(false),
        new Func(`eq`, [rankRef()]),
      ]),
    },
  },
]
it.each(invalidRequests)(
  `rejects unsupported request %# even on an empty backend`,
  async (options) => {
    const { collection, calls } = makeInfiniteOnDemandSource(runtime, [])
    try {
      await expect(async () =>
        collection._sync.loadSubset(options),
      ).rejects.toThrow()
      expect(calls).toEqual([])
      expect(collection.size).toBe(0)
    } finally {
      await collection.cleanup()
    }
  },
)

it(`captures rows, both cursor trees and comparator options before asynchronous delivery`, async () => {
  const input = rows.map((row) => ({ ...row }))
  const options: LoadSubsetOptions = {
    orderBy: orderBy(),
    cursor: cursor(),
    limit: 2,
  }
  const { collection, calls } = makeInfiniteOnDemandSource(runtime, input, 1)
  let pending: ReturnType<typeof collection._sync.loadSubset> | undefined
  try {
    pending = collection._sync.loadSubset(options)
    if (pending instanceof Promise) void pending.catch(() => undefined)
    input[0]!.label = `mutated`
    options.limit = 0
    options.orderBy![0]!.compareOptions.direction = `asc`
    options.cursor!.whereFrom = new Value(false)
    options.cursor!.whereCurrent = new Value(false)
    await pending
    expect(
      [...collection.values()].sort((a, b) => a.rank - b.rank).map(selectedRow),
    ).toEqual([
      { id: `1`, rank: 1, label: `row1` },
      { id: `2`, rank: 2, label: `row2` },
    ])
    expect(calls[0]).toEqual({ orderBy: orderBy(), cursor: cursor(), limit: 2 })
    expect(Object.isFrozen(calls[0]!.cursor!.whereCurrent)).toBe(true)
    expect(Object.isFrozen(calls[0]!.orderBy![0]!.compareOptions)).toBe(true)
  } finally {
    await pending
    await collection.cleanup()
  }
})

it.each([undefined, 1])(
  `drives a real cold query and larger window delay=%s`,
  async (delay) => {
    const { collection } = makeInfiniteOnDemandSource(runtime, rows, delay)
    const query = createLiveQueryCollection((q) =>
      q
        .from({ row: collection })
        .orderBy(({ row }) => row.rank, `desc`)
        .limit(2),
    )
    try {
      await query.preload()
      expect([...query.values()].map(selectedRow)).toEqual([
        { id: `4`, rank: 4, label: `row4` },
        { id: `3`, rank: 3, label: `row3` },
      ])
      await query.utils.setWindow({ offset: 0, limit: 4 })
      expect([...query.values()].map(selectedRow)).toEqual(
        [4, 3, 2, 1].map((rank) => ({
          id: `${rank}`,
          rank,
          label: `row${rank}`,
        })),
      )
    } finally {
      await query.cleanup()
      await collection.cleanup()
    }
  },
)
