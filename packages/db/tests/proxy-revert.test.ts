/**
 * Ordinary draft-revert tests: hand-written native-write rows and their
 * change reports. The revert law and its generated histories are owned by
 * proxy-revert-oracle.property.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { withChangeTracking } from '../src/proxy'

describe(`draft revert oracle: native mutators mixed with assignments`, () => {
  // The generated row nests the native site two levels deep. One level more
  // checks that a report three levels up still carries the final value.
  it(`restoring a native write three levels deep reports at most the original value`, () => {
    const row = { f: { h: { arr: [0] }, g: { a: 0 } } }
    const changes = withChangeTracking(structuredClone(row), (draft) => {
      draft.f.h.arr.pop()
      draft.f.g = {} as { a: number }
      draft.f.h.arr = [0]
      draft.f.g.a = 0
    })
    expect(Object.keys(changes).every((key) => key === `f`)).toBe(true)
    if (`f` in changes) expect(changes.f).toEqual(row.f)
  })

  // A native write through any handle that reaches the row's value is a
  // change, and a missed change is the error that matters. These handles share
  // their parent's value: a Map or Set value, a typed-array view, and a value
  // read through a frozen draft.
  it.each<[string, Record<string, unknown>, (draft: any) => void, string]>([
    [
      `a Map value`,
      { m: new Map([[`k`, [1]]]) },
      (draft) => draft.m.get(`k`).push(2),
      `m`,
    ],
    [
      `a Map value from iteration`,
      { m: new Map([[`k`, [1]]]) },
      (draft) => {
        for (const value of draft.m.values()) value.push(2)
      },
      `m`,
    ],
    [
      `a Set value from iteration`,
      { s: new Set([[1]]) },
      (draft) => {
        for (const value of draft.s) value.push(2)
      },
      `s`,
    ],
    [
      `a typed-array view`,
      { t: new Float64Array([1, 2, 3]) },
      (draft) => draft.t.subarray(1).fill(9),
      `t`,
    ],
    [
      `a value read through a frozen draft`,
      { f: { arr: [1] } },
      (draft) => Object.freeze(draft).f.arr.push(2),
      `f`,
    ],
  ])(`reports a native write through %s`, (_name, row, write, key) => {
    const changes = withChangeTracking(row, write)
    expect(key in changes).toBe(true)
  })

  // A nested revert inside a Map or Set value must not hide another write to
  // the same container.
  it.each<[string, Record<string, unknown>, (draft: any) => void, string]>([
    [
      `a Map`,
      { m: new Map<string, unknown>([[`k`, { a: 0 }]]) },
      (draft) => {
        draft.m.set(`j`, 1)
        draft.m.get(`k`).a = 1
        draft.m.get(`k`).a = 0
      },
      `m`,
    ],
    [
      `a Set`,
      { s: new Set<unknown>([{ a: 0 }]) },
      (draft) => {
        draft.s.add(1)
        for (const value of draft.s) if (typeof value === `object`) value.a = 1
        for (const value of draft.s) if (typeof value === `object`) value.a = 0
      },
      `s`,
    ],
  ])(
    `a nested revert in %s keeps its other write`,
    (_name, row, write, key) => {
      const changes = withChangeTracking(row, write)
      expect(key in changes).toBe(true)
    },
  )
})
