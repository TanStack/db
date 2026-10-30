// Installed-SDK delivery cases whose expectations are written by hand: an
// ordinary subset snapshot, an externally aborted subset, a partial cache after
// cold restart, ordered concurrent snapshots, a persisted restart, and scoped
// restarts that quarantine uncertified cache rows. The delivery laws they
// illustrate are owned by
// electric-sdk-delivery-oracle.property.test.ts.
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import {
  SQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import {
  atCheckpoint,
  withElectricCleanup,
  withElectricSetup,
} from './electric-oracle-lifecycle'
import {
  managedTagPersistence,
  nodeSqliteDriver,
} from './electric-persistence-fixture'
import {
  controlledCoordinator,
  controlledHttp,
  deferred,
  headers,
  recordVisibilityListeners,
} from './electric-sdk-delivery-support'
import type { Item, Request } from './electric-sdk-delivery-support'
import type { SyncPersistenceCapabilityV1 } from '@tanstack/db'
import type { TestRow } from './electric-persistence-fixture'
import type { ElectricCollectionUtils } from '../src/electric'

let sequence = 0

it(`lets requestSnapshot own the warm transport`, async () => {
  const http = controlledHttp()
  let delivery = deferred<void>()
  const subscribe = ShapeStream.prototype.subscribe
  const spy = await withElectricSetup(
    () =>
      vi.spyOn(ShapeStream.prototype, `subscribe`).mockImplementation(function (
        this: ShapeStream,
        callback,
        onError,
      ) {
        return subscribe.call(
          this,
          (messages) => {
            const result = callback(messages)
            delivery.resolve()
            return result
          },
          onError,
        )
      }),
    [
      {
        label: `warm HTTP provider during spy setup`,
        release: () => http.close(),
      },
    ],
  )
  const collection = await withElectricSetup(
    () =>
      createCollection(
        electricCollectionOptions<Item>({
          id: `sdk-warm-snapshot-${++sequence}`,
          shapeOptions: {
            url: `http://test-url/warm-snapshot-${sequence}`,
            params: { table: `rows` },
            fetchClient: http.fetchClient,
          },
          syncMode: `on-demand`,
          startSync: true,
          getKey: (row) => row.id,
        }),
      ),
    [
      { label: `warm HTTP provider during setup`, release: () => http.close() },
      {
        label: `warm subscription spy during setup`,
        release: () => spy.mockRestore(),
      },
    ],
  )

  return withElectricCleanup(async () => {
    const initial = await atCheckpoint(http.take(), `initial live request`)
    initial.respond(
      new Response(
        JSON.stringify([
          {
            headers: {
              control: `up-to-date`,
              global_last_seen_lsn: `1`,
            },
          },
        ]),
        { headers: headers(1) },
      ),
    )
    await atCheckpoint(delivery.promise, `initial up-to-date delivery`)

    // Hold the next live poll. The installed SDK's requestSnapshot owns the
    // pause/abort transition from this poll to the subset request.
    await atCheckpoint(http.take(), `warm live poll`)
    delivery = deferred<void>()
    const loading = collection._sync.loadSubset({
      where: new IR.Func(`gte`, [new IR.PropRef([`id`]), new IR.Value(1)]),
    })
    const request = await atCheckpoint(
      http.takeAny(),
      `first request after warm loadSubset`,
    )
    expect(request.url.searchParams.has(`subset__where`)).toBe(true)
    expect(http.activeCount()).toBe(1)
    request.respond(
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: 2,
          },
          data: [],
        }),
        { headers: headers(2) },
      ),
    )
    await atCheckpoint(delivery.promise, `warm snapshot delivery`)
    await atCheckpoint(Promise.resolve(loading), `warm snapshot completion`)
  }, [
    { label: `warm collection`, release: () => collection.cleanup() },
    { label: `warm HTTP provider`, release: () => http.close() },
    { label: `warm subscription spy`, release: () => spy.mockRestore() },
    {
      label: `warm requests after provider closure`,
      release: () => expect(http.activeCount()).toBe(0),
    },
  ])
})

