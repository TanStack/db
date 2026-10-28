import { BTreeIndex, IR, createCollection } from '@tanstack/db'
import { makeFunctionReference } from 'convex/server'
import { convexPaginatedCollectionOptions } from '../src/index'
import { deliveredScopeComplete, ordered } from './lazy-paging-model-oracle'
import type { LoadSubsetOptions, SyncAppliedReceipt } from '@tanstack/db'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import type { ConvexCollectionClient } from '../src/index'
import type { LazyRow, LazyScope } from './lazy-paging-model-oracle'

export const lazyQuery = makeFunctionReference<
  `query`,
  { paginationOpts: PaginationOptions },
  PaginationResult<LazyRow>
>(`rows:lazy`)
export const lazyOrder = (
  descending = false,
): NonNullable<LoadSubsetOptions[`orderBy`]> => [
  {
    expression: new IR.PropRef([`rank`]),
    compareOptions: { direction: descending ? `desc` : `asc`, nulls: `first` },
  },
]
export function lazyRequest(
  scope: LazyScope,
  descending = false,
): LoadSubsetOptions {
  const field = new IR.PropRef([`rank`])
  return {
    orderBy: lazyOrder(descending),
    offset: scope.offset,
    limit: scope.limit,
    ...(scope.equal === undefined
      ? {}
      : { where: new IR.Func(`eq`, [field, new IR.Value(scope.equal)]) }),
    ...(scope.after === undefined
      ? {}
      : {
          cursor: {
            whereFrom: new IR.Func(descending ? `lt` : `gt`, [
              field,
              new IR.Value(scope.after),
            ]),
            whereCurrent: new IR.Func(`eq`, [field, new IR.Value(scope.after)]),
          },
        }),
  }
}

type Slot = {
  opts: PaginationOptions
  callback: (rows: PaginationResult<LazyRow>) => void
  fail?: (error: unknown) => void
  current?: PaginationResult<LazyRow>
  active: boolean
  revision: number
}
/** Only transport is controlled. Opaque tokens denote authored (rank,id)
 * intervals; rows never come from the production Collection or its cursors.
 * Each transition installs all existing caches before any callback dispatch,
 * matching the SDK premise. New subscriptions remain independently pending. */
