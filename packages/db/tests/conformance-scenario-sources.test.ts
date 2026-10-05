import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { ScenarioLifetime } from './conformance/scenario-lifetime'
import { ScenarioSources } from './conformance/scenario-sources'

it.each([false, true])(
  `cleans reached native sources after mount failure=%s`,
  async (mountFails) => {
    const lifetime = new ScenarioLifetime()
    const sources = new ScenarioSources()
    const events: Array<string> = []
    const error = new Error(`mount failed after source creation`)
    const source = createCollection<{ id: number }>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          events.push(`start`)
          begin()
          write({ type: `insert`, value: { id: 1 } })
          commit()
          markReady()
          return {
            cleanup: () => {
              events.push(`source cleanup`)
            },
          }
        },
      },
    })
    let reached = false
    const result = lifetime.run(async () => {
      try {
        const handle = sources.track({ collection: source })
        await handle.collection.preload()
        expect([...handle.collection.values()].map(({ id }) => id)).toEqual([1])
        reached = true
        if (mountFails) throw error
        const subscription = source.subscribeChanges(() => undefined)
        lifetime.defer(() => {
          events.push(`unmount`)
          subscription.unsubscribe()
        })
        lifetime.defer(() => {
          events.push(`gate release`)
        })
      } finally {
        sources.defer(lifetime)
      }
    })
    if (mountFails) await expect(result).rejects.toBe(error)
    else await result
    expect(reached).toBe(true)
    expect(events).toEqual(
      mountFails
        ? [`start`, `source cleanup`]
        : [`start`, `unmount`, `gate release`, `source cleanup`],
    )
    expect(source.status).toBe(`cleaned-up`)
    expect(source.subscriberCount).toBe(0)
  },
)

it.each([false, true])(
  `retains source cleanup errors and disposes equal-id peers, async=%s`,
  async (asynchronous) => {
    const lifetime = new ScenarioLifetime()
    const sources = new ScenarioSources()
    const primary = new Error(`body`)
    const cleanupError = new Error(`source`)
    const calls: Array<string> = []
    const first = {
      id: `same-id`,
      cleanup() {
        calls.push(`first`)
        if (asynchronous) return Promise.reject(cleanupError)
        throw cleanupError
      },
    }
    const second = {
      id: `same-id`,
      cleanup() {
        calls.push(`second`)
        return Promise.resolve()
      },
    }
    const handle = { collection: first }
    expect(sources.track(handle)).toBe(handle)
    sources.track(handle)
    sources.track({ collection: first })
    sources.track({ collection: second })
    const result = await lifetime
      .run(() => {
        try {
          throw primary
        } finally {
          sources.defer(lifetime)
        }
      })
      .catch((error: unknown) => error)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).cause).toBe(primary)
    expect((result as AggregateError).errors).toEqual([primary, cleanupError])
    expect(calls).toEqual([`first`, `second`])
  },
)
