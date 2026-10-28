// Ordinary tests for the ordered lifecycle: fixed histories and cleanup checks
// with literal expectations. They are supplemental coverage. The laws they
// touch (initial settlement, warm readiness, and full-source replay) are owned
// by ordered-lifecycle-oracle.property.test.ts.
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  createLiveQueryCollection,
  eq,
  isUndefined,
  not,
} from '../../src/query/index.js'
import { flushPromises } from '../utils.js'
import {
  finishOracleCleanup,
  fullSourceFeatures,
  observeFullSourceReplay,
} from './ordered-lifecycle-support.js'
import type {
  CapturedOracleFailure,
  InitialSettlementObservation,
} from './ordered-lifecycle-support.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

describe(`oracle harness failure fidelity`, () => {
  it(`preserves the primary mismatch and every cleanup diagnostic`, async () => {
    const primary = new Error(`primary mismatch`)
    const firstCleanup = new Error(`first cleanup failed`)
    const secondCleanup = new Error(`second cleanup failed`)
    const attempted: Array<string> = []
    let observed: unknown

    try {
      await finishOracleCleanup(
        { error: primary },
        [
          () => {
            attempted.push(`first`)
            throw firstCleanup
          },
          () => {
            attempted.push(`second`)
            throw secondCleanup
          },
        ],
        `Hostile cleanup control`,
      )
    } catch (error) {
      observed = error
    }

    expect(attempted).toEqual([`first`, `second`])
    expect(observed).toBeInstanceOf(AggregateError)
    expect((observed as AggregateError).cause).toBe(primary)
    expect((observed as AggregateError).errors).toEqual([
      primary,
      firstCleanup,
      secondCleanup,
    ])
  })
})

