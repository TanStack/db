/**
 * Core change-event consumers must preserve unordered Set equality without
 * permutation work. The primary utils equality owner supplies the descriptor
 * model. These receivers check Collection changes and ordered/unordered Effect
 * callbacks at startup, replacement and next use. Scalar-only Effect sources
 * isolate comparison of the projected Set from source-Collection comparison.
 *
 * Authority: change-event equality in the glossary, EffectConfig's complete
 * deltas and DeltaEvent.previousValue. The quadratic leaf-read bound is an
 * engineering guard for this accepted performance repair, not a latency SLA.
 * Eager controlled core sources supply the premise. No provider, framework,
 * arbitrary scheduling, general graph-work or callback-count guarantee follows.
 */
import { afterAll, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createEffect } from '../../src/query/effect.js'
import { declareOracle } from '../oracle-declaration.js'
import { createOracleReach } from '../oracle-reach.js'
import {
  authoredSet,
  expectedSetEquality,
  plainSetSpecs,
  setWorkSizes,
} from '../set-equality-oracle.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'

type Row = { id: number; members: Set<{ value: number }> }
type Event = { type: string; value: Row; previousValue?: Row }
const paths = [`collection`, `unordered-effect`, `ordered-effect`] as const
const modes = [`equal`, `reordered`, `late-mismatch`, `multiplicity`] as const
const histories = setWorkSizes.flatMap((size) =>
  modes.map((mode) => ({ size, mode })),
)
const cuts = [`initial`, `replacement`, `next-use`] as const
const receivingReach = createOracleReach(
  `Set equality core receivers`,
  paths.flatMap((path) =>
    histories.flatMap(({ size, mode }) =>
      cuts.map((cut) => `${path}/${size}/${mode}/${cut}`),
    ),
  ),
  { replaying: false },
)
let entered = false
afterAll(() => {
  if (entered) receivingReach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `Set equality receiver reach`,
      Object.fromEntries(receivingReach.counts()),
    )
})

function valuesAt(
  history: (typeof histories)[number],
  tick: number,
): Array<number> {
  const { size, mode } = history
  if (tick === 2) return Array.from({ length: size }, () => 3)
  if (mode === `reordered`) {
    const values = Array.from({ length: size }, (_, index) => index % 2)
    return tick === 0 ? values : values.reverse()
  }
  const values = Array.from({ length: size }, () => 0)
  if (mode === `late-mismatch` && tick === 0) values[size - 1] = 1
  if (mode === `multiplicity`) {
    values[size - 1] = 1
    if (tick === 1) values[0] = 1
  }
  return values
}

// Callback values remain separate immutable authored objects. Normalize only
// Set iteration order; preserve all event multiplicity and previous values.
function checkSetDelta(
  events: ReadonlyArray<Event>,
  before: ReadonlyArray<number> | undefined,
  after: ReadonlyArray<number>,
  path: (typeof paths)[number],
): void {
  const row = (values: ReadonlyArray<number>) => ({
    id: 1,
    members: [...values].sort((a, b) => a - b),
  })
  const observedRow = (value: Row) => ({
    id: value.id,
    members: [...value.members]
      .map((member) => member.value)
      .sort((a, b) => a - b),
  })
  const changed =
    before !== undefined &&
    !expectedSetEquality(plainSetSpecs(before), plainSetSpecs(after))
  const expected =
    before === undefined
      ? [
          {
            type: path === `collection` ? `insert` : `enter`,
            value: row(after),
          },
        ]
      : changed
        ? [{ type: `update`, value: row(after), previousValue: row(before) }]
        : []
  expect(
    events.map((event) => ({
      type: event.type,
      value: observedRow(event.value),
      ...(event.previousValue
        ? {
            previousValue: observedRow(event.previousValue),
          }
        : {}),
    })),
  ).toStrictEqual(expected)
}
declareOracle({
  model: [expectedSetEquality],
  check: [checkSetDelta],
  grammar: [histories],
})

for (const path of paths) {
  test.each(histories)(
    `${path} preserves Set equality and bounded work: %j`,
    async (history) => {
      entered = true
      receivingReach.beginHistory()
      let reads = 0
      const members = (tick: number) =>
        authoredSet(
          plainSetSpecs(valuesAt(history, tick)),
          `flat`,
          () => reads++,
        )
      const events: Array<Event> = []
      const scalarOptions = mockSyncCollectionOptions({
        id: `set-scalar-${path}-${history.size}-${history.mode}`,
        getKey: (row: { id: number; tick: number }) => row.id,
        initialData: [{ id: 1, tick: 0 }],
      })
      const scalar = createCollection(scalarOptions)
      const setOptions = mockSyncCollectionOptions({
        id: `set-row-${path}-${history.size}-${history.mode}`,
        getKey: (row: Row) => row.id,
        initialData: [{ id: 1, members: members(0) }],
      })
      const source =
        path === `collection` ? createCollection(setOptions) : undefined
      const subscription = source?.subscribeChanges(
        (changes) => events.push(...changes),
        { includeInitialState: true },
      )
      const effect =
        path === `collection`
          ? undefined
          : createEffect<Row>({
              query: (q) => {
                const query = q.from({ row: scalar })
                const selected =
                  path === `ordered-effect`
                    ? query.orderBy(({ row }) => row.id)
                    : query
                return selected.fn.select(({ row }) => ({
                  id: row.id,
                  members: members(row.tick),
                }))
              },
              onBatch: (batch) => {
                events.push(...batch)
              },
            })
      const failures: Array<Error> = []
      await withOracleCleanup(async () => {
        // A host task turn delivers queued Effect callbacks, as in the existing
        // metadata owner. No provider completion is inferred from this drain.
        let before: Array<number> | undefined
        for (const [tick, cut] of cuts.entries()) {
          if (tick > 0) events.length = 0
          reads = 0
          if (tick > 0) {
            if (source) {
              setOptions.utils.begin()
              setOptions.utils.write({
                type: `update`,
                value: { id: 1, members: members(tick) },
              })
              setOptions.utils.commit()
            } else {
              scalarOptions.utils.begin()
              scalarOptions.utils.write({
                type: `update`,
                value: { id: 1, tick },
              })
              scalarOptions.utils.commit()
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 0))
          const work = reads
          const after = valuesAt(history, tick)
          receivingReach.reach(`${path}/${history.size}/${history.mode}/${cut}`)
          try {
            checkSetDelta(events, before, after, path)
            if (tick > 0)
              expect(work, `quadratic receiver leaf reads`).toBeLessThanOrEqual(
                16 * (history.size + 1) ** 2,
              )
          } catch (error) {
            failures.push(
              new Error(
                `${cut}: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
              ),
            )
          }
          before = after
        }
        if (failures.length)
          throw new AggregateError(
            failures,
            failures.map((error) => error.message).join(`\n`),
            {
              cause: failures[0],
            },
          )
      }, [
        async () => {
          await effect?.dispose()
        },
        () => subscription?.unsubscribe(),
        async () => {
          await source?.cleanup()
        },
        async () => {
          await scalar.cleanup()
        },
      ])
    },
  )
}
