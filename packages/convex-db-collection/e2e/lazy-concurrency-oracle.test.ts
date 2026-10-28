/**
 * Real-backend receiving witness for the SAME LazyReceiptModel and
 * LazyVersionModel used by the controlled receivers. Authority: LoadSubsetFn,
 * signal and SyncAppliedReceipt in db/src/types.ts; fixed-query coherent SDK
 * snapshots and atomic publication. Facts/versions are authored here before
 * server mutations; real opaque cursors and SDK caches remain driver facts.
 *
 * Stable new facts uniquely identify the native batch establishing two callers.
 * A real optimistic transaction holds actual core application. Cancellation
 * cannot settle its accepted work early; a cached shallow caller may wait for
 * the deeper peer. Once the full finite relation applies, every subsequent base
 * publication must match a monotone authored revision, including two revisions
 * accepted while held and reader TCP loss while the writer advances.
 *
 * Grammar: 7..12 rows, page sizes 2..4, text, and reconnect supersession; every
 * history receives both real SDKs. Server updates change the complete relation
 * atomically, with stable keys/ranks. There are no controlled page responses or
 * invented receipts. Transport wrappers only observe genuine SDK reads.
 * Limits: no attribution of idempotent/superseding receipts, no accepted cleanup
 * abandonment, no same-run authoritative truncate or application failure. TCP
 * loss is a recoverable transport fault, not a promised provider-error callback.
 */
import { createCollection, createTransaction } from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import fc from 'fast-check'
import { expect, inject, it } from 'vitest'
import { convexPaginatedCollectionOptions } from '../src/index'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { oracleRuns } from '../../db/tests/oracle-config'
import { withTestCleanup } from '../tests/helpers'
import { lazyRequest } from '../tests/lazy-paging-driver'
import { assertLazySourceFacts } from '../tests/lazy-paging-model-oracle'
import { LazyReceiptModel } from '../tests/lazy-paging-receipt-model'
import { LazyVersionModel } from '../tests/lazy-paging-version-model-oracle'
import { createNetworkGate } from './network-gate'
import type { LazyRow } from '../tests/lazy-paging-model-oracle'
import type { ConvexCollectionClient } from '../src/index'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { PaginationOptions, PaginationResult } from 'convex/server'

type Task = { _id: string; clientId: string; rank: number; text: string }
const seed = makeFunctionReference<`mutation`, { count: number }, null>(
  `tasks:seed`,
)
const revise = makeFunctionReference<`mutation`, { text: string }, number>(
  `tasks:revise`,
)
const all = makeFunctionReference<`query`, {}, Array<Task>>(`tasks:all`)
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
const fact = (row: LazyRow) => JSON.stringify([row.id, row.rank, row.text])
const normalize = (rows: ReadonlyArray<LazyRow>) =>
  [...rows].sort((a, b) => a.rank - b.rank)
const turns = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
type History = {
  size: number
  pageSize: number
  text: string
  supersede: boolean
}
type Fault = `none` | `borrow-startup`

