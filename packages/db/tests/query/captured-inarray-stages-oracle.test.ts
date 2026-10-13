/**
 * # Where must captured membership be refreshed?
 *
 * Law: a caller-owned array passed to `inArray` remains query input after
 * compilation. Editing it alone need not publish. After the next delivered
 * source transaction, every existing public result uses its current members,
 * including rows that the transaction did not touch. The fixed histories here
 * exercise numeric membership in projection, ordering, grouping, plain and
 * wrapped aggregate arguments, HAVING, and either operand of a join equality.
 * They establish these placements for one unrelated source update, not all
 * legal histories.
 *
 * Model: the small plain arrays below calculate membership with JavaScript
 * `includes` at each checkpoint. Their expected values do not use compiled
 * expressions or D2 output. The source grammar has three rows: values 1 and 2
 * are untouched, while an update to value 3 clocks the change. The joined
 * grammar adds one TRUE flag. Public live-query rows and one subscriber batch
 * are the observations, immediately after preload and the source commit.
 * A compiler that only reevaluates the changed row fails at the second cut.
 */
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import {
  add,
  caseWhen,
  count,
  eq,
  inArray,
  max,
  min,
  sum,
} from '../../src/query/builder/functions.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'

type Row = { id: string; v: number; revision: number }
const originalRows: Array<Row> = [
  { id: `one`, v: 1, revision: 0 },
  { id: `two`, v: 2, revision: 0 },
  { id: `trigger`, v: 3, revision: 0 },
]
let collectionSerial = 0

function makeRows() {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id: `captured-inarray-stages-${collectionSerial++}`,
      getKey: (row) => row.id,
      initialData: originalRows,
    }),
  )
}

function clockRows(source: ReturnType<typeof makeRows>): void {
  source.utils.begin()
  source.utils.write({
    type: `update`,
    value: { id: `trigger`, v: 3, revision: 1 },
  })
  source.utils.commit()
}

