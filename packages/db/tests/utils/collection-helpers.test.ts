import { describe, expect, it, vi } from 'vitest'
import { getOrCreate } from '../../src/utils/get-or-create.js'
import { isPlainObject } from '../../src/utils/type-guards.js'

describe(`getOrCreate`, () => {
  it.each([`map`, `weak map`] as const)(
    `initializes each %s owner once`,
    (kind) => {
      const createStore = () =>
        kind === `map`
          ? new Map<object, object>()
          : new WeakMap<object, object>()
      const first = createStore()
      const second = createStore()
      const key = {}
      const create = vi.fn(() => ({}))
      const value = getOrCreate(first, key, create)
      expect(getOrCreate(first, key, create)).toBe(value)
      expect(create).toHaveBeenCalledTimes(1)
      expect(getOrCreate(second, key, create)).not.toBe(value)
      first.delete(key)
      expect(getOrCreate(first, key, create)).not.toBe(value)
      expect(create).toHaveBeenCalledTimes(3)
    },
  )

  it.each([false, 0, ``, null])(`retains a defined value %j`, (value) => {
    const entries = new Map([[`key`, value]])
    const create = vi.fn(() => value)
    expect(getOrCreate(entries, `key`, create)).toBe(value)
    expect(create).not.toHaveBeenCalled()
  })
})

describe(`isPlainObject`, () => {
  it.each([
    { name: `ordinary object`, value: {}, expected: true },
    { name: `null prototype`, value: Object.create(null), expected: true },
    { name: `custom prototype`, value: Object.create({}), expected: false },
    { name: `array`, value: [], expected: false },
    { name: `date`, value: new Date(0), expected: false },
    { name: `null`, value: null, expected: false },
    { name: `undefined`, value: undefined, expected: false },
    { name: `function`, value: () => {}, expected: false },
    { name: `string`, value: `value`, expected: false },
  ])(`classifies $name`, ({ value, expected }) => {
    expect(isPlainObject(value)).toBe(expected)
  })
})
