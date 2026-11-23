/**
 * # A filter through a LEFT-joined filter subquery pages its root source
 *
 * ## Contract
 *
 * `query/live/ARCHITECTURE.md`, "Ordered requests, continuation, and
 * recovery": an ordered window whose filter reads one LEFT-joined collection
 * loads root rows a page at a time and waits for the joined rows of each page.
 * A subquery that only filters and projects one collection reads that
 * collection's rows by key in the same way, so it pages too. A subquery that
 * can change which joined rows exist for a key (a limit, an offset, grouping or an aggregate,
 * another join, a function clause, a single-row result or a nested source)
 * keeps the full-source read.
 *
 * ## Limits
 *
 * The cells cross the existence check (`some`, `none`) with each subquery
 * shape over one window on one on-demand root and one on-demand joined source.
 * Every provider answer settles without a hold; joined-demand scheduling is
 * owned by `ordered-work.work-joined-plan`.
 *
 * ## Model
 *
 * `expectedIds` recomputes the window from the fixture with plain arrays.
 * `pages` states the acquisition from the shape alone: a filter subquery reads
 * finite root pages and leaves root rows undelivered, and any other subquery
 * reads the root source once with no limit.
 *
 * ## Production path and observation
 *
 * The driver runs a live query and observes its public rows and the options
 * that reach the root collection's `loadSubset`.
 */
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  Query,
  count,
  createLiveQueryCollection,
  eq,
  isUndefined,
  max,
  not,
} from '../../src/query/index.js'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import type { Collection } from '../../src/collection/index.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { LoadSubsetOptions } from '../../src/types.js'

type Seek = { id: number; rank: number }
type Run = { id: number; seekId: number; userId: string }

const seeks: Array<Seek> = Array.from({ length: 24 }, (_, id) => ({
  id,
  rank: 100 - id,
}))
// Every third seek has only a hidden run; the rest have a visible one.
const runs: Array<Run> = seeks.map(({ id }) => ({
  id: id + 1000,
  seekId: id,
  userId: id % 3 === 0 ? `admin` : `user`,
}))

const pagingShapes = [`filter`, `distinct`] as const
const fullSourceShapes = [
  `limit`,
  `offset`,
  `join`,
  `group`,
  `fn-where`,
  `fn-select`,
  `fn-having`,
  `implicit-aggregate`,
  `single`,
  `nested`,
] as const
const subqueryCases = [`some`, `none`].flatMap((filter) =>
  [...pagingShapes, ...fullSourceShapes].map((shape) => ({
    filter: filter as `some` | `none`,
    shape,
  })),
)
type SubqueryCase = (typeof subqueryCases)[number]

const planOnly: ReadonlyArray<string> = [
  `single`,
  `fn-select`,
  `fn-having`,
  `implicit-aggregate`,
]

const pages = ({ shape }: SubqueryCase) =>
  (pagingShapes as ReadonlyArray<string>).includes(shape)

function expectedIds({ filter }: SubqueryCase): Array<number> {
  return seeks
    .filter(({ id }) => (filter === `some`) === (id % 3 !== 0))
    .slice(0, 5)
    .map(({ id }) => id)
}

