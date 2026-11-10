/**
 * # How do retained rows and late results cross an ownership boundary?
 *
 * An older fetch supplies untouched keys while a later accepted direct write
 * supplies its own key. A superseded application cannot publish after its
 * successor or fulfill its retired caller. The retained-baseline work rule is
 * bounded: one unchanged sync run reuses established empty-baseline evidence;
 * a cold run must check for durable owners committed while it was absent.
 * These retain the original overlay law, result-settlement contract and
 * explicitly bounded work proposal from the ownership oracle.
 *
 * Independent models use keyed overlay, a call ledger and a one-bit empty
 * baseline history. Seven finite histories drive real QueryClient, Collection
 * and controlled persistence paths. Every original public, durable, cache,
 * publication and scan-count cut is recorded. They make no claim about native
 * SQLite failure, arbitrary peer writes or a global scan complexity bound.
 */
import { hashKey } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { afterEach, vi } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'

import { createDeferred } from '../../db/src/deferred.js'
import { queryCollectionOptions } from '../src/query.js'
import {
  observeExplicitRefetchApplication,
  reduceExplicitRefetchApplication,
} from './ownership-model-oracle'
import { mergeDirectWritesOverFetch } from './direct-write-precedence-oracle.js'
import {
  cleanups,
  createOwnershipFixture,
  createOwnershipStorage,
  createPersistedOwnershipFixture,
  createQueryClient,
  itemIds,
  rows,
  runCleanups,
  shared,
  storedItems,
} from './ownership-lifecycle-support.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'
import type { ExplicitRefetchApplicationModel } from './ownership-model-oracle'
import type { Item } from './ownership-lifecycle-support.js'

function diagnosticField(
  error: unknown,
  field: 'name' | 'message',
): string | undefined {
  if (typeof error !== 'object' || error === null || !(field in error))
    return undefined
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}
afterEach(runCleanups)
type RecordFact = (checkpoint: string, value: unknown) => void

/** Wait for a production boundary without computing an expected row. If the
 * boundary does not arrive, record the last fact and return; the property's
 * check identifies that cut rather than losing the mismatch to a setup error. */
