/**
 * Convex values must keep their meaning through the durable outbox, including
 * integers, binary data, special floats, and removed (undefined) fields. The
 * reference is the authored native tree. An observation projection labels
 * scalar types and bytes, so JSON normalization cannot pass as equality.
 *
 * Bounded trees combine native leaves, arrays, ordinary fields, and marker-like
 * user data. A real OutboxManager writes each transaction, then a fresh manager
 * and Collection restore it with convexMutationCodec. Comparison happens on all
 * three restored mutation payloads, before any provider call. The core serializer
 * owner covers wire dispatch and unsupported codecs; this receives that contract
 * with Convex's actual public scalar encoding. The backend process oracle then
 * receives these values on disk and across killed writer/replay processes.
 */
import fc from 'fast-check'
import { createCollection } from '@tanstack/db'
import { OutboxManager } from '@tanstack/offline-transactions'
import { expect, it } from 'vitest'
import { convexMutationCodec } from '../src/offline'
import type { PendingMutation } from '@tanstack/db'
import type {
  OfflineTransaction,
  StorageAdapter,
} from '@tanstack/offline-transactions'

type Tree =
  | undefined
  | null
  | boolean
  | number
  | bigint
  | string
  | ArrayBuffer
  | Array<Tree>
  | { [key: string]: Tree }
const leaf: fc.Arbitrary<Tree> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.boolean(),
  fc.string({ maxLength: 8 }),
  fc.double(),
  fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }),
  fc.uint8Array({ maxLength: 8 }).map((value) => value.buffer as ArrayBuffer),
)
function tree(depth: number): fc.Arbitrary<Tree> {
  if (!depth) return leaf
  const child = tree(depth - 1)
  return fc.oneof(
    leaf,
    fc.array(child, { maxLength: 3 }),
    fc.dictionary(
      fc.constantFrom(
        `__proto__`,
        `__type`,
        `value`,
        `array`,
        `scalar`,
        `removed`,
      ),
      child,
      { maxKeys: 3 },
    ),
  )
}
function observe(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return [`bytes`, [...new Uint8Array(value)]]
  if (Array.isArray(value)) return [`array`, value.map(observe)]
  if (value && typeof value === `object`)
    return [
      `object`,
      Object.entries(value)
        .map(([key, field]) => [key, observe(field)])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ]
  if (typeof value === `number`)
    return [`number`, Object.is(value, -0) ? `-0` : String(value)]
  return [typeof value, String(value)]
}
const property = fc.asyncProperty(tree(2), async (payload) => {
  type Row = { id: string; payload: Tree }
  const make = (id: string) =>
    createCollection<Row>({
      id,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    })
  const writer = make(`writer`)
  const reader = make(`reader`)
  const data = new Map<string, string>()
  const storage: StorageAdapter = {
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => {
      data.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      data.delete(key)
      return Promise.resolve()
    },
    keys: () => Promise.resolve([...data.keys()]),
    clear: () => {
      data.clear()
      return Promise.resolve()
    },
  }
  const row: Row = { id: `one`, payload }
  const transaction: OfflineTransaction = {
    id: `durable`,
    mutationFnName: `save`,
    idempotencyKey: `same`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    version: 1,
    keys: [`one`],
    mutations: [
      {
        globalKey: `one`,
        type: `update`,
        modified: row,
        original: row,
        changes: { payload },
        collection: writer,
      } as unknown as PendingMutation,
    ],
  }
  try {
    await new OutboxManager(storage, { rows: writer }, convexMutationCodec).add(
      transaction,
    )
    const restored = await new OutboxManager(
      storage,
      { rows: reader },
      convexMutationCodec,
    ).get(`durable`)
    expect(observe(restored!.mutations[0]!.modified)).toEqual(observe(row))
    expect(observe(restored!.mutations[0]!.original)).toEqual(observe(row))
    expect(observe(restored!.mutations[0]!.changes)).toEqual(
      observe({ payload }),
    )
  } finally {
    await writer.cleanup()
    await reader.cleanup()
  }
})
it(`preserves the Convex mutation value domain across durable serialization`, async () => {
  const seed = process.env.CONVEX_VALUES_ORACLE_SEED
  if (seed)
    await fc.assert(property, {
      seed: Number(seed),
      path: process.env.CONVEX_VALUES_ORACLE_PATH,
      numRuns: 100,
    })
  else {
    await fc.assert(property, { seed: 20261022, numRuns: 100 })
    await fc.assert(property, { numRuns: 100 })
  }
})
