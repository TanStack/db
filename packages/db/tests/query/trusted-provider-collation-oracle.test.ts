/**
 * # A custom collation that the provider applies pages through the provider
 *
 * ## Contract
 *
 * `query/live/ARCHITECTURE.md`, "Ordered requests, continuation, and
 * recovery": local order is authoritative, and a provider's order may be used
 * for a finite window only when it is known to match. A custom comparator is
 * unknown to the provider by default, so an ordered window reads its whole
 * filtered source. `trustProviderOrder: true` is the caller's statement that
 * the provider orders strings with that same comparator. Such a window asks
 * for finite ordered pages and still publishes the comparator's order.
 *
 * ## Limits
 *
 * The cells cross direction, automatic indexing, the place the collation is
 * declared and the trust flag, over one first window and one forward move. A
 * provider that breaks the caller's statement is outside the contract.
 *
 * ## Model
 *
 * `expectedIds` sorts the rows with this file's comparator and takes the
 * window. `expectedAcquisition` follows from the flag alone: trusted windows
 * read finite ordered pages and leave rows undelivered, and untrusted windows
 * read the filtered source once with no order or limit.
 *
 * ## Production path and observation
 *
 * The driver runs a live query over an on-demand collection and observes the
 * public rows and the options that reach `loadSubset` at each window.
 */
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  Query,
  and,
  count,
  createLiveQueryCollection,
  eq,
  gt,
  gte,
  lt,
  lte,
  max,
} from '../../src/query/index.js'
import { PropRef } from '../../src/query/ir.js'
import { computeSubscriptionOrderByHints } from '../../src/query/live/utils.js'
import { buildCursor, canExpressCursorOrder } from '../../src/utils/cursor.js'
import { canOptimizeExpression } from '../../src/utils/index-optimization.js'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import type { Collection } from '../../src/collection/index.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { OrderBy } from '../../src/query/ir.js'
import type {
  CustomStringCollation,
  LoadSubsetOptions,
} from '../../src/types.js'

type Row = { id: number; label: string }

// Ignores spaces and symbols first, as a Postgres glibc collation does: an
// order that neither lexical comparison nor Intl.Collator reproduces.
function compareLabels(left: string, right: string): number {
  const primary = (value: string) => value.replace(/[^a-z0-9]/gi, ``)
  const a = primary(left)
  const b = primary(right)
  if (a !== b) return a < b ? -1 : 1
  return left === right ? 0 : left < right ? -1 : 1
}

const labels = [
  `+3 power`,
  `3`,
  `a b`,
  `ab`,
  `b-c`,
  `bc`,
  `c`,
  `#d`,
  `d e`,
  `e`,
]
const rows: Array<Row> = labels.map((label, index) => ({
  id: (index * 7) % labels.length,
  label,
}))

const trustCases = [`asc`, `desc`].flatMap((direction) =>
  [`off`, `eager`].flatMap((autoIndex) =>
    [`source`, `order`].flatMap((declaredOn) =>
      [false, true].map((trusted) => ({
        direction: direction as `asc` | `desc`,
        autoIndex: autoIndex as `off` | `eager`,
        declaredOn: declaredOn as `source` | `order`,
        trusted,
      })),
    ),
  ),
)
type TrustCase = (typeof trustCases)[number]

function sortedRows(direction: TrustCase[`direction`]): Array<Row> {
  const sign = direction === `asc` ? 1 : -1
  return [...rows].sort((a, b) => sign * compareLabels(a.label, b.label))
}

const expectedIds = (
  direction: TrustCase[`direction`],
  offset: number,
  limit: number,
) =>
  sortedRows(direction)
    .slice(offset, offset + limit)
    .map(({ id }) => id)

function expectAcquisition(
  { trusted }: TrustCase,
  loads: ReadonlyArray<LoadSubsetOptions>,
  delivered: ReadonlySet<number>,
) {
  if (trusted) {
    expect(loads[0]?.orderBy, `first read is ordered`).toBeDefined()
    expect(loads[0]?.limit, `first read is finite`).toBeDefined()
    expect(delivered.size, `rows left undelivered`).toBeLessThan(rows.length)
  } else {
    expect(loads, `one full-source read`).toHaveLength(1)
    expect(loads[0]?.orderBy, `full-source read has no order`).toBeUndefined()
    expect(loads[0]?.limit, `full-source read has no limit`).toBeUndefined()
  }
}