async function boundary(test: () => boolean): Promise<boolean> {
  for (let turn = 0; turn < 200; turn++) {
    if (test()) return true
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  return test()
}

/** Domain checks retain every observation cut in the old driver. No expected
 * value is recorded by a production callback: models build the owed facts
 * from authored history data, and this check compares the ordered trace. */
function checkCuts(
  actual: ReadonlyArray<Observation>,
  expected: ReadonlyArray<Observation>,
  law: string,
): Verdict {
  for (let i = 0; i < expected.length; i++) {
    const wanted = expected[i]!
    const got = actual[i]
    if (!got)
      return violation(
        wanted.checkpoint,
        'the promised observation cut was not reached',
        law,
      )
    const difference = differs(wanted.checkpoint, law, got, wanted)
    if (difference) return difference
  }
  return differs('trace-length', law, actual.length, expected.length) ?? pass
}

async function observeBoundary<T>(
  observe: RecordFact,
  checkpoint: string,
  read: () => T,
  ready: (value: T) => boolean,
): Promise<boolean> {
  const reached = await boundary(() => ready(read()))
  observe(checkpoint, read())
  return reached
}
async function settle<T>(
  promise: PromiseLike<T>,
): Promise<
  { outcome: 'resolved'; value: T } | { outcome: 'rejected'; error: unknown }
> {
  try {
    return { outcome: 'resolved', value: await promise }
  } catch (error) {
    return { outcome: 'rejected', error }
  }
}

type MergeCut =
  | 'initial-load'
  | 'handler-refetch-other-key'
  | 'handler-refetch-same-key'
  | 'user-refetch'
const mergeCuts: Array<MergeCut> = [
  'initial-load',
  'handler-refetch-other-key',
  'handler-refetch-same-key',
  'user-refetch',
]
/** The original keyed overlay model judges source keys and later direct keys.
 * It uses authored source snapshots; it reads neither cache nor Collection. */
function mergeCutModel(cut: MergeCut): Array<Observation> {
  const fetched =
    cut === 'initial-load'
      ? [
          { id: '1', value: 'a' },
          { id: '2', value: 'b' },
        ]
      : cut === 'user-refetch'
        ? [
            { id: '1', value: 'new1' },
            { id: '2', value: 'new2' },
          ]
        : [
            { id: '1', value: 'A' },
            { id: '2', value: 'old2' },
          ]
  const written =
    cut === 'initial-load' || cut === 'user-refetch'
      ? { id: '3', value: 'c' }
      : { id: cut === 'handler-refetch-same-key' ? '1' : '2', value: 'B' }
  const expected = mergeDirectWritesOverFetch(fetched, [written])
  return [
    { checkpoint: 'held-fetches', value: 1 },
    ...(cut === 'initial-load'
      ? [{ checkpoint: 'pending-status', value: 'pending' }]
      : []),
    ...(cut === 'user-refetch'
      ? [{ checkpoint: 'waiter-visible', value: expected }]
      : []),
    { checkpoint: 'visible', value: expected },
    { checkpoint: 'cache', value: expected },
  ]
}
/** Empty-baseline evidence belongs to one sync run. Each emitted result and
 * restart below is an authored action, not a production scan classifier. */
const expectedEmptyBaselineScans = (
  history: ReadonlyArray<'empty-result' | 'restart'>,
): number => {
  let scans = 0,
    known = false
  for (const action of history) {
    if (action === 'restart') known = false
    else if (!known) {
      scans++
      known = true
    }
  }
  return scans
}
function emptyBaselineModel(): Array<Observation> {
  const history: Array<'empty-result' | 'restart'> = []
  const expected: Array<Observation> = []
  for (let i = 0; i < 3; i++) {
    history.push('empty-result')
    expected.push({
      checkpoint: 'baseline:' + i,
      value: { rows: [], scans: expectedEmptyBaselineScans(history) },
    })
  }
  return [...expected, { checkpoint: 'query-calls', value: 3 }]
}
function coldBaselineModel(): Array<Observation> {
  return [
    { checkpoint: 'hot-storage', value: [] },
    {
      checkpoint: 'cold-baseline',
      value: {
        queryCalls: 1,
        rows: [],
        stored: [],
        scans: expectedEmptyBaselineScans(['restart', 'empty-result']),
      },
    },
  ]
}
function supersededModel(): Array<Observation> {
  let model: ExplicitRefetchApplicationModel = {
    calls: new Map(),
    publicValues: new Map([['query', 'none']]),
  }
  for (const [callId, name] of [
    [1, 'First'],
    [2, 'Second'],
  ] as const) {
    model = reduceExplicitRefetchApplication(model, {
      type: 'start-call',
      callId,
      resultIds: ['query'],
      throwOnError: true,
    })
    model = reduceExplicitRefetchApplication(model, {
      type: 'accept-result',
      callId,
      resultId: 'query',
      value: name,
    })
  }
  model = reduceExplicitRefetchApplication(model, {
    type: 'retire-application',
    callId: 1,
    resultId: 'query',
  })
  model = reduceExplicitRefetchApplication(model, {
    type: 'fulfill-application',
    callId: 2,
    resultId: 'query',
  })
  return [
    { checkpoint: 'initial-scans', value: 1 },
    { checkpoint: 'initial-queries', value: 1 },
    { checkpoint: 'first-work', value: { queries: 2, scans: 2 } },
    { checkpoint: 'successor-applied', value: { queries: 3, name: 'Second' } },
    {
      checkpoint: 'successor',
      value: observeExplicitRefetchApplication(model, 2),
    },
    {
      checkpoint: 'retired-error',
      value: { outcome: 'rejected', name: 'AbortError' },
    },
    {
      checkpoint: 'retired',
      value: observeExplicitRefetchApplication(model, 1),
    },
    { checkpoint: 'final-rows', value: ['second'] },
  ]
}
function supersededCheck(
  _h: unknown,
  trace: ReadonlyArray<Observation>,
  expected: ReadonlyArray<Observation>,
): Verdict {
  const ordinary = checkCuts(
    trace.slice(0, -1),
    expected,
    'accepted result supersession',
  )
  if (ordinary.kind === 'violation') return ordinary
  const last = trace.at(-1)
  if (last?.checkpoint !== 'publications')
    return violation(
      'publications',
      'publication trace missing',
      'accepted result supersession',
    )
  const publications = last.value as Array<Array<string>>
  const obsolete = publications.filter(
    (keys) =>
      keys.length === 1 && (keys[0] === 'initial' || keys[0] === 'first'),
  )
  return (
    differs('publications', 'accepted result supersession', obsolete, []) ??
    pass
  )
}

declareOracle({
  owns: [`src/query.ts#queryCollectionOptions`],
  model: [
    mergeCutModel,
    emptyBaselineModel,
    coldBaselineModel,
    supersededModel,
  ],
  check: [checkCuts, supersededCheck],
})
oracleProperty({
  id: 'query-db.ownership.older-fetch-merge',
  law: {
    statement:
      'keeps server rows a direct write did not touch when an older fetch settles: %s',
    authority:
      'docs/collections/query-collection.md#direct-writes-and-query-sync and existing ownership retention/result-settlement contracts.',
    limits:
      'Original finite history and every retained work/cache/publication checkpoint; controlled persistence rather than native SQLite.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: mergeCuts,
  model: mergeCutModel,
  driver: async (cut, observe) => {
    try {
      type Row = { id: string; value: string }
      const id = `older-fetch-merge-${cut}`
      let server: Array<Row> =
        cut === `initial-load`
          ? [
              { id: `1`, value: `a` },
              { id: `2`, value: `b` },
            ]
          : [
              { id: `1`, value: `old1` },
              { id: `2`, value: `old2` },
            ]
      const held: Array<ReturnType<typeof createDeferred<void>>> = []
      let hold = cut === `initial-load`
      const queryClient = createQueryClient()
      const writtenKey = cut === `handler-refetch-same-key` ? `1` : `2`
      const collection = createCollection(
        queryCollectionOptions<Row>({
          id,
          queryClient,
          queryKey: [id],
          queryFn: async () => {
            const snapshot = server.map((row) => ({ ...row }))
            if (hold) {
              const gate = createDeferred<void>()
              held.push(gate)
              await gate.promise
            }
            return snapshot
          },
          getKey: (row) => row.id,
          startSync: true,
          onUpdate: async ({ transaction, collection: handlerCollection }) => {
            const modified = transaction.mutations[0].modified
            if (modified.value === `A`) {
              // Handler A explicitly reads back the accepted server change.
              server = server.map((row) =>
                row.id === `1` ? { id: `1`, value: `A` } : row,
              )
              await handlerCollection.utils.refetch()
              return
            }
            server = server.map((row) =>
              row.id === writtenKey ? { id: writtenKey, value: `B` } : row,
            )
            await handlerCollection.utils.writeUpdate({
              id: writtenKey,
              value: `B`,
            })
          },
        }),
      )
      cleanups.push(async () => {
        held.forEach((gate) => gate.resolve())
        await collection.cleanup()
        queryClient.clear()
      })
      const visible = () =>
        Object.fromEntries(
          Array.from(collection.values(), (row) => [row.id, row.value]),
        )
      const cached = () =>
        Object.fromEntries(
          (queryClient.getQueryData<Array<Row>>([id]) ?? []).map((row) => [
            row.id,
            row.value,
          ]),
        )

      if (cut === `initial-load`) {
        const ready = collection.preload()
        if (
          !(await observeBoundary(
            observe,
            'held-fetches',
            () => held.length,
            (count) => count === 1,
          ))
        )
          return
        await collection.utils.writeInsert({ id: `3`, value: `c` })
        observe(
          'pending-status',
          queryClient.getQueryCache().find({ queryKey: [id] })?.state.status,
        )
        held[0]!.resolve()
        await ready
      } else if (cut === `user-refetch`) {
        await collection.preload()
        server = [
          { id: `1`, value: `new1` },
          { id: `2`, value: `new2` },
        ]

        hold = true
        const refetch = collection.utils.refetch()
        if (
          !(await observeBoundary(
            observe,
            'held-fetches',
            () => held.length,
            (count) => count === 1,
          ))
        )
          return
        hold = false
        await collection.utils.writeInsert({ id: `3`, value: `c` })
        held[0]!.resolve()
        await refetch

        // The refetch settles only once the merged rows are visible.
        observe('waiter-visible', visible())
      } else {
        await collection.preload()
        hold = true
        const first = collection.update(`1`, (draft) => {
          draft.value = `A`
        })
        if (
          !(await observeBoundary(
            observe,
            'held-fetches',
            () => held.length,
            (count) => count === 1,
          ))
        )
          return
        hold = false

        await collection
          .update(writtenKey, (draft) => {
            draft.value = `B-optimistic`
          })
          .when(`settled`)
        held[0]!.resolve()
        await first.when('settled')
      }
      // The original cut is after the source/application settles. Await its work
      // queue, then record the public row map without consulting the model.
      await boundary(
        () => collection._state.pendingSyncedTransactions.length === 0,
      )
      observe('visible', visible())
      observe('cache', cached())
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'row authority and retained work'),
})

oracleProperty({
  id: 'query-db.ownership.retained-empty-work',
  law: {
    statement:
      'does not rescan a stable empty persisted baseline on retained reacquisition',
    authority:
      'docs/collections/query-collection.md#direct-writes-and-query-sync and existing ownership retention/result-settlement contracts.',
    limits:
      'Original finite history and every retained work/cache/publication checkpoint; controlled persistence rather than native SQLite.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: emptyBaselineModel,
  driver: async (_history, observe) => {
    try {
      const id = `empty-persisted-baseline-work`
      const queryHash = hashKey([id])
      const scanPersistedRows = vi.fn(() => Promise.resolve([]))
      const { collection, queryFn } = createOwnershipFixture({
        id,
        results: [[], [], []],
        scanPersistedRows,
        persistedGcTime: Number.POSITIVE_INFINITY,
        setupMetadata: (metadata) =>
          metadata.collection.set(`queryCollection:gc:${queryHash}`, {
            queryHash,
            mode: `until-revalidated`,
          }),
      })

      await collection._sync.loadSubset({})

      observe('baseline:0', {
        rows: rows(collection),
        scans: scanPersistedRows.mock.calls.length,
      })

      for (let result = 0; result < 2; result++) {
        collection._sync.unloadSubset({})
        await collection._sync.loadSubset({ refetch: true })

        observe('baseline:' + (result + 1), {
          rows: rows(collection),
          scans: scanPersistedRows.mock.calls.length,
        })
      }
      observe('query-calls', queryFn.mock.calls.length)
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'row authority and retained work'),
})

oracleProperty({
  id: 'query-db.ownership.cold-owner-work',
  law: {
    statement:
      'scans a cold durable owner that appeared after an empty sync run',
    authority:
      'docs/collections/query-collection.md#direct-writes-and-query-sync and existing ownership retention/result-settlement contracts.',
    limits:
      'Original finite history and every retained work/cache/publication checkpoint; controlled persistence rather than native SQLite.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: coldBaselineModel,
  driver: async (_history, observe) => {
    try {
      const id = `cold-owner-after-empty-baseline`
      const queryHash = hashKey([id])
      const hotStorage = createOwnershipStorage()
      const hot = createPersistedOwnershipFixture(id, hotStorage, [])
      await hot.collection._sync.loadSubset({})
      observe('hot-storage', storedItems(hotStorage))
      await hot.collection.cleanup()

      // This seeded durable state represents another writer's committed owner
      // while the first Collection had no sync run. The cold Collection cannot
      // use the first run's empty-baseline evidence.
      const coldSeed = hotStorage.snapshot()
      coldSeed.rows.set(shared.id, shared)
      coldSeed.rowMetadata.set(shared.id, {
        queryCollection: { owners: { [queryHash]: true } },
      })
      coldSeed.collectionMetadata.set(`queryCollection:gc:${queryHash}`, {
        queryHash,
        mode: `until-revalidated`,
      })
      const coldStorage = createOwnershipStorage(coldSeed)
      const coldScanRows = vi.spyOn(coldStorage.adapter, `scanRows`)
      const cold = createPersistedOwnershipFixture(id, coldStorage, [])
      await cold.collection._sync.loadSubset({})

      // The empty provider result retires the cold durable owner. A design that
      // skips every empty-baseline scan leaves the stored row behind.
      observe('cold-baseline', {
        queryCalls: cold.queryFn.mock.calls.length,
        rows: rows(cold.collection),
        stored: storedItems(coldStorage),
        scans: coldScanRows.mock.calls.length,
      })
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'row authority and retained work'),
})

oracleProperty({
  id: 'query-db.ownership.superseded-result',
  law: {
    statement:
      'rejects a superseded accepted result while publishing its successor',
    authority:
      'docs/collections/query-collection.md#direct-writes-and-query-sync and existing ownership retention/result-settlement contracts.',
    limits:
      'Original finite history and every retained work/cache/publication checkpoint; controlled persistence rather than native SQLite.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: [{}],
  model: supersededModel,
  driver: async (_history, observe) => {
    try {
      const id = `superseded-retained-scan`
      const queryKey = [id] as const
      const queryHash = hashKey(queryKey)
      const initial = { id: `initial`, category: `retained`, name: `Initial` }
      const first = { id: `first`, category: `retained`, name: `First` }
      const second = { id: `second`, category: `retained`, name: `Second` }
      const initialScan =
        createDeferred<
          Array<{ key: string | number; value: Item; metadata?: unknown }>
        >()
      const firstRefetchScan =
        createDeferred<
          Array<{ key: string | number; value: Item; metadata?: unknown }>
        >()
      const scanPersistedRows = vi
        .fn()
        .mockReturnValueOnce(initialScan.promise)
        .mockReturnValueOnce(firstRefetchScan.promise)
        .mockResolvedValue([])
      const { collection, queryFn } = createOwnershipFixture({
        id,
        results: [[initial], [first], [second]],
        syncMode: `eager`,
        scanPersistedRows,
        setupMetadata: (metadata) => {
          metadata.collection.set(`queryCollection:gc:${queryHash}`, {
            queryHash,
            mode: `until-revalidated`,
          })
        },
      })
      const publications: Array<Array<string>> = []
      const subscription = collection.subscribeChanges(() => {
        publications.push(itemIds(collection.toArray))
      })
      cleanups.push(() => {
        subscription.unsubscribe()
        return Promise.resolve()
      })
      cleanups.push(() => {
        initialScan.resolve([])
        firstRefetchScan.resolve([])
        return Promise.resolve()
      })

      if (
        !(await observeBoundary(
          observe,
          'initial-scans',
          () => scanPersistedRows.mock.calls.length,
          (count) => count === 1,
        ))
      )
        return
      observe('initial-queries', queryFn.mock.calls.length)

      const firstRefetch = collection.utils.refetch({ throwOnError: true })
      void firstRefetch.catch(() => {})
      if (
        !(await observeBoundary(
          observe,
          'first-work',
          () => ({
            queries: queryFn.mock.calls.length,
            scans: scanPersistedRows.mock.calls.length,
          }),
          (work) => work.queries === 2 && work.scans === 2,
        ))
      )
        return

      const secondRefetch = collection.utils.refetch({ throwOnError: true })
      if (
        !(await observeBoundary(
          observe,
          'successor-applied',
          () => ({
            queries: queryFn.mock.calls.length,
            name: collection.get(second.id)?.name,
          }),
          (work) => work.queries === 3 && work.name === second.name,
        ))
      )
        return

      await secondRefetch
      observe('successor', {
        publicValues: { query: collection.get(second.id)?.name },
        refetch: `resolved`,
        resultOrder: [`query`],
      })

      firstRefetchScan.resolve([])
      const retiredOutcome = await settle(firstRefetch)
      observe(
        'retired-error',
        retiredOutcome.outcome === 'rejected'
          ? {
              outcome: retiredOutcome.outcome,
              name: diagnosticField(retiredOutcome.error, 'name'),
            }
          : { outcome: retiredOutcome.outcome },
      )
      observe('retired', {
        publicValues: { query: collection.get(second.id)?.name },
        refetch: `rejected`,
      })
      initialScan.resolve([])

      await observeBoundary(
        observe,
        'final-rows',
        () => itemIds(collection.toArray),
        (ids) => ids.length === 1 && ids[0] === second.id,
      )
      observe(
        'publications',
        publications.map((ids) => [...ids]),
      )
    } finally {
      await runCleanups()
    }
  },
  check: supersededCheck,
})
