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
 * and every other write completes. When a settlement message is lost, the next
 * leader's outbox check settles the waiter. Stale and duplicate channel
 * messages change nothing. In online mode, a follower's write made offline
 * fails and is never sent.
 *
 * History grammar: a mode and up to twelve actions over three tabs: write, a
 * write the server rejects, a write whose save is held or fails while a leader
 * message arrives, close a tab, reopen a tab, go online or offline,
 * lose the next successful settlement, deliver a stale or duplicate message,
 * and fail the storage read of an admission or an outbox check.
 *
 * Production driver: real executors over one shared storage adapter, with a
 * controlled leader election, online detector and BroadcastChannel.
 *
 * Refinement check: after every action, pending writes stay pending and shown
 * by the leader, open channels match open tabs, and warnings match the injected
 * failures. After the history ends online with a leader, each deliverable write
 * reached the server exactly once, the outbox is empty, and each open tab's
 * transaction has the model's outcome and error.
 *
 * Known omissions: writes made before a tab initializes use the online path; a
 * reloaded follower does not show another tab's pending writes optimistically;
 * a settlement lost for a permanently rejected write would report success; and
 * no real browser contexts.
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
] as const
type ReachState = (typeof reachStates)[number]

type TabActionType =
  | `write`
  | `write-rejected`
  | `write-during-leader-message`
  | `write-save-fails`
  | `close`
  | `open`
