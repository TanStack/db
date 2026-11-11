import { fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../oracle-assertion-adapter.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
} from '../../src/query/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { runTrace } from '../trace-runner.js'
import { oracleProperty } from '../oracle-config.js'
import { registerIncludesProperty } from './includes-registration-oracle.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import { cleanupQuery } from './includes-query-shape-support.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'

/**
 * # Which distinctions determine the shape of an included result?
 *
 * Incremental query state can look correct while losing a semantic distinction
 * that a later change exposes. This suite isolates three such distinctions:
 *
 * 1. Join multiplicity keeps a parent visible until its last contributor leaves.
 * 2. A correlation through the joined alias differs from one through the source.
 * 3. A null or unmatched singleton is absent, but a later valid key reactivates it.
 *
 * These laws form separate model nodes. Each node uses plain Maps and full
 * recomputation. The shared trace runner applies an action to production and to
 * the matching node, then compares the complete public result. Combining the
 * nodes into one reference query engine would add machinery without making any
 * law stronger.
 *
 * Stable campaigns preserve the histories that exposed these distinctions.
 * Fresh random campaigns vary their value domains. Fixed histories cover route
 * movement and repeated retirement because those laws need ordered histories,
 * not more random scalar values.
 *
 * Authority: the contribution-conservation, route-relation, and
 * total-materialization laws in ARCHITECTURE.md. The model predicts complete
 * public rows, not callback timing, demand, or facade identity. The grammar
 * is bounded: one parent with 1–5 child contributors; one joined
 * production/order with equal or distinct correlation keys; and one post
 * with null, unmatched, or existing author keys. Missing child IDs and
 * updates to absent orders are invalid driver actions. Each real live-query
 * Collection is compared after preload and after every source write by
 * runTrace, which preserves the first divergent checkpoint.
 */

function rowsById<T extends { id: number }>(rows: Array<T>): Map<number, T> {
  return new Map(rows.map((row) => [row.id, row]))
}

function stripVirtualProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVirtualProperties)
  }
  if (!value || typeof value !== `object`) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith(`$`))
      .map(([key, entry]) => [key, stripVirtualProperties(entry)]),
  )
}

function assertRowsEqual(observed: unknown, expected: unknown): undefined {
  oracleAssertion('includes query-shape-oracle comparison 75', () =>
    expect(observed).toEqual(expected),
  )
  return undefined
}

type ParentRow = { id: number }
type ChildRow = { id: number; parentId: number }

type MultiplicitySources = ReturnType<typeof createMultiplicitySources>

function createChildren(childCount: number): Array<ChildRow> {
  return Array.from({ length: childCount }, (_, index) => ({
    id: index + 1,
    parentId: 1,
  }))
}

function createMultiplicitySources(childCount: number) {
  const sources = {
    parents: createControlledCollection<ParentRow>(`join-parents`, [{ id: 1 }]),
    children: createControlledCollection(
      `join-children`,
      createChildren(childCount),
    ),
  }
  sources.parents.collection.createIndex((row) => row.id, {
    indexType: BasicIndex,
  })
  sources.children.collection.createIndex((row) => row.parentId, {
    indexType: BasicIndex,
  })
  return sources
}

function createMultiplicityQuery(sources: MultiplicitySources) {
  return createLiveQueryCollection({
    query: (q) =>
      q
        .from({ parent: sources.parents.collection })
        .innerJoin(
          { child: sources.children.collection },
          ({ parent, child }) => eq(parent.id, child.parentId),
        )
        .select(({ parent }) => ({ id: parent.id })),
    getKey: (row) => row.id,
  })
}

type MultiplicityContext = {
  sources: MultiplicitySources
  live: ReturnType<typeof createMultiplicityQuery>
  parents: Map<number, ParentRow>
  children: Map<number, ChildRow>
}

