import { describe, expect, it } from 'vitest'
import { withScopeSetup } from './conformance/scope-setup.js'

describe(`scope setup ownership`, () => {
  it(`preserves successful return and caller-owned receiver cleanup`, () => {
    const owner = {
      calls: 0,
      dispose() {
        this.calls++
      },
    }
    const result = {}
    expect(
      withScopeSetup(
        () => result,
        () => owner.dispose(),
      ),
    ).toBe(result)
    expect(owner.calls).toBe(0)
    owner.dispose()
    expect(owner.calls).toBe(1)
  })

  it.each([undefined, new Error(`setup failure`)])(
    `retains exact thrown value %s`,
    (primary) => {
      const calls: Array<string> = []
      let returned = false
      let caught: unknown
      try {
        withScopeSetup(
          () => {
            throw primary
          },
          () => {
            calls.push(`disposed`)
          },
        )
        returned = true
      } catch (error) {
        caught = error
      }
      expect(returned).toBe(false)
      expect(caught).toBe(primary)
      expect(calls).toEqual([`disposed`])
    },
  )

  it(`retains both failures even when both thrown values are undefined`, () => {
    let caught: unknown
    try {
      withScopeSetup(
        () => {
          throw undefined
        },
        () => {
          throw undefined
        },
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([undefined, undefined])
    expect(Object.hasOwn(caught!, `cause`)).toBe(true)
    expect((caught as AggregateError).cause).toBeUndefined()
  })
})
