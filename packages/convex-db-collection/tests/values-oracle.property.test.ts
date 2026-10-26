/**
 * Convex values must keep their meaning through the durable outbox, including
 * integers, binary data, special floats, and removed (undefined) fields. The
 * reference is the authored native tree. An observation projection labels
 * scalar types and bytes, so JSON normalization cannot pass as equality.
 *
 * Bounded trees combine native leaves, arrays, ordinary fields, and marker-like
 * user data. Real Collection insert/update/delete calls create legal mutation
 * shapes. Independent before/after trees distinguish their operands; equal
 * payload updates still change a revision, and field deletion produces undefined
 * changes. A real OutboxManager writes each transaction, then a fresh manager
 * and Collection restore it with convexMutationCodec. Comparison happens on all
 * three restored mutation payloads, before any provider call. The core serializer
 * owner covers wire dispatch and unsupported codecs; this receives that contract
 * with Convex's actual public scalar encoding. The backend process oracle then
 * receives a bounded native subset on disk and across killed writer/replay processes.
 */
import fc from 'fast-check'
import { createCollection, createTransaction } from '@tanstack/db'
import { OutboxManager } from '@tanstack/offline-transactions'
import { expect, it } from 'vitest'
import { convexMutationCodec } from '../src/offline'
import { cleanupOfflineOracle } from '../../offline-transactions/tests/oracle-lifecycle'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
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
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(NaN, Infinity, -Infinity, -0),
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
it(`preserves the Convex mutation value domain across durable serialization`, async () => {
  // Every campaign must actually reach these semantic distinctions. Replay
  // checks its requested history directly rather than requiring all categories.
  await runOracleCampaign(
    `CONVEX_VALUES_ORACLE`,
    [
      `insert`,
      `update`,
      `delete`,
      `different-operands`,
      `equal-payload-update`,
      `changed-payload-update`,
      `removed-field-update`,
      `int64`,
      `special-float`,
      `binary`,
      `nested-container`,
      `undefined`,
    ],
    async (reach, parameters) => {
      const property = fc.asyncProperty(
        fc.record({
          kind: fc.constantFrom(
            `insert` as const,
            `update` as const,
            `delete` as const,
          ),
          before: tree(2),
          after: tree(2),
          samePayload: fc.boolean(),
          removeField: fc.boolean(),
        }),
        async ({ kind, before, after, samePayload, removeField }) => {
          reach.beginHistory()
          type Row = {
            id: string
            revision: number
            payload: Tree
            removable?: Tree
          }
          const original: Row = {
            id: `one`,
            revision: 0,
            payload: before,
            removable: before,
          }
          const modified: Row = {
            id: `one`,
            revision: 1,
            payload: samePayload ? before : after,
            ...(removeField ? {} : { removable: before }),
          }
          const writer = createCollection<Row>({
            id: `writer`,
            getKey: (row) => row.id,
            startSync: true,
            sync: {
              sync: ({ begin, write, commit, markReady }) => {
                begin()
                if (kind !== `insert`)
                  write({ type: `insert`, value: original })
                commit()
                markReady()
              },
            },
          })
          const reader = createCollection<Row>({
            id: `reader`,
            getKey: (row) => row.id,
            sync: { sync: ({ markReady }) => markReady() },
          })
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
          const local = createTransaction({
            autoCommit: false,
            mutationFn: async () => {},
          })
          const rollback = local.isPersisted.promise.catch(() => undefined)
          let hasPrimaryFailure = false
          try {
            local.mutate(() => {
              if (kind === `insert`) writer.insert(modified)
              else if (kind === `delete`) writer.delete(`one`)
              else
                writer.update(`one`, (draft) => {
                  draft.revision = modified.revision
                  draft.payload = modified.payload
                  if (removeField) delete draft.removable
                })
            })
            expect(local.mutations).toHaveLength(1)
            const mutation = local.mutations[0]!
            const expectedOriginal = kind === `insert` ? {} : original
            // Snapshot before the writer: its input aliases the seeded row.
            // In-place corruption must not rewrite the expected original too.
            const expectedOriginalObservation = observe(expectedOriginal)
            // Core owns full-row/changes composition, including its undefined
            // removal markers. Preserve those supplied operands exactly rather
            // than specifying core's representation again in this codec owner.
            const expectedModified = observe(mutation.modified)
            const expectedChanges = observe(mutation.changes)
            expect(mutation.modified.revision).toBe(kind === `delete` ? 0 : 1)
            expect(observe(mutation.modified.payload)).toEqual(
              observe(kind === `delete` ? original.payload : modified.payload),
            )
            expect(observe(mutation.original)).toEqual(
              observe(expectedOriginal),
            )
            reach.reach(kind)
            if (kind !== `delete`) reach.reach(`different-operands`)
            if (kind === `update` && samePayload)
              reach.reach(`equal-payload-update`)
            if (
              kind === `update` &&
              JSON.stringify(observe(before)) !==
                JSON.stringify(observe(modified.payload))
            )
              reach.reach(`changed-payload-update`)
            if (kind === `update` && removeField) {
              expect(Object.hasOwn(mutation.changes, `removable`)).toBe(true)
              expect(mutation.changes.removable).toBeUndefined()
              reach.reach(`removed-field-update`)
            }
            const recordNative = (value: unknown, nested = false): void => {
              if (typeof value === `bigint`) reach.reach(`int64`)
              else if (value === undefined) reach.reach(`undefined`)
              else if (
                typeof value === `number` &&
                (!Number.isFinite(value) || Object.is(value, -0))
              )
                reach.reach(`special-float`)
              else if (value instanceof ArrayBuffer) reach.reach(`binary`)
              else if (value !== null && typeof value === `object`) {
                if (nested) reach.reach(`nested-container`)
                Object.values(value).forEach((field) =>
                  recordNative(field, true),
                )
              }
            }
            recordNative(mutation.original)
            recordNative(mutation.modified)
            recordNative(mutation.changes)
            const transaction: OfflineTransaction = {
              id: `durable`,
              mutationFnName: `save`,
              idempotencyKey: `same`,
              createdAt: new Date(0),
              retryCount: 0,
              nextAttemptAt: 0,
              version: 1,
              keys: [mutation.globalKey],
              mutations: local.mutations,
            }
            await new OutboxManager(
              storage,
              { rows: writer },
              convexMutationCodec,
            ).add(transaction)
            const restored = await new OutboxManager(
              storage,
              { rows: reader },
              convexMutationCodec,
            ).get(`durable`)
            expect(
              observe(restored!.mutations[0]!.modified),
              `modified operand`,
            ).toEqual(expectedModified)
            expect(
              observe(restored!.mutations[0]!.original),
              `original operand`,
            ).toEqual(expectedOriginalObservation)
            expect(
              observe(restored!.mutations[0]!.changes),
              `changes operand`,
            ).toEqual(expectedChanges)
          } catch (error) {
            hasPrimaryFailure = true
            throw error
          } finally {
            await cleanupOfflineOracle(
              [
                () => {
                  local.rollback()
                },
                () => rollback,
                () => writer.cleanup(),
                () => reader.cleanup(),
              ],
              hasPrimaryFailure,
            )
          }
        },
      )
      await fc.assert(property, { numRuns: 100, ...parameters })
    },
    { fixedSeed: 20261022 },
  )
})
