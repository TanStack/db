import { describe, expect, it, vi } from 'vitest'
import { hash, registerOpaqueHash } from '../src/hashing/hash'

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

  it(`uses identity for registered handles without traversing mutable internals`, () => {
    const first: Record<string, unknown> = {}
    const second: Record<string, unknown> = {}
    for (const value of [first, second]) {
      value.self = value
      Object.defineProperty(value, `state`, {
        enumerable: true,
        get() {
          throw new Error(`must not read handle state`)
        },
      })
      registerOpaqueHash(value)
    }
    const before = hash({ handle: first })
    first.changed = true
    expect(hash({ handle: first })).toBe(before)
    expect(hash({ handle: second })).not.toBe(before)
    expect(
      countTraversalAllocations(() => {
        hash(first)
        hash(second)
      }),
    ).toBe(0)
  })

  it(`visits each shared acyclic subtree once`, () => {
    let reads = 0
    let root: object = { value: 1 }
    for (let depth = 0; depth < 200; depth++) {
      const child = root
      root = {
        get left() {
          reads++
          return child
        },
        get right() {
          reads++
          return child
        },
      }
    }
    const result = hash(root)
    expect(reads).toBe(400)
    expect(hash(root)).toBe(result)
    expect(reads).toBe(400)
  })

  it(`bounds value visits without publishing partial structural caches`, () => {
    let reads = 0
    const shared = {}
    const root = {
      a: {
        get value() {
          reads++
          return 1
        },
      },
      // Repeated references must still count as work, even when their hashes
      // are cached; no expanded tree is needed to reach the bound.
      z: Array.from({ length: 1_000_001 }, () => shared),
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      expect(() => hash(root)).toThrow(
        `Value is too complex to hash safely: structural work`,
      )
      expect(reads).toBe(attempt)
    }
    expect(hash({ value: 1 })).toBe(hash({ value: 1 }))
  })
})