export function lazyProvider(
  initial: Array<LazyRow>,
  descending = false,
  split: `none` | `required` | `recommended` = `none`,
  short = false,
  kind: `javascript` | `react` = `javascript`,
) {
  let source = initial.map((row) => ({ ...row }))
  let revision = 0
  let online = true
  const slots: Array<Slot> = []
  const cursors = new Map<string, LazyRow>()
  const scopes = new Map<object, LazyScope>()
  const delivered = new Map<string, LazyRow>()
  const knownFacts = new Map<string, LazyRow>()
  let exhausted = false
  let successorStarts = 0
  let obsoleteReads = 0
  const compare = (a: LazyRow, b: LazyRow) =>
    descending
      ? b.rank - a.rank || b.id.localeCompare(a.id)
      : a.rank - b.rank || a.id.localeCompare(b.id)
  const token = (row: LazyRow) => {
    const value = `opaque:${row.rank}:${row.id}`
    cursors.set(value, { ...row })
    return value
  }
  const client = {
    onUpdate: (
      _query: unknown,
      args: { paginationOpts: PaginationOptions },
      callback: Slot[`callback`],
      fail: Slot[`fail`],
    ) => {
      const opts = { ...args.paginationOpts }
      if (
        opts.cursor === null &&
        opts.endCursor == null &&
        !slots.some((slot) => slot.active)
      ) {
        delivered.clear()
        knownFacts.clear()
        exhausted = false
      }
      // Bounded reacquisition and split children have their own permission. A
      // previously requested identical range is not new successor work.
      if (
        opts.cursor !== null &&
        opts.endCursor == null &&
        !slots.some(
          (slot) => JSON.stringify(slot.opts) === JSON.stringify(opts),
        )
      ) {
        if (
          [...scopes.values()].every((scope) =>
            deliveredScopeComplete(
              [...delivered.values()],
              exhausted,
              scope,
              descending,
            ),
          )
        )
          throw new Error(`lazy work: unrelated successor ${opts.cursor}`)
        successorStarts++
      }
      const slot: Slot = { opts, callback, fail, active: true, revision: -1 }
      slots.push(slot)
      return Object.assign(
        () => {
          slot.active = false
        },
        { getCurrentValue: () => slot.current },
      )
    },
  } as ConvexCollectionClient
  // Keep retired watch callbacks callable. A retired error changes their old
  // cache to a throwing read; the React subscription must fence before reading.
  const reactClient = {
    watchQuery: (
      query: unknown,
      args: { paginationOpts: PaginationOptions },
    ) => {
      let listener: (() => void) | undefined
      let readError: unknown
      const subscription = (
        `onUpdate` in client ? client.onUpdate : undefined
      )!(
        query as typeof lazyQuery,
        args,
        () => listener?.(),
        (error: unknown) => {
          readError = error
          listener?.()
        },
      )
      const slot = slots.at(-1)!
      return {
        journal: () => undefined,
        onUpdate: (callback: () => void) => {
          listener = callback
          return subscription
        },
        localQueryResult: () => {
          if (!slot.active) obsoleteReads++
          if (readError) throw readError
          return subscription.getCurrentValue()
        },
      }
    },
  } as ConvexCollectionClient
  function result(slot: Slot): PaginationResult<LazyRow> {
    const from =
      slot.opts.cursor === null ? undefined : cursors.get(slot.opts.cursor)
    const to =
      slot.opts.endCursor == null ? undefined : cursors.get(slot.opts.endCursor)
    if (slot.opts.cursor !== null && !from)
      throw new Error(`unknown source cursor`)
    const interval = ordered(source, descending).filter(
      (row) =>
        (!from || compare(row, from) > 0) && (!to || compare(row, to) <= 0),
    )
    const page = to
      ? interval
      : interval.slice(
          0,
          short ? Math.max(1, slot.opts.numItems - 1) : slot.opts.numItems,
        )
    const boundary =
      slot.opts.endCursor ??
      (page.length ? token(page.at(-1)!) : (slot.opts.cursor ?? `empty`))
    const splitting = split !== `none` && page.length > 2
    return {
      page: splitting && split === `required` ? [] : page,
      continueCursor: boundary,
      isDone: !to && page.length === interval.length,
      ...(splitting
        ? {
            pageStatus:
              split === `required`
                ? (`SplitRequired` as const)
                : (`SplitRecommended` as const),
            splitCursor: token(page[Math.floor((page.length - 1) / 2)]!),
          }
        : {}),
    }
  }
  return {
    client: kind === `react` ? reactClient : client,
    slots,
    get obsoleteReads() {
      return obsoleteReads
    },
    scopes,
    get source() {
      return source
    },
    get successorStarts() {
      return successorStarts
    },
    get deliveredFacts() {
      return [...knownFacts.values()]
    },
    change(rows: Array<LazyRow>) {
      source = rows.map((row) => ({ ...row }))
      revision++
      delivered.clear()
      exhausted = false
    },
    disconnect() {
      online = false
    },
    reconnect() {
      online = true
    },
    // Install a coherent SDK cache revision while its callbacks remain queued.
    installCaches() {
      for (const slot of slots.filter((entry) => entry.active)) {
        slot.current = result(slot)
        if (slot.current.pageStatus !== `SplitRequired`)
          for (const row of slot.current.page) {
            delivered.set(row.id, row)
            knownFacts.set(JSON.stringify(row), { ...row })
          }
        if (slot.opts.endCursor == null && slot.current.isDone) exhausted = true
      }
    },
    error(error: unknown) {
      slots.find((slot) => slot.active)?.fail?.(error)
    },
    /** One selected callback, with every existing cache installed first. The
     * choice is an environment schedule, not a pager transition. */
    async deliver(choice = 0) {
      if (!online) return false
      this.installCaches()
      const pending = slots.filter(
        (slot) => slot.active && slot.revision !== revision,
      )
      const slot = pending[choice % pending.length]
      if (!slot) return false
      slot.revision = revision
      slot.callback(slot.current!)
      for (let i = 0; i < 10; i++) await Promise.resolve()
      return true
    },
    async pump(
      hold: (slot: Slot) => boolean = () => false,
      reverse = false,
      checkpoint?: () => void,
    ) {
      // This is a finite fixture guard, not a semantic progress or call cap.
      for (let turn = 0; turn < 200; turn++) {
        await Promise.resolve()
        await Promise.resolve()
        const pending = slots.filter(
          (slot) =>
            online && slot.active && slot.revision !== revision && !hold(slot),
        )
        if (!pending.length) {
          for (let i = 0; i < 10; i++) await Promise.resolve()
          checkpoint?.()
          if (
            !slots.some(
              (slot) =>
                online &&
                slot.active &&
                slot.revision !== revision &&
                !hold(slot),
            )
          )
            return
          continue
        }
        if (reverse) pending.reverse()
        for (const slot of pending) {
          slot.current = result(slot)
          slot.revision = revision
        }
        // Knowledge for work is only actual delivered complete results.
        for (const slot of pending) {
          if (slot.current!.pageStatus !== `SplitRequired`)
            for (const row of slot.current!.page) {
              delivered.set(row.id, row)
              knownFacts.set(JSON.stringify(row), { ...row })
            }
          if (slot.opts.endCursor == null && slot.current!.isDone)
            exhausted = true
        }
        for (const slot of pending) slot.callback(slot.current!)
        await Promise.resolve()
        checkpoint?.()
      }
      throw new Error(`lazy fixture nonquiescence (diagnostic guard)`)
    },
    late(outcome: `success` | `error` = `success`) {
      for (const slot of slots.filter((entry) => !entry.active))
        if (outcome === `error`)
          slot.fail?.(new Error(`obsolete provider error`))
        else
          slot.callback({
            page: [{ id: `obsolete`, rank: -100, text: `stale` }],
            isDone: true,
            continueCursor: `stale`,
          })
    },
  }
}

