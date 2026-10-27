// @vitest-environment node
/**
 * # Do Electric tabs that share one persisted database agree with the server?
 *
 * Several Browser tabs open the same persisted Electric Collection. Each tab
 * runs its own Electric stream, and all of them store through one SQLite
 * database and one elected leader. Tabs coordinate only through durable
 * commits and the notices those commits broadcast. This file is the Browser
 * host owner for two laws about that arrangement.
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
 * streams catch up. The law judged here is narrower and observable: a tab
 * whose own stream has applied the server head shows the head once the hosts
 * are quiet. When the lagging tab closes before it catches up, nothing
 * redelivers the head to the faster tab, so this law fails today. That
 * history is pinned with `it.fails` until #2209 orders source writes by
 * server position.
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
 * A Collection in `error` after resume invalidation has no promised rows, so
 * its rows are judged only after recovery. Removing Electric's abandon in
 * resume invalidation changes only those unjudged rows, so that mutant
 * survives here. Electric's own cleanup abandon is redundant behind the
 * persisted wrapper, which ends its transactions on cleanup; the Electric
 * descriptor-isolation oracle judges it without persistence.
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
import { createCollection } from '@tanstack/db'
import { createOracleReach } from '../../db/tests/oracle-reach.js'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../../electric-db-collection/src/electric'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import { createBrowserWASQLitePersistence } from '../src/browser-persistence'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
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
      ShapeStream: vi.fn(
        (options: {
          headers?: Record<string, string>
          offset?: string
          handle?: string
          onError?: (error: unknown) => unknown
        }) => {
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
            fetchSnapshot: vi
              .fn()
              .mockResolvedValue({ metadata: {}, data: [] }),
            forceDisconnectAndRefresh: vi.fn().mockResolvedValue(undefined),
            isUpToDate: false,
            get shapeHandle() {
              return stream.shapeHandle
            },
            get lastOffset() {
              return stream.lastOffset
            },
          }
        },
      ),
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
  // Host activity for the quiescence checkpoint, and the number of commit
  // notices, read from the coordinator's own channel.
  let activity = 0
  let commitNotices = 0
  const channel = new BroadcastChannel(`tsdb:coord:${dbName}`)
  channel.onmessage = (event: MessageEvent) => {
    activity++
    const envelope = event.data as {
      senderId?: string
      payload?: { type?: string }
    }
    if (envelope.payload?.type === `tx:committed` && envelope.senderId) {
      commitNotices++
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
      await collection.cleanup().catch(() => undefined)
      coordinator.dispose()
      await database.close?.()
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

  // The hosts are quiet when several tasks pass with no SQL statement and no
  // coordinator message. The bound turns a livelock into a named failure.
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
    close: async () => {
      for (const close of closers.reverse()) await close()
      channel.close()
      rmSync(directory, { recursive: true, force: true })
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
  afterEach(async () => {
    await host?.close()
    host = undefined
    streams.length = 0
  })

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
  // that resume invalidation puts the Collection in `error`, as Electric
  // documents. The application's recovery, cleanup and a restart, then brings
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
  it.each(stormHistories)(
    `commits every reserved refetch across tabs ($tabCount tabs, $syncMode, $finisher finishes first, $arrival, open $open, stop: $stop, recovery: $recovery)`,
    async ({ tabCount, syncMode, finisher, arrival, open, stop, recovery }) => {
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
      // reserved commit puts its Collection in `error`. A stopped tab that is
      // still open shows its peers' refetch, except after cleanup (no rows)
      // or resume invalidation (`error`, rows not promised). Eager rows must
      // equal the head snapshot; on-demand rows are not judged (above).
      const stoppedStatus =
        stop === `cleanup`
          ? `cleaned-up`
          : stop === `resume invalidated`
            ? `error`
            : `ready`
      const judgesRowsBeforeRestart = (tab: Tab) =>
        syncMode === `eager` &&
        (tab !== stoppedTab ||
          (stop !== `cleanup` && stop !== `resume invalidated`))
      const observe = (judgesRows: (tab: Tab) => boolean) =>
        tabs.map((tab) => ({
          tab: tab.tab,
          status: tab.collection.status,
          ...(judgesRows(tab) ? { rows: tab.publicRows() } : {}),
        }))
      expect(observe(judgesRowsBeforeRestart)).toEqual(
        tabs.map((tab) => ({
          tab: tab.tab,
          status: tab === stoppedTab ? stoppedStatus : `ready`,
          ...(judgesRowsBeforeRestart(tab) ? { rows: afterDeploy } : {}),
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
        expect(observe(() => syncMode === `eager`)).toEqual(
          tabs.map((tab) => ({
            tab: tab.tab,
            status: `ready`,
            ...(syncMode === `eager` ? { rows: afterDeploy } : {}),
          })),
        )
      }
      reach.assertReached()
    },
    30_000,
  )

  // Law 2 histories: tab A's stream applies v1 and v2; tab B's lagging stream
  // applies v1 later. B then either catches up or closes. The checkpoint is
  // host quiescence after the last delivery.
  const lagging = async (bEnds: `catches up` | `closes`) => {
    host = openHost()
    const [a, b] = await openWarmTabs(host, 2, `eager`)
    for (const tab of [a!, b!]) {
      tab.deliver([insert({ id: 1, label: `v0` }), upToDate], {
        handle: `h1`,
        offset: `10_0`,
      })
      await host.quiesce(`tab ${tab.tab} warm`)
    }
    a!.deliver([update({ id: 1, label: `v1` }), upToDate], {
      handle: `h1`,
      offset: `20_0`,
    })
    await host.quiesce(`A applied v1`)
    a!.deliver([update({ id: 1, label: `v2` }), upToDate], {
      handle: `h1`,
      offset: `30_0`,
    })
    await host.quiesce(`A applied the head`)
    b!.deliver([update({ id: 1, label: `v1` }), upToDate], {
      handle: `h1`,
      offset: `20_0`,
    })
    await host.quiesce(`lagging B applied v1`)
    if (bEnds === `catches up`) {
      b!.deliver([update({ id: 1, label: `v2` }), upToDate], {
        handle: `h1`,
        offset: `30_0`,
      })
    } else {
      await b!.close()
    }
    await host.quiesce(`B ${bEnds}`)
    // A's own stream applied the head, so A must show it.
    expect(a!.publicRows()).toEqual([{ id: 1, label: `v2` }])
  }

  it.each([`catches up`] as const)(
    `converges a tab that applied the head when the lagging tab %s`,
    (bEnds) => lagging(bEnds),
    30_000,
  )

  // Known gap (#2209): nothing redelivers the head to tab A after the lagging
  // tab stored v1 and closed. Ordering source writes by server position fixes
  // it; move `closes` into the passing values with that change.
  it.fails.each([`closes`] as const)(
    `converges a tab that applied the head when the lagging tab %s`,
    (bEnds) => lagging(bEnds),
    30_000,
  )
})
