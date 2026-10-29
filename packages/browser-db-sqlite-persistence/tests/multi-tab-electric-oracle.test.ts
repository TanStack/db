// @vitest-environment node
/**
 * # Do Electric tabs that share one persisted database agree with the server?
 *
 * Several Browser tabs open the same persisted Electric Collection. Each tab
 * runs its own Electric stream, and all of them store through one SQLite
 * database and one elected leader. Tabs coordinate only through durable
 * commits and the notices those commits broadcast. This file is the Browser
 * host owner for five laws about that arrangement.
 *
 * Law 1, reserved commits survive a refetch storm. Authority:
 * SyncPersistenceCapabilityV1 `reserveCommitTurn` (packages/db/src/types.ts),
 * widened by maintainer decision on issue #2226 to every persisted
 * hydration. Electric reserves every stream transaction. After a deploy, each
 * tab's stream sends must-refetch; the tab commits a reset resume marker at
 * once, then holds a reserved refetch transaction open until up-to-date. A
 * peer's marker or refetch commit reaches the other tabs while their
 * refetches are open. The law: every tab's refetch commits, no Collection
 * enters `error`, and once every stream has delivered the new snapshot every
 * tab shows it. The controlled-history owner for the same law is the
 * persisted-reads grammar in
 * packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts; this
 * file is its receiving witness on the real Browser coordinator.
 *
 * Law 2, an open tab converges to the server head. Authority: the coverage
 * map's eventual-consistency note for persisted multi-tab Collections
 * (docs/contributing/oracle-coverage.md, issue #2209): a lagging tab may
 * briefly store an older transaction, and every tab converges once the
 * streams catch up. The generated histories below judge it: after every
 * open tab catches up, the durable rows and every open tab show the server
 * head, however earlier lagging commits left them. When a lagging tab
 * commits an older row and then closes for good, nothing redelivers the head
 * to the faster tab, so this law fails today. That history is pinned with
 * `it.fails` until #2209 orders source writes by server position; generated
 * histories never close a tab for good.
 *
 * Model: the server is a log of snapshots. A history names which snapshot
 * each tab's stream has delivered; the expected public rows of a tab whose
 * stream reached the head are the head snapshot. This file states no
 * contract for which stream rows an on-demand Collection without subset
 * demand exposes, so on-demand histories judge only commit acceptance and
 * Collection status (a partial oracle). The model reads nothing from the
 * coordinator, adapter, or Collection.
 *
 * Driver: each tab is a better-sqlite3 connection to one shared file, a
 * `BrowserCollectionCoordinator` (BroadcastChannel and Web Locks in Node), and
 * `createBrowserWASQLitePersistence`. A recording `ShapeStream` stands in for
 * the Electric SDK; the test plays the server and delivers each tab's
 * messages. Checkpoints wait for host quiescence: no SQL statement and no
 * coordinator message for several tasks. Observations are each tab's
 * Collection status and public rows, and the position from which a
 * recovered tab's new stream starts.
 *
 * Law 3, a Collection whose source failed keeps showing durable rows.
 * Authority: maintainer decision on PR #2265. A persisted Collection whose
 * source failed still applies its peers' durable commits, so its public rows
 * match the durable rows. A failure before the first load completes puts it
 * in `error`; a later one leaves it `ready` with an error on its health node
 * (#2168: after readiness, sync failures never change Collection status).
 * This file judges it after resume invalidation, after a failed initial
 * sync, and after a reset abandoned the source's transaction; the source
 * must end its reserved transaction for the peers' commits to apply.
 *
 * Law 4, a Collection status changes only through its own source. Authority:
 * maintainer decision on PR #2265. A peer's durable commit reloads a tab's
 * rows but never moves its status: a tab whose own stream has not reached
 * up-to-date stays `loading`, and a tab whose initial sync failed stays in
 * `error` until it restarts.
 *
 * Law 5, a peer reset abandons an older reservation, and Electric fails
 * loudly. Authority: maintainer decisions on PR #2265. A peer
 * `collection:reset` abandons every reserved transaction that began before
 * it. Electric still holds that transaction, so its next commit rejects and
 * the source fails: a ready Collection keeps `ready` with an error on its
 * health node, one that is still loading goes to `error`. The app recovers by
 * restarting the tab.
 * No shipped host sends `collection:reset` yet, so the histories post it on
 * the tabs' coordinator channel as a peer would (a controlled premise).
 *
 * The generated histories below judge Laws 1, 3, 4, and 5 over interleaved
 * server changes, deploys, deliveries, stops, and recoveries, against a
 * model of the durable rows. One known gap is left out of them and pinned:
 * a resumed tab that lags behind a peer can receive an update for a row the
 * peer already deleted, and Electric's resume check then puts it in `error`.
 *
 * Electric's own cleanup abandon is redundant behind the persisted wrapper,
 * which ends its transactions on cleanup, so that mutant survives here; the
 * Electric descriptor-isolation oracle judges it without persistence.
 *
 * Limits: the stream is controlled, not the installed SDK over HTTP; one
 * process hosts every tab; one Collection; no subset demand in on-demand
 * Collections; no optimistic mutations; work amplification across tabs is
 * not judged.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import { createCollection } from '@tanstack/db'
import { createOracleReach } from '../../db/tests/oracle-reach.js'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../../electric-db-collection/src/electric'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import { createBrowserWASQLitePersistence } from '../src/browser-persistence'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import { sourceHeadViolation } from './electric-convergence-oracle'
import type {
  Message,
  Row,
} from '../../electric-db-collection/node_modules/@electric-sql/client'
import type { ElectricCollectionUtils } from '../../electric-db-collection/src/electric'

type Item = Row & { id: number; label: string }

// ---------------------------------------------------------------------------
// Controlled Electric SDK boundary. Each stream records the position Electric
// started it at and exposes the subscriber, so the test can play the server.
// ---------------------------------------------------------------------------

type ControlledStream = {
  tab: string
  // The position Electric asked the server to start from.
  startedAt: { handle: string | undefined; offset: string }
  shapeHandle: string | undefined
  lastOffset: string
  // Set when Electric releases the stream; a stopped stream gets no messages.
  stopped: boolean
  send: (messages: Array<Message<Item>>) => void
  // Electric's stream-error handler, which the test calls to fail the stream.
  onError: (error: unknown) => unknown
  // The subscriber's error callback, which the SDK calls when it stops
  // retrying.
  giveUp: (error: unknown) => void
}

const streams: Array<ControlledStream> = []

vi.mock(
  `../../electric-db-collection/node_modules/@electric-sql/client`,
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>()
    return {
      ...actual,
      ShapeStream: vi.fn(function (options: {
        headers?: Record<string, string>
        offset?: string
        handle?: string
        onError?: (error: unknown) => unknown
      }) {
        const stream: ControlledStream = {
          tab: options.headers?.[`x-tab`] ?? `unknown`,
          startedAt: {
            handle: options.handle,
            offset: options.offset ?? `-1`,
          },
          stopped: false,
          shapeHandle: options.handle,
          lastOffset: options.offset ?? `-1`,
          send: () => {
            throw new Error(`stream for tab ${stream.tab} is not subscribed`)
          },
          onError: (error) => options.onError?.(error),
          giveUp: () => {
            throw new Error(`stream for tab ${stream.tab} is not subscribed`)
          },
        }
        streams.push(stream)
        return {
          subscribe: (
            send: ControlledStream[`send`],
            giveUp: ControlledStream[`giveUp`],
          ) => {
            stream.send = send
            stream.giveUp = giveUp
            return () => undefined
          },
          unsubscribeAll: () => {
            stream.stopped = true
          },
          requestSnapshot: vi.fn().mockResolvedValue(undefined),
          fetchSnapshot: vi.fn().mockResolvedValue({ metadata: {}, data: [] }),
          forceDisconnectAndRefresh: vi.fn().mockResolvedValue(undefined),
          isUpToDate: false,
          get shapeHandle() {
            return stream.shapeHandle
          },
          get lastOffset() {
            return stream.lastOffset
          },
        }
      }),
    }
  },
)

const upToDate: Message<Item> = { headers: { control: `up-to-date` } }
const mustRefetch: Message<Item> = { headers: { control: `must-refetch` } }
const insert = (row: Item): Message<Item> => ({
  key: String(row.id),
  value: row,
  headers: { operation: `insert` },
})
const update = (row: Item): Message<Item> => ({
  key: String(row.id),
  value: row,
  headers: { operation: `update` },
})

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Attempt every cleanup, preserving failures after all resources are released.
async function closeAll(actions: Array<() => unknown>) {
  const failures: Array<unknown> = []
  for (const action of actions) {
    try {
      await action()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, `host cleanup failed`)
}

// ---------------------------------------------------------------------------
// Browser host: one database file, one coordinator and persistence per tab.
// ---------------------------------------------------------------------------

type SyncMode = `eager` | `on-demand`
type StreamStop =
  | `error without retry`
  | `SDK gives up`
  | `signal aborted`
  | `cleanup`
  | `resume invalidated`

function openHost() {
  const directory = mkdtempSync(join(tmpdir(), `tsdb-multi-tab-`))
  const filename = join(directory, `shared.sqlite`)
  const dbName = `multi-tab-${Math.random()}`
  const closers: Array<() => Promise<void>> = []
  let observer: ReturnType<typeof createWASQLiteTestDatabase> | undefined
  // Host activity for the quiescence checkpoint, and the number of commit
  // notices, read from the coordinator's own channel.
  let activity = 0
  let commitNotices = 0
  let storageCollectionId: string | undefined
  let resetEpoch = 0
  const channel = new BroadcastChannel(`tsdb:coord:${dbName}`)
  channel.onmessage = (event: MessageEvent) => {
    activity++
    const envelope = event.data as {
      senderId?: string
      collectionId?: string
      payload?: { type?: string }
    }
    if (envelope.payload?.type === `tx:committed` && envelope.senderId) {
      commitNotices++
      storageCollectionId ??= envelope.collectionId
    }
  }

  const openTab = (tab: string, syncMode: SyncMode) => {
    const database = createWASQLiteTestDatabase({ filename, timeout: 0 })
    const execute = database.execute.bind(database)
    database.execute = async <TRow>(
      sql: string,
      params: ReadonlyArray<unknown> = [],
    ) => {
      activity++
      for (;;) {
        try {
          return await execute<TRow>(sql, params)
        } catch (error) {
          if ((error as { code?: string }).code !== `SQLITE_BUSY`) throw error
          await nextTask()
        }
      }
    }
    const coordinator = new BrowserCollectionCoordinator({ dbName })
    // The application's signal, which can stop the stream from outside.
    let external = new AbortController()
    const shapeOptions = {
      url: `http://electric.test/v1/shape`,
      params: { table: `items` },
      headers: { 'x-tab': tab },
      signal: external.signal,
    }
    const collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        ElectricCollectionUtils<Item>
      >({
        ...electricCollectionOptions<Item>({
          id: `items`,
          shapeOptions,
          syncMode,
          getKey: (row) => row.id,
          startSync: true,
        }),
        persistence: createBrowserWASQLitePersistence({
          database,
          coordinator,
          schemaMismatchPolicy: `reset`,
        }),
      }),
    )
    let open = true
    const close = async () => {
      if (!open) return
      open = false
      await closeAll([
        () => collection.cleanup(),
        () => coordinator.dispose(),
        () => database.close?.(),
      ])
    }
    closers.push(close)
    const stream = () => {
      const own = streams.filter((candidate) => candidate.tab === tab)
      const latest = own[own.length - 1]
      if (!latest) throw new Error(`tab ${tab} has no stream`)
      return latest
    }
    return {
      tab,
      collection,
      close,
      hasStream: () => streams.some((candidate) => candidate.tab === tab),
      streamCount: () =>
        streams.filter((candidate) => candidate.tab === tab).length,
      startedAt: () => stream().startedAt,
      deliver: (
        messages: Array<Message<Item>>,
        position: { handle: string; offset: string },
      ) => {
        const current = stream()
        if (current.stopped) {
          throw new Error(`tab ${tab} delivered to a stopped stream`)
        }
        current.shapeHandle = position.handle
        current.lastOffset = position.offset
        current.send(messages)
      },
      // Each way a source stops for good: an error that `onError` does not
      // retry, the SDK giving up its own retries, the application's signal
      // aborting the stream, the application cleaning up the Collection, or
      // a resumed stream sending an update for a row it never sent, which
      // invalidates the persisted resume position.
      stopStream: (how: StreamStop) => {
        const error = new Error(`stream failed`)
        if (how === `error without retry`) return stream().onError(error)
        if (how === `SDK gives up`) return stream().giveUp(error)
        if (how === `signal aborted`) return external.abort()
        if (how === `cleanup`) return collection.cleanup()
        const current = stream()
        return current.send([update({ id: 99, label: `never sent` })])
      },
      // The application's recovery: clean up and start the Collection again.
      // A signal that already aborted would stop the new stream too, so the
      // restarted session gets a fresh signal.
      restart: async () => {
        await collection.cleanup()
        external = new AbortController()
        shapeOptions.signal = external.signal
        void collection.preload().catch(() => undefined)
      },
      publicRows: () =>
        Array.from(collection.values(), ({ id, label }) => ({
          id,
          label,
        })).sort((left, right) => left.id - right.id),
    }
  }

  // The hosts are quiet when five 2 ms tasks pass with no SQL statement and
  // no coordinator message, within 400 tasks; the bound turns a livelock into
  // a named failure. Quiet is evidence, not proof, that every notice and
  // hydration finished, because the public API exposes no completion signal
  // for peer notices. Its premises are calibrated instead: declared reach
  // shows the peer commit arrived, and the abandon and readiness mutants fail
  // only when a hydration ran after that commit.
  const quiesce = async (label: string) => {
    let quietTasks = 0
    for (let task = 0; task < 400 && quietTasks < 5; task++) {
      const before = activity
      await new Promise((resolve) => setTimeout(resolve, 2))
      quietTasks = activity === before ? quietTasks + 1 : 0
    }
    if (quietTasks < 5) throw new Error(`hosts did not quiesce: ${label}`)
  }

  return {
    openTab,
    quiesce,
    commitNotices: () => commitNotices,
    // A pre-protocol cache or mismatched provenance record still has rows
    // and an Electric cursor. Reopen must not trust that cursor blindly.
    rewriteSourceProgress: async (format: `missing` | `foreign`) => {
      observer ??= createWASQLiteTestDatabase({ filename, timeout: 1000 })
      // The old format's key ledger followed arrival-order row writes and
      // therefore certified these wrong rows. Reconstruct that baseline;
      // merely deleting a token from an already incompatible cache would
      // not distinguish the startup provenance check.
      await observer.execute(
        `UPDATE collection_version SET source_progress_incompatible = 0 WHERE collection_id = ?`,
        [`items`],
      )
      if (format === `missing`) {
        await observer.execute(
          `DELETE FROM collection_metadata WHERE collection_id = ? AND key = ?`,
          [`items`, `electric:source-progress`],
        )
      } else {
        await observer.execute(
          `UPDATE collection_metadata SET value = ? WHERE collection_id = ? AND key = ?`,
          [
            JSON.stringify(`foreign-position`),
            `items`,
            `electric:source-progress`,
          ],
        )
      }
    },
    // A peer tab's collection reset, posted on the tabs' coordinator channel
    // as a peer would post it. No shipped host sends this notice yet, so
    // the premise is controlled; the tabs, their coordinators, and Electric
    // receive it through production.
    broadcastPeerReset: () => {
      if (!storageCollectionId) {
        throw new Error(`no commit notice named the storage collection yet`)
      }
      channel.postMessage({
        v: 1,
        dbName,
        collectionId: storageCollectionId,
        senderId: `peer-reset-tab`,
        ts: Date.now(),
        payload: {
          type: `collection:reset`,
          schemaVersion: 1,
          resetEpoch: ++resetEpoch,
        },
      })
    },
    // The durable rows of the shared Collection, read through a connection of
    // its own so the read counts as no host activity.
    durableRows: async (): Promise<Array<Item>> => {
      observer ??= createWASQLiteTestDatabase({ filename, timeout: 1000 })
      const registry = await observer.execute<{ table_name: string }>(
        `SELECT table_name FROM collection_registry WHERE collection_id = ?`,
        [`items`],
      )
      const table = registry[0]?.table_name
      if (!table) return []
      const rows = await observer.execute<{ value: string }>(
        `SELECT value FROM "${table}"`,
      )
      return rows
        .map((row) => JSON.parse(row.value) as Item)
        .map(({ id, label }) => ({ id, label }))
        .sort((left, right) => left.id - right.id)
    },
    close: async () => {
      await closeAll([
        () => observer?.close?.(),
        ...closers.reverse(),
        () => channel.close(),
        () => rmSync(directory, { recursive: true, force: true }),
      ])
    },
  }
}

type Host = ReturnType<typeof openHost>
type Tab = ReturnType<Host[`openTab`]>

async function openWarmTabs(host: Host, count: number, syncMode: SyncMode) {
  const tabs: Array<Tab> = []
  for (let index = 0; index < count; index++) {
    const tab = host.openTab(String.fromCharCode(65 + index), syncMode)
    for (let task = 0; task < 400 && !tab.hasStream(); task++) {
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    expect(tab.hasStream()).toBe(true)
    tabs.push(tab)
  }
  return tabs
}

// Generated-history campaigns (ORC-007): a fixed seed and a random seed
// with the same property and budget. TANSTACK_DB_ORACLE_SEED with
// TANSTACK_DB_ORACLE_PATH and TANSTACK_DB_ORACLE_PROPERTY=
// browser.multi-tab-reserved-history replays one recorded counterexample;
// TANSTACK_DB_ORACLE_RUNS_MULTIPLIER scales the budget.
const GENERATED_PROPERTY = `browser.multi-tab-reserved-history`
const GENERATED_FIXED_SEED = 952051961
const GENERATED_RUNS = 80

async function waitForStream(tab: Tab, count: number) {
  for (let task = 0; task < 400 && tab.streamCount() < count; task++) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  expect(tab.streamCount()).toBe(count)
}

// The server after the deploy, answering a new stream from where it starts:
// the head handle is up to date, a full-snapshot request gets the head
// snapshot, and the old handle must refetch.
async function serveHead(
  host: Host,
  tab: Tab,
  startedAt: { handle: string | undefined; offset: string },
) {
  const head = { handle: `h2`, offset: `20_0` }
  if (startedAt.handle === `h2`) tab.deliver([upToDate], head)
  else if (startedAt.handle === undefined || startedAt.offset === `-1`) {
    tab.deliver([...afterDeploy.map(insert), upToDate], head)
  } else {
    tab.deliver([mustRefetch], {
      handle: startedAt.handle,
      offset: startedAt.offset,
    })
    await host.quiesce(`tab ${tab.tab} restart refetch open`)
    tab.deliver([...afterDeploy.map(insert), upToDate], head)
  }
  await host.quiesce(`tab ${tab.tab} restarted`)
}

// ---------------------------------------------------------------------------
// The server log. Snapshot 1 is the state before a deploy, snapshot 2 after:
// row 1 changes, row 2 is deleted, row 3 is new.
// ---------------------------------------------------------------------------

const beforeDeploy: Array<Item> = [
  { id: 1, label: `one` },
  { id: 2, label: `two` },
]
const afterDeploy: Array<Item> = [
  { id: 1, label: `one, refetched` },
  { id: 3, label: `three` },
]

describe(`multi-tab Electric over one persisted database`, () => {
  let host: Host | undefined
  // Shrinking must retain the violated law even when releasing the host fails.
  // AggregateError keeps the primary mismatch as cause and cleanup separately.
  const finishHistory = async (primary?: { error: unknown }) => {
    const failures: Array<unknown> = []
    if (primary) failures.push(primary.error)
    try {
      await host?.close()
    } catch (error) {
      failures.push(error)
    } finally {
      host = undefined
      streams.length = 0
    }
    if (primary && failures.length > 1)
      throw new AggregateError(
        failures,
        `${String(primary.error)}; secondary host cleanup failure`,
        { cause: primary.error },
      )
    if (failures.length) throw failures[0]
  }
  afterEach(() => finishHistory())

  // Law 1 grammar. Dimensions: two or three tabs; eager or on-demand
  // Collections; which tab finishes its refetch first; whether every tab's
  // must-refetch arrives before any refetch finishes (a storm) or each tab
  // finishes before the next receives must-refetch (staggered, the
  // neighbouring control); and whether the last tab's source stops for good
  // while it holds an open reserved transaction, through each terminal path
  // Electric has. That transaction is either its refetch or an ordinary batch
  // of a stream that resumed from the persisted position, with no up-to-date
  // yet. Resume invalidation needs the resumed batch: a refetch already
  // replaces the snapshot, and on-demand Collections never validate resume.
  //
  // A source that stops for good abandons its reserved transaction
  // (maintainer decision on #2226). So a stopped tab that is still open
  // applies its peers' refetch from durable rows, as it did before
  // reservations deferred hydrations. Electric then fails no further, except
  // that resume invalidation fails the source, as Electric documents: the
  // ready tab keeps `ready` with an error on its health node and still shows
  // durable rows (Law 3). The
  // application's recovery, cleanup and a restart, then brings
  // the tab to the head. After resume invalidation the restart must request a
  // full snapshot (electric.ts: "a full snapshot is required").
  type StormHistory = {
    tabCount: number
    syncMode: SyncMode
    finisher: `first` | `last`
    arrival: `storm` | `staggered`
    open: `refetch` | `resumed batch`
    stop: `none` | StreamStop
    recovery: `none` | `restart` | `reload`
  }
  const stormHistories: Array<StormHistory> = [2, 3].flatMap((tabCount) =>
    ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
      ([`first`, `last`] as const).flatMap((finisher) =>
        ([`storm`, `staggered`] as const).flatMap((arrival) =>
          ([`refetch`, `resumed batch`] as const).flatMap((open) =>
            (
              [
                ...(open === `refetch` ? ([`none`] as const) : []),
                `error without retry`,
                `SDK gives up`,
                `signal aborted`,
                `cleanup`,
                ...(open === `resumed batch` && syncMode === `eager`
                  ? ([`resume invalidated`] as const)
                  : []),
              ] as const
            ).flatMap((stop) =>
              (stop === `none`
                ? ([`none`] as const)
                : ([`restart`, `reload`] as const)
              ).map((recovery) => ({
                tabCount,
                syncMode,
                finisher,
                arrival,
                open,
                stop,
                recovery,
              })),
            ),
          ),
        ),
      ),
    ),
  )
  // The storm driver: it runs one cell on real tabs and checks every tab's
  // rows and status against the law at each checkpoint.
  const runStormHistory = async ({
    tabCount,
    syncMode,
    finisher,
    arrival,
    open,
    stop,
    recovery,
  }: (typeof stormHistories)[number]) => {
    host = openHost()
    const tabs = await openWarmTabs(host, tabCount, syncMode)
    for (const tab of tabs) {
      tab.deliver([...beforeDeploy.map(insert), upToDate], {
        handle: `h1`,
        offset: `10_0`,
      })
      await host.quiesce(`tab ${tab.tab} warm`)
    }
    type RefetchReach =
      | `peer commit announced during an open refetch`
      | `stopped tab resumed from the persisted position`
      | `peer commit announced during the stopped tab's open transaction`
      | `a source stopped while its transaction was open`
      | `restarted tab opened a new stream`
    const reach = createOracleReach<RefetchReach>(
      `browser.multi-tab-reserved-refetch`,
      [
        ...(arrival === `storm`
          ? ([`peer commit announced during an open refetch`] as const)
          : []),
        ...(open === `resumed batch`
          ? ([`stopped tab resumed from the persisted position`] as const)
          : []),
        ...(stop === `none`
          ? []
          : ([
              `peer commit announced during the stopped tab's open transaction`,
              `a source stopped while its transaction was open`,
              `restarted tab opened a new stream`,
            ] as const)),
      ],
    )
    reach.beginHistory()

    // The last tab to finish is the one whose source may stop.
    const finishOrder = finisher === `first` ? tabs : [...tabs].reverse()
    const stoppedIndex =
      stop === `none` ? undefined : tabs.indexOf(finishOrder.at(-1)!)
    if (open === `resumed batch`) {
      // A page reload: the tab closes and reopens over the same database,
      // resuming from its persisted position. Its first batch after the
      // resume stays open, as a batch with no up-to-date does.
      const closing = tabs[stoppedIndex!]!
      const streamsBefore = closing.streamCount()
      await closing.close()
      await host.quiesce(`stopped tab closed`)
      const reopened = host.openTab(closing.tab, syncMode)
      await waitForStream(reopened, streamsBefore + 1)
      tabs[stoppedIndex!] = reopened
      if (reopened.startedAt().handle === `h1`) {
        reach.reach(`stopped tab resumed from the persisted position`)
      }
      reopened.deliver([upToDate], { handle: `h1`, offset: `10_0` })
      await host.quiesce(`stopped tab resumed`)
      reopened.deliver([update({ id: 1, label: `one, unfinished` })], {
        handle: `h1`,
        offset: `11_0`,
      })
      await host.quiesce(`resumed batch open`)
    }
    const stoppedTab =
      stoppedIndex === undefined ? undefined : tabs[stoppedIndex]
    const refetchingTabs = (
      finisher === `first` ? tabs : [...tabs].reverse()
    ).filter((tab) => open === `refetch` || tab !== stoppedTab)
    const noticesBefore = host.commitNotices()
    const stopSource = async () => {
      if (!stoppedTab || stop === `none`) return
      if (host!.commitNotices() > noticesBefore) {
        reach.reach(
          `peer commit announced during the stopped tab's open transaction`,
        )
      }
      void Promise.resolve(stoppedTab.stopStream(stop)).catch(() => undefined)
      await host!.quiesce(`tab ${stoppedTab.tab} source stopped`)
      reach.reach(`a source stopped while its transaction was open`)
    }
    const refetch = (tab: Tab) =>
      tab.deliver([...afterDeploy.map(insert), upToDate], {
        handle: `h2`,
        offset: `20_0`,
      })
    if (arrival === `storm`) {
      for (const tab of refetchingTabs)
        tab.deliver([mustRefetch], { handle: `h1`, offset: `10_0` })
      const noticesBeforeRefetch = host.commitNotices()
      await host.quiesce(`every refetch open`)
      // Each tab's reset marker is a peer notice for every other tab while
      // its own reserved refetch is open.
      if (host.commitNotices() > noticesBeforeRefetch) {
        reach.reach(`peer commit announced during an open refetch`)
      }
      for (const tab of refetchingTabs) {
        if (tab === stoppedTab) continue
        refetch(tab)
        await host.quiesce(`tab ${tab.tab} refetched`)
      }
      await stopSource()
    } else {
      for (const tab of refetchingTabs) {
        tab.deliver([mustRefetch], { handle: `h1`, offset: `10_0` })
        await host.quiesce(`tab ${tab.tab} refetch open`)
        if (tab === stoppedTab) continue
        refetch(tab)
        await host.quiesce(`tab ${tab.tab} refetched`)
      }
      await stopSource()
    }

    // Checkpoint 1, every source has delivered or stopped. A rejected
    // reserved commit would fail its source. A stopped tab that is still
    // open shows its peers' refetch, including one whose source failed on
    // resume invalidation (Law 3); a cleaned-up tab has no rows. Eager rows
    // must equal the head snapshot; on-demand rows are not judged (above).
    // Resume invalidation comes after the tab was ready, so the tab stays
    // `ready` and its health node records the source's error (#2168: after
    // readiness, sync failures never change Collection status).
    const stoppedStatus = stop === `cleanup` ? `cleaned-up` : `ready`
    const judgesRowsBeforeRestart = (tab: Tab) =>
      syncMode === `eager` && (tab !== stoppedTab || stop !== `cleanup`)
    const judgesSourceError = (tab: Tab) =>
      tab === stoppedTab && stop === `resume invalidated`
    const observe = (judgesRows: (tab: Tab) => boolean) =>
      tabs.map((tab) => ({
        tab: tab.tab,
        status: tab.collection.status,
        ...(judgesRows(tab) ? { rows: tab.publicRows() } : {}),
        ...(judgesSourceError(tab)
          ? { sourceError: tab.collection.health.error !== null }
          : {}),
      }))
    expect(observe(judgesRowsBeforeRestart)).toEqual(
      tabs.map((tab) => ({
        tab: tab.tab,
        status: tab === stoppedTab ? stoppedStatus : `ready`,
        ...(judgesRowsBeforeRestart(tab) ? { rows: afterDeploy } : {}),
        ...(judgesSourceError(tab) ? { sourceError: true } : {}),
      })),
    )

    // Checkpoint 2, after the application recovers the stopped tab and the
    // server answers its new stream from where it starts. A restart cleans
    // up and starts the same Collection again; a reload closes the tab and
    // opens it again over the same database, so it reads only durable
    // state.
    if (stoppedTab) {
      const streamsBefore = stoppedTab.streamCount()
      let recovered = stoppedTab
      if (recovery === `restart`) await stoppedTab.restart()
      else {
        await stoppedTab.close()
        await host.quiesce(`tab ${stoppedTab.tab} closed`)
        recovered = host.openTab(stoppedTab.tab, syncMode)
        tabs[stoppedIndex!] = recovered
      }
      await waitForStream(recovered, streamsBefore + 1)
      reach.reach(`restarted tab opened a new stream`)
      const restartedAt = recovered.startedAt()
      await serveHead(host, recovered, restartedAt)
      if (stop === `resume invalidated`) {
        expect(restartedAt).toEqual({ handle: undefined, offset: `-1` })
      }
      // The new sync run starts without the retired run's problems.
      expect(observe(() => syncMode === `eager`)).toEqual(
        tabs.map((tab) => ({
          tab: tab.tab,
          status: `ready`,
          ...(syncMode === `eager` ? { rows: afterDeploy } : {}),
          ...(judgesSourceError(tab) ? { sourceError: false } : {}),
        })),
      )
    }
    reach.assertReached()
  }
  it.each(stormHistories)(
    `commits every reserved refetch across tabs ($tabCount tabs, $syncMode, $finisher finishes first, $arrival, open $open, stop: $stop, recovery: $recovery)`,
    runStormHistory,
    30_000,
  )

  // Law 1 and Law 3, generated histories. The enumerated grammar above fixes
  // one refetch storm and one stopped tab. These histories interleave, in any
  // legal order:
  //
  // - server changes (insert, update, or delete of one of four rows);
  // - deploys, after which every stream must refetch;
  // - a peer reset, which abandons every open reserved transaction (Law 5);
  // - deliveries to one tab: part of what its stream still owes, with no
  //   up-to-date, which leaves a reserved transaction open, or everything it
  //   owes and up-to-date, which commits it;
  // - a tab's source stopping for good (each terminal path except resume
  //   invalidation, which the enumerated grammar owns);
  // - recovery of a stopped tab, and a reload of a running tab.
  //
  // Model. The server is a log per shape handle. A tab's stream owes the log
  // after its position, or must-refetch then the snapshot when its handle is
  // stale. A tab's open transaction holds the messages delivered since it
  // began; a commit applies them to the durable rows in commit order, after a
  // truncate when the transaction is a refetch or a fresh snapshot. An
  // abandoned transaction applies nothing. So the expected durable rows are a
  // fold of committed batches. A lagging tab can commit an older value after
  // a peer committed a newer one; that is the eventual-consistency note in
  // the coverage map (#2209), so the fold keeps it rather than the server
  // head.
  //
  // Checkpoint after every step, at host quiescence:
  // - every status is the one the model owes: `error` only for a failed
  //   first load, `cleaned-up` only for a tab stopped by cleanup; a
  //   reset-abandoned commit fails the source, which keeps a ready tab
  //   `ready` with an error on its health node (Law 5);
  // - the durable rows equal the fold;
  // - every open tab with no open transaction shows the durable rows. That
  //   includes a tab whose source stopped: it abandoned its transaction, so
  //   its peers' commits apply to it (Law 1, Law 3).
  // After the history, every tab recovers and catches up. Then every tab must
  // show the durable rows, and the durable rows must be the server head when
  // the fold says so.
  //
  // The model reads one production fact: the position a new stream asks the
  // server to start from. The simulated server answers that request; the
  // model does not judge it, except that a full-snapshot request must get a
  // full snapshot.
  type HistoryStep =
    | { kind: `server change`; key: number; pick: number }
    | { kind: `deploy` }
    | { kind: `peer reset` }
    | { kind: `advance`; tab: number; pick: number }
    | { kind: `catch up`; tab: number; pick: number }
    // A tab that closes for good. Generated histories never close a tab;
    // only the pinned #2209 replay does (see below).
    | { kind: `close`; tab: number }
    | { kind: `stop`; tab: number; pick: number }
    | { kind: `recover`; tab: number; pick: number }
  const historyStep: fc.Arbitrary<HistoryStep> = fc.oneof(
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant(`server change` as const),
        key: fc.integer({ min: 1, max: 4 }),
        pick: fc.nat(5),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ kind: fc.constant(`deploy` as const) }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ kind: fc.constant(`peer reset` as const) }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant(`advance` as const),
        tab: fc.nat(2),
        pick: fc.nat(5),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant(`catch up` as const),
        tab: fc.nat(2),
        // 0 delivers everything owed; n commits only the next n changes, as
        // a server answering at an earlier moment does.
        pick: fc.nat(3),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant(`stop` as const),
        tab: fc.nat(2),
        pick: fc.nat(3),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant(`recover` as const),
        tab: fc.nat(2),
        pick: fc.nat(1),
      }),
    },
  )
  const generatedHistory = fc.record({
    tabCount: fc.integer({ min: 2, max: 3 }),
    steps: fc.array(historyStep, { minLength: 8, maxLength: 24 }),
  })
  type GeneratedHistory = { tabCount: number; steps: Array<HistoryStep> }

  type ServerLog = {
    handle: number
    // Versions under the current handle; version 0 is the snapshot.
    snapshot: Map<number, string>
    changes: Array<{ version: number; message: Message<Item> }>
    rows: Map<number, string>
  }
  type TabModel = {
    stopped: StreamStop | undefined
    // The position the stream has delivered: a handle and a version. An
    // undefined handle means the stream owes a full snapshot.
    handle: number | undefined
    version: number
    // Messages of the open transaction, and whether it truncates first.
    open: Array<Message<Item>> | undefined
    truncates: boolean
    // Collection readiness: a new sync run is `loading` until its own
    // stream's first up-to-date. A stop before then is the final initial
    // failure, which puts the Collection in `error` (Electric's initial-sync
    // law). A Collection status changes only through its own source: a
    // peer's durable commit reloads the rows but leaves the status alone
    // (maintainer decision on PR #2265, Law 4).
    ready: boolean
    // A sync run that resumed from a persisted position, so Electric checks
    // that each update names a row it holds.
    resumed: boolean
    failedInitialSync: boolean
    // The stop that ended an open transaction, until the tab recovers. A
    // peer commit in that interval is the premise of the abandon law.
    stoppedMidTransaction: StreamStop | undefined
    closed: boolean
    // A peer reset abandoned this tab's open transaction. Electric still
    // holds it, so its next commit rejects and the source fails (maintainer
    // decision on PR #2265, Law 5); the app then restarts it.
    abandonedByReset: boolean
    failedByReset: boolean
  }
  const stops: ReadonlyArray<StreamStop> = [
    `error without retry`,
    `SDK gives up`,
    `signal aborted`,
    `cleanup`,
  ]
  const rowsOf = (rows: Map<number, string>): Array<Item> =>
    [...rows]
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.id - right.id)
  const position = (log: ServerLog, version: number) => ({
    handle: `h${log.handle}`,
    offset: `${version}_0`,
  })
  // The request a new stream made, read as a model position.
  const requestedPosition = (
    startedAt: { handle: string | undefined; offset: string },
    log: ServerLog,
  ): Pick<TabModel, `handle` | `version`> => {
    if (startedAt.handle === undefined || startedAt.offset === `-1`) {
      return { handle: undefined, version: -1 }
    }
    const handle = Number(startedAt.handle.slice(1))
    const version = Number(startedAt.offset.split(`_`)[0])
    return handle === log.handle
      ? { handle, version }
      : { handle, version: Number.NaN }
  }

  const runGeneratedHistory = async (
    { tabCount, steps }: GeneratedHistory,
    onKnownGap: () => void,
    onRecovery?: (
      divergentBeforeRecovery: boolean,
      how: `restart` | `reload`,
    ) => void,
    progressFormat: `current` | `missing` | `foreign` = `current`,
  ) => {
    host = openHost()
    const activeHost = host
    const tabs = await openWarmTabs(activeHost, tabCount, `eager`)
    const log: ServerLog = {
      handle: 1,
      snapshot: new Map(beforeDeploy.map((row) => [row.id, row.label])),
      changes: [],
      rows: new Map(beforeDeploy.map((row) => [row.id, row.label])),
    }
    const durable = new Map<number, string>()
    const models: Array<TabModel> = tabs.map(() => ({
      stopped: undefined,
      handle: undefined,
      version: -1,
      open: undefined,
      truncates: false,
      ready: false,
      failedInitialSync: false,
      resumed: false,
      stoppedMidTransaction: undefined,
      closed: false,
      abandonedByReset: false,
      failedByReset: false,
    }))
    let serverVersion = 0
    generatedReach.beginHistory()

    const commit = (model: TabModel) => {
      if (model.truncates) durable.clear()
      for (const message of model.open ?? []) {
        if (!(`key` in message)) continue
        const row = message.value
        if (message.headers.operation === `delete`) durable.delete(row.id)
        else durable.set(row.id, row.label)
      }
      model.open = undefined
      model.truncates = false
    }
    const abandon = (model: TabModel) => {
      model.open = undefined
      model.truncates = false
    }
    // What the server sends one tab next: must-refetch for a stale handle,
    // the snapshot for a full-snapshot request, or the changes it owes.
    const deliver = async (
      index: number,
      upTo: number | `all`,
      commits: boolean,
    ) => {
      const tab = tabs[index]!
      const model = models[index]!
      if (model.handle !== undefined && model.handle !== log.handle) {
        tab.deliver([mustRefetch], {
          handle: `h${model.handle}`,
          offset: `${Math.max(model.version, 0)}_0`,
        })
        generatedReach.reach(`must-refetch delivered`)
        abandon(model)
        model.open = []
        model.truncates = true
        model.handle = undefined
        model.version = -1
        await activeHost.quiesce(`tab ${tab.tab} must-refetch`)
        if (!commits) return
      }
      const messages: Array<Message<Item>> = []
      if (model.handle === undefined) {
        model.open ??= []
        model.truncates = true
        messages.push(
          ...rowsOf(log.snapshot).map(insert),
          ...log.changes.map((change) => change.message),
        )
        model.handle = log.handle
        model.version = serverVersion
      } else {
        const owed = log.changes.filter(
          (change) => change.version > model.version,
        )
        const count = upTo === `all` ? owed.length : Math.min(upTo, owed.length)
        messages.push(...owed.slice(0, count).map((change) => change.message))
        model.version = count > 0 ? owed[count - 1]!.version : model.version
        if (messages.length > 0) model.open ??= []
      }
      // Electric's updates carry only changed columns (the shape's default
      // replica), so an update cannot create a row the tab does not hold,
      // and Electric drops it. The tab holds the durable rows, or, inside a
      // refetch, the snapshot it has received. Known gap: a resumed tab
      // instead reports an unseen row and fails (issue #2267). Generated
      // campaigns leave that history out; the pinned replay below keeps it.
      const held = new Set<number>(model.truncates ? [] : durable.keys())
      const track = (message: Message<Item>) => {
        if (!(`key` in message)) return
        if (message.headers.operation === `delete`)
          held.delete(message.value.id)
        else held.add(message.value.id)
      }
      for (const message of model.open ?? []) track(message)
      const applied = messages.filter((message) => {
        if (
          `key` in message &&
          message.headers.operation === `update` &&
          !held.has(message.value.id)
        ) {
          if (model.resumed && !model.truncates) onKnownGap()
          return false
        }
        track(message)
        return true
      })
      model.open?.push(...applied)
      const complete = commits
      if (messages.length === 0 && !complete) return
      tab.deliver(
        complete ? [...messages, upToDate] : messages,
        position(log, model.version),
      )
      if (complete && model.abandonedByReset) {
        generatedReach.reach(
          `reset-abandoned commit put the Collection in error`,
        )
        abandon(model)
        model.abandonedByReset = false
        model.failedByReset = true
      } else if (complete) {
        commit(model)
        model.ready = true
      }
      await activeHost.quiesce(`tab ${tab.tab} delivered`)
    }
    const recover = async (index: number, how: `restart` | `reload`) => {
      if (progressFormat !== `current`) {
        await activeHost.rewriteSourceProgress(progressFormat)
        progressFormat = `current`
      }
      const divergentBeforeRecovery =
        JSON.stringify(rowsOf(durable)) !== JSON.stringify(rowsOf(log.rows))
      const stopped = tabs[index]!
      const streamsBefore = stopped.streamCount()
      let recovered = stopped
      if (how === `restart`) await stopped.restart()
      else {
        await stopped.close()
        await activeHost.quiesce(`tab ${stopped.tab} closed`)
        recovered = activeHost.openTab(stopped.tab, `eager`)
        tabs[index] = recovered
      }
      abandon(models[index]!)
      await waitForStream(recovered, streamsBefore + 1)
      generatedReach.reach(`tab recovered`)
      const requested = requestedPosition(recovered.startedAt(), log)
      Object.assign(models[index]!, {
        stopped: undefined,
        ready: false,
        failedInitialSync: false,
        resumed: requested.handle !== undefined,
        stoppedMidTransaction: undefined,
        abandonedByReset: false,
        failedByReset: false,
        ...requested,
      })
      await activeHost.quiesce(`tab ${recovered.tab} recovered`)
      onRecovery?.(divergentBeforeRecovery, how)
    }

    const check = async (label: string, head?: Array<Item>) => {
      const expectedDurable = head ?? rowsOf(durable)
      // A tab closed for good is a cleaned-up Collection with no rows.
      const judgesRows = (index: number) =>
        models[index]!.open === undefined &&
        models[index]!.stopped !== `cleanup` &&
        !models[index]!.closed
      const expectedStatus = (index: number) =>
        models[index]!.stopped === `cleanup` || models[index]!.closed
          ? `cleaned-up`
          : models[index]!.failedInitialSync ||
              (models[index]!.failedByReset && !models[index]!.ready)
            ? `error`
            : models[index]!.ready
              ? `ready`
              : `loading`
      const expected = {
        durableRows: expectedDurable,
        tabs: tabs.map((tab, index) => ({
          tab: tab.tab,
          status: expectedStatus(index),
          ...(judgesRows(index) ? { rows: expectedDurable } : {}),
          // The reset-abandoned source failed (Law 5).
          ...(models[index]!.failedByReset ? { sourceError: true } : {}),
        })),
      }
      const actual = {
        durableRows: await activeHost.durableRows(),
        tabs: tabs.map((tab, index) => ({
          tab: tab.tab,
          status: tab.collection.status,
          ...(judgesRows(index) ? { rows: tab.publicRows() } : {}),
          ...(models[index]!.failedByReset
            ? { sourceError: tab.collection.health.error !== null }
            : {}),
        })),
      }
      // fast-check reports only the message, so it carries both sides, plus
      // each errored Collection's reason, which `preload()` rejects with.
      const errors = await Promise.all(
        tabs.map((tab) =>
          tab.collection.status === `error`
            ? tab.collection.preload().then(
                () => undefined,
                (error: unknown) => `${tab.tab}: ${String(error)}`,
              )
            : undefined,
        ),
      )
      expect(
        actual,
        `${label}\nactual   ${JSON.stringify(actual)}\nexpected ${JSON.stringify(expected)}\nerrors   ${JSON.stringify(errors.filter(Boolean))}`,
      ).toEqual(expected)
    }

    // Warm start: every tab delivers the snapshot and commits it.
    for (const index of tabs.keys()) await deliver(index, `all`, true)
    await check(`warm`)

    for (const [stepIndex, step] of steps.entries()) {
      const openBefore = models.some((model) => model.open !== undefined)
      const unreadyBefore = models.some(
        (model) =>
          model.stopped !== `cleanup` &&
          (!model.ready || model.failedInitialSync),
      )
      const noticesBefore = activeHost.commitNotices()
      if (step.kind === `server change`) {
        serverVersion++
        const present = log.rows.has(step.key)
        const operation = !present
          ? `insert`
          : step.pick % 3 === 0
            ? `delete`
            : `update`
        const row = { id: step.key, label: `v${serverVersion}` }
        if (operation === `delete`) log.rows.delete(step.key)
        else log.rows.set(step.key, row.label)
        log.changes.push({
          version: serverVersion,
          message: {
            key: String(row.id),
            value: row,
            headers: { operation },
          },
        })
      } else if (step.kind === `close`) {
        const index = step.tab % tabs.length
        await tabs[index]!.close()
        abandon(models[index]!)
        models[index]!.closed = true
        await activeHost.quiesce(`tab ${tabs[index]!.tab} closed for good`)
      } else if (step.kind === `peer reset`) {
        // A peer reset abandons every open reserved transaction that began
        // before it (maintainer decision on PR #2265). It changes no durable
        // row, so every tab reloads the same durable rows.
        if (models.some((model) => model.open !== undefined)) {
          generatedReach.reach(`peer reset abandoned an open transaction`)
        }
        for (const model of models) {
          if (model.open !== undefined && model.stopped === undefined) {
            model.abandonedByReset = true
          }
          abandon(model)
        }
        activeHost.broadcastPeerReset()
        await activeHost.quiesce(`peer reset applied`)
      } else if (step.kind === `deploy`) {
        log.handle++
        serverVersion = 0
        log.snapshot = new Map(log.rows)
        log.changes = []
      } else {
        // A stop goes to a tab with an open transaction when there is one,
        // so the generator reaches the state the abandon law is about.
        const openTabs = models.flatMap((model, index) =>
          model.open !== undefined && model.stopped === undefined
            ? [index]
            : [],
        )
        // Only `recover` recovers a stopped tab. Another step aimed at a
        // stopped tab goes to a running one, so a stopped tab stays stopped
        // while its peers commit.
        const runningTabs = models.flatMap((model, index) =>
          model.stopped === undefined && !model.failedByReset ? [index] : [],
        )
        const index =
          step.kind === `stop` && openTabs.length > 0
            ? openTabs[step.tab % openTabs.length]!
            : step.kind !== `recover` &&
                (models[step.tab % tabs.length]!.stopped !== undefined ||
                  models[step.tab % tabs.length]!.failedByReset) &&
                runningTabs.length > 0
              ? runningTabs[step.tab % runningTabs.length]!
              : step.tab % tabs.length
        const model = models[index]!
        if (
          model.stopped !== undefined ||
          model.failedByReset ||
          step.kind === `recover`
        ) {
          // A running tab can only reload; a stopped tab restarts or reloads.
          const how =
            (model.stopped === undefined && !model.failedByReset) ||
            (step.kind === `recover` && step.pick === 1)
              ? `reload`
              : `restart`
          await recover(index, how)
        } else if (step.kind === `stop`) {
          const how = stops[step.pick % stops.length]!
          if (model.open !== undefined) {
            generatedReach.reach(`source stopped with an open transaction`)
            model.stoppedMidTransaction = how
          }
          void Promise.resolve(tabs[index]!.stopStream(how)).catch(
            () => undefined,
          )
          model.stopped = how
          // Electric abandons the dead transaction itself, so nothing errors.
          model.abandonedByReset = false
          abandon(model)
          model.failedInitialSync = how !== `cleanup` && !model.ready
          await activeHost.quiesce(`tab ${tabs[index]!.tab} stopped`)
        } else {
          await deliver(
            index,
            step.kind === `catch up`
              ? step.pick === 0
                ? `all`
                : step.pick
              : step.pick + 1,
            step.kind === `catch up`,
          )
        }
      }
      if (activeHost.commitNotices() > noticesBefore) {
        for (const model of models) {
          const stop = model.stoppedMidTransaction
          if (
            stop === `error without retry` ||
            stop === `SDK gives up` ||
            stop === `signal aborted`
          ) {
            generatedReach.reach(`peer commit after ${stop} mid-transaction`)
          }
        }
      }
      if (unreadyBefore && activeHost.commitNotices() > noticesBefore) {
        generatedReach.reach(`peer commit while a tab was not ready`)
      }
      if (openBefore && activeHost.commitNotices() > noticesBefore) {
        const stillOpen = models.some((model) => model.open !== undefined)
        if (stillOpen) {
          generatedReach.reach(
            `peer commit during an open reserved transaction`,
          )
        }
      }
      if (rowsOf(durable).some(({ id, label }) => log.rows.get(id) !== label)) {
        generatedReach.reach(`durable rows behind the server`)
      }
      await check(`after step ${stepIndex}: ${JSON.stringify(step)}`)
    }

    // Law 2: every open tab recovers and catches up, and then the durable
    // rows and every open tab show the server head. Each tab's last batch
    // rewrites every row that changed after its position, so no lagging
    // commit survives the catch-up.
    for (const index of tabs.keys()) {
      if (models[index]!.closed) continue
      if (
        models[index]!.stopped !== undefined ||
        models[index]!.failedByReset
      ) {
        await recover(index, `restart`)
      }
      await deliver(index, `all`, true)
      // A reset-abandoned transaction fails only when delivery tries to
      // commit it. Judge Law 5 at that cut before the restart establishes
      // Law 2's successful catch-up premise.
      await check(`after final delivery to tab ${tabs[index]!.tab}`)
      if (models[index]!.failedByReset) {
        await recover(index, `restart`)
        await deliver(index, `all`, true)
        await check(`after reset recovery of tab ${tabs[index]!.tab}`)
      }
    }
    await check(`after every tab caught up`, rowsOf(log.rows))
    if (models.every((model) => !model.closed)) {
      expect(
        sourceHeadViolation(rowsOf(log.rows), {
          durableRows: await activeHost.durableRows(),
          tabs: tabs.map((tab) => ({
            status: tab.collection.status,
            rows: tab.publicRows(),
          })),
        }),
      ).toBeUndefined()
    }
  }

  // Construct the missing interaction instead of waiting for an unconstrained
  // shuffle to draw it. One stream commits an even number of membership
  // changes, its peer commits only the first, then the faster stream commits
  // either no rows or a disjoint update. Reopening the lagging peer must still
  // reach the source head. Swapping tabs, both initial memberships, repeated
  // toggles, and draining before recovery distinguish nearby legal histories.
  // Recovery 0 stops the source and restarts the same Collection; recovery 1
  // reloads the tab, closing its Collection and opening a new one. The reach
  // callback records the driver's actual recovery branch, not the input pick.
  // Removing the lagging commit or the later advancement loses the defect;
  // draining is the neighboring non-divergent control. A prefix longer than
  // the source log is excluded by construction.
  const sourcePrefixHistory = fc.record({
    key: fc.constantFrom(1, 3),
    pairs: fc.integer({ min: 1, max: 3 }),
    fastTab: fc.integer({ min: 0, max: 1 }),
    advancingBatch: fc.constantFrom(`empty` as const, `disjoint` as const),
    drain: fc.boolean(),
    recovery: fc.integer({ min: 0, max: 1 }),
    progressFormat: fc.constantFrom(
      `current` as const,
      `missing` as const,
      `foreign` as const,
    ),
  })
  const runSourcePrefixCampaign = async (
    parameters: ReturnType<typeof oraclePropertyOptions>,
  ) => {
    const states = [
      `present/empty`,
      `present/disjoint`,
      `absent/empty`,
      `absent/disjoint`,
      `drained before recovery`,
      `missing progress at recovery`,
      `foreign progress at recovery`,
      `divergent source restart`,
      `divergent source reload`,
    ] as const
    const reach = createOracleReach(`browser.electric-source-prefix`, states)
    await fc.assert(
      fc.asyncProperty(sourcePrefixHistory, async (history) => {
        reach.beginHistory()
        const slowTab = 1 - history.fastTab
        const steps: Array<HistoryStep> = [
          ...Array.from({ length: history.pairs * 2 }, (): HistoryStep => ({
            kind: `server change`,
            key: history.key,
            pick: 0,
          })),
          { kind: `catch up`, tab: history.fastTab, pick: 0 },
          { kind: `catch up`, tab: slowTab, pick: 1 },
          ...(history.advancingBatch === `disjoint`
            ? [{ kind: `server change` as const, key: 2, pick: 1 }]
            : []),
          { kind: `catch up`, tab: history.fastTab, pick: 0 },
          ...(history.drain
            ? [{ kind: `catch up` as const, tab: slowTab, pick: 0 }]
            : []),
          ...(history.recovery === 0
            ? [{ kind: `stop` as const, tab: slowTab, pick: 0 }]
            : []),
          { kind: `recover`, tab: slowTab, pick: history.recovery },
        ]
        let primary: { error: unknown } | undefined
        try {
          await runGeneratedHistory(
            { tabCount: 2, steps },
            () => fc.pre(false),
            (divergent, how) => {
              if (history.drain && !divergent)
                reach.reach(`drained before recovery`)
              if (!history.drain && divergent) {
                reach.reach(`divergent source ${how}`)
                reach.reach(
                  `${history.key === 1 ? `present` : `absent`}/${history.advancingBatch}`,
                )
              }
              if (history.progressFormat !== `current`) {
                reach.reach(`${history.progressFormat} progress at recovery`)
              }
            },
            history.progressFormat,
          )
        } catch (error) {
          primary = { error }
        } finally {
          await finishHistory(primary)
        }
      }),
      parameters,
    )
    console.info(`source prefix reach`, Object.fromEntries(reach.counts()))
    reach.assertReached()
  }
  it.skipIf(oracleReplayRequested())(
    `converges after interleaved source prefixes (fixed seed)`,
    () => runSourcePrefixCampaign({ numRuns: oracleRuns(80), seed: 2281 }),
    600_000,
  )
  oracleReplayTest(it, `browser.electric-source-prefix`)(
    `converges after interleaved source prefixes (random or replayed)`,
    () =>
      runSourcePrefixCampaign(
        oraclePropertyOptions(80, `browser.electric-source-prefix`),
      ),
    600_000,
  )

  type GeneratedReach =
    | `must-refetch delivered`
    | `peer commit during an open reserved transaction`
    | `source stopped with an open transaction`
    | `tab recovered`
    | `durable rows behind the server`
    | `peer commit while a tab was not ready`
    | `peer commit after error without retry mid-transaction`
    | `peer commit after SDK gives up mid-transaction`
    | `peer commit after signal aborted mid-transaction`
    | `peer reset abandoned an open transaction`
    | `reset-abandoned commit put the Collection in error`
  // The storm driver and the generated-history driver are the checks; the
  // generated driver folds committed batches into its own model of durable
  // rows. The storm cells and the generated-history arbitrary are the grammar.
  declareOracle({
    check: [runStormHistory, runGeneratedHistory],
    grammar: [stormHistories, generatedHistory, sourcePrefixHistory],
  })

  const createGeneratedReach = () =>
    createOracleReach<GeneratedReach>(`browser.multi-tab-reserved-history`, [
      `must-refetch delivered`,
      `peer commit during an open reserved transaction`,
      `source stopped with an open transaction`,
      `tab recovered`,
      `durable rows behind the server`,
      `peer commit while a tab was not ready`,
      `peer commit after error without retry mid-transaction`,
      `peer commit after SDK gives up mid-transaction`,
      `peer commit after signal aborted mid-transaction`,
      `peer reset abandoned an open transaction`,
      `reset-abandoned commit put the Collection in error`,
    ])
  let generatedReach = createGeneratedReach()

  const runGeneratedCampaign = async (
    parameters: ReturnType<typeof oraclePropertyOptions>,
  ) => {
    generatedReach = createGeneratedReach()
    await fc.assert(
      fc.asyncProperty(generatedHistory, async (history) => {
        let primary: { error: unknown } | undefined
        try {
          // fc.pre discards a history that reaches the known gap.
          await runGeneratedHistory(history, () => fc.pre(false))
        } catch (error) {
          primary = { error }
        } finally {
          await finishHistory(primary)
        }
      }),
      parameters,
    )
    console.info(
      `multi-tab generated reach`,
      Object.fromEntries(generatedReach.counts()),
    )
    generatedReach.assertReached()
  }
  it.skipIf(oracleReplayRequested())(
    `keeps reserved commits lawful across generated multi-tab histories (fixed seed)`,
    () =>
      runGeneratedCampaign({
        numRuns: oracleRuns(GENERATED_RUNS),
        seed: GENERATED_FIXED_SEED,
      }),
    600_000,
  )
  oracleReplayTest(it, GENERATED_PROPERTY)(
    `keeps reserved commits lawful across generated multi-tab histories (random or replayed)`,
    () =>
      runGeneratedCampaign(
        oraclePropertyOptions(GENERATED_RUNS, GENERATED_PROPERTY),
      ),
    600_000,
  )

  // Known gap #2267, pinned: the shrunk generated history in which a resumed tab
  // that lags behind its peer receives an update for a row the peer already
  // deleted. It replays through the same driver and checks with the known-gap
  // detector off. Remove `fails` when Electric's resume check stops treating
  // rows from peers' commits as this stream's evidence.
  it.fails(
    `keeps a resumed lagging tab out of error when a peer deleted the row it updates`,
    () =>
      runGeneratedHistory(
        {
          tabCount: 2,
          steps: [
            { kind: `recover`, tab: 1, pick: 0 },
            { kind: `server change`, key: 2, pick: 1 },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `server change`, key: 2, pick: 0 },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `advance`, tab: 0, pick: 0 },
          ],
        },
        () => undefined,
      ),
    60_000,
  )

  // The final delivery can be the first attempt to commit a transaction
  // abandoned by the reset. The driver must observe its failure, recover,
  // and only then judge convergence. This replays the original issue trace.
  it(
    `recovers a reset-abandoned source that fails during final catch-up`,
    () =>
      runGeneratedHistory(
        {
          tabCount: 2,
          steps: [
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `advance`, tab: 1, pick: 0 },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `advance`, tab: 0, pick: 0 },
            { kind: `peer reset` },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `deploy` },
            { kind: `deploy` },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `server change`, key: 1, pick: 0 },
          ],
        },
        () => undefined,
      ),
    60_000,
  )

  // The later no-deploy reset trace reaches the same final-delivery failure
  // from a reloaded tab. Recovery must happen after that failed commit too.
  // Seed -1371495859, path 75:0:0:0:0:0:0:1:1:0:0.
  it(
    `recovers a reloaded source whose final commit was abandoned by a peer reset`,
    () =>
      runGeneratedHistory(
        {
          tabCount: 2,
          steps: [
            { kind: `recover`, tab: 0, pick: 0 },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `advance`, tab: 0, pick: 0 },
            { kind: `advance`, tab: 1, pick: 0 },
            { kind: `advance`, tab: 0, pick: 0 },
            { kind: `peer reset` },
            { kind: `advance`, tab: 0, pick: 0 },
            { kind: `server change`, key: 1, pick: 0 },
          ],
        },
        () => undefined,
      ),
    60_000,
  )

  // A discontinuous source prefix does not corrupt the cached key set. Keep
  // durable rows visible during reload while a fresh source snapshot repairs
  // continuation. This is a reduced random history, replayed by the same law.
  it(
    `keeps cached rows visible while recovering a discontinuous source`,
    () =>
      runGeneratedHistory(
        {
          tabCount: 2,
          steps: [
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `catch up`, tab: 1, pick: 1 },
            { kind: `catch up`, tab: 0, pick: 0 },
            { kind: `recover`, tab: 0, pick: 0 },
            { kind: `recover`, tab: 0, pick: 0 },
            { kind: `stop`, tab: 0, pick: 0 },
            { kind: `peer reset` },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `catch up`, tab: 0, pick: 0 },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `advance`, tab: 0, pick: 0 },
          ],
        },
        () => undefined,
      ),
    60_000,
  )

  // Known gap #2209, pinned: tab A commits v1 and v2; tab B's lagging stream
  // then commits only v1, so the durable row falls back to v1, and B closes
  // for good. Nothing redelivers the head to A, so Law 2's final check fails.
  // Generated histories never close a tab for good, which leaves this
  // history out of them; it replays through the same driver and checks.
  // Remove `fails` when source writes are ordered by server position.
  it.fails(
    `converges an open tab to the head after a lagging tab commits an older row and closes`,
    () =>
      runGeneratedHistory(
        {
          tabCount: 2,
          steps: [
            { kind: `server change`, key: 1, pick: 1 },
            { kind: `catch up`, tab: 0, pick: 0 },
            { kind: `server change`, key: 1, pick: 1 },
            { kind: `catch up`, tab: 0, pick: 0 },
            { kind: `catch up`, tab: 1, pick: 1 },
            { kind: `close`, tab: 1 },
          ],
        },
        () => undefined,
      ),
    60_000,
  )

  // Regression from the random campaign (seed -1660880085, path
  // 55:0:1:4:4:4:1:1:1:1:3:4:4:4:4): row 1 reaches v2 on the server and both
  // tabs catch up, but after tab B stops, tab A catches up, and tab A stops,
  // the durable rows lose row 1. Law 2 expects every open tab and the durable
  // rows to show the head. The source-progress repair forces a fresh snapshot.
  // It replays through the same driver and checks with the known-gap detector
  // off. The generated source-prefix campaign extends this same law.
  it(
    `keeps a durable row after both tabs catch up to it and then stop`,
    () =>
      runGeneratedHistory(
        {
          tabCount: 2,
          steps: [
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `catch up`, tab: 0, pick: 0 },
            { kind: `server change`, key: 1, pick: 0 },
            { kind: `catch up`, tab: 0, pick: 0 },
            { kind: `catch up`, tab: 1, pick: 1 },
            { kind: `catch up`, tab: 0, pick: 0 },
            { kind: `stop`, tab: 1, pick: 0 },
            { kind: `catch up`, tab: 0, pick: 0 },
            { kind: `stop`, tab: 0, pick: 0 },
          ],
        },
        () => undefined,
      ),
    60_000,
  )

  // Issue #2281 reduces to the same six-step history for both membership
  // directions. A stores two server changes; B stores only the first. A's
  // next up-to-date stores its newer cursor without restoring the second
  // change. B then reopens from that cursor and never receives the missing
  // change. Law 2 still requires the server head at the final checkpoint.
  // These regressions replay the same model and comparison as the generated
  // source-prefix campaign above.
  for (const { key, behavior } of [
    { key: 1, behavior: `keeps a reinserted row` },
    { key: 3, behavior: `keeps a deleted row absent` },
  ]) {
    const stalePrefix: Array<HistoryStep> = [
      { kind: `server change`, key, pick: 0 },
      { kind: `server change`, key, pick: 0 },
      { kind: `catch up`, tab: 0, pick: 0 },
      { kind: `catch up`, tab: 1, pick: 1 },
    ]
    const publishCursor: HistoryStep = { kind: `catch up`, tab: 0, pick: 0 }
    const reopenPeer: HistoryStep = { kind: `recover`, tab: 1, pick: 0 }

    // Keeping only the maximum cursor does not repair these rows.
    it(
      `${behavior} after a cursor-only commit and a lagging tab reload`,
      () =>
        runGeneratedHistory(
          {
            tabCount: 2,
            steps: [...stalePrefix, publishCursor, reopenPeer],
          },
          () => undefined,
        ),
      60_000,
    )

    // A peer that drains its backlog supplies the missing change itself.
    it(
      `${behavior} when the lagging stream drains before reloading`,
      () =>
        runGeneratedHistory(
          {
            tabCount: 2,
            steps: [
              ...stalePrefix,
              publishCursor,
              { kind: `catch up`, tab: 1, pick: 0 },
              reopenPeer,
            ],
          },
          () => undefined,
        ),
      60_000,
    )

    // Without A's cursor-only commit, B resumes from its older position and
    // receives the missing change. This distinguishes cursor advancement
    // from reload or lag alone as the cause of the permanent mismatch.
    it(
      `${behavior} when the lagging tab reloads before the cursor advances`,
      () =>
        runGeneratedHistory(
          { tabCount: 2, steps: [...stalePrefix, reopenPeer] },
          () => undefined,
        ),
      60_000,
    )
  }
})
