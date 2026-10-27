// Installed-SDK delivery cases whose expectations are written by hand: an
// ordinary subset snapshot, an externally aborted subset, a managed cache
// rotation, a partial cache after cold restart, ordered concurrent snapshots,
// and a persisted restart. The delivery laws they illustrate are owned by
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
  storageTargetId,
} from './electric-persistence-fixture'
import {
  controlledHttp,
  deferred,
  headers,
} from './electric-sdk-delivery-support'
import type { Item, Request } from './electric-sdk-delivery-support'
import type { TestRow } from './electric-persistence-fixture'
import type { ElectricCollectionUtils } from '../src/electric'
import type {
  PersistenceAdapter,
  SQLiteDriver,
} from '../../db-sqlite-persistence-core/src'

let sequence = 0

function toSqliteBinding(value: unknown): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  return String(value)
}

function nodeSqliteDriver(database: DatabaseSync): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) =>
      Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toSqliteBinding))
          .map((row) => ({ ...row })) as Array<never>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(toSqliteBinding))
      return Promise.resolve()
    },
    transaction: async (transaction) => {
      database.exec(`BEGIN IMMEDIATE`)
      try {
        const result = await transaction(driver)
        database.exec(`COMMIT`)
        return result
      } catch (error) {
        database.exec(`ROLLBACK`)
        throw error
      }
    },
  }
  return driver
}

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
 * A managed cache claim can expire while an installed SDK snapshot request is
 * still in flight. The source model has no row for the old predicate and one
 * row for the new predicate. The old provider session loses authority before
 * cache rotation; its late HTTP response cannot publish or persist a row in
 * the new generation. The replacement session must settle both demands from
 * its own snapshots. This receives the controlled provider-restart law through
 * the installed ShapeStream and HTTP path. A Map-backed adapter supplies the
 * generation boundary; real SQLite and native hosts have separate owners.
 */
it(`discards an old SDK snapshot after managed cache rotation`, async () => {
  const http = controlledHttp()
  const rows = new Map<string, Map<number, Item>>([
    [`old-generation`, new Map()],
  ])
  const metadata = new Map<string, Map<string, unknown>>([
    [`old-generation`, new Map()],
  ])
  let storageId = `old-generation`
  let claimExpired = false
  let rotations = 0
  const claimId = `managed-sdk-claim`
  const adapter: PersistenceAdapter = {
    claimCacheGeneration: () =>
      Promise.resolve({
        storageCollectionId: storageId,
        claimId,
        expiresAtMs: Date.now() + 10_000,
      }),
    renewCacheGenerationClaim: () =>
      Promise.resolve(claimExpired ? undefined : Date.now() + 10_000),
    rotateCacheGeneration: (
      _collectionId,
      _claimId,
      resetMetadata,
      expectedStorageId,
    ) => {
      expect(expectedStorageId).toBe(storageId)
      rotations++
      storageId = `new-generation`
      rows.set(storageId, new Map())
      metadata.set(
        storageId,
        new Map(
          resetMetadata ? [[resetMetadata.key, resetMetadata.value]] : [],
        ),
      )
      claimExpired = false
      return Promise.resolve({
        storageCollectionId: storageId,
        claimId,
        expiresAtMs: Date.now() + 10_000,
      })
    },
    releaseCacheGenerationClaim: async () => {},
    loadSubset: (id) =>
      Promise.resolve(
        Array.from(rows.get(storageTargetId(id)) ?? [], ([key, value]) => ({
          key,
          value,
        })),
      ),
    loadResumeSnapshot: (id) =>
      Promise.resolve({
        rows: Array.from(
          rows.get(storageTargetId(id)) ?? [],
          ([key, value]) => ({
            key,
            value,
          }),
        ),
        keySet: {
          status:
            storageTargetId(id) === `old-generation`
              ? `consistent`
              : `incompatible`,
        },
        collectionMetadata: Array.from(
          metadata.get(storageTargetId(id)) ?? [],
          ([key, value]) => ({ key, value }),
        ),
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: (id, tx) => {
      expect(tx.cacheGenerationClaimId).toBe(claimId)
      const generationRows = rows.get(storageTargetId(id))!
      if (tx.truncate) generationRows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          generationRows.delete(Number(mutation.key))
        } else {
          generationRows.set(Number(mutation.key), mutation.value as Item)
        }
      }
      const generationMetadata = metadata.get(storageTargetId(id))!
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) generationMetadata.delete(mutation.key)
        else generationMetadata.set(mutation.key, mutation.value)
      }
      return Promise.resolve()
    },
    ensureIndex: async () => {},
  }
  const electric = electricCollectionOptions<Item>({
    id: `sdk-managed-restart-${++sequence}`,
    shapeOptions: {
      url: `http://test-url/managed-restart-${sequence}`,
      params: { table: `rows` },
      // A provider can finish an HTTP request after stream retirement.
      fetchClient: (input, init) =>
        http.fetchClient(input, { ...init, signal: undefined }),
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
    >({
      ...electric,
      persistence: { adapter },
    }),
  )
  const demand = (id: number) => ({
    where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(id)]),
  })
  const respond = (request: Request, row: Item | undefined, offset: number) =>
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
          data: row
            ? [
                {
                  key: String(row.id),
                  value: { ...row, id: String(row.id) },
                  headers: { operation: `insert` },
                },
              ]
            : [],
        }),
        { headers: headers(offset) },
      ),
    )

  await withElectricCleanup(async () => {
    await atCheckpoint(http.take(), `old managed stream`)
    const oldDemand = Promise.resolve(collection._sync.loadSubset(demand(1)))
    void oldDemand.catch(() => undefined)
    const oldSnapshot = await atCheckpoint(
      http.take(true),
      `old managed subset snapshot`,
    )

    claimExpired = true
    const newDemand = Promise.resolve(collection._sync.loadSubset(demand(2)))
    void newDemand.catch(() => undefined)
    await vi.waitFor(() => expect(rotations).toBe(1))
    expect(storageId).toBe(`new-generation`)

    // The replacement SDK first reacquires the old demand, then the new one.
    // Empty source snapshots for id 1 distinguish source authority from the
    // old request's late row; the id 2 snapshot establishes the new row.
    respond(
      await atCheckpoint(http.take(true), `first replacement snapshot`),
      undefined,
      2,
    )
    respond(
      await atCheckpoint(http.take(true), `replayed old demand`),
      undefined,
      3,
    )
    respond(
      await atCheckpoint(http.take(true), `new demand snapshot`),
      { id: 2, name: `fresh` },
      4,
    )
    await atCheckpoint(
      Promise.all([oldDemand, newDemand]),
      `replacement demand settlement`,
    )
    expect(collection.get(2)?.name).toBe(`fresh`)

    respond(oldSnapshot, { id: 1, name: `late-old` }, 1)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(collection.get(1)).toBeUndefined()
    expect(collection.get(2)?.name).toBe(`fresh`)
    expect([...rows.get(`new-generation`)!.keys()]).toEqual([2])
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
