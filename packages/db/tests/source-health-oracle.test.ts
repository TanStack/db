/**
 * # Source failure and health
 *
 * A Collection answers two questions on two separate axes:
 *
 * - **The gate (`status`)** says whether the data can be shown yet. It is
 *   decided only by the initial sync of a sync attempt. While a source retries
 *   it stays `loading`. When the source gives up before its first ready
 *   (`markError`), the attempt fails for good: the status is `error`, and a
 *   later `markReady()` in the same attempt is a contract violation that
 *   throws. Only a restart (`cleanup()`, then a new preload or subscriber)
 *   begins a new attempt.
 * - **Health** says whether the data is still kept up to date. It is metadata
 *   after the first ready: `reportError(error, { final })` records a problem,
 *   `reportHealthy()` clears a non-final one, and `markError()` after ready is
 *   a final problem. The status and the rows do not change. Only the source
 *   clears its problem, and nothing clears a final problem except a restart.
 *
 * A live query exposes both axes for everything it depends on through
 * `collection.errors`: one node for itself and one per source alias in query
 * order, recursing through nested live queries. The tree always has the same
 * shape for a given query. Each node mirrors its Collection at the moment it
 * is read, and the live query emits `health:change` when a node below it
 * changes, so a reader knows to read the tree again.
 *
 * A live query's own gate follows its sources: it becomes ready when every
 * source is ready, and a source that fails before the query's first ready
 * fails the query's attempt, whatever the query's shape. After the query's
 * first ready, its sources can only report health, and the query keeps its
 * status and rows.
 *
 * ## The model
 *
 * The model keeps, for each source, its gate and its health problem (none,
 * non-final, or final). It derives each live query's gate from its sources,
 * using only the rules above, and builds the expected tree from those facts.
 * It does not read production state.
 *
 * ## The history grammar
 *
 * Steps act on source `A` or `B`: `ready` writes the source's row and calls
 * `markReady()`; `fail` calls `markError()`; `report` and `reportFinal` call
 * `reportError()`; `healthy` calls `reportHealthy()`. `restart` cleans up the
 * live query and every source, then preloads the live query again. Every step
 * is issued in every state. The model predicts its outcome, including a throw
 * for `markReady()` after `markError()`, and for a health report before the
 * first ready. Five shapes cross the grammar: a direct source, a join, a
 * self-join of one Collection under two aliases, a nested live query, and an
 * include child.
 *
 * ## The comparison
 *
 * After every step the driver compares, with the model: the live query's
 * status, its row count while ready, the full projected error tree, and the
 * thrown error class. When the expected tree changed, it also checks that the
 * live query emitted `health:change`. A request lane checks that a lazy load
 * that fails after the first ready is a request error on the live query's
 * node, which clears when that demand settles or is released.
 *
 * ## Limits
 *
 * Sources are eager, so a live query cannot become ready while a source is
 * still loading. The on-demand case, where a source can fail its initial sync
 * after the live query is ready, is not generated here. The include node is
 * one node for the include's source Collection; per-row child Collections are
 * not nodes. Pooled live queries and Effects are outside this owner.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { createEffect } from '../src/query/effect.js'
import { eq } from '../src/query/builder/functions.js'
import { toArray } from '../src/query/index.js'
import { InvalidCollectionStatusTransitionError } from '../src/errors.js'
import { oraclePropertyOptions } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { Collection } from '../src/collection/index.js'
import type {
  CollectionStatus,
  ErrorTreeNode,
  LoadSubsetOptions,
  SyncConfig,
} from '../src/types.js'

type Row = { id: number; parentId: number }
type SyncParams = Parameters<SyncConfig<Row, number>[`sync`]>[0]
type SourceName = `A` | `B`
type Shape = `direct` | `join` | `self-join` | `nested` | `include`
type Step =
  | {
      kind: `ready` | `fail` | `report` | `reportFinal` | `healthy`
      source: SourceName
    }
  | { kind: `restart` }

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

type Gate = `loading` | `ready` | `error`
type Problem = null | { final: boolean }
type SourceModel = { gate: Gate; problem: Problem }
type Model = {
  sources: Record<SourceName, SourceModel>
  query: Gate
  inner: Gate
}

const shapeSources: Record<Shape, ReadonlyArray<SourceName>> = {
  direct: [`A`],
  join: [`A`, `B`],
  'self-join': [`A`],
  nested: [`A`, `B`],
  include: [`A`, `B`],
}

function freshModel(): Model {
  const source = (): SourceModel => ({ gate: `loading`, problem: null })
  return {
    sources: { A: source(), B: source() },
    query: `loading`,
    inner: `loading`,
  }
}

// A live query's gate follows its sources and never leaves error or ready
// within an attempt.
function deriveGate(current: Gate, inputs: ReadonlyArray<Gate>): Gate {
  if (current !== `loading`) return current
  if (inputs.some((gate) => gate === `error`)) return `error`
  if (inputs.every((gate) => gate === `ready`)) return `ready`
  return `loading`
}

function deriveQueries(shape: Shape, model: Model): void {
  const gates = (names: ReadonlyArray<SourceName>) =>
    names.map((name) => model.sources[name].gate)
  if (shape === `nested`) {
    model.inner = deriveGate(model.inner, gates([`A`]))
    model.query = deriveGate(model.query, [model.inner, model.sources.B.gate])
  } else {
    model.query = deriveGate(model.query, gates(shapeSources[shape]))
  }
}

/** Apply a step. Returns `throws` when the contract forbids it. */
function applyModel(shape: Shape, model: Model, step: Step): `ok` | `throws` {
  if (step.kind === `restart`) {
    Object.assign(model, freshModel())
    return `ok`
  }
  // A step on a source this shape does not read has no effect.
  if (!shapeSources[shape].includes(step.source)) return `ok`
  const source = model.sources[step.source]
  let outcome: `ok` | `throws` = `ok`
  switch (step.kind) {
    case `ready`:
      if (source.gate === `error`) outcome = `throws`
      else source.gate = `ready`
      break
    case `fail`:
      // Before the first ready the attempt fails; after it, a final problem.
      if (source.gate === `ready`) source.problem = { final: true }
      else source.gate = `error`
      break
    case `report`:
    case `reportFinal`:
      if (source.gate !== `ready`) outcome = `throws`
      else if (!source.problem?.final)
        source.problem = { final: step.kind === `reportFinal` }
      break
    case `healthy`:
      if (source.gate !== `ready`) outcome = `throws`
      else if (source.problem && !source.problem.final) source.problem = null
      break
  }
  deriveQueries(shape, model)
  return outcome
}