/** Test-driver observation of the real sync boundary. No pager state enters
 * the record: writes, replacement, run identity and actual application receipt.
 * Listeners run when commit returns. Causal receipt receivers use nonreentrant
 * commits; this record does not impose FIFO listener order on nested commits. */
export type LazyBatch = {
  id: string
  run: number
  rows: Array<LazyRow>
  deletes: Array<string>
  replacement: boolean
  receipt: SyncAppliedReceipt
}

export function lazyFixture(
  rows: Array<LazyRow>,
  pageSize: number,
  descending = false,
  split: `none` | `required` | `recommended` = `none`,
  short = false,
  holdCleanup?: () => Promise<void>,
  kind: `javascript` | `react` = `javascript`,
  adapterReceipt?: (actual: SyncAppliedReceipt) => SyncAppliedReceipt,
) {
  const remote = lazyProvider(rows, descending, split, short, kind)
  const mode = {
    syncMode: `on-demand`,
    queryOrder: { field: `rank`, direction: descending ? `desc` : `asc` },
  } as const
  const errors: Array<unknown> = []
  const statuses: Array<string> = []
  const options = convexPaginatedCollectionOptions({
    client: remote.client,
    query: lazyQuery,
    queryArgs: {},
    pageSize,
    getKey: (row) => row.id,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    gcTime: 0,
    onError: (error) => errors.push(error),
    ...mode,
  })
  const receipts: Array<SyncAppliedReceipt> = []
  const batches: Array<LazyBatch> = []
  let nextBatch = 0
  const batchListeners = new Set<(batch: LazyBatch) => void>()
  let syncRun = 0
  let truncateSource!: () => SyncAppliedReceipt
  const sync = options.sync.sync
  options.sync = {
    ...options.sync,
    sync: (controls) => {
      const run = ++syncRun
      // Environment input for the core replay receiver. Native Convex does not
      // initiate same-run truncates itself; this exposes the real core boundary.
      truncateSource = () => {
        controls.begin()
        controls.truncate()
        return controls.commit()
      }
      let pendingRows: Array<LazyRow> = []
      let deletes: Array<string> = []
      let replacement = false
      const running = sync({
        ...controls,
        begin: (...args) => {
          pendingRows = []
          deletes = []
          replacement = false
          controls.begin(...args)
        },
        write: (message) => {
          if (message.type === `delete`)
            deletes.push(
              String(`key` in message ? message.key : message.value.id),
            )
          else pendingRows.push({ ...message.value })
          controls.write(message)
        },
        truncate: () => {
          replacement = true
          controls.truncate()
        },
        commit: (signal) => {
          const payload = {
            id: `receipt-${nextBatch++}`,
            run,
            rows: pendingRows,
            deletes,
            replacement,
          }
          const receipt = controls.commit(signal)
          receipts.push(receipt)
          const batch = {
            ...payload,
            receipt,
          }
          batches.push(batch)
          for (const listener of batchListeners) listener(batch)
          // Hostile receiver controls may lie to the adapter while the observer
          // retains the actual core receipt and its true application boundary.
          return adapterReceipt ? adapterReceipt(receipt) : receipt
        },
      })
      if (!holdCleanup) return running
      return {
        ...(typeof running === `object` ? running : {}),
        cleanup: async () => {
          if (typeof running === `function`) await running()
          else await running?.cleanup?.()
          await holdCleanup()
        },
      }
    },
  }
  const source = createCollection(options)
  const publications: Array<{
    rows: Array<LazyRow>
    evidence: Array<LazyRow>
  }> = []
  const observer = source.subscribeChanges(
    () =>
      publications.push({
        rows: [...source.base.values()].map((row) => ({ ...row })),
        evidence: remote.deliveredFacts,
      }),
    { includeInitialState: false },
  )
  source.on(`status:change`, ({ status }) => statuses.push(status))
  source.startSyncImmediate()
  return {
    remote,
    source,
    receipts,
    batches,
    truncateSource: () => truncateSource(),
    observeBatches: (listener: (batch: LazyBatch) => void) => {
      batchListeners.add(listener)
      for (const batch of batches) listener(batch)
      return () => {
        batchListeners.delete(listener)
      }
    },
    errors,
    statuses,
    publications,
    stopObserving: () => observer.unsubscribe(),
    load(scope: LazyScope, signal?: AbortSignal, refetch = false) {
      const request = { ...lazyRequest(scope, descending), signal, refetch }
      remote.scopes.set(request, scope)
      // Abort revokes new-work permission without withdrawing accepted writes.
      if (signal?.aborted) remote.scopes.delete(request)
      else
        signal?.addEventListener(`abort`, () => remote.scopes.delete(request), {
          once: true,
        })
      const result = source._sync.loadSubset(request)
      let settled = result === true
      if (result !== true)
        void result.then(
          () => {
            settled = true
          },
          () => {
            settled = true
          },
        )
      return {
        // A responsive provider that has become quiescent must not strand a
        // request. Call only after draining it and releasing any receipt hold.
        complete: async () => {
          for (let i = 0; i < 10; i++) await Promise.resolve()
          if (!settled)
            throw new Error(
              `lazy progress: quiescent responsive provider left load pending`,
            )
          return result
        },
        request,
        result,
        release: () => {
          remote.scopes.delete(request)
          source._sync.unloadSubset(request)
        },
      }
    },
  }
}
