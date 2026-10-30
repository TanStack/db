/**
 * Framework materialization borrows Collection rows; it cannot edit them.
 * Authority: mutations.md's immutable updates and PendingMutation.original,
 * ChangeMessage.previousValue's previous row, and contract.ts's result law.
 * Retained source rows, mutation originals and previous values keep their
 * complete user values. Current results follow the current source row.
 *
 * Scalar versions construct independent expected rows. Aliases and accessors
 * describe production inputs, not additional identity promises for hook output.
 * A framework may expose live proxies while keeping borrowed snapshots intact.
 * The optimistic-history owner covers other settlement schedules. Limits here:
 * one key, three updates, the value grammar below, and settled or held-handler
 * cuts. Arbitrary cycles, hidden symbols and callback atomicity are not judged.
 */
import { expect } from 'vitest'
import { declareOracle } from '../oracle-declaration'
import { createOracleReach } from '../oracle-reach'
import { ScenarioLifetime } from './scenario-lifetime'
import { selectedRow } from './result-laws'
import type { LiveQueryDriver, LiveQueryHandle, QueryBuild } from './contract'

type Shape =
  | `object`
  | `array`
  | `introduced`
  | `null-prototype`
  | `aliases`
  | `accessor`
  | `array-subclass`
  | `store-proxy`
export type SnapshotInput = `callback` | `config` | `collection`
export type SnapshotWrites = `sync` | `optimistic`
type Payload = {
  value: number
  added?: { value: number }
  optional?: undefined
}
type SnapshotRow = {
  id: string
  value: number
  config: unknown
  format: () => string
  extra?: Payload
}
const format = () => `row`

class SnapshotValues extends Array<number> {
  total(): number {
    return this.reduce((sum, value) => sum + value, 0)
  }
}

// The model uses scalar history inputs, never a copy of an observed source row.
// Root fields are admitted and removed as well as changed; subset comparisons
// would let unexpected historical fields survive. Function leaves stay opaque.
function snapshot(
  shape: Shape,
  value: number,
  draftSource = false,
): SnapshotRow {
  const payload: Payload = { value }
  if (value === 1 || value === 2) {
    payload.added = { value }
    payload.optional = undefined
  }
  let config: unknown = payload
  if (shape === `array`)
    config = Array.from({ length: value % 3 }, (_, index) => ({
      value: value + index,
    }))
  if (shape === `introduced` && value === 0) config = null
  if (shape === `null-prototype` && !(draftSource && value > 0))
    config = Object.assign(Object.create(null) as Payload, payload)
  if (shape === `aliases`) {
    const shared = { value }
    config =
      value % 2 === 0
        ? { left: shared, right: shared }
        : { left: { value }, right: { value: value - 1 } }
  }
  if (shape === `accessor`) config = { nested: payload }
  if (shape === `array-subclass`) {
    const values: Array<number> =
      draftSource && value > 0 ? [] : new SnapshotValues()
    values.push(value, value + 1)
    config = values
  }
  return {
    id: `a`,
    value,
    config,
    format,
    ...(value === 1 || value === 2
      ? { extra: { value, optional: undefined } }
      : draftSource && value > 0
        ? { extra: undefined }
        : {}),
  }
}

// The held edit and its confirming full sync need not carry identical fields.
// Special container prototypes enter through sync: the draft copier owns the
// representation of newly assigned values, outside this receiving law. Their
// optimistic edits change only a scalar. Other shapes replace nested values and
// add root fields; the confirming sync removes the final root field.
function pendingSnapshot(
  shape: Shape,
  value: number,
  draftSource = false,
): SnapshotRow {
  const previous = snapshot(shape, value - 1, draftSource)
  if (
    shape === `null-prototype` ||
    shape === `array-subclass` ||
    shape === `store-proxy`
  )
    return { ...previous, value }
  const next = snapshot(shape, value)
  return next.extra ? next : { ...next, extra: undefined }
}

// Bounded exhaustive grammar: every shape crosses the three input forms and
// both write paths in suite.ts. Three versions split, merge and split aliases,
// introduce nested objects, and remove root fields. Absent-key writes are illegal
// and excluded. Only a driver with a real store supplies the store-proxy premise.
function* histories(
  driver: LiveQueryDriver,
  input: SnapshotInput,
  writes: SnapshotWrites,
) {
  const shapes: Array<Shape> = [
    `object`,
    `array`,
    `introduced`,
    `null-prototype`,
    `aliases`,
    `accessor`,
    `array-subclass`,
  ]
  if (driver.wrapSnapshotValue) shapes.push(`store-proxy`)
  for (const shape of shapes) yield { shape, input, writes }
}

