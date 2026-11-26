/**
 * # A deferred window over a held subset publishes without provider work
 *
 * ## Contract
 *
 * `query/live/ARCHITECTURE.md`, "Deferred acquisition": a live query with no
 * subscriber or preload starts no provider work, and an ordered window over an
 * on-demand source is not published until its acquisitions settle, because
 * local rows cannot prove a window. `isSubsetLoaded` is the sync adapter's
 * local statement that the Collection already holds every row of a subset.
 * With that statement the deferred window publishes those rows at once.
 * Acquisition still starts when the query resumes. "Ordered requests,
 * continuation, and recovery": joined demand holds a joined filter's ordered
 * requests, including its first one, until that demand settles.
 *
 * ## Limits
 *
 * The hook cells vary the hook over one ordered window on one on-demand
 * source: no hook, a hook that says held, one that says not held, one that
 * throws, and one that returns a truthy non-boolean. A hook that claims rows
 * the Collection does not hold is outside the contract. The joined cells cover
 * a held root whose joined source has not answered, and, on the loader alone,
 * a first request answered synchronously or not while joined work is pending
 * or idle. The source-ready cells cover a source that becomes ready after the
 * hook answered. An open truncate replay is not exercised here.
 *
 * ## Model
 *
 * Each model computes the owed observations from the history's axes alone.
 * Only a `held` answer publishes before a subscriber, and every cell issues no
 * provider request before its subscriber and at least one after it. A
 * deferred joined window returns and reaches the filtered window after its
 * subscriber. A first request waits while joined work is pending and runs at
 * the pass after it settles. A source-ready demand is loading exactly while
 * the hook does not vouch for its rows.
 *
 * ## Production path and observation
 *
 * The drivers run real live queries, or `OrderedSourceLoader` over a fake
 * subscription, and record public status, rows, `isLoadingSubset`, provider
 * calls and the loader's requests at fixed checkpoints. A spin issues no
 * request, so the joined-work callback carries a read budget: exceeding it
 * ends the loop and is observed instead of hanging the runner.
 */
