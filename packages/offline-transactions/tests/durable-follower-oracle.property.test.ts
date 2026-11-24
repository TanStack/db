/**
 * # Does a follower's write survive with `followerWrites: 'durable'`?
 *
 * Law and source: issue #2464 asks that a write from a follower tab not depend
 * on which tab leads. With `followerWrites: 'durable'`, a follower saves its
 * write to the shared outbox before the write can be lost, the current or next
 * leader sends it, and the writing tab's transaction settles with its outcome.
 * The default, `'online'`, keeps the documented follower path with no outbox
 * entry and no channel.
 *
 * Model: in durable mode, every write made from an initialized tab is delivered
 * once after some tab leads while online, whether or not its tab is still open.
 * It stays pending until then, and the leader shows it optimistically. A write
 * the server rejects permanently fails in its open tab with the server's error,
 * and every other write completes. Only the leader sends a durable write. When
 * a settlement message is lost, the outcome the leader recorded settles the
 * waiter at the next leader's outbox check, with the server's error for a
 * rejected write. A leader that cannot read a saved write tries again when
 * connectivity changes. Stale and duplicate channel messages change nothing.
 * A write made before its tab initializes, and in online mode a follower's
 * write, uses the online path: the writing tab sends it, and offline it fails
 * and is never sent.
 *
 * History grammar: a mode and up to twelve actions over three tabs: write, a
 * write the server rejects, a write whose save is held or fails while a leader
 * message arrives, close a tab, reopen a tab, reopen a tab and write before it
 * initializes, go online or offline, lose the next settlement, deliver a stale
 * or duplicate message, fail the leader's admission read of a follower's saved
 * write, fail an outbox check's storage read, return a leader's admission read
 * only after a duplicate message sent and removed its write, fail the removal
 * of a sent follower write, announce a saved row the leader cannot decode,
 * return an admission read after leadership moved away and back while another
 * leader sent its write, and have the next leader's beforeRetry exclude a
 * follower's write while its settlement is lost.
 *
 * Production driver: real executors over one shared storage adapter, with a
 * controlled leader election, online detector and BroadcastChannel.
 *
 * Refinement check: after every action, pending writes stay pending and shown
 * by the leader once it read them, open channels match open tabs, and warnings
 * match the injected failures. After the history ends online with a leader,
 * each deliverable write reached the server exactly once from the tab the
 * model names, the outbox is empty, and each open tab's transaction has the
 * model's outcome and error. A lost settlement is recovered for the same write,
 * by the writer itself if it became leader, or else after one handover.
 *
 * A failed row removal after a successful send is not the write's outcome:
 * its writer waits, and the next leader finishes the removal. A row the leader
 * cannot decode is reported, not dropped, and a follower's failed outbox check
 * runs again when connectivity changes.
 *
 * Known omissions: a reloaded follower does not show another tab's pending
 * writes optimistically; rejection records of writers that never return are
 * kept; and no real browser contexts.
 */
import fc from 'fast-check'
import { expect, vi } from 'vitest'
import { NonRetriableError } from '../src/types'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import type {
  LeaderElection,
  OfflineMutationFnParams,
  OnlineDetector,
} from '../src/types'

const property = `offline.durable-follower-writes`
const TABS = 3
const MAX_ACTIONS = 12
const CHANNEL = `tanstack-offline-outbox:test-items`

const reachStates = [
  // A follower's write reached the server through the leader.
  `follower-write-delivered`,
  // A follower wrote offline and closed before the write was sent.
  `write-outlived-its-tab`,
  // The leader closed while holding a follower's unsent write.
  `leader-closed-with-follower-write`,
  // The server rejected a follower's write and its tab saw the failure.
  `follower-write-rejected`,
  // A lost settlement message was recovered by the next leader.
  `lost-settlement-recovered`,
  // A tab that stayed a follower recovered a lost settlement.
  `lost-settlement-recovered-by-follower`,
  // A follower's write used the default online path while offline.
  `online-mode-follower-write-failed`,
  // A message named a write that is no longer in the outbox.
  `stale-message-ignored`,
  // A second message named a write that is still queued.
  `duplicate-message-ignored`,
  // An admission's storage read failed.
  `admission-read-failed`,
  // An outbox check's storage read failed.
  `outbox-check-read-failed`,
  // A leader message arrived while a write was still being saved.
  `leader-message-during-save`,
  // A follower's save failed after a leader message arrived.
  `follower-save-failed`,
  // A leader's write completed in the default mode.
  `online-mode-leader-write-delivered`,
  // A write made before its tab initialized used the online path.
  `pre-initialization-write`,
  // A lost settlement of a rejected write still failed with its error.
  `lost-rejection-recovered`,
  // A saved write the leader could not read was sent after connectivity changed.
  `admission-retried`,
  // An admission read returned after its write was sent and removed.
  `stale-admission-ignored`,
  // A failed outbox check ran again on connectivity and settled a lost write.
  `reconcile-retried`,
  // A sent follower write's removal failed and its writer kept waiting.
  `removal-failure-not-announced`,
  // The leader reported a saved row it could not decode.
  `unreadable-write-reported`,
  // An admission read spanning a change of leadership was dropped.
  `stale-admission-across-terms`,
  // A lost exclusion by beforeRetry still failed its writer.
  `exclusion-recovered`,
  // A failed rejection record was retried while other writes kept running.
  `outcome-record-retried`,
  // A late admission during an exclusion's cleanup sent nothing.
  `excluded-admission-ignored`,
  // A saved write removed before any leader sent it failed its writer.
  `removed-unsent-failed`,
  // A save acknowledged after a change of leadership was admitted by id.
  `save-acknowledged-after-handover`,
  // A former leader with a faulted executor saved a write for its successor.
  `faulted-former-leader-saved`,
  // A tab whose start failed released its channel and leadership.
  `failed-start-released`,
  // A save that finished after its tab closed still reached the leader.
  `save-announced-after-dispose`,
  // A rejection whose writer had closed kept its record.
  `orphan-rejection-kept`,
] as const
type ReachState = (typeof reachStates)[number]

type TabActionType =
  | `write`
  | `write-rejected`
  | `write-during-leader-message`
  | `write-save-fails`
  | `close`
  | `open`
  | `open-and-write`
