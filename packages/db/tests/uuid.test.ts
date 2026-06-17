import { afterEach, describe, expect, it, vi } from "vitest"
import { randomUUID } from "../src/utils/uuid"

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe(`randomUUID helper`, () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it(`delegates to crypto.randomUUID when available`, () => {
    const spy = vi
      .spyOn(globalThis.crypto, `randomUUID`)
      .mockReturnValue(`11111111-2222-4333-8444-555555555555`)
    const id = randomUUID()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(id).toBe(`11111111-2222-4333-8444-555555555555`)
  })

  it(`falls back to getRandomValues when crypto.randomUUID is undefined (non-secure context)`, () => {
    // Simulate a non-secure browser context where randomUUID is unavailable
    // but getRandomValues remains.
    vi.stubGlobal(`crypto`, {
      randomUUID: undefined,
      getRandomValues: (arr: Uint8Array) => {
        // Deterministic-ish fill so we can verify version/variant bits land
        // exactly where they should.
        for (let i = 0; i < arr.length; i++) arr[i] = 0xff
        return arr
      },
    })

    const id = randomUUID()
    expect(id).toMatch(UUID_V4_REGEX)

    // Verify version nibble == 4 and variant nibble in [8,9,a,b]
    const versionChar = id[14]
    const variantChar = id[19]
    expect(versionChar).toBe(`4`)
    expect([`8`, `9`, `a`, `b`]).toContain(variantChar)

    // With all bytes 0xff, expect ffffffff-ffff-4fff-bfff-ffffffffffff
    expect(id).toBe(`ffffffff-ffff-4fff-bfff-ffffffffffff`)
  })

  it(`produces unique, well-formed UUIDs via the fallback path across many calls`, () => {
    vi.stubGlobal(`crypto`, {
      randomUUID: undefined,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++)
          arr[i] = Math.floor(Math.random() * 256)
        return arr
      },
    })

    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const id = randomUUID()
      expect(id).toMatch(UUID_V4_REGEX)
      seen.add(id)
    }
    expect(seen.size).toBe(200)
  })

  it(`throws when neither crypto.randomUUID nor crypto.getRandomValues is available`, () => {
    vi.stubGlobal(`crypto`, {})
    expect(() => randomUUID()).toThrow(/No secure random number generator/)
  })
})
