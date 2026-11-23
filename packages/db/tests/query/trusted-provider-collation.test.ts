import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq, gt } from '../../src/query/builder/functions.js'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators.js'
import { getLoadSubsetDemandKey } from '../../src/query/ir-stable-identity.js'
import { PropRef, Value } from '../../src/query/ir.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type {
  CustomStringCollation,
  LoadSubsetOptions,
} from '../../src/types.js'

type Row = { id: number; label: string; keep: boolean }

// Ignores spaces and symbols first, as Postgres glibc collations do: an order
// no lexical or Intl.Collator setting reproduces.
function compareLabels(a: string, b: string): number {
  const primary = (value: string) => value.replace(/[^a-z0-9]/gi, ``)
  const left = primary(a)
  const right = primary(b)
  if (left !== right) return left < right ? -1 : 1
  return a === b ? 0 : a < b ? -1 : 1
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
  `f!`,
  `ff`,
]

const rows: Array<Row> = labels.map((label, id) => ({
  id: (id * 7) % labels.length,
  label,
  keep: true,
}))

const expectedOrder = [...rows]
  .sort((a, b) => compareLabels(a.label, b.label) || a.id - b.id)
  .map(({ id }) => id)

function setup(collation: CustomStringCollation) {
  const loads: Array<LoadSubsetOptions> = []
  const delivered = new Set<number>()
  const source = createCollection<Row>({
    id: `trusted-collation-${Math.random()}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    defaultStringCollation: collation,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loads.push(options)
            const where = options.where
              ? compileSingleRowExpression(options.where)
              : undefined
            // A provider that orders strings by the same collation.
            const matching = rows
              .filter((row) => (where ? where(row) === true : true))
              .sort((a, b) => {
                const direction =
                  options.orderBy?.[0]?.compareOptions.direction === `desc`
                    ? -1
                    : 1
                return direction * compareLabels(a.label, b.label)
              })
            const offset = options.offset ?? 0
            const answer =
              options.limit === undefined
                ? matching.slice(offset)
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
  return { loads, delivered, source }
}

const trusted: CustomStringCollation = {
  stringSort: `custom`,
  compare: compareLabels,
  trustProviderOrder: true,
}

describe(`custom string collation with trustProviderOrder`, () => {
  it(`asks the provider for a bounded page, not the full source`, async () => {
    const { loads, delivered, source } = setup(trusted)
    const live = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ row: source })
          .where(({ row }) => eq(row.keep, true))
          .orderBy(({ row }) => row.label, `asc`)
          .limit(3)
          .select(({ row }) => ({ id: row.id })),
    })
    await live.preload()

    expect(Array.from(live.values(), ({ id }) => id)).toEqual(
      expectedOrder.slice(0, 3),
    )
    expect(loads.length).toBeGreaterThan(0)
    expect(loads.every((load) => load.where !== undefined)).toBe(true)
    expect(loads[0]?.orderBy).toBeDefined()
    expect(loads[0]?.limit).toBeDefined()
    expect(delivered.size).toBeLessThan(rows.length)
    await live.cleanup()
    await source.cleanup()
  })

  it(`pages forward through a collated cursor`, async () => {
    const { loads, delivered, source } = setup(trusted)
    const live = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.label, `asc`)
          .limit(3)
          .select(({ row }) => ({ id: row.id })),
    })
    await live.preload()
    await live.utils.setWindow({ offset: 3, limit: 3 })

    expect(Array.from(live.values(), ({ id }) => id)).toEqual(
      expectedOrder.slice(3, 6),
    )
    // Pages carry a limit; the only other loads are each boundary's ties,
    // bounded by equality on the order field.
    expect(
      loads.every(
        (load) =>
          load.limit !== undefined ||
          (load.where?.type === `func` && load.where.name === `eq`),
      ),
    ).toBe(true)
    const cursor = loads.find((load) => load.cursor)?.cursor
    expect(
      cursor?.whereFrom.type === `func` && cursor.whereFrom.collation,
    ).toEqual(trusted)
    expect(delivered.size).toBeLessThan(rows.length)
    await live.cleanup()
    await source.cleanup()
  })

  it(`keeps the full-source request when the provider order is untrusted`, async () => {
    const { loads, source } = setup({
      stringSort: `custom`,
      compare: compareLabels,
    })
    const live = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.label, `asc`)
          .limit(3)
          .select(({ row }) => ({ id: row.id })),
    })
    await live.preload()

    expect(Array.from(live.values(), ({ id }) => id)).toEqual(
      expectedOrder.slice(0, 3),
    )
    expect(loads[0]?.orderBy).toBeUndefined()
    expect(loads[0]?.limit).toBeUndefined()
    await live.cleanup()
    await source.cleanup()
  })
})

describe(`collated comparisons`, () => {
  const label = new PropRef([`label`])

  it(`compare strings by the collation`, () => {
    const lexical = compileSingleRowExpression(gt(label, new Value(`3`)))
    const collated = compileSingleRowExpression(
      gt(label, new Value(`3`), trusted),
    )
    expect(lexical({ label: `+3 power` })).toBe(false)
    expect(collated({ label: `+3 power` })).toBe(true)
  })

  it(`carry the collation into query identity`, () => {
    const where = (expression: BasicExpression<boolean>) =>
      getLoadSubsetDemandKey({ where: expression, limit: 3 })
    const plain = where(gt(label, new Value(`b`)))
    const collatedA = where(gt(label, new Value(`b`), trusted))
    const collatedB = where(gt(label, new Value(`b`), trusted))
    const otherCompare = where(
      gt(label, new Value(`b`), {
        stringSort: `custom`,
        compare: (a, b) => compareLabels(b, a),
        trustProviderOrder: true,
      }),
    )
    expect(collatedA).toBe(collatedB)
    expect(collatedA).not.toBe(plain)
    expect(collatedA).not.toBe(otherCompare)
  })
})
