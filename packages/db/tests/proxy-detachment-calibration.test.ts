// Checker calibrations for the detachment checks in proxy-detachment-fixture.ts.
// These tests run no production: each hands a native or deliberately wrong
// value to a shared check and requires the check to accept or reject it. The
// production histories that use the same checks are in
// proxy-detachment-contract-oracle.test.ts.
import { describe, expect, it } from 'vitest'
import {
  cycleContainer,
  cycleKinds,
  cycleMember,
  expectCycleSnapshot,
  expectOwnDataProperty,
} from './proxy-detachment-fixture.js'
import type { CycleRow } from './proxy-detachment-fixture.js'

describe(`Mutation result detachment`, () => {
  it.each([`value`, `__proto__`, `constructor`, `toString`])(
    `rejects missing or prototype-changing %s data properties`,
    (key) => {
      expectOwnDataProperty(Object.fromEntries([[key, 1]]), key, 1)
      expect(() => expectOwnDataProperty({}, key, 1)).toThrow()
      const wrong = Object.fromEntries([[key, 1]])
      Object.setPrototypeOf(wrong, { foreign: true })
      expect(() => expectOwnDataProperty(wrong, key, 1)).toThrow()
    },
  )

  it.each(cycleKinds)(`accepts a native %s cyclic snapshot`, (kind) => {
    const row: CycleRow = { id: 1, count: 1 }
    row.link = cycleContainer(kind, row)
    expectCycleSnapshot(row, kind)
  })

  it.each(
    cycleKinds.flatMap((kind) =>
      [`old-value`, `missing-member`, `broken-backedge`].map((fault) => ({
        kind,
        fault,
      })),
    ),
  )(`rejects $fault in a $kind cyclic snapshot`, ({ kind, fault }) => {
    const row: CycleRow = { id: 1, count: 1 }
    row.link = cycleContainer(kind, row)
    if (fault === `old-value`)
      cycleMember(row.link, kind).owner = { ...row, count: 0 }
    else if (fault === `broken-backedge`)
      cycleMember(row.link, kind).owner = { id: 1, count: 1 }
    else if (row.link instanceof Map || row.link instanceof Set)
      row.link.clear()
    else if (Array.isArray(row.link)) row.link.length = 0
    else Reflect.deleteProperty(row.link, `member`)
    expect(() => expectCycleSnapshot(row, kind)).toThrow()
  })
})
