import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection'
import { eq } from '../../src/query/builder/functions'
import { Func, PropRef, Value } from '../../src/query/ir'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe'
import type { LoadSubsetOptions } from '../../src/types'

describe.each([`direct`, `deferred`] as const)(
  `immutable demand through %s sync startup`,
  (start) => {
    it.each([`return`, `resolve`, `abort`] as const)(
      `preserves request data and live cancellation on %s`,
      async (outcome) => {
        const date = Object.freeze(new Date(7))
        const candidates = Object.freeze([date])
        const reference = new PropRef([`date`])
        Object.freeze(reference.path)
        Object.freeze(reference)
        const where = new Func<boolean>(`in`, [
          reference,
          Object.freeze(new Value(candidates)),
        ])
        Object.freeze(where.args)
        Object.freeze(where)
        const owner = new AbortController()
        const options: LoadSubsetOptions = Object.freeze({
          where,
          limit: 2,
          signal: owner.signal,
        })
        let finish = () => {}
        const loads: Array<LoadSubsetOptions> = []
        const unloadSubset = vi.fn()
        const deduplicated = new DeduplicatedLoadSubset({
          loadSubset: (request) => {
            loads.push(request)
            return outcome === `return`
              ? true
              : new Promise<void>((resolve) => (finish = resolve))
          },
        })
        const collection = createCollection<{ id: number }>({
          getKey: ({ id }) => id,
          syncMode: `on-demand`,
          startSync: start === `direct`,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return { loadSubset: deduplicated.loadSubset, unloadSubset }
            },
          },
        })
        try {
          if (start === `deferred`) {
            expect(collection._deferSyncStart()).toBe(true)
          }
          const result = collection._sync.loadSubset(options)
          if (start === `deferred`) {
            expect(loads).toEqual([])
            collection._resumeSyncStart()
          }
          expect(loads).toHaveLength(1)
          expect(loads[0]).toBe(options)
          const matches = compileSingleRowExpression(loads[0]!.where!)
          expect(
            [new Date(7), new Date(8)].map((value) => matches({ date: value })),
          ).toEqual([true, false])

          if (outcome === `abort`) owner.abort()
          expect(loads[0]!.signal!.aborted).toBe(outcome === `abort`)
          if (outcome !== `return`) finish()
          await result
          collection._sync.unloadSubset(options)
          expect(unloadSubset).toHaveBeenCalledExactlyOnceWith(options)
          expect(unloadSubset.mock.calls[0]![0]).toBe(loads[0])
          expect(date.getTime()).toBe(7)
          expect(candidates).toEqual([new Date(7)])

          // New immutable data describes a new request. Completed equal data
          // shares; an aborted transport establishes no reusable result.
          const repeat = deduplicated.loadSubset({
            where: new Func(`in`, [
              new PropRef([`date`]),
              new Value([new Date(7)]),
            ]),
            limit: 2,
          })
          expect(loads).toHaveLength(outcome === `abort` ? 2 : 1)
          if (outcome === `abort`) finish()
          await repeat
        } finally {
          finish()
          await collection.cleanup()
        }
      },
    )
  },
)

it.each([`release`, `cleanup`] as const)(
  `retires a frozen queued request before adapter startup by %s`,
  async (action) => {
    const loadSubset = vi.fn(() => true as const)
    const unloadSubset = vi.fn()
    const collection = createCollection<{ id: number }>({
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset, unloadSubset }
        },
      },
    })
    expect(collection._deferSyncStart()).toBe(true)
    const options = Object.freeze({
      where: eq(new PropRef([`id`]), new Value(1)),
    })
    try {
      const result = collection._sync.loadSubset(options)
      const settled = Promise.allSettled([result])
      if (action === `release`) collection._sync.unloadSubset(options)
      else await collection.cleanup()
      expect(await settled).toEqual([
        {
          status: `rejected`,
          reason: expect.objectContaining({ name: `AbortError` }),
        },
      ])
      collection._resumeSyncStart()
      expect(loadSubset).not.toHaveBeenCalled()
      expect(unloadSubset).not.toHaveBeenCalled()
    } finally {
      await collection.cleanup()
    }
  },
)