type ExpectedNode = {
  alias: string
  kind: `source` | `live-query`
  status: Gate
  isError: boolean
  hasErrors: boolean
  error: null | { phase: `initial` | `sync`; final: boolean }
  sources: Array<ExpectedNode>
}

function sourceNode(alias: string, source: SourceModel): ExpectedNode {
  const error =
    source.gate === `error`
      ? { phase: `initial` as const, final: true }
      : source.problem
        ? { phase: `sync` as const, final: source.problem.final }
        : null
  return {
    alias,
    kind: `source`,
    status: source.gate,
    isError: error !== null,
    hasErrors: error !== null,
    error,
    sources: [],
  }
}

function queryNode(
  alias: string,
  gate: Gate,
  sources: Array<ExpectedNode>,
): ExpectedNode {
  const error =
    gate === `error` ? { phase: `initial` as const, final: true } : null
  return {
    alias,
    kind: `live-query`,
    status: gate,
    isError: error !== null,
    hasErrors: error !== null || sources.some((node) => node.hasErrors),
    error,
    sources,
  }
}

function expectedTree(shape: Shape, model: Model): ExpectedNode {
  const { A, B } = model.sources
  switch (shape) {
    case `direct`:
      return queryNode(`root`, model.query, [sourceNode(`a`, A)])
    case `join`:
      return queryNode(`root`, model.query, [
        sourceNode(`a`, A),
        sourceNode(`b`, B),
      ])
    case `self-join`:
      return queryNode(`root`, model.query, [
        sourceNode(`first`, A),
        sourceNode(`second`, A),
      ])
    case `nested`:
      return queryNode(`root`, model.query, [
        queryNode(`inner`, model.inner, [sourceNode(`a`, A)]),
        sourceNode(`b`, B),
      ])
    case `include`:
      return queryNode(`root`, model.query, [
        sourceNode(`b`, B),
        sourceNode(`a`, A),
      ])
  }
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

function createSource(name: SourceName) {
  let params: SyncParams | undefined
  const collection = createCollection<Row, number>({
    id: `health-oracle-${name}-${Math.random().toString(36).slice(2)}`,
    getKey: (row) => row.id,
    startSync: false,
    gcTime: 0,
    sync: {
      sync: (next) => {
        params = next
      },
    },
  })
  return {
    collection,
    get params(): SyncParams {
      if (!params) throw new Error(`source ${name} has not started`)
      return params
    },
  }
}

function buildQuery(
  shape: Shape,
  A: Collection<Row, number>,
  B: Collection<Row, number>,
) {
  switch (shape) {
    case `direct`:
      return { query: createLiveQueryCollection((q) => q.from({ a: A })) }
    case `join`:
      return {
        query: createLiveQueryCollection((q) =>
          q.from({ a: A }).join({ b: B }, ({ a, b }) => eq(a.id, b.id)),
        ),
      }
    case `self-join`:
      return {
        query: createLiveQueryCollection((q) =>
          q
            .from({ first: A })
            .join({ second: A }, ({ first, second }) =>
              eq(first.id, second.id),
            ),
        ),
      }
    case `nested`: {
      const inner = createLiveQueryCollection((q) => q.from({ a: A }))
      return {
        inner,
        query: createLiveQueryCollection((q) =>
          q
            .from({ inner })
            .join({ b: B }, ({ inner: row, b }) => eq(row.id, b.id)),
        ),
      }
    }
    case `include`:
      return {
        query: createLiveQueryCollection((q) =>
          q.from({ b: B }).select(({ b }) => ({
            id: b.id,
            items: toArray(
              q.from({ a: A }).where(({ a }) => eq(a.parentId, b.id)),
            ),
          })),
        ),
      }
  }
}

// The public tree, projected onto the fields the model owns.
function project(node: ErrorTreeNode): ExpectedNode {
  return {
    alias: node.alias,
    kind: node.kind,
    status: node.status as Gate,
    isError: node.isError,
    hasErrors: node.hasErrors,
    error: node.error
      ? {
          phase: node.error.phase as `initial` | `sync`,
          final: node.error.final,
        }
      : null,
    sources: node.sources.map(project),
  }
}

async function runHistory(
  shape: Shape,
  steps: ReadonlyArray<Step>,
): Promise<void> {
  const sources = { A: createSource(`A`), B: createSource(`B`) }
  const { query, inner } = buildQuery(
    shape,
    sources.A.collection,
    sources.B.collection,
  )
  const model = freshModel()
  let events = 0
  let stop = () => {}
  // Cleanup without subscribers drops event listeners, so each attempt
  // registers its own.
  const start = () => {
    stop()
    stop = query.on(`health:change`, () => {
      events++
    })
    void query.preload().catch(() => undefined)
  }
  const consoleError = console.error
  console.error = () => {}
  try {
    start()
    await flushPromises()
    for (const [index, step] of steps.entries()) {
      const label = `step ${index} ${JSON.stringify(step)} on ${shape}`
      const before = JSON.stringify(expectedTree(shape, model))
      const expected = applyModel(shape, model, step)
      events = 0
      let thrown: unknown
      try {
        if (step.kind === `restart`) {
          await query.cleanup()
          await inner?.cleanup()
          await Promise.all([
            sources.A.collection.cleanup(),
            sources.B.collection.cleanup(),
          ])
          start()
        } else if (shapeSources[shape].includes(step.source)) {
          const params = sources[step.source].params
          if (step.kind === `ready`) {
            if (params.collection.status === `loading`) {
              params.begin()
              params.write({
                type: `insert`,
                value: { id: 1, parentId: 1 },
              })
              params.commit()
            }
            params.markReady()
          } else if (step.kind === `fail`) {
            params.markError(new Error(`${step.source} gave up`))
          } else if (step.kind === `healthy`) {
            params.reportHealthy()
          } else {
            params.reportError(new Error(`${step.source} problem`), {
              final: step.kind === `reportFinal`,
            })
          }
        }
      } catch (error) {
        thrown = error
      }
      await flushPromises()

      if (expected === `throws`) {
        expect(thrown, `${label}: contract violation throws`).toBeDefined()
        if (step.kind === `ready`) {
          expect(thrown, label).toBeInstanceOf(
            InvalidCollectionStatusTransitionError,
          )
        }
      } else {
        expect(thrown, `${label}: legal step`).toBeUndefined()
      }
      expect(query.status, `${label}: gate`).toBe(
        model.query as CollectionStatus,
      )
      if (model.query === `ready`) {
        expect(query.size, `${label}: rows stay while ready`).toBe(1)
      }
      const tree = expectedTree(shape, model)
      expect(project(query.errors), `${label}: error tree`).toEqual(tree)
      if (step.kind !== `restart` && JSON.stringify(tree) !== before) {
        expect(events, `${label}: health:change relay`).toBeGreaterThan(0)
      }
    }
  } finally {
    console.error = consoleError
    stop()
    await query.cleanup()
    await inner?.cleanup()
    await Promise.all([
      sources.A.collection.cleanup(),
      sources.B.collection.cleanup(),
    ])
  }
}

// ---------------------------------------------------------------------------
// Histories
// ---------------------------------------------------------------------------

const shapes: ReadonlyArray<Shape> = [
  `direct`,
  `join`,
  `self-join`,
  `nested`,
  `include`,
]
const on = (
  kind: Exclude<Step[`kind`], `restart`>,
  source: SourceName,
): Step => ({
  kind,
  source,
})
const restart: Step = { kind: `restart` }

// Named histories, one per distinction the law draws.
const namedHistories: Record<string, ReadonlyArray<Step>> = {
  'a non-final problem clears when the source reports healthy': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`report`, `A`),
    on(`healthy`, `A`),
  ],
  'a final problem stays until a restart': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`reportFinal`, `A`),
    on(`healthy`, `A`),
    restart,
    on(`ready`, `A`),
    on(`ready`, `B`),
  ],
  'markError after the first ready is final health': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`fail`, `A`),
    on(`healthy`, `A`),
  ],
  'an initial error is final for its attempt': [
    on(`fail`, `A`),
    on(`ready`, `A`),
    on(`ready`, `B`),
  ],
  'a restart recovers an attempt that failed': [
    on(`fail`, `A`),
    restart,
    on(`ready`, `A`),
    on(`ready`, `B`),
  ],
  'a health report before the first ready throws': [
    on(`report`, `A`),
    on(`healthy`, `B`),
    on(`ready`, `A`),
  ],
}