type SharedActionType =
  | `online`
  | `offline`
  | `lose-settlement`
  | `stale-added`
  | `duplicate-added`
  | `fail-admission-read`
  | `fail-outbox-check`
  | `stale-admission-read`
  | `fail-removal`
  | `unreadable-added`
  | `stale-admission-across-terms`
  | `exclude-on-handover`
  | `fail-outcome-record`
  | `remove-unsent`
  | `ack-after-handover`
  | `open-failing`
  | `dispose-during-save`
type Action = { type: TabActionType; tab: number } | { type: SharedActionType }
type Mode = `durable` | `online`
type History = { mode: Mode; actions: Array<Action> }

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const tabAction = (type: TabActionType) =>
  fc.record({ type: fc.constant(type), tab: fc.nat({ max: TABS - 1 }) })
const sharedAction = (type: SharedActionType) =>
  fc.record({ type: fc.constant(type) })
const actionArbitrary: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: tabAction(`write`) },
  { weight: 1, arbitrary: tabAction(`write-rejected`) },
  { weight: 1, arbitrary: tabAction(`write-during-leader-message`) },
  { weight: 1, arbitrary: tabAction(`write-save-fails`) },
  { weight: 2, arbitrary: tabAction(`close`) },
  { weight: 2, arbitrary: tabAction(`open`) },
  { weight: 1, arbitrary: tabAction(`open-and-write`) },
  { weight: 2, arbitrary: sharedAction(`offline`) },
  { weight: 2, arbitrary: sharedAction(`online`) },
  { weight: 1, arbitrary: sharedAction(`lose-settlement`) },
  { weight: 1, arbitrary: sharedAction(`stale-added`) },
  { weight: 1, arbitrary: sharedAction(`duplicate-added`) },
  { weight: 1, arbitrary: sharedAction(`fail-admission-read`) },
  { weight: 1, arbitrary: sharedAction(`fail-outbox-check`) },
  { weight: 1, arbitrary: sharedAction(`stale-admission-read`) },
  { weight: 1, arbitrary: sharedAction(`fail-removal`) },
  { weight: 1, arbitrary: sharedAction(`unreadable-added`) },
  { weight: 1, arbitrary: sharedAction(`stale-admission-across-terms`) },
  { weight: 1, arbitrary: sharedAction(`exclude-on-handover`) },
  { weight: 1, arbitrary: sharedAction(`fail-outcome-record`) },
  { weight: 1, arbitrary: sharedAction(`remove-unsent`) },
  { weight: 1, arbitrary: sharedAction(`ack-after-handover`) },
  { weight: 1, arbitrary: sharedAction(`open-failing`) },
  { weight: 1, arbitrary: sharedAction(`dispose-during-save`) },
)
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  mode: fc.constantFrom<Mode>(`durable`, `durable`, `durable`, `online`),
  actions: fc.array(actionArbitrary, { maxLength: MAX_ACTIONS }),
})
// Actions that leave the tabs, leadership and connectivity as they were.
const BENIGN = new Set<string>([
  `write`,
  `write-rejected`,
  `open`,
  `online`,
  `stale-added`,
  `duplicate-added`,
])
const spliced = (
  generated: History,
  prefix: Array<Action>,
  mode: Mode = `durable`,
  // A state judged when the history ends keeps the generated tail benign.
  benign = false,
): History => ({
  mode,
  actions: [
    ...prefix,
    ...generated.actions
      .filter((action) => !benign || BENIGN.has(action.type))
      .filter(
        (action) =>
          action.type !== `lose-settlement` &&
          action.type !== `fail-admission-read` &&
          action.type !== `fail-outbox-check` &&
          action.type !== `stale-admission-read` &&
          action.type !== `fail-removal` &&
          action.type !== `unreadable-added` &&
          action.type !== `stale-admission-across-terms` &&
          action.type !== `exclude-on-handover` &&
          action.type !== `fail-outcome-record` &&
          action.type !== `remove-unsent` &&
          action.type !== `ack-after-handover` &&
          action.type !== `open-failing` &&
          action.type !== `dispose-during-save`,
      )
      .slice(0, MAX_ACTIONS - prefix.length),
  ],
})

// ---------------------------------------------------------------------------
// Controlled environment
// ---------------------------------------------------------------------------

class ControlledElection {
  holder: TabElection | undefined
  readonly queue: Array<TabElection> = []

  leave(tab: TabElection): void {
    const index = this.queue.indexOf(tab)
    if (index >= 0) this.queue.splice(index, 1)
    if (this.holder !== tab) return
    this.holder = this.queue.shift()
    tab.set(false)
    this.holder?.set(true)
  }
}

class TabElection implements LeaderElection {
  private leader = false
  private readonly listeners = new Set<(isLeader: boolean) => void>()
  constructor(
    private readonly shared: ControlledElection,
    private readonly hold?: Promise<void>,
    // The request joins the election, then rejects.
    private readonly fail = false,
  ) {}

  async requestLeadership(): Promise<boolean> {
    await this.hold
    if (!this.shared.holder) {
      this.shared.holder = this
      this.leader = true
    } else if (
      this.shared.holder !== this &&
      !this.shared.queue.includes(this)
    ) {
      this.shared.queue.push(this)
    }
    if (this.fail) throw new Error(`leadership request failed`)
    return this.leader
  }
  releaseLeadership(): void {
    this.shared.leave(this)
  }
  isLeader(): boolean {
    return this.leader
  }
  onLeadershipChange(callback: (isLeader: boolean) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  set(isLeader: boolean): void {
    this.leader = isLeader
    for (const listener of this.listeners) listener(isLeader)
  }
}

class ControlledOnline {
  online = true
  readonly listeners = new Set<() => void>()

