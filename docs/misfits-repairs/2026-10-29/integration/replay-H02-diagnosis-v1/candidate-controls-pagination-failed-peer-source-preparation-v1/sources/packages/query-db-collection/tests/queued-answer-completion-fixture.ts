import { QueryClient } from '@tanstack/query-core'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  include,
  isUndefined,
  toArray,
} from '@tanstack/db'
import { evaluateReferenceExpression } from '../../db/tests/reference-expression-oracle.js'
import { queryCollectionOptions } from '../src/query.js'
import {
  attachCompletionBuilder,
  attachCompletionFacades,
  attachCompletionOperators,
  attachCompletionReceipts,
  attachCompletionSourceLoads,
  createCompletionOperations,
  createCompletionPublicReader,
  createCompletionRecorder,
} from './queued-answer-completion-attachments.js'
import type {
  Collection,
  InitialQueryBuilder,
  LoadSubsetOptions,
} from '@tanstack/db'
import type { BasicExpression } from '../../db/src/query/ir.js'
import type { LiveQueryCollectionUtils } from '../../db/src/query/live/collection-config-builder.js'
import type {
  CompletionBoundaryEvent,
  CompletionRoot,
  CompletionSourceLoad,
} from './queued-answer-completion-attachments.js'
import type {
  CompletionFacts,
  CompletionSetup,
} from './queued-answer-completion-oracle.js'

type Source = `roots` | `marked` | `children`
type Root = CompletionFacts[`roots`][number]
type Marker = { id: number; rowId: number }
type Child = CompletionFacts[`children`][number]
type Recorder = ReturnType<typeof createCompletionRecorder>
type ProviderRow = Root | Marker | Child

/** A complete parent domain cannot depend on child IDs or a capped page. */
export function isCompletionFullDomainLoad(
  source: `marked` | `children`,
  options: LoadSubsetOptions,
  key: number,
) {
  if (
    options.limit !== undefined ||
    options.cursor !== undefined ||
    (options.offset ?? 0) !== 0
  )
    return false
  const fields = source === `children` ? [`parent`] : [`rowId`, `id`]
  const onlyDomain = (expression: BasicExpression): boolean => {
    if (expression.type === `val`) return true
    if (expression.type === `ref`)
      return (
        expression.path.length === 1 &&
        fields.includes(String(expression.path[0]))
      )
    return expression.args.every(onlyDomain)
  }
  if (!options.where) return true
  if (!onlyDomain(options.where)) return false
  return (
    evaluateReferenceExpression(
      options.where,
      source === `children` ? { parent: key } : { rowId: key, id: key },
    ) === true
  )
}

export type CompletionProviderRequest = {
  id: number
  source: Source
  options: LoadSubsetOptions
  requested: Array<number>
  answered: boolean
  appliedLoad: CompletionSourceLoad | undefined
  queryKey: ReadonlyArray<unknown>
  executedAt?: number
  failedAt?: number
  answeredRows?: Array<ProviderRow>
  cancelled: () => boolean
  answer: () => void
  fail: (error: unknown) => void
}

/**
 * Finite contract-serving provider. It reads authored backend facts, evaluates
 * the actual request predicates, and serves the requested finite ordered page.
 * Core separately loads a complete leading-rank tie through its uncapped
 * equality predicate (ARCHITECTURE, Ordered requests, continuation, recovery).
 * A cursor request uses its explicit forward scope. This records requests
 * and real queryFn promises, never a fabricated graph-output receipt.
 */