function createMultiplicityDriver(
  childCount: number,
): TraceDriver<number, MultiplicityContext> {
  return {
    setup: () => {
      const parents = [{ id: 1 }]
      const children = createChildren(childCount)
      const sources = createMultiplicitySources(childCount)
      return {
        sources,
        live: createMultiplicityQuery(sources),
        parents: rowsById(parents),
        children: rowsById(children),
      }
    },
    start: ({ live }) => live.preload(),
    apply: (childId, { children, sources }) => {
      const child = children.get(childId)
      if (!child) throw new Error(`Missing child ${childId}`)
      sources.children.write(`delete`, child)
      children.delete(childId)
    },
    cleanup: ({ live, sources }) => cleanupQuery(live, Object.values(sources)),
  }
}

/**
 * The multiplicity model: a parent row is visible while at least one child
 * names it, however many children do. It scans plain Maps and keeps no join
 * state, so it predicts the row set that the joined query must publish.
 */
function expectedMultiplicityRows({
  children,
  parents,
}: Pick<MultiplicityContext, 'children' | 'parents'>): Array<ParentRow> {
  return [...parents.values()]
    .filter((parent) =>
      [...children.values()].some((child) => child.parentId === parent.id),
    )
    .sort((left, right) => left.id - right.id)
}

const multiplicityProjection: TraceProjection<
  MultiplicityContext,
  unknown,
  Array<ParentRow>
> = {
  // A join projects one parent row for any positive contributor count.
  observe: ({ live }) => stripVirtualProperties(live.toArray),
  recompute: expectedMultiplicityRows,
  assertEqual: assertRowsEqual,
}

type PartRow = { id: number }
type OrderRow = { id: number; partId: number }
type ProductionRow = { id: number; orderId: number }
type CorrelationTarget = `source` | `joined`

function createCorrelationSources(
  correlationId: number,
  productionId: number,
  orderId: number,
) {
  const sources = {
    parts: createControlledCollection<PartRow>(
      `correlation-parts`,
      [...new Set([correlationId, orderId])].map((id) => ({ id })),
    ),
    orders: createControlledCollection<OrderRow>(`correlation-orders`, [
      { id: orderId, partId: correlationId },
    ]),
    productions: createControlledCollection<ProductionRow>(
      `correlation-productions`,
      [{ id: productionId, orderId }],
    ),
  }
  sources.orders.collection.createIndex((row) => row.id, {
    indexType: BasicIndex,
  })
  sources.orders.collection.createIndex((row) => row.partId, {
    indexType: BasicIndex,
  })
  sources.productions.collection.createIndex((row) => row.orderId, {
    indexType: BasicIndex,
  })
  return sources
}

type CorrelationSources = ReturnType<typeof createCorrelationSources>

function createCorrelationQuery(
  sources: CorrelationSources,
  target: CorrelationTarget,
) {
  return createLiveQueryCollection((q) =>
    q
      .from({ part: sources.parts.collection })
      .orderBy(({ part }) => part.id)
      .select(({ part }) => {
        const joined = q
          .from({ production: sources.productions.collection })
          .innerJoin(
            { order: sources.orders.collection },
            ({ production, order }) => eq(production.orderId, order.id),
          )
        const correlated =
          target === `joined`
            ? joined.where(({ order }) => eq(order.partId, part.id))
            : joined.where(({ production }) => eq(production.orderId, part.id))

        return {
          id: part.id,
          productions: materialize(
            correlated
              .orderBy(({ production }) => production.id)
              .select(({ production }) => ({
                id: production.id,
                orderId: production.orderId,
              })),
          ),
        }
      }),
  )
}

type CorrelationContext = {
  target: CorrelationTarget
  sources: CorrelationSources
  live: ReturnType<typeof createCorrelationQuery>
  parts: Map<number, PartRow>
  orders: Map<number, OrderRow>
  productions: Map<number, ProductionRow>
}