/**
 * The installed SDK can finish a subset HTTP response after the shared stream
 * was externally aborted. The stream can no longer apply that row, so the
 * adapter must reject the demand and leave its predicate uncertified. This
 * receives the oracle's external-abort law through the real requestSnapshot
 * transport rather than relying on a mocked provider promise.
 */
it(`does not certify an aborted SDK subset snapshot`, async () => {
  const http = controlledHttp()
  const external = new AbortController()
  const collection = createCollection(
    electricCollectionOptions<Item>({
      id: `sdk-subset-abort-${++sequence}`,
      shapeOptions: {
        url: `http://test-url/subset-abort-${sequence}`,
        params: { table: `rows` },
        fetchClient: http.fetchClient,
        signal: external.signal,
      },
      syncMode: `on-demand`,
      startSync: true,
      getKey: (row) => row.id,
    }),
  )

  await withElectricCleanup(async () => {
    await atCheckpoint(http.take(), `abortable live transport`)
    const first = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
    void first.catch(() => undefined)
    const request = await atCheckpoint(http.take(true), `abortable subset HTTP`)
    external.abort()
    request.respond(
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: 1,
          },
          data: [
            {
              key: `1`,
              value: { id: `1`, name: `discarded` },
              headers: { operation: `insert` },
            },
          ],
        }),
        { headers: headers(2) },
      ),
    )
    await expect(
      atCheckpoint(first, `externally aborted SDK subset`),
    ).rejects.toMatchObject({ name: `AbortError` })
    expect(collection.has(1)).toBe(false)
    const second = collection._sync.loadSubset({ limit: 1 })
    expect(second).not.toBe(true)
    await expect(Promise.resolve(second)).rejects.toMatchObject({
      name: `AbortError`,
    })
  }, [() => collection.cleanup(), () => http.close()])
})

/**
 * An expired run can rotate without Electric reset metadata, then persist one
 * demanded source row in its private generation. That row is a partial cache,
 * not an offline source snapshot. After a cold restart, the provider model has
 * no matching row. Real SQLite supplies incompatible key-set evidence and no
 * resume record; the installed SDK holds an empty subset HTTP response. Before
 * and after that response, the public Collection must not expose the stale
 * cached row. The generation must rotate before it can serve the new demand,
 * even when the caller supplies an explicit source offset or handle. Those
 * source cursor options do not certify the persisted cache's key set.
 */