function sourceRow(
  driver: LiveQueryDriver,
  shape: Shape,
  value: number,
): SnapshotRow {
  const row = snapshot(shape, value)
  if (shape === `accessor`) {
    const nested = (row.config as { nested: Payload }).nested
    row.config = {
      get nested() {
        return nested
      },
    }
  }
  // Local-only replacements pass through Core draft detachment. That boundary
  // owns assigning host proxies; this receiving witness starts with a native
  // store and then supplies ordinary replacement data. The controlled sync
  // witness admits native stores on every update as well.
  if (
    shape === `store-proxy` &&
    (!driver.snapshotSourceUsesDraft || value === 0)
  )
    row.config = driver.wrapSnapshotValue!(row.config as Payload)
  return row
}

type Retained = { label: string; actual: SnapshotRow; expected: SnapshotRow }

// Only the four documented virtual fields and hidden framework bookkeeping are
// excluded by selectedRow. Unexpected ordinary fields, even undefined, must fail.
export function expectRowSnapshot(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  const observed = selectedRow(actual)
  const wanted = selectedRow(expected)
  expect(observed, label).toEqual(wanted)
  expectSnapshotKeys(observed, wanted, label)
}

// Draft detachment owns container prototypes; this law judges complete values,
// including own undefined fields, without imposing a new detachment policy.
// A separate receiving comparison below preserves source-supplied methods.
function expectSnapshotKeys(actual: unknown, expected: unknown, label: string) {
  if (expected === null || typeof expected !== `object`) return
  const keys = (value: object) =>
    Reflect.ownKeys(value).filter(
      (key) =>
        typeof key !== `symbol` ||
        Object.prototype.propertyIsEnumerable.call(value, key),
    )
  expect(new Set(keys(actual as object)), label).toEqual(
    new Set(keys(expected)),
  )
  for (const key of keys(expected))
    expectSnapshotKeys(
      Reflect.get(actual as object, key),
      Reflect.get(expected, key),
      label,
    )
}

function expectSnapshots(
  handle: LiveQueryHandle,
  expected: SnapshotRow,
  retained: ReadonlyArray<Retained>,
): void {
  const data = handle.current().data as Array<SnapshotRow>
  expect(data, `complete current result`).toHaveLength(1)
  expectRowSnapshot(data[0], expected, `current framework row`)
  if (expected.config instanceof SnapshotValues) {
    const config = data[0]!.config as SnapshotValues
    expect(config, `source-supplied array subclass`).toBeInstanceOf(
      SnapshotValues,
    )
    expect(config.total(), `source-supplied array method`).toBe(
      expected.config.reduce((sum, value) => sum + value, 0),
    )
  }
  for (let index = retained.length - 1; index >= 0; index--) {
    const saved = retained[index]!
    expectRowSnapshot(saved.actual, saved.expected, saved.label)
    if (saved.expected.config instanceof SnapshotValues) {
      const config = saved.actual.config as SnapshotValues
      expect(config, `${saved.label}: retained array subclass`).toBeInstanceOf(
        SnapshotValues,
      )
      expect(config.total(), `${saved.label}: retained array method`).toBe(
        saved.expected.config.total(),
      )
    }
  }
}

