/**
 * A binding projects data through its current authored query: lists expose an
 * array; findOne exposes a row or undefined (contract.ts and each adapter's
 * public result type). Changing query mode must not retain the old projection.
 *
 * The same independent law runs through every framework's conformance driver.
 * Each driver supplies its native parameter observation cut, then a settled
 * cut. At the native cut only shape is owed: rows can still be pending. At the
 * settled cut selected values and keyed state must equal the source model.
 * This does not promise synchronous row freshness or identical host scheduling.
 * Disabled inputs, errors, supplied Collections and DbClient remain with their
 * existing conformance owners; this grammar uses enabled callback queries.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { declareOracle } from '../oracle-declaration'
import { createOracleReach } from '../oracle-reach'
import {
  atOracleCheckpoint,
  createOracleFailureFidelity,
} from '../oracle-failure-fidelity'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../oracle-config'
import { expectKeyedRows, expectOrderedRows, selectedRow } from './result-laws'
import { ScenarioLifetime } from './scenario-lifetime'
import type { ControllableHandle, LiveQueryDriver } from './contract'

type Mode = `list` | `single`
type ReadOrder = `data first` | `Collection first`
type ShapeRow = { id: string; value: number }
type ShapeHistory = {
  initial: Mode
  order: ReadOrder
  count: number
  base: number
  spacing: number
  descending: boolean
  windowed: boolean
  offset: number
  tail: Array<Mode>
}

// Source cardinality makes absent, single and multiple rows distinguishable.
// Mode changes projection; order changes which row findOne selects. The tail
// permits repeated modes and further returns. No disabled or invalid query is
// generated. Removing either direction or the native cut loses the reported
// stale-projection witness, even when all settled comparisons remain green.
// A finite singleton list and findOne can have identical offset/limit while
// their projections differ. That axis rejects window-only shape invalidation.
const shapeHistory = fc.record({
  initial: fc.constantFrom<Mode>(`list`, `single`),
  order: fc.constantFrom<ReadOrder>(`data first`, `Collection first`),
  count: fc.integer({ min: 0, max: 4 }),
  base: fc.integer({ min: -10, max: 10 }),
  spacing: fc.integer({ min: 1, max: 3 }),
  descending: fc.boolean(),
  windowed: fc.boolean(),
  offset: fc.integer({ min: 0, max: 3 }),
  tail: fc.array(fc.constantFrom<Mode>(`list`, `single`), { maxLength: 4 }),
})
const examples: Array<[ShapeHistory]> = [3, 1, 0].flatMap((count) =>
  ([`list`, `single`] as const).flatMap((initial) =>
    ([`data first`, `Collection first`] as const).flatMap((order) =>
      [false, true].map((windowed): [ShapeHistory] => [
        {
          initial,
          order,
          count,
          base: 0,
          spacing: 1,
          descending: false,
          windowed,
          offset: 0,
          tail: [],
        },
      ]),
    ),
  ),
)
// Pin the adjacent finite offset as well as zero. Each input still goes through
// the same history grammar, independent model, real driver and comparison.
examples.push(
  ...examples
    .filter(([history]) => history.count === 3 && history.windowed)
    .map(([history]): [ShapeHistory] => [{ ...history, offset: 1 }]),
)

// The model recomputes from authored source rows and mode. It knows nothing
// about Collection classifiers, observer snapshots, or adapter caches.
function shapeRows(
  rows: ReadonlyArray<ShapeRow>,
  mode: Mode,
  descending: boolean,
  windowed = false,
  offset = 0,
) {
  const ordered = [...rows].sort((a, b) =>
    descending ? b.value - a.value : a.value - b.value,
  )
  const selected = windowed ? ordered.slice(offset, offset + 1) : ordered
  return mode === `single` ? selected.slice(0, 1) : selected
}

function checkResultShape(actual: unknown, mode: Mode): void {
  expect(Array.isArray(actual), `raw ${mode} projection`).toBe(mode === `list`)
  if (mode === `single` && actual !== undefined) {
    expect(actual).not.toBeNull()
    expect(typeof actual).toBe(`object`)
  }
}

const states = [
  `data first read`,
  `Collection first read`,
  `list to single at native cut`,
  `single to list at native cut`,
  `nonempty list to single at native cut`,
  `nonempty single to list at native cut`,
  `repeated mode at native cut`,
  `returned mode settled`,
  `empty source settled`,
  `multiple source rows settled`,
  `same finite window projection change`,
  `nonzero finite window projection change`,
] as const

async function checkShapeHistory(
  driver: LiveQueryDriver,
  history: ShapeHistory,
  reach: ReturnType<typeof createOracleReach<(typeof states)[number]>>,
) {
  const { initial, order } = history
  const lifetime = new ScenarioLifetime()
  let handle: ControllableHandle<Mode> | undefined
  lifetime.defer(() => handle?.unmount())
  await lifetime.run(async () => {
    const rows = Array.from({ length: history.count }, (_, index) => ({
      id: String(index),
      value: history.base + index * history.spacing,
    }))
    const source = driver.makeSource(rows.map((row) => ({ ...row })))
    lifetime.defer(() => source.collection.cleanup({ dependents: true }))
    let compiledMode: Mode | undefined
    handle = driver.mountControllable<Mode>((q, mode) => {
      compiledMode = mode
      let query = q
        .from({ row: source.collection })
        .orderBy(
          ({ row }: { row: ShapeRow }) => row.value,
          history.descending ? `desc` : `asc`,
        )
      if (history.windowed) query = query.offset(history.offset).limit(1)
      return mode === `single` ? query.findOne() : query
    }, initial)
    const mounted = handle
    const failures: Array<unknown> = []
    const compare = (law: string, checkpoint: string, check: () => void) => {
      try {
        atOracleCheckpoint(law, checkpoint, check)
      } catch (error) {
        // Keep both directions and the later settled evidence even when the
        // native shape is wrong. No failed comparison is discarded.
        failures.push(error)
      }
    }
    const settled = (mode: Mode, checkpoint: string) => {
      const actual = mounted.current()
      const expected = shapeRows(
        rows,
        mode,
        history.descending,
        history.windowed,
        history.offset,
      )
      compare(`current query projection`, checkpoint, () =>
        checkResultShape(actual.data, mode),
      )
      compare(`settled selected rows`, checkpoint, () => {
        if (mode === `list`) expectOrderedRows(actual.data, expected)
        else if (expected.length === 0) expect(actual.data).toBeUndefined()
        else {
          checkResultShape(actual.data, mode)
          expect(selectedRow(actual.data)).toStrictEqual(expected[0])
        }
      })
      compare(`settled keyed rows`, checkpoint, () =>
        expectKeyedRows(actual.state, expected),
      )
      if (history.count === 0) reach.reach(`empty source settled`)
      if (history.count > 1) reach.reach(`multiple source rows settled`)
    }
    try {
      await mounted.flush()
      settled(initial, `initial settled`)
      const opposite: Mode = initial === `list` ? `single` : `list`
      let previous = initial
      for (const [index, mode] of [
        opposite,
        opposite,
        initial,
        ...history.tail,
      ].entries()) {
        let observations = 0
        const transition = `${previous} to ${mode}`
        const checkpoint = `${transition}; ${driver.parameterObservationCut}; ${order}`
        await mounted.setParam(mode, () => {
          observations++
          reach.reach(`${order} read`)
          // These are real public reads. Their order is part of the history;
          // neither a snapshot normalization nor a later flush can repair them.
          const actual = atOracleCheckpoint(
            `public result read`,
            checkpoint,
            () => {
              if (order === `Collection first`) mounted.collection()
              const result = mounted.current()
              if (order === `data first`) mounted.collection()
              return result
            },
          )
          compare(`current input reached query callback`, checkpoint, () =>
            expect(compiledMode).toBe(mode),
          )
          if (previous === mode) reach.reach(`repeated mode at native cut`)
          else {
            if (history.windowed)
              reach.reach(`same finite window projection change`)
            if (history.windowed && history.offset > 0)
              reach.reach(`nonzero finite window projection change`)
            reach.reach(
              `${transition} at native cut` as (typeof states)[number],
            )
            if (history.count > 0)
              reach.reach(
                `nonempty ${transition} at native cut` as (typeof states)[number],
              )
          }
          compare(`current query projection`, checkpoint, () =>
            checkResultShape(actual.data, mode),
          )
        })
        compare(`native observation executed`, checkpoint, () =>
          expect(observations).toBe(1),
        )
        settled(mode, `${transition}; settled`)
        if (index === 2) reach.reach(`returned mode settled`)
        previous = mode
      }
    } catch (error) {
      // A later driver/read interruption cannot replace an earlier mismatch.
      failures.push(error)
    }
    if (failures.length)
      throw new AggregateError(failures, failures.map(String).join(`\n`), {
        cause: failures[0],
      })
  })
}

declareOracle({
  model: [shapeRows],
  grammar: [shapeHistory],
  check: [checkResultShape, checkShapeHistory],
})

export function registerResultShapeOracle(driver: LiveQueryDriver): void {
  const id = driver.name.replace(/\W+/g, `-`).replace(/-$/, ``)
  const property = `framework.${id}.result-shape`
  describe(`${driver.name} result-shape conformance`, () => {
    for (const campaign of [`fixed`, `random`] as const) {
      const test =
        campaign === `fixed`
          ? oracleReplayTest(it)
          : oracleReplayTest(it, property)
      test(
        `query projection histories (${campaign})`,
        async () => {
          const reach = createOracleReach(`${property}/${campaign}`, states, {
            fixedHistories: examples.length,
          })
          const fidelity = createOracleFailureFidelity<ShapeHistory>()
          let begun = 0
          try {
            await fidelity.assert(() =>
              fc.assert(
                fc.asyncProperty(shapeHistory, async (history) => {
                  reach.beginHistory({ fixed: begun++ < examples.length })
                  await fidelity.run(history, () =>
                    checkShapeHistory(driver, history, reach),
                  )
                }),
                campaign === `fixed`
                  ? {
                      seed: 2316,
                      numRuns: oracleRuns(6) + examples.length,
                      examples,
                    }
                  : oraclePropertyOptions(6, property, { examples }),
              ),
            )
            reach.assertReached()
          } finally {
            console.info(
              `shape reach ${property}/${campaign}`,
              Object.fromEntries(reach.counts()),
            )
          }
        },
        oracleRuns(30_000),
      )
    }

    // Calibrate the same raw-shape judgment with the previous mode's answer.
    // Both wrong directions have identical selected rows and differ only in
    // array-versus-row projection, which row normalization would erase.
    it(`rejects the previous query projection in either direction`, () => {
      const rows = [{ id: `0`, value: 0 }]
      for (const mode of [`list`, `single`] as const) {
        const expected = shapeRows(rows, mode, false)
        const good = mode === `list` ? expected : expected[0]
        checkResultShape(good, mode)
        const wrong = mode === `list` ? expected[0] : expected
        expect(() => checkResultShape(wrong, mode)).toThrow()
      }
    })
  })
}
