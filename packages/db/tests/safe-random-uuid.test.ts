import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeRandomUUID } from '../src/utils'

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe(`safeRandomUUID`, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(`delegates to crypto.randomUUID when available`, () => {
    const randomUUID = vi.fn(() => `11111111-2222-4333-8444-555555555555`)
    vi.stubGlobal(`crypto`, {
      randomUUID,
      getRandomValues: (arr: Uint8Array) => arr,
    })

    expect(safeRandomUUID()).toBe(`11111111-2222-4333-8444-555555555555`)
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it(`falls back to crypto.getRandomValues when randomUUID is missing`, () => {
    const getRandomValues = vi.fn((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = i
      return arr
    })
    vi.stubGlobal(`crypto`, { randomUUID: undefined, getRandomValues })

    const uuid = safeRandomUUID()

    expect(uuid).toMatch(UUID_V4_RE)
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it(`produces distinct UUIDs across calls when using the fallback`, () => {
    let counter = 0
    vi.stubGlobal(`crypto`, {
      randomUUID: undefined,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (counter + i) & 0xff
        counter++
        return arr
      },
    })

    const first = safeRandomUUID()
    const second = safeRandomUUID()

    expect(first).toMatch(UUID_V4_RE)
    expect(second).toMatch(UUID_V4_RE)
    expect(first).not.toBe(second)
  })

  it(`throws when neither randomUUID nor getRandomValues is available`, () => {
    vi.stubGlobal(`crypto`, {})

    expect(() => safeRandomUUID()).toThrowError(/Web Crypto/)
  })

  it(`throws when crypto itself is undefined`, () => {
    vi.stubGlobal(`crypto`, undefined)

    expect(() => safeRandomUUID()).toThrowError(/Web Crypto/)
  })
})