import { describe, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { CollectionConfigBuilder } from '../../src/query/live/collection-config-builder.js'
import { OrderedSourceLoader } from '../../src/query/live/ordered-source-loader.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators.js'
import { PropRef } from '../../src/query/ir.js'
import { oracleProperty } from '../oracle-config.js'
import { differs, pass } from '../oracle-property.js'
import { createOrderByInfo } from './ordered-source-loader-support.js'
import type { Observation, Verdict } from '../oracle-property.js'
import type { CollectionSubscription } from '../../src/collection/subscription.js'
import type { LoadSubsetOptions } from '../../src/types.js'
import type { RequestOptions } from './ordered-source-loader-support.js'

type Row = { id: number; rank: number; group: string }

const rows: Array<Row> = Array.from({ length: 20 }, (_, id) => ({
  id,
  rank: 100 - id,
  group: id % 2 === 0 ? `even` : `odd`,
}))
const expectedIds = rows
  .filter(({ group }) => group === `even`)
  .slice(0, 3)
  .map(({ id }) => id)

// More reads than any terminating drain makes.
const joinedReadBudget = 1000

/** Compare the trace with the owed observations, checkpoint by checkpoint. */
function compareOwed(law: string) {
  return (
    _plan: unknown,
    observations: ReadonlyArray<Observation>,
    owed: ReadonlyArray<Observation>,
  ): Verdict => {
    for (const [index, { checkpoint, value }] of owed.entries()) {
      const observed = observations[index]
      const verdict =
        differs(checkpoint, law, observed?.checkpoint, checkpoint) ??
        differs(checkpoint, law, observed?.value, value)
      if (verdict) return verdict
    }
    return differs(`trace`, law, observations.length, owed.length) ?? pass
  }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Provider answers chain through timers, so after its delay a cell also waits
// until the collection reports no subset work.
const quiescent = (collection: { status: string; isLoadingSubset: boolean }) =>
  vi.waitFor(
    () => {
      if (collection.status !== `ready` || collection.isLoadingSubset)
        throw new Error(`still loading`)
    },
    { timeout: 2000, interval: 1 },
  )

const ids = (collection: { values: () => Iterable<{ id: number }> }) =>
  Array.from(collection.values(), ({ id }) => id)

// ## Hook answers over one deferred window

const hookCases = [
  { hook: `none` },
  { hook: `held` },
  { hook: `not-held` },
  { hook: `throws` },
  { hook: `truthy` },
] as const
type HookCase = (typeof hookCases)[number]

function hookFor({ hook }: HookCase, holdsSubset: () => boolean) {
  switch (hook) {
    case `none`:
      return {}
    case `held`:
      return { isSubsetLoaded: holdsSubset }
    case `not-held`:
      return { isSubsetLoaded: () => false }
    case `truthy`:
      return { isSubsetLoaded: () => 1 as unknown as boolean }
    case `throws`:
      return {
        isSubsetLoaded: (): boolean => {
          throw new Error(`hook failed`)
        },
      }
  }
}

// Only a `held` answer is the adapter's statement that it holds the subset.
function hookModel({ hook }: HookCase): Array<Observation> {
  const publishes = hook === `held`
  return [
    {
      checkpoint: `before a subscriber`,
      value: {
        ready: publishes,
        rows: publishes ? expectedIds : [],
        providerRequests: 0,
      },
    },
    {
      checkpoint: `after a subscriber`,
      value: { acquires: true, rows: expectedIds },
    },
  ]
}

async function runHookCell(
  cell: HookCase,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  const loads: Array<LoadSubsetOptions> = []
  // The adapter's statement is true only once a load has installed the rows.
  let holdsSubset = false
  const source = createCollection<Row>({
    id: `deferred-loaded-subset-${cell.hook}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    gcTime: 0,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const written = new Set<number>()
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loads.push(options)
            const where = options.where
              ? compileSingleRowExpression(options.where)
              : undefined
            const answer = [...rows]
              .sort((a, b) => b.rank - a.rank)
              .filter((row) => !where || where(row) === true)
              .slice(0, options.limit)
            return new Promise<void>((resolve) =>
              setTimeout(() => {
                begin()
                for (const row of answer) {
                  if (written.has(row.id)) continue
                  written.add(row.id)
                  write({ type: `insert`, value: { ...row } })
                }
                const receipt = commit()
                holdsSubset = true
                void (receipt === true ? resolve() : receipt.then(resolve))
              }, 1),
            )
          },
          ...hookFor(cell, () => holdsSubset),
        }
      },
    },
  })
  const query = () =>
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ row: source })
          .where(({ row }) => eq(row.group, `even`))
          .orderBy(({ row }) => row.rank, `desc`)
          .limit(3)
          .select(({ row }) => ({ id: row.id })),
    })

  const first = query()
  await first.preload()
  await first.cleanup()
  const before = loads.length

  const again = query()
  try {
    observe(`before a subscriber`, {
      ready: again.status === `ready`,
      rows: ids(again),
      providerRequests: loads.length - before,
    })
    const subscription = again.subscribeChanges(() => {})
    await settle(10)
    await quiescent(again)
    observe(`after a subscriber`, {
      acquires: loads.length > before,
      rows: ids(again),
    })
    subscription.unsubscribe()
  } finally {
    await again.cleanup()
    await source.cleanup()
  }
}

// ## A deferred joined window over a held root

type JoinedCase = { root: `held` | `held-later` }

// The root answers its page and tie synchronously while its joined source has
// started no work, so the refill waits for that work.
function joinedModel(_cell: JoinedCase): Array<Observation> {
  return [
    { checkpoint: `the deferred query returns`, value: true },
    { checkpoint: `window after a subscriber`, value: expectedIds },
  ]
}

async function runJoinedHeldCell(
  { root: history }: JoinedCase,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  let holds = history === `held`
  let ready = () => {}
  const owners = rows.map(({ id }) => ({ id, active: id % 2 === 0 }))
  const root = createCollection<Row>({
    id: `deferred-loaded-subset-joined-root-${history}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: history === `held`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) write({ type: `insert`, value: { ...row } })
        commit()
        if (history === `held`) markReady()
        else ready = markReady
        return {
          loadSubset: () => true as const,
          isSubsetLoaded: () => holds,
        }
      },
    },
  })
  const joined = createCollection<{ id: number; active: boolean }>({
    id: `deferred-loaded-subset-joined-owners-${history}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const written = new Set<number>()
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const where = options.where
              ? compileSingleRowExpression(options.where)
              : undefined
            return new Promise<void>((resolve) =>
              setTimeout(() => {
                begin()
                for (const owner of owners) {
                  if ((where && where(owner) !== true) || written.has(owner.id))
                    continue
                  written.add(owner.id)
                  write({ type: `insert`, value: owner })
                }
                const receipt = commit()
                void (receipt === true ? resolve() : receipt.then(resolve))
              }, 1),
            )
          },
        }
      },
    },
  })
  const original = CollectionConfigBuilder.prototype.hasPendingJoinedWork
  let joinedReads = 0
  const reads = vi
    .spyOn(CollectionConfigBuilder.prototype, `hasPendingJoinedWork`)
    .mockImplementation(function (this: never, id: string) {
      if (++joinedReads > joinedReadBudget) {
        throw new Error(`joined-work read budget exceeded`)
      }
      return original.call(this, id)
    })
  let live: ReturnType<typeof buildJoined> | undefined
  function buildJoined() {
    return createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ row: root })
          .leftJoin({ owner: joined }, ({ row, owner }) => eq(row.id, owner.id))
          .where(({ owner }) => eq(owner.active, true))
          .orderBy(({ row }) => row.rank, `desc`)
          .limit(3)
          .select(({ row }) => ({ id: row.id })),
    })
  }
  try {
    try {
      live = buildJoined()
      if (history === `held-later`) {
        root.startSyncImmediate()
        holds = true
        ready()
        await settle(2)
      }
    } catch (error) {
      // Only a spin the read budget ended is an observation.
      if (joinedReads <= joinedReadBudget) throw error
    }
    observe(`the deferred query returns`, joinedReads <= joinedReadBudget)
    if (!live) return
    const subscription = live.subscribeChanges(() => {})
    await settle(20)
    await quiescent(live)
    observe(`window after a subscriber`, ids(live))
    subscription.unsubscribe()
  } finally {
    reads.mockRestore()
    await live?.cleanup()
    await root.cleanup()
    await joined.cleanup()
  }
}

// ## A joined filter's first request

const firstRequestCases = [{ joined: `idle` }, { joined: `pending` }] as const
type FirstRequestCase = (typeof firstRequestCases)[number]

// Every page and tie answers synchronously. The first page, its tie and one
// refill page run once nothing holds them; joined work holds all of them.
function firstRequestModel({ joined }: FirstRequestCase): Array<Observation> {
  const chain = [`page`, `tie`, `page`]
  return [
    { checkpoint: `start returns`, value: true },
    {
      checkpoint: `requests while joined work is ${joined}`,
      value: joined === `pending` ? [] : chain,
    },
    { checkpoint: `requests after joined work settles`, value: chain },
  ]
}

async function runFirstRequestCell(
  cell: FirstRequestCase,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  const requests: Array<`page` | `tie`> = []
  let joinedPending = cell.joined === `pending`
  let joinedReads = 0
  const subscription = {
    setOrderByIndex: () => {},
    readOrderedSnapshot: () => [{ value: { rank: 1 } }],
    requestLimitedSnapshot: (options: RequestOptions) => {
      requests.push(`page`)
      options.onLoadSubsetResult?.(true, options, () => {})
    },
    requestSnapshot: (options: RequestOptions) => {
      requests.push(`tie`)
      options.onLoadSubsetResult?.(true, options, () => {})
    },
  }
  const loader = new OrderedSourceLoader(
    createOrderByInfo({ joinedFilterSourceIds: [`joined`] }),
    subscription as unknown as CollectionSubscription,
    `row`,
    () => {},
    () => false,
    () => 0,
    () => {
      if (++joinedReads > joinedReadBudget) {
        throw new Error(`joined-work read budget exceeded`)
      }
      return joinedPending
    },
  )
  try {
    try {
      loader.start()
    } catch (error) {
      if (joinedReads <= joinedReadBudget) throw error
    }
    observe(`start returns`, joinedReads <= joinedReadBudget)
    observe(`requests while joined work is ${cell.joined}`, [...requests])
    joinedPending = false
    // The graph pass that follows the joined settlement.
    loader.loadMore()
    await settle(0)
    observe(`requests after joined work settles`, [...requests])
  } finally {
    loader.dispose()
  }
}

// ## A source that becomes ready after the hook answered

type SourceReadyCase = {
  source:
    `late-ready` | `released` | `held-later` | `never-held` | `ready-in-sync`
}

// The axes each history fixes: whether the source starts only after a deferred
// demand asked, what the hook answers when the source starts and once it is
// ready, and whether it is ready before its sync() returns the hook.
function sourceReadyAxes({ source }: SourceReadyCase) {
  const startsLate = source !== `late-ready` && source !== `released`
  return {
    startsLate,
    holdsAtStart: !startsLate || source === `ready-in-sync`,
    holdsAtReady:
      source === `late-ready` ||
      source === `held-later` ||
      source === `ready-in-sync`,
    readyInSync: source === `ready-in-sync`,
  }
}

// A demand is loading exactly while the hook does not vouch for its rows, and
// a window publishes once the hook vouched for them while the query asked.
function sourceReadyModel(cell: SourceReadyCase): Array<Observation> {
  const { startsLate, holdsAtStart, holdsAtReady, readyInSync } =
    sourceReadyAxes(cell)
  const owed: Array<Observation> = []
  if (startsLate && !readyInSync) {
    owed.push({
      checkpoint: `deferred demand once the source starts`,
      value: holdsAtStart ? `ready` : `loadingSubset`,
    })
  }
  if (startsLate) {
    owed.push({
      checkpoint: `deferred demand once the source is ready`,
      value: holdsAtReady ? `ready` : `loadingSubset`,
    })
  }
  const published = startsLate ? holdsAtReady : holdsAtStart || holdsAtReady
  owed.push({
    checkpoint: `window once the source is ready`,
    value: {
      rows: published ? expectedIds : [],
      loading: !holdsAtReady,
      // An unpublished page never settled, so the loader asked for no tie.
      tieAsked: published,
    },
  })
  return owed
}

async function runSourceReadyCell(
  cell: SourceReadyCase,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  const { startsLate, holdsAtStart, holdsAtReady, readyInSync } =
    sourceReadyAxes(cell)
  let ready!: () => void
  let holds = !startsLate && holdsAtStart
  const asked: Array<LoadSubsetOptions> = []
  const source = createCollection<Row>({
    id: `deferred-loaded-subset-source-${cell.source}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: !startsLate,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) write({ type: `insert`, value: { ...row } })
        commit()
        ready = markReady
        // The adapter is ready before it returns its hook.
        if (readyInSync) markReady()
        return {
          loadSubset: () => true as const,
          isSubsetLoaded: (options: LoadSubsetOptions) => {
            asked.push(options)
            return holds
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    startSync: true,
    query: (q) =>
      q
        .from({ row: source })
        .where(({ row }) => eq(row.group, `even`))
        .orderBy(({ row }) => row.rank, `desc`)
        .limit(3)
        .select(({ row }) => ({ id: row.id })),
  })
  const deferred = startsLate
    ? source.subscribeChanges(() => {}, { deferAcquisition: true })
    : undefined
  try {
    if (deferred) {
      deferred.requestSnapshot({ where: eq(new PropRef([`group`]), `even`) })
      holds = holdsAtStart
      source.startSyncImmediate()
      if (!readyInSync) {
        observe(`deferred demand once the source starts`, deferred.status)
      }
    }
    holds = holdsAtReady
    if (!readyInSync) ready()
    await settle(5)
    if (deferred) {
      observe(`deferred demand once the source is ready`, deferred.status)
    }
    observe(`window once the source is ready`, {
      rows: ids(live),
      loading: live.isLoadingSubset,
      tieAsked: asked.some(
        (options) =>
          options.subscription !== deferred && options.limit === undefined,
      ),
    })
  } finally {
    deferred?.unsubscribe()
    await live.cleanup()
    await source.cleanup()
  }
}