function createCorrelationDriver(
  target: CorrelationTarget,
  correlationId: number,
  productionId: number,
  orderId = correlationId,
): TraceDriver<OrderRow, CorrelationContext> {
  return {
    setup: () => {
      const parts = [...new Set([correlationId, orderId])].map((id) => ({ id }))
      const order = { id: orderId, partId: correlationId }
      const production = { id: productionId, orderId }
      const sources = createCorrelationSources(
        correlationId,
        productionId,
        orderId,
      )
      return {
        target,
        sources,
        live: createCorrelationQuery(sources, target),
        parts: rowsById(parts),
        orders: rowsById([order]),
        productions: rowsById([production]),
      }
    },
    start: ({ live }) => live.preload(),
    apply: (order, { sources, orders }) => {
      if (!orders.has(order.id)) throw new Error(`Missing order ${order.id}`)
      sources.orders.write(`update`, { ...order })
      orders.set(order.id, { ...order })
    },
    cleanup: ({ live, sources }) => cleanupQuery(live, Object.values(sources)),
  }
}

type CorrelationResult = Array<{
  id: number
  productions: Array<ProductionRow>
}>

/**
 * The correlation model: each part's route holds the productions whose order
 * matches the correlation alias the target names. The joined alias routes by
 * `order.partId`, and the source alias routes by `production.orderId`. Plain
 * scans over Maps predict the published rows.
 */
function expectedCorrelationRows({
  orders,
  parts,
  productions,
  target,
}: Pick<
  CorrelationContext,
  'orders' | 'parts' | 'productions' | 'target'
>): CorrelationResult {
  return [...parts.values()]
    .sort((left, right) => left.id - right.id)
    .map((part) => ({
      id: part.id,
      productions: [...productions.values()]
        .filter((production) => {
          const order = orders.get(production.orderId)
          if (!order) return false
          return target === `joined`
            ? order.partId === part.id
            : production.orderId === part.id
        })
        .sort((left, right) => left.id - right.id),
    }))
}

const correlationProjection: TraceProjection<
  CorrelationContext,
  unknown,
  CorrelationResult
> = {
  // Correlation chooses a route. Join identity only decides which rows meet.
  observe: ({ live }) => stripVirtualProperties(live.toArray),
  recompute: expectedCorrelationRows,
  assertEqual: assertRowsEqual,
}

type AuthorRow = { id: number; name: string }
type PostRow = { id: number; authorId: number | null }

function createNullableSources(
  authors: Array<AuthorRow>,
  posts: Array<PostRow>,
) {
  return {
    authors: createControlledCollection<AuthorRow>(`nullable-authors`, authors),
    posts: createControlledCollection<PostRow>(`nullable-posts`, posts),
  }
}

type NullableSources = ReturnType<typeof createNullableSources>

function createNullableQuery(sources: NullableSources) {
  return createLiveQueryCollection((q) =>
    q
      .from({ post: sources.posts.collection })
      .orderBy(({ post }) => post.id)
      .select(({ post }) => ({
        id: post.id,
        author: materialize(
          q
            .from({ author: sources.authors.collection })
            .where(({ author }) => eq(author.id, post.authorId))
            .select(({ author }) => ({
              id: author.id,
              name: author.name,
            }))
            .findOne(),
        ),
      })),
  )
}

type NullableContext = {
  sources: NullableSources
  live: ReturnType<typeof createNullableQuery>
  authors: Map<number, AuthorRow>
  posts: Map<number, PostRow>
}

function createNullableDriver(
  authors: Array<AuthorRow>,
  posts: Array<PostRow>,
): TraceDriver<PostRow, NullableContext> {
  return {
    setup: () => {
      const sources = createNullableSources(
        authors.map((author) => ({ ...author })),
        posts.map((post) => ({ ...post })),
      )
      return {
        sources,
        live: createNullableQuery(sources),
        authors: rowsById(authors),
        posts: rowsById(posts),
      }
    },
    start: ({ live }) => live.preload(),
    apply: (post, context) => {
      context.sources.posts.write(
        context.posts.has(post.id) ? `update` : `insert`,
        { ...post },
      )
      context.posts.set(post.id, post)
    },
    cleanup: ({ live, sources }) => cleanupQuery(live, Object.values(sources)),
  }
}

type NullableResult = Array<{
  id: number
  author: AuthorRow | undefined
}>

/**
 * The nullable model: each post shows the author its key names, and a null key
 * or an unmatched key shows no author. The model reads the Maps directly, so it
 * never routes through a join.
 */
