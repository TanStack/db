/**
 * Framework materialization borrows Collection rows; it cannot edit them.
 * Authority: mutations.md's immutable updates and PendingMutation.original,
 * ChangeMessage.previousValue's previous row, and contract.ts's result law.
 * Current and retained source rows, admitted change values, mutation originals
 * and previous values keep their complete user values. Current results follow
 * the current source row.
 *
 * Source facts are captured before framework admission. Aliases and accessors
 * describe production inputs, not additional identity promises for hook output.
 * A framework may expose live proxies while keeping borrowed snapshots intact.
 * The optimistic-history owner covers other settlement schedules. Limits here:
 * one or two keys, three updates per key, the value grammar below, and settled
 * or held-handler cuts. Core's normalization policy, arbitrary cycles, hidden
 * symbols and callback atomicity are not judged.
 */
import { expect } from 'vitest'
import { declareOracle } from '../oracle-declaration'
import { createOracleReach } from '../oracle-reach'
import { ScenarioLifetime } from './scenario-lifetime'
import { selectedRow } from './result-laws'
import type {
  LiveQueryDriver,
  LiveQueryHandle,
  QueryBuild,
  SourceHandle,
} from './contract'

type Shape =
  | `object`
  | `hidden-data`
  | `shadowed`
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
const userField = Symbol(`selected user field`)

class SnapshotValues extends Array<number> {
  total(): number {
    return this.reduce((sum, value) => sum + value, 0)
  }
}

// Scalar versions construct source inputs, including alias splits and merges.
// The preservation model below records what the source admitted separately.
function snapshot(shape: Shape, value: number): SnapshotRow {
  const payload: Payload = { value }
  if (value === 1 || value === 2) {
    payload.added = { value }
    payload.optional = undefined
  }
  let config: unknown = payload
  if (shape === `hidden-data` && value < 3)
    Object.defineProperty(payload, `hidden`, {
      value: value === 2 ? undefined : value,
      enumerable: false,
      writable: true,
      configurable: true,
    })
  if (shape === `shadowed` && value > 0 && value < 3)
    for (const [key, supplied] of [
      [`toString`, Object.prototype.toString],
      [`constructor`, Object],
      [`__proto__`, `ordinary user data ${value}`],
      [userField, `user symbol ${value}`],
    ] as const)
      Object.defineProperty(payload, key, {
        value: value === 2 ? undefined : supplied,
        enumerable: true,
        writable: true,
        configurable: true,
      })
  if (shape === `array`)
    config = Array.from({ length: value % 3 }, (_, index) => ({
      value: value + index,
    }))
  if (shape === `introduced` && value === 0) config = null
  if (shape === `null-prototype`)
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
    const values = new SnapshotValues()
    values.push(value, value + 1)
    config = values
  }
  const row: SnapshotRow = {
    id: `a`,
    value,
    config,
    format,
    ...(value === 1 || value === 2
      ? { extra: { value, optional: undefined } }
      : {}),
  }
  // The same names cross root admission and nested admission. A root-only or
  // nested-only ownership fix must not satisfy the full selected-value law.
  if (shape === `shadowed`)
    for (const key of [`toString`, `constructor`, `__proto__`, userField]) {
      const descriptor = Object.getOwnPropertyDescriptor(payload, key)
      if (descriptor) Object.defineProperty(row, key, descriptor)
    }
  return row
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
    `hidden-data`,
    `shadowed`,
    `array`,
    `introduced`,
    `null-prototype`,
    `aliases`,
    `accessor`,
    `array-subclass`,
  ]
  if (driver.wrapSnapshotValue) shapes.push(`store-proxy`)
  for (const shape of shapes)
    for (const peers of [false, true]) yield { shape, input, writes, peers }
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

/**
 * The adapter borrows the values the source actually admitted, regardless of
 * which representation Core's draft boundary produces. Capture those facts
 * before mounting, and in a source subscriber installed before the hook. This
 * is a relational model of adapter preservation, not a second Core draft model.
 * A future change to Core's own-key or prototype policy changes the premise;
 * it must not require changing this adapter law to match Core's implementation.
 *
 * Facts are immutable trees of keys and scalar/opaque leaves, separate from
 * production containers. Array prototypes retain the existing method premise.
 * Hidden host symbols are outside the selected-value boundary at every level.
 */
type Fact =
  | { kind: `leaf`; value: unknown }
  | {
      kind: `container`
      array: boolean
      arrayPrototype: unknown
      arrayTotal: unknown
      fields: Map<PropertyKey, Fact>
    }