it.each([
  { cursor: `none`, shapeCursor: {} },
  { cursor: `explicit offset`, shapeCursor: { offset: `now` as const } },
  { cursor: `explicit handle`, shapeCursor: { handle: `explicit-shape` } },
])(
  `keeps a partial cache without a reset marker private after cold restart with $cursor`,
  async ({ shapeCursor }) => {
    const database = new DatabaseSync(`:memory:`)
    const adapter = new SQLiteCorePersistenceAdapter({
      driver: nodeSqliteDriver(database),
    })
    const collectionId = `sdk-cold-expired-cache-${++sequence}`
    const first = await adapter.claimCacheGeneration(collectionId)
    const partial = await adapter.rotateCacheGeneration(
      collectionId,
      first.claimId,
    )
    await adapter.applyCommittedTx(
      {
        kind: `managed`,
        storageCollectionId: partial.storageCollectionId,
        claimId: partial.claimId,
      },
      {
        txId: `partial-subset-row`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: partial.claimId,
        mutations: [
          {
            type: `insert`,
            key: 1,
            value: { id: 1, name: `stale-partial` },
          },
        ],
      },
    )
    const seeded = await adapter.loadResumeSnapshot(
      {
        kind: `managed`,
        storageCollectionId: partial.storageCollectionId,
        claimId: partial.claimId,
      },
      { cacheGenerationClaimId: partial.claimId },
    )
    expect(seeded.keySet).toEqual({ status: `incompatible` })
    expect(seeded.collectionMetadata).toEqual([])
    await adapter.releaseCacheGenerationClaim(partial.claimId)

    const http = controlledHttp()
    const electric = electricCollectionOptions<Item>({
      id: collectionId,
      shapeOptions: {
        url: `http://test-url/${collectionId}`,
        params: { table: `rows` },
        fetchClient: http.fetchClient,
        ...shapeCursor,
      },
      syncMode: `on-demand`,
      startSync: true,
      getKey: (row) => row.id,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        ElectricCollectionUtils<Item>
      >({ ...electric, persistence: { adapter } }),
    )

    try {
      await withElectricCleanup(async () => {
        const stream = await atCheckpoint(http.take(), `cold restart stream`)
        expect(stream.url.searchParams.get(`log`)).toBe(`changes_only`)
        const load = Promise.resolve(
          collection._sync.loadSubset({
            where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(1)]),
          }),
        )
        void load.catch(() => undefined)
        const request = await atCheckpoint(
          http.take(true),
          `cold restart source snapshot`,
        )
        expect(collection.get(1), `before source evidence`).toBeUndefined()
        const current = await adapter.claimCacheGeneration(collectionId)
        try {
          expect(current.storageCollectionId).not.toBe(
            partial.storageCollectionId,
          )
        } finally {
          await adapter.releaseCacheGenerationClaim(current.claimId)
        }

        request.respond(
          new Response(
            JSON.stringify({
              metadata: {
                xmin: `10`,
                xmax: `20`,
                xip_list: [],
                database_lsn: `10`,
                snapshot_mark: 2,
              },
              data: [],
            }),
            { headers: headers(2) },
          ),
        )
        await atCheckpoint(load, `empty source snapshot applied`)
        expect(collection.status).toBe(`ready`)
        expect(collection.get(1), `after empty source evidence`).toBeUndefined()
      }, [() => collection.cleanup(), () => http.close()])
    } finally {
      database.close()
    }
  },
)

/**
 * Two active demands share one ShapeStream cursor. The source model gives each
 * predicate one row and increasing offsets. The second provider snapshot may
 * start only after the first settles; otherwise an older HTTP response can
 * overwrite a later row and regress that cursor. The SDK method invocation is
 * the checkpoint, while public rows verify both acquisitions still apply.
 */
it(`serializes concurrent subset snapshots on one SDK stream`, async () => {
  const http = controlledHttp()
  const requestSnapshot = vi.spyOn(ShapeStream.prototype, `requestSnapshot`)
  const collection = createCollection(
    electricCollectionOptions<Item>({
      id: `sdk-ordered-snapshots-${++sequence}`,
      shapeOptions: {
        url: `http://test-url/ordered-snapshots-${sequence}`,
        params: { table: `rows` },
        fetchClient: http.fetchClient,
      },
      syncMode: `on-demand`,
      startSync: true,
      getKey: (row) => row.id,
    }),
  )
  const demand = (id: number) => ({
    where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(id)]),
  })
  const respond = (request: Request, id: number) =>
    request.respond(
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: id,
          },
          data: [
            {
              key: String(id),
              value: { id: String(id), name: `row-${id}` },
              headers: { operation: `insert` },
            },
          ],
        }),
        { headers: headers(id + 1) },
      ),
    )
  await withElectricCleanup(async () => {
    await atCheckpoint(http.take(), `initial ordered-snapshot transport`)
    const first = Promise.resolve(collection._sync.loadSubset(demand(1)))
    const second = Promise.resolve(collection._sync.loadSubset(demand(2)))
    const firstRequest = await atCheckpoint(
      http.take(true),
      `first ordered snapshot`,
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(
      requestSnapshot,
      `second snapshot waits for first`,
    ).toHaveBeenCalledTimes(1)
    respond(firstRequest, 1)
    await atCheckpoint(first, `first ordered snapshot applied`)
    const secondRequest = await atCheckpoint(
      http.take(true),
      `second ordered snapshot`,
    )
    expect(requestSnapshot).toHaveBeenCalledTimes(2)
    respond(secondRequest, 2)
    await atCheckpoint(second, `second ordered snapshot applied`)
    expect(collection.toArray.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 1, name: `row-1` },
      { id: 2, name: `row-2` },
    ])
  }, [
    () => collection.cleanup(),
    () => http.close(),
    () => requestSnapshot.mockRestore(),
    () => expect(http.activeCount()).toBe(0),
  ])
})