describe(`source failure and health oracle`, () => {
  for (const shape of shapes) {
    for (const [name, steps] of Object.entries(namedHistories)) {
      it(`${shape}: ${name}`, () => runHistory(shape, steps))
    }
  }

  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    { weight: 1, arbitrary: fc.constant(restart) },
    {
      weight: 6,
      arbitrary: fc
        .tuple(
          fc.constantFrom(
            `ready` as const,
            `fail` as const,
            `report` as const,
            `reportFinal` as const,
            `healthy` as const,
          ),
          fc.constantFrom(`A` as const, `B` as const),
        )
        .map(([kind, source]) => on(kind, source)),
    },
  )
  fcTest.prop(
    [fc.constantFrom(...shapes), fc.array(stepArb, { maxLength: 8 })],
    oraclePropertyOptions(60, `source-health.history`),
  )(`generated histories refine the model`, (shape, steps) =>
    runHistory(shape, steps),
  )
})

// ---------------------------------------------------------------------------
// Request lane
// ---------------------------------------------------------------------------

/**
 * A live query's lazy source loads only the keys its rows reach. After the
 * query's first ready, a load that fails is a request error on the query's
 * own node: the source stays healthy and the query keeps its status. It
 * clears when the same demand later settles, or when the query stops needing
 * it. Before the first ready, the same failure fails the query's attempt.
 */
