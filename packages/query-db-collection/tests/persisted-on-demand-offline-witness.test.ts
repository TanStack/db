import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../src/query'
import { createSerializedNodeSqliteDriver as createDriver } from '../../db-sqlite-persistence-core/tests/helpers/node-sqlite-driver'
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type { SQLiteDriver } from '../../db-sqlite-persistence-core/src'
import type { QueryCollectionUtils } from '../src/query'

/**
 * # Does an offline on-demand Query DB query settle on its rows from SQLite?
 *
 * Receiving witness for persisted demand coverage. The oracle in
 * `db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`
 * states the law with a generic on-demand source. This file checks that Query
 * DB, with its own row owners and retention metadata, supplies the premise
 * that oracle controls: a subset load settles only after its rows are visible,
 * so the wrapper records coverage after them.
 *
 * Each history runs two sessions over one `node:sqlite` database, each with a
 * fresh QueryClient. Session 1 is online and loads either `group = 'a'` or
 * nothing. Session 2 asks for `group = 'a'` with `networkTimeoutMs: 1000`, and
 * its `queryFn` either never answers or rejects. The checkpoints are just
 * before and at the wait on a fake clock, and after the network answers or
 * fails.
 *
 * Expected, from the law: a covered demand stays loading before the wait, then
 * becomes ready on its restored rows; a rejected `queryFn` settles a covered
 * demand at once; a demand that session 1 never loaded keeps loading.
 *
 * Query DB retention can delete a released query's rows: once its retention
 * time passes, Query DB removes rows that no other query owns. Coverage
 * describes those rows, so it must end with them (maintainer decision,
 * 2026-10-26). In the history `loaded group a, then retention expired`,
 * session 1 releases the query with a 20 ms `gcTime`, and a positive witness
 * checks that Query DB deleted the rows. Session 2 then behaves as if session
 * 1 never loaded group a. Limits:
 * one filter, no ordered window or cursor page, no Query cache persistence, and
 * no SSR dehydration.
 */

type Item = { id: string; group: string; value: string }

const SERVER: ReadonlyArray<Item> = [
  { id: `a1`, group: `a`, value: `v1` },
  { id: `a2`, group: `a`, value: `v1` },
  { id: `b1`, group: `b`, value: `v1` },
]

type Network = `online` | `pending` | `rejects`

function groupOf(options: LoadSubsetOptions | undefined): string | undefined {
  const where = options?.where as
    { name?: string; args?: Array<{ value?: unknown }> } | undefined
  return where?.name === `eq` ? (where.args?.[1]?.value as string) : undefined
}

function items(driver: SQLiteDriver, network: Network, gcTime = Infinity) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime } },
  })
  const fetches: Array<string | undefined> = []
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item>
    >({
      ...queryCollectionOptions<Item>({
        id: `query-db-demand-coverage`,
        queryClient,
        syncMode: `on-demand`,
        queryKey: (options) => [`items`, groupOf(options) ?? `all`],
        queryFn: (context) => {
          const group = groupOf(context.meta?.loadSubsetOptions)
          fetches.push(group)
          if (network === `pending`) return new Promise<Array<Item>>(() => {})
          if (network === `rejects`) {
            return Promise.reject(new Error(`offline`))
          }
          return Promise.resolve(SERVER.filter((row) => row.group === group))
        },
        getKey: (row) => row.id,
      }),
      initialRender: { strategy: `network-first`, networkTimeoutMs: 1000 },
      persistence: { adapter: new SQLiteCorePersistenceAdapter({ driver }) },
    }),
  )
  return { collection, fetches, queryClient }
}

function groupQuery(
  source: Collection<Item, string | number, any>,
  group: string,
) {
  return createLiveQueryCollection((q) =>
    q.from({ item: source }).where(({ item }) => eq(item.group, group)),
  )
}

async function drain() {
  for (let i = 0; i < 25; i++) await vi.advanceTimersByTimeAsync(0)
}