function onDemand<T extends { id: number }>(
  id: string,
  data: ReadonlyArray<T>,
  order: (a: T, b: T) => number,
  loads: Array<LoadSubsetOptions>,
  delivered: Set<number>,
) {
  return createCollection<T>({
    id,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loads.push(options)
            const where = options.where
              ? compileSingleRowExpression(options.where)
              : undefined
            const from = options.cursor
              ? compileSingleRowExpression(options.cursor.whereFrom)
              : undefined
            const offset = from ? 0 : (options.offset ?? 0)
            const answer = [...data]
              .sort(order)
              .filter(
                (row) =>
                  (!where || where(row) === true) &&
                  (!from || from(row) === true),
              )
              .slice(
                offset,
                options.limit === undefined
                  ? undefined
                  : offset + options.limit,
              )
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
}

// Each builder keeps the joined key `k` and the visible runs, so every shape
// has the same answer and only its acquisition differs.
function visibleRuns(
  shape: SubqueryCase[`shape`],
  source: ReturnType<typeof onDemand<Run>>,
  other: ReturnType<typeof onDemand<Run>>,
) {
  const visible = new Query()
    .from({ run: source })
    .where(({ run }) => not(eq(run.userId, `admin`)))
  const project = () => visible.select(({ run }) => ({ k: run.seekId }))
  switch (shape) {
    case `filter`:
      return project()
    case `distinct`:
      return project().distinct()
    case `limit`:
      return visible
        .orderBy(({ run }) => run.id)
        .limit(1000)
        .select(({ run }) => ({ k: run.seekId }))
    case `offset`:
      return visible
        .orderBy(({ run }) => run.id)
        .offset(0)
        .select(({ run }) => ({ k: run.seekId }))
    case `join`:
      return visible
        .join({ same: other }, ({ run, same }) => eq(run.id, same.id))
        .select(({ run }) => ({ k: run.seekId }))
    case `group`:
      return visible
        .groupBy(({ run }) => run.seekId)
        .select(({ run }) => ({ k: run.seekId, runs: count(run.id) }))
    case `fn-where`:
      return new Query()
        .from({ run: source })
        .fn.where(({ run }) => run.userId !== `admin`)
        .select(({ run }) => ({ k: run.seekId }))
    case `fn-select`:
      return visible.fn.select(({ run }) => ({ k: run.seekId }))
    case `implicit-aggregate`:
      return visible.select(({ run }) => ({ k: max(run.seekId) }))
    case `fn-having`:
      return project().fn.having(() => true)
    case `single`:
      return project().findOne()
    case `nested`:
      return new Query()
        .from({ inner: project() })
        .select(({ inner }) => ({ k: inner.k }))
  }
}

async function runSubqueryCell(cell: SubqueryCase): Promise<void> {
  const name = `joined-filter-subquery-${cell.filter}-${cell.shape}`
  const rootLoads: Array<LoadSubsetOptions> = []
  const delivered = new Set<number>()
  const root = onDemand(
    `${name}-root`,
    seeks,
    (a, b) => b.rank - a.rank,
    rootLoads,
    delivered,
  )
  const joined = onDemand(
    `${name}-runs`,
    runs,
    (a, b) => a.id - b.id,
    [],
    new Set(),
  )
  const other = onDemand(
    `${name}-other`,
    runs,
    (a, b) => a.id - b.id,
    [],
    new Set(),
  )
  const live = createLiveQueryCollection({
    query: ((query: InitialQueryBuilder) =>
      query
        .from({ seek: root })
        .leftJoin(
          { visible: visibleRuns(cell.shape, joined, other) as never },
          ({ seek, visible }: any) => eq(seek.id, visible.k),
        )
        .where(({ visible }: any) =>
          cell.filter === `some`
            ? not(isUndefined(visible.k))
            : isUndefined(visible.k),
        )
        .orderBy(({ seek }) => seek.rank, `desc`)
        .limit(5)
        .select(({ seek }) => ({ id: seek.id }))) as never,
  }) as unknown as Collection<{ id: number }>
  try {
    if (planOnly.includes(cell.shape)) {
      // A single-row subquery has one joined row, and a function projection
      // or having clause has no key the outer join can read by, so only the
      // plan is judged.
      await live.preload()
      expect(rootLoads[0]?.limit, `${cell.shape} plan`).toBeUndefined()
      return
    }
    await live.preload()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(
      Array.from(live.values(), ({ id }) => id),
      `published window`,
    ).toEqual(expectedIds(cell))
    if (pages(cell)) {
      expect(rootLoads[0]?.limit, `first root read is finite`).toBeDefined()
      expect(delivered.size, `root rows left undelivered`).toBeLessThan(
        seeks.length,
      )
    } else {
      expect(rootLoads, `one root read`).toHaveLength(1)
      expect(rootLoads[0]?.limit, `root read has no limit`).toBeUndefined()
    }
  } finally {
    await live.cleanup()
    await root.cleanup()
    await joined.cleanup()
    await other.cleanup()
  }
}

describe(`ordered window filtered through a joined subquery`, () => {
  oracleProperty({
    id: `joined-filter-subquery.window`,
    law: {
      statement: `A filter through a LEFT join to a subquery that only filters and projects one collection pages its root source; any other subquery keeps the full-source read, and both publish the same window.`,
      authority: `query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `Two existence checks by twelve subquery shapes over one window; joined-demand scheduling belongs to ordered-work.work-joined-plan.`,
    },
    owns: ['src/query/compiler/order-by.ts#processOrderBy'],
    histories: subqueryCases,
    label: ({ filter, shape }) => `${filter} through a ${shape} subquery`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`joined subquery window`, plan, observe, () =>
        runSubqueryCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })
})
