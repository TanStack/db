/** Transported page histories receive the window owner's sort/slice law.
 * Each history moves while local readiness is held, mounts fresh old-page
 * readers, then releases local rows and returns. Bounds include empty pages.
 * Host receivers supply the public hook and native flush; this module only
 * owns input grammar. It imports no adapter or production identity machinery.
 */
import fc from 'fast-check'
import { declareOracle } from '../oracle-declaration'
// Width/offset vary independently, including pages beyond the final row.
// Every history moves twice and returns to the first page. Removing the held
// readiness cut loses the distinction between a matching seed and local rows.
export const clientWindowArbitrary = fc.record({
  count: fc.integer({ min: 1, max: 12 }),
  offset: fc.integer({ min: 0, max: 4 }),
  width: fc.integer({ min: 1, max: 4 }),
  jump: fc.integer({ min: 1, max: 4 }),
  latePeers: fc.integer({ min: 1, max: 2 }),
})
export type ClientWindowHistory = {
  count: number
  offset: number
  width: number
  jump: number
  latePeers: number
}
export const clientWindowExamples: Array<[ClientWindowHistory]> = [
  [{ count: 10, offset: 0, width: 2, jump: 2, latePeers: 1 }],
  [{ count: 2, offset: 0, width: 1, jump: 1, latePeers: 1 }],
]
export const clientWindowStates = [
  `first seed`,
  `moved seed`,
  `local handoff`,
  `peer isolation`,
  `held peer keyed state`,
  `local peer keyed state`,
  `returned page`,
  `client scope switch`,
  `fresh old-page lookup`,
] as const

declareOracle({ grammar: [clientWindowArbitrary] })
