import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import {
  SQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import type { Message, Row } from '@electric-sql/client'
import type { Collection } from '@tanstack/db'
import type { SQLiteDriver } from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils } from '../src/electric'

/**
 * # What does a persisted progressive Electric query show while offline?
 *
 * This file records current behavior; it does not state a contract. It is the
 * Electric companion to the generic on-demand witness in
 * `db-sqlite-persistence-core/tests/on-demand-offline-readiness-witness.test.ts`.
 *
 * Each history runs two sessions against one real SQLite database. Session 1
 * either completes a progressive full sync, loads one query subset without
 * completing the full sync, or does nothing. Session 2 restarts with a stream
 * that never delivers a message and snapshot requests that never settle: an
 * offline network. The checkpoint is a delay after session 2's live query
 * starts. It records query readiness, visible rows, and whether session 2
 * resumed the stream from a persisted offset.
 */

type Item = Row & { id: number; group: string }
type Subscriber = (messages: Array<Message<Item>>) => void

let subscribers: Array<Subscriber> = []
let fetchSnapshot: () => Promise<unknown> = () => new Promise(() => {})

vi.mock(`@electric-sql/client`, async () => ({
  ...(await vi.importActual(`@electric-sql/client`)),
  ShapeStream: vi.fn(() => ({
    subscribe: (subscriber: Subscriber) => {
      subscribers.push(subscriber)
      return () => {}
    },
    requestSnapshot: () => new Promise(() => {}),
    fetchSnapshot: () => fetchSnapshot(),
    forceDisconnectAndRefresh: () => Promise.resolve(),
    isUpToDate: false,
    shapeHandle: `shape-1`,
    lastOffset: `10_0`,
  })),
}))

function toBinding(value: unknown): string | number | bigint | null {
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

function createDriver(database: DatabaseSync): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) =>
      Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toBinding))
          .map((row) => ({ ...row })) as Array<never>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(toBinding))
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

const rows: Array<Item> = [
  { id: 1, group: `a` },
  { id: 2, group: `a` },
  { id: 3, group: `b` },
]

function insert(value: Item): Message<Item> {
  return {
    key: String(value.id),
    value,
    headers: { operation: `insert`, offset: `10_0` } as never,
  }
}

function progressive(driver: SQLiteDriver) {
  return createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      ElectricCollectionUtils<Item>
    >({
      ...electricCollectionOptions({
        id: `progressive-offline-witness`,
        shapeOptions: { url: `http://test-url`, params: { table: `items` } },
        syncMode: `progressive`,
        getKey: (item: Item) => item.id,
      }),
      persistence: { adapter: new SQLiteCorePersistenceAdapter({ driver }) },
    }),
  )
}

function groupA(source: Collection<Item, string | number, any>) {
  return createLiveQueryCollection((q) =>
    q.from({ item: source }).where(({ item }) => eq(item.group, `a`)),
  )
}

async function settle(ms = 50) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type Session1 = `full-sync` | `subset-only` | `nothing`

async function runHistory(session1: Session1) {
  const driver = createDriver(new DatabaseSync(`:memory:`))

  if (session1 !== `nothing`) {
    subscribers = []
    fetchSnapshot = () =>
      Promise.resolve({
        metadata: {},
        data: rows.filter((row) => row.group === `a`).map(insert),
      })
    const first = progressive(driver)
    const firstQuery = groupA(first)
    await firstQuery.preload()
    if (session1 === `full-sync`) {
      for (const subscriber of subscribers) {
        subscriber([
          ...rows.map(insert),
          { headers: { control: `up-to-date` } },
        ])
      }
      await vi.waitFor(() => expect(first.status).toBe(`ready`))
    }
    await settle()
    await firstQuery.cleanup()
    await first.cleanup()
  }

  // Session 2: the network is offline.
  subscribers = []
  fetchSnapshot = () => new Promise(() => {})
  vi.mocked(ShapeStream).mockClear()
  const second = progressive(driver)
  const query = groupA(second)
  let preloaded = false
  void query.preload().then(
    () => (preloaded = true),
    () => (preloaded = true),
  )
  await settle()
  const streamOptions = vi.mocked(ShapeStream).mock.calls.at(-1)?.[0] as
    { offset?: string; handle?: string } | undefined
  const observation = {
    resumedFrom: streamOptions
      ? { offset: streamOptions.offset, handle: streamOptions.handle }
      : undefined,
    sourceStatus: second.status,
    queryReady: query.isReady(),
    preloaded,
    queryRows: query.toArray.map((item) => item.id).sort(),
  }
  await query.cleanup()
  await second.cleanup()
  return observation
}

afterEach(() => {
  subscribers = []
})

describe(`persisted progressive Electric query while offline (current behavior)`, () => {
  it(`rejects network-first initial rendering`, () => {
    expect(() =>
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        ElectricCollectionUtils<Item>
      >({
        ...electricCollectionOptions({
          id: `progressive-network-first`,
          shapeOptions: { url: `http://test-url`, params: { table: `items` } },
          syncMode: `progressive`,
          getKey: (item: Item) => item.id,
        }),
        initialRender: { strategy: `network-first`, networkTimeoutMs: 0 },
        persistence: {
          adapter: new SQLiteCorePersistenceAdapter({
            driver: createDriver(new DatabaseSync(`:memory:`)),
          }),
        },
      }),
    ).toThrow(/network-first.*eager/i)
  })

  // Observed on main at 31dad2dd3; these pin current behavior, not a law.
  it.each([
    [`full-sync`, { resumed: true, ready: true, rows: [1, 2] }],
    [`subset-only`, { resumed: false, ready: false, rows: [1, 2] }],
    [`nothing`, { resumed: false, ready: false, rows: [] }],
  ] as const)(`session 1: %s`, async (session1, expected) => {
    const observation = await runHistory(session1)
    expect(observation.sourceStatus).toBe(`loading`)
    expect({
      resumed: observation.resumedFrom?.offset !== undefined,
      ready: observation.queryReady,
      rows: observation.queryRows,
    }).toEqual(expected)
    expect(observation.preloaded).toBe(expected.ready)
  })
})
