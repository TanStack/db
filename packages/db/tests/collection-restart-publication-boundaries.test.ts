import { expect, it, vi } from 'vitest'
import {
  CollectionHasSubscribersError,
  createCollection,
  createLiveQueryCollection,
} from '../src/index.js'
import { flushPromises } from './utils.js'
import type { SyncConfig } from '../src/types.js'

type Row = { id: string; value: number }
type Ops = Parameters<SyncConfig<Row, string>[`sync`]>[0]

// ARCHITECTURE's cleanup/restart contract gives an eager source's first batch
// replacement authority. Readiness is a separate checkpoint.
it(`reconciles retained eager rows on the first restarted public batch`, async () => {
  let ops!: Ops
  const source = createCollection<Row, string>({
    getKey: (row) => row.id,
    sync: {
      sync: (next) => {
        ops = next
      },
    },
  })
  const visible = new Map<string, number>()
  const batches: Array<Array<string>> = []
  const sub = source.subscribeChanges(
    (changes) => {
      batches.push(changes.map((change) => `${change.type}:${change.key}`))
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else visible.set(change.key, change.value.value)
      }
    },
    { includeInitialState: false },
  )
  const write = (keys: Array<string>) => {
    ops.begin()
    keys.forEach((id) => ops.write({ type: `insert`, value: { id, value: 1 } }))
    ops.commit()
  }
  try {
    write([`a`, `b`, `c`])
    ops.markReady()
    await source.cleanup()
    source.startSyncImmediate()
    batches.length = 0
    write([`a`])
    expect(source.status).toBe(`loading`)
    expect([...visible.keys()]).toEqual([`a`])
    expect(batches).toEqual([[`delete:b`, `delete:c`]])
    write([`b`, `c`])
    ops.markReady()
    expect([...visible.keys()]).toEqual([`a`, `b`, `c`])
  } finally {
    sub.unsubscribe()
    await source.cleanup()
  }
})

// Cleanup ends a dependent graph. Source restart alone cannot revive it.
// These exact b/d observations supplement the cleanup admission oracle.
for (const syncMode of [`eager`, `on-demand`] as const) {
  for (const cleanup of [`public`, `dependents`, `internal`] as const) {
    it(`${syncMode} compiled queries obey ${cleanup} cleanup before restart`, async () => {
      let ops!: Ops
      let run = 0
      const reports = vi.spyOn(console, `error`).mockImplementation(() => {})
      const source = createCollection<Row, string>({
        getKey: (row) => row.id,
        syncMode,
        sync: {
          sync: (next) => {
            ops = next
            run++
            ops.begin()
            for (const id of run === 1 ? [`b`, `d`] : [`b`])
              ops.write({ type: `insert`, value: { id, value: 1 } })
            ops.commit()
            ops.markReady()
            return { loadSubset: () => true }
          },
        },
      })
      const live = createLiveQueryCollection((q) =>
        q.from({ row: source }).select(({ row }) => row),
      )
      const sub = live.subscribeChanges(() => {})
      try {
        await live.preload()
        expect([...live.keys()].sort()).toEqual([`b`, `d`])
        if (cleanup === `public`) {
          await expect(source.cleanup()).rejects.toBeInstanceOf(
            CollectionHasSubscribersError,
          )
          expect(run).toBe(1)
          expect(live.status).toBe(`ready`)
        } else {
          if (cleanup === `dependents`)
            await source.cleanup({ dependents: true })
          else await source._lifecycle.cleanup()
          if (cleanup === `internal`) {
            expect(live.status).toBe(`crashed`)
            source.startSyncImmediate()
            await flushPromises()
            expect(live.status).toBe(`crashed`)
            expect([...live.keys()].sort()).toEqual([`b`, `d`])
            await live.cleanup()
          }
          await live.preload()
          expect(live.status).toBe(`ready`)
          expect([...live.keys()]).toEqual([`b`])
        }
      } finally {
        sub.unsubscribe()
        await live.cleanup()
        await source.cleanup()
        reports.mockRestore()
      }
    })
  }
}