describe(`captured inArray query-stage oracle`, () => {
  it(`refreshes every projected member in one public transaction`, async () => {
    const source = makeRows()
    const members = [1]
    const live = createLiveQueryCollection((q) =>
      q.from({ row: source }).select(({ row }) => ({
        id: row.id,
        member: inArray(row.v, members),
      })),
    )
    const batches: Array<Array<{ type: string; id: string; member: boolean }>> =
      []
    let unsubscribe: (() => void) | undefined
    await withOracleCleanup(async () => {
      await live.preload()
      const subscription = live.subscribeChanges(
        (changes) => {
          // Publication is one coherent cut: the callback can read the whole
          // new result while it receives the changed projected rows.
          expect(
            live.toArray
              .map((row) => ({ id: row.id, member: row.member }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          ).toEqual(
            originalRows
              .map((row) => ({ id: row.id, member: members.includes(row.v) }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          )
          batches.push(
            changes.map((change) => ({
              type: change.type,
              id: change.value.id,
              member: change.value.member,
            })),
          )
        },
        { includeInitialState: false },
      )
      unsubscribe = () => subscription.unsubscribe()
      const expected = () =>
        originalRows.map((row) => ({
          id: row.id,
          member: members.includes(row.v),
        }))
      const actual = () =>
        live.toArray
          .map((row) => ({ id: row.id, member: row.member }))
          .sort((a, b) => a.id.localeCompare(b.id))
      expect(actual()).toEqual(
        expected().sort((a, b) => a.id.localeCompare(b.id)),
      )

      members[0] = 2
      clockRows(source)
      expect(actual()).toEqual(
        expected().sort((a, b) => a.id.localeCompare(b.id)),
      )
      expect(batches).toHaveLength(1)
      expect(
        batches[0]
          ?.filter((change) => change.id !== `trigger`)
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual([
        { type: `update`, id: `one`, member: false },
        { type: `update`, id: `two`, member: true },
      ])
    }, [() => unsubscribe?.(), () => live.cleanup(), () => source.cleanup()])
  })

  it(`reorders a retained limited result`, async () => {
    const source = makeRows()
    const members = [1]
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => inArray(row.v, members), `desc`)
        .limit(1),
    )
    await withOracleCleanup(async () => {
      await live.preload()
      const expected = () =>
        originalRows.find((row) => members.includes(row.v))?.id
      expect(live.toArray.map((row) => row.id)).toEqual([expected()])
      members[0] = 2
      clockRows(source)
      expect(live.toArray.map((row) => row.id)).toEqual([expected()])
    }, [() => live.cleanup(), () => source.cleanup()])
  })

  it(`keeps a limited order unique when captured membership changes`, async () => {
    const rows: Array<Row> = [
      { id: `a`, v: 1, revision: 0 },
      { id: `b`, v: 2, revision: 0 },
      { id: `c`, v: 3, revision: 0 },
      { id: `trigger`, v: 4, revision: 0 },
    ]
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `captured-inarray-order-unique-${collectionSerial++}`,
        getKey: (row) => row.id,
        initialData: rows,
      }),
    )
    const members = [1]
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .select(({ row }) => ({ id: row.id }))
        .orderBy(({ row }) => inArray(row.v, members), `desc`)
        .limit(3),
    )
    await withOracleCleanup(async () => {
      await live.preload()
      // The plain-array model sorts each row once by current membership,
      // then key. The public limit must contain distinct source identities.
      const expected = () =>
        [...rows]
          .sort(
            (a, b) =>
              Number(members.includes(b.v)) - Number(members.includes(a.v)) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, 3)
          .map((row) => row.id)
      expect(live.toArray.map((row) => row.id)).toEqual(expected())
      members[0] = 2
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: { id: `trigger`, v: 4, revision: 1 },
      })
      source.utils.commit()
      expect(live.toArray.map((row) => row.id)).toEqual(expected())
    }, [() => live.cleanup(), () => source.cleanup()])
  })

  it(`requests an unbounded source for projected membership under an ordered limit`, async () => {
    type RankedRow = { id: string; v: number; rank: number }
    const rows: Array<RankedRow> = [0, 1, 2, 3, 4].map((v) => ({
      id: String(v),
      v,
      rank: v,
    }))
    const requests: Array<{
      hasWhere: boolean
      hasOrder: boolean
      hasLimit: boolean
    }> = []
    let begin!: () => void
    let write!: (message: { type: `delete`; value: RankedRow }) => void
    let commit!: () => unknown
    const source = createCollection<RankedRow>({
      id: `captured-inarray-projected-demand-${collectionSerial++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: (options) => {
              requests.push({
                hasWhere: options.where !== undefined,
                hasOrder: options.orderBy !== undefined,
                hasLimit: options.limit !== undefined,
              })
              params.begin()
              for (const row of rows) {
                params.write({ type: `insert`, value: row })
              }
              params.commit()
              return true
            },
          }
        },
      },
    })
    const members = [1]
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .select(({ row }) => ({
          id: row.id,
          member: inArray(row.v, members),
        }))
        .orderBy(({ row }) => row.rank)
        .limit(1),
    )
    await withOracleCleanup(async () => {
      await live.preload()
      expect(requests[0]).toEqual({
        hasWhere: false,
        hasOrder: false,
        hasLimit: false,
      })
      const expected = () => ({ id: `0`, member: members.includes(0) })
      expect(
        live.toArray.map((row) => ({ id: row.id, member: row.member })),
      ).toEqual([expected()])

      members[0] = 0
      begin()
      write({ type: `delete`, value: rows[4]! })
      commit()
      expect(
        live.toArray.map((row) => ({ id: row.id, member: row.member })),
      ).toEqual([expected()])
    }, [() => live.cleanup(), () => source.cleanup()])
  })

  it(`moves untouched rows between group keys`, async () => {
    const source = makeRows()
    const members = [1]
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .groupBy(({ row }) => inArray(row.v, members))
        .select(({ row }) => ({ total: sum(row.v) })),
    )
    await withOracleCleanup(async () => {
      await live.preload()
      const expected = () => {
        const totals = new Map<boolean, number>()
        for (const row of originalRows) {
          const key = members.includes(row.v)
          totals.set(key, (totals.get(key) ?? 0) + row.v)
        }
        return [...totals.values()].sort((a, b) => a - b)
      }
      const actual = () =>
        live.toArray.map((row) => row.total).sort((a, b) => a - b)
      expect(actual()).toEqual(expected())
      members[0] = 2
      clockRows(source)
      expect(actual()).toEqual(expected())
    }, [() => live.cleanup(), () => source.cleanup()])
  })

  it(`recomputes an aggregate argument for untouched rows`, async () => {
    const source = makeRows()
    const members = [1]
    const live = createLiveQueryCollection((q) =>
      q.from({ row: source }).select(({ row }) => ({
        total: sum(caseWhen(inArray(row.v, members), row.v, 0)),
      })),
    )
    await withOracleCleanup(async () => {
      await live.preload()
      const expected = () =>
        originalRows.reduce(
          (total, row) => total + (members.includes(row.v) ? row.v : 0),
          0,
        )
      expect(live.toArray.map((row) => row.total)).toEqual([expected()])
      members[0] = 2
      clockRows(source)
      expect(live.toArray.map((row) => row.total)).toEqual([expected()])
    }, [() => live.cleanup(), () => source.cleanup()])
  })

  it(`recomputes a mutable aggregate argument inside a selected expression`, async () => {
    const source = makeRows()
    const members = [1]
    const live = createLiveQueryCollection((q) =>
      q.from({ row: source }).select(({ row }) => ({
        total: add(sum(caseWhen(inArray(row.v, members), row.v, 0)), 10),
      })),
    )
    await withOracleCleanup(async () => {
      await live.preload()
      // The outer addition changes no grouping rule: its aggregate argument
      // still sums every current member of the retained source relation.
      const expected = () =>
        10 +
        originalRows.reduce(
          (total, row) => total + (members.includes(row.v) ? row.v : 0),
          0,
        )
      expect(live.toArray.map((row) => row.total)).toEqual([expected()])
      members[0] = 2
      clockRows(source)
      expect(live.toArray.map((row) => row.total)).toEqual([expected()])
    }, [() => live.cleanup(), () => source.cleanup()])
  })

  it(`recomputes grouped SUM and min/max arguments in an untouched group`, async () => {
    type GroupRow = Row & { group: string }
    const rows: Array<GroupRow> = [
      { id: `a1`, group: `a`, v: 1, revision: 0 },
      { id: `a2`, group: `a`, v: 2, revision: 0 },
      { id: `b1`, group: `b`, v: 3, revision: 0 },
    ]
    const source = createCollection(
      mockSyncCollectionOptions<GroupRow>({
        id: `captured-inarray-group-aggregate-${collectionSerial++}`,
        getKey: (row) => row.id,
        initialData: rows,
      }),
    )
    const members = [1]
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .groupBy(({ row }) => row.group)
        .select(({ row }) => ({
          group: row.group,
          total: sum(caseWhen(inArray(row.v, members), row.v, 0)),
          lowest: min(caseWhen(inArray(row.v, members), row.v, 100)),
          highest: max(caseWhen(inArray(row.v, members), row.v, 0)),
        })),
    )
    await withOracleCleanup(async () => {
      await live.preload()
      // Each aggregate reads current membership over all source rows in its
      // group, including group a when the source transaction touches group b.
      const expected = () =>
        [`a`, `b`].map((group) => {
          const groupRows = rows.filter((row) => row.group === group)
          return {
            group,
            total: groupRows.reduce(
              (total, row) => total + (members.includes(row.v) ? row.v : 0),
              0,
            ),
            lowest: Math.min(
              ...groupRows.map((row) =>
                members.includes(row.v) ? row.v : 100,
              ),
            ),
            highest: Math.max(
              ...groupRows.map((row) => (members.includes(row.v) ? row.v : 0)),
            ),
          }
        })
      const actual = () =>
        live.toArray
          .map((row) => ({
            group: row.group,
            total: row.total,
            lowest: row.lowest,
            highest: row.highest,
          }))
          .sort((a, b) => a.group.localeCompare(b.group))
      expect(actual()).toEqual(expected())
      members[0] = 2
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: { id: `b1`, group: `b`, v: 3, revision: 1 },
      })
      source.utils.commit()
      expect(actual()).toEqual(expected())
    }, [() => live.cleanup(), () => source.cleanup()])
  })

  it(`refreshes HAVING after an unrelated group receives an update`, async () => {
    const source = makeRows()
    const members = [1]
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .groupBy(({ row }) => row.v)
        .select(({ row }) => ({ v: row.v, n: count(row.id) }))
        .having(({ $selected }) => inArray($selected.v, members)),
    )
    await withOracleCleanup(async () => {
      await live.preload()
      const expected = () =>
        originalRows
          .filter((row) => members.includes(row.v))
          .map((row) => row.v)
      expect(live.toArray.map((row) => row.v)).toEqual(expected())
      members[0] = 2
      clockRows(source)
      expect(live.toArray.map((row) => row.v)).toEqual(expected())
    }, [() => live.cleanup(), () => source.cleanup()])
  })

  for (const sourceSide of [`main`, `joined`] as const) {
    it(`refreshes membership in the ${sourceSide} JOIN operand`, async () => {
      const source = makeRows()
      const flags = createCollection(
        mockSyncCollectionOptions<{ id: string; flag: boolean }>({
          id: `captured-inarray-join-flags-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [{ id: `true`, flag: true }],
        }),
      )
      const members = [1]
      const live = createLiveQueryCollection((q) =>
        sourceSide === `main`
          ? q
              .from({ row: source })
              .innerJoin({ flag: flags }, ({ row, flag }) =>
                eq(inArray(row.v, members), flag.flag),
              )
          : q
              .from({ flag: flags })
              .innerJoin({ row: source }, ({ flag, row }) =>
                eq(flag.flag, inArray(row.v, members)),
              ),
      )
      await withOracleCleanup(async () => {
        await live.preload()
        const expected = () =>
          originalRows
            .filter((row) => members.includes(row.v))
            .map((row) => row.id)
        expect(live.toArray.map((row) => row.row.id)).toEqual(expected())
        members[0] = 2
        clockRows(source)
        expect(live.toArray.map((row) => row.row.id)).toEqual(expected())
      }, [() => live.cleanup(), () => flags.cleanup(), () => source.cleanup()])
    })
  }

  it(`refreshes projected membership through a nested QueryRef`, async () => {
    const source = makeRows()
    const members = [1]
    const live = createLiveQueryCollection((q) => {
      const inner = q.from({ item: source }).select(({ item }) => ({
        id: item.id,
        member: inArray(item.v, members),
      }))
      return q
        .from({ row: inner })
        .where(({ row }) => eq(row.member, true))
        .select(({ row }) => ({ id: row.id }))
    })
    await withOracleCleanup(async () => {
      await live.preload()
      const expected = () =>
        originalRows
          .filter((row) => members.includes(row.v))
          .map((row) => row.id)
      expect(live.toArray.map((row) => row.id)).toEqual(expected())
      members[0] = 2
      clockRows(source)
      expect(live.toArray.map((row) => row.id)).toEqual(expected())
    }, [() => live.cleanup(), () => source.cleanup()])
  })
})