describe(`request errors`, () => {
  function createRequestHistory() {
    let parentParams!: SyncParams
    const outcomes: Array<`ok` | `fail`> = []
    const parents = createCollection<Row, number>({
      id: `health-request-parents-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          parentParams = params
        },
      },
    })
    const children = createCollection<Row, number>({
      id: `health-request-children-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: (_options: LoadSubsetOptions) => {
              const outcome = outcomes.shift() ?? `ok`
              return outcome === `ok`
                ? Promise.resolve()
                : Promise.reject(new Error(`child load failed`))
            },
          }
        },
      },
    })
    const query = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents })
        .leftJoin({ child: children }, ({ parent, child }) =>
          eq(parent.id, child.parentId),
        ),
    )
    const writeParent = (type: `insert` | `delete`, id: number) => {
      parentParams.begin()
      parentParams.write({ type, value: { id, parentId: id } })
      parentParams.commit()
    }
    const markParentsReady = () => parentParams.markReady()
    return { parents, children, query, outcomes, writeParent, markParentsReady }
  }

  async function withHistory(
    run: (history: ReturnType<typeof createRequestHistory>) => Promise<void>,
  ) {
    const history = createRequestHistory()
    const consoleError = console.error
    console.error = () => {}
    try {
      await run(history)
    } finally {
      console.error = consoleError
      await history.query.cleanup()
      await history.parents.cleanup()
      await history.children.cleanup()
    }
  }

  it(`a failed load after ready is a request error that clears when its demand settles`, () =>
    withHistory(
      async ({ query, children, outcomes, writeParent, markParentsReady }) => {
        const preload = query.preload()
        writeParent(`insert`, 1)
        markParentsReady()
        await preload
        expect(query.errors.isError).toBe(false)

        outcomes.push(`fail`)
        writeParent(`insert`, 2)
        await flushPromises()
        expect(query.status).toBe(`ready`)
        expect(query.errors.error).toMatchObject({
          phase: `request`,
          final: false,
        })
        expect(children.health.isError).toBe(false)

        // The demand changes again and its new load settles.
        outcomes.push(`ok`)
        writeParent(`insert`, 3)
        await flushPromises()
        expect(query.errors.isError).toBe(false)
      },
    ))

  it(`a request error clears when the query stops needing the demand`, () =>
    withHistory(async ({ query, outcomes, writeParent, markParentsReady }) => {
      const preload = query.preload()
      writeParent(`insert`, 1)
      markParentsReady()
      await preload

      outcomes.push(`fail`)
      writeParent(`insert`, 2)
      await flushPromises()
      expect(query.errors.error?.phase).toBe(`request`)

      writeParent(`delete`, 1)
      writeParent(`delete`, 2)
      await flushPromises()
      expect(query.errors.isError).toBe(false)
      expect(query.status).toBe(`ready`)
    }))

  it(`a failed load before ready fails the query's attempt`, () =>
    withHistory(async ({ query, outcomes, writeParent, markParentsReady }) => {
      outcomes.push(`fail`)
      const preload = query.preload()
      void preload.catch(() => undefined)
      writeParent(`insert`, 1)
      markParentsReady()
      await flushPromises()
      expect(query.status).toBe(`error`)
      expect(query.errors.error).toMatchObject({
        phase: `initial`,
        final: true,
      })
      await expect(preload).rejects.toBeDefined()
    }))
})

