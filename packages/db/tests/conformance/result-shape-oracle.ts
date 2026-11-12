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
 *
 * The property is defined once here and registered once per framework, by
 * that framework's conformance suite, with its own driver: one law, model,
 * history grammar, and check, judged through each framework's binding.
 */
import fc from 'fast-check'
import { oracleRuns } from '../oracle-config'
import { declareOracle } from '../oracle-declaration'
import { differs, oracleProperty, pass, violation } from '../oracle-property'
import { selectedRowKeys } from './result-laws'
import { ScenarioLifetime } from './scenario-lifetime'
import type { Observation } from '../oracle-property'
import type { ControllableHandle, LiveQueryDriver } from './contract'

// ---------------------------------------------------------------------------
// Histories
// ---------------------------------------------------------------------------
//
// Source cardinality makes absent, single and multiple rows distinguishable.
// Mode changes projection; order changes which row findOne selects. The tail
// permits repeated modes and further returns. No disabled or invalid query is
// generated. Removing either direction or the native cut loses the reported
// stale-projection witness, even when all settled comparisons remain green.
// A finite singleton list and findOne can have identical offset/limit while
// their projections differ. That axis rejects window-only shape invalidation.

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

const shapeHistory: fc.Arbitrary<ShapeHistory> = fc.record({
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

// The regressions: every count, initial mode, read order, and window choice,
// plus the adjacent finite offset for the three-row windows.
const regressions: Array<ShapeHistory> = [3, 1, 0].flatMap((count) =>
  ([`list`, `single`] as const).flatMap((initial) =>
    ([`data first`, `Collection first`] as const).flatMap((order) =>
      [false, true].map((windowed): ShapeHistory => ({
        initial,
        order,
        count,
        base: 0,
        spacing: 1,
        descending: false,
        windowed,
        offset: 0,
        tail: [],
      })),
    ),
  ),
)
regressions.push(
  ...regressions
    .filter((history) => history.count === 3 && history.windowed)
    .map((history) => ({ ...history, offset: 1 })),
)

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
//
// The model recomputes from authored source rows and mode. It knows nothing
// about Collection classifiers, observer snapshots, or adapter caches. A
// history mounts in its initial mode, switches to the opposite mode twice,
// returns, then follows its tail; each switch has a native cut, where only
// the shape is owed, and a settled cut, where the rows are owed too.

function sourceRows(history: ShapeHistory): Array<ShapeRow> {
  return Array.from({ length: history.count }, (_, index) => ({
    id: String(index),
    value: history.base + index * history.spacing,
  }))
}

function shapeRows(history: ShapeHistory, mode: Mode): Array<ShapeRow> {
  const ordered = [...sourceRows(history)].sort((a, b) =>
    history.descending ? b.value - a.value : a.value - b.value,
  )
  const selected = history.windowed
    ? ordered.slice(history.offset, history.offset + 1)
    : ordered
  return mode === `single` ? selected.slice(0, 1) : selected
}

function modes(history: ShapeHistory): Array<Mode> {
  const opposite: Mode = history.initial === `list` ? `single` : `list`
  return [history.initial, opposite, opposite, history.initial, ...history.tail]
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

type Owed = { mode: Mode; rows?: Array<ShapeRow> }

function shapeModel(history: ShapeHistory) {
  const sequence = modes(history)
  const owed = new Map<string, Owed>()
  const reached = new Set<string>()
  const settled = (checkpoint: string, mode: Mode) => {
    owed.set(checkpoint, { mode, rows: shapeRows(history, mode) })
    if (history.count === 0) reached.add(`empty source settled`)
    if (history.count > 1) reached.add(`multiple source rows settled`)
  }
  settled(`initial settled`, history.initial)
  for (const [index, mode] of sequence.slice(1).entries()) {
    const previous = sequence[index]!
    const transition = `${previous} to ${mode}`
    owed.set(`${index}: ${transition}; native`, { mode })
    reached.add(`${history.order} read`)
    if (previous === mode) reached.add(`repeated mode at native cut`)
    else {
      reached.add(`${transition} at native cut`)
      if (history.count > 0) reached.add(`nonempty ${transition} at native cut`)
      if (history.windowed) reached.add(`same finite window projection change`)
      if (history.windowed && history.offset > 0)
        reached.add(`nonzero finite window projection change`)
    }
    settled(`${index}: ${transition}; settled`, mode)
    if (index === 2) reached.add(`returned mode settled`)
  }
  return { owed, reached }
}

// ---------------------------------------------------------------------------
// Production driver, for one framework's binding
// ---------------------------------------------------------------------------
//
// The driver mounts the query through the framework's controllable binding,
// flushes, and records the settled projection: its shape, its selected rows,
// and the keyed state. For each switch it reads the binding inside the
// framework's native observation callback, in the history's read order, and
// records the shape and the mode the query callback last compiled; after the
// switch settles it records how many native observations ran and the settled
// projection. Rows are recorded as plain selected values, with the enumerable
// symbol keys a binding exposes; the driver decides nothing. Each native
// observation also records the framework's name for its native cut, which a
// failure prints.

type Shape = `array` | `undefined` | `null` | `object` | `other`
const shapeOf = (value: unknown): Shape =>
  Array.isArray(value)
    ? `array`
    : value === undefined
      ? `undefined`
      : value === null
        ? `null`
        : typeof value === `object`
          ? `object`
          : `other`
const plainRow = (row: unknown): unknown =>
  row !== null && typeof row === `object`
    ? Object.fromEntries(
        selectedRowKeys(row).map((key) => [
          key,
          (row as Record<PropertyKey, unknown>)[key],
        ]),
      )
    : row
const byId = (a: { id: unknown }, b: { id: unknown }) =>
  String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0

type Settled = {
  shape: Shape
  rows: Array<unknown>
  /** Keyed state as plain entries, or null when the binding exposes none. */
  state: Array<{ id: unknown; value: unknown }> | null
}
type Native = {
  /** The framework's native cut, from its conformance driver. */
  cut: string
  shape: Shape
  compiledMode: Mode | undefined
  readError?: string
  observations: number
}

function resultShapeDriver(driver: LiveQueryDriver) {
  return async (
    history: ShapeHistory,
    observe: (checkpoint: string, value: unknown) => void,
  ) => {
    const lifetime = new ScenarioLifetime()
    let handle: ControllableHandle<Mode> | undefined
    lifetime.defer(() => handle?.unmount())
    await lifetime.run(async () => {
      const source = driver.makeSource(sourceRows(history))
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
      }, history.initial)
      const mounted = handle
      const settled = (checkpoint: string) => {
        const { data, state } = mounted.current()
        const shape = shapeOf(data)
        observe(checkpoint, {
          shape,
          rows:
            shape === `array`
              ? (data as Array<unknown>).map(plainRow)
              : shape === `object`
                ? [plainRow(data)]
                : [],
          state: state
            ? [...(state as ReadonlyMap<unknown, unknown>).entries()]
                .map(([id, value]) => ({ id, value: plainRow(value) }))
                .sort(byId)
            : null,
        } satisfies Settled)
      }
      await mounted.flush()
      settled(`initial settled`)
      const sequence = modes(history)
      for (const [index, mode] of sequence.slice(1).entries()) {
        const transition = `${sequence[index]} to ${mode}`
        let native: Omit<Native, `observations`> | undefined
        let observations = 0
        await mounted.setParam(mode, () => {
          observations++
          // These are real public reads; their order is part of the history.
          try {
            if (history.order === `Collection first`) mounted.collection()
            const result = mounted.current()
            if (history.order === `data first`) mounted.collection()
            native = {
              cut: driver.parameterObservationCut,
              shape: shapeOf(result.data),
              compiledMode,
            }
          } catch (error) {
            native = {
              cut: driver.parameterObservationCut,
              shape: `other`,
              compiledMode,
              readError: String(error),
            }
          }
        })
        observe(`${index}: ${transition}; native`, {
          ...(native ?? {
            cut: driver.parameterObservationCut,
            shape: `other`,
            compiledMode,
          }),
          observations,
        } satisfies Native)
        settled(`${index}: ${transition}; settled`)
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------
//
// At a native cut: the public read did not throw, exactly one native
// observation ran, the query callback compiled the current mode, and the
// projection has the current mode's shape. At a settled cut: the shape again,
// the selected rows in order (a findOne row or undefined), and the keyed
// state as an unordered set.

const projects = (shape: Shape, mode: Mode) =>
  mode === `list`
    ? shape === `array`
    : shape === `undefined` || shape === `object`

function checkResultShape(
  _history: ShapeHistory,
  trace: ReadonlyArray<Observation>,
  { owed }: ReturnType<typeof shapeModel>,
) {
  for (const { checkpoint, value } of trace) {
    const expected = owed.get(checkpoint)
    if (!expected)
      return violation(
        checkpoint,
        `the driver recorded a checkpoint the model does not owe`,
        `trace`,
      )
    if (checkpoint.endsWith(`native`)) {
      const native = value as Native
      if (native.readError)
        return violation(
          checkpoint,
          `the public read threw: ${native.readError}`,
          `public result read`,
        )
      if (native.observations !== 1)
        return violation(
          checkpoint,
          `${native.observations} native observations ran`,
          `native observation executed`,
        )
      if (native.compiledMode !== expected.mode)
        return violation(
          checkpoint,
          `the query callback last compiled ${native.compiledMode}`,
          `current input reached query callback`,
        )
      if (!projects(native.shape, expected.mode))
        return violation(
          checkpoint,
          `a ${expected.mode} binding projects ${native.shape}`,
          `current query projection`,
          { actual: native.shape, expected: expected.mode },
        )
      continue
    }
    const seen = value as Settled
    if (!projects(seen.shape, expected.mode))
      return violation(
        checkpoint,
        `a ${expected.mode} binding projects ${seen.shape}`,
        `current query projection`,
        { actual: seen.shape, expected: expected.mode },
      )
    // The selected rows are owed in order. An undefined findOne records no
    // rows, so an empty findOne that exposes a row fails here.
    const rows = expected.rows!
    const keyed = rows.map((row) => ({ id: row.id, value: row })).sort(byId)
    const wrong =
      differs(
        checkpoint,
        `settled selected rows`,
        seen.rows,
        rows,
        `the selected rows differ from the source model`,
      ) ??
      differs(
        checkpoint,
        `settled keyed rows`,
        seen.state,
        keyed,
        `the keyed state differs from the source model`,
      )
    if (wrong) return wrong
  }
  for (const checkpoint of owed.keys())
    if (!trace.some((entry) => entry.checkpoint === checkpoint))
      return violation(
        checkpoint,
        `the driver recorded no "${checkpoint}"`,
        `trace`,
      )
  return pass
}

// ---------------------------------------------------------------------------
// Definition and registration
// ---------------------------------------------------------------------------

// Two constructed histories enter every state the laws need, in every campaign
// and production path.
const resultShapeHistories = {
  arbitrary: shapeHistory,
  states,
  runs: 6,
  fixedSeeds: [2316],
  constructed: [
    {
      name: `every switch over a three-row window`,
      enters: states.filter(
        (state) =>
          state !== `Collection first read` && state !== `empty source settled`,
      ),
      build: (generated: ShapeHistory): ShapeHistory => ({
        ...generated,
        initial: `list`,
        order: `data first`,
        count: 3,
        windowed: true,
        offset: 1,
        tail: [`list`],
      }),
    },
    {
      name: `an empty source read Collection first`,
      enters: [`Collection first read`, `empty source settled`],
      build: (generated: ShapeHistory): ShapeHistory => ({
        ...generated,
        order: `Collection first`,
        count: 0,
      }),
    },
  ],
  fixed: regressions.map((history) => ({
    name: `${history.initial}, ${history.order}, ${history.count} rows${history.windowed ? `, window at ${history.offset}` : ``}`,
    history,
  })),
}

// Wrong answers the check must reject: the previous mode's projection at a
// native cut, in each direction, and stale rows at a settled cut. Both wrong
// directions keep the selected rows and differ only in array-versus-row
// projection, which row normalization would erase. Each direction corrupts
// the first native cut that projects its mode, so the framework picks a
// candidate history that has one.
const previousProjection = (
  name: string,
  current: (shape: Shape) => boolean,
  previous: Shape,
) => ({
  name,
  law: `current query projection`,
  corrupt: (trace: ReadonlyArray<Observation>) => {
    const at = trace.findIndex(
      ({ checkpoint, value }) =>
        checkpoint.endsWith(`native`) && current((value as Native).shape),
    )
    if (at < 0) return undefined
    return trace.map((entry, index) =>
      index === at
        ? { ...entry, value: { ...(entry.value as Native), shape: previous } }
        : entry,
    )
  },
})
const resultShapeCalibrations = [
  previousProjection(
    `a list keeps the findOne projection at the native cut`,
    (shape) => shape === `array`,
    `object`,
  ),
  previousProjection(
    `a findOne keeps the list projection at the native cut`,
    (shape) => shape === `object` || shape === `undefined`,
    `array`,
  ),
  {
    name: `stale rows at a settled cut`,
    law: `settled selected rows`,
    corrupt: (trace: ReadonlyArray<Observation>) => {
      const at = trace.findIndex(
        ({ checkpoint, value }) =>
          checkpoint.endsWith(`settled`) && (value as Settled).rows.length > 0,
      )
      if (at < 0) return undefined
      return trace.map((entry, index) =>
        index === at
          ? {
              ...entry,
              value: {
                ...(entry.value as Settled),
                rows: [{ id: `stale`, value: 0 }],
              },
            }
          : entry,
      )
    },
  },
]

export function registerResultShapeOracle(driver: LiveQueryDriver): void {
  const id = driver.name.replace(/\W+/g, `-`).replace(/-$/, ``)
  oracleProperty({
    id: `framework.${id}.result-shape`,
    law: {
      statement: `A binding projects data through its current authored query: a list exposes an array and findOne a row or undefined, at the native cut after a mode change, where only the shape is owed, and after it settles, where the selected rows and keyed state equal the source model.`,
      authority: `packages/db/tests/conformance/contract.ts and each adapter's public result type`,
      limits: `Enabled callback queries over one source of zero to four rows; disabled inputs, errors, supplied Collections, and DbClient stay with their existing conformance owners. No promise of synchronous row freshness or identical host scheduling.`,
    },
    histories: resultShapeHistories,
    model: shapeModel,
    reached: (_history, _trace, expected) => expected.reached,
    driver: resultShapeDriver(driver),
    check: checkResultShape,
    calibrations: resultShapeCalibrations,
    timeout: oracleRuns(30_000),
  })
}

// Owns no production entry in packages/db: this module checks the public
// observations that each framework driver passes it, so the framework packages
// that run it own the entries it judges.
declareOracle({
  check: [checkResultShape],
  model: [shapeModel],
  grammar: [resultShapeHistories],
})