function finiteProvider<Row extends ProviderRow>(
  source: Source,
  queryClient: QueryClient,
  values: () => Array<Row>,
  universe: () => Array<Row>,
  cacheIdentity: `scope` | `subscription`,
  recorder: Recorder,
) {
  const loadCapture: {
    attachment?: ReturnType<typeof attachCompletionSourceLoads>
  } = {}
  let held = false
  const requests: Array<CompletionProviderRequest> = []
  const owners = new WeakMap<object, number>()
  let ownerSequence = 0
  const owner = (options: LoadSubsetOptions) => {
    if (!options.subscription) return undefined
    let id = owners.get(options.subscription)
    if (id === undefined) {
      id = ++ownerSequence
      owners.set(options.subscription, id)
    }
    return id
  }
  const matches = (row: Row, options: LoadSubsetOptions) =>
    (!options.where ||
      evaluateReferenceExpression(options.where, row) === true) &&
    (!options.cursor ||
      evaluateReferenceExpression(options.cursor.whereFrom, row) === true)
  const select = (options: LoadSubsetOptions) => {
    const matching = values().filter((row) => matches(row, options))
    if (source === `marked`) {
      if (
        options.orderBy !== undefined ||
        options.cursor !== undefined ||
        options.limit !== undefined ||
        options.offset !== undefined
      )
        throw new Error(
          `predicate-only ${source} provider received ordered request`,
        )
      return matching.sort((left, right) => left.id - right.id)
    }
    if (options.orderBy) {
      const fields = options.orderBy.map(({ expression, compareOptions }) => {
        if (
          expression.type !== `ref` ||
          !(`path` in expression) ||
          !Array.isArray(expression.path) ||
          expression.path.length !== 1 ||
          compareOptions.direction !== `asc`
        )
          throw new Error(
            `receiving provider only serves its declared ascending field order`,
          )
        return expression.path[0]
      })
      const expected = source === `roots` ? [`rank`, `id`] : [`id`]
      if (
        fields.length > expected.length ||
        fields.some((field, index) => field !== expected[index])
      )
        throw new Error(`unexpected receiving provider order fields`)
    }
    if (source === `children`) {
      const ordered = matching.sort((left, right) => left.id - right.id)
      const offset = options.cursor ? 0 : (options.offset ?? 0)
      return ordered.slice(
        offset,
        options.limit === undefined ? undefined : offset + options.limit,
      )
    }
    const roots = matching as Array<Root>
    const ordered = roots.sort(
      (left, right) => left.rank - right.rank || left.id - right.id,
    )
    const offset = options.cursor ? 0 : (options.offset ?? 0)
    const limit = options.limit ?? ordered.length
    const selected = ordered.slice(offset, offset + limit)
    return selected as Array<Row>
  }
  // Acquisition scopes name the join key, while answers retain child row IDs.
  // A child demand for parent 3 is scope[3], not row IDs[301,302].
  const requestedScope = (options: LoadSubsetOptions) => [
    ...new Set(
      universe()
        .filter((row) => matches(row, options))
        .map((row) => {
          if (source !== `children`) return row.id
          if (!(`parent` in row))
            throw new Error(`child scope lost its parent key`)
          return row.parent
        }),
    ),
  ]
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id: `h02-completion-${source}`,
      queryClient,
      queryKey: (options) => {
        const base = [`h02-completion-${source}`]
        if (Object.keys(options).length === 0) return base
        const requested = requestedScope(options)
        const key = [
          ...base,
          ...(cacheIdentity === `subscription` ? [owner(options)] : []),
          {
            requested,
            where: options.where,
            cursor: options.cursor,
            orderBy: options.orderBy,
            offset: options.offset,
            limit: options.limit,
          },
        ]
        const load = loadCapture.attachment?.current()
        if (load) load.queryKey = key
        return key
      },
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      queryFn: (context) => {
        const options: LoadSubsetOptions = context.meta?.loadSubsetOptions ?? {}
        const requested = requestedScope(options)
        const appliedLoad = loadCapture.attachment?.current()
        recorder.event(`provider-request`, {
          source,
          request: requests.length + 1,
          queryKey: context.queryKey,
          requested,
          initiatingLoad: appliedLoad?.id,
          options: {
            where: options.where,
            orderBy: options.orderBy,
            limit: options.limit,
            offset: options.offset,
            cursor: options.cursor,
            refetch: options.refetch,
            owner: owner(options),
            signalPresent: options.signal !== undefined,
          },
        })
        return new Promise<Array<Row>>((resolve, reject) => {
          const request: CompletionProviderRequest = {
            id: requests.length + 1,
            source,
            options,
            requested,
            answered: false,
            appliedLoad,
            queryKey: context.queryKey,
            cancelled: () => options.signal?.aborted === true,
            answer: () => {
              if (request.answered)
                throw new Error(`provider answer delivered twice`)
              if (request.cancelled())
                throw new Error(`cannot write a cancelled provider answer`)
              request.answered = true
              const rows = select(options)
              request.answeredRows = rows.map((row) => ({ ...row }))
              request.executedAt = recorder.event(`provider-answer-executed`, {
                source,
                request: request.id,
                initiatingLoad: appliedLoad?.id,
                rows,
                queryKey: context.queryKey,
              })
              resolve(rows)
            },
            fail: (error) => {
              if (request.answered)
                throw new Error(`provider answer delivered twice`)
              request.answered = true
              request.failedAt = recorder.event(`provider-answer-failed`, {
                source,
                request: request.id,
                error: recorder.error(error),
              })
              reject(error)
            },
          }
          requests.push(request)
          if (!held) request.answer()
        })
      },
    }),
  )
  const sourceLoads = attachCompletionSourceLoads(
    collection._sync,
    source,
    recorder,
  )
  loadCapture.attachment = sourceLoads
  return {
    collection,
    hold(value: boolean) {
      held = value
    },
    requests: () => [...requests],
    loads: () => sourceLoads.loads(),
    restoreLoads: () => sourceLoads.restore(),
  }
}

