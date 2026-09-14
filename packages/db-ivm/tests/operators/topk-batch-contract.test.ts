import { afterEach, expect, it, vi } from 'vitest'
import { MultiSet } from '../../src/multiset.js'
import * as hashing from '../../src/hashing/index.js'
import { topKBatch } from '../../src/operators/topKState.js'
import { D2 } from '../../src/d2.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { output } from '../../src/operators/index.js'

afterEach(() => vi.restoreAllMocks())

it(`keeps distinct row keys when structural hashes collide`, () => {
  // A hash is an accelerator, never proof that two keyed rows are equal.
  vi.spyOn(hashing, `hash`).mockReturnValue(7)
  const batch = new MultiSet<[string | number, { id: number }]>([
    [[1, { id: 1 }], 1],
    [[`1`, { id: 2 }], 1],
  ])
  expect([...topKBatch([batch])]).toEqual(batch.getInner())
})

it(`does not inspect payloads when each key occurs once`, () => {
  let reads = 0
  const rows = Array.from({ length: 100 }, (_, id) => ({
    id,
    get unused() {
      reads++
      return id
    },
  }))
  const batch = new MultiSet<[number, (typeof rows)[number]]>(
    rows.map((row) => [[row.id, row], 1]),
  )
  const actual = [...topKBatch([batch])]
  expect(reads).toBe(0)
  expect(actual).toHaveLength(rows.length)
  for (const [index, [[key, row], weight]] of actual.entries()) {
    expect(key).toBe(index)
    expect(row).toBe(rows[index])
    expect(weight).toBe(1)
  }
})

it.each([`plain cycle`, `class cycle`, `large payload`] as const)(
  `orders a unique key without imposing a structural hash domain: %s`,
  (kind) => {
    class Row {
      id = 1
      payload: unknown
    }
    const row =
      kind === `class cycle`
        ? new Row()
        : { id: 1, payload: undefined as unknown }
    row.payload = kind === `large payload` ? new Array(1_000_001).fill(0) : row
    const entries = [
      ...topKBatch([new MultiSet<[number, typeof row]>([[[1, row], 1]])]),
    ]
    expect(entries).toHaveLength(1)
    expect(entries[0]![0][1]).toBe(row)
    expect(entries[0]![1]).toBe(1)
    const graph = new D2()
    const input = graph.newInput<[number, typeof row]>()
    const observed: Array<[[number, [typeof row, string]], number]> = []
    input.pipe(
      topKWithFractionalIndex((a, b) => a.id - b.id, { limit: 1 }),
      output((message) => observed.push(...message.getInner())),
    )
    graph.finalize()
    input.sendData(new MultiSet([[[1, row], 1]]))
    graph.run()
    expect(observed).toHaveLength(1)
    expect(observed[0]![0][1][0]).toBe(row)
    expect(observed[0]![1]).toBe(1)
  },
)

it(`consolidates structurally equal fresh transient values before replacements`, () => {
  const batch = new MultiSet<[number, { value: string }]>([
    [[1, { value: `new` }], 1],
    [[1, { value: `temporary` }], 1],
    [[1, { value: `old` }], -1],
    [[1, { value: `temporary` }], -1],
  ])
  expect([...topKBatch([batch])]).toEqual([
    [[1, { value: `old` }], -1],
    [[1, { value: `new` }], 1],
  ])
})