/**
 * Restart demand must remain legal when recovery changes provider capability.
 * Electric's SDK permits requestSnapshot only in changes_only mode. The
 * LoadSubsetFn contract requires success to follow application of the rows
 * that establish the requested subset. This receiving witness uses the real
 * SDK with the same durable-storage seam as the tag-history owner.
 *
 * The independent model is a complete replacement row after the second
 * launch. Tagged and untagged launches differ only in provider acquisition:
 * the tagged launch cannot resume its prior cursor, but its on-demand stream
 * can start changes-only and request the active subset. The untagged neighbor
 * resumes its cursor. Both must satisfy the same subset demand.
 * A new descriptor and Collection discard all prior in-memory tag state.
 * This checks SDK behavior over controlled HTTP, not server tag generation,
 * native SQLite, or a separate operating-system process.
 * One source snapshot for id = 1 may satisfy the live query's active demand.
 * The receiver verifies that scope before returning the authored row. The
 * law judges applied rows and demand settlement, not the number of physical
 * snapshot requests.
 */
it.each(
  [false, true].flatMap((tagged) =>
    ([`direct`, `live-query`] as const).map((consumer) => ({
      tagged,
      consumer,
    })),
  ),
)(
  `satisfies subset demand after a fresh persisted launch, tagged=$tagged consumer=$consumer`,
  async ({ tagged, consumer }) => {
    const { adapter, rows, metadata } = managedTagPersistence()
    const collectionId = `sdk-persisted-restart-${++sequence}`
    const http = controlledHttp()
    const firstRow: TestRow = { id: 1, name: `first`, stable: `retained` }
    const replacement: TestRow = { ...firstRow, name: `replacement` }
    const create = () =>
      createCollection(
        persistedCollectionOptions<
          TestRow,
          string | number,
          never,
          ElectricCollectionUtils<TestRow>
        >({
          ...electricCollectionOptions<TestRow>({
            id: collectionId,
            shapeOptions: {
              url: `http://test-url/${collectionId}`,
              params: { table: `rows` },
              fetchClient: http.fetchClient,
            },
            syncMode: `on-demand`,
            startSync: true,
            getKey: (row) => row.id,
          }),
          persistence: { adapter },
        }),
      )
    const message = (row: TestRow) => ({
      key: String(row.id),
      value: { ...row, id: String(row.id) },
      headers: {
        operation: `insert`,
        ...(tagged ? { tags: [`selected`] } : {}),
      },
    })
    const responseHeaders = (offset: number) => ({
      ...headers(offset),
      'electric-schema': JSON.stringify({
        id: { type: `int4` },
        name: { type: `text` },
        stable: { type: `text` },
      }),
    })
    const snapshotResponse = (row: TestRow, offset: number) =>
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: offset,
          },
          data: [message(row)],
        }),
        { headers: responseHeaders(offset) },
      )
    const demand = {
      where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(1)]),
    }
    const expectIdOneSnapshot = (request: Request) => {
      expect(request.url.searchParams.get(`subset__where`)).toBe(`"id" = $1`)
      expect(
        JSON.parse(request.url.searchParams.get(`subset__params`) ?? `null`),
      ).toEqual({ 1: `1` })
    }
    const first = create()
    let current = first
    let cleanupQuery = () => Promise.resolve()
    await withElectricCleanup(async () => {
      const initial = await atCheckpoint(
        http.take(),
        `first launch stream started`,
      )
      expect(initial.url.searchParams.get(`log`)).toBe(`changes_only`)
      const firstLoad = Promise.resolve(first._sync.loadSubset(demand))
      void firstLoad.catch(() => undefined)
      const request = await atCheckpoint(
        http.take(true),
        `first launch snapshot`,
      )
      expectIdOneSnapshot(request)
      request.respond(snapshotResponse(firstRow, 2))
      await atCheckpoint(firstLoad, `first launch subset applied`)
      await vi.waitFor(
        () =>
          expect(metadata().get(`electric:resume`)).toMatchObject({
            kind: `resume`,
            requiresTagState: tagged,
          }),
        { interval: 1 },
      )
      expect(rows().get(1)?.value).toEqual(firstRow)
      await first.cleanup()

      current = create()
      const resumed = await atCheckpoint(
        http.take(),
        `second launch stream started`,
      )
      expect(resumed.url.searchParams.get(`log`)).toBe(`changes_only`)
      expect(resumed.url.searchParams.get(`offset`)).toBe(
        tagged ? `now` : `2_0`,
      )
      const query =
        consumer === `live-query`
          ? createLiveQueryCollection({
              startSync: false,
              query: (q) =>
                q
                  .from({ row: current })
                  .where(({ row }) => eq(row.id, 1))
                  .select(({ row }) => ({
                    id: row.id,
                    name: row.name,
                    stable: row.stable,
                  })),
            })
          : undefined
      if (query) cleanupQuery = () => query.cleanup()
      const loading = Promise.resolve(
        query ? query.preload() : current._sync.loadSubset(demand),
      ).then(
        () => ({ kind: `fulfilled` as const }),
        (error: unknown) => ({
          kind: `rejected` as const,
          error: String(error),
        }),
      )
      const resumedSnapshot = await atCheckpoint(
        http.take(true),
        `resumed subset snapshot`,
      )
      expectIdOneSnapshot(resumedSnapshot)
      resumedSnapshot.respond(snapshotResponse(replacement, 3))
      const outcome = await atCheckpoint(
        loading,
        `second launch subset settled`,
      )
      await vi.waitFor(() => expect(current.status).toBe(`ready`), {
        interval: 1,
      })
      await vi.waitFor(
        () => expect(rows().get(1)?.value).toEqual(replacement),
        {
          interval: 1,
        },
      )
      // Observe settlement as well as rows. A ready Collection with correct
      // rows cannot excuse a rejected subset acquisition.
      expect({
        outcome,
        status: current.status,
        row: current.get(1),
      }).toMatchObject({
        outcome: { kind: `fulfilled` },
        status: `ready`,
        row: replacement,
      })
      if (query) {
        expect(query.status).toBe(`ready`)
        // This law observes selected payload values, not virtual metadata.
        expect(
          query.toArray.map(({ id, name, stable }) => ({ id, name, stable })),
        ).toEqual([replacement])
      }
    }, [
      () => cleanupQuery(),
      () => current.cleanup(),
      () => first.cleanup(),
      () => http.close(),
      () => expect(http.activeCount()).toBe(0),
    ])
  },
)

