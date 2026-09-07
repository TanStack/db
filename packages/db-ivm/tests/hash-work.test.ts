import { describe, expect, it, vi } from 'vitest'
import { hash } from '../src/hashing/hash'

function countTraversalAllocations(run: () => void): number {
  let allocations = 0
  for (const name of [`Map`, `Set`, `WeakMap`] as const) {
    vi.stubGlobal(
      name,
      new Proxy(globalThis[name], {
        construct(target, args) {
          allocations++
          return Reflect.construct(target, args)
        },
      }),
    )
  }
  try {
    run()
  } finally {
    vi.unstubAllGlobals()
  }
  return allocations
}

describe(`hash traversal work`, () => {
  it(`does not allocate traversal collections for primitive and cached inputs`, () => {
    const cached = { id: 1, title: `cached` }
    hash(cached)
    const inputs = [null, undefined, false, 0, 1n, `row`, Symbol(`key`), cached]
    expect(
      countTraversalAllocations(() => {
        for (const input of inputs) hash(input)
      }),
    ).toBe(0)
  })

  it(`measures traversal collections for fresh structural inputs`, () => {
    expect(countTraversalAllocations(() => hash({ id: 1 }))).toBeGreaterThan(0)
  })
})
