/**
 * Ordinary examples of ordered-window behavior, moved unchanged from
 * `pagination-oracle.property.test.ts`. Each compares production with values
 * written in the test, through the controlled providers in
 * `pagination-fixtures.ts`; none replays the oracle's model or comparison.
 * The law that an ordered window equals independent recomputation, and its
 * authority, are in that oracle file.
 */
import { describe, expect, it } from 'vitest'
import { BTreeIndex } from '../../src/index.js'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq } from '../../src/query/builder/functions.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { TraceAssertionError } from '../trace-runner.js'
import { flushPromises, mockSyncCollectionOptions } from '../utils.js'
import { cleanupAll } from './pagination-support.js'
import {
  compareCustomCollationStrings,
  createConformingOrderedSource,
  customCollationProviderRows,
  projectPageRow,
  rowsForLoadSubset,
} from './pagination-fixtures.js'
import type { PageRow } from './pagination-support.js'
import type {
  CustomCollationRow,
  LocaleCursorRow,
  MultiOrderRow,
  PendingCursorLoad,
  PublicPageRow,
} from './pagination-fixtures.js'
import type { LoadSubsetOptions } from '../../src/types.js'

// Collection ids only need to be unique within this file.
let collectionSequence = 0

async function expectOnDemandWindowsAreCompletionOrderIndependent(
  deliveryOrder: `forward` | `reverse`,
): Promise<void> {
  const authoritativeRows: Array<PageRow> = [
    { id: 1, rank: 0 },
    { id: 2, rank: 1 },
    { id: 3, rank: 2 },
    { id: 4, rank: 3 },
  ]
  const pending: Array<PendingCursorLoad> = []
  const deliveredIds = new Set<number>([1])
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PageRow }) => void
  let commit!: () => void
  const apply = (options: LoadSubsetOptions) => {
    begin()
    for (const row of rowsForLoadSubset(authoritativeRows, options)) {
      if (deliveredIds.has(row.id)) continue
      deliveredIds.add(row.id)
      write({ type: `insert`, value: { ...row } })
    }
    commit()
  }
  const source = createCollection<PageRow>({
    id: `pagination-completion-order-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        begin()
        write({ type: `insert`, value: { ...authoritativeRows[0]! } })
        commit()
        params.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const deferred = createDeferred<void>()
            pending.push({ options, deferred })
            return deferred.promise
          },
        }
      },
    },
  })
  const createLive = (limit: number) =>
    createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `asc`)
        .orderBy(({ row }) => row.id, `asc`)
        .limit(limit),
    )
  const firstLive = createLive(2)
  const secondLive = createLive(3)

  try {
    const first = firstLive.preload()
    const second = secondLive.preload()
    expect(pending).toHaveLength(2)

    const indices = deliveryOrder === `forward` ? [0, 1] : [1, 0]
    for (const index of indices) {
      const request = pending[index]!
      apply(request.options)
      request.deferred.resolve()
      await flushPromises()
    }
    for (let index = 2; index < pending.length; index++) {
      const request = pending[index]!
      apply(request.options)
      request.deferred.resolve()
      await flushPromises()
    }
    await first
    await second

    expect(Array.from(firstLive.values(), ({ id }) => id)).toEqual([1, 2])
    expect(Array.from(secondLive.values(), ({ id }) => id)).toEqual([1, 2, 3])
  } finally {
    for (const request of pending) request.deferred.resolve()
    await cleanupAll(firstLive, secondLive, source)
  }
}

async function expectInflightRequestFillsNewWindow(): Promise<void> {
  const rows: Array<PageRow> = [
    { id: 1, rank: 0 },
    { id: 2, rank: 1 },
    { id: 3, rank: 2 },
    { id: 4, rank: 3 },
  ]
  const pending: Array<PendingCursorLoad> = []
  const deliveredIds = new Set<number>([1])
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PageRow }) => void
  let commit!: () => void
  const source = createCollection<PageRow>({
    id: `pagination-late-window-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        begin()
        write({ type: `insert`, value: { ...rows[0]! } })
        commit()
        params.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const deferred = createDeferred<void>()
            pending.push({ options, deferred })
            return deferred.promise
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((query) =>
    query
      .from({ row: source })
      .orderBy(({ row }) => row.rank, `asc`)
      .orderBy(({ row }) => row.id, `asc`)
      .limit(2),
  )

  const settle = async (request: PendingCursorLoad) => {
    begin()
    for (const row of rowsForLoadSubset(rows, request.options)) {
      if (deliveredIds.has(row.id)) continue
      deliveredIds.add(row.id)
      write({ type: `insert`, value: { ...row } })
    }
    commit()
    request.deferred.resolve()
    await Promise.resolve()
  }

  try {
    const preload = live.preload()
    expect(pending).toHaveLength(1)
    const setWindow = live.utils.setWindow({ offset: 2, limit: 2 })
    expect(setWindow).toBeInstanceOf(Promise)
    await flushPromises()
    expect(pending.length).toBeGreaterThan(0)

    for (let index = 0; index < pending.length; index++) {
      if (index > rows.length * 2) {
        throw new Error(`Ordered continuation exceeded its work bound`)
      }
      await settle(pending[index]!)
      await flushPromises()
    }
    await preload
    if (setWindow instanceof Promise) await setWindow

    try {
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([3, 4])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    for (const request of pending) request.deferred.resolve()
    await cleanupAll(live, source)
  }
}

describe(`pagination recomputation`, () => {
  it(`refills a joined result window through a contract-compliant source`, async () => {
    type ParentRow = { id: number; rank: number; groupId: number }
    type ChildRow = { id: number; groupId: number }
    const parents = [
      { id: 1, rank: 0, groupId: 1 },
      { id: 2, rank: 1, groupId: 2 },
      { id: 3, rank: 2, groupId: 3 },
      { id: 4, rank: 3, groupId: 4 },
    ] satisfies ReadonlyArray<ParentRow>
    const { requests, source: parentSource } = createConformingOrderedSource(
      `pagination-joined-underfill-source-${collectionSequence++}`,
      parents,
    )
    const childSource = createCollection(
      mockSyncCollectionOptions({
        id: `pagination-joined-underfill-child-${collectionSequence++}`,
        initialData: [
          { id: 20, groupId: 2 },
          { id: 30, groupId: 3 },
          { id: 40, groupId: 4 },
        ] satisfies ReadonlyArray<ChildRow>,
        getKey: (row: ChildRow) => row.id,
      }),
    )
    const live = createLiveQueryCollection((query) =>
      query
        .from({ parent: parentSource })
        .innerJoin({ child: childSource }, ({ parent, child }) =>
          eq(parent.groupId, child.groupId),
        )
        .orderBy(({ parent }) => parent.rank, `asc`)
        .orderBy(({ parent }) => parent.id, `asc`)
        .limit(2)
        .select(({ parent }) => ({ id: parent.id })),
    )

    try {
      await live.preload()
      await flushPromises()

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([2, 3])
      expect(requests).toHaveLength(1)
      expect(requests[0]?.limit).toBeUndefined()
    } finally {
      await cleanupAll(live, childSource, parentSource)
    }
  })

  it(`loads the full ordered source when no continuation index exists`, async () => {
    type ParentRow = { id: number; rank: number; groupId: number }
    type ChildRow = { id: number; groupId: number }
    const parents = [
      { id: 1, rank: 0, groupId: 1 },
      { id: 2, rank: 1, groupId: 2 },
      { id: 3, rank: 2, groupId: 3 },
      { id: 4, rank: 3, groupId: 4 },
    ] satisfies ReadonlyArray<ParentRow>
    const { requests, source: parentSource } = createConformingOrderedSource(
      `pagination-no-index-underfill-source-${collectionSequence++}`,
      parents,
      `off`,
    )
    const childSource = createCollection(
      mockSyncCollectionOptions({
        id: `pagination-no-index-underfill-child-${collectionSequence++}`,
        initialData: [
          { id: 20, groupId: 2 },
          { id: 30, groupId: 3 },
          { id: 40, groupId: 4 },
        ] satisfies ReadonlyArray<ChildRow>,
        getKey: (row: ChildRow) => row.id,
      }),
    )
    const live = createLiveQueryCollection((query) =>
      query
        .from({ parent: parentSource })
        .innerJoin({ child: childSource }, ({ parent, child }) =>
          eq(parent.groupId, child.groupId),
        )
        .orderBy(({ parent }) => parent.rank, `asc`)
        .orderBy(({ parent }) => parent.id, `asc`)
        .limit(2)
        .select(({ parent }) => ({ id: parent.id })),
    )

    try {
      await live.preload()
      await flushPromises()

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([2, 3])
      expect(requests).toHaveLength(1)
      expect(requests[0]?.limit).toBeUndefined()
    } finally {
      await cleanupAll(live, childSource, parentSource)
    }
  })

  it(`refines a joined foreign order term through the source tie class`, async () => {
    type ParentRow = { id: number; sourceRank: number; childId: number }
    type ChildRow = { id: number; score: number }
    const parents = [
      { id: 1, sourceRank: 0, childId: 1 },
      { id: 2, sourceRank: 0, childId: 2 },
      { id: 3, sourceRank: 0, childId: 3 },
      { id: 4, sourceRank: 0, childId: 4 },
    ] satisfies ReadonlyArray<ParentRow>
    const { requests, source: parentSource } = createConformingOrderedSource(
      `pagination-joined-foreign-order-source-${collectionSequence++}`,
      parents,
    )
    const childSource = createCollection(
      mockSyncCollectionOptions({
        id: `pagination-joined-foreign-order-child-${collectionSequence++}`,
        initialData: [
          { id: 1, score: 10 },
          { id: 2, score: 20 },
          { id: 3, score: 0 },
          { id: 4, score: 30 },
        ] satisfies ReadonlyArray<ChildRow>,
        getKey: (row: ChildRow) => row.id,
      }),
    )
    const live = createLiveQueryCollection((query) =>
      query
        .from({ parent: parentSource })
        .leftJoin({ child: childSource }, ({ parent, child }) =>
          eq(parent.childId, child.id),
        )
        .orderBy(({ parent }) => parent.sourceRank, `asc`)
        .orderBy(({ child }) => child.score, `asc`)
        .orderBy(({ parent }) => parent.id, `asc`)
        .limit(2)
        .select(({ parent }) => ({ id: parent.id })),
    )

    try {
      await live.preload()
      await flushPromises()

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([3, 1])
      expect(requests).toHaveLength(1)
      expect(requests[0]?.limit).toBeUndefined()
    } finally {
      await cleanupAll(live, childSource, parentSource)
    }
  })

  it.each([`error`, `AbortError`] as const)(
    `does not derive a retry cursor from rows written by a %s request`,
    async (failureKind) => {
      const authoritativeRows: Array<PageRow> = [
        { id: 1, rank: 0 },
        { id: 2, rank: 1 },
        { id: 3, rank: 2 },
        { id: 4, rank: 99 },
      ]
      const requests: Array<LoadSubsetOptions> = []
      const unloaded: Array<LoadSubsetOptions> = []
      const deliveredIds = new Set<number>()
      const rejectedPage = createDeferred<void>()
      let rejectNextPage = false
      let begin!: () => void
      let write!: (message: { type: `insert`; value: PageRow }) => void
      let commit!: () => void
      let truncate!: () => void
      const source = createCollection<PageRow>({
        id: `pagination-rejected-partial-page-${collectionSequence++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: (options: LoadSubsetOptions) => {
                requests.push(options)
                if (rejectNextPage) {
                  rejectNextPage = false
                  begin()
                  deliveredIds.add(4)
                  write({ type: `insert`, value: { ...authoritativeRows[3]! } })
                  commit()
                  return rejectedPage.promise
                }

                begin()
                for (const row of rowsForLoadSubset(
                  authoritativeRows,
                  options,
                )) {
                  if (deliveredIds.has(row.id)) continue
                  deliveredIds.add(row.id)
                  write({ type: `insert`, value: { ...row } })
                }
                commit()
                return true
              },
              unloadSubset: (options) => unloaded.push(options),
            }
          },
        },
      })
      const live = createLiveQueryCollection((query) =>
        query
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `asc`)
          .limit(1),
      )

      try {
        await live.preload()
        const initialRequestCount = requests.length
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])

        rejectNextPage = true
        const failed = live.utils.setWindow({ offset: 0, limit: 4 })
        expect(failed).toBeInstanceOf(Promise)
        const failure =
          failureKind === `AbortError`
            ? new DOMException(`partial ordered request canceled`, `AbortError`)
            : new Error(`partial ordered request failed`)
        rejectedPage.reject(failure)
        await expect(failed).rejects.toBe(failure)
        await flushPromises()
        expect(requests).toHaveLength(initialRequestCount + 1)

        // Replay can replace the failed request's physical options object
        // before the explicit retry retires its logical demand.
        const beforeFailedReplay = requests.length
        deliveredIds.clear()
        begin()
        truncate()
        commit()
        await flushPromises()
        const failedReplayRequests = requests.slice(beforeFailedReplay)
        // The settled first row permits a three-row continuation. Replay
        // must preserve that exact demand even after its first attempt fails.
        const replayedFailedRequest = failedReplayRequests.find(
          ({ limit, cursor }) => limit === 3 && cursor !== undefined,
        )
        expect(replayedFailedRequest).toBeDefined()
        expect(replayedFailedRequest).toMatchObject({ offset: 1, limit: 3 })
        expect(replayedFailedRequest?.cursor).toEqual(
          requests[initialRequestCount]?.cursor,
        )

        const releasesBeforeRetry = unloaded.length
        const requestsBeforeRetry = requests.length
        const retry = live.utils.setWindow({ offset: 0, limit: 2 })
        if (retry instanceof Promise) await retry
        expect(unloaded.slice(releasesBeforeRetry)).toEqual([
          replayedFailedRequest,
        ])
        expect(requests).toHaveLength(requestsBeforeRetry)
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])

        const beforeWiden = requests.length
        const widen = live.utils.setWindow({ offset: 0, limit: 3 })
        if (widen instanceof Promise) await widen
        expect(requests).toHaveLength(beforeWiden)
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2, 3])

        const beforeReplay = requests.length
        deliveredIds.clear()
        begin()
        truncate()
        commit()
        await flushPromises()
        expect(
          requests.slice(beforeReplay).every(({ cursor }) => !cursor),
        ).toBe(true)
      } finally {
        rejectedPage.resolve()
        await cleanupAll(live, source)
      }
    },
  )

  it(`recovers a failed tie boundary from the authoritative full source`, async () => {
    const authoritativeRows: Array<PageRow> = [
      { id: 1, rank: -1 },
      // A provider may return equal-order rows in any order. The local public
      // key tie-breaker must choose id 2 after boundary refinement.
      { id: 4, rank: 0 },
      { id: 3, rank: 0 },
      { id: 2, rank: 0 },
      { id: 6, rank: 1 },
      { id: 5, rank: 99 },
    ]
    const deliveredIds = new Set<number>()
    const requests: Array<LoadSubsetOptions> = []
    const failedPage = createDeferred<void>()
    let rejectNextPage = false
    let begin!: () => void
    let write!: (message: { type: `insert` | `delete`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-recovered-prefix-tie-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          operations.markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              requests.push(options)
              if (rejectNextPage) {
                rejectNextPage = false
                begin()
                deliveredIds.add(5)
                write({ type: `insert`, value: { id: 5, rank: 99 } })
                commit()
                return failedPage.promise
              }

              begin()
              for (const row of rowsForLoadSubset(authoritativeRows, options)) {
                if (deliveredIds.has(row.id)) continue
                deliveredIds.add(row.id)
                write({ type: `insert`, value: { ...row } })
              }
              commit()
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `asc`)
        .limit(1),
    )

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])

      rejectNextPage = true
      const failed = live.utils.setWindow({ offset: 0, limit: 3 })
      expect(failed).toBeInstanceOf(Promise)
      failedPage.reject(new Error(`later page failed`))
      await expect(failed).rejects.toThrow(`later page failed`)

      const retry = live.utils.setWindow({ offset: 0, limit: 2 })
      if (retry instanceof Promise) await retry
      const recoveryRequest = requests.at(-1)
      expect(recoveryRequest?.limit).toBeUndefined()
      expect(recoveryRequest?.offset).toBeUndefined()
      expect(recoveryRequest?.cursor).toBeUndefined()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])

      const deleted = authoritativeRows.filter(({ id }) =>
        [1, 2, 3].includes(id),
      )
      for (const row of deleted) {
        authoritativeRows.splice(authoritativeRows.indexOf(row), 1)
        deliveredIds.delete(row.id)
      }
      begin()
      for (const row of deleted) write({ type: `delete`, value: { ...row } })
      commit()
      await flushPromises()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([4, 6])
    } finally {
      failedPage.resolve()
      await cleanupAll(live, source)
    }
  })

  it(`rejects a reentrant window move when an ordered request writes and then throws`, async () => {
    const authoritativeRows: Array<PageRow> = [
      { id: 1, rank: 0 },
      { id: 2, rank: 1 },
      { id: 3, rank: 2 },
    ]
    const requests: Array<LoadSubsetOptions> = []
    const deliveredIds = new Set<number>()
    const failure = new Error(`ordered request threw after writing`)
    let reentrantError: unknown
    let throwNextPage = false
    let begin!: () => void
    let write!: (message: { type: `insert`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-synchronous-partial-page-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          operations.markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              requests.push(options)
              if (throwNextPage) {
                throwNextPage = false
                begin()
                deliveredIds.add(3)
                write({ type: `insert`, value: { ...authoritativeRows[2]! } })
                commit()
                try {
                  live.utils.setWindow({ offset: 0, limit: 3 })
                } catch (error) {
                  reentrantError = error
                }
                throw failure
              }

              begin()
              for (const row of rowsForLoadSubset(authoritativeRows, options)) {
                if (deliveredIds.has(row.id)) continue
                deliveredIds.add(row.id)
                write({ type: `insert`, value: { ...row } })
              }
              commit()
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `asc`)
        .limit(1),
    )

    try {
      await live.preload()
      const initialRequestCount = requests.length
      throwNextPage = true

      // A synchronous throw is a rejection (maintainer decision): the move
      // fails with it.
      await expect(
        Promise.resolve(live.utils.setWindow({ offset: 0, limit: 2 })),
      ).rejects.toBe(failure)
      expect(reentrantError).toMatchObject({
        name: `SetWindowReentrancyError`,
      })
      expect(requests).toHaveLength(initialRequestCount + 1)
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])

      const retry = live.utils.setWindow({ offset: 0, limit: 2 })
      if (retry instanceof Promise) await retry
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
    } finally {
      await cleanupAll(live, source)
    }
  })

  it.each(
    ([`sync`, `async`] as const).flatMap((delivery) =>
      [1, 2].map((requestNumber) => ({ delivery, requestNumber })),
    ),
  )(
    `rejects a window move reentered from startup request $requestNumber after $delivery delivery`,
    async ({ delivery, requestNumber }) => {
      const authoritativeRows: Array<PageRow> = [
        { id: 1, rank: 0 },
        { id: 2, rank: 1 },
      ]
      const delivered = new Set<number>()
      let nestedResult: true | Promise<void> | undefined
      let nestedError: unknown
      let requests = 0
      let firstRequestSettled = false
      function createWindowedQuery() {
        return createLiveQueryCollection((query) =>
          query
            .from({ row: source })
            .orderBy(({ row }) => row.rank)
            .limit(1),
        )
      }
      const source = createCollection<PageRow>({
        id: `pagination-initial-request-reentrancy-${collectionSequence++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                requests++
                if (requests === requestNumber) {
                  if (delivery === `async` && requestNumber === 2) {
                    expect(firstRequestSettled).toBe(true)
                  }
                  try {
                    nestedResult = live.utils.setWindow({ offset: 0, limit: 2 })
                  } catch (error) {
                    nestedError = error
                  }
                }
                const fresh = rowsForLoadSubset(
                  authoritativeRows,
                  options,
                ).filter(({ id }) => !delivered.has(id))
                if (fresh.length === 0) return true
                begin()
                for (const row of fresh) {
                  delivered.add(row.id)
                  write({ type: `insert`, value: { ...row } })
                }
                commit()
                return delivery === `async`
                  ? Promise.resolve().then(() => {
                      firstRequestSettled = true
                    })
                  : true
              },
            }
          },
        },
      })
      const live = createWindowedQuery()

      try {
        await live.preload()
        expect(requests).toBeGreaterThanOrEqual(requestNumber)
        expect(nestedResult).toBeUndefined()
        expect(nestedError).toMatchObject({
          name: `SetWindowReentrancyError`,
        })
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
        await live.utils.setWindow({ offset: 0, limit: 2 })
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
      } finally {
        await cleanupAll(live, source)
      }
    },
  )

  it(`rejects a window move reentered from a public change callback`, async () => {
    const authoritativeRows: Array<PageRow> = [
      { id: 1, rank: 0, keep: true },
      { id: 2, rank: 1, keep: true },
    ]
    const delivered = new Set<number>()
    let begin!: () => void
    let write!: (message: {
      type: `update`
      value: PageRow
      previousValue: PageRow
    }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-publication-reentrancy-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          operations.markReady()
          return {
            loadSubset: (options) => {
              const fresh = rowsForLoadSubset(
                authoritativeRows,
                options,
              ).filter(({ id }) => !delivered.has(id))
              if (fresh.length === 0) return true
              begin()
              for (const row of fresh) {
                delivered.add(row.id)
                operations.write({ type: `insert`, value: { ...row } })
              }
              commit()
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    )
    let nestedResult: true | Promise<void> | undefined
    let nestedError: unknown

    try {
      await live.preload()
      const subscription = live.subscribeChanges(() => {
        try {
          nestedResult = live.utils.setWindow({ offset: 0, limit: 2 })
        } catch (error) {
          nestedError = error
        }
      })
      const previous = authoritativeRows[0]!
      const current = { ...previous, keep: false }
      authoritativeRows[0] = current
      begin()
      write({ type: `update`, value: current, previousValue: previous })
      commit()
      subscription.unsubscribe()

      expect(nestedResult).toBeUndefined()
      expect(nestedError).toMatchObject({ name: `SetWindowReentrancyError` })
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
    } finally {
      await cleanupAll(live, source)
    }
  })

  it.each([`return-only`, `write-after-cleanup`])(
    `rejects a window move when its sync run is cleaned up: %s`,
    async (delivery) => {
      const authoritativeRows: Array<PageRow> = [
        { id: 1, rank: 0 },
        { id: 2, rank: 1 },
      ]
      const delivered = new Set<number>()
      let cleanUpDuringNextRequest = false
      let cleanupPromise: Promise<void> | undefined
      function createWindowedQuery() {
        return createLiveQueryCollection((query) =>
          query
            .from({ row: source })
            .orderBy(({ row }) => row.rank)
            .limit(1),
        )
      }
      const source = createCollection<PageRow>({
        id: `pagination-window-cleanup-${collectionSequence++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                if (cleanUpDuringNextRequest) {
                  cleanUpDuringNextRequest = false
                  cleanupPromise = live.cleanup()
                  if (delivery === `return-only`) return true
                }
                const fresh = rowsForLoadSubset(
                  authoritativeRows,
                  options,
                ).filter(({ id }) => !delivered.has(id))
                if (fresh.length === 0) return true
                begin()
                for (const row of fresh) {
                  delivered.add(row.id)
                  write({ type: `insert`, value: { ...row } })
                }
                commit()
                return true
              },
            }
          },
        },
      })
      const live = createWindowedQuery()

      try {
        await live.preload()
        cleanUpDuringNextRequest = true
        const move = live.utils.setWindow({ offset: 0, limit: 2 })
        expect(cleanUpDuringNextRequest).toBe(false)
        expect(cleanupPromise).toBeInstanceOf(Promise)
        await cleanupPromise

        expect(move).toBeInstanceOf(Promise)
        await expect(move).rejects.toMatchObject({ name: `AbortError` })
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
      } finally {
        await cleanupAll(live, source)
      }
    },
  )

  it(`tracks an asynchronous cursor continuation after synchronous satisfaction`, async () => {
    const rows: Array<PageRow> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 3, rank: 3 },
    ]
    const requests: Array<LoadSubsetOptions> = []
    const delivered = new Set<number>()
    const refinement = createDeferred<void>()
    let deferLoads = false
    const source = createCollection<PageRow>({
      id: `pagination-async-refinement-source-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          const publish = (options: LoadSubsetOptions) => {
            begin()
            for (const row of rowsForLoadSubset(rows, options)) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            commit()
          }

          return {
            loadSubset: (options: LoadSubsetOptions) => {
              requests.push(options)
              if (!deferLoads) {
                publish(options)
                return true
              }

              return refinement.promise.then(() => publish(options))
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `asc`)
        .orderBy(({ row }) => row.id, `asc`)
        .limit(1),
    )

    try {
      await live.preload()
      await flushPromises()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
      const initialRequestCount = requests.length
      expect(initialRequestCount).toBeGreaterThan(0)
      expect(
        requests.every(
          ({ limit, where }) => limit !== undefined || where !== undefined,
        ),
      ).toBe(true)
      deferLoads = true

      const widened = live.utils.setWindow({ offset: 0, limit: 2 })
      expect(widened).toBeInstanceOf(Promise)
      await flushPromises()
      expect(requests.length).toBeGreaterThan(initialRequestCount)
      const widenedRequest = requests
        .slice(initialRequestCount)
        .find(({ cursor }) => cursor !== undefined)
      expect(widenedRequest).toBeDefined()
      expect(widenedRequest).toMatchObject({ limit: 1, offset: 1 })
      expect(widenedRequest?.cursor?.whereFrom).toBeDefined()
      expect(widenedRequest?.cursor?.whereCurrent).toBeDefined()
      const settledBeforeRefinement = await Promise.race([
        Promise.resolve(widened).then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
      ])
      expect(settledBeforeRefinement).toBe(false)

      refinement.resolve()
      if (widened instanceof Promise) await widened
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
    } finally {
      await cleanupAll(live, source)
    }
  })

  it(`refines locale-ordered continuations locally when predicate IR cannot express the collation`, async () => {
    const rows: Array<LocaleCursorRow> = [
      { id: 1, label: `item2` },
      { id: 2, label: `item10` },
      { id: 3, label: `item11` },
    ]
    const pending: Array<PendingCursorLoad> = []
    const delivered = new Set<number>()
    let begin!: () => void
    let write!: (message: { type: `insert`; value: LocaleCursorRow }) => void
    let commit!: () => void
    const source = createCollection<LocaleCursorRow>({
      id: `pagination-locale-cursor-source-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              const deferred = createDeferred<void>()
              pending.push({ options, deferred })
              return deferred.promise
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.label, {
          direction: `asc`,
          nulls: `first`,
          stringSort: `locale`,
          locale: `en-US`,
          localeOptions: { numeric: true },
        })
        .orderBy(({ row }) => row.id, `asc`)
        .limit(1),
    )

    try {
      const preload = live.preload()
      expect(pending).toHaveLength(1)
      // Settling one request can append its boundary-refinement request.
      for (const request of pending) {
        begin()
        for (const row of rowsForLoadSubset(rows, request.options)) {
          if (delivered.has(row.id)) continue
          delivered.add(row.id)
          write({ type: `insert`, value: { ...row } })
        }
        commit()
        request.deferred.resolve()
        await flushPromises()
      }
      await preload

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
      expect(pending.length).toBeLessThanOrEqual(rows.length * 2)
      expect(
        pending.some(
          ({ options }) =>
            options.limit === undefined && options.where === undefined,
        ),
      ).toBe(true)

      const transportCount = pending.length
      const widened = live.utils.setWindow({ offset: 0, limit: 2 })
      for (let index = transportCount; index < pending.length; index++) {
        const request = pending[index]!
        begin()
        for (const row of rowsForLoadSubset(rows, request.options)) {
          if (delivered.has(row.id)) continue
          delivered.add(row.id)
          write({ type: `insert`, value: { ...row } })
        }
        commit()
        request.deferred.resolve()
        await flushPromises()
      }
      if (widened instanceof Promise) await widened

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
      expect(pending.length).toBeLessThanOrEqual(rows.length * 3)
    } finally {
      for (const request of pending) request.deferred.resolve()
      await cleanupAll(live, source)
    }
  })

  it(`continues an indexed multi-column window from its leading boundary`, async () => {
    const rows: Array<MultiOrderRow> = [
      { id: 3, primary: 0, secondary: 2 },
      { id: 2, primary: 0, secondary: 1 },
      { id: 1, primary: 0, secondary: 0 },
      { id: 5, primary: 1, secondary: 1 },
      { id: 4, primary: 1, secondary: 0 },
      { id: 6, primary: 2, secondary: 0 },
    ]
    const { requests, source } = createConformingOrderedSource(
      `pagination-multi-order-cursor-${collectionSequence++}`,
      rows,
    )
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.primary, `asc`)
        .orderBy(({ row }) => row.secondary, `desc`)
        .limit(2)
        .select(({ row }) => ({ id: row.id })),
    )

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([3, 2])

      const initialRequestCount = requests.length
      const widened = live.utils.setWindow({ offset: 0, limit: 5 })
      if (widened instanceof Promise) await widened

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([3, 2, 1, 5, 4])
      const continuation = requests
        .slice(initialRequestCount)
        .find(({ cursor }) => cursor !== undefined)
      expect(continuation).toMatchObject({
        limit: 2,
        offset: 3,
        orderBy: expect.any(Array),
      })
      expect(continuation?.orderBy).toHaveLength(2)
      expect(continuation?.cursor?.whereFrom).toBeDefined()
      expect(continuation?.cursor?.whereCurrent).toBeDefined()
    } finally {
      await cleanupAll(live, source)
    }
  })

  it(`retains a finite inactive prefix across shrink, SSE, and re-expansion`, async () => {
    const rows = new Map<number, PageRow>(
      Array.from({ length: 5 }, (_, index) => [
        index + 1,
        { id: index + 1, rank: index + 1 },
      ]),
    )
    const delivered = new Set<number>()
    let begin!: () => void
    let write!: (message: { type: `insert`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-retained-prefix-live-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              const ordered = [...rows.values()].sort(
                (left, right) => left.rank - right.rank || left.id - right.id,
              )
              const requested = rowsForLoadSubset(ordered, options)
              begin()
              for (const row of requested) {
                if (delivered.has(row.id)) continue
                delivered.add(row.id)
                write({ type: `insert`, value: { ...row } })
              }
              const receipt = commit()
              return Promise.resolve(receipt)
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `asc`)
        .orderBy(({ row }) => row.id, `asc`)
        .limit(3),
    )

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2, 3])

      await live.utils.setWindow({ offset: 0, limit: 1 })
      const inserted = { id: 9, rank: 2.5 }
      rows.set(inserted.id, inserted)
      delivered.add(inserted.id)
      begin()
      write({ type: `insert`, value: inserted })
      commit()
      await flushPromises()

      await live.utils.setWindow({ offset: 0, limit: 3 })
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2, 9])
    } finally {
      await cleanupAll(live, source)
    }
  })

  it(`discovered trace: an in-flight request does not underfill a new window`, async () => {
    await expectInflightRequestFillsNewWindow()
  })

  it.each([`resolve`, `reject`] as const)(
    `keeps the last complete implicit window while background recovery %ss`,
    async (settlement) => {
      const authoritativeRows = new Map<number, PageRow>([
        [1, { id: 1, rank: 0, keep: true }],
        [2, { id: 2, rank: 1, keep: true }],
      ])
      const recovery = createDeferred<void>()
      const recoveryError = new Error(`background recovery failed`)
      const loads: Array<LoadSubsetOptions> = []
      const delivered = new Set<number>()
      let recovering = false
      let begin!: () => void
      let write!: (message: {
        type: `insert` | `update`
        value: PageRow
      }) => void
      let commit!: () => void
      const source = createCollection<PageRow>({
        id: `pagination-background-prefix-recovery-${collectionSequence++}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            operations.markReady()
            return {
              loadSubset: (options: LoadSubsetOptions) => {
                loads.push(options)
                const isFullSource =
                  options.where === undefined &&
                  options.limit === undefined &&
                  options.cursor === undefined
                const isOrderedRepair =
                  options.where === undefined &&
                  options.orderBy !== undefined &&
                  options.limit === 1 &&
                  options.cursor === undefined
                const applyRows = () => {
                  const rows = rowsForLoadSubset(
                    [...authoritativeRows.values()].sort(
                      (left, right) =>
                        left.rank - right.rank || left.id - right.id,
                    ),
                    options,
                  )
                  begin()
                  for (const row of rows) {
                    if (delivered.has(row.id)) continue
                    delivered.add(row.id)
                    write({ type: `insert`, value: { ...row } })
                  }
                  commit()
                }
                if (!recovering || (!isFullSource && !isOrderedRepair)) {
                  applyRows()
                  return true
                }
                return recovery.promise.then(() => {
                  if (settlement === `reject`) throw recoveryError
                  applyRows()
                })
              },
            }
          },
        },
      })
      const live = createLiveQueryCollection((query) =>
        query
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `asc`)
          .limit(1)
          .select(({ row }) => ({
            id: row.id,
            rank: row.rank,
            keep: row.keep,
          })),
      )
      const publications: Array<Array<PublicPageRow>> = []
      const subscription = live.subscribeChanges(
        () => publications.push(live.toArray.map(projectPageRow)),
        { includeInitialState: false },
      )

      try {
        await live.preload()
        expect(live.toArray.map(projectPageRow)).toEqual([{ id: 1, rank: 0 }])
        publications.length = 0
        const loadsBeforeMutation = loads.length

        recovering = true
        const moved = { id: 1, rank: 10, keep: true }
        authoritativeRows.set(1, moved)
        begin()
        write({ type: `update`, value: { ...moved } })
        commit()
        await flushPromises()

        const recoveryLoads = loads.slice(loadsBeforeMutation)
        expect(recoveryLoads).toHaveLength(1)
        expect(recoveryLoads[0]?.where).toBeUndefined()
        expect(recoveryLoads[0]?.orderBy).toHaveLength(1)
        expect(recoveryLoads[0]?.limit).toBe(1)
        expect(recoveryLoads[0]?.cursor).toBeUndefined()
        expect(live.toArray.map(projectPageRow)).toEqual([{ id: 1, rank: 0 }])
        expect(publications).toEqual([])

        recovery.resolve()
        await flushPromises()

        if (settlement === `resolve`) {
          expect(live.toArray.map(projectPageRow)).toEqual([{ id: 2, rank: 1 }])
          expect(publications).toEqual([[{ id: 2, rank: 1 }]])
          expect(live.utils.lastSubsetError).toBeUndefined()
        } else {
          expect(live.toArray.map(projectPageRow)).toEqual([{ id: 1, rank: 0 }])
          expect(publications).toEqual([])
          expect(live.utils.lastSubsetError).toBe(recoveryError)
        }
      } finally {
        recovery.resolve()
        subscription.unsubscribe()
        await cleanupAll(live, source)
      }
    },
  )

  it(`uses the leading source custom collation when ordering a later source (C-08 multi-source inheritance)`, async () => {
    type ScopeRow = { id: number; groupId: number }
    const scope = createCollection(
      mockSyncCollectionOptions({
        id: `pagination-custom-collation-scope-${collectionSequence++}`,
        initialData: [{ id: 1, groupId: 1 }] satisfies Array<ScopeRow>,
        getKey: (row: ScopeRow) => row.id,
        defaultStringCollation: {
          stringSort: `custom`,
          compare: compareCustomCollationStrings,
        },
      }),
    )
    const loads: Array<LoadSubsetOptions> = []
    const delivered = new Set<number>()
    const source = createCollection<CustomCollationRow>({
      id: `pagination-custom-collation-joined-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      defaultStringCollation: { stringSort: `lexical` },
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: (loadOptions: LoadSubsetOptions) => {
              loads.push(loadOptions)
              const matchingRows = loadOptions.where
                ? customCollationProviderRows.filter(
                    (row) =>
                      evaluateReferenceExpression(loadOptions.where!, row) ===
                      true,
                  )
                : customCollationProviderRows
              begin()
              for (const row of matchingRows) {
                if (delivered.has(row.id)) continue
                delivered.add(row.id)
                write({ type: `insert`, value: { ...row } })
              }
              const receipt = commit()
              return receipt === true ? Promise.resolve() : receipt
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ scope })
        .innerJoin({ row: source }, ({ scope: outer, row }) =>
          eq(outer.groupId, row.groupId),
        )
        .where(({ row }) => eq(row.keep, true))
        .orderBy(({ row }) => row.label, {
          direction: `asc`,
          nulls: `first`,
        })
        .select(({ row }) => ({ id: row.id, label: row.label })),
    )

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([2, 3, 4, 1])
      expect(loads).toHaveLength(1)
      expect(loads[0]?.where).toBeDefined()
      expect(loads[0]?.orderBy).toBeUndefined()
      expect(loads[0]?.limit).toBeUndefined()
      expect(loads[0]?.offset).toBeUndefined()
      expect(loads[0]?.cursor).toBeUndefined()
    } finally {
      await cleanupAll(live, source, scope)
    }
  })

  it(`uses an ascending index for a bounded descending demand`, async () => {
    const rows: Array<PageRow> = [
      { id: 3, rank: 1 },
      { id: 1, rank: 0 },
      { id: 2, rank: 0 },
    ]
    const loads: Array<LoadSubsetOptions> = []
    const loaded = new Set<number>()
    let begin!: () => void
    let write!: (message: { type: `insert`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-reversed-index-ties-${collectionSequence++}`,
      getKey: (row: PageRow) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              begin()
              for (const row of rowsForLoadSubset(rows, options)) {
                if (loaded.has(row.id)) continue
                loaded.add(row.id)
                write({ type: `insert`, value: row })
              }
              commit()
              return true
            },
          }
        },
      },
    })
    source.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
      options: {
        compareOptions: {
          direction: `asc`,
          nulls: `first`,
          stringSort: `locale`,
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `desc`)
        .limit(2),
    )

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([3, 1])
      expect(loads.length).toBeGreaterThan(0)
      expect(
        loads.every(
          ({ limit, where }) => limit !== undefined || where !== undefined,
        ),
        JSON.stringify(
          loads.map(({ limit, offset, cursor, orderBy, where }) => ({
            limit,
            offset,
            cursor: cursor !== undefined,
            orderBy: orderBy !== undefined,
            where: where !== undefined,
          })),
        ),
      ).toBe(true)
    } finally {
      await cleanupAll(live, source)
    }
  })

  it.each([`forward`, `reverse`] as const)(
    `keeps concurrent on-demand windows correct under %s completion`,
    async (scenario) => {
      await expectOnDemandWindowsAreCompletionOrderIndependent(scenario)
    },
  )
})