describe(`deferred window over a held subset`, () => {
  oracleProperty({
    id: `deferred-loaded-subset.window`,
    law: {
      statement: `A deferred ordered window publishes before a subscriber only when isSubsetLoaded says the source holds its subset, starts no provider work before then, and still acquires after.`,
      authority: `query/live/ARCHITECTURE.md: Deferred acquisition.`,
      limits: `Five hook answers over one ordered window; joined windows and an open truncate replay are not exercised.`,
    },
    owns: ['src/collection/subscription.ts', 'src/collection/sync.ts'],
    histories: hookCases,
    label: ({ hook }) => `with hook ${hook}`,
    model: hookModel,
    driver: runHookCell,
    check: compareOwed(`deferred held window`),
  })

  oracleProperty({
    id: `deferred-loaded-subset.joined`,
    law: {
      statement: `A deferred joined window over a held root returns while its joined source has not answered, and reaches the right window after its first subscriber.`,
      authority: `query/live/ARCHITECTURE.md: Deferred acquisition; Ordered requests, continuation, and recovery.`,
      limits: `One LEFT-joined filter whose root answers synchronously.`,
    },
    owns: ['src/query/live/ordered-source-loader.ts'],
    histories: [{ root: `held` }, { root: `held-later` }] as Array<JoinedCase>,
    label: ({ root }) => `${root} root with an unanswered joined source`,
    model: joinedModel,
    driver: runJoinedHeldCell,
    check: compareOwed(`deferred joined window`),
  })

  oracleProperty({
    id: `deferred-loaded-subset.joined-first-request`,
    law: {
      statement: `A joined filter's first ordered request waits while joined work is pending: start returns without a request, and the pass after the joined work settles issues the page and its synchronous tie and refill once.`,
      authority: `query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `Joined work idle or pending at start, on a fake subscription whose pages and ties answer synchronously.`,
    },
    owns: ['src/query/live/ordered-source-loader.ts'],
    histories: firstRequestCases,
    label: ({ joined }) => `first request with joined work ${joined}`,
    model: firstRequestModel,
    driver: runFirstRequestCell,
    check: compareOwed(`joined first request`),
  })

  oracleProperty({
    id: `deferred-loaded-subset.source-ready`,
    law: {
      statement: `A deferred demand the hook settled is not reported as loading when its source later becomes ready, unless the adapter no longer vouches for its rows, and stops being reported as loading once the adapter does.`,
      authority: `query/live/ARCHITECTURE.md: Deferred acquisition.`,
      limits: `One ordered window whose source becomes ready after the hook answered, with the hook still holding, after it stopped, after it began holding, when it never held, and when the source is ready before it returns the hook.`,
    },
    owns: ['src/collection/subscription.ts'],
    histories: [
      { source: `late-ready` },
      { source: `released` },
      { source: `held-later` },
      { source: `never-held` },
      { source: `ready-in-sync` },
    ] as Array<SourceReadyCase>,
    label: ({ source }) => `${source} source`,
    model: sourceReadyModel,
    driver: runSourceReadyCell,
    check: compareOwed(`deferred source ready`),
  })
})