function facts(value: unknown): Fact {
  if (value === null || typeof value !== `object`)
    return { kind: `leaf`, value }
  const prototype: unknown = Object.getPrototypeOf(value)
  const array = Array.isArray(value)
  if (!array && prototype !== Object.prototype && prototype !== null)
    return { kind: `leaf`, value }
  return {
    kind: `container`,
    array,
    arrayPrototype: array ? prototype : undefined,
    // The grammar's subclass supplies a zero-argument total method. Preserve
    // that observable capability while permitting private wrapper prototypes.
    arrayTotal:
      array && typeof Reflect.get(value, `total`) === `function`
        ? Reflect.apply(Reflect.get(value, `total`) as () => unknown, value, [])
        : undefined,
    fields: new Map(
      Reflect.ownKeys(value)
        .filter(
          (key) =>
            typeof key !== `symbol` ||
            Object.prototype.propertyIsEnumerable.call(value, key),
        )
        .map((key) => [key, facts(Reflect.get(value, key))]),
    ),
  }
}

function rowFacts(value: unknown): Fact {
  return facts(selectedRow(value))
}

type Retained = { label: string; actual: unknown; expected: Fact }

// Preserve methods supplied by a source subclass. A plain source array does
// not promise that a framework removes every additional inherited method.
function expectFact(actual: Fact, expected: Fact, label: string): void {
  expect(actual.kind, label).toBe(expected.kind)
  if (actual.kind === `leaf` || expected.kind === `leaf`) {
    expect(actual, label).toEqual(expected)
    return
  }
  expect(actual.array, label).toBe(expected.array)
  if (expected.arrayPrototype && expected.arrayPrototype !== Array.prototype) {
    expect(
      actual.arrayPrototype === expected.arrayPrototype ||
        (actual.arrayPrototype !== null &&
          typeof actual.arrayPrototype === `object` &&
          Object.prototype.isPrototypeOf.call(
            expected.arrayPrototype,
            actual.arrayPrototype,
          )),
      `${label}: source-supplied array methods`,
    ).toBe(true)
    expect(actual.arrayTotal, `${label}: source-supplied array total`).toBe(
      expected.arrayTotal,
    )
  }
  expect(new Set(actual.fields.keys()), label).toEqual(
    new Set(expected.fields.keys()),
  )
  for (const [key, wanted] of expected.fields)
    expectFact(actual.fields.get(key)!, wanted, label)
}

export function expectRowSnapshot(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  expectFact(rowFacts(actual), rowFacts(expected), label)
}