async function runTrustCell(cell: TrustCase): Promise<void> {
  const collation: CustomStringCollation = {
    stringSort: `custom`,
    compare: compareLabels,
    ...(cell.trusted ? { trustProviderOrder: true } : {}),
  }
  const loads: Array<LoadSubsetOptions> = []
  const delivered = new Set<number>()
  const source = createCollection<Row>({
    id: `trusted-collation-${cell.direction}-${cell.autoIndex}-${cell.declaredOn}-${cell.trusted}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: cell.autoIndex,
    defaultIndexType: cell.autoIndex === `eager` ? BTreeIndex : undefined,
    ...(cell.declaredOn === `source`
      ? { defaultStringCollation: collation }
      : {}),
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loads.push(options)
            // The provider applies the caller's collation to a finite read.
            const direction =
              options.orderBy?.[0]?.compareOptions.direction ?? cell.direction
            const where = options.where
              ? compileSingleRowExpression(options.where)
              : undefined
            const from = options.cursor
              ? compileSingleRowExpression(options.cursor.whereFrom)
              : undefined
            const ordered = sortedRows(direction).filter(
              (row) =>
                (!where || where(row) === true) &&
                (!from || from(row) === true),
            )
            const offset = from ? 0 : (options.offset ?? 0)
            const answer =
              options.limit === undefined
                ? ordered
                : ordered.slice(offset, offset + options.limit)
            begin()
            for (const row of answer) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            const receipt = commit()
            return receipt === true ? Promise.resolve() : receipt
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    query: (query) =>
      query
        .from({ row: source })
        .orderBy(
          ({ row }) => row.label,
          cell.declaredOn === `order`
            ? { direction: cell.direction, nulls: `first`, ...collation }
            : { direction: cell.direction, nulls: `first` },
        )
        .limit(3)
        .select(({ row }) => ({ id: row.id })),
  })
  try {
    await live.preload()
    expect(
      Array.from(live.values(), ({ id }) => id),
      `first window`,
    ).toEqual(expectedIds(cell.direction, 0, 3))
    expectAcquisition(cell, loads, delivered)

    await live.utils.setWindow({ offset: 3, limit: 3 })
    expect(
      Array.from(live.values(), ({ id }) => id),
      `moved window`,
    ).toEqual(expectedIds(cell.direction, 3, 3))
    expectAcquisition(cell, loads, delivered)
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
}

// A collated comparison keeps its collation through every rewrite between the
// query and its evaluation. The model filters the rows with this file's
// comparator, so a pass that drops the collation, or an index range that
// answers it in lexical order, publishes different rows.
const comparisons = { gt, gte, lt, lte }
const holds = {
  gt: (order: number) => order > 0,
  gte: (order: number) => order >= 0,
  lt: (order: number) => order < 0,
  lte: (order: number) => order <= 0,
}
const predicateShapes = [
  `where`,
  `compound`,
  `subquery`,
  `group-key`,
  `aggregate`,
  `selected-aggregate`,
  `selected-expression`,
  `index-simple`,
  `index-compound`,
] as const
const predicateCases = predicateShapes.flatMap((shape) =>
  (Object.keys(comparisons) as Array<keyof typeof comparisons>).flatMap(
    (operator) =>
      [`3`, `ab`].map((threshold) => ({ shape, operator, threshold })),
  ),
)
type PredicateCase = (typeof predicateCases)[number]

const trustedCollation: CustomStringCollation = {
  stringSort: `custom`,
  compare: compareLabels,
  trustProviderOrder: true,
}

async function runPredicateCell({
  shape,
  operator,
  threshold,
}: PredicateCase): Promise<void> {
  const source = createCollection<Row>({
    id: `trusted-predicate-${shape}-${operator}-${threshold}`,
    getKey: (row) => row.id,
    // Lexical order is the one an index range can answer for strings.
    defaultStringCollation: { stringSort: `lexical` },
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) write({ type: `insert`, value: { ...row } })
        commit()
        markReady()
      },
    },
  })
  const compare = comparisons[operator] as (
    left: unknown,
    right: unknown,
    collation: CustomStringCollation,
  ) => ReturnType<typeof gt>
  const collated = (left: unknown) => compare(left, threshold, trustedCollation)
  const expected = labels
    .filter((label) => holds[operator](compareLabels(label, threshold)))
    .sort()
  // An index answers a range in its own order, so it must decline a collated
  // comparison and leave it to the row filter.
  if (shape === `index-simple` || shape === `index-compound`) {
    try {
      await source.preload()
      const label = new PropRef([`label`])
      // An uncollated subscription builds the index for this field.
      source
        .subscribeChanges(() => {}, { whereExpression: gte(label, ``) })
        .unsubscribe()
      expect(
        canOptimizeExpression(gte(label, ``), source),
        `the index path is reached`,
      ).toBe(true)
      const where =
        shape === `index-simple`
          ? collated(label)
          : and(collated(label), lte(label, `zzz`))
      expect(
        canOptimizeExpression(collated(label), source),
        `an index declines the collated comparison`,
      ).toBe(false)
      expect(
        source
          .currentStateAsChanges({ where })!
          .map(({ value }) => value.label)
          .sort(),
        `${shape} ${operator} ${threshold}`,
      ).toEqual(expected)
    } finally {
      await source.cleanup()
    }
    return
  }
  const live = createLiveQueryCollection({
    query: ((query: InitialQueryBuilder) => {
      if (shape === `where`) {
        return query
          .from({ row: source })
          .where(({ row }) => collated(row.label))
          .select(({ row }) => ({ label: row.label }))
      }
      if (shape === `compound`) {
        return query
          .from({ row: source })
          .where(({ row }) => and(collated(row.label), gte(row.id, 0)))
          .select(({ row }) => ({ label: row.label }))
      }
      if (shape === `subquery`) {
        const inner = new Query()
          .from({ row: source })
          .select(({ row }) => ({ id: row.id, label: row.label }))
        return query
          .from({ sub: inner })
          .join({ other: source }, ({ sub, other }) => eq(sub.id, other.id))
          .where(({ sub }) => collated(sub.label))
          .select(({ sub }) => ({ label: sub.label }))
      }
      const grouped = query
        .from({ row: source })
        .groupBy(({ row }) => row.label)
      if (shape === `group-key`) {
        return grouped
          .select(({ row }) => ({ label: row.label, rows: count(row.id) }))
          .having(({ row }) => collated(row.label))
      }
      if (shape === `aggregate`) {
        return grouped
          .select(({ row }) => ({ label: row.label, top: max(row.label) }))
          .having(({ row }) => collated(max(row.label)))
      }
      if (shape === `selected-expression`) {
        return grouped.select(({ row }) => ({
          label: row.label,
          matches: collated(max(row.label)),
        }))
      }
      return grouped
        .select(({ row }) => ({ label: row.label, top: max(row.label) }))
        .having(({ $selected }) => collated($selected.top))
    }) as never,
  }) as unknown as Collection<{ label: string; matches?: boolean }>
  try {
    await live.preload()
    expect(
      Array.from(live.values())
        .filter(({ matches }) => matches !== false)
        .map(({ label }) => label)
        .sort(),
      `${shape} ${operator} ${threshold}`,
    ).toEqual(expected)
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
}

// The cursor and subscription hints are the two places that decide, from the
// resolved collation, whether a provider may see an order or a string bound.
const hintCases = [false, true].flatMap((trusted) =>
  [`clause`, `query-default`].map((declaredOn) => ({
    trusted,
    declaredOn: declaredOn as `clause` | `query-default`,
  })),
)

function runHintCell({
  trusted,
  declaredOn,
}: (typeof hintCases)[number]): void {
  const collation: CustomStringCollation = {
    stringSort: `custom`,
    compare: compareLabels,
    ...(trusted ? { trustProviderOrder: true } : {}),
  }
  const orderBy = [
    {
      expression: new PropRef([`row`, `label`]),
      compareOptions: {
        direction: `asc`,
        nulls: `first`,
        ...(declaredOn === `clause` ? collation : {}),
      },
    },
  ] as unknown as OrderBy
  const hints = computeSubscriptionOrderByHints(
    { orderBy, limit: 3 },
    `row`,
    declaredOn === `clause` ? { stringSort: `lexical` } : collation,
  )
  expect(hints.limit, `limit hint`).toBe(trusted ? 3 : undefined)
  expect(hints.orderBy !== undefined, `order hint`).toBe(trusted)
  if (declaredOn === `clause`) {
    expect(canExpressCursorOrder(orderBy, [`3`]), `cursor expressible`).toBe(
      trusted,
    )
    const cursor = buildCursor(orderBy, [`3`]) as { collation?: unknown }
    expect(cursor.collation !== undefined, `cursor collation`).toBe(trusted)
  }
}

// Rows the comparator treats as equal can straddle a page. The loader reads
// the boundary's ties, so a tie that differs only in case must still arrive.
// The model orders by the comparator and then by ascending key.
const compareIgnoringCase = (left: string, right: string) => {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  return a === b ? 0 : a < b ? -1 : 1
}
const tieRows: Array<Row> = [
  { id: 1, label: `A` },
  { id: 2, label: `a` },
  { id: 3, label: `b` },
  { id: 4, label: `B` },
  { id: 5, label: `c` },
]
const tieCases = [`asc`, `desc`].flatMap((direction) =>
  [1, 2].map((limit) => ({
    direction: direction as `asc` | `desc`,
    limit,
  })),
)

async function runTieCell({
  direction,
  limit,
}: (typeof tieCases)[number]): Promise<void> {
  const sign = direction === `asc` ? 1 : -1
  const ordered = [...tieRows].sort(
    (a, b) => sign * compareIgnoringCase(a.label, b.label) || a.id - b.id,
  )
  const delivered = new Set<number>()
  const source = createCollection<Row>({
    id: `trusted-collation-ties-${direction}-${limit}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    defaultStringCollation: {
      stringSort: `custom`,
      compare: compareIgnoringCase,
      trustProviderOrder: true,
    },
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const where = options.where
              ? compileSingleRowExpression(options.where)
              : undefined
            const from = options.cursor
              ? compileSingleRowExpression(options.cursor.whereFrom)
              : undefined
            const offset = from ? 0 : (options.offset ?? 0)
            const matching = ordered.filter(
              (row) =>
                (!where || where(row) === true) &&
                (!from || from(row) === true),
            )
            const answer =
              options.limit === undefined
                ? matching
                : matching.slice(offset, offset + options.limit)
            begin()
            for (const row of answer) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            const receipt = commit()
            return receipt === true ? Promise.resolve() : receipt
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    query: (query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.label, { direction, nulls: `first` })
        .limit(limit)
        .select(({ row }) => ({ id: row.id })),
  })
  try {
    await live.preload()
    for (let offset = 0; offset < ordered.length; offset += limit) {
      await live.utils.setWindow({ offset, limit })
      expect(
        Array.from(live.values(), ({ id }) => id),
        `window at ${offset}`,
      ).toEqual(ordered.slice(offset, offset + limit).map(({ id }) => id))
    }
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
}

// A grouped select reads a group key by its expression, so a collated and an
// uncollated comparison of the same operands are different keys.
const groupKeyCases = [
  { name: `the same collation`, sameCollation: true },
  { name: `no collation on the key`, sameCollation: false },
]

async function runGroupKeyCell({
  sameCollation,
}: (typeof groupKeyCases)[number]): Promise<void> {
  const source = createCollection<Row>({
    id: `trusted-group-key-${sameCollation}`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) write({ type: `insert`, value: { ...row } })
        commit()
        markReady()
      },
    },
  })
  const build = (query: InitialQueryBuilder) =>
    query
      .from({ row: source })
      .groupBy(({ row }) =>
        sameCollation
          ? (gt as never as CollatedGt)(row.label, `3`, trustedCollation)
          : gt(row.label, `3`),
      )
      .select(({ row }) => ({
        over: (gt as never as CollatedGt)(row.label, `3`, trustedCollation),
        rows: count(row.id),
      }))
  try {
    if (sameCollation) {
      const live = createLiveQueryCollection({
        query: build as never,
      }) as unknown as Collection<{ over: boolean }>
      await live.preload()
      expect(live.size, `one row per collated key`).toBe(2)
      await live.cleanup()
    } else {
      expect(() => {
        createLiveQueryCollection({ query: build as never })
      }, `an uncollated key does not stand in for a collated select`).toThrow()
    }
  } finally {
    await source.cleanup()
  }
}

