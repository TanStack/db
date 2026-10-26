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
 * The first block records current behavior without network-first; it does
 * not state a contract. The second block is a receiving witness for persisted
 * demand coverage with network-first opted in. The file is the
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
let requestSnapshot: () => Promise<unknown> = () => new Promise(() => {})

vi.mock(`@electric-sql/client`, async () => ({
  ...(await vi.importActual(`@electric-sql/client`)),
  ShapeStream: vi.fn(() => ({
    subscribe: (subscriber: Subscriber) => {
      subscribers.push(subscriber)
      return () => {}
    },
    requestSnapshot: () => requestSnapshot(),
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

// Work outside a transaction waits behind an active transaction, as the
// driver contract (`tests/contracts/sqlite-driver-contract.ts`) requires.
function createDriver(database: DatabaseSync): SQLiteDriver {
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  const direct: SQLiteDriver = {
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
    transaction: (transaction) => transaction(direct),
  }
  return {
    exec: (sql) => serialize(() => direct.exec(sql)),
    query: (sql, params) => serialize(() => direct.query(sql, params)),
    run: (sql, params) => serialize(() => direct.run(sql, params)),
    transaction: (transaction) =>
      serialize(async () => {
        database.exec(`BEGIN IMMEDIATE`)
        try {
          const result = await transaction(direct)
          database.exec(`COMMIT`)
          return result
        } catch (error) {
          database.exec(`ROLLBACK`)
          throw error
        }
      }),
  }
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

function progressive(
  driver: SQLiteDriver,
  networkFirst: boolean,
  syncMode: `progressive` | `on-demand` = `progressive`,
) {
  return createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      ElectricCollectionUtils<Item>
    >({
      ...electricCollectionOptions({
        id: `${syncMode}-offline-witness`,
        shapeOptions: { url: `http://test-url`, params: { table: `items` } },
        syncMode,
        getKey: (item: Item) => item.id,
      }),
      ...(networkFirst
        ? { initialRender: { strategy: `network-first`, networkTimeoutMs: 0 } }
        : {}),
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

async function runHistory(session1: Session1, networkFirst: boolean) {
  const driver = createDriver(new DatabaseSync(`:memory:`))

  if (session1 !== `nothing`) {
    subscribers = []
    fetchSnapshot = () =>
      Promise.resolve({
        metadata: {},
        data: rows.filter((row) => row.group === `a`).map(insert),
      })
    const first = progressive(driver, networkFirst)
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
  const second = progressive(driver, networkFirst)
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
  fetchSnapshot = () => new Promise(() => {})
  requestSnapshot = () => new Promise(() => {})
})

describe(`persisted progressive Electric query while offline (current behavior)`, () => {
  // Observed on main at 31dad2dd3; these pin current behavior, not a law.
  it.each([
    [`full-sync`, { resumed: true, ready: true, rows: [1, 2] }],
    [`subset-only`, { resumed: false, ready: false, rows: [1, 2] }],
    [`nothing`, { resumed: false, ready: false, rows: [] }],
  ] as const)(`session 1: %s`, async (session1, expected) => {
    const observation = await runHistory(session1, false)
    expect(observation.sourceStatus).toBe(`loading`)
    expect({
      resumed: observation.resumedFrom?.offset !== undefined,
      ready: observation.queryReady,
      rows: observation.queryRows,
    }).toEqual(expected)
    expect(observation.preloaded).toBe(expected.ready)
  })
})

// Receiving witness for persisted demand coverage
// (`db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`)
// through Electric's progressive mode. With network-first opted in, the
// subset that session 1 loaded is covered, so session 2 settles it offline on
// its restored rows after the wait. A never-loaded subset still waits.
describe(`persisted progressive Electric query while offline with network-first`, () => {
  it.each([
    [`full-sync`, { ready: true, rows: [1, 2] }],
    [`subset-only`, { ready: true, rows: [1, 2] }],
    [`nothing`, { ready: false, rows: [] }],
  ] as const)(`session 1: %s`, async (session1, expected) => {
    const observation = await runHistory(session1, true)
    expect(observation.sourceStatus).toBe(`loading`)
    expect({
      ready: observation.queryReady,
      rows: observation.queryRows,
    }).toEqual(expected)
    expect(observation.preloaded).toBe(expected.ready)
  })
})

// Electric's own load after a settlement from SQLite. A progressive load
// fetches its snapshot without a cancel signal, so after the wrapper settles
// the demand from SQLite the Electric load can still be waiting. Releasing
// the demand aborts it. A snapshot that answers after that must not write its
// rows (law 6 in `ARCHITECTURE.md`: a conforming source publishes no
// request-scoped rows after cancellation).
describe(`Electric's own load after a settlement from SQLite`, () => {
  it(`writes no rows from a snapshot that answers after release`, async () => {
    const driver = createDriver(new DatabaseSync(`:memory:`))
    subscribers = []
    fetchSnapshot = () =>
      Promise.resolve({
        metadata: {},
        data: rows.filter((row) => row.group === `a`).map(insert),
      })
    const first = progressive(driver, true)
    const firstQuery = groupA(first)
    await firstQuery.preload()
    await settle()
    await firstQuery.cleanup()
    await first.cleanup()

    subscribers = []
    let answerLate!: (value: unknown) => void
    fetchSnapshot = () =>
      new Promise((resolve) => {
        answerLate = resolve
      })
    const second = progressive(driver, true)
    const query = groupA(second)
    await query.preload()
    // Positive witness: the demand settled from SQLite while Electric's own
    // snapshot is still pending.
    expect(query.isReady()).toBe(true)
    expect(typeof answerLate).toBe(`function`)
    await query.cleanup()
    await settle()
    answerLate({ metadata: {}, data: [insert({ id: 9, group: `a` })] })
    await settle()
    expect(second.toArray.map((item) => item.id).sort()).toEqual([1, 2])
    await second.cleanup()
  })
})

// Must-refetch in on-demand mode. An Electric must-refetch truncates the
// source, which ends persisted demand coverage for every demand. Session 1
// loads group a through `requestSnapshot`, whose rows arrive as stream
// messages. In the second history a must-refetch and an up-to-date follow, and
// the reacquired snapshot never answers. Session 2 is offline: the covered
// subset settles on its restored rows, and the refetched one keeps loading.
describe(`on-demand Electric must-refetch with network-first`, () => {
  it.each([
    [`loaded group a`, { ready: true, rows: [1, 2] }],
    [`loaded group a, then must-refetch`, { ready: false, rows: [] }],
  ] as const)(`session 1: %s`, async (session1, expected) => {
    const driver = createDriver(new DatabaseSync(`:memory:`))
    subscribers = []
    requestSnapshot = () => {
      for (const subscriber of subscribers) {
        subscriber([
          ...rows.filter((row) => row.group === `a`).map(insert),
          // The SDK ends an injected subset with `subset-end`, the point at
          // which Electric commits its rows.
          { headers: { control: `subset-end` } } as never,
        ])
      }
      return Promise.resolve(undefined)
    }
    const first = progressive(driver, true, `on-demand`)
    const firstQuery = groupA(first)
    const preload = firstQuery.preload()
    await settle(20)
    for (const subscriber of subscribers) {
      subscriber([{ headers: { control: `up-to-date` } }])
    }
    await preload
    // Positive witness: session 1 loaded group a.
    expect(firstQuery.toArray.map((item) => item.id).sort()).toEqual([1, 2])
    if (session1 === `loaded group a, then must-refetch`) {
      requestSnapshot = () => new Promise(() => {})
      for (const subscriber of subscribers) {
        subscriber([{ headers: { control: `must-refetch` } } as never])
      }
      await settle()
      for (const subscriber of subscribers) {
        subscriber([{ headers: { control: `up-to-date` } }])
      }
      await settle(200)
      // Positive witness: the must-refetch truncated the rows.
      expect(first.toArray).toEqual([])
    }
    await firstQuery.cleanup()
    await first.cleanup()

    subscribers = []
    requestSnapshot = () => new Promise(() => {})
    const second = progressive(driver, true, `on-demand`)
    const query = groupA(second)
    let preloaded = false
    void query.preload().then(
      () => (preloaded = true),
      () => undefined,
    )
    await settle(300)
    expect({
      ready: preloaded,
      rows: query.toArray.map((item) => item.id).sort(),
    }).toEqual(expected)
    await query.cleanup()
    await second.cleanup()
  })
})
