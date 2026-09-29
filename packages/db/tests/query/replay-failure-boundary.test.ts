import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection'
import { createDeferred } from '../../src/deferred'
import { BasicIndex } from '../../src/indexes/basic-index'
import { createLiveQueryCollection, eq } from '../../src/query'
import { PropRef } from '../../src/query/ir'
import { evaluateReferenceExpression } from '../reference-expression'
import { flushPromises } from '../utils'
import type { SyncConfig } from '../../src/types'

type Row = { id: number; version: number }

describe.each([`direct`, `query`] as const)(
  `failed replay publication and recovery for %s`,
  (consumer) => {
    it.each(
      ([`throw`, `reject`] as const).flatMap((failureMode) =>
        [false, true].map((partialWrite) => ({ failureMode, partialWrite })),
      ),
    )(
      `keeps peers and retained results sound: %j`,
      async ({ failureMode, partialWrite }) => {
        const failure = new Error(`replacement failed`)
        const pending = createDeferred<void>()
        let phase: `initial` | `failed` | `recovered` = `initial`
        let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
        let childSync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
        const source = createCollection<Row, number>({
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          autoIndex: `eager`,
          defaultIndexType: BasicIndex,
          sync: {
            sync: (operations) => {
              sync = operations
              operations.begin()
              for (const id of [1, 2])
                operations.write({ type: `insert`, value: { id, version: 1 } })
              operations.commit()
              operations.markReady()
              return {
                loadSubset: (options) => {
                  const ids = [1, 2].filter(
                    (id) =>
                      !options.where ||
                      evaluateReferenceExpression(options.where, {
                        id,
                        version: 1,
                      }),
                  )
                  if (phase === `initial`) return true
                  for (const id of ids) {
                    if (phase === `failed` && id === 1 && !partialWrite)
                      continue
                    operations.begin()
                    operations.write({
                      type: source.has(id) ? `update` : `insert`,
                      value: { id, version: phase === `recovered` ? 4 : 2 },
                    })
                    operations.commit()
                  }
                  if (phase === `failed` && ids.includes(1)) {
                    if (failureMode === `throw`) throw failure
                    return pending.promise
                  }
                  return true
                },
                unloadSubset: () => {},
              }
            },
          },
        })
        const children = createCollection<Row, number>({
          getKey: (row) => row.id,
          sync: {
            sync: (operations) => {
              childSync = operations
              operations.begin()
              operations.write({ type: `insert`, value: { id: 1, version: 1 } })
              operations.commit()
              operations.markReady()
            },
          },
        })
        const makeLive = () =>
          createLiveQueryCollection((q) =>
            q
              .from({ row: source })
              .where(({ row }) => eq(row.id, 1))
              .orderBy(({ row }) => row.id)
              .limit(1)
              .select(({ row }) => ({
                id: row.id,
                version: row.version,
                children: q
                  .from({ child: children })
                  .where(({ child }) => eq(child.id, row.id)),
              })),
          )
        const live = consumer === `query` ? makeLive() : undefined
        const peer = createLiveQueryCollection((q) =>
          q.from({ row: source }).where(({ row }) => eq(row.id, 2)),
        )
        const visible = new Map<number, Row>()
        const direct = source.subscribeChanges(
          (changes) => {
            for (const change of changes) {
              if (change.key !== 1) continue
              if (change.type === `delete`) visible.delete(1)
              else visible.set(1, { id: 1, version: change.value.version })
            }
          },
          { includeInitialState: false },
        )
        const errors: Array<unknown> = []
        direct.on(`loadSubset:error`, ({ error }) => errors.push(error))
        let replacement: ReturnType<typeof makeLive> | undefined
        let replacementDirect: typeof direct | undefined
        try {
          if (live) await live.preload()
          else
            direct.requestSnapshot({
              where: eq(sourceExpression(), 1),
              optimizedOnly: false,
            })
          await peer.preload()
          const retainedChild = live?.get(1)?.children
          if (live) expect(retainedChild).toBeDefined()
          const read = () =>
            live ? live.get(1)?.version : visible.get(1)?.version
          expect(read()).toBe(1)
          phase = `failed`
          sync.begin()
          sync.truncate()
          sync.commit()
          // Observe the waiter before the queued acquisition can reject.
          const waiter = live
            ? live.utils.setWindow({ limit: 2 })
            : direct.pendingTruncateReplacement
          expect(waiter).toBeInstanceOf(Promise)
          const settled = Promise.allSettled([waiter])
          await flushPromises()
          if (failureMode === `reject`) pending.reject(failure)
          expect(await settled).toEqual([
            { status: `rejected`, reason: failure },
          ])
          await flushPromises()
          expect(read()).toBe(1)
          expect(peer.get(2)?.version).toBe(2)
          if (!live) expect(errors).toEqual([failure])
          if (retainedChild) expect(retainedChild.get(1)?.version).toBe(1)

          sync.begin()
          sync.write({
            type: source.has(1) ? `update` : `insert`,
            value: { id: 1, version: 3 },
          })
          sync.write({ type: `update`, value: { id: 2, version: 3 } })
          sync.commit()
          if (retainedChild) {
            childSync.begin()
            childSync.write({ type: `update`, value: { id: 1, version: 3 } })
            childSync.commit()
          }
          await flushPromises()
          expect(read()).toBe(1)
          expect(peer.get(2)?.version).toBe(3)
          expect(source.status).toBe(`ready`)
          if (retainedChild) expect(retainedChild.get(1)?.version).toBe(1)

          // Recreating only the failed consumer is a valid recovery action.
          // Do not reset the shared source or force its healthy peer to restart.
          phase = `recovered`
          if (live) {
            await live.cleanup()
            replacement = makeLive()
            await replacement.preload()
            expect(replacement.get(1)?.version).toBe(4)
            expect(replacement.get(1)?.children.get(1)?.version).toBe(3)
          } else {
            direct.unsubscribe()
            replacementDirect = source.subscribeChanges(
              (changes) => {
                for (const change of changes) {
                  if (change.key === 1 && change.type !== `delete`)
                    visible.set(1, change.value)
                }
              },
              { includeInitialState: false },
            )
            replacementDirect.requestSnapshot({
              where: eq(sourceExpression(), 1),
              optimizedOnly: false,
            })
            expect(visible.get(1)?.version).toBe(4)
          }
          expect(peer.get(2)?.version).toBe(3)
        } finally {
          pending.resolve()
          direct.unsubscribe()
          replacementDirect?.unsubscribe()
          await Promise.all([
            live?.cleanup(),
            replacement?.cleanup(),
            peer.cleanup(),
          ])
          await Promise.all([source.cleanup(), children.cleanup()])
        }
      },
    )
  },
)

function sourceExpression() {
  return new PropRef<number>([`id`])
}
