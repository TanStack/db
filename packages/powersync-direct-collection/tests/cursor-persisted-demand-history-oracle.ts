/**
 * The primary persisted-demand model judges exact cursor load coverage. These
 * histories provide only source facts: one saved cursor page, a matching or
 * changed boundary after storage reopen, and optionally a confirmed replacement.
 *
 * Every authored table row lies in the saved page. That makes a full group-A
 * Collection projection honest when the request fulfills, without inventing a
 * live-query cursor result. This receiver does not judge cursor selectivity,
 * ties, or rows beyond the limit. Changed boundaries distinguish exact demand
 * identity even when SQLite holds some matching rows. A replacement can evict
 * that saved coverage; the third run asks the old demand again while offline.
 *
 * Rank translation, page width, boundary identity and replacement are separate
 * axes: removing them loses value variation, limited requests, exact identity
 * or post-eviction reuse respectively. A changed boundary is exactly one rank
 * above the saved boundary. A checkpoint always follows its actual HTTP request.
 * An eviction history requires that changed boundary; no history writes metadata.
 */
import { fc } from '@fast-check/vitest'

export type CursorDemandHistory = {
  coordinate: number
  limit: 1 | 2
  boundary: `same` | `changed`
  after: `offline` | `refresh` | `evict`
}

export const cursorDemandStates = [
  `saved cursor applied`,
  `same cursor reopened offline`,
  `changed cursor reopened offline`,
  `confirmed cursor checkpoint after reopen`,
  `saved cursor rejected after eviction`,
] as const
export type CursorDemandState = (typeof cursorDemandStates)[number]

export const cursorDemandHistoryArb = fc.oneof(
  fc.record({
    coordinate: fc.integer({ min: -20, max: 20 }),
    limit: fc.constantFrom<1 | 2>(1, 2),
    boundary: fc.constantFrom<`same` | `changed`>(`same`, `changed`),
    after: fc.constantFrom<`offline` | `refresh`>(`offline`, `refresh`),
  }),
  fc.record({
    coordinate: fc.integer({ min: -20, max: 20 }),
    limit: fc.constantFrom<1 | 2>(1, 2),
    boundary: fc.constant<`changed`>(`changed`),
    after: fc.constant<`evict`>(`evict`),
  }),
)

export function constructCursorDemand(
  history: CursorDemandHistory,
  state: CursorDemandState,
): CursorDemandHistory {
  switch (state) {
    case `saved cursor applied`:
      return { ...history }
    case `same cursor reopened offline`:
      return { ...history, boundary: `same`, after: `offline` }
    case `changed cursor reopened offline`:
      return { ...history, boundary: `changed`, after: `offline` }
    case `confirmed cursor checkpoint after reopen`:
      return { ...history, after: `refresh` }
    case `saved cursor rejected after eviction`:
      return { ...history, boundary: `changed`, after: `evict` }
  }
}