function expectedNullableRows({
  authors,
  posts,
}: Pick<NullableContext, 'authors' | 'posts'>): NullableResult {
  return [...posts.values()]
    .sort((left, right) => left.id - right.id)
    .map((post) => ({
      id: post.id,
      author: post.authorId === null ? undefined : authors.get(post.authorId),
    }))
}

const nullableProjection: TraceProjection<
  NullableContext,
  unknown,
  NullableResult
> = {
  // SQL equality never matches null. A later non-null key starts a fresh route.
  observe: ({ live }) => stripVirtualProperties(live.toArray),
  recompute: expectedNullableRows,
  assertEqual: assertRowsEqual,
}

/**
 * The check is `runTrace`. After preload and after every source write, it
 * compares the live query's rows with the projection's model, and it reports
 * the first divergent checkpoint. The models are the three recomputations above,
 * each computed from the driver's own Maps.
 */
function campaigns(fixedSeed: number, property: string) {
  return [
    { name: `fixed and random`, options: { runs: 12, property, fixedSeed } },
  ]
}

const multiplicityLaw = `Deleting one joined contributor preserves the remaining multiplicity, and deleting the final one removes the parent's child.`
const correlationLaw = `Materialization follows its correlation alias, whether the source or the joined alias, and stays distinct from join identity through route moves.`
const nullableLaw = `A null or unmatched correlation key materializes an undefined singleton, and a key that returns from null starts a fresh route.`

// Fixed histories of the three query-shape families, replayed through each
// family's shared driver and recomputation. The first history of each list is
// the clean replay of that family's calibration, which the calibration
// corrupts; the framework tries candidates in this order.
const multiplicityFixedHistories = [
  {
    name: `matches recomputation after one of two joined contributors leaves`,
    childCount: 2,
  },
  {
    name: `matches recomputation when the final joined contributor is deleted`,
    childCount: 1,
  },
]

const correlationFixedHistories: Array<{
  name: string
  target: CorrelationTarget
  correlationId: number
  productionId: number
  orderId: number
  steps: Array<OrderRow>
}> = [
  {
    name: `matches recomputation for a source correlation beside a distinct order part`,
    target: `source`,
    correlationId: 1,
    productionId: 101,
    orderId: 7,
    steps: [],
  },
  {
    name: `matches recomputation when materialization correlates through its source alias`,
    target: `source`,
    correlationId: 1,
    productionId: 101,
    orderId: 1,
    steps: [],
  },
  // Part 1 is the joined correlation. Part 7 is the source correlation.
  // Moving order.partId changes only the joined query, then restores it.
  ...([`source`, `joined`] as const).map((target) => ({
    name: `keeps ${target} correlation distinct from join identity through route moves`,
    target,
    correlationId: 1,
    productionId: 101,
    orderId: 7,
    steps: [
      { id: 7, partId: 7 },
      { id: 7, partId: 1 },
    ],
  })),
]

const nullableFixedHistories: Array<{
  name: string
  authors: Array<AuthorRow>
  posts: Array<PostRow>
  steps: Array<PostRow>
}> = [
  {
    name: `matches recomputation when a null correlation key becomes non-null`,
    authors: [{ id: 1, name: `Ada` }],
    posts: [{ id: 1, authorId: null }],
    steps: [{ id: 1, authorId: 1 }],
  },
  {
    name: `matches recomputation for an unmatched non-null correlation key`,
    authors: [],
    posts: [{ id: 1, authorId: 999 }],
    steps: [],
  },
  {
    name: `matches recomputation when an existing correlation key becomes null`,
    authors: [{ id: 1, name: `Ada` }],
    posts: [{ id: 1, authorId: 1 }],
    steps: [{ id: 1, authorId: null }],
  },
  {
    name: `reactivates a singleton after null and repeated route retirement`,
    authors: [{ id: 1, name: `Ada` }],
    posts: [{ id: 1, authorId: null }],
    steps: [
      { id: 1, authorId: 1 },
      { id: 1, authorId: null },
      { id: 1, authorId: 1 },
    ],
  },
]