type Observation = { ready: boolean; rows: Array<string> }

type Session1 =
  `loaded group a` | `loaded group a, then retention expired` | `nothing`

async function runHistory(
  session1: Session1,
  network: Exclude<Network, `online`>,
): Promise<{
  beforeWait: Observation
  atWait: Observation
  session1Fetches: Array<string | undefined>
  session2Fetches: Array<string | undefined>
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  let session1Fetches: Array<string | undefined> = []
  if (session1 !== `nothing`) {
    const expires = session1 === `loaded group a, then retention expired`
    const first = items(driver, `online`, expires ? 20 : Infinity)
    const query = groupQuery(first.collection, `a`)
    try {
      await query.preload()
      session1Fetches = first.fetches
      if (expires) {
        await query.cleanup()
        // Positive witness: retention expiry deleted the released rows.
        await vi.waitFor(
          () =>
            expect(
              first.collection.toArray.filter((row) => row.group === `a`),
            ).toEqual([]),
          // Retention runs on Query DB's own timers, which a loaded CI
          // runner can delay well past the 20 ms gcTime.
          { timeout: 10_000 },
        )
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    } finally {
      await query.cleanup()
      await first.collection.cleanup()
      first.queryClient.clear()
    }
  }

  vi.useFakeTimers({
    toFake: [`setTimeout`, `clearTimeout`, `Date`],
  })
  const second = items(driver, network)
  const query = groupQuery(second.collection, `a`)
  try {
    void query.preload().catch(() => undefined)
    for (let i = 0; i < 200 && second.fetches.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    await drain()
    const observe = (): Observation => ({
      ready: query.status === `ready`,
      rows: query.toArray.map((row) => row.id).sort(),
    })
    // A rejected queryFn settles a covered demand before the wait.
    const beforeWait = network === `rejects` ? observe() : undefined
    await vi.advanceTimersByTimeAsync(999)
    await drain()
    const pendingBeforeWait = observe()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    return {
      beforeWait: beforeWait ?? pendingBeforeWait,
      atWait: observe(),
      session1Fetches,
      session2Fetches: second.fetches,
    }
  } finally {
    vi.useRealTimers()
    await query.cleanup()
    await second.collection.cleanup()
    second.queryClient.clear()
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe(`persisted on-demand Query DB query while offline with network-first`, () => {
  it.each([
    [
      `loaded group a`,
      `pending`,
      {
        beforeWait: { ready: false, rows: [`a1`, `a2`] },
        atWait: { ready: true, rows: [`a1`, `a2`] },
      },
    ],
    [
      `loaded group a`,
      `rejects`,
      {
        beforeWait: { ready: true, rows: [`a1`, `a2`] },
        atWait: { ready: true, rows: [`a1`, `a2`] },
      },
    ],
    [
      `nothing`,
      `pending`,
      {
        beforeWait: { ready: false, rows: [] },
        atWait: { ready: false, rows: [] },
      },
    ],
    [
      `loaded group a, then retention expired`,
      `pending`,
      {
        beforeWait: { ready: false, rows: [] },
        atWait: { ready: false, rows: [] },
      },
    ],
  ] as const)(
    `session 1: %s, session 2 network: %s`,
    async (session1, network, expected) => {
      vi.spyOn(console, `warn`).mockImplementation(() => {})
      vi.spyOn(console, `error`).mockImplementation(() => {})
      const observed = await runHistory(session1, network)
      // Positive witnesses: session 1 fetched exactly group a when it loaded,
      // and session 2 asked the network for group a.
      expect(observed.session1Fetches).toEqual(
        session1 === `nothing` ? [] : [`a`],
      )
      expect(observed.session2Fetches).toContain(`a`)
      expect({
        beforeWait: observed.beforeWait,
        atWait: observed.atWait,
      }).toEqual(expected)
    },
    20_000,
  )
})
