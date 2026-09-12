import { describe, expect, it } from 'vitest'
import { ScenarioLifetime } from './conformance/scenario-lifetime'

describe(`scenario resource lifetime`, () => {
  const cases = [false, true].flatMap((bodyFails) =>
    [false, true].flatMap((manual) =>
      [false, true].flatMap((cleanupFails) =>
        [false, true].map((asyncCleanup) => ({
          bodyFails,
          manual,
          cleanupFails,
          asyncCleanup,
        })),
      ),
    ),
  )
  it.each(cases)(
    `conserves body=$bodyFails manual=$manual cleanup=$cleanupFails async=$asyncCleanup`,
    async ({ bodyFails, manual, cleanupFails, asyncCleanup }) => {
      const scope = new ScenarioLifetime()
      const bodyError = new Error(`body`)
      const cleanupError = new Error(`cleanup`)
      const calls: Array<number> = []
      const dispose = scope.defer(() => {
        calls.push(1)
        if (asyncCleanup)
          return cleanupFails ? Promise.reject(cleanupError) : Promise.resolve()
        if (cleanupFails) throw cleanupError
        return undefined
      })
      scope.defer(() => {
        calls.push(2)
      })
      let failed = false
      const error = await scope
        .run(async () => {
          if (manual) {
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                await dispose()
              } catch {
                /* must still be reported at exit */
              }
            }
          }
          if (bodyFails) throw bodyError
        })
        .catch((caught: unknown) => {
          failed = true
          return caught
        })
      expect(calls).toEqual([1, 2])
      const expected = [
        ...(bodyFails ? [bodyError] : []),
        ...(cleanupFails ? [cleanupError] : []),
      ]
      expect(failed).toBe(expected.length > 0)
      if (expected.length === 1) expect(error).toBe(expected[0])
      else if (expected.length > 1) {
        expect(error).toBeInstanceOf(AggregateError)
        expect((error as AggregateError).errors).toEqual(expected)
        expect((error as AggregateError).cause).toBe(expected[0])
      }
    },
  )

  it(`retains a thrown undefined and every later failed peer`, async () => {
    const scope = new ScenarioLifetime()
    const peer = new Error(`peer`)
    let finalPeerRan = false
    scope.defer(() => {
      throw peer
    })
    scope.defer(() => {
      throw peer
    })
    scope.defer(() => {
      finalPeerRan = true
    })
    const result = await scope
      .run(() => {
        throw undefined
      })
      .catch((error: unknown) => error)
    expect(finalPeerRan).toBe(true)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).errors).toEqual([undefined, peer, peer])
    expect((result as AggregateError).cause).toBeUndefined()
  })

  it(`reports both manual failure roles but disposes once with method context`, async () => {
    const scope = new ScenarioLifetime()
    const primary = new Error(`unmount`)
    const handle: { count: number; unmount: () => void } = {
      count: 0,
      unmount() {
        this.count++
        throw primary
      },
    }
    const unmount = handle.unmount.bind(handle)
    handle.unmount = scope.defer(unmount)
    const error = await scope
      .run(() => handle.unmount())
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).cause).toBe(primary)
    expect((error as AggregateError).errors).toEqual([primary, primary])
    expect(handle.count).toBe(1)
  })

  it.each([undefined, `same`])(
    `retains equal primitive payloads from independent failure sites: %s`,
    async (value) => {
      const scope = new ScenarioLifetime()
      scope.defer(() => {
        throw value
      })
      const error = await scope
        .run(() => {
          throw value
        })
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([value, value])
      expect((error as AggregateError).cause).toBe(value)
    },
  )

  it(`runs a resource acquired after another cleanup fails`, async () => {
    const scope = new ScenarioLifetime()
    const primary = new Error(`first`)
    const calls: Array<number> = []
    scope.defer(() => {
      scope.defer(() => {
        calls.push(2)
      })
      throw primary
    })
    await expect(scope.run(() => undefined)).rejects.toBe(primary)
    expect(calls).toEqual([2])
  })
})