export type CompletionFixtureOptions = {
  cacheIdentity: `scope` | `subscription`
  dispatching: () => number | undefined
  heldInitial?: Array<Source>
  observeBoundary?: (event: CompletionBoundaryEvent) => void
}

/**
 * The new receiving profile uses independent roots, markers and nonempty child
 * facts. Actual Collection-valued includes retain their real handles. It does
 * not alter the original eight progress histories or their array projection.
 * This factory performs no model actions; authored programs own dependencies.
 * Admission is synchronous so native answer reactions cannot overtake caller
 * instrumentation. If construction throws before returning its cleanup handle,
 * the one-program worker records the original failure and exits; it must not
 * recover, retry, or construct another fixture in that process. Only the outer
 * verified process-group teardown bounds partial setup; no fixture-cleanup
 * success is claimed for an unreturned construction.
 */
export function createCompletionFixture(
  setup: CompletionSetup,
  options: CompletionFixtureOptions,
) {
  const recorder = createCompletionRecorder(options.observeBoundary)
  const operations = createCompletionOperations(recorder)
  let facts = structuredClone(setup.facts)
  let run = setup.run
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: Infinity },
    },
  })
  const roots = finiteProvider(
    `roots`,
    queryClient,
    () => facts.roots,
    () => setup.facts.roots,
    options.cacheIdentity,
    recorder,
  )
  const markers = finiteProvider(
    `marked`,
    queryClient,
    () => facts.marked.map((id) => ({ id, rowId: id })),
    () => setup.facts.roots.map(({ id }) => ({ id, rowId: id })),
    options.cacheIdentity,
    recorder,
  )
  const children = finiteProvider(
    `children`,
    queryClient,
    () => facts.children,
    () => setup.facts.children,
    options.cacheIdentity,
    recorder,
  )
  const providers = { roots, marked: markers, children }
  for (const source of options.heldInitial ?? []) providers[source].hold(true)
  const id = `h02-completion-root`
  const stopOperators = attachCompletionOperators(recorder)
  const facades = attachCompletionFacades(id, recorder)
  const selected = (q: InitialQueryBuilder) =>
    q
      .from({ row: roots.collection })
      .leftJoin({ marker: markers.collection }, ({ row, marker }) =>
        eq(row.id, marker.rowId),
      )
      .where(({ marker }) => isUndefined(marker.rowId))
      .orderBy(({ row }) => row.rank)
      .orderBy(({ row }) => row.id)
      .offset(setup.window.offset)
      .limit(setup.window.limit)
  const build = () =>
    setup.profile === `facade`
      ? createLiveQueryCollection({
          id,
          query: (q) =>
            selected(q).select(({ row }) => ({
              id: row.id,
              rank: row.rank,
              children: include(
                q
                  .from({ child: children.collection })
                  .where(({ child }) => eq(child.parent, row.id))
                  .orderBy(({ child }) => child.id)
                  .select(({ child }) => ({
                    id: child.id,
                    parent: child.parent,
                  })),
              ),
            })),
        })
      : createLiveQueryCollection({
          id,
          query: (q) =>
            selected(q).select(({ row }) => ({
              id: row.id,
              rank: row.rank,
              children: toArray(
                q
                  .from({ child: children.collection })
                  .where(({ child }) => eq(child.parent, row.id))
                  .orderBy(({ child }) => child.id)
                  .select(({ child }) => child.id),
              ),
            })),
        })
  const live = build() as unknown as Collection<
    CompletionRoot,
    string | number,
    LiveQueryCollectionUtils
  >
  const allRootReceipts: Array<
    ReturnType<typeof attachCompletionReceipts<CompletionRoot>>
  > = []
  const restoreReadyCallbacks: Array<() => void> = []
  const originalRootSync = live.config.sync.sync
  // The builder captures commit while constructing its real flush closure.
  // Observe at sync entry, before that capture; replacing config.commit after
  // establishment would miss the actual root commits and falsely imply reach.
  live.config.sync.sync = (methods) => {
    // The baseline can identify this sync-run grouping only. This object is not
    // a future completion incarnation, task, or candidate publication attempt.
    const attempt = {}
    const receipts = attachCompletionReceipts(
      methods,
      `root`,
      () => attempt,
      recorder,
    )
    allRootReceipts.push(receipts)
    const originalReady = methods.markReady
    methods.markReady = () => {
      recorder.event(`root-mark-ready-enter`, { run })
      try {
        const result = originalReady()
        recorder.event(`root-mark-ready-return`, { run })
        return result
      } catch (error) {
        recorder.event(`root-mark-ready-throw`, {
          run,
          error: recorder.error(error),
        })
        throw error
      }
    }
    restoreReadyCallbacks.push(() => {
      methods.markReady = originalReady
    })
    return originalRootSync(methods)
  }
  const downstream = createLiveQueryCollection((q) =>
    q
      .from({ row: live })
      .orderBy(({ row }) => row.rank)
      .orderBy(({ row }) => row.id)
      .select(({ row }) => ({
        id: row.id,
        rank: row.rank,
        children: row.children,
      })),
  ) as unknown as Collection<CompletionRoot, string | number>
  const read = createCompletionPublicReader(
    live,
    downstream,
    () => run,
    () =>
      live.utils.lastSubsetError === undefined
        ? []
        : [live.utils.lastSubsetError],
    recorder,
  )
  let publicFailure: { error: unknown } | undefined
  let statusFailure: { error: unknown } | undefined
  const stopStatus = live.on(`status:change`, (event) => {
    const at = recorder.event(`real-status-callback`, {
      run,
      status: event.status,
      previousStatus: event.previousStatus,
      target: recorder.object(event.collection),
    })
    if (statusFailure && event.status === `ready`) {
      const error = statusFailure.error
      statusFailure = undefined
      recorder.event(`real-status-callback-throw`, {
        at,
        error: recorder.error(error),
      })
      throw error
    }
  })
  const rawRoot = (row: CompletionRoot) => ({
    ...row,
    children: Array.isArray(row.children)
      ? [...row.children]
      : {
          handle: recorder.object(row.children),
          rows: row.children.toArray.map((child) => ({ ...child })),
        },
  })
  const subscriptions = [
    live.subscribeChanges((changes) => {
      // The root's public state now exposes these exact child Collections.
      // Their real public subscribers start here, separately from the earlier
      // adapter-boundary observer installed before exposure.
      for (const row of live.toArray)
        if (!Array.isArray(row.children))
          facades.bindPublicBucket(row.id, row.children)
      recorder.event(`root-callback`, {
        changes: changes.map((message) => ({
          ...message,
          value: rawRoot(message.value),
          previousValue:
            message.previousValue && rawRoot(message.previousValue),
        })),
        read: live.toArray.map(rawRoot),
      })
      if (publicFailure) {
        const error = publicFailure.error
        publicFailure = undefined
        recorder.event(`real-root-subscriber-throw`, {
          error: recorder.error(error),
          installed: read().roots,
        })
        throw error
      }
    }),
    downstream.subscribeChanges((changes) =>
      recorder.event(`downstream-callback`, {
        changes: changes.map((message) => ({
          ...message,
          value: rawRoot(message.value),
          previousValue:
            message.previousValue && rawRoot(message.previousValue),
        })),
        read: downstream.toArray.map(rawRoot),
      }),
    ),
  ]
  // Real queryFn answers are promises. Bind after the synchronous subscription
  // admission, before their native reactions can publish the initial result.
  const attachment = attachCompletionBuilder(
    live,
    recorder,
    options.dispatching,
  )
  return {
    recorder,
    operations,
    live,
    downstream,
    providers,
    facades,
    read,
    faults: {
      publicSubscriber(error: unknown) {
        if (publicFailure)
          throw new Error(`receiving subscriber fault already armed`)
        publicFailure = { error }
      },
      realStatusCallback(error: unknown) {
        if (statusFailure)
          throw new Error(`receiving status fault already armed`)
        statusFailure = { error }
      },
    },
    setFacts(next: CompletionFacts) {
      facts = structuredClone(next)
    },
    writeRoots(rows: Array<Root>) {
      recorder.event(`source-manual-write-enter`, { source: `roots`, rows })
      const result = roots.collection.utils.writeUpsert(rows)
      recorder.event(`source-manual-write-return`, {
        source: `roots`,
        returnedPromise: result instanceof Promise,
      })
      return result
    },
    writeChildren(rows: Array<Child>) {
      recorder.event(`source-manual-write-enter`, { source: `children`, rows })
      const result = children.collection.utils.writeInsert(rows)
      recorder.event(`source-manual-write-return`, {
        source: `children`,
        returnedPromise: result instanceof Promise,
      })
      return result
    },
    setRun(next: string) {
      run = next
    },
    async establish() {
      if (!setup.ready)
        throw new Error(
          `loading status-tail fixture needs its held-initial program`,
        )
      await live.preload()
      await downstream.preload()
      for (const row of live.toArray)
        if (!Array.isArray(row.children))
          facades.bindPublicBucket(row.id, row.children)
      recorder.event(`fixture-established`, { view: read() })
      return attachment
    },
    attachment: () => {
      return attachment
    },
    rootReceipts: () =>
      allRootReceipts.flatMap((receipts) => receipts.receipts()),
    async cleanup() {
      recorder.event(`cleanup-start`, { run })
      let failure: unknown
      const remember = (error: unknown) => {
        if (failure === undefined) failure = error
        else
          recorder.event(`secondary-cleanup-error`, {
            error: recorder.error(error),
          })
      }
      const cleanSync = (callback: () => unknown) => {
        try {
          callback()
        } catch (error) {
          remember(error)
        }
      }
      const clean = async (callback: () => unknown) => {
        try {
          await callback()
        } catch (error) {
          remember(error)
        }
      }
      for (const subscription of subscriptions)
        cleanSync(() => subscription.unsubscribe())
      await clean(() => downstream.cleanup())
      await clean(() => live.cleanup())
      for (const receipts of allRootReceipts)
        cleanSync(() => receipts.restore())
      for (const restore of restoreReadyCallbacks) cleanSync(restore)
      cleanSync(() => {
        live.config.sync.sync = originalRootSync
      })
      cleanSync(() => attachment.restore())
      cleanSync(stopStatus)
      cleanSync(() => facades.restore())
      cleanSync(stopOperators)
      for (const provider of [children, markers, roots])
        await clean(() => provider.collection.cleanup())
      for (const provider of [children, markers, roots])
        cleanSync(provider.restoreLoads)
      cleanSync(() => queryClient.clear())
      recorder.event(
        failure === undefined ? `cleanup-complete` : `cleanup-failed`,
        { run },
      )
      if (failure !== undefined) throw failure
    },
  }
}
