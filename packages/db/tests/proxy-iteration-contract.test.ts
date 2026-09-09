import { describe, expect, it } from 'vitest'
import { withChangeTracking } from '../src/proxy.js'

// Drafts preserve native live membership, even if a snapshot iterator would
// make mutation tracking simpler. Nested field edits have separate laws.
describe.each([`Map`, `Set`] as const)(`%s draft iteration`, (kind) => {
  it(`visits entries added before consuming an existing iterator`, () => {
    const values = kind === `Map` ? new Map([[1, 1]]) : new Set([1])
    withChangeTracking({ values }, (draft) => {
      const iterator = draft.values.values()
      if (draft.values instanceof Map) draft.values.set(2, 2)
      else draft.values.add(2)
      expect([...iterator]).toEqual([1, 2])
    })
  })

  it(`skips entries deleted before consuming an existing iterator`, () => {
    const values =
      kind === `Map`
        ? new Map([
            [1, 1],
            [2, 2],
          ])
        : new Set([1, 2])
    withChangeTracking({ values }, (draft) => {
      const iterator = draft.values.values()
      draft.values.delete(2)
      expect([...iterator]).toEqual([1])
    })
  })
})