describe(`synchronous initial settlement refinement`, () => {
  // The synchronous cut covers the initial load. For a query that must read
  // its whole source first (here a function filter), the initial load is its
  // first full-source request. When the source answers with literal `true`,
  // the query is ready with its rows at creation. Full-source work after that
  // initial window and a full-source repair remain outside this guarantee.
  it(`publishes an eager full-source ordered window at creation`, async () => {
    const source = createCollection<{ id: number; rank: number }, number>({
      id: `full-source-initial-${Math.random()}`,
      getKey: (row) => row.id,
      syncMode: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (let id = 0; id < 5; id++) {
            write({ type: `insert`, value: { id, rank: id } })
          }
          commit()
          markReady()
        },
      },
    })
    source.createIndex((row) => row.rank, { indexType: BTreeIndex })
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ row: source })
          .fn.where(({ row }) => row.rank >= 0)
          .orderBy(({ row }) => row.rank, `desc`)
          .limit(2),
    })
    try {
      expect({
        status: query.status,
        rows: query.toArray.map((row) => row.id),
      }).toEqual({ status: `ready`, rows: [4, 3] })
    } finally {
      await query.cleanup()
      await source.cleanup()
    }
  })

  // The initial full-source cut and #2055's joined-filter rule meet here. A
  // function filter makes the plan read its whole source, so its synchronous
  // initial load installs every source row. #2055's hazard needs a bounded read
  // that left an eligible row out; after a full read the window can always
  // reach the next eligible row, even when a distant row entered through a live
  // update first. This pins that the synchronous initial load keeps that
  // property through later changes.
  it(`keeps the first eligible joined rows after a synchronous full-source load`, async () => {
    type Row = { id: number; rank: number; label: string }
    let source: Parameters<SyncConfig<Row, number>[`sync`]>[0] | undefined
    const writeRow = (
      message: { type: `update`; value: Row } | { type: `delete`; key: number },
    ) => {
      source!.begin()
      source!.write(message)
      source!.commit()
    }
    const rows = createCollection<Row, number>({
      id: `full-source-joined-rows-${Math.random()}`,
      getKey: (row) => row.id,
      syncMode: `eager`,
      startSync: true,
      sync: {
        sync: (params) => {
          source = params
          params.begin()
          for (let id = 1; id <= 10; id++) {
            params.write({
              type: `insert`,
              value: { id, rank: id, label: `a` },
            })
          }
          params.commit()
          params.markReady()
        },
      },
    })
    rows.createIndex((row) => row.rank, { indexType: BTreeIndex })
    const markers = createCollection<{ id: number; rowId: number }, number>({
      id: `full-source-joined-markers-${Math.random()}`,
      getKey: (marker) => marker.id,
      syncMode: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (let id = 2; id <= 10; id += 2) {
            write({ type: `insert`, value: { id, rowId: id } })
          }
          commit()
          markReady()
        },
      },
    })
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ row: rows })
          .leftJoin({ marker: markers }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ marker }) => not(isUndefined(marker.rowId)))
          .fn.where(({ row }) => row.rank > 0)
          .orderBy(({ row }) => row.rank)
          .limit(1),
    })
    const ids = () => query.toArray.map((result) => result.row.id)
    try {
      expect({ status: query.status, ids: ids() }).toEqual({
        status: `ready`,
        ids: [2],
      })
      // A label-only update brings the distant row 10 into the graph.
      writeRow({ type: `update`, value: { id: 10, rank: 10, label: `b` } })
      await flushPromises()
      expect(ids()).toEqual([2])
      // Deleting the visible row must expose the next eligible row, 4.
      writeRow({ type: `delete`, key: 2 })
      await flushPromises()
      expect(ids()).toEqual([4])
    } finally {
      await query.cleanup()
      await markers.cleanup()
      await rows.cleanup()
    }
  })

  it(`processes sibling source input before draining an ordered continuation`, async () => {
    type LeftRow = { id: number; group: string; rank: number }
    type RightRow = { id: number; group: string }

    let rightSync!: Parameters<SyncConfig<RightRow, number>[`sync`]>[0]
    const right = createCollection<RightRow, number>({
      id: `ordered-initial-cross-source-right`,
      getKey: ({ id }) => id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          rightSync = operations
          operations.markReady()
        },
      },
    })

    const requests: Array<LoadSubsetOptions> = []
    let wroteSiblingInput = false
    const left = createCollection<LeftRow, number>({
      id: `ordered-initial-cross-source-left`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              requests.push(options)
              if (requests.length === 1) {
                begin()
                write({
                  type: `insert`,
                  value: { id: 1, group: `shared`, rank: 1 },
                })
                expect(commit()).toBe(true)
              } else if (!wroteSiblingInput) {
                wroteSiblingInput = true
                rightSync.begin()
                rightSync.write({
                  type: `insert`,
                  value: { id: 10, group: `shared` },
                })
                rightSync.write({
                  type: `insert`,
                  value: { id: 11, group: `shared` },
                })
                expect(rightSync.commit()).toBe(true)
              }
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })

    const live = createLiveQueryCollection({
      id: `ordered-initial-cross-source-live`,
      startSync: false,
      query: (q) =>
        q
          .from({ left })
          .leftJoin({ right }, ({ left: leftRow, right: rightRow }) =>
            eq(leftRow.group, rightRow.group),
          )
          .orderBy(({ left: leftRow }) => leftRow.rank)
          .limit(2)
          .select(({ left: leftRow, right: rightRow }) => ({
            id: leftRow.id,
            rightId: rightRow.id,
          })),
    })
    const readyRows: Array<Array<number | undefined>> = []
    const unsubscribeStatus = live.on(`status:ready`, () => {
      readyRows.push(live.toArray.map(({ rightId }) => rightId))
    })

    try {
      const preload = live.preload()
      const immediate = {
        rows: live.toArray.map(({ rightId }) => rightId),
        status: live.status,
      }
      await preload

      expect(wroteSiblingInput).toBe(true)
      expect(
        requests.map(({ orderBy, limit, offset, where, cursor }) => ({
          orderTerms: orderBy?.length ?? 0,
          limit,
          offset,
          hasWhere: where !== undefined,
          hasCursor: cursor !== undefined,
        })),
      ).toEqual([
        {
          orderTerms: 1,
          limit: 2,
          offset: 0,
          hasWhere: false,
          hasCursor: false,
        },
        {
          orderTerms: 0,
          limit: undefined,
          offset: undefined,
          hasWhere: true,
          hasCursor: false,
        },
      ])
      expect(readyRows).toEqual([[10, 11]])
      expect(immediate).toEqual({ rows: [10, 11], status: `ready` })
      expect({
        rows: live.toArray.map(({ rightId }) => rightId),
        status: live.status,
      }).toEqual({ rows: [10, 11], status: `ready` })
    } finally {
      unsubscribeStatus()
      await Promise.all([live.cleanup(), left.cleanup(), right.cleanup()])
    }
  })
})

