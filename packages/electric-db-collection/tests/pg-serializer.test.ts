import { describe, expect, it } from 'vitest'
import { serialize } from '../src/pg-serializer'

describe(`pg-serializer`, () => {
  describe(`serialize`, () => {
    it(`should serialize null as empty string`, () => {
      expect(serialize(null)).toBe(``)
    })

    it(`should serialize undefined as empty string`, () => {
      expect(serialize(undefined)).toBe(``)
    })

    it(`should serialize strings as-is`, () => {
      expect(serialize(`hello`)).toBe(`hello`)
      expect(serialize(``)).toBe(``)
      expect(serialize(`with spaces`)).toBe(`with spaces`)
    })

    it(`should serialize numbers as strings`, () => {
      expect(serialize(42)).toBe(`42`)
      expect(serialize(0)).toBe(`0`)
      expect(serialize(-123)).toBe(`-123`)
      expect(serialize(3.14)).toBe(`3.14`)
      expect(serialize(Infinity)).toBe(`Infinity`)
      expect(serialize(-Infinity)).toBe(`-Infinity`)
    })

    it(`should serialize bigints as strings`, () => {
      expect(serialize(BigInt(42))).toBe(`42`)
      expect(serialize(BigInt(0))).toBe(`0`)
      expect(serialize(BigInt(-123))).toBe(`-123`)
      expect(serialize(BigInt(`9007199254740993`))).toBe(`9007199254740993`)
      expect(serialize(BigInt(`-9007199254740993`))).toBe(`-9007199254740993`)
    })

    it(`should serialize booleans as lowercase strings`, () => {
      expect(serialize(true)).toBe(`true`)
      expect(serialize(false)).toBe(`false`)
    })

    it(`should serialize dates as ISO strings`, () => {
      const date = new Date(`2024-01-15T10:30:45.000Z`)
      expect(serialize(date)).toBe(`2024-01-15T10:30:45.000Z`)
    })

    describe(`arrays`, () => {
      it(`should serialize empty arrays`, () => {
        expect(serialize([])).toBe(`{}`)
      })

      it(`should serialize arrays of numbers`, () => {
        expect(serialize([1, 2, 3])).toBe(`{1,2,3}`)
      })

      it(`should serialize arrays of bigints`, () => {
        expect(serialize([BigInt(1), BigInt(2), BigInt(3)])).toBe(`{1,2,3}`)
        expect(serialize([BigInt(`9007199254740993`)])).toBe(
          `{9007199254740993}`,
        )
      })

      it(`should serialize arrays of strings with proper escaping`, () => {
        expect(serialize([`a`, `b`, `c`])).toBe(`{"a","b","c"}`)
        expect(serialize([`hello world`])).toBe(`{"hello world"}`)
      })

      it(`should escape quotes and backslashes in string array elements`, () => {
        expect(serialize([`with"quote`])).toBe(`{"with\\"quote"}`)
        expect(serialize([`with\\backslash`])).toBe(`{"with\\\\backslash"}`)
        expect(serialize([`both"and\\`])).toBe(`{"both\\"and\\\\"}`)
      })

      it(`should serialize arrays with null/undefined as NULL`, () => {
        expect(serialize([1, null, 3])).toBe(`{1,NULL,3}`)
        expect(serialize([`a`, undefined, `c`])).toBe(`{"a",NULL,"c"}`)
      })

      it(`should serialize arrays of booleans`, () => {
        expect(serialize([true, false, true])).toBe(`{true,false,true}`)
      })

      it(`should serialize arrays of dates`, () => {
        const date = new Date(`2024-01-15T10:30:45.000Z`)
        expect(serialize([date])).toBe(`{2024-01-15T10:30:45.000Z}`)
      })

      it(`should serialize mixed type arrays`, () => {
        expect(serialize([1, `two`, true, null])).toBe(`{1,"two",true,NULL}`)
      })

      it(`should serialize nested arrays`, () => {
        expect(
          serialize([
            [1, 2],
            [3, 4],
          ]),
        ).toBe(`{{1,2},{3,4}}`)
      })
    })

    describe(`error handling`, () => {
      it(`should throw for unsupported types`, () => {
        expect(() => serialize({ key: `value` })).toThrow(
          `Cannot serialize value:`,
        )
        expect(() => serialize(Symbol(`test`))).toThrow(
          `Cannot serialize value:`,
        )
      })

      it(`should handle error message for non-JSON-serializable values`, () => {
        // This tests that the error message doesn't throw when trying to stringify
        // values that JSON.stringify can't handle
        const circularObj: any = {}
        circularObj.self = circularObj

        expect(() => serialize(circularObj)).toThrow(`Cannot serialize value:`)
      })

      it(`should throw for functions`, () => {
        expect(() => serialize(() => {})).toThrow(`Cannot serialize value:`)
      })
    })
  })
})
