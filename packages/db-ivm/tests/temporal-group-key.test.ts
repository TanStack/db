import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import { serializeValue } from '../src/index.js'

// Ordinary tests for Temporal group keys: serialized identity of Temporal
// values inside plain objects, arrays, Maps, and Sets. The grouping law
// belongs to temporal-group-key-oracle.test.ts.
describe('Temporal group keys', () => {
  it('keeps a Temporal value distinct from an empty object', () => {
    const date = Temporal.PlainDate.from('2024-01-15')
    const anotherDate = Temporal.PlainDate.from('2024-06-15')
    expect(serializeValue(date)).not.toBe(serializeValue({}))
    expect(serializeValue(date)).not.toBe(serializeValue(date.toString()))
    expect(serializeValue({ date })).not.toBe(serializeValue({ date: {} }))
    expect(serializeValue({ dates: [date] })).not.toBe(
      serializeValue({ dates: [anotherDate] }),
    )
    expect(serializeValue(new Map([['date', date]]))).not.toBe(
      serializeValue(new Map([['date', anotherDate]])),
    )
    expect(serializeValue(new Set([date]))).not.toBe(
      serializeValue(new Set([anotherDate])),
    )
  })
})