/**
 * A persisted source row is only a cache after tag state is lost. The source
 * model starts with A and B, then changes A and removes B while the Collection
 * is closed. Only A is active at the second launch. Its scoped snapshot may
 * establish A, but neither the old B row nor a later empty B snapshot may
 * re-admit B from SQLite. This driver observes HTTP scope, durable rows, local
 * reads, public rows, and acquisition settlement at each cut. The controlled
 * provider supplies authoritative responses for the requested predicates;
 * live-server framing and native storage remain separate receiving boundaries.
 * A local cache clear is not source readiness: the restarted Collection stays
 * loading at the stream-request cut, before Electric sends source evidence.
 */
it.each([
  { cause: `lost tags`, tagged: true, nextTable: `rows` },
  { cause: `changed shape`, tagged: false, nextTable: `other_rows` },
  {
    cause: `malformed resume state`,
    tagged: false,
    nextTable: `rows`,
    malformed: true,
  },
])(
  `quarantines uncertified cache rows across later scoped demands after $cause`,
  async ({ tagged, nextTable, malformed }) => {
    const fixture = managedTagPersistence()
    const { adapter, rows, metadata } = fixture
    const baselineReads = vi.spyOn(adapter, `loadResumeSnapshot`)
    const http = controlledHttp()
    const collectionId = `sdk-scoped-restart-${++sequence}`
    const coordinator = controlledCoordinator(collectionId)
    let currentCapability: SyncPersistenceCapabilityV1<string | number> | null =
      null
    const source = new Map<number, TestRow>([
      [1, { id: 1, name: `old-a`, stable: `a` }],
      [2, { id: 2, name: `old-b`, stable: `b` }],
    ])
    const demand = (id: number) => ({
      where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(id)]),
    })
    const create = (table = `rows`) => {
      const electricOptions = electricCollectionOptions<TestRow>({
        id: collectionId,
        shapeOptions: {
          url: `http://test-url/${collectionId}`,
          params: { table },
          fetchClient: http.fetchClient,
        },
        syncMode: `on-demand`,
        startSync: true,
        getKey: (row) => row.id,
      })
      return createCollection(
        persistedCollectionOptions<
          TestRow,
          string | number,
          never,
          ElectricCollectionUtils<TestRow>
        >({
          ...electricOptions,
          sync: {
            ...electricOptions.sync,
            sync: (params) => {
              currentCapability = params.metadata?.persistence ?? null
              return electricOptions.sync.sync(params)
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
    }
    const respond = (
      request: Request,
      result: Array<TestRow>,
      offset: number,
    ) =>
      request.respond(
        new Response(
          JSON.stringify({
            metadata: {
              xmin: `10`,
              xmax: `20`,
              xip_list: [],
              database_lsn: `10`,
              snapshot_mark: offset,
            },
            data: result.map((row) => ({
              key: String(row.id),
              value: { ...row, id: String(row.id) },
              headers: {
                operation: `insert`,
                ...(tagged ? { tags: [`selected`] } : {}),
              },
            })),
          }),
          {
            headers: {
              ...headers(offset),
              'electric-schema': JSON.stringify({
                id: { type: `int4` },
                name: { type: `text` },
                stable: { type: `text` },
              }),
            },
          },
        ),
      )
    const publicRows = (collection: ReturnType<typeof create>) =>
      collection.toArray
        .map(({ id, name, stable }) => ({ id, name, stable }))
        .sort((a, b) => a.id - b.id)
    const first = create()
    let current = first
    let localReads: { mockRestore: () => void } | undefined
    await withElectricCleanup(async () => {
      await atCheckpoint(http.take(), `initial changes-only transport`)
      for (const [id, row] of source) {
        const loading = Promise.resolve(first._sync.loadSubset(demand(id)))
        const request = await atCheckpoint(
          http.take(true),
          `initial subset ${id}`,
        )
        respond(request, [row], id + 1)
        await atCheckpoint(loading, `initial subset ${id} applied`)
      }
      expect(publicRows(first)).toEqual([...source.values()])
      expect(rows().size).toBe(2)
      expect(metadata().get(`electric:resume`)).toMatchObject({
        kind: `resume`,
        requiresTagState: tagged,
      })
      await first.cleanup()
      baselineReads.mockClear()
      if (malformed) {
        metadata().set(`electric:resume`, { kind: `resume`, offset: 10 })
      }
      const oldStorageId = fixture.currentStorageId()

      source.set(1, { id: 1, name: `new-a`, stable: `a` })
      source.delete(2)
      localReads = vi.spyOn(adapter, `loadSubset`)
      current = create(nextTable)
      const resumed = await atCheckpoint(
        http.take(),
        `scoped restart transport`,
      )
      expect(resumed.url.searchParams.get(`log`)).toBe(`changes_only`)
      expect(resumed.url.searchParams.get(`offset`)).toBe(`now`)
      expect(publicRows(current), `before active demand`).toEqual([])
      expect(current.status, `before source readiness`).toBe(`loading`)
      expect(baselineReads, `startup metadata read`).toHaveBeenCalled()
      expect(
        baselineReads.mock.calls.every(
          ([, context]) => context?.includeRows !== true,
        ),
        `no full baseline row read`,
      ).toBe(true)

      if (!tagged) {
        // An empty first source snapshot must still establish its own demand
        // without promoting the stale durable B row into the Collection.
        const emptyFirst = Promise.resolve(current._sync.loadSubset(demand(2)))
        const emptyRequest = await atCheckpoint(
          http.take(true),
          `first empty scoped snapshot`,
        )
        expect(localReads).not.toHaveBeenCalled()
        respond(emptyRequest, [], 4)
        await atCheckpoint(emptyFirst, `first empty subset applied`)
        expect(publicRows(current), `after first empty subset`).toEqual([])
      }

      const loadingA = Promise.resolve(
        current._sync.loadSubset({ ...demand(1), limit: 10 }),
      )
      const requestA = await atCheckpoint(http.take(true), `scoped A snapshot`)
      expect(requestA.url.searchParams.get(`subset__where`)).toContain(`id`)
      expect(localReads).not.toHaveBeenCalled()
      respond(requestA, [source.get(1)!], tagged ? 4 : 5)
      await atCheckpoint(loadingA, `scoped A applied`)
      expect(publicRows(current), `after A applied`).toEqual([source.get(1)])
      expect(
        fixture.rowsAt(oldStorageId).get(2)?.value,
        `durable B retained`,
      ).toEqual({
        id: 2,
        name: `old-b`,
        stable: `b`,
      })

      // A second tab updates durable cache outside the active A demand. The
      // provider has not sent another source change, so the public A row still
      // follows its applied source snapshot. The capability scan fences the
      // coordinator's async handling before this public observation.
      const durablePosition = await adapter.loadResumeSnapshot(
        { kind: `eager`, collectionId: collectionId },
        {
          includeRows: false,
        },
      )
      const otherTabRow: TestRow = {
        id: 3,
        name: `other-tab-cache`,
        stable: `c`,
      }
      source.set(3, otherTabRow)
      rows().set(3, { value: otherTabRow })
      coordinator.emit({
        type: `tx:committed`,
        term: durablePosition.latestTerm,
        seq: durablePosition.latestSeq + 1,
        txId: `other-tab-cache-update`,
        latestRowVersion: durablePosition.latestRowVersion + 1,
        requiresFullReload: false,
        changedRows: [{ key: 3, value: otherTabRow }],
        deletedKeys: [],
      })
      expect(currentCapability?.scanPersistedRows).toBeTypeOf(`function`)
      await currentCapability!.scanPersistedRows()
      expect(publicRows(current), `after coordinator invalidation`).toEqual([
        source.get(1),
      ])

      if (tagged) {
        // The coordinator may refresh A, but the new physical cache does not
        // require that request. Service it first only if the provider sends
        // it; either path must leave B absent after B's empty snapshot.
        const loadingB = Promise.resolve(current._sync.loadSubset(demand(2)))
        let requestB = await atCheckpoint(http.take(true), `empty B snapshot`)
        let bOffset = 5
        if (requestB.url.searchParams.get(`subset__params`)?.includes(`:"1"`)) {
          respond(requestB, [source.get(1)!], 5)
          requestB = await atCheckpoint(http.take(true), `empty B snapshot`)
          bOffset = 6
        }
        expect(requestB.url.searchParams.get(`subset__params`)).toContain(`"2"`)
        expect(publicRows(current), `while B is pending`).toEqual([
          source.get(1),
        ])
        expect(localReads).not.toHaveBeenCalled()
        respond(requestB, [], bOffset)
        await atCheckpoint(loadingB, `empty B applied`)
        expect(publicRows(current), `after empty B applied`).toEqual([
          source.get(1),
        ])
      }
      expect(metadata().get(`electric:resume`)).toMatchObject({ kind: `reset` })

      await current.cleanup()
      localReads.mockRestore()
      localReads = vi.spyOn(adapter, `loadSubset`)
      current = create(nextTable)
      const idle = await atCheckpoint(http.take(), `idle scoped restart`)
      expect(idle.url.searchParams.get(`log`)).toBe(`changes_only`)
      expect(idle.url.searchParams.get(`offset`)).toBe(`now`)
      expect(publicRows(current), `no active demand`).toEqual([])
      expect(localReads, `no unrestricted local read`).not.toHaveBeenCalled()
      expect(
        baselineReads.mock.calls.every(
          ([, context]) => context?.includeRows !== true,
        ),
        `no full baseline row read without demand`,
      ).toBe(true)
      expect(
        fixture.rowsAt(oldStorageId).get(2)?.value,
        `cache retained without demand`,
      ).toMatchObject({
        id: 2,
        name: `old-b`,
      })
    }, [
      () => current.cleanup(),
      () => first.cleanup(),
      () => http.close(),
      () => localReads?.mockRestore(),
      () => baselineReads.mockRestore(),
      () => expect(http.activeCount()).toBe(0),
    ])
  },
)

// EventTarget identifies a listener by callback and capture, coalesces duplicate
// additions, and applies removals in order (DOM Standard, "EventTarget"). This
// bounded calibration sends every sequence of up to three add/remove calls
// through the real EventTarget, then compares dispatch with the recorder before
// teardown. Two callbacks and both capture modes distinguish wrong identities;
// omitted, boolean, and object options distinguish equivalent capture spellings.
// Three calls reach add/remove/re-add. Once and signal options are outside this
// recorder's installed-SDK domain.
it(`records EventTarget ownership across bounded listener histories`, () => {
  type Step = {
    add: boolean
    callback: number
    options: boolean | { capture: boolean } | undefined
  }
  const options = [
    undefined,
    false,
    true,
    { capture: false },
    { capture: true },
  ]
  const steps: Array<Step> = [false, true].flatMap((add) =>
    [0, 1].flatMap((callback) =>
      options.map((capture) => ({ add, callback, options: capture })),
    ),
  )
  function* histories(prefix: Array<Step> = []): Generator<Array<Step>> {
    yield prefix
    if (prefix.length < 3)
      for (const step of steps) yield* histories([...prefix, step])
  }
  let checked = 0
  for (const history of histories()) {
    const listeners = recordVisibilityListeners()
    const callbacks = [vi.fn(), vi.fn()]
    try {
      for (const step of history) {
        const callback = callbacks[step.callback]!
        if (step.add)
          document.addEventListener(`visibilitychange`, callback, step.options)
        else
          document.removeEventListener(
            `visibilitychange`,
            callback,
            step.options,
          )
      }
      document.dispatchEvent(new Event(`visibilitychange`))
      // Native dispatch supplies the independent count, including both capture
      // identities of one callback. Teardown cannot change this observation.
      const dispatched = callbacks.reduce(
        (count, callback) => count + callback.mock.calls.length,
        0,
      )
      expect(listeners.live(), JSON.stringify(history)).toBe(dispatched)
      checked++
    } finally {
      listeners.restore()
      for (const callback of callbacks) {
        document.removeEventListener(`visibilitychange`, callback, false)
        document.removeEventListener(`visibilitychange`, callback, true)
      }
    }
  }
  expect(checked).toBe(8421)
}, 60_000)

// Teardown must preserve a failed comparison and release its registrations.
// Enumerate every retained subset of three fresh callbacks. Dispatch observes
// actual EventTarget ownership independently of the recorder's live count.
it(`releases recorded listeners after preserving a primary failure`, async () => {
  for (let retained = 0; retained < 8; retained++) {
    const listeners = recordVisibilityListeners()
    const callbacks = Array.from({ length: 3 }, () => vi.fn())
    const primary = new Error(`listener comparison failed`)
    try {
      await expect(
        withElectricCleanup(() => {
          for (const [index, callback] of callbacks.entries()) {
            document.addEventListener(`visibilitychange`, callback)
            if ((retained & (1 << index)) === 0)
              document.removeEventListener(`visibilitychange`, callback)
          }
          expect(listeners.registered()).toBe(3)
          throw primary
        }, [() => listeners.restore()]),
      ).rejects.toBe(primary)
      document.dispatchEvent(new Event(`visibilitychange`))
      for (const callback of callbacks) expect(callback).not.toHaveBeenCalled()
    } finally {
      // Independent cleanup also makes this calibration safe on the old recorder.
      for (const callback of callbacks)
        document.removeEventListener(`visibilitychange`, callback)
      listeners.restore()
    }
  }
})