async function receive(
  h: History,
  kind: `javascript` | `react`,
  fault: Fault = `none`,
) {
  const gate = await createNetworkGate(inject(`convexUrl`))
  const writer = new ConvexClient(inject(`convexUrl`), {
    unsavedChangesWarning: false,
  })
  const reader =
    kind === `javascript`
      ? new ConvexClient(gate.url, { unsavedChangesWarning: false })
      : new ConvexReactClient(gate.url, { unsavedChangesWarning: false })
  const receipts = new LazyReceiptModel()
  const versions = new LazyVersionModel()
  const failures: Array<unknown> = []
  const evidence = new Map<string, LazyRow>()
  const appliedFacts = new Set<string>()
  const attempts = new Map<
    string,
    {
      missing: Set<string>
      active: boolean
      outcome?: `success` | `canceled` | `rejected`
    }
  >()
  const batches: Array<{
    id: string
    facts: Array<string>
    owners: Array<string>
    held: boolean
    applied: boolean
  }> = []
  const requests: Array<LoadSubsetOptions> = []
  const authored = (revision: number): Array<LazyRow> =>
    Array.from({ length: h.size }, (_, rank) => ({
      id: String(rank),
      rank,
      text: revision === 0 ? `task ${rank}` : `${h.text}:revision-${revision}`,
    }))
  const inspect = (value: unknown) => {
    const result = value as PaginationResult<Task>
    if (result.pageStatus !== `SplitRequired`)
      for (const row of result.page) {
        const observed = project(row)
        evidence.set(fact(observed), observed)
      }
  }
  const transport: ConvexCollectionClient =
    `onUpdate` in reader
      ? {
          onUpdate: (fn, args, callback, onError) => {
            const subscription = reader.onUpdate(
              fn,
              args,
              (value) => {
                inspect(value)
                callback(value)
              },
              onError,
            )
            return Object.assign(() => subscription(), {
              unsubscribe: () => subscription(),
              getCurrentValue: () => {
                const value = subscription.getCurrentValue()
                if (value !== undefined) inspect(value)
                return value
              },
            })
          },
        }
      : {
          watchQuery: (fn, args, options) => {
            const watch = reader.watchQuery(fn, args, options)
            return {
              ...watch,
              localQueryResult: () => {
                const value = watch.localQueryResult()
                if (value !== undefined) inspect(value)
                return value
              },
            }
          },
        }
  const options = convexPaginatedCollectionOptions({
    client: transport,
    query,
    queryArgs: {},
    syncMode: `on-demand`,
    queryOrder: { field: `rank`, direction: `asc` },
    pageSize: h.pageSize,
    getKey: (row) => row.clientId,
    gcTime: 0,
  })
  let nextBatch = 0
  const sync = options.sync.sync
  options.sync = {
    ...options.sync,
    sync: (controls) => {
      let pending: Array<LazyRow> = []
      return sync({
        ...controls,
        begin: (...args) => {
          pending = []
          controls.begin(...args)
        },
        write: (message) => {
          if (message.type !== `delete`) pending.push(project(message.value))
          controls.write(message)
        },
        commit: (signal) => {
          const values = pending
          const id = `batch-${nextBatch++}`
          const actual = controls.commit(signal)
          const owners = [...attempts].filter(
            ([, attempt]) =>
              attempt.active &&
              values.some((row) => attempt.missing.has(fact(row))),
          )
          for (const [, attempt] of owners)
            for (const row of values) attempt.missing.delete(fact(row))
          const batch = {
            id,
            facts: values.map(fact),
            owners: owners.map(([owner]) => owner),
            held: actual !== true,
            applied: false,
          }
          batches.push(batch)
          try {
            receipts.accept(id, batch.facts, batch.owners)
          } catch (error) {
            failures.push(error)
          }
          const apply = () => {
            try {
              // Application comes from the actual receipt. A newer FIFO batch can
              // already be public before this .then executes; event monitoring
              // judges version visibility rather than rereading an old row here.
              receipts.apply(id)
              batch.applied = true
              for (const value of batch.facts) appliedFacts.add(value)
            } catch (error) {
              failures.push(error)
            }
          }
          if (actual === true) apply()
          else void actual.then(apply, (error: unknown) => failures.push(error))
          return fault === `borrow-startup` ? true : actual
        },
      })
    },
  }
  const source = createCollection(options)
  let versionActive = false
  const publicationRevisions = new Set<string>()
  const callbackSnapshots = new Set<string>()
  const observe = () => {
    if (!versionActive) return
    const rows = [...source.base.values()].map(project)
    try {
      assertLazySourceFacts(rows, [...evidence.values()])
      versions.observe(rows)
      if (rows.length) publicationRevisions.add(rows[0]!.text)
    } catch (error) {
      failures.push(error)
    }
  }
  const observer = source.subscribeChanges(
    () => {
      if (versionActive)
        callbackSnapshots.add(
          JSON.stringify(normalize([...source.base.values()].map(project))),
        )
      observe()
    },
    {
      includeInitialState: false,
    },
  )
  const checkpoint = () => {
    if (failures.length) throw failures[0]
  }
  const load = (
    id: string,
    required: Array<LazyRow>,
    limit: number,
    signal?: AbortSignal,
  ) => {
    const facts = required.map(fact)
    receipts.acquire(id, facts)
    const attempt = {
      missing: new Set(facts.filter((value) => !appliedFacts.has(value))),
      active: true,
      outcome: undefined as `success` | `canceled` | `rejected` | undefined,
    }
    attempts.set(id, attempt)
    const request = { ...lazyRequest({ limit }), signal }
    requests.push(request)
    const result = source._sync.loadSubset(request)
    const outcome = (value: `success` | `canceled` | `rejected`) => {
      attempt.outcome = value
      attempt.active = false
      try {
        receipts.observe(id, value)
      } catch (error) {
        failures.push(error)
      }
    }
    void Promise.resolve(result).then(
      () => outcome(`success`),
      (error: unknown) =>
        outcome(
          error instanceof Error && error.name === `AbortError`
            ? `canceled`
            : `rejected`,
        ),
    )
    return attempt
  }
  const waitFor = async (predicate: () => boolean) => {
    // A retained semantic violation must win over an environmental predicate
    // that can no longer become true under the faulty implementation.
    await expect
      .poll(() => failures.length > 0 || predicate(), {
        timeout: 10000,
        interval: 10,
      })
      .toBe(true)
    await turns()
    checkpoint()
  }
  let release = () => {}
  let persisted: Promise<unknown> | undefined
  let holdNumber = 0
  const hold = () => {
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    const transaction = createTransaction({ mutationFn: () => promise })
    const clientId = `overlay-${holdNumber++}`
    transaction.mutate(() =>
      source.insert({
        _id: clientId,
        clientId,
        rank: 10000,
        text: `optimistic`,
      }),
    )
    persisted = transaction.when('settled')
  }
  const drain = async () => {
    release()
    await persisted
    await turns()
    checkpoint()
  }
  const reaches = new Set<string>()
  await withTestCleanup(
    async () => {
      await writer.mutation(seed, { count: h.size })
      expect(normalize((await writer.query(all, {})).map(project))).toEqual(
        authored(0),
      )
      source.startSyncImmediate()
      const warm = load(`warm`, authored(0).slice(0, 1), 1)
      await waitFor(() => warm.outcome !== undefined)
      expect(warm.outcome).toBe(`success`)
      expect(source.base.size).toBeLessThan(h.size)
      hold()
      const controller = new AbortController()
      const a = load(`a`, authored(0), h.size, controller.signal)
      const peer = load(`peer`, authored(0), h.size)
      await waitFor(
        () =>
          batches.some(
            (batch) =>
              batch.held &&
              batch.owners.includes(`a`) &&
              batch.owners.includes(`peer`),
          ) &&
          a.missing.size === 0 &&
          peer.missing.size === 0,
      )
      reaches.add(`real-shared-held-receipt`)
      const cached = load(`cached`, authored(0).slice(0, 1), 1)
      receipts.abort(`a`)
      a.active = false
      controller.abort()
      await turns()
      checkpoint()
      expect(
        a.outcome,
        `backend canceled caller escaped held receipt`,
      ).toBeUndefined()
      expect(peer.outcome, `backend peer escaped held receipt`).toBeUndefined()
      expect(batches.flatMap((batch) => batch.owners)).not.toContain(`cached`)
      reaches.add(`real-canceled-held`)
      await drain()
      await waitFor(
        () =>
          a.outcome !== undefined &&
          peer.outcome !== undefined &&
          cached.outcome !== undefined,
      )
      expect(a.outcome).toBe(`canceled`)
      expect(peer.outcome).toBe(`success`)
      expect(cached.outcome).toBe(`success`)
      receipts.complete()
      reaches.add(`real-cached-peer-drain`)
      versions.offer(authored(0))
      versionActive = true
      observe()
      checkpoint()
      hold()
      const acceptRevision = async (revision: number) => {
        const rows = authored(revision)
        versions.offer(rows)
        expect(await writer.mutation(revise, { text: rows[0]!.text })).toBe(
          h.size,
        )
        await waitFor(() =>
          rows.some((row) =>
            batches.some((batch) => batch.facts.includes(fact(row))),
          ),
        )
      }
      const before = batches.length
      await acceptRevision(1)
      await acceptRevision(2)
      expect(batches.length - before).toBeGreaterThanOrEqual(2)
      expect(batches.slice(before).every((batch) => batch.held)).toBe(true)
      expect(normalize([...source.base.values()].map(project))).toEqual(
        authored(0),
      )
      reaches.add(`real-two-revisions-held`)
      await drain()
      await waitFor(
        () =>
          JSON.stringify(normalize([...source.base.values()].map(project))) ===
          JSON.stringify(authored(2)),
      )
      observe()
      checkpoint()
      expect(
        callbackSnapshots.has(JSON.stringify(authored(2))),
        `backend version: held revision never reached the publication callback`,
      ).toBe(true)
      gate.disconnect()
      const latest = h.supersede ? 4 : 3
      for (let revision = 3; revision <= latest; revision++) {
        const rows = authored(revision)
        versions.offer(rows)
        expect(await writer.mutation(revise, { text: rows[0]!.text })).toBe(
          h.size,
        )
      }
      expect(normalize([...source.base.values()].map(project))).toEqual(
        authored(2),
      )
      gate.reconnect()
      await waitFor(
        () =>
          JSON.stringify(normalize([...source.base.values()].map(project))) ===
          JSON.stringify(authored(latest)),
      )
      observe()
      checkpoint()
      receipts.complete()
      expect(
        callbackSnapshots.has(JSON.stringify(authored(latest))),
        `backend version: reconnected revision never reached the publication callback`,
      ).toBe(true)
      expect(normalize((await writer.query(all, {})).map(project))).toEqual(
        authored(latest),
      )
      expect(publicationRevisions.size).toBeGreaterThan(1)
      reaches.add(`real-monotone-publications`)
      reaches.add(`real-reconnect-latest`)
      console.info(
        `CONVEX_BACKEND_CONCURRENCY ${JSON.stringify({ kind, size: h.size, pageSize: h.pageSize, batches: batches.length, publications: [...publicationRevisions], reaches: [...reaches] })}`,
      )
    },
    () => {
      versionActive = false
      observer.unsubscribe()
      for (const request of requests) source._sync.unloadSubset(request)
    },
    async () => {
      release()
      await persisted
    },
    () => source.cleanup(),
    () => reader.close(),
    () => writer.close(),
    () => gate.close(),
  )
  return reaches
}

