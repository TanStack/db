import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { ScenarioLifetime } from './conformance/scenario-lifetime'

describe(`scenario resource lifetime`, () => {
  it.each(
    [Promise, runInNewContext(`Promise`) as PromiseConstructor].flatMap(
      (Constructor, realm) =>
        [false, true].map((reject) => ({ Constructor, realm, reject })),
    ),
  )(
    `awaits gated cleanup realm=$realm reject=$reject`,
    async ({ Constructor, reject }) => {
      const scope = new ScenarioLifetime()
      const error = new Error(`cleanup`)
      let release!: () => void
      let exited = false
      let peerRan = false
      const gate = new Constructor<void>((resolve, fail) => {
        release = () => (reject ? fail(error) : resolve())
      })
      // Keep the diagnostic failure itself from leaving an unobserved rejection.
      void gate.catch(() => undefined)
      scope.defer(() => gate)
      scope.defer(() => {
        peerRan = true
      })
      const result = scope
        .run(() => {})
        .then(
          () => {
            exited = true
            return []
          },
          (caught: unknown) => {
            exited = true
            return [caught]
          },
        )
      try {
        for (let turn = 0; turn < 10; turn++) await Promise.resolve()
        expect(exited).toBe(false)
        expect(peerRan).toBe(false)
      } finally {
        release()
        await result
      }
      expect(peerRan).toBe(true)
      expect(await result).toEqual(reject ? [error] : [])
    },
  )
  it.each(
    [`pending request`, `query cleanup`].flatMap((first) =>
      [false, true].flatMap((firstFails) =>
        [false, true].map((sourceFails) => ({
          first,
          firstFails,
          sourceFails,
        })),
      ),
    ),
  )(
    `finishes source cleanup after $first firstFails=$firstFails sourceFails=$sourceFails`,
    async ({ first, firstFails, sourceFails }) => {
      const scope = new ScenarioLifetime()
      const calls: Array<string> = []
      const firstError = new Error(first)
      const sourceError = new Error(`source cleanup`)
      scope.defer(() => {
        calls.push(first)
        return firstFails ? Promise.reject(firstError) : Promise.resolve()
      })
      scope.defer(() => {
        calls.push(`source cleanup`)
        return sourceFails ? Promise.reject(sourceError) : Promise.resolve()
      })
      const errors = [
        ...(firstFails ? [firstError] : []),
        ...(sourceFails ? [sourceError] : []),
      ]
      const result = await scope
        .run(() => {})
        .then(
          () => [],
          (error: unknown) =>
            error instanceof AggregateError ? error.errors : [error],
        )
      expect(calls).toEqual([first, `source cleanup`])
      expect(result).toEqual(errors)
    },
  )
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