  detector(): OnlineDetector {
    const own = new Set<() => void>()
    return {
      subscribe: (callback) => {
        own.add(callback)
        this.listeners.add(callback)
        return () => {
          own.delete(callback)
          this.listeners.delete(callback)
        }
      },
      notifyOnline: () => {
        for (const listener of [...this.listeners]) listener()
      },
      isOnline: () => this.online,
      dispose: () => {
        for (const callback of own) this.listeners.delete(callback)
        own.clear()
      },
    }
  }
  set(online: boolean): void {
    this.online = online
    if (online) for (const listener of [...this.listeners]) listener()
  }
}

class ReadFailingStorage extends FakeStorageAdapter {
  failReads = 0
  // The next read of this key fails.
  failReadKey: string | undefined
  // The next outcome record write fails.
  failOutcomeWrites = 0
  // The next write lands at once and acknowledges on release.
  private heldAck: { release: () => void } | null | undefined
  holdNextAck(): void {
    this.heldAck = null
  }
  releaseAck(): void {
    this.heldAck?.release()
    this.heldAck = undefined
  }
  // The next read captures its value at once and returns it on release.
  private staleRead: { release: () => void } | null | undefined
  private heldWrites: Array<(fail: boolean) => void> | null = null

  holdWrites(): void {
    this.heldWrites = []
  }
  releaseWrites(fail: boolean): void {
    const held = this.heldWrites ?? []
    this.heldWrites = null
    for (const release of held) release(fail)
  }
  failDeletes = 0
  override async delete(key: string): Promise<void> {
    if (this.failDeletes > 0 && key.startsWith(`tx:`)) {
      this.failDeletes -= 1
      throw new Error(`storage delete failed`)
    }
    return super.delete(key)
  }
  override async set(key: string, value: string): Promise<void> {
    if (this.failOutcomeWrites > 0 && key.startsWith(`outcome:`)) {
      this.failOutcomeWrites -= 1
      throw new Error(`storage write failed`)
    }
    if (this.heldAck === null && key.startsWith(`tx:`)) {
      await super.set(key, value)
      await new Promise<void>((release) => {
        this.heldAck = { release }
      })
      return
    }
    if (this.heldWrites) {
      const held = this.heldWrites
      const fail = await new Promise<boolean>((resolve) => held.push(resolve))
      if (fail) throw new Error(`storage write failed`)
    }
    return super.set(key, value)
  }
  holdNextRead(): void {
    this.staleRead = null
  }
  releaseRead(): void {
    this.staleRead?.release()
    this.staleRead = undefined
  }
  override async get(key: string): Promise<string | null> {
    if (this.failReadKey === key) {
      this.failReadKey = undefined
      throw new Error(`storage read failed`)
    }
    if (this.failReads > 0) {
      this.failReads -= 1
      throw new Error(`storage read failed`)
    }
    if (this.staleRead === null) {
      const value = await super.get(key)
      await new Promise<void>((release) => {
        this.staleRead = { release }
      })
      return value
    }
    return super.get(key)
  }
}

type ChannelMessage = { type: string; id?: string; error?: unknown }

function controlledChannels() {
  const open = new Set<ControlledChannel>()
  const state = {
    loseSettlement: false,
    lost: 0,
    lostIds: [] as Array<string>,
    created: 0,
  }
  const deliver = (from: ControlledChannel | null, data: ChannelMessage) => {
    const copy = structuredClone(data)
    for (const channel of open) {
      if (channel === from) continue
      setTimeout(() => {
        if (open.has(channel)) channel.onmessage?.({ data: copy })
      }, 0)
    }
  }
  class ControlledChannel {
    onmessage: ((event: { data: ChannelMessage }) => void) | null = null
    constructor(readonly name: string) {
      expect(name, `channel name`).toBe(CHANNEL)
      state.created += 1
      open.add(this)
    }
    postMessage(data: ChannelMessage): void {
      if (state.loseSettlement && data.type === `settled`) {
        state.loseSettlement = false
        state.lost += 1
        state.lostIds.push(data.id!)
        return
      }
      deliver(this, data)
    }
    close(): void {
      open.delete(this)
    }
  }
  return {
    ControlledChannel,
    state,
    openCount: () => open.size,
    inject: (data: ChannelMessage) => deliver(null, data),
  }
}

const settle = async () => {
  for (let turn = 0; turn < 12; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

type Write = {
  id: string
  transactionId?: string
  tab: number
  rejected: boolean
  deliverable: boolean
  fromFollower: boolean
  session: number
  // Made before its tab initialized, so it took the online path.
  preInit: boolean
  // The session of the leader whose admission read failed, until
  // connectivity changes.
  unadmittedBy?: number
  // A failed outbox check found this lost write pending.
  checkFailed: boolean
  // Its admission read failed at some point in the history.
  retried?: boolean
  // The next leader's beforeRetry excluded it.
  excluded?: boolean
  // removeFromOutbox removed it before any leader sent it.
  removed?: boolean
  // Its rejection record failed once.
  recordRetried?: boolean
  outcome?: `completed` | `failed`
  error?: unknown
}

const warningsFor =
  (warn: { mock: { calls: Array<Array<unknown>> } }) => (text: string) =>
    warn.mock.calls.filter(([message]) => message === text).length

async function runHistory(
  history: History,
  reach: (state: ReachState) => void,
): Promise<void> {
  const channels = controlledChannels()
  vi.stubGlobal(`BroadcastChannel`, channels.ControlledChannel)
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const warnings = warningsFor(warn)
  const durable = history.mode === `durable`
  const storage = new ReadFailingStorage()
  const election = new ControlledElection()
  const online = new ControlledOnline()
  const writes: Array<Write> = []
  const calls: Array<string> = []
  // Which tab called the server for each write, and which tab led then.
  const sends: Array<{ id: string; sender: number; leader?: number }> = []
  const rejected = new Set<string>()
  // Writes a new leader's beforeRetry excludes, by write id.
  const excluded = new Set<string>()
  const expectedWarnings = { admission: 0, check: 0 }
  type Tab = {
    env: ReturnType<typeof createTestOfflineEnvironment>
    election: TabElection
    session: number
  }
  const tabs: Array<Tab | undefined> = Array.from({ length: TABS })
  let sessions = 0

  const openTab = async (
    index: number,
    beforeInit?: () => Promise<void>,
    hold?: Promise<void>,
    failStart = false,
  ) => {
    const tabElection = new TabElection(election, hold, failStart)
    const session = ++sessions
    const env = createTestOfflineEnvironment({
      storage,
      // Each tab names its collection differently under the shared key.
      collectionId: `items-${session}`,
      registryKey: `test-items`,
      mutationFn: (params: OfflineMutationFnParams) => {
        const id = String(params.transaction.mutations[0].key)
        // The server is unreachable while offline, whichever path sends it.
        if (!online.online) throw new Error(`offline`)
        calls.push(id)
        sends.push({
          id,
          sender: session,
          leader: tabs[leaderIndex()]?.session,
        })
        if (rejected.has(id)) throw new NonRetriableError(`rejected ${id}`)
        return { ok: true }
      },
      config: {
        ...(durable ? { followerWrites: `durable` } : {}),
        leaderElection: tabElection,
        onlineDetector: online.detector(),
        beforeRetry: (
          transactions: Array<{ mutations: Array<{ key: unknown }> }>,
        ) =>
          transactions.filter(
            (transaction) =>
              !excluded.has(String(transaction.mutations[0]!.key)),
          ),
        jitter: false,
      } as never,
    })
    tabs[index] = { env, election: tabElection, session }
    await beforeInit?.()
    if (failStart) {
      await env.executor.waitForInit().catch(() => undefined)
    } else await env.executor.waitForInit()
    await settle()
  }
  // Leadership moves tab to tab until `target` leads, at least once.
  const rotateTo = async (target: TabElection) => {
    for (let turn = 0; turn < TABS + 1; turn++) {
      const holder = election.holder!
      if (turn > 0 && holder === target) return
      holder.releaseLeadership()
      await settle()
      await holder.requestLeadership()
      await settle()
    }
  }
  const closeTab = async (index: number) => {
    const tab = tabs[index]
    if (!tab) return
    tabs[index] = undefined
    expect(() => tab.env.executor.dispose(), `close tab ${index}`).not.toThrow()
    await settle()
  }
  const isUnsent = (write: Write) =>
    write.deliverable && !calls.includes(write.id)
  const leaderIndex = () =>
    tabs.findIndex((tab) => tab && tab.election === election.holder)
  const openSessions = () => new Set(tabs.flatMap((tab) => tab?.session ?? []))

  const check = (label: string) => {
    expect(
      [...warn.mock.calls, ...consoleError.mock.calls]
        .flat()
        .filter((value) => value instanceof TypeError),
      `${label}: no internal TypeError`,
    ).toEqual([])
    expect(channels.openCount(), `${label}: open channels`).toBe(
      durable ? tabs.filter(Boolean).length : 0,
    )
    expect(warnings(`Failed to run follower write:`), `${label}: admit`).toBe(
      expectedWarnings.admission,
    )
    expect(
      warnings(`Failed to reconcile follower writes:`),
      `${label}: outbox check`,
    ).toBe(expectedWarnings.check)
    if (!durable) return
    const sessionsOpen = openSessions()
    const leader = tabs[leaderIndex()]
    for (const write of writes) {
      if (!isUnsent(write)) continue
      if (sessionsOpen.has(write.session)) {
        expect(write.outcome, `${label}: ${write.id} stays pending`).toBe(
          undefined,
        )
      }
      if (leader && write.unadmittedBy !== leader.session) {
        expect(
          leader.env.collection.has(write.id),
          `${label}: leader shows ${write.id}`,
        ).toBe(true)
      }
    }
  }

  type WriteType =
    | `write`
    | `write-rejected`
    | `write-during-leader-message`
    | `write-save-fails`
  const doWrite = async (
    index: number,
    type: WriteType,
    preInit = false,
  ): Promise<Write | undefined> => {
    const tab = tabs[index]
    if (!tab) return undefined
    const fromFollower = leaderIndex() !== index
    const id = `write-${writes.length}`
    // Durable writes go through the shared outbox once the tab is ready.
    const shared = durable && !preInit
    const write: Write = {
      id,
      tab: index,
      rejected: type === `write-rejected`,
      deliverable: shared || (!preInit && !fromFollower) || online.online,
      fromFollower,
      session: tab.session,
      preInit,
      checkFailed: false,
    }
    writes.push(write)
    if (write.rejected) rejected.add(id)
    const saveFails = shared && type === `write-save-fails`
    const heldSave =
      saveFails || (shared && type === `write-during-leader-message`)
    if (saveFails) write.deliverable = false
    if (heldSave) storage.holdWrites()
    if (!durable && !fromFollower && online.online) {
      reach(`online-mode-leader-write-delivered`)
    }
    if (!durable && fromFollower && !online.online) {
      reach(`online-mode-follower-write-failed`)
    }
    const transaction = tab.env.executor.createOfflineTransaction({
      mutationFnName: tab.env.mutationFnName,
      autoCommit: false,
    })
    write.transactionId = transaction.id
    const settled = transaction.mutate(() => {
      tab.env.collection.insert({
        id,
        value: id,
        completed: false,
        updatedAt: new Date(),
      })
    })
    void transaction.commit().catch(() => undefined)
    void settled.when(`settled`).then(
      () => {
        write.outcome = `completed`
      },
      (error: unknown) => {
        write.outcome = `failed`
        write.error = error
      },
    )
    await settle()
    if (heldSave) {
      channels.inject({ type: `leader` })
      await settle()
      expect(write.outcome, `${id} waits for its save`).toBe(undefined)
      reach(`leader-message-during-save`)
      if (saveFails && fromFollower) reach(`follower-save-failed`)
      storage.releaseWrites(saveFails)
      await settle()
    }
    return write
  }

  try {
    for (let index = 0; index < TABS; index++) await openTab(index)
    expect(channels.state.created, `channels created`).toBe(durable ? TABS : 0)

    for (const [step, action] of history.actions.entries()) {
      switch (action.type) {
        case `write`:
        case `write-rejected`:
        case `write-during-leader-message`:
        case `write-save-fails`:
          await doWrite(action.tab, action.type)
          break
        case `close`: {
          const leader = leaderIndex() === action.tab
          if (
            durable &&
            leader &&
            writes.some((write) => write.tab !== action.tab && isUnsent(write))
          ) {
            reach(`leader-closed-with-follower-write`)
          }
          if (
            durable &&
            !leader &&
            writes.some(
              (write) =>
                write.tab === action.tab &&
                write.session === tabs[action.tab]?.session &&
                isUnsent(write),
            )
          ) {
            reach(`write-outlived-its-tab`)
          }
          await closeTab(action.tab)
          break
        }
        case `open`:
          if (!tabs[action.tab]) await openTab(action.tab)
          break
        case `open-and-write`: {
          if (tabs[action.tab]) break
          // The write lands after the tab opens its channel, while its
          // election is still pending.
          let release!: () => void
          const hold = new Promise<void>((resolve) => {
            release = resolve
          })
          let made: Promise<Write | undefined> | undefined
          const channelsBefore = channels.state.created
          await openTab(
            action.tab,
            async () => {
              for (let turn = 0; turn < 50; turn++) {
                if (!durable || channels.state.created > channelsBefore) break
                await new Promise((resolve) => setTimeout(resolve, 0))
              }
              if (durable)
                expect(channels.state.created, `channel opened`).toBe(
                  channelsBefore + 1,
                )
              made = doWrite(action.tab, `write`, true)
              await Promise.resolve()
              release()
            },
            hold,
          )
          if (await made) reach(`pre-initialization-write`)
          break
        }
        case `online`:
          online.set(true)
          await settle()
          for (const write of writes) write.unadmittedBy = undefined
          break
        case `offline`:
          online.set(false)
          break
        case `lose-settlement`:
          if (durable) channels.state.loseSettlement = true
          break
        case `stale-added`:
          if (!durable || !tabs.some(Boolean)) break
          reach(`stale-message-ignored`)
          channels.inject({ type: `added`, id: `not-in-outbox` })
          await settle()
          break
        case `duplicate-added`: {
          const queued = writes.find(isUnsent)
          if (!durable || !queued || leaderIndex() < 0) break
          reach(`duplicate-message-ignored`)
          channels.inject({ type: `added`, id: queued.transactionId })
          await settle()
          break
        }
        case `fail-admission-read`: {
          // The leader's first read of a follower's saved write fails.
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leaderIndex(),
          )
          if (!durable || leaderIndex() < 0 || follower < 0) break
          reach(`admission-read-failed`)
          storage.failReads = 1
          expectedWarnings.admission += 1
          const leaderSession = tabs[leaderIndex()]!.session
          const write = await doWrite(follower, `write`)
          write!.unadmittedBy = leaderSession
          write!.retried = true
          break
        }
        case `stale-admission-read`: {
          // The leader's admission read stalls with the saved row; a duplicate
          // message sends and removes the write before the read returns.
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leaderIndex(),
          )
          if (!durable || !online.online || leaderIndex() < 0 || follower < 0)
            break
          storage.holdNextRead()
          const write = await doWrite(follower, `write`)
          if (!write) break
          channels.inject({ type: `added`, id: write.transactionId })
          await settle()
          storage.releaseRead()
          await settle()
          if (calls.includes(write.id)) reach(`stale-admission-ignored`)
          break
        }
        case `fail-removal`: {
          // The leader sends a follower's write, then fails to remove its row.
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leaderIndex(),
          )
          if (!durable || !online.online || leaderIndex() < 0 || follower < 0)
            break
          storage.failDeletes = 1
          const write = await doWrite(follower, `write`)
          // A queue still busy with earlier writes leaves the fault unused.
          if (!write || !calls.includes(write.id)) {
            storage.failDeletes = 0
            break
          }
          expect(write.outcome, `${write.id} waits after a cleanup fault`).toBe(
            undefined,
          )
          reach(`removal-failure-not-announced`)
          // The faulted leader stays open as a follower; the next leader
          // finishes the removal. A write from the faulted tab is saved for
          // that leader, which sends it.
          const faulted = leaderIndex()
          const successor = tabs.findIndex(
            (tab, index) => tab && index !== faulted,
          )
          await rotateTo(tabs[successor]!.election)
          const saved = await doWrite(faulted, `write`)
          if (saved) {
            expect(calls, `${saved.id} sent for the faulted tab`).toContain(
              saved.id,
            )
            reach(`faulted-former-leader-saved`)
          }
          await closeTab(faulted)
          break
        }
        case `unreadable-added`: {
          // A saved row this leader cannot decode is reported, not dropped.
          if (!durable || leaderIndex() < 0) break
          await storage.set(
            `tx:unreadable`,
            JSON.stringify({ id: `unreadable` }),
          )
          expectedWarnings.admission += 1
          channels.inject({ type: `added`, id: `unreadable` })
          await settle()
          expect(
            await storage.get(`tx:unreadable`),
            `the unreadable row is kept`,
          ).toBe(JSON.stringify({ id: `unreadable` }))
          reach(`unreadable-write-reported`)
          await storage.delete(`tx:unreadable`)
          break
        }
        case `stale-admission-across-terms`: {
          // The leader's admission read stalls. Leadership moves away, another
          // leader sends and removes the write, and leadership comes back
          // before the read returns.
          const first = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== first)
          if (
            !durable ||
            !online.online ||
            first < 0 ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3
          )
            break
          storage.holdNextRead()
          const write = await doWrite(writer, `write`)
          if (!write) break
          const original = tabs[first]!.election
          await rotateTo(original)
          expect(election.holder, `the original tab leads again`).toBe(original)
          expect(
            await storage.get(`tx:${write.transactionId}`),
            `another leader removed ${write.id}`,
          ).toBe(null)
          storage.releaseRead()
          await settle()
          if (calls.includes(write.id)) reach(`stale-admission-across-terms`)
          break
        }
        case `exclude-on-handover`: {
          // An offline follower write waits; its settlement is lost when the
          // next leader's beforeRetry excludes it.
          // The writer stays a follower, so it learns the exclusion only
          // from the record. In the default mode a follower's write is not
          // saved, so the leader writes and closes, and no record is kept.
          const leader = leaderIndex()
          const next = election.queue[0]
          const writer = durable
            ? tabs.findIndex(
                (tab, index) =>
                  tab && index !== leader && tab.election !== next,
              )
            : leader
          if (leader < 0 || writer < 0 || tabs.filter(Boolean).length < 3) break
          online.set(false)
          const write = await doWrite(writer, `write`)
          if (!write) break
          excluded.add(write.id)
          write.excluded = true
          write.deliverable = false
          channels.state.loseSettlement = true
          // The exclusion's record stalls, and an admission arrives meanwhile.
          if (durable) storage.holdWrites()
          await closeTab(leader)
          if (durable) {
            channels.inject({ type: `added`, id: write.transactionId })
            await settle()
            reach(`excluded-admission-ignored`)
            storage.releaseWrites(false)
            await settle()
          }
          channels.state.loseSettlement = false
          if (write.outcome === `failed`) reach(`exclusion-recovered`)
          break
        }
        case `fail-outcome-record`: {
          // A follower's write is rejected, its rejection record fails, and
          // another write after it still runs.
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leaderIndex(),
          )
          if (!durable || !online.online || leaderIndex() < 0 || follower < 0)
            break
          storage.failOutcomeWrites = 1
          const rejectedWrite = await doWrite(follower, `write-rejected`)
          const next = await doWrite(follower, `write`)
          // The later write waits its turn behind the rejected one, which
          // retries its cleanup; the history's end checks that both settle.
          if (!rejectedWrite || !next || !calls.includes(rejectedWrite.id)) {
            storage.failOutcomeWrites = 0
            break
          }
          rejectedWrite.recordRetried = true
          break
        }
        case `remove-unsent`: {
          // The leader removes a follower's saved write before sending it.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (!durable || leader < 0 || follower < 0) break
          online.set(false)
          const write = await doWrite(follower, `write`)
          if (!write) break
          await tabs[leader]!.env.executor.removeFromOutbox(
            write.transactionId!,
          )
          write.removed = true
          write.deliverable = false
          channels.inject({ type: `leader` })
          await settle()
          if (write.outcome === `failed`) reach(`removed-unsent-failed`)
          break
        }
        case `ack-after-handover`: {
          // A follower's row lands but its save acknowledges only after
          // another leader sent and removed it and the writer then leads.
          const leader = leaderIndex()
          const writer = tabs.findIndex((tab, index) => tab && index !== leader)
          if (
            !durable ||
            !online.online ||
            leader < 0 ||
            writer < 0 ||
            tabs.filter(Boolean).length < 3
          )
            break
          storage.holdNextAck()
          const write = await doWrite(writer, `write`)
          if (!write) {
            storage.releaseAck()
            break
          }
          await rotateTo(tabs[writer]!.election)
          expect(calls, `${write.id} sent by another leader`).toContain(
            write.id,
          )
          storage.releaseAck()
          await settle()
          reach(`save-acknowledged-after-handover`)
          break
        }
        case `open-failing`: {
          // A tab whose start fails leaves no channel open and no claim on
          // leadership, without being disposed.
          const index = tabs.findIndex((tab) => !tab)
          if (!durable || index < 0) break
          const before = channels.openCount()
          await openTab(index, undefined, undefined, true)
          const failed = tabs[index]!
          expect(channels.openCount(), `a failed start keeps no channel`).toBe(
            before,
          )
          expect(
            election.holder !== failed.election &&
              !election.queue.includes(failed.election),
            `a failed start keeps no leadership claim`,
          ).toBe(true)
          reach(`failed-start-released`)
          tabs[index] = undefined
          failed.env.executor.dispose()
          await settle()
          break
        }
        case `dispose-during-save`: {
          // A follower closes while its save runs; the save still reaches
          // the current leader, which sends it.
          const leader = leaderIndex()
          const follower = tabs.findIndex(
            (tab, index) => tab && index !== leader,
          )
          if (!durable || !online.online || leader < 0 || follower < 0) break
          storage.holdWrites()
          const write = await doWrite(follower, `write`)
          if (!write) break
          await closeTab(follower)
          storage.releaseWrites(false)
          await settle()
          expect(calls, `${write.id} sent after its tab closed`).toContain(
            write.id,
          )
          reach(`save-announced-after-dispose`)
          break
        }
        case `fail-outbox-check`: {
          const sessionsOpen = openSessions()
          const pending = writes.filter(
            (write) =>
              write.outcome === undefined &&
              write.deliverable &&
              !write.preInit &&
              sessionsOpen.has(write.session),
          )
          if (!durable || pending.length === 0) break
          // The read that fails is this writer's check of its own row.
          const target =
            pending.find(
              (write) =>
                write.transactionId &&
                channels.state.lostIds.includes(write.transactionId),
            ) ?? pending[0]!
          if (channels.state.lostIds.includes(target.transactionId!))
            target.checkFailed = true
          reach(`outbox-check-read-failed`)
          storage.failReadKey = `tx:${target.transactionId}`
          expectedWarnings.check += 1
          channels.inject({ type: `leader` })
          await settle()
          break
        }
      }
      check(`step ${step} ${action.type}`)
    }

    // End online with a leader. A lost settlement is recovered for its own
    // write: by the writer itself if it became leader, or else after one
    // handover to another tab.
    channels.state.loseSettlement = false
    online.set(true)
    await settle()
    // The writer whose check failed settles on connectivity, before any
    // handover.
    for (const write of writes) {
      if (!write.checkFailed || !openSessions().has(write.session)) continue
      expect(
        write.outcome,
        `${write.id} settled after its failed check`,
      ).not.toBe(undefined)
      reach(`reconcile-retried`)
    }
    const lostWrites = writes.filter(
      (write) =>
        write.transactionId !== undefined &&
        channels.state.lostIds.includes(write.transactionId),
    )
    if (lostWrites.length > 0) {
      reach(`lost-settlement-recovered`)
      const holder = leaderIndex()
      const leaderSession = tabs[holder]?.session
      for (const write of lostWrites) {
        if (write.session === leaderSession) {
          expect(write.outcome, `${write.id} recovered by its leader`).not.toBe(
            undefined,
          )
        }
      }
      const stranded = lostWrites.filter(
        (write) =>
          write.session !== leaderSession &&
          openSessions().has(write.session) &&
          write.outcome === undefined,
      )
      if (stranded.length > 0 && holder >= 0) {
        await closeTab(holder)
        const nextLeader = tabs[leaderIndex()]?.session
        if (
          stranded.some(
            (write) =>
              write.session !== nextLeader && write.outcome !== undefined,
          )
        ) {
          reach(`lost-settlement-recovered-by-follower`)
        }
      }
      if (
        lostWrites.some(
          (write) =>
            write.rejected &&
            openSessions().has(write.session) &&
            write.outcome === `failed`,
        )
      ) {
        reach(`lost-rejection-recovered`)
      }
    }
    if (tabs.every((tab) => !tab)) await openTab(0)
    if (leaderIndex() < 0) await openTab(tabs.findIndex((tab) => !tab))
    online.set(true)
    for (let round = 0; round < 8; round++) await settle()

    const sessionsOpen = openSessions()
    if (
      writes.some(
        (write) =>
          durable &&
          write.rejected &&
          write.deliverable &&
          write.outcome === undefined,
      )
    )
      reach(`orphan-rejection-kept`)
    for (const write of writes) {
      if (!durable || !write.fromFollower) continue
      if (!write.rejected) reach(`follower-write-delivered`)
      else if (sessionsOpen.has(write.session)) {
        reach(`follower-write-rejected`)
      }
    }
    if (writes.some((write) => write.retried && calls.includes(write.id)))
      reach(`admission-retried`)
    for (const send of sends) {
      const write = writes.find((candidate) => candidate.id === send.id)!
      if (write.preInit || (!durable && write.fromFollower)) {
        // The online path: the writing tab calls the server itself.
        expect(send.sender, `${send.id} sent by its own tab`).toBe(
          write.session,
        )
      } else {
        // A durable write is sent only by the tab that leads at that moment.
        expect(send.sender, `${send.id} sent by the leader`).toBe(send.leader)
      }
    }
    expect([...calls].sort(), `each write reached the server once`).toEqual(
      writes
        .filter((write) => write.deliverable)
        .map((write) => write.id)
        .sort(),
    )
    const executor = tabs[leaderIndex()]!.env.executor
    expect(await executor.peekOutbox(), `the outbox is empty`).toEqual([])
    // A rejection record stays only for a rejected durable write whose tab
    // closed before it settled; a completed write leaves no record.
    const outcomes = (await storage.keys())
      .filter((key) => key.startsWith(`outcome:`))
      .map((key) => key.slice(`outcome:`.length))
      .sort()
    expect(outcomes, `outcome records`).toEqual(
      writes
        .filter(
          (write) =>
            durable &&
            !write.preInit &&
            (write.excluded ||
              write.removed ||
              (write.deliverable && write.rejected)) &&
            write.outcome === undefined,
        )
        .map((write) => write.transactionId)
        .sort(),
    )
    for (const write of writes) {
      if (!sessionsOpen.has(write.session)) continue
      expect(write.outcome, `${write.id} outcome`).toBe(
        write.rejected || !write.deliverable ? `failed` : `completed`,
      )
      if (write.removed) {
        expect((write.error as Error).message, `${write.id} removal`).toBe(
          `Transaction removed from the outbox`,
        )
      }
      if (write.recordRetried && write.outcome === `failed`)
        reach(`outcome-record-retried`)
      if (write.excluded) {
        const error = write.error as Error
        expect(error, `${write.id} exclusion error`).toBeInstanceOf(
          NonRetriableError,
        )
        expect(error.message, `${write.id} exclusion message`).toBe(
          `Transaction excluded by beforeRetry`,
        )
      }
      if (write.rejected && write.deliverable) {
        const error = write.error as Error
        expect(error, `${write.id} error type`).toBeInstanceOf(
          NonRetriableError,
        )
        expect(error.name, `${write.id} error name`).toBe(`NonRetriableError`)
        expect(error.message, `${write.id} error message`).toBe(
          `rejected ${write.id}`,
        )
      }
    }
  } finally {
    for (const tab of tabs) tab?.env.executor.dispose()
    warn.mockRestore()
    consoleError.mockRestore()
    vi.unstubAllGlobals()
  }
}