// ---------------------------------------------------------------------------
// Effect lane
// ---------------------------------------------------------------------------

/**
 * An Effect has the same two axes. A source failure before the Effect's first
 * ready disposes it through `onSourceError`. After its first ready, a source
 * problem does not dispose it: `onHealthChange` receives the error tree, with
 * one node per source alias. An on-demand source can fail its own initial
 * sync after the Effect is ready, because the Effect's readiness follows its
 * settled loads; that failure is health too.
 */
describe(`effect health`, () => {
  type EffectHistory = {
    syncMode: `eager` | `on-demand`
    failBeforeReady: boolean
    failure: `markError` | `reportFinal`
  }
  const histories: Array<EffectHistory> = [
    { syncMode: `eager`, failBeforeReady: true, failure: `markError` },
    { syncMode: `eager`, failBeforeReady: false, failure: `markError` },
    { syncMode: `eager`, failBeforeReady: false, failure: `reportFinal` },
    { syncMode: `on-demand`, failBeforeReady: false, failure: `markError` },
  ]

  it.each(histories)(`%j`, async ({ syncMode, failBeforeReady, failure }) => {
    let params!: SyncParams
    const source = createCollection<Row, number>({
      id: `health-effect-${syncMode}-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode,
      gcTime: 0,
      sync: {
        sync: (next) => {
          params = next
          if (syncMode === `on-demand`) return { loadSubset: () => true }
          return undefined
        },
      },
    })
    const sourceErrors: Array<Error> = []
    const trees: Array<ErrorTreeNode> = []
    const effect = createEffect({
      query: (q) => q.from({ row: source }),
      onBatch: () => {},
      onSourceError: (error) => sourceErrors.push(error),
      onHealthChange: (errors) => trees.push(errors),
    })
    const consoleError = console.error
    console.error = () => {}
    try {
      await flushPromises()
      if (failBeforeReady) {
        params.markError(new Error(`gave up`))
        await flushPromises()
        // Model: the Effect never reached ready, so the failure ends it.
        expect(effect.disposed).toBe(true)
        expect(sourceErrors).toHaveLength(1)
        expect(trees).toEqual([])
        return
      }
      if (syncMode === `eager`) {
        params.begin()
        params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
        params.commit()
        params.markReady()
        await flushPromises()
      }
      if (failure === `markError`) params.markError(new Error(`gave up`))
      else params.reportError(new Error(`problem`), { final: true })
      await flushPromises()

      // Model: after the Effect's first ready, the failure is health.
      expect(effect.disposed).toBe(false)
      expect(sourceErrors).toEqual([])
      expect(trees.length).toBeGreaterThan(0)
      expect(trees.at(-1)).toMatchObject({
        kind: `live-query`,
        hasErrors: true,
        sources: [
          {
            alias: `row`,
            isError: true,
            error: {
              phase: syncMode === `on-demand` ? `initial` : `sync`,
              final: true,
            },
          },
        ],
      })
    } finally {
      console.error = consoleError
      await effect.dispose()
      await source.cleanup()
    }
  })
})
