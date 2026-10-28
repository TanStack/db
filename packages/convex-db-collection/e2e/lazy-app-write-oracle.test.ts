/**
 * Application handlers, remote truth and promised windows must agree after a
 * confirmed write. A rejected atomic backend write changes neither source
 * truth nor the final window. LazyWriteModel owns the ledger and the coherent
 * source/window/optimistic publication relation, using expectedLazyRows. No backend
 * read supplies an expected row. Both real SDKs receive each generated history.
 *
 * The constructive prefix grows demand while an actual app insert persists,
 * witnesses a held core receipt, then confirms the write. A shuffled suffix
 * receives rejected insert and successful/rejected update/delete. Each handler
 * is held before the server call and after its response. Independent remote
 * edits occur during the optimistic operation. Immediate reads, every graph
 * publication, backend rows and drained windows are separate observations.
 *
 * Grammar: 12–16 rows, page sizes 2–3, windows 2 then 5–6, short Unicode text,
 * six operation/outcome cells and their suffix order. Removing rejection loses
 * atomic rollback; removing growth loses application/acquisition overlap;
 * removing the independent ledger lets backend and adapter share lost writes.
 * Limits: ascending unique ranks, one app operation at a time, finite responsive
 * schedules, no reload/new health API, rich values or arbitrary reentry.
 */
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
} from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import fc from 'fast-check'
import { expect, inject, it } from 'vitest'
import { convexPaginatedCollectionOptions } from '../src/index'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { withTestCleanup } from '../tests/helpers'
import { lazyOracleRuns, receiveBothSdks } from '../tests/lazy-paging-campaign'
import { LazyWriteModel } from '../tests/lazy-paging-write-model-oracle'
import type { LazyRow } from '../tests/lazy-paging-model-oracle'
import type { ConvexCollectionClient } from '../src/index'
import type { PaginationOptions, PaginationResult } from 'convex/server'

type Task = { _id: string; clientId: string; rank: number; text: string }
type Kind = `insert` | `update` | `delete`
type Cell = { kind: Kind; rejected: boolean }
const seed = makeFunctionReference<`mutation`, { count: number }, null>(
  `tasks:seed`,
)
const all = makeFunctionReference<`query`, {}, Array<Task>>(`tasks:all`)
const reshape = makeFunctionReference<
  `mutation`,
  {
    changes: Array<{
      clientId: string
      rank: number
      text: string
      remove?: boolean
    }>
    reject?: boolean
  },
  null
>(`tasks:reshape`)
const query = makeFunctionReference<
  `query`,
  { paginationOpts: PaginationOptions },
  PaginationResult<Task>
>(`tasks:list`)
const project = (row: Task): LazyRow => ({
  id: row.clientId,
  rank: row.rank,
  text: row.text,
})
const signature = (rows: ReadonlyArray<LazyRow>) =>
  JSON.stringify(rows.map(({ id, rank, text }) => ({ id, rank, text })))