const write = (tab: number): Action => ({ type: `write`, tab })
const close = (tab: number): Action => ({ type: `close`, tab })
const offline: Action = { type: `offline` }
const loseSettlement: Action = { type: `lose-settlement` }

oracleProperty({
  id: property,
  law: {
    statement: `With followerWrites 'durable', a write from an initialized tab stays pending until the leading tab sends it to the server exactly once while online, whether or not its tab stayed open, and its open tab's transaction settles with the server's outcome, also when the settlement message is lost. A leader that could not read a saved write sends it once connectivity changes, a row it cannot decode is reported, a failed row removal after a successful send is not reported as the outcome, and a follower's failed outbox check runs again on connectivity. An admission read across a change of leadership schedules nothing, and a write excluded by beforeRetry fails its writer even when the message is lost. Stale and duplicate messages change nothing. A write made before its tab initializes, and the default mode, keep the online path.`,
    authority: `Issue #2464 and the followerWrites option in docs/guides/offline-transactions.md.`,
    limits: `Three tabs over one storage adapter with controlled election, connectivity and BroadcastChannel; up to twelve actions; no real browser contexts; rejection records of writers that never return are kept, and none is ever expired.`,
  },
  owns: [
    `src/OfflineExecutor.ts`,
    `src/OfflineExecutor.ts#OfflineExecutor.handleOutboxMessage`,
    `src/OfflineExecutor.ts#OfflineExecutor.settleRemovedWrites`,
    `src/OfflineExecutor.ts#OfflineExecutor.openOutboxChannel`,
    `src/OfflineExecutor.ts#OfflineExecutor.announceSettled`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.admitTransaction`,
    `src/OfflineExecutor.ts#OfflineExecutor.admitFollowerWrite`,
    `src/OfflineExecutor.ts#OfflineExecutor.retryAdmissions`,
    `src/OfflineExecutor.ts#OfflineExecutor.settleFollowerWrite`,
    `src/OfflineExecutor.ts#OfflineExecutor.writesToSharedOutbox`,
    `src/outbox/OutboxManager.ts#OutboxManager.getCurrent`,
    `src/outbox/OutboxManager.ts#OutboxManager.recordRejection`,
    `src/outbox/OutboxManager.ts#OutboxManager.getOutcome`,
    `src/outbox/OutboxManager.ts#OutboxManager.removeOutcome`,
  ],
  histories: {
    arbitrary: historyArbitrary,
    runs: 30,
    fixedSeeds: [2464],
    states: reachStates,
    constructed: [
      {
        name: `a follower's online write goes through the leader`,
        enters: [`follower-write-delivered`],
        build: (generated: History): History => spliced(generated, [write(1)]),
      },
      {
        name: `a follower writes offline and closes`,
        enters: [`write-outlived-its-tab`, `follower-write-delivered`],
        build: (generated: History): History =>
          spliced(generated, [offline, write(1), close(1)]),
      },
      {
        name: `the leader closes holding a follower's write`,
        enters: [`leader-closed-with-follower-write`],
        build: (generated: History): History =>
          spliced(generated, [offline, write(1), close(0)]),
      },
      {
        name: `the server rejects a follower's write`,
        enters: [`follower-write-rejected`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `write-rejected`, tab: 2 }],
            `durable`,
            true,
          ),
      },
      {
        name: `a lost settlement is recovered at handover`,
        enters: [`lost-settlement-recovered`, `follower-write-delivered`],
        build: (generated: History): History =>
          spliced(generated, [loseSettlement, write(1)], `durable`, true),
      },
      {
        name: `a tab that stays a follower recovers a lost settlement`,
        enters: [`lost-settlement-recovered-by-follower`],
        build: (generated: History): History =>
          spliced(generated, [loseSettlement, write(2)], `durable`, true),
      },
      {
        name: `the default mode keeps the online follower path`,
        enters: [`online-mode-follower-write-failed`],
        build: (generated: History): History =>
          spliced(generated, [offline, write(1)], `online`),
      },
      {
        name: `stale and duplicate messages change nothing`,
        enters: [`stale-message-ignored`, `duplicate-message-ignored`],
        build: (generated: History): History =>
          spliced(generated, [
            { type: `stale-added` },
            offline,
            write(1),
            { type: `duplicate-added` },
          ]),
      },
      {
        name: `a leader message arrives during a save`,
        enters: [`leader-message-during-save`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `write-during-leader-message`, tab: 1 }]),
      },
      {
        name: `a follower's save fails`,
        enters: [`follower-save-failed`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `write-save-fails`, tab: 1 }]),
      },
      {
        name: `a leader writes in the default mode`,
        enters: [`online-mode-leader-write-delivered`],
        build: (generated: History): History =>
          spliced(generated, [write(0)], `online`, true),
      },
      {
        name: `failed storage reads are reported`,
        enters: [`admission-read-failed`, `outbox-check-read-failed`],
        build: (generated: History): History =>
          spliced(generated, [
            { type: `fail-admission-read` },
            offline,
            write(1),
            { type: `fail-outbox-check` },
          ]),
      },
      {
        name: `a leader retries a saved write it could not read`,
        enters: [`admission-read-failed`, `admission-retried`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `fail-admission-read` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a lost rejection still fails its writer`,
        enters: [`lost-settlement-recovered`, `lost-rejection-recovered`],
        build: (generated: History): History =>
          spliced(
            generated,
            [loseSettlement, { type: `write-rejected`, tab: 2 }],
            `durable`,
            true,
          ),
      },
      {
        name: `a stale admission read does not send a write again`,
        enters: [`stale-admission-ignored`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `stale-admission-read` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a failed outbox check runs again on connectivity`,
        enters: [`outbox-check-read-failed`, `reconcile-retried`],
        build: (generated: History): History =>
          spliced(
            generated,
            [loseSettlement, write(2), { type: `fail-outbox-check` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a cleanup fault is not a follower's outcome`,
        enters: [`removal-failure-not-announced`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `fail-removal` }], `durable`, true),
      },
      {
        name: `an unreadable saved row is reported`,
        enters: [`unreadable-write-reported`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `unreadable-added` }]),
      },
      {
        name: `an admission read across a change of leadership is dropped`,
        enters: [`stale-admission-across-terms`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `stale-admission-across-terms` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a rejection whose writer closed keeps its record`,
        enters: [`orphan-rejection-kept`],
        build: (generated: History): History =>
          spliced(
            generated,
            [offline, { type: `write-rejected`, tab: 1 }, close(1)],
            `durable`,
            true,
          ),
      },
      {
        name: `an exclusion in the default mode keeps no record`,
        enters: [],
        build: (generated: History): History =>
          spliced(generated, [{ type: `exclude-on-handover` }], `online`, true),
      },
      {
        name: `a lost exclusion still fails its writer`,
        enters: [`exclusion-recovered`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `exclude-on-handover` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a failed rejection record is retried beside other writes`,
        enters: [`outcome-record-retried`],
        build: (generated: History): History =>
          spliced(
            generated,
            [{ type: `fail-outcome-record` }],
            `durable`,
            true,
          ),
      },
      {
        name: `a late admission during an exclusion sends nothing`,
        enters: [`excluded-admission-ignored`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `exclude-on-handover` }]),
      },
      {
        name: `a write removed before it was sent fails its writer`,
        enters: [`removed-unsent-failed`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `remove-unsent` }]),
      },
      {
        name: `a save acknowledged after a handover is admitted by id`,
        enters: [`save-acknowledged-after-handover`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `ack-after-handover` }]),
      },
      {
        name: `a faulted former leader saves for its successor`,
        enters: [`faulted-former-leader-saved`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `fail-removal` }]),
      },
      {
        name: `a failed start releases its channel and leadership`,
        enters: [`failed-start-released`],
        build: (generated: History): History =>
          spliced(generated, [close(2), { type: `open-failing` }]),
      },
      {
        name: `a save that ends after its tab closed reaches the leader`,
        enters: [`save-announced-after-dispose`],
        build: (generated: History): History =>
          spliced(generated, [{ type: `dispose-during-save` }]),
      },
      {
        name: `a former leader drops queued writes another leader sent`,
        enters: [`stale-admission-across-terms`],
        build: (generated: History): History =>
          spliced(generated, [
            { type: `fail-outcome-record` },
            { type: `stale-admission-across-terms` },
          ]),
      },
      {
        name: `a write before initialization takes the online path`,
        enters: [`pre-initialization-write`],
        build: (generated: History): History =>
          spliced(generated, [
            close(1),
            { type: `open-and-write`, tab: 1 },
            offline,
            close(2),
            { type: `open-and-write`, tab: 2 },
          ]),
      },
    ],
  },
  resolve: (history: History) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan: { history: History }, observe) =>
    recordAssertionJudgment(property, plan, observe, () =>
      runHistory(plan.history, (state) => observe(`reach`, state)),
    ),
  check: forwardAssertionJudgment,
})
