import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { cloneQueryForPlacement } from '../../src/query/builder/clone-query.js'
import {
  CollectionRef,
  Func,
  PropRef,
  QueryRef,
  UnionAll,
  UnionFrom,
  Value,
  collectCollectionSources,
} from '../../src/query/ir.js'
import { optimizeQuery } from '../../src/query/optimizer.js'
import {
  and,
  createLiveQueryCollection,
  eq,
  materialize,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type { QueryIR } from '../../src/query/ir.js'

/**
 * # Which distinctions determine the shape of an included result?
 *
 * Incremental query state can look correct while losing a semantic distinction
 * that a later change exposes. This suite isolates three such distinctions:
 *
 * 1. Join multiplicity keeps a parent visible until its last contributor leaves.
 * 2. A correlation through the joined alias differs from one through the source.
 * 3. A null or unmatched singleton is absent, but a later valid key reactivates it.
 * 4. Sibling scopes may reuse an alias; optimizer copies must keep the lexical
 *    source identity so a joined parent and its include read their own inputs.
 *
 * These laws form separate model nodes. Each node uses plain Maps and full
 * recomputation. The shared trace runner applies an action to production and to
 * the matching node, then compares the complete public result. Combining the
 * nodes into one reference query engine would add machinery without making any
 * law stronger.
 *
 * Stable campaigns preserve the histories that exposed these distinctions.
 * Fresh random campaigns vary their value domains. Pinned examples cover route
 * movement and repeated retirement because those laws need ordered histories,
 * not more random scalar values.
 *
 * Authority: the contribution-conservation, route-relation, and
 * total-materialization laws in ARCHITECTURE.md. The model predicts complete
 * public rows, not callback timing, demand, or facade identity. The grammar
 * is bounded: one parent with 1–5 child contributors; one joined
 * production/order with equal or distinct correlation keys; and one post
 * with null, unmatched, or existing author keys. Missing child IDs and
 * updates to absent orders are invalid driver actions. The source-identity
 * grammar crosses sibling alias equality, separate/combined/nullable-only
 * predicates, and updates to joined and included source rows. It keeps at
 * most one matching joined row per parent; joined multiplicity has its own
 * model above. Each real live-query
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
  expect(observed).toEqual(expected)
  return undefined
}

type Cleanable = { cleanup: () => Promise<void> }

async function cleanupQuery(
  live: Cleanable,
  sources: Array<{ collection: Cleanable }>,
): Promise<void> {
  const failures: Array<unknown> = []
  try {
    await live.cleanup()
  } catch (error) {
    failures.push(error)
  }
  const results = await Promise.allSettled(
    sources.map(({ collection }) => collection.cleanup()),
  )
  for (const result of results) {
    if (result.status === `rejected`) failures.push(result.reason)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, `Query cleanup failed`)
  }
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
  // A join projects one parent row for any positive contributor count.
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

const correlationProjection: TraceProjection<
  CorrelationContext,
  unknown,
  CorrelationResult
> = {
  // Correlation chooses a route. Join identity only decides which rows meet.
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
  // SQL equality never matches null. A later non-null key starts a fresh route.
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

type AliasShape = `reused` | `distinct`
type PredicateShape = `separate` | `combined` | `nullable-only`
type IdentityProject = { id: number; name: string }
type IdentityIssue = {
  id: number
  projectId: number
  title: string
}
type IdentityStep =
  | { kind: `join-title`; title: `Bug in Alpha` | `Other` }
  | { kind: `join-project`; projectId: 1 | 2 }
  | { kind: `included-title`; title: `Feature for Alpha` | `Changed` }

function createIdentitySources() {
  const projects = [
    { id: 1, name: `Alpha` },
    { id: 2, name: `Beta` },
  ]
  const issues = [
    { id: 10, projectId: 1, title: `Bug in Alpha` },
    { id: 11, projectId: 1, title: `Feature for Alpha` },
    { id: 20, projectId: 2, title: `Bug in Beta` },
  ]
  const sources = {
    projects: createControlledCollection<IdentityProject>(
      `identity-projects`,
      projects,
    ),
    issues: createControlledCollection<IdentityIssue>(
      `identity-issues`,
      issues,
    ),
  }
  sources.issues.collection.createIndex((issue) => issue.projectId, {
    indexType: BasicIndex,
  })
  return { sources, projects, issues }
}

function createIdentityQuery(
  sources: ReturnType<typeof createIdentitySources>[`sources`],
  aliasShape: AliasShape,
  predicateShape: PredicateShape,
) {
  return createLiveQueryCollection((q) => {
    const joined = q
      .from({ p: sources.projects.collection })
      .leftJoin({ i: sources.issues.collection }, ({ p, i }) =>
        eq(i.projectId, p.id),
      )
    const parent =
      predicateShape === `combined`
        ? joined.where(({ p, i }) =>
            and(eq(i.title, `Bug in Alpha`), eq(p.name, `Alpha`)),
          )
        : predicateShape === `separate`
          ? joined
              .where(({ i }) => eq(i.title, `Bug in Alpha`))
              .where(({ p }) => eq(p.name, `Alpha`))
          : joined.where(({ i }) => eq(i.title, `Bug in Alpha`))
    const parentQuery = parent.select(({ p }) => p)

    return q.from({ p: parentQuery }).select(({ p }) => ({
      id: p.id,
      name: p.name,
      issues:
        aliasShape === `reused`
          ? materialize(
              q
                .from({ i: sources.issues.collection })
                .where(({ i }) => eq(i.projectId, p.id))
                .select(({ i }) => ({ id: i.id, title: i.title })),
            )
          : materialize(
              q
                .from({ includedIssue: sources.issues.collection })
                .where(({ includedIssue }) => eq(includedIssue.projectId, p.id))
                .select(({ includedIssue }) => ({
                  id: includedIssue.id,
                  title: includedIssue.title,
                })),
            ),
    }))
  })
}

type IdentityContext = {
  aliasShape: AliasShape
  predicateShape: PredicateShape
  sources: ReturnType<typeof createIdentitySources>[`sources`]
  live: ReturnType<typeof createIdentityQuery>
  projects: Map<number, IdentityProject>
  issues: Map<number, IdentityIssue>
}

function createIdentityDriver(
  aliasShape: AliasShape,
  predicateShape: PredicateShape,
): TraceDriver<IdentityStep, IdentityContext> {
  return {
    setup: () => {
      const { sources, projects, issues } = createIdentitySources()
      return {
        aliasShape,
        predicateShape,
        sources,
        live: createIdentityQuery(sources, aliasShape, predicateShape),
        projects: rowsById(projects),
        issues: rowsById(issues),
      }
    },
    start: ({ live }) => live.preload(),
    apply: (step, { issues, sources }) => {
      const id = step.kind === `included-title` ? 11 : 10
      const previous = issues.get(id)
      if (!previous) throw new Error(`Missing issue ${id}`)
      const next =
        step.kind === `join-project`
          ? { ...previous, projectId: step.projectId }
          : { ...previous, title: step.title }
      sources.issues.write(`update`, next)
      issues.set(id, next)
    },
    cleanup: ({ live, sources }) => cleanupQuery(live, Object.values(sources)),
  }
}

type IdentityResult = Array<{
  id: number
  name: string
  issues: Array<{ id: number; title: string }>
}>

const identityProjection: TraceProjection<
  IdentityContext,
  IdentityResult,
  IdentityResult
> = {
  observe: ({ live }) =>
    live.toArray
      .map((project) => ({
        id: project.id,
        name: project.name,
        issues: project.issues
          .map((issue) => ({ id: issue.id, title: issue.title }))
          .sort((left, right) => left.id - right.id),
      }))
      .sort((left, right) => left.id - right.id),
  // Full recomputation uses source rows and ordinary equality, never the
  // optimizer's IDs, alias fallback, D2 inputs, or compiled include routes.
  recompute: ({ projects, issues, predicateShape }) =>
    [...projects.values()]
      .filter(
        (project) =>
          (predicateShape === `nullable-only` || project.name === `Alpha`) &&
          [...issues.values()].some(
            (issue) =>
              issue.projectId === project.id && issue.title === `Bug in Alpha`,
          ),
      )
      .map((project) => ({
        id: project.id,
        name: project.name,
        issues: [...issues.values()]
          .filter((issue) => issue.projectId === project.id)
          .map((issue) => ({ id: issue.id, title: issue.title }))
          .sort((left, right) => left.id - right.id),
      }))
      .sort((left, right) => left.id - right.id),
  assertEqual: assertRowsEqual,
}

const identitySteps = fc.oneof(
  fc.record({
    kind: fc.constant<`join-title`>(`join-title`),
    title: fc.constantFrom<`Bug in Alpha` | `Other`>(`Bug in Alpha`, `Other`),
  }),
  fc.record({
    kind: fc.constant<`join-project`>(`join-project`),
    projectId: fc.constantFrom<1 | 2>(1, 2),
  }),
  fc.record({
    kind: fc.constant<`included-title`>(`included-title`),
    title: fc.constantFrom<`Feature for Alpha` | `Changed`>(
      `Feature for Alpha`,
      `Changed`,
    ),
  }),
)

type OptimizerSourceShape =
  | `bare-from`
  | `pushed-from`
  | `bare-join`
  | `unchanged-join`
  | `pushed-join`
  | `nested-push`
  | `redundant-from`
  | `renamed-from`
  | `nested-renamed-from`
  | `union-from`
  | `union-all`

const optimizerSourceShapes: ReadonlyArray<OptimizerSourceShape> = [
  `bare-from`,
  `pushed-from`,
  `bare-join`,
  `unchanged-join`,
  `pushed-join`,
  `nested-push`,
  `redundant-from`,
  `renamed-from`,
  `nested-renamed-from`,
  `union-from`,
  `union-all`,
]

function createOptimizerSourceQuery(shape: OptimizerSourceShape): QueryIR {
  const collection = { id: `identity-source` } as never
  const root = new CollectionRef(collection, `root`)
  const joined = new CollectionRef(collection, `joined`)
  const rootPredicate = new Func(`eq`, [
    new PropRef([`root`, `id`]),
    new Value(1),
  ])
  const joinedPredicate = new Func(`eq`, [
    new PropRef([`joined`, `id`]),
    new Value(2),
  ])
  const secondRootPredicate = new Func(`gt`, [
    new PropRef([`root`, `id`]),
    new Value(0),
  ])
  const join = {
    type: `inner` as const,
    from: joined,
    left: new PropRef([`root`, `id`]),
    right: new PropRef([`joined`, `id`]),
  }

  switch (shape) {
    case `bare-from`:
      return { from: root }
    case `pushed-from`:
      return { from: root, where: [rootPredicate, secondRootPredicate] }
    case `bare-join`:
      return { from: root, join: [join] }
    case `unchanged-join`:
      return { from: root, join: [join], where: [rootPredicate] }
    case `pushed-join`:
      return {
        from: root,
        join: [join],
        where: [rootPredicate, joinedPredicate],
      }
    case `nested-push`:
      return {
        from: new QueryRef(
          { from: root, select: { id: new PropRef([`root`, `id`]) } },
          `outer`,
        ),
        join: [join],
        where: [new Func(`eq`, [new PropRef([`outer`, `id`]), new Value(1)])],
      }
    case `redundant-from`:
      return { from: new QueryRef({ from: root }, `root`) }
    case `renamed-from`:
      return { from: new QueryRef({ from: root }, `outer`) }
    case `nested-renamed-from`:
      return {
        from: new QueryRef(
          { from: new QueryRef({ from: root }, `middle`) },
          `middle`,
        ),
      }
    case `union-from`:
      return { from: new UnionFrom([root, joined]) }
    case `union-all`:
      return {
        from: new UnionAll([{ from: root }, { from: joined }]),
      }
  }
}

function lexicalSourceIds(query: QueryIR): Array<string> {
  return collectCollectionSources(query)
    .map((source) => source.sourceId)
    .sort()
}

function campaigns(fixedSeed: number, property: string) {
  // Grammar controls: the pinned 1-child case reconstructs final retirement,
  // while counts 2–5 keep a surviving contributor. Equal route keys are the
  // control; distinct order and part IDs expose the wrong-alias result.
  // Removing null or route updates loses empty-value or reactivation behavior.
  // IDs vary only within positive integer equality domains; no numeric
  // threshold is claimed. Drivers reject absent-child and absent-order actions.
  return [
    {
      name: `fixed`,
      options: { numRuns: oracleRuns(12), seed: fixedSeed },
    },
    {
      name: `random or replayed`,
      options: oraclePropertyOptions(12, property),
    },
  ]
}

describe(`includes query-shape recompute oracle`, () => {
  fcTest(`releases every source and retains cleanup errors`, async () => {
    const liveError = new Error(`live cleanup`)
    const sourceError = new Error(`source cleanup`)
    const released: Array<string> = []
    await expect(
      cleanupQuery(
        {
          cleanup: async () => {
            released.push(`live`)
            throw liveError
          },
        },
        [
          {
            collection: {
              cleanup: async () => {
                released.push(`first source`)
                throw sourceError
              },
            },
          },
          {
            collection: {
              cleanup: async () => {
                released.push(`second source`)
              },
            },
          },
        ],
      ),
    ).rejects.toMatchObject({ errors: [liveError, sourceError] })
    expect(released).toEqual([`live`, `first source`, `second source`])
  })

  for (const campaign of campaigns(1703, `includes-query-shape.multiplicity`)) {
    fcTest.prop([fc.integer({ min: 2, max: 5 })], campaign.options)(
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

  fcTest(
    `matches recomputation when the final joined contributor is deleted`,
    () =>
      runTrace({
        steps: [1],
        driver: createMultiplicityDriver(1),
        projection: multiplicityProjection,
      }),
  )

  fcTest(
    `rejects a premature parent removal after one contributor leaves`,
    async () => {
      await expect(
        runTrace({
          steps: [1],
          driver: createMultiplicityDriver(2),
          projection: {
            ...multiplicityProjection,
            observe: (context) =>
              context.children.size === 1
                ? []
                : multiplicityProjection.observe(context),
          },
        }),
      ).rejects.toMatchObject({ name: `TraceAssertionError`, checkpoint: 1 })
    },
  )

  for (const campaign of campaigns(1704, `includes-query-shape.correlation`)) {
    fcTest.prop(
      [
        fc.record({
          correlationId: fc.integer({ min: 1, max: 100 }),
          productionId: fc.integer({ min: 101, max: 200 }),
        }),
      ],
      campaign.options,
    )(
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

  fcTest(
    `matches recomputation when materialization correlates through its source alias`,
    () =>
      runTrace({
        steps: [],
        driver: createCorrelationDriver(`source`, 1, 101),
        projection: correlationProjection,
      }),
  )

  fcTest.each([`source`, `joined`] as const)(
    `keeps %s correlation distinct from join identity through route moves`,
    (target) =>
      runTrace({
        // Part 1 is the joined correlation. Part 7 is the source correlation.
        // Moving order.partId changes only the joined query, then restores it.
        steps: [
          { id: 7, partId: 7 },
          { id: 7, partId: 1 },
        ],
        driver: createCorrelationDriver(target, 1, 101, 7),
        projection: correlationProjection,
      }),
  )

  fcTest(
    `rejects the wrong correlation alias at the initial checkpoint`,
    async () => {
      await expect(
        runTrace({
          steps: [],
          driver: createCorrelationDriver(`source`, 1, 101, 7),
          projection: {
            ...correlationProjection,
            recompute: (context) =>
              correlationProjection.recompute({ ...context, target: `joined` }),
          },
        }),
      ).rejects.toMatchObject({ name: `TraceAssertionError`, checkpoint: 0 })
    },
  )

  for (const campaign of campaigns(1706, `includes-query-shape.nullable`)) {
    fcTest.prop([fc.integer({ min: 1, max: 100 })], campaign.options)(
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

  fcTest(
    `reactivates a singleton after null and repeated route retirement`,
    () =>
      runTrace({
        steps: [
          { id: 1, authorId: 1 },
          { id: 1, authorId: null },
          { id: 1, authorId: 1 },
        ],
        driver: createNullableDriver(
          [{ id: 1, name: `Ada` }],
          [{ id: 1, authorId: null }],
        ),
        projection: nullableProjection,
      }),
  )

  fcTest(
    `rejects a stale empty singleton at its reactivation checkpoint`,
    async () => {
      await expect(
        runTrace({
          steps: [{ id: 1, authorId: 1 }],
          driver: createNullableDriver(
            [{ id: 1, name: `Ada` }],
            [{ id: 1, authorId: null }],
          ),
          projection: {
            ...nullableProjection,
            observe: ({ live }) =>
              live.toArray.map((row) => ({ id: row.id, author: undefined })),
          },
        }),
      ).rejects.toMatchObject({ name: `TraceAssertionError`, checkpoint: 1 })
    },
  )

  fcTest.each([
    [`reused`, `separate`],
    [`distinct`, `separate`],
    [`reused`, `combined`],
    [`distinct`, `combined`],
    [`reused`, `nullable-only`],
    [`distinct`, `nullable-only`],
  ] as const)(
    `preserves %s sibling alias with %s predicates through source updates`,
    (aliasShape, predicateShape) =>
      runTrace({
        steps: [
          { kind: `join-title`, title: `Other` },
          { kind: `join-title`, title: `Bug in Alpha` },
          { kind: `included-title`, title: `Changed` },
          { kind: `join-project`, projectId: 2 },
          { kind: `join-project`, projectId: 1 },
        ],
        driver: createIdentityDriver(aliasShape, predicateShape),
        projection: identityProjection,
      }),
  )

  for (const campaign of campaigns(1707, `includes-query-shape.identity`)) {
    fcTest.prop(
      [
        fc.constantFrom<AliasShape>(`reused`, `distinct`),
        fc.constantFrom<PredicateShape>(
          `separate`,
          `combined`,
          `nullable-only`,
        ),
        fc.array(identitySteps, { minLength: 1, maxLength: 5 }),
      ],
      campaign.options,
    )(
      `matches recomputation across sibling aliases and predicate forms (${campaign.name})`,
      (aliasShape, predicateShape, steps) =>
        runTrace({
          steps,
          driver: createIdentityDriver(aliasShape, predicateShape),
          projection: identityProjection,
        }),
    )
  }

  fcTest(
    `rejects an omitted parent at the initial identity checkpoint`,
    async () => {
      await expect(
        runTrace({
          steps: [],
          driver: createIdentityDriver(`reused`, `separate`),
          projection: { ...identityProjection, observe: () => [] },
        }),
      ).rejects.toMatchObject({ name: `TraceAssertionError`, checkpoint: 0 })
    },
  )

  fcTest.each(optimizerSourceShapes)(
    `keeps lexical source identity through %s optimization and placement`,
    (shape) => {
      const original = createOptimizerSourceQuery(shape)
      const originalFrom = original.from
      const originalJoin = original.join
      const originalWhere = original.where
      const originalSources = collectCollectionSources(original).map(
        (source) => ({
          source,
          sourceId: source.sourceId,
          alias: source.alias,
          collection: source.collection,
        }),
      )
      const firstPlacement = cloneQueryForPlacement(original)
      const secondPlacement = cloneQueryForPlacement(original)
      const originalIds = lexicalSourceIds(original)
      const firstIds = lexicalSourceIds(firstPlacement)
      const secondIds = lexicalSourceIds(secondPlacement)
      const optimizedOriginal = optimizeQuery(original).optimizedQuery

      // A placement is a new lexical position. Optimization of that placement
      // must not create a third source identity for the same position.
      expect(new Set([...originalIds, ...firstIds, ...secondIds]).size).toBe(
        originalIds.length + firstIds.length + secondIds.length,
      )
      expect(lexicalSourceIds(optimizedOriginal)).toEqual(originalIds)
      expect(original.from).toBe(originalFrom)
      expect(original.join).toBe(originalJoin)
      expect(original.where).toBe(originalWhere)
      for (const { source, sourceId, alias, collection } of originalSources) {
        expect(source.sourceId).toBe(sourceId)
        expect(source.alias).toBe(alias)
        expect(source.collection).toBe(collection)
      }
      if (shape === `renamed-from` || shape === `nested-renamed-from`) {
        if (optimizedOriginal.from.type !== `queryRef`) {
          throw new Error(`Alias-remapped wrapper was removed`)
        }
        expect(optimizedOriginal.from.alias).toBe(
          shape === `renamed-from` ? `outer` : `middle`,
        )
      }
      expect(
        lexicalSourceIds(optimizeQuery(firstPlacement).optimizedQuery),
      ).toEqual(firstIds)
      expect(
        lexicalSourceIds(optimizeQuery(secondPlacement).optimizedQuery),
      ).toEqual(secondIds)
    },
  )
})