describe(`warm ordered readiness oracle`, () => {
  // The four remote rows have the ascending order [3, 4, 1, 2], with null
  // last. When preload starts the live-query sync run, a warm literal-true
  // response to each acquisition owes that complete window and `ready` before
  // the call returns. A constructor-started sync run resumes deferred
  // on-demand acquisition asynchronously, so it owes the same window after
  // settlement. The zero-limit neighbor needs no acquisition.
  it.each([
    { limit: 0, startsAtConstruction: false, expectedRequests: [] },
    {
      limit: 50,
      startsAtConstruction: false,
      expectedRequests: [
        { ordered: true, filtered: false, limit: 50 },
        { ordered: false, filtered: false, limit: undefined },
      ],
    },
    {
      limit: 50,
      startsAtConstruction: true,
      expectedRequests: [
        { ordered: true, filtered: false, limit: 50 },
        { ordered: false, filtered: false, limit: undefined },
      ],
    },
  ])(
    `settles a retained $limit-row window after an async cold prime (constructor start: $startsAtConstruction)`,
    async ({ limit, startsAtConstruction, expectedRequests }) => {
      type DatedRow = { id: number; createdAt: Date | null }
      const remote: Array<DatedRow> = [
        { id: 1, createdAt: new Date(`2026-01-03T00:00:00.000Z`) },
        { id: 2, createdAt: null },
        { id: 3, createdAt: new Date(`2026-01-01T00:00:00.000Z`) },
        { id: 4, createdAt: new Date(`2026-01-02T00:00:00.000Z`) },
      ]
      const installed = new Set<number>()
      const warmRequests: Array<{
        ordered: boolean
        filtered: boolean
        limit: number | undefined
      }> = []
      let cold = true
      const source = createCollection<DatedRow, number>({
        id: `warm-ordered-readiness-${limit}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                if (!cold) {
                  warmRequests.push({
                    ordered: options.orderBy !== undefined,
                    filtered: options.where !== undefined,
                    limit: options.limit,
                  })
                }
                const missing = remote.filter(({ id }) => !installed.has(id))
                if (missing.length > 0) {
                  begin()
                  for (const row of missing) {
                    installed.add(row.id)
                    write({ type: `insert`, value: row })
                  }
                  commit()
                }
                return cold ? Promise.resolve() : true
              },
            }
          },
        },
      })
      const query = (queryLimit: number, startSync = true) =>
        createLiveQueryCollection({
          query: (q) =>
            q
              .from({ row: source })
              .orderBy(({ row }) => row.createdAt, {
                direction: `asc`,
                nulls: `last`,
              })
              .limit(queryLimit),
          startSync,
        })
      const coldQuery = query(50)
      let warmQuery: ReturnType<typeof query> | undefined
      let observation:
        | {
            requestsAtCut: Array<{
              ordered: boolean
              filtered: boolean
              limit: number | undefined
            }>
            requestsAfterSettlement: Array<{
              ordered: boolean
              filtered: boolean
              limit: number | undefined
            }>
            immediate: InitialSettlementObservation
            settled: InitialSettlementObservation
            isLoadingSubset: boolean
          }
        | undefined
      let primaryFailure: CapturedOracleFailure | undefined
      try {
        await coldQuery.preload()
        cold = false
        warmQuery = query(limit, startsAtConstruction)
        // Preload starts a new sync run when startSync is false. When the
        // constructor started it, preload resumes deferred on-demand work
        // through the asynchronous subscription restart path. Both receive
        // the same warm rows, but only the first owes the synchronous cut.
        const requestsBeforePreload = [...warmRequests]
        const preload = warmQuery.preload()
        const requestsAtCut = [...warmRequests]
        const immediate = {
          status: warmQuery.status,
          rows: warmQuery.toArray.map(({ id }) => id),
        }
        await preload
        observation = {
          requestsAtCut,
          requestsAfterSettlement: [...warmRequests],
          immediate,
          settled: {
            status: warmQuery.status,
            rows: warmQuery.toArray.map(({ id }) => id),
          },
          isLoadingSubset: warmQuery.isLoadingSubset,
        }
        expect(requestsBeforePreload).toEqual([])
      } catch (error) {
        primaryFailure = { error }
      }
      await finishOracleCleanup(
        primaryFailure,
        [
          () => warmQuery?.cleanup(),
          () => coldQuery.cleanup(),
          () => source.cleanup(),
        ],
        `Warm ordered readiness oracle cleanup failed`,
      )
      expect(observation!.requestsAtCut).toEqual(
        startsAtConstruction ? expectedRequests.slice(0, 1) : expectedRequests,
      )
      expect(observation!.requestsAfterSettlement).toEqual(expectedRequests)
      expect(observation!.immediate).toEqual({
        status: startsAtConstruction ? `loading` : `ready`,
        rows: startsAtConstruction || limit === 0 ? [] : [3, 4, 1, 2],
      })
      expect(observation!.settled).toEqual({
        status: `ready`,
        rows: limit === 0 ? [] : [3, 4, 1, 2],
      })
      expect(observation!.isLoadingSubset).toBe(false)
    },
  )

  it(`makes a retained nonzero-offset prefix and boundary synchronously ready`, async () => {
    type WarmRow = { id: number; rank: number; tie: number }
    const remote: Array<WarmRow> = [
      { id: 1, rank: 1, tie: 1 },
      { id: 2, rank: 2, tie: 1 },
      { id: 3, rank: 3, tie: 1 },
      { id: 4, rank: 4, tie: 1 },
    ]
    const installed = new Set<number>()
    const warmRequests: Array<{
      ordered: boolean
      filtered: boolean
      limit: number | undefined
    }> = []
    let cold = true
    const source = createCollection<WarmRow, number>({
      id: `warm-offset-prefix-readiness`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              if (!cold) {
                warmRequests.push({
                  ordered: options.orderBy !== undefined,
                  filtered: options.where !== undefined,
                  limit: options.limit,
                })
              }
              const missing = remote.filter(({ id }) => !installed.has(id))
              if (missing.length > 0) {
                begin()
                for (const row of missing) {
                  installed.add(row.id)
                  write({ type: `insert`, value: row })
                }
                commit()
              }
              return cold ? Promise.resolve() : true
            },
          }
        },
      },
    })
    const query = () =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ row: source })
            .orderBy(({ row }) => row.rank, `asc`)
            .orderBy(({ row }) => row.tie, `asc`)
            .offset(1)
            .limit(2),
      })
    const owner = query()
    try {
      await owner.preload()
      cold = false
      const sibling = query()
      try {
        // Construction starts no provider work. The sibling's first preload
        // starts its sync run, and both warm acquisitions return true, so it
        // is ready before preload returns: the synchronous observation cut.
        expect(warmRequests).toEqual([])
        void sibling.preload()
        expect(sibling.status).toBe(`ready`)
        expect(sibling.toArray.map(({ id }) => id)).toEqual([2, 3])
        expect(warmRequests).toEqual([
          { ordered: true, filtered: false, limit: 3 },
          { ordered: false, filtered: true, limit: undefined },
        ])
      } finally {
        await sibling.cleanup()
      }
    } finally {
      await owner.cleanup()
      await source.cleanup()
    }
  })
})

describe(`synchronous initial full-source settlement refinement`, () => {
  it.each(fullSourceFeatures)(
    `keeps the %s full-source truncate replay behind its publication barrier`,
    async (feature) => {
      const observed = await observeFullSourceReplay(feature)
      // Replay is excluded from the synchronous cut: the prior window stays
      // published at the call that started the replay, even though the
      // provider answers it with literal `true`.
      expect(observed.immediate).toEqual([1, 2])
      expect(observed.settled).toEqual([2, 3])
    },
  )
})
