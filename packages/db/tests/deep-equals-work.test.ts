import { describe, expect, it, vi } from 'vitest'
import { deepEquals } from '../src/utils.js'

describe(`deep equality enumeration work`, () => {
  it.each([false, true])(
    `avoids intermediate filtered key arrays with symbols=%s`,
    (symbols) => {
      const key = Symbol(`field`)
      const createRow = () => ({
        id: 1,
        nested: { value: 2 },
        ...(symbols ? { [key]: 3 } : {}),
      })
      const left = createRow()
      const right = createRow()
      const spy = vi.spyOn(Array.prototype, `filter`)
      let calls: number
      let equal: boolean
      try {
        equal = deepEquals(left, right)
        calls = spy.mock.calls.length
      } finally {
        spy.mockRestore()
      }
      expect(equal).toBe(true)
      expect(calls).toBe(0)
    },
  )
})