export async function runRowSnapshotHistories(
  driver: LiveQueryDriver,
  input: SnapshotInput,
  writes: SnapshotWrites,
): Promise<void> {
  const cases = [...histories(driver, input, writes)]
  const states = [
    input,
    writes,
    ...cases.map(({ shape }) => shape),
    `retained-previousValue`,
    ...(writes === `optimistic` ? [`retained-original`] : []),
    `later-object-admission`,
    `root-delete-representation`,
    `nested-own-undefined`,
  ]
  const reach = createOracleReach(
    `framework.${driver.name}.${input}.${writes}.row-snapshots`,
    states,
  )
  const failures: Array<Error> = []
  for (const history of cases) {
    reach.beginHistory()
    const resources = new ScenarioLifetime()
    try {
      await resources.run(async () => {
        let expected = snapshot(history.shape, 0)
        const check = (retained: ReadonlyArray<Retained>) =>
          expectSnapshots(handle!, expected, retained)
        const source = driver.makeSource(
          [sourceRow(driver, history.shape, 0)],
          undefined,
          { rowUpdateMode: `full` },
        )
        let handle: LiveQueryHandle | undefined
        try {
          if (input === `collection`)
            handle = driver.mountCollection(source.collection)
          else {
            const build: QueryBuild = (q) =>
              q
                .from({ row: source.collection })
                .select(({ row }: { row: SnapshotRow }) => ({ ...row }))
            handle =
              input === `config`
                ? driver.mountConfig(build)
                : driver.mount(build)
          }
          resources.defer(() => handle?.unmount())
          const retained: Array<Retained> = []
          const subscription = source.collection.subscribeChanges(
            (changes) => {
              for (const change of changes)
                if (change.previousValue) {
                  retained.push({
                    label: `previousValue`,
                    actual: change.previousValue as SnapshotRow,
                    expected,
                  })
                  reach.reach(`retained-previousValue`)
                }
            },
            { includeInitialState: false },
          )
          resources.defer(() => subscription.unsubscribe())
          await handle.flush()
          reach.reach(input)
          reach.reach(history.shape)
          check(retained)
          for (let value = 1; value <= 3; value++) {
            retained.push({
              label: `Collection.get before ${value}`,
              actual: source.collection.get(`a`) as SnapshotRow,
              expected,
            })
            const nextExpected = snapshot(
              history.shape,
              value,
              driver.snapshotSourceUsesDraft,
            )
            const next = sourceRow(driver, history.shape, value)
            if (writes === `optimistic`) {
              let release!: () => void
              const gate = new Promise<void>((resolve) => {
                release = resolve
              })
              resources.defer(release)
              const edit = driver.ops.createOptimisticAction({
                onMutate: () =>
                  source.collection.update(`a`, (draft: SnapshotRow) => {
                    draft.value = next.value
                    if (
                      history.shape !== `null-prototype` &&
                      history.shape !== `array-subclass` &&
                      history.shape !== `store-proxy`
                    ) {
                      draft.config = next.config
                      if (next.extra) draft.extra = next.extra
                      else delete draft.extra
                    }
                  }),
                mutationFn: async () => {
                  await gate
                  source.update(next)
                },
              })
              const tx = edit()
              void tx.when(`settled`).catch(() => undefined)
              resources.defer(() => tx.when(`settled`))
              retained.push({
                label: `mutation.original before ${value}`,
                actual: tx.mutations[0]!.original as SnapshotRow,
                expected,
              })
              reach.reach(`retained-original`)
              expected = pendingSnapshot(
                history.shape,
                value,
                driver.snapshotSourceUsesDraft,
              )
              await handle.flush()
              check(retained)
              release()
              await tx.when(`settled`)
              expected = nextExpected
            } else {
              await handle.apply(() => source.update(next))
              expected = nextExpected
            }
            await handle.flush()
            reach.reach(writes)
            if (value >= 2) reach.reach(`later-object-admission`)
            if (value === 3) reach.reach(`root-delete-representation`)
            if (value === 1) reach.reach(`nested-own-undefined`)
            check(retained)
          }
        } finally {
          resources.defer(() => handle?.collection()?.cleanup())
          resources.defer(() => source.collection.cleanup())
        }
      })
    } catch (cause) {
      failures.push(new Error(`${history.shape}/${input}/${writes}`, { cause }))
    }
  }
  // Histories are independent. Finish the finite grammar before reporting every
  // failure; one broken shape must not hide another receiving path's result.
  if (failures.length)
    throw new AggregateError(
      failures,
      failures
        .map((error) => `${error.message}: ${String(error.cause)}`)
        .join(`\n`),
      { cause: failures[0] },
    )
  reach.assertReached()
  expect(Object.fromEntries(reach.counts())).toEqual({
    [input]: cases.length,
    [writes]: cases.length,
    ...Object.fromEntries(cases.map(({ shape }) => [shape, 1])),
    'retained-previousValue': cases.length,
    ...(writes === `optimistic` ? { 'retained-original': cases.length } : {}),
    'later-object-admission': cases.length,
    'root-delete-representation': cases.length,
    'nested-own-undefined': cases.length,
  })
}

declareOracle({
  model: [snapshot, pendingSnapshot],
  grammar: [histories],
  check: [expectRowSnapshot, expectSnapshots, expectSnapshotKeys],
})