type SharedActionType =
  | `online`
  | `offline`
  | `lose-settlement`
  | `stale-added`
  | `duplicate-added`
  | `fail-admission-read`
  | `fail-outbox-check`
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
  { weight: 2, arbitrary: sharedAction(`offline`) },
  { weight: 2, arbitrary: sharedAction(`online`) },
  { weight: 1, arbitrary: sharedAction(`lose-settlement`) },
  { weight: 1, arbitrary: sharedAction(`stale-added`) },
  { weight: 1, arbitrary: sharedAction(`duplicate-added`) },
  { weight: 1, arbitrary: sharedAction(`fail-admission-read`) },
  { weight: 1, arbitrary: sharedAction(`fail-outbox-check`) },
)
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  mode: fc.constantFrom<Mode>(`durable`, `durable`, `durable`, `online`),
  actions: fc.array(actionArbitrary, { maxLength: MAX_ACTIONS }),
})
const spliced = (
  generated: History,
  prefix: Array<Action>,
  mode: Mode = `durable`,
): History => ({
  mode,
  actions: [
    ...prefix,
    ...generated.actions
      .filter(
        (action) =>
          action.type !== `lose-settlement` &&
          action.type !== `fail-admission-read` &&
          action.type !== `fail-outbox-check`,
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
  constructor(private readonly shared: ControlledElection) {}

  requestLeadership(): Promise<boolean> {
    if (!this.shared.holder) {
      this.shared.holder = this
      this.leader = true
    } else if (
      this.shared.holder !== this &&
      !this.shared.queue.includes(this)
    ) {
      this.shared.queue.push(this)
    }
    return Promise.resolve(this.leader)
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
  private heldWrites: Array<(fail: boolean) => void> | null = null

  holdWrites(): void {
    this.heldWrites = []
  }
  releaseWrites(fail: boolean): void {
    const held = this.heldWrites ?? []
    this.heldWrites = null
    for (const release of held) release(fail)
  }
  override async set(key: string, value: string): Promise<void> {
    if (this.heldWrites) {
      const held = this.heldWrites
      const fail = await new Promise<boolean>((resolve) => held.push(resolve))
      if (fail) throw new Error(`storage write failed`)
    }
    return super.set(key, value)
  }
  override async get(key: string): Promise<string | null> {
    if (this.failReads > 0) {
      this.failReads -= 1
      throw new Error(`storage read failed`)
    }
    return super.get(key)
  }
}

type ChannelMessage = { type: string; id?: string; error?: unknown }

function controlledChannels() {
  const open = new Set<ControlledChannel>()
  const state = { loseSettlement: false, lost: 0, created: 0 }
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
      if (state.loseSettlement && data.type === `settled` && !data.error) {
        state.loseSettlement = false
        state.lost += 1
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
  const rejected = new Set<string>()
  const expectedWarnings = { admission: 0, check: 0 }
  type Tab = {
    env: ReturnType<typeof createTestOfflineEnvironment>
    election: TabElection
    session: number
  }
  const tabs: Array<Tab | undefined> = Array.from({ length: TABS })
  let sessions = 0

  const openTab = async (index: number) => {
    const tabElection = new TabElection(election)
    const env = createTestOfflineEnvironment({
      storage,
      mutationFn: (params: OfflineMutationFnParams) => {
        const id = String(params.transaction.mutations[0].key)
        // The server is unreachable while offline, whichever path sends it.
        if (!online.online) throw new Error(`offline`)
        calls.push(id)
        if (rejected.has(id)) throw new NonRetriableError(`rejected ${id}`)
        return { ok: true }
      },
      config: {
        ...(durable ? { followerWrites: `durable` } : {}),
        leaderElection: tabElection,
        onlineDetector: online.detector(),
        jitter: false,
      } as never,
    })
    tabs[index] = { env, election: tabElection, session: ++sessions }
    await env.executor.waitForInit()
    await settle()
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
      if (leader) {
        expect(
          leader.env.collection.has(write.id),
          `${label}: leader shows ${write.id}`,
        ).toBe(true)
      }
    }
  }

  try {
    for (let index = 0; index < TABS; index++) await openTab(index)
    expect(channels.state.created, `channels created`).toBe(durable ? TABS : 0)

    for (const [step, action] of history.actions.entries()) {
      switch (action.type) {
        case `write`:
        case `write-rejected`:
        case `write-during-leader-message`:
        case `write-save-fails`: {
          const tab = tabs[action.tab]
          if (!tab) break
          const fromFollower = leaderIndex() !== action.tab
          const id = `write-${writes.length}`
          const write: Write = {
            id,
            tab: action.tab,
            rejected: action.type === `write-rejected`,
            deliverable: durable || !fromFollower || online.online,
            fromFollower,
            session: tab.session,
          }
          writes.push(write)
          if (write.rejected) rejected.add(id)
          const saveFails = durable && action.type === `write-save-fails`
          const heldSave =
            saveFails ||
            (durable && action.type === `write-during-leader-message`)
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
          break
        }
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
        case `online`:
          online.set(true)
          await settle()
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
        case `fail-admission-read`:
          if (!durable || !tabs.some(Boolean)) break
          reach(`admission-read-failed`)
          storage.failReads = 1
          expectedWarnings.admission += 1
          channels.inject({ type: `added`, id: `not-in-outbox` })
          await settle()
          break
        case `fail-outbox-check`: {
          const sessionsOpen = openSessions()
          const waiting = writes.some(
            (write) => isUnsent(write) && sessionsOpen.has(write.session),
          )
          if (!durable || !waiting) break
          reach(`outbox-check-read-failed`)
          storage.failReads = 1
          expectedWarnings.check += 1
          channels.inject({ type: `leader` })
          await settle()
          break
        }
      }
      check(`step ${step} ${action.type}`)
    }

    // End online with a leader, handing over once if a settlement was lost.
    channels.state.loseSettlement = false
    online.set(true)
    await settle()
    if (channels.state.lost > 0) {
      const holder = leaderIndex()
      const stranded = writes.some(
        (write) =>
          write.session !== tabs[holder]?.session &&
          openSessions().has(write.session) &&
          write.outcome === undefined,
      )
      if (holder >= 0) await closeTab(holder)
      reach(`lost-settlement-recovered`)
      const nextLeader = tabs[leaderIndex()]?.session
      if (
        stranded &&
        writes.some(
          (write) =>
            write.session !== nextLeader &&
            openSessions().has(write.session) &&
            write.outcome !== undefined,
        )
      ) {
        reach(`lost-settlement-recovered-by-follower`)
      }
    }
    if (tabs.every((tab) => !tab)) await openTab(0)
    if (leaderIndex() < 0) await openTab(tabs.findIndex((tab) => !tab))
    online.set(true)
    for (let round = 0; round < 8; round++) await settle()

    const sessionsOpen = openSessions()
    for (const write of writes) {
      if (!durable || !write.fromFollower) continue
      if (!write.rejected) reach(`follower-write-delivered`)
      else if (sessionsOpen.has(write.session)) {
        reach(`follower-write-rejected`)
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
    for (const write of writes) {
      if (!sessionsOpen.has(write.session)) continue
      expect(write.outcome, `${write.id} outcome`).toBe(
        write.rejected || !write.deliverable ? `failed` : `completed`,
      )
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
    statement: `With followerWrites 'durable', a write from an initialized tab stays pending until it reaches the server exactly once after some tab leads while online, whether or not its tab stayed open, and its open tab's transaction settles with the server's outcome. Stale and duplicate messages change nothing. The default mode keeps the online path with no channel.`,
    authority: `Issue #2464 and the followerWrites option in docs/guides/offline-transactions.md.`,
    limits: `Three tabs over one storage adapter with controlled election, connectivity and BroadcastChannel; up to twelve actions; no real browser contexts, and a lost settlement of a rejected write is not modeled.`,
  },
  owns: [
    `src/OfflineExecutor.ts#OfflineExecutor.handleOutboxMessage`,
    `src/OfflineExecutor.ts#OfflineExecutor.settleRemovedWrites`,
    `src/OfflineExecutor.ts#OfflineExecutor.openOutboxChannel`,
    `src/OfflineExecutor.ts#OfflineExecutor.announceSettled`,
    `src/executor/TransactionExecutor.ts#TransactionExecutor.admitTransaction`,
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
        build: (): History => ({
          mode: `durable`,
          actions: [{ type: `write-rejected`, tab: 2 }],
        }),
      },
      {
        name: `a lost settlement is recovered at handover`,
        enters: [`lost-settlement-recovered`, `follower-write-delivered`],
        build: (): History => ({
          mode: `durable`,
          actions: [loseSettlement, write(1)],
        }),
      },
      {
        name: `a tab that stays a follower recovers a lost settlement`,
        enters: [`lost-settlement-recovered-by-follower`],
        build: (): History => ({
          mode: `durable`,
          actions: [loseSettlement, write(2)],
        }),
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
        build: (): History => ({ mode: `online`, actions: [write(0)] }),
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
