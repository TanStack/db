import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { oracleAssertion } from '../oracle-assertion-adapter.js'

// The parent-window history grammar and its run budget, and the
// projection-payload model and value check of the includes work-counter
// oracle, moved here unchanged from includes-work-counter-oracle.test.ts. The
// oracle drives production through them; the ordinary grammar census and
// payload checker calibration in includes-work-counter.test.ts import them
// without registering the oracle's tests again. This module registers no
// tests.

export type WindowParent = { id: string; rank: number; group: string }
export type WindowChild = { id: string; group: string; n: number }
export type WindowGrandchild = { id: string; childId: string }
export type ChildForm =
  | `materialize`
  | `collection`
  | `ordered`
  | `limited`
  | `findOne`
  | `nested`
  | `limited-nested`
export type ParentForm = `page` | `findOne` | `orderOnly`

export type WindowCommand =
  | { type: `insert-parent`; copy: number | null }
  | { type: `delete-parent`; pick: number }
  | { type: `rank`; pick: number; up: boolean }
  | { type: `insert-child`; pick: number }
  | { type: `delete-child`; pick: number }
  | { type: `move`; offset: number; limit: number }

export type WindowCase = {
  parents: number
  groups: number
  // Parents that copy an earlier parent's rank, and its group when `group`.
  copies: Array<{ pick: number; group: boolean }>
  childrenPerGroup: number
  childForm: ChildForm
  childSource: `local` | `on-demand`
  parentForm: ParentForm
  // Groups a static parent filter keeps, by index; one uses `eq`.
  parentFilter: Array<number> | null
  direction: `asc` | `desc`
  distinct: boolean
  offset: number
  limit: number
  history: Array<WindowCommand>
  // A replay of a known transient top-K row: the extra child rows it may load
  // at a checkpoint where the parent's ordered acquisition had not completed.
  overshoot?: number
  // A `findOne` parent skips its `offset` when false. Omitted means true.
  findOneOffset?: boolean
  // A window `setWindow` requests before the live query starts.
  startWindow?: { offset: number; limit: number } | null
  // A static child filter on the grandchild correlation field (the child
  // id), by index into the initial children; the include keeps only those.
  childFilter?: Array<number> | null
}

export const windowCommand: fc.Arbitrary<WindowCommand> = fc.oneof(
  fc.record({
    type: fc.constant(`insert-parent` as const),
    copy: fc.option(fc.nat(), { nil: null }),
  }),
  fc.record({ type: fc.constant(`delete-parent` as const), pick: fc.nat() }),
  fc.record({
    type: fc.constant(`rank` as const),
    pick: fc.nat(),
    up: fc.boolean(),
  }),
  fc.record({ type: fc.constant(`insert-child` as const), pick: fc.nat() }),
  fc.record({ type: fc.constant(`delete-child` as const), pick: fc.nat() }),
  fc.record({
    type: fc.constant(`move` as const),
    offset: fc.integer({ min: 0, max: 20 }),
    limit: fc.integer({ min: 1, max: 4 }),
  }),
)

export const windowCase: fc.Arbitrary<WindowCase> = fc
  .integer({ min: 8, max: 40 })
  .chain((parents) =>
    fc.record({
      parents: fc.constant(parents),
      // At least half as many groups as parents, so most rows own a group.
      groups: fc.integer({ min: Math.ceil(parents / 2), max: parents }),
      copies: fc.array(fc.record({ pick: fc.nat(), group: fc.boolean() }), {
        maxLength: 4,
      }),
      childrenPerGroup: fc.integer({ min: 1, max: 3 }),
      childForm: fc.constantFrom(
        `materialize` as const,
        `collection` as const,
        `ordered` as const,
        `limited` as const,
        `findOne` as const,
        `nested` as const,
        `limited-nested` as const,
      ),
      childSource: fc.constantFrom(`local` as const, `on-demand` as const),
      parentForm: fc.constantFrom(
        `page` as const,
        `findOne` as const,
        `orderOnly` as const,
      ),
      parentFilter: fc.option(
        fc.uniqueArray(fc.nat({ max: parents - 1 }), {
          minLength: 1,
          maxLength: 6,
        }),
        { nil: null },
      ),
      direction: fc.constantFrom(`asc` as const, `desc` as const),
      distinct: fc.boolean(),
      offset: fc.integer({ min: 0, max: 20 }),
      limit: fc.integer({ min: 1, max: 4 }),
      history: fc.array(windowCommand, { maxLength: 8 }),
      findOneOffset: fc.boolean(),
      startWindow: fc.option(
        fc.record({
          offset: fc.integer({ min: 0, max: 20 }),
          limit: fc.integer({ min: 1, max: 4 }),
        }),
        { nil: null },
      ),
      childFilter: fc.option(
        fc.uniqueArray(fc.nat({ max: 200 }), { minLength: 1, maxLength: 4 }),
        { nil: null },
      ),
    }),
  )
  // A findOne parent has one result row; `distinct` would not change it.
  .map((testCase) =>
    testCase.parentForm === `findOne`
      ? { ...testCase, distinct: false }
      : testCase,
  )

// Enough runs that each dimension appears at the default multiplier; the
// reconstruction check below counts them.
export const WINDOW_RUNS = 60

// The source payload must still contain its authored fields at publication.
// Reconstructing them from the history inputs prevents an in-place production
// mutation from changing the expected value along with the observation.
export function expectedPayloadDocument(blockCount: number, tick: number) {
  return {
    blocks: Array.from({ length: blockCount }, (_, id) => ({
      id,
      text: `block ${id} at ${tick}`,
      attrs: { indent: id % 3, tick },
    })),
    tick,
  }
}

export function expectPayloadValue(
  observed: ReadonlyArray<{ id: number; document: unknown }>,
  sourceDocument: unknown,
  blockCount: number,
  tick: number,
): void {
  oracleAssertion('includes work-counter-oracle comparison 1532', () =>
    expect(observed.map(({ id, document }) => ({ id, document }))).toEqual([
      { id: 1, document: expectedPayloadDocument(blockCount, tick) },
    ]),
  )
  oracleAssertion('includes work-counter-oracle comparison 1535', () =>
    expect(observed[0]!.document).toBe(sourceDocument),
  )
}

// The retained payload block counts: the oracle replays them, and the checker
// calibration corrupts each one.
export const payloadExamples: Array<[number]> = [[0], [1], [20], [40]]
