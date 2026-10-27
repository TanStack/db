/**
 * An index is a physical route for an `orderBy` query. It cannot choose a
 * different public prefix from a full-source scan of the same query, either
 * on the first read or after a source value changes kind. This follows the
 * `orderBy`/`limit` contract in docs/guides/live-queries.md; it does not define
 * a new global precedence among unlike JavaScript values.
 *
 * The reference is a separate ready Collection with auto-indexing disabled.
 * It holds the same keyed source rows as the indexed Collection and executes
 * the same public query. Its full scan is independent of index storage and the
 * index-only comparator being judged. The finite histories cross number,
 * bigint, boolean, string, ordinary-object, and array kinds, then update,
 * insert, or delete rows to enter and leave mixed domains. Ascending and
 * descending reads also exercise the reverse index adapter. Values are not
 * mutated in place. Every value set has a distinct first and second row, so
 * the law does not depend on an unspecified tie order. These witnesses do not
 * prescribe order for every mixed-kind combination or provider paging.
 *
 * After preload and after both source copies commit each step, direct ordered snapshots
 * and both live-query Collections must return the same exact ordered IDs.
 * The scan and indexed sources publish identical sync transactions. Running
 * both BasicIndex and BTreeIndex proves the optimizer cannot silently change
 * the query result. The original type-name index order loses at the exact
 * public-prefix comparison; a same-type step checks that the repair still
 * permits indexed traversal when its order agrees with the query.
 */
import { expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { PropRef } from '../../src/query/ir.js'
import { declareOracle } from '../oracle-config.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'
import type {
  LoadSubsetOptions,
  SyncConfig,
  UtilsRecord,
} from '../../src/types.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type { BaseIndex } from '../../src/indexes/base-index.js'

type Value = number | bigint | boolean | string | { x: number } | Array<number>
type Row = { id: string; value: Value }
type Step =
  { type: `insert` | `update`; row: Row } | { type: `delete`; id: string }
type Scenario = {
  name: string
  initial: Array<Row>
  steps: Array<Step>
  indexedReads: Array<boolean>
}

const histories: Array<Scenario> = [
  {
    name: `number and bigint`,
    initial: [
      { id: `five`, value: 5n },
      { id: `ten`, value: 10n },
      { id: `three`, value: 3 },
    ],
    steps: [
      { type: `update`, row: { id: `three`, value: 12n } },
      { type: `insert`, row: { id: `minus`, value: -4 } },
      { type: `delete`, id: `minus` },
    ],
    indexedReads: [false, true, false, true],
  },
  {
    name: `number index gains and loses a bigint`,
    initial: [
      { id: `three`, value: 3 },
      { id: `five`, value: 5 },
    ],
    steps: [
      { type: `insert`, row: { id: `minus`, value: -1n } },
      { type: `update`, row: { id: `minus`, value: 7 } },
      { type: `update`, row: { id: `minus`, value: -2n } },
    ],
    indexedReads: [true, false, true, false],
  },
  {
    name: `boolean and number`,
    initial: [
      { id: `false`, value: false },
      { id: `five`, value: 5 },
      { id: `minus`, value: -1 },
    ],
    steps: [
      { type: `update`, row: { id: `false`, value: 7 } },
      { type: `insert`, row: { id: `true`, value: true } },
      { type: `delete`, id: `true` },
    ],
    indexedReads: [false, true, false, true],
  },
  {
    name: `object and string`,
    initial: [
      { id: `object`, value: { x: 1 } },
      { id: `b`, value: `b` },
      { id: `a`, value: `a` },
    ],
    steps: [
      { type: `update`, row: { id: `object`, value: `c` } },
      { type: `insert`, row: { id: `other`, value: { x: 2 } } },
      { type: `delete`, id: `other` },
    ],
    indexedReads: [false, true, false, true],
  },
  {
    name: `array and ordinary object`,
    initial: [
      { id: `array`, value: [1] },
      { id: `object`, value: { x: 1 } },
    ],
    steps: [
      { type: `update`, row: { id: `array`, value: { x: 2 } } },
      { type: `insert`, row: { id: `array-again`, value: [2] } },
      { type: `delete`, id: `array-again` },
    ],
    indexedReads: [false, true, false, true],
  },
]

function orderedSnapshot(
  source: Pick<
    Collection<Row, string | number, UtilsRecord, never, Row>,
    `currentStateAsChanges`
  >,
  direction: `asc` | `desc`,
): Array<string> {
  return source
    .currentStateAsChanges({
      orderBy: [
        {
          expression: new PropRef([`value`]),
          compareOptions: { direction, nulls: `first` },
        },
      ],
      limit: 2,
    })!
    .map((change) => change.value.id)
}

function applyStep(
  source: ReturnType<typeof mockSyncCollectionOptions<Row>>,
  rows: Map<string, Row>,
  step: Step,
): void {
  source.utils.begin()
  if (step.type === `delete`) {
    source.utils.write({ type: `delete`, value: rows.get(step.id)! })
    rows.delete(step.id)
  } else {
    source.utils.write({ type: step.type, value: step.row })
    rows.set(step.row.id, step.row)
  }
  source.utils.commit()
}

async function expectIndexedPublicOrder(
  scenario: Scenario,
  IndexType: typeof BasicIndex | typeof BTreeIndex,
  direction: `asc` | `desc`,
): Promise<void> {
  const scanOptions = mockSyncCollectionOptions<Row>({
    id: `mixed-order-scan-${scenario.name}-${IndexType.name}`,
    getKey: (row) => row.id,
    initialData: scenario.initial,
    autoIndex: `off`,
  })
  const indexedOptions = mockSyncCollectionOptions<Row>({
    id: `mixed-order-indexed-${scenario.name}-${IndexType.name}`,
    getKey: (row) => row.id,
    initialData: scenario.initial,
    autoIndex: `eager`,
    defaultIndexType: IndexType,
  })
  const scan = createCollection(scanOptions)
  const indexed = createCollection(indexedOptions)
  const scanRows = new Map(scenario.initial.map((row) => [row.id, row]))
  const indexedRows = new Map(scanRows)
  let scanLive: ReturnType<typeof createLiveQueryCollection> | undefined
  let indexedLive: ReturnType<typeof createLiveQueryCollection> | undefined
  await withOracleCleanup(async () => {
    await Promise.all([scan.stateWhenReady(), indexed.stateWhenReady()])
    // Keep one ascending physical index so descending reads must use
    // ReverseIndex rather than auto-creating a descending index.
    indexed.createIndex((row) => row.value, { indexType: IndexType })
    const check = (checkpoint: string, expectIndexRead: boolean) => {
      const expected = orderedSnapshot(scan, direction)
      const indexes = [...indexed.indexes.values()]
      expect(indexes, `${checkpoint}: index exists`).toHaveLength(1)
      const index = indexes[0] as BaseIndex<string>
      expect(index, `${checkpoint}: index type`).toBeInstanceOf(IndexType)
      expect(index.matchesDirection(`asc`)).toBe(true)
      const take = vi.spyOn(
        index,
        direction === `asc` ? `takeFromStart` : `takeReversedFromEnd`,
      )
      try {
        expect(
          orderedSnapshot(indexed, direction),
          `${checkpoint}: direct prefix`,
        ).toEqual(expected)
        if (expectIndexRead)
          expect(take, `${checkpoint}: indexed route`).toHaveBeenCalled()
        else
          expect(take, `${checkpoint}: full-scan route`).not.toHaveBeenCalled()
      } finally {
        take.mockRestore()
      }
      expect(
        [...scanLive!.values()].map((row) => row.id),
        `${checkpoint}: scan live prefix`,
      ).toEqual(expected)
      expect(
        [...indexedLive!.values()].map((row) => row.id),
        `${checkpoint}: indexed live prefix`,
      ).toEqual(expected)
    }
    // Compile both live queries while the initial source domain is mixed.
    scanLive = createLiveQueryCollection((q) =>
      q
        .from({ row: scan })
        .orderBy(({ row }) => row.value, direction)
        .limit(2),
    )
    indexedLive = createLiveQueryCollection((q) =>
      q
        .from({ row: indexed })
        .orderBy(({ row }) => row.value, direction)
        .limit(2),
    )
    await Promise.all([scanLive.preload(), indexedLive.preload()])
    check(`initial domain`, scenario.indexedReads[0]!)
    for (const [position, step] of scenario.steps.entries()) {
      applyStep(scanOptions, scanRows, step)
      applyStep(indexedOptions, indexedRows, step)
      check(
        `step ${position + 1}: ${step.type}`,
        scenario.indexedReads[position + 1]!,
      )
    }
  }, [
    () => indexedLive?.cleanup(),
    () => scanLive?.cleanup(),
    () => indexed.cleanup(),
    () => scan.cleanup(),
  ])
}

declareOracle({ check: [expectIndexedPublicOrder] })

for (const scenario of histories) {
  for (const IndexType of [BasicIndex, BTreeIndex]) {
    for (const direction of [`asc`, `desc`] as const) {
      it(`${IndexType.name} preserves ${scenario.name} ${direction} public order across kind changes`, () =>
        expectIndexedPublicOrder(scenario, IndexType, direction))
    }
  }
}

/**
 * The eager histories above do not cross provider demand. This receiving
 * history begins with a homogeneous numeric index and a finite on-demand
 * provider. A later bigint insert makes that retained index ineligible for
 * a new ordered plan. The independent provider filters requested predicates,
 * applies cursors, and returns only the requested page from its own source
 * rows. At each settled window, the model sorts those rows by numeric value
 * and compares the exact public IDs. The bigint first enters the visible
 * prefix, then moves beyond it; a subsequent deletion requires a missing
 * provider row to enter the bounded result. A later page reaches a cursor.
 * This checks the public result, not whether an existing loader avoids every
 * unnecessary index read.
 */
type NumericRow = { id: string; value: number | bigint }

// The shared request reference intentionally accepts only like-typed numeric
// operands. This local extension gives the provider its legal number/bigint
// cursor semantics using JavaScript's direct relational order.
function evaluateNumericRequest(
  expression: BasicExpression,
  row: NumericRow,
): unknown {
  if (expression.type !== `func`)
    return evaluateReferenceExpression(expression, row)
  if (expression.name === `and` || expression.name === `or`) {
    const values = expression.args.map((arg) =>
      evaluateNumericRequest(arg, row),
    )
    return expression.name === `and`
      ? values.every(Boolean)
      : values.some(Boolean)
  }
  if ([`gt`, `gte`, `lt`, `lte`].includes(expression.name)) {
    const [left, right] = expression.args.map((arg) =>
      evaluateNumericRequest(arg, row),
    )
    if (
      (typeof left === `number` || typeof left === `bigint`) &&
      (typeof right === `number` || typeof right === `bigint`)
    ) {
      const sign = left < right ? -1 : left > right ? 1 : 0
      switch (expression.name) {
        case `gt`:
          return sign > 0
        case `gte`:
          return sign >= 0
        case `lt`:
          return sign < 0
        case `lte`:
          return sign <= 0
      }
    }
  }
  return evaluateReferenceExpression(expression, row)
}

it(`preserves a retained on-demand window after its index domain becomes mixed`, async () => {
  const initial: Array<NumericRow> = [
    { id: `three`, value: 3 },
    { id: `five`, value: 5 },
    { id: `ten`, value: 10 },
    { id: `twenty`, value: 20 },
    { id: `thirty`, value: 30 },
  ]
  const truth = new Map(initial.map((row) => [row.id, row]))
  const installed = new Map(initial.slice(0, 2).map((row) => [row.id, row]))
  const requests: Array<LoadSubsetOptions> = []
  let sync!: Parameters<SyncConfig<NumericRow, string>[`sync`]>[0]
  const compare = (a: NumericRow, b: NumericRow) =>
    a.value < b.value ? -1 : a.value > b.value ? 1 : 0
  const expected = (offset = 0, limit = 2) =>
    [...truth.values()]
      .sort(compare)
      .slice(offset, offset + limit)
      .map((row) => row.id)

  const source = createCollection<NumericRow, string>({
    id: `mixed-index-order-on-demand`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `off`,
    sync: {
      sync: (operations) => {
        sync = operations
        sync.begin()
        for (const row of installed.values()) {
          sync.write({ type: `insert`, value: row })
        }
        sync.commit()
        sync.markReady()
        return {
          loadSubset: async (options) => {
            requests.push(options)
            const matched = [...truth.values()]
              .filter(
                (row) =>
                  (!options.where ||
                    evaluateNumericRequest(options.where, row) === true) &&
                  (!options.cursor ||
                    evaluateNumericRequest(options.cursor.whereFrom, row) ===
                      true),
              )
              .sort(compare)
            const offset = options.cursor ? 0 : (options.offset ?? 0)
            const page = matched.slice(
              offset,
              options.limit === undefined ? undefined : offset + options.limit,
            )
            sync.begin()
            for (const row of page) {
              if (installed.get(row.id) === row) continue
              sync.write({
                type: installed.has(row.id) ? `update` : `insert`,
                value: row,
              })
              installed.set(row.id, row)
            }
            await sync.commit()
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  let live: ReturnType<typeof createLiveQueryCollection> | undefined
  let take: { mockRestore: () => void } | undefined
  await withOracleCleanup(async () => {
    await source.stateWhenReady()
    const index = source.createIndex((row) => row.value, {
      indexType: BTreeIndex,
    })
    expect(index.supportsOrderOptimization).toBe(true)
    take = vi.spyOn(index, `takeFromStart`)
    live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.value)
        .limit(2),
    )
    await live.preload()
    expect([...live.values()].map((row) => row.id)).toEqual(expected())
    expect(take).toHaveBeenCalled()

    const mixed: NumericRow = { id: `four`, value: 4n }
    truth.set(mixed.id, mixed)
    sync.begin()
    sync.write({ type: `insert`, value: mixed })
    installed.set(mixed.id, mixed)
    await sync.commit()
    expect(index.supportsOrderOptimization).toBe(false)
    await live.utils.setWindow({ offset: 0, limit: 2 })
    expect(expected()).toEqual([`three`, `four`])
    expect([...live.values()].map((row) => row.id)).toEqual(expected())

    const moved: NumericRow = { id: `four`, value: 15n }
    truth.set(moved.id, moved)
    sync.begin()
    sync.write({ type: `update`, value: moved })
    installed.set(moved.id, moved)
    await sync.commit()
    await live.utils.setWindow({ offset: 0, limit: 2 })
    expect(expected()).toEqual([`three`, `five`])
    expect([...live.values()].map((row) => row.id)).toEqual(expected())
    expect(installed.has(`ten`)).toBe(false)

    const requestsBeforeDeletion = requests.length
    truth.delete(`three`)
    sync.begin()
    sync.write({ type: `delete`, value: initial[0]! })
    installed.delete(`three`)
    await sync.commit()
    await live.utils.setWindow({ offset: 0, limit: 2 })
    expect(expected()).toEqual([`five`, `ten`])
    expect([...live.values()].map((row) => row.id)).toEqual(expected())
    expect(installed.has(`ten`)).toBe(true)
    expect(
      requests
        .slice(requestsBeforeDeletion)
        .some((request) => request.orderBy && request.limit === 2),
    ).toBe(true)

    const requestsBeforePage = requests.length
    await live.utils.setWindow({ offset: 2, limit: 2 })
    expect([...live.values()].map((row) => row.id)).toEqual(expected(2, 2))
    expect(
      requests.slice(requestsBeforePage).some((request) => request.cursor),
    ).toBe(true)
  }, [() => take?.mockRestore(), () => live?.cleanup(), () => source.cleanup()])
})
