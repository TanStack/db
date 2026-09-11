import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { oracleRuns } from '../oracle-config.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'

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
  expect(observed).toEqual(expected)
  return undefined
}

type Cleanable = { cleanup: () => Promise<void> }

async function cleanupQuery(
  live: Cleanable,
  sources: Array<{ collection: Cleanable }>,
): Promise<void> {
  await live.cleanup()
  await Promise.all(sources.map(({ collection }) => collection.cleanup()))
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

const multiplicityProjection: TraceProjection<
  MultiplicityContext,
  unknown,
  Array<ParentRow>
> = {
  observe: ({ live }) => stripVirtualProperties(live.toArray),
  recompute: ({ children, parents }) =>
    [...parents.values()]
      .filter((parent) =>
        [...children.values()].some((child) => child.parentId === parent.id),
      )
      .sort((left, right) => left.id - right.id),
  assertEqual: assertRowsEqual,
}

type PartRow = { id: number }
type OrderRow = { id: number; partId: number }
type ProductionRow = { id: number; orderId: number }
type CorrelationTarget = `source` | `joined`

function createCorrelationSources(correlationId: number, productionId: number) {
  const sources = {
    parts: createControlledCollection<PartRow>(`correlation-parts`, [
      { id: correlationId },
    ]),
    orders: createControlledCollection<OrderRow>(`correlation-orders`, [
      { id: correlationId, partId: correlationId },
    ]),
    productions: createControlledCollection<ProductionRow>(
      `correlation-productions`,
      [{ id: productionId, orderId: correlationId }],
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
): TraceDriver<never, CorrelationContext> {
  return {
    setup: () => {
      const part = { id: correlationId }
      const order = { id: correlationId, partId: correlationId }
      const production = { id: productionId, orderId: correlationId }
      const sources = createCorrelationSources(correlationId, productionId)
      return {
        target,
        sources,
        live: createCorrelationQuery(sources, target),
        parts: rowsById([part]),
        orders: rowsById([order]),
        productions: rowsById([production]),
      }
    },
    start: ({ live }) => live.preload(),
    apply: () => undefined,
    cleanup: ({ live, sources }) => cleanupQuery(live, Object.values(sources)),
  }
}

type CorrelationResult = Array<{
  id: number
  productions: Array<ProductionRow>
}>

const correlationProjection: TraceProjection<
  CorrelationContext,
  unknown,
  CorrelationResult
> = {
  observe: ({ live }) => stripVirtualProperties(live.toArray),
  recompute: ({ orders, parts, productions, target }) =>
    [...parts.values()]
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
      })),
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

const nullableProjection: TraceProjection<
  NullableContext,
  unknown,
  NullableResult
> = {
  observe: ({ live }) => stripVirtualProperties(live.toArray),
  recompute: ({ authors, posts }) =>
    [...posts.values()]
      .sort((left, right) => left.id - right.id)
      .map((post) => ({
        id: post.id,
        author: post.authorId === null ? undefined : authors.get(post.authorId),
      })),
  assertEqual: assertRowsEqual,
}

describe(`includes query-shape recompute oracle`, () => {
  fcTest.prop([fc.integer({ min: 2, max: 5 })], {
    numRuns: oracleRuns(12),
    seed: 1703,
  })(
    `deleting one joined contributor preserves remaining multiplicity (#1703)`,
    async (childCount) => {
      await runTrace({
        steps: [1],
        driver: createMultiplicityDriver(childCount),
        projection: multiplicityProjection,
      })
    },
  )

  fcTest(
    `matches recomputation when the final joined contributor is deleted`,
    () =>
      runTrace({
        steps: [1],
        driver: createMultiplicityDriver(1),
        projection: multiplicityProjection,
      }),
  )

  fcTest.prop(
    [
      fc.record({
        correlationId: fc.integer({ min: 1, max: 100 }),
        productionId: fc.integer({ min: 101, max: 200 }),
      }),
    ],
    { numRuns: oracleRuns(12), seed: 1704 },
  )(
    `materialization follows correlation through a joined alias (#1704)`,
    async ({ correlationId, productionId }) => {
      await runTrace({
        steps: [],
        driver: createCorrelationDriver(`joined`, correlationId, productionId),
        projection: correlationProjection,
      })
    },
  )

  fcTest(
    `matches recomputation when materialization correlates through its source alias`,
    () =>
      runTrace({
        steps: [],
        driver: createCorrelationDriver(`source`, 1, 101),
        projection: correlationProjection,
      }),
  )

  fcTest.prop([fc.integer({ min: 1, max: 100 })], {
    numRuns: oracleRuns(12),
    seed: 1706,
  })(
    `findOne maps a null correlation key to undefined (#1706)`,
    async (postId) => {
      await runTrace({
        steps: [],
        driver: createNullableDriver([], [{ id: postId, authorId: null }]),
        projection: nullableProjection,
      })
    },
  )

  fcTest(
    `matches recomputation for an unmatched non-null correlation key`,
    () =>
      runTrace({
        steps: [],
        driver: createNullableDriver([], [{ id: 1, authorId: 999 }]),
        projection: nullableProjection,
      }),
  )

  fcTest(
    `matches recomputation when an existing correlation key becomes null`,
    () =>
      runTrace({
        steps: [{ id: 1, authorId: null }],
        driver: createNullableDriver(
          [{ id: 1, name: `Ada` }],
          [{ id: 1, authorId: 1 }],
        ),
        projection: nullableProjection,
      }),
  )
})