type CollatedGt = (
  left: unknown,
  right: unknown,
  collation: CustomStringCollation,
) => ReturnType<typeof gt>

describe(`custom string collation trusted to the provider`, () => {
  oracleProperty({
    id: `trusted-provider-collation.group-key`,
    law: {
      statement: `A grouped select matches a group key only when both comparisons carry the same collation.`,
      authority: `The collation parameter of gt, gte, lt and lte in query/builder/functions.ts.`,
      limits: `One comparison selected against a collated and an uncollated key.`,
    },
    owns: ['src/query/compiler/group-by.ts'],
    histories: groupKeyCases,
    label: ({ name }) => `grouped by ${name}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`collated group key`, plan, observe, () =>
        runGroupKeyCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `trusted-provider-collation.ties`,
    law: {
      statement: `Rows the trusted comparator treats as equal are not lost when they straddle a page boundary.`,
      authority: `query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `One case-insensitive comparator, two directions and two page sizes.`,
    },
    owns: ['src/utils/cursor.ts'],
    histories: tieCases,
    label: ({ direction, limit }) =>
      `keeps ties ${direction} in pages of ${limit}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`trusted collation ties`, plan, observe, () =>
        runTieCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `trusted-provider-collation.predicate`,
    law: {
      statement: `A collated gt, gte, lt or lte selects the rows its comparator selects, through index, compound, subquery and grouped evaluation.`,
      authority: `The collation parameter of gt, gte, lt and lte in query/builder/functions.ts.`,
      limits: `Nine query shapes, four operators and two thresholds over one eager source.`,
    },
    owns: [
      'src/query/compiler/evaluators.ts',
      'src/query/compiler/group-by.ts',
      'src/query/optimizer.ts',
      'src/utils/index-optimization.ts',
    ],
    histories: predicateCases,
    label: ({ shape, operator, threshold }) =>
      `${shape} ${operator} ${threshold}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`collated predicate`, plan, observe, () =>
        runPredicateCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `trusted-provider-collation.hints`,
    law: {
      statement: `Only a trusted custom collation exposes an order, a limit or a string cursor to the provider.`,
      authority: `query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `Trust flag by declaration site, at the two functions that decide it.`,
    },
    owns: ['src/query/live/utils.ts', 'src/utils/cursor.ts'],
    histories: hintCases,
    label: ({ trusted, declaredOn }) =>
      `${trusted ? `exposes` : `withholds`} the order declared on ${declaredOn}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`collation hints`, plan, observe, () =>
        runHintCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `trusted-provider-collation.window`,
    law: {
      statement: `A custom collation marked trustProviderOrder reads finite ordered pages and publishes the comparator's order; an unmarked one reads its filtered source once.`,
      authority: `query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `Direction, automatic index, declaration site and trust flag over one first window and one forward move; a provider that breaks the caller's statement is outside the contract.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/query/compiler/order-by.ts',
      'src/query/live/utils.ts',
      'src/utils/comparison.ts',
    ],
    histories: trustCases,
    label: ({ direction, autoIndex, declaredOn, trusted }) =>
      `${trusted ? `pages` : `reads the source`} for ${direction} ${autoIndex} index declared on ${declaredOn}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`trusted collation window`, plan, observe, () =>
        runTrustCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })
})