const gate = () => {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
const cells: Array<Cell> = [
  { kind: `insert`, rejected: true },
  { kind: `update`, rejected: false },
  { kind: `update`, rejected: true },
  { kind: `delete`, rejected: false },
  { kind: `delete`, rejected: true },
]
const grammar = fc.record({
  size: fc.integer({ min: 12, max: 16 }),
  pageSize: fc.integer({ min: 2, max: 3 }),
  width: fc.integer({ min: 5, max: 6 }),
  text: fc.string({ maxLength: 10 }),
  suffix: fc.shuffledSubarray(cells, {
    minLength: cells.length,
    maxLength: cells.length,
  }),
})
type History = typeof grammar extends fc.Arbitrary<infer T> ? T : never

async function receive(h: History, sdk: `javascript` | `react`) {
  const writer = new ConvexClient(inject(`convexUrl`), {
    unsavedChangesWarning: false,
  })
  const reader =
    sdk === `javascript`
      ? new ConvexClient(inject(`convexUrl`), { unsavedChangesWarning: false })
      : new ConvexReactClient(inject(`convexUrl`), {
          unsavedChangesWarning: false,
        })
  // Real SDK caches advance normally. Delay only their notifications so a
  // successful handler must read current caches before acknowledging the app.
  let notificationsHeld = false
  const notifications: Array<() => void> = []
  const notify = (callback: () => void) => {
    if (notificationsHeld) notifications.push(callback)
    else callback()
  }
  const releaseNotifications = () => {
    notificationsHeld = false
    for (const callback of notifications.splice(0)) callback()
  }
  const transport: ConvexCollectionClient =
    `onUpdate` in reader
      ? {
          onUpdate: (fn, args, callback, onError) => {
            const subscription = reader.onUpdate(
              fn,
              args,
              (value) => notify(() => callback(value)),
              onError,
            )
            return Object.assign(() => subscription(), {
              unsubscribe: () => subscription(),
              getCurrentValue: () => subscription.getCurrentValue(),
            })
          },
        }
      : {
          watchQuery: (fn, args, options) => {
            const watch = reader.watchQuery(fn, args, options)
            return {
              ...watch,
              onUpdate: (callback) => watch.onUpdate(() => notify(callback)),
            }
          },
        }
  const model = new LazyWriteModel(
    Array.from({ length: h.size }, (_, rank) => ({
      id: String(rank),
      rank,
      text: `task ${rank}`,
    })),
    { limit: 2 },
  )
  const failures: Array<unknown> = []
  const reaches = new Set<string>()
  let scope = { limit: 2 }
  let monitor = false
  let heldReceipts = 0
  let plan:
    | {
        cell: Cell
        row: LazyRow
        before: ReturnType<typeof gate>
        after: ReturnType<typeof gate>
        entered: ReturnType<typeof gate>
        server: ReturnType<typeof gate>
        error?: unknown
      }
    | undefined
  const handler =
    (kind: Kind) =>
    async ({
      transaction,
    }: {
      transaction: { mutations: ReadonlyArray<{ modified: Task }> }
    }) => {
      const active = plan!
      try {
        expect(kind).toBe(active.cell.kind)
        expect(transaction.mutations).toHaveLength(1)
        expect(project(transaction.mutations[0]!.modified)).toEqual(active.row)
      } catch (error) {
        failures.push(error)
        active.entered.resolve()
        throw error
      }
      active.entered.resolve()
      await active.before.promise
      try {
        await reader.mutation(reshape, {
          changes: [
            {
              clientId: active.row.id,
              rank: active.row.rank,
              text: active.row.text,
              ...(kind === `delete` ? { remove: true } : {}),
            },
          ],
          reject: active.cell.rejected,
        })
      } catch (error) {
        active.error = error
      }
      active.server.resolve()
      await active.after.promise
      if (active.error) throw active.error
    }
  const options = convexPaginatedCollectionOptions({
    client: transport,
    query,
    queryArgs: {},
    syncMode: `on-demand`,
    queryOrder: { field: `rank`, direction: `asc` },
    pageSize: h.pageSize,
    getKey: (row) => row.clientId,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    gcTime: 0,
    onInsert: handler(`insert`),
    onUpdate: handler(`update`),
    onDelete: handler(`delete`),
  })
  const sync = options.sync.sync
  options.sync = {
    ...options.sync,
    sync: (controls) =>
      sync({
        ...controls,
        commit: (signal) => {
          const receipt = controls.commit(signal)
          if (receipt !== true) {
            heldReceipts++
            void receipt.catch((error: unknown) => failures.push(error))
          }
          return receipt
        },
      }),
  }
  const source = createCollection(options)
  const graph = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .orderBy(({ row }) => row.rank, `asc`)
      .limit(scope.limit)
      .select(({ row }) => ({
        id: row.clientId,
        rank: row.rank,
        text: row.text,
      })),
  )
  const observe = () => {
    if (!monitor) return
    try {
      model.observeWindow(graph.toArray)
    } catch (error) {
      failures.push(error)
    }
  }
  let observer: { unsubscribe: () => void } | undefined
  const stopStatus = graph.on(`status:change`, observe)
  const check = () => {
    if (failures.length) throw failures[0]
  }
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 10000
    while (!predicate()) {
      check()
      if (Date.now() > deadline)
        throw new Error(`app write receiving checkpoint not reached`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    check()
  }
  const backend = async () => {
    const actual = (await writer.query(all, {})).map(project)
    check()
    model.assertBackend(actual)
  }
  const quiet = async () => {
    await waitFor(
      () => signature(graph.toArray) === signature(model.window(scope)),
    )
    model.observeWindow(graph.toArray)
    await backend()
    expect(source.utils.getSyncError()).toBeUndefined()
    expect(graph.status).toBe(`ready`)
    check()
  }
  const persisted: Array<Promise<unknown>> = []
  let growth: Promise<unknown> | undefined
  await withTestCleanup(
    async () => {
      await writer.mutation(seed, { count: h.size })
      observer = graph.subscribeChanges(observe, { includeInitialState: false })
      await graph.preload()
      monitor = true
      await quiet()
      expect(source.base.size).toBeLessThan(h.size)
      reaches.add(`partial-source`)
      const sequence = [
        { kind: `insert` as const, rejected: false },
        ...h.suffix,
      ]
      for (const [index, cell] of sequence.entries()) {
        const previous = model.rows()
        const target = model.window(scope)[0]!
        const row =
          cell.kind === `insert`
            ? {
                id: `app-${index}`,
                rank: -20 - index,
                text: `${h.text}:app-${index}`,
              }
            : cell.kind === `update`
              ? { ...target, rank: -20 - index, text: `${h.text}:app-${index}` }
              : target
        const change = {
          id: row.id,
          ...(cell.kind === `delete` ? {} : { row }),
        }
        model.begin(change)
        plan = {
          cell,
          row,
          before: gate(),
          after: gate(),
          entered: gate(),
          server: gate(),
        }
        const transaction =
          cell.kind === `insert`
            ? source.insert({
                _id: `optimistic-${index}`,
                clientId: row.id,
                rank: row.rank,
                text: row.text,
              })
            : cell.kind === `delete`
              ? source.delete(row.id)
              : source.update(row.id, (draft) => {
                  draft.rank = row.rank
                  draft.text = row.text
                })
        const result = transaction.when('settled')
        void result.catch(() => undefined)
        persisted.push(result)
        // The direct Collection read is synchronous; graph propagation has its
        // own publication boundary and is checked by the version monitor.
        expect(
          source.get(row.id) ? project(source.get(row.id)!) : undefined,
        ).toEqual(cell.kind === `delete` ? undefined : row)
        await plan.entered.promise
        check()
        model.assertBackend((await writer.query(all, {})).map(project))
        expect(model.rows()).toEqual(previous)
        const remote = {
          id: String(h.size - 1),
          rank: h.size - 1,
          text: `${h.text}:remote-${index}`,
        }
        const visibleRemote = {
          ...model.window(scope).at(-1)!,
          text: `${h.text}:visible-remote-${index}`,
        }
        expect(visibleRemote.id).not.toBe(row.id)
        model.remote([
          { id: remote.id, row: remote },
          { id: visibleRemote.id, row: visibleRemote },
        ])
        await writer.mutation(reshape, {
          changes: [
            { clientId: remote.id, rank: remote.rank, text: remote.text },
            {
              clientId: visibleRemote.id,
              rank: visibleRemote.rank,
              text: visibleRemote.text,
            },
          ],
        })
        await backend()
        reaches.add(`remote-during-app`)
        reaches.add(`visible-remote-during-app`)
        if (index === 0) {
          const before = heldReceipts
          scope = { limit: h.width }
          model.moveWindow(scope)
          let settled = false
          growth = Promise.resolve(graph.utils.setWindow(scope))
          void growth.then(
            () => {
              settled = true
            },
            () => {
              settled = true
            },
          )
          await waitFor(() => heldReceipts > before)
          expect(
            settled,
            `demand growth escaped a persisting app handler`,
          ).toBe(false)
          reaches.add(`growth-behind-app-receipt`)
        }
        if (!cell.rejected) model.offerConfirmation()
        notificationsHeld = true
        plan.before.resolve()
        await plan.server.promise
        expect(Boolean(plan.error)).toBe(cell.rejected)
        model.acknowledge(!cell.rejected)
        await backend()
        model.startSettlement()
        plan.after.resolve()
        if (cell.rejected)
          await expect(result).rejects.toThrow(`oracle rejected app write`)
        else await result
        model.finishSettlement()
        const settledRow = model.rows().find((value) => value.id === row.id)
        expect(
          source.get(row.id) ? project(source.get(row.id)!) : undefined,
          `app write law: source differs at application settlement`,
        ).toEqual(settledRow)
        if (!cell.rejected) {
          expect(
            notifications.length,
            `SDK notification-delay premise absent`,
          ).toBeGreaterThan(0)
          reaches.add(`cached-confirmation-before-notification`)
        }
        releaseNotifications()
        if (growth) {
          await growth
          growth = undefined
        }
        await quiet()
        reaches.add(`${cell.kind}:${cell.rejected ? `rejected` : `confirmed`}`)
      }
      expect(source.base.size).toBeLessThan(model.rows().length)
      reaches.add(`unread-tail-after-writes`)
    },
    () => {
      plan?.before.resolve()
      plan?.after.resolve()
      releaseNotifications()
    },
    () => Promise.allSettled(persisted),
    () => {
      monitor = false
      observer?.unsubscribe()
      stopStatus()
    },
    () => graph.cleanup(),
    () => source.cleanup(),
    () => reader.close(),
    () => writer.close(),
  )
  return reaches
}

const states = [
  `partial-source`,
  `remote-during-app`,
  `visible-remote-during-app`,
  `cached-confirmation-before-notification`,
  `growth-behind-app-receipt`,
  `unread-tail-after-writes`,
  `insert:confirmed`,
  `insert:rejected`,
  `update:confirmed`,
  `update:rejected`,
  `delete:confirmed`,
  `delete:rejected`,
  `javascript`,
  `react`,
] as const
it(`receives app confirmations and atomic rejection on both sides during lazy acquisition`, async () => {
  await runOracleCampaign(
    `CONVEX_LAZY_APP_ORACLE`,
    states,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(grammar, async (h) => {
          reach.beginHistory()
          for (const [sdk, observed] of await receiveBothSdks((kind) =>
            receive(h, kind),
          )) {
            for (const state of states)
              if (observed.has(state)) reach.reach(state)
            reach.reach(sdk)
          }
        }),
        { numRuns: lazyOracleRuns(4), ...parameters },
      ),
    { fixedSeed: 20261030 },
  )
}, 120000)
