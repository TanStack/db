import { afterAll, describe, expect, it, vi } from 'vitest'

// Runtimes such as Cloudflare Workers reject random values generated at
// module scope, so a mutation id's per-runtime prefix waits for the first
// mutation.
let next = 0
const randomUUID = vi.fn(() => `prefix-${++next}`)
vi.stubGlobal(`crypto`, { randomUUID })
afterAll(() => {
  vi.unstubAllGlobals()
})
vi.resetModules()

// Import at file scope, after the stub, so the cold load of the Collection
// module graph does not count against the test timeout.
const { createCollection } = await import(`../src/collection/index.js`)
const { localOnlyCollectionOptions } = await import(`../src/local-only.js`)

describe(`mutation ids`, () => {
  it(`do not draw random values during module evaluation`, () => {
    expect(randomUUID).not.toHaveBeenCalled()

    const collection = createCollection(
      localOnlyCollectionOptions<{ id: string }>({
        id: `mutation-ids`,
        getKey: (row) => row.id,
      }),
    )
    const first = collection.insert({ id: `a` })
    const second = collection.insert({ id: `b` })
    const [firstId, secondId] = [first, second].map(
      (transaction) => transaction.mutations[0]!.mutationId,
    )
    expect(firstId).not.toBe(secondId)
    expect(firstId!.startsWith(`prefix-`)).toBe(true)
    // One prefix per runtime; the counter makes each id unique.
    expect(firstId!.split(`-`).slice(0, 2)).toEqual(
      secondId!.split(`-`).slice(0, 2),
    )
  })
})