function expectSnapshots(
  handle: LiveQueryHandle,
  source: SourceHandle<SnapshotRow>,
  expected: ReadonlyMap<string, Fact>,
  retained: ReadonlyArray<Retained>,
): void {
  const data = handle.current().data as Array<SnapshotRow>
  expect(data, `complete current result`).toHaveLength(expected.size)
  expect(new Set(data.map((row) => row.id)), `complete current keys`).toEqual(
    new Set(expected.keys()),
  )
  for (const row of data)
    expectFact(
      rowFacts(row),
      expected.get(row.id)!,
      `current framework row ${row.id}`,
    )
  // A correct detached framework result cannot excuse damage to the value it
  // borrowed. Check the current source at this cut, including the final update
  // that has no later get or previousValue to reveal the damage.
  for (const [id, wanted] of expected)
    expectFact(
      rowFacts(source.collection.get(id)),
      wanted,
      `current source row ${id}`,
    )
  for (const saved of retained)
    expectFact(rowFacts(saved.actual), saved.expected, saved.label)
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
    ...new Set(cases.map(({ shape }) => shape)),
    `cross-row-alias`,
    `current-source-row`,
    `retained-initial-row`,
    `retained-change-value`,
    `retained-previousValue`,
    ...(writes === `optimistic` || driver.snapshotSourceUsesDraft
      ? [`retained-original`]
      : []),
    `later-object-admission`,
    `root-delete-representation`,
    `nested-own-undefined`,
    ...(!driver.snapshotSourceUsesDraft ? [`enumerable-user-symbol`] : []),
    ...(!driver.snapshotSourceUsesDraft && writes === `sync`
      ? [`source-reference-reuse`]
      : []),
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
        const expected = new Map<string, Fact>()
        const check = (retained: ReadonlyArray<Retained>) => {
          expectSnapshots(handle!, source, expected, retained)
          reach.reach(`current-source-row`)
        }
        const initial = sourceRow(driver, history.shape, 0)
        const rows = history.peers
          ? [initial, { ...initial, id: `b` }]
          : [initial]
        const source = driver.makeSource(rows, undefined, {
          rowUpdateMode: `full`,
        })
        let handle: LiveQueryHandle | undefined
        try {
          const retained: Array<Retained> = []
          for (const { id } of rows) {
            const actual = source.collection.get(id)
            const wanted = rowFacts(actual)
            expected.set(id, wanted)
            retained.push({
              label: `initial Collection.get ${id}`,
              actual,
              expected: wanted,
            })
            reach.reach(`retained-initial-row`)
          }
          // Register before the hook so the source facts are recorded before
          // framework materialization can mutate any borrowed container.
          const subscription = source.collection.subscribeChanges(
            (changes) => {
              for (const change of changes) {
                const id = String(change.key)
                if (change.previousValue) {
                  retained.push({
                    label: `previousValue ${id}`,
                    actual: change.previousValue,
                    expected: expected.get(id)!,
                  })
                  reach.reach(`retained-previousValue`)
                }
                if (change.type === `delete`) expected.delete(id)
                else {
                  const wanted = rowFacts(change.value)
                  expected.set(id, wanted)
                  // Record facts and the actual borrowed value before the hook
                  // sees this admission. Keep checking it even if get() later
                  // returns another object or the framework output is correct.
                  retained.push({
                    label: `change.value ${id}`,
                    actual: change.value,
                    expected: wanted,
                  })
                  reach.reach(`retained-change-value`)
                }
              }
            },
            { includeInitialState: false },
          )
          resources.defer(() => subscription.unsubscribe())
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
          await handle.flush()
          reach.reach(input)
          reach.reach(history.shape)
          check(retained)
          if (history.peers && history.shape !== `introduced`) {
            const first = source.collection.get(`a`).config
            const second = source.collection.get(`b`).config
            expect(first, `admitted shared container`).not.toBeNull()
            expect(typeof first, `admitted shared container`).toBe(`object`)
            expect(second, `admitted shared container identity`).toBe(first)
            reach.reach(`cross-row-alias`)
          }
          for (let value = 1; value <= 3; value++)
            for (const { id } of rows) {
              retained.push({
                label: `Collection.get before ${value}`,
                actual: source.collection.get(id),
                expected: expected.get(id)!,
              })
              const before = expected.get(id)!
              const next = { ...sourceRow(driver, history.shape, value), id }
              // Odd versions split a shared node while retaining the previous
              // right input itself. Fresh-but-equal right objects cannot expose
              // a materializer that mutates a copy still needed by that path.
              const previousConfig = source.collection.get(id).config as {
                right: unknown
              }
              if (history.shape === `aliases` && value % 2 === 1)
                (next.config as { right: unknown }).right = previousConfig.right
              if (writes === `optimistic`) {
                let release!: () => void
                const gate = new Promise<void>((resolve) => {
                  release = resolve
                })
                resources.defer(release)
                const edit = driver.ops.createOptimisticAction({
                  onMutate: () =>
                    source.collection.update(id, (draft: SnapshotRow) => {
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
                  expected: before,
                })
                reach.reach(`retained-original`)
                await handle.flush()
                check(retained)
                release()
                await tx.when(`settled`)
              } else {
                await handle.apply(() => {
                  const mutation = source.update(next)
                  if (driver.snapshotSourceUsesDraft)
                    expect(
                      mutation?.mutations.length,
                      `actual local originals`,
                    ).toBeGreaterThan(0)
                  if (mutation && mutation.mutations.length > 0) {
                    for (const item of mutation.mutations)
                      retained.push({
                        label: `local mutation.original ${id}`,
                        actual: item.original,
                        expected: before,
                      })
                    reach.reach(`retained-original`)
                  }
                })
              }
              await handle.flush()
              if (
                history.shape === `aliases` &&
                value % 2 === 1 &&
                !driver.snapshotSourceUsesDraft &&
                writes === `sync`
              ) {
                expect(
                  (source.collection.get(id).config as { right: unknown })
                    .right,
                ).toBe(previousConfig.right)
                reach.reach(`source-reference-reuse`)
              }
              reach.reach(writes)
              if (value >= 2) reach.reach(`later-object-admission`)
              if (value === 3) reach.reach(`root-delete-representation`)
              if (value === 1) reach.reach(`nested-own-undefined`)
              // Only the controlled sync source promises this admission. The
              // local-only draft boundary owns its normalization policy; every
              // path still compares all user fields that it actually admits.
              if (
                history.shape === `shadowed` &&
                value === 1 &&
                !driver.snapshotSourceUsesDraft
              ) {
                expect(
                  Object.getOwnPropertyDescriptor(
                    source.collection.get(id),
                    userField,
                  )?.enumerable,
                  `source admitted enumerable user symbol`,
                ).toBe(true)
                reach.reach(`enumerable-user-symbol`)
              }
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
    ...Object.fromEntries(cases.map(({ shape }) => [shape, 2])),
    'cross-row-alias': cases.length / 2 - 1,
    'current-source-row': cases.length,
    'retained-initial-row': cases.length,
    'retained-change-value': cases.length,
    'retained-previousValue': cases.length,
    ...(writes === `optimistic` || driver.snapshotSourceUsesDraft
      ? { 'retained-original': cases.length }
      : {}),
    'later-object-admission': cases.length,
    'root-delete-representation': cases.length,
    'nested-own-undefined': cases.length,
    ...(!driver.snapshotSourceUsesDraft ? { 'enumerable-user-symbol': 2 } : {}),
    ...(!driver.snapshotSourceUsesDraft && writes === `sync`
      ? { 'source-reference-reuse': 2 }
      : {}),
  })
}

declareOracle({
  model: [facts, rowFacts],
  grammar: [histories],
  check: [expectRowSnapshot, expectSnapshots, expectFact],
})