it(`receives receipt and version laws through both real SDKs and backend`, async () => {
  await runOracleCampaign(
    `CONVEX_BACKEND_CONCURRENCY_ORACLE`,
    [
      `real-shared-held-receipt`,
      `real-canceled-held`,
      `real-cached-peer-drain`,
      `real-two-revisions-held`,
      `real-monotone-publications`,
      `real-reconnect-latest`,
      `javascript`,
      `react`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(
          fc.record({
            size: fc.integer({ min: 7, max: 12 }),
            pageSize: fc.integer({ min: 2, max: 4 }),
            text: fc.string({ maxLength: 6 }),
            supersede: fc.boolean(),
          }),
          async (h) => {
            reach.beginHistory()
            const fault = process.env.CONVEX_BACKEND_CONCURRENCY_FAULT
            if (fault !== undefined && fault !== `borrow-startup`)
              throw new Error(`invalid backend concurrency fault`)
            const errors: Array<unknown> = []
            for (const kind of [`javascript`, `react`] as const) {
              try {
                const observed = await receive(h, kind, fault)
                for (const state of [
                  `real-shared-held-receipt`,
                  `real-canceled-held`,
                  `real-cached-peer-drain`,
                  `real-two-revisions-held`,
                  `real-monotone-publications`,
                  `real-reconnect-latest`,
                ] as const) {
                  expect(observed.has(state)).toBe(true)
                  reach.reach(state)
                }
                reach.reach(kind)
              } catch (error) {
                errors.push(error)
                console.info(
                  `CONVEX_BACKEND_RECEIVER_FAILURE ${JSON.stringify({ kind, error: String(error) })}`,
                )
              }
            }
            if (errors.length)
              throw new AggregateError(
                errors,
                `backend receiver comparison failures`,
                { cause: errors[0] },
              )
          },
        ),
        { numRuns: oracleRuns(4), ...parameters },
      ),
    { fixedSeed: 20261028 },
  )
}, 120000)