describe(`includes query-shape recompute oracle`, () => {
  for (const campaign of campaigns(1703, `includes-query-shape.multiplicity`)) {
    registerIncludesProperty(
      [fc.integer({ min: 2, max: 5 })],
      {
        ...campaign.options,
        owns: [
          `src/collection/index.ts#createCollection`,
          `src/indexes/basic-index.ts`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
        ],
      },
      `deleting one joined contributor preserves remaining multiplicity (${campaign.name})`,
      async (childCount) => {
        await runTrace({
          steps: [1],
          driver: createMultiplicityDriver(childCount),
          projection: multiplicityProjection,
        })
      },
    )
  }

  for (const campaign of campaigns(1704, `includes-query-shape.correlation`)) {
    registerIncludesProperty(
      [
        fc.record({
          correlationId: fc.integer({ min: 1, max: 100 }),
          productionId: fc.integer({ min: 101, max: 200 }),
        }),
      ],
      {
        ...campaign.options,
        owns: [
          `src/collection/index.ts#createCollection`,
          `src/indexes/basic-index.ts`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
        ],
      },
      `materialization follows correlation through a joined alias (${campaign.name})`,
      async ({ correlationId, productionId }) => {
        await runTrace({
          steps: [],
          driver: createCorrelationDriver(
            `joined`,
            correlationId,
            productionId,
            correlationId + 200,
          ),
          projection: correlationProjection,
        })
      },
    )
  }

  for (const campaign of campaigns(1706, `includes-query-shape.nullable`)) {
    registerIncludesProperty(
      [fc.integer({ min: 1, max: 100 })],
      {
        ...campaign.options,
        owns: [
          `src/collection/index.ts#createCollection`,
          `src/indexes/basic-index.ts`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
        ],
      },
      `findOne maps a null correlation key to undefined (${campaign.name})`,
      async (postId) => {
        await runTrace({
          steps: [],
          driver: createNullableDriver([], [{ id: postId, authorId: null }]),
          projection: nullableProjection,
        })
      },
    )
  }

  oracleProperty({
    id: `includes-query-shape.multiplicity-fixed`,
    law: {
      statement: multiplicityLaw,
      authority: `The joined multiplicity, alias identity, and null-key normalization contracts in packages/db/src/query/live/ARCHITECTURE.md (contribution conservation and total materialization), stated at the start of this owner.`,
      limits: `Two fixed contributor counts, replayed through the multiplicity driver and recomputation, and the premature-removal calibration.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/basic-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: multiplicityFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(multiplicityLaw, plan, observe, () =>
        runTrace({
          steps: [1],
          driver: createMultiplicityDriver(plan.history.childCount),
          projection: multiplicityProjection,
        }),
      ),
    check: forwardAssertionJudgment,
    calibrations: [
      {
        name: `rejects a premature parent removal after one contributor leaves`,
        law: multiplicityLaw,
        // The former calibration body. Exactly the old matcher: only a
        // TraceAssertionError at checkpoint 1 counts as the check
        // rejecting a premature parent removal. The shared trace check marks its own comparison
        // failures, so any other failure is rethrown without that marking and
        // fails this calibration, as it failed the old test.
        driver: (plan, observe) =>
          recordAssertionJudgment(multiplicityLaw, plan, observe, async () => {
            try {
              await runTrace({
                steps: [1],
                driver: createMultiplicityDriver(plan.history.childCount),
                projection: {
                  ...multiplicityProjection,
                  observe: (context) =>
                    context.children.size === 1
                      ? []
                      : multiplicityProjection.observe(context),
                },
              })
            } catch (error) {
              if (
                error instanceof Error &&
                error.name === `TraceAssertionError` &&
                (error as Error & { checkpoint?: unknown }).checkpoint === 1
              )
                rejectAt(
                  `rejects a premature parent removal after one contributor leaves`,
                  error,
                )
              throw new Error(
                `the corrupted projection failed outside the expected rejection: ${String(error)}`,
              )
            }
          }),
      },
    ],
  })

  oracleProperty({
    id: `includes-query-shape.correlation-fixed`,
    law: {
      statement: correlationLaw,
      authority: `The joined multiplicity, alias identity, and null-key normalization contracts in packages/db/src/query/live/ARCHITECTURE.md (contribution conservation and total materialization), stated at the start of this owner.`,
      limits: `Four fixed source and joined correlation histories, replayed through the correlation driver and recomputation, and the wrong-alias calibration.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/basic-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: correlationFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(correlationLaw, plan, observe, () =>
        runTrace({
          steps: plan.history.steps,
          driver: createCorrelationDriver(
            plan.history.target,
            plan.history.correlationId,
            plan.history.productionId,
            plan.history.orderId,
          ),
          projection: correlationProjection,
        }),
      ),
    check: forwardAssertionJudgment,
    calibrations: [
      {
        name: `rejects the wrong correlation alias at the initial checkpoint`,
        law: correlationLaw,
        // The former calibration body. Exactly the old matcher: only a
        // TraceAssertionError at checkpoint 0 counts as the check
        // rejecting the wrong correlation alias. The shared trace check marks its own comparison
        // failures, so any other failure is rethrown without that marking and
        // fails this calibration, as it failed the old test.
        driver: (plan, observe) =>
          recordAssertionJudgment(correlationLaw, plan, observe, async () => {
            try {
              await runTrace({
                steps: plan.history.steps,
                driver: createCorrelationDriver(
                  plan.history.target,
                  plan.history.correlationId,
                  plan.history.productionId,
                  plan.history.orderId,
                ),
                projection: {
                  ...correlationProjection,
                  recompute: (context) =>
                    correlationProjection.recompute({
                      ...context,
                      target: `joined`,
                    }),
                },
              })
            } catch (error) {
              if (
                error instanceof Error &&
                error.name === `TraceAssertionError` &&
                (error as Error & { checkpoint?: unknown }).checkpoint === 0
              )
                rejectAt(
                  `rejects the wrong correlation alias at the initial checkpoint`,
                  error,
                )
              throw new Error(
                `the corrupted projection failed outside the expected rejection: ${String(error)}`,
              )
            }
          }),
      },
    ],
  })

  oracleProperty({
    id: `includes-query-shape.nullable-fixed`,
    law: {
      statement: nullableLaw,
      authority: `The joined multiplicity, alias identity, and null-key normalization contracts in packages/db/src/query/live/ARCHITECTURE.md (contribution conservation and total materialization), stated at the start of this owner.`,
      limits: `Four fixed null and unmatched correlation-key histories, replayed through the nullable driver and recomputation, and the stale-singleton calibration.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/basic-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: nullableFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(nullableLaw, plan, observe, () =>
        runTrace({
          steps: plan.history.steps,
          driver: createNullableDriver(
            plan.history.authors,
            plan.history.posts,
          ),
          projection: nullableProjection,
        }),
      ),
    check: forwardAssertionJudgment,
    calibrations: [
      {
        name: `rejects a stale empty singleton at its reactivation checkpoint`,
        law: nullableLaw,
        // The former calibration body. Exactly the old matcher: only a
        // TraceAssertionError at checkpoint 1 counts as the check
        // rejecting a stale empty singleton. The shared trace check marks its own comparison
        // failures, so any other failure is rethrown without that marking and
        // fails this calibration, as it failed the old test.
        driver: (plan, observe) =>
          recordAssertionJudgment(nullableLaw, plan, observe, async () => {
            try {
              await runTrace({
                steps: plan.history.steps,
                driver: createNullableDriver(
                  plan.history.authors,
                  plan.history.posts,
                ),
                projection: {
                  ...nullableProjection,
                  observe: ({ live }) =>
                    live.toArray.map((row) => ({
                      id: row.id,
                      author: undefined,
                    })),
                },
              })
            } catch (error) {
              if (
                error instanceof Error &&
                error.name === `TraceAssertionError` &&
                (error as Error & { checkpoint?: unknown }).checkpoint === 1
              )
                rejectAt(
                  `rejects a stale empty singleton at its reactivation checkpoint`,
                  error,
                )
              throw new Error(
                `the corrupted projection failed outside the expected rejection: ${String(error)}`,
              )
            }
          }),
      },
    ],
  })
})
