/**
 * # Does a waiting tab take over when the Web Locks leader goes away?
 *
 * Law and source: one tab leads outbox processing, and "a follower can become
 * the leader after the current leader leaves" (docs/guides/offline-transactions.md,
 * issue #2463). The Web Locks API grants an exclusive lock to pending requests
 * in request order and releases it when its holder's context ends. An abort
 * has no effect on a request that has already been granted.
 *
 * Model: a FIFO of waiting tabs and one holder. A tab that finds the lock free
 * leads at once without a change notification, since its request reports it. A
 * tab that finds it held reports false and waits. When the holder releases or
 * closes, the first waiter leads and is notified. A waiter that releases leaves
 * the queue and never leads, even when the lock was already granted to it. A
 * failed lock request reports false, warns once, and leaves the tab idle.
 *
 * History grammar: up to fourteen actions over three tabs: request, two
 * requests in one turn, a request released in the same turn, a failed first or
 * queued lock request, release, close, and a close whose next waiter releases
 * before its grant runs. A closed tab takes no further actions. An environment
 * can lack `navigator` or `navigator.locks`.
 *
 * Production driver: real `WebLocksLeader` instances over a controlled lock
 * manager that follows the spec's request order, `ifAvailable` and `signal`
 * rules, and models a closing context by dropping its held and pending locks.
 *
 * Refinement check: after every action, each request result, leader flag,
 * change notification, lock holder, queue and warning count equals the model.
 *
 * Known omissions: one lock name, no steal or shared mode, and no real browser
 * contexts.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import fc from 'fast-check'
import { expect, vi } from 'vitest'
import { WebLocksLeader } from '../src/coordination/WebLocksLeader'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'

const property = `offline.web-locks-leader`
const TABS = 3
const MAX_ACTIONS = 14

const reachStates = [
  // A waiting tab led after the leader released.
  `takeover-after-release`,
  // A waiting tab led after the leader's context closed.
  `takeover-after-close`,
  // A waiting tab left the queue before it could lead.
  `waiter-released`,
  // A waiting tab asked again and kept one place in the queue.
  `repeated-request-while-waiting`,
  // Two requests in one turn shared one acquisition.
  `concurrent-requests`,
  // A request was released before its first lock callback ran.
  `released-while-requesting`,
  // The first lock request failed.
  `first-request-failed`,
  // The queued lock request failed.
  `queued-request-failed`,
  // A waiter released after its grant, before the grant's callback ran.
  `released-after-grant`,
  // The environment has no usable Web Locks API.
  `unsupported-environment`,
] as const
type ReachState = (typeof reachStates)[number]

type ActionType =
  | `request`
  | `request-twice`
  | `request-then-release`
  | `fail-first`
  | `fail-queued`
  | `release`
  | `close`
  | `close-then-release-next`
type Action = { type: ActionType; tab: number }
type Environment = `locks` | `no-locks` | `no-navigator`
type History = { environment: Environment; actions: Array<Action> }
type TabState = `idle` | `waiting` | `leader` | `closed`

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

class LeadershipModel {
  readonly tabs: Array<TabState> = Array.from(
    { length: TABS },
    () => `idle` as const,
  )
  readonly queue: Array<number> = []
  readonly notifications: Array<Array<boolean>> = Array.from(
    { length: TABS },
    () => [],
  )
  warnings = 0

  get holder(): number | undefined {
    const index = this.tabs.indexOf(`leader`)
    return index < 0 ? undefined : index
  }

  private promoteNext(): number | undefined {
    const next = this.queue.shift()
    if (next === undefined) return undefined
    this.tabs[next] = `leader`
    this.notifications[next]!.push(true)
    return next
  }

  request(tab: number): boolean {
    const state = this.tabs[tab]!
    if (state === `leader`) return true
    if (state === `waiting`) return false
    if (this.holder === undefined) {
      this.tabs[tab] = `leader`
      return true
    }
    this.tabs[tab] = `waiting`
    this.queue.push(tab)
    return false
  }

  /** Returns the tab that took over, if any. */
  release(tab: number): number | undefined {
    const state = this.tabs[tab]!
    if (state === `waiting`) {
      this.queue.splice(this.queue.indexOf(tab), 1)
      this.tabs[tab] = `idle`
      return undefined
    }
    if (state !== `leader`) return undefined
    this.tabs[tab] = `idle`
    this.notifications[tab]!.push(false)
    return this.promoteNext()
  }

  /** Returns the tab that took over, if any. */
  close(tab: number): number | undefined {
    const state = this.tabs[tab]!
    if (state === `waiting`) this.queue.splice(this.queue.indexOf(tab), 1)
    this.tabs[tab] = `closed`
    return state === `leader` ? this.promoteNext() : undefined
  }

  /** The leader closes and its next waiter releases before leading. */
  closeThenReleaseNext(tab: number): number {
    const next = this.queue.shift()!
    this.tabs[tab] = `closed`
    this.tabs[next] = `idle`
    this.promoteNext()
    return next
  }
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const actionArbitrary: fc.Arbitrary<Action> = fc.record({
  type: fc.constantFrom<ActionType>(
    `request`,
    `request`,
    `request`,
    `request-twice`,
    `request-then-release`,
    `fail-first`,
    `fail-queued`,
    `release`,
    `release`,
    `close`,
    `close-then-release-next`,
  ),
  tab: fc.nat({ max: TABS - 1 }),
})
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  environment: fc.constantFrom<Environment>(
    `locks`,
    `locks`,
    `locks`,
    `locks`,
    `locks`,
    `no-locks`,
    `no-navigator`,
  ),
  actions: fc.array(actionArbitrary, { minLength: 1, maxLength: MAX_ACTIONS }),
})

const spliced = (generated: History, prefix: Array<Action>): History => ({
  environment: `locks`,
  actions: [
    ...prefix,
    ...generated.actions.slice(0, MAX_ACTIONS - prefix.length),
  ],
})
const act = (type: ActionType, tab: number): Action => ({ type, tab })
const contested = [act(`request`, 0), act(`request`, 1)]

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

type LockRequest = {
  tab: number
  callback: (lock: { name: string; mode: string } | null) => unknown
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

// The tab whose code is running, across its awaits and lock callbacks.
const tabContext = new AsyncLocalStorage<number>()

/** Exclusive locks in request order, per the Web Locks API. */
class ControlledLocks {
  held: LockRequest | undefined
  readonly pending: Array<LockRequest> = []
  failFirst = false
  failQueued = false

  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: LockRequest[`callback`],
  ): Promise<unknown> {
    const tab = tabContext.getStore() ?? -1
    return new Promise((resolve, reject) => {
      if (
        (options.ifAvailable && this.failFirst) ||
        (!options.ifAvailable && this.failQueued)
      ) {
        this.failFirst = false
        this.failQueued = false
        reject(new DOMException(`Denied`, `SecurityError`))
        return
      }
      if (options.signal?.aborted) {
        reject(new DOMException(`Aborted`, `AbortError`))
        return
      }
      const request: LockRequest = {
        tab,
        callback,
        resolve,
        reject,
        signal: options.signal,
      }
      if (options.ifAvailable && (this.held || this.pending.length > 0)) {
        queueMicrotask(() => {
          resolve(tabContext.run(tab, () => callback(null)))
        })
        return
      }
      if (options.signal) {
        request.onAbort = () => {
          const index = this.pending.indexOf(request)
          if (index < 0) return
          this.pending.splice(index, 1)
          reject(new DOMException(`Aborted`, `AbortError`))
        }
        options.signal.addEventListener(`abort`, request.onAbort, {
          once: true,
        })
      }
      this.pending.push(request)
      queueMicrotask(() => this.pump(name))
    })
  }

  // A grant is decided now and its callback runs later, so an abort in
  // between has no effect.
  private pump(name: string): void {
    if (this.held) return
    const request = this.pending.shift()
    if (!request) return
    if (request.onAbort) {
      request.signal?.removeEventListener(`abort`, request.onAbort)
    }
    this.held = request
    queueMicrotask(() => {
      if (this.held !== request) return
      const result = tabContext.run(request.tab, () =>
        request.callback({ name, mode: `exclusive` }),
      )
      void Promise.resolve(result).then(
        (value) => {
          if (this.held !== request) return
          this.held = undefined
          request.resolve(value)
          this.pump(name)
        },
        (error: unknown) => {
          if (this.held !== request) return
          this.held = undefined
          request.reject(error)
          this.pump(name)
        },
      )
    })
  }

  /** A closing context loses its locks, and its callbacks never run again. */
  close(tab: number, name: string): void {
    for (let index = this.pending.length - 1; index >= 0; index--) {
      if (this.pending[index]!.tab === tab) this.pending.splice(index, 1)
    }
    if (this.held?.tab === tab) {
      this.held = undefined
      this.pump(name)
    }
  }
}

const LOCK = `oracle-leader`
const settle = async () => {
  for (let turn = 0; turn < 4; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// A request that never settles is a wrong answer rather than a stalled test.
const observed = (result: Promise<boolean>) => {
  const outcome: { value?: boolean } = {}
  void result.then((value) => {
    outcome.value = value
  })
  return outcome
}

async function runUnsupported(
  history: History,
  reach: (state: ReachState) => void,
): Promise<void> {
  reach(`unsupported-environment`)
  vi.stubGlobal(
    `navigator`,
    history.environment === `no-locks` ? {} : undefined,
  )
  const leader = new WebLocksLeader(LOCK)
  expect(WebLocksLeader.isSupported(), `isSupported`).toBe(false)
  for (const [step, action] of history.actions.entries()) {
    if (action.type !== `release`) {
      const result = await leader.requestLeadership().catch(() => `threw`)
      expect(result, `step ${step}: result`).toBe(false)
    } else {
      expect(
        () => leader.releaseLeadership(),
        `step ${step}: release`,
      ).not.toThrow()
    }
    expect(leader.isLeader(), `step ${step}: leader`).toBe(false)
    expect(console.warn, `step ${step}: warnings`).not.toHaveBeenCalled()
  }
}

async function runHistory(
  history: History,
  reach: (state: ReachState) => void,
): Promise<void> {
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  try {
    if (history.environment !== `locks`) {
      await runUnsupported(history, reach)
      return
    }
    const locks = new ControlledLocks()
    vi.stubGlobal(`navigator`, { locks })
    expect(WebLocksLeader.isSupported(), `isSupported`).toBe(true)
    const model = new LeadershipModel()
    const leaders = Array.from({ length: TABS }, () => new WebLocksLeader(LOCK))
    const notifications: Array<Array<boolean>> = leaders.map(() => [])
    leaders.forEach((leader, tab) => {
      leader.onLeadershipChange((isLeader) => {
        notifications[tab]!.push(isLeader)
      })
    })
    const inTab = <T>(tab: number, run: () => T) => tabContext.run(tab, run)

    const check = (label: string) => {
      leaders.forEach((leader, tab) => {
        if (model.tabs[tab] === `closed`) return
        expect(leader.isLeader(), `${label}: tab ${tab} leader`).toBe(
          model.tabs[tab] === `leader`,
        )
      })
      expect(notifications, `${label}: notifications`).toEqual(
        model.notifications,
      )
      expect(locks.held?.tab, `${label}: holder`).toBe(model.holder)
      expect(
        locks.pending.map((request) => request.tab),
        `${label}: queue`,
      ).toEqual(model.queue)
      expect(warn, `${label}: warnings`).toHaveBeenCalledTimes(model.warnings)
    }

    for (const [step, action] of history.actions.entries()) {
      const { type, tab } = action
      const label = `step ${step} ${type} tab ${tab}`
      const state = model.tabs[tab]!
      if (state === `closed`) continue
      const leader = leaders[tab]!
      const request = () =>
        observed(inTab(tab, () => leader.requestLeadership()))

      if (type === `request`) {
        if (state === `waiting`) reach(`repeated-request-while-waiting`)
        const expected = model.request(tab)
        const outcome = request()
        await settle()
        expect(outcome.value, `${label}: result`).toBe(expected)
      } else if (type === `request-twice`) {
        if (state === `idle`) reach(`concurrent-requests`)
        const expected = model.request(tab)
        const outcomes = [request(), request()]
        await settle()
        expect(
          outcomes.map((outcome) => outcome.value),
          `${label}: results`,
        ).toEqual([expected, expected])
      } else if (type === `request-then-release`) {
        if (state === `idle`) reach(`released-while-requesting`)
        const expected = state === `leader`
        model.release(tab)
        const outcome = request()
        expect(
          () => inTab(tab, () => leader.releaseLeadership()),
          `${label}: release`,
        ).not.toThrow()
        await settle()
        expect(outcome.value, `${label}: result`).toBe(expected)
      } else if (type === `fail-first`) {
        if (state !== `idle`) continue
        reach(`first-request-failed`)
        locks.failFirst = true
        model.warnings += 1
        const outcome = request()
        await settle()
        expect(outcome.value, `${label}: result`).toBe(false)
      } else if (type === `fail-queued`) {
        if (state !== `idle` || model.holder === undefined) continue
        reach(`queued-request-failed`)
        locks.failQueued = true
        model.warnings += 1
        const outcome = request()
        await settle()
        expect(outcome.value, `${label}: result`).toBe(false)
      } else if (type === `release`) {
        const waited = state === `waiting`
        const next = model.release(tab)
        if (waited) reach(`waiter-released`)
        if (next !== undefined) reach(`takeover-after-release`)
        expect(
          () => inTab(tab, () => leader.releaseLeadership()),
          `${label}: release`,
        ).not.toThrow()
        await settle()
      } else if (type === `close`) {
        const next = model.close(tab)
        if (next !== undefined) reach(`takeover-after-close`)
        locks.close(tab, LOCK)
        await settle()
      } else {
        if (state !== `leader` || model.queue.length === 0) continue
        reach(`released-after-grant`)
        const next = model.closeThenReleaseNext(tab)
        locks.close(tab, LOCK)
        expect(
          () => inTab(next, () => leaders[next]!.releaseLeadership()),
          `${label}: release`,
        ).not.toThrow()
        await settle()
      }
      check(label)
    }
  } finally {
    warn.mockRestore()
    vi.unstubAllGlobals()
  }
}

oracleProperty({
  id: property,
  law: {
    statement: `Exactly the first waiting tab takes over when the Web Locks leader releases or its context closes, and it is notified once. A tab that finds the lock free leads without a notification, repeated or concurrent requests keep one queue place, a tab that releases never leads afterward, and a failed lock request reports false and leaves the tab idle.`,
    authority: `Issue #2463, docs/guides/offline-transactions.md "A follower can become the leader after the current leader leaves", and the Web Locks API request order.`,
    limits: `Three tabs and one exclusive lock over a controlled lock manager; up to fourteen actions; no steal or shared mode, and no real browser contexts.`,
  },
  owns: [
    `src/coordination/WebLocksLeader.ts#WebLocksLeader.requestLeadership`,
    `src/coordination/WebLocksLeader.ts#WebLocksLeader.releaseLeadership`,
    `src/coordination/WebLocksLeader.ts#WebLocksLeader.isSupported`,
  ],
  histories: {
    arbitrary: historyArbitrary,
    runs: 60,
    fixedSeeds: [2463],
    states: reachStates,
    constructed: [
      {
        name: `a waiter takes over after the leader releases`,
        enters: [`takeover-after-release`],
        build: (generated: History): History =>
          spliced(generated, [...contested, act(`release`, 0)]),
      },
      {
        name: `a waiter takes over after the leader closes`,
        enters: [`takeover-after-close`],
        build: (generated: History): History =>
          spliced(generated, [...contested, act(`close`, 0)]),
      },
      {
        name: `a released waiter is skipped for the next one`,
        enters: [`waiter-released`, `takeover-after-release`],
        build: (generated: History): History =>
          spliced(generated, [
            ...contested,
            act(`request`, 2),
            act(`release`, 1),
            act(`release`, 0),
          ]),
      },
      {
        name: `a repeated request keeps one queue place`,
        enters: [`repeated-request-while-waiting`, `takeover-after-close`],
        build: (generated: History): History =>
          spliced(generated, [
            ...contested,
            act(`request`, 1),
            act(`close`, 0),
          ]),
      },
      {
        name: `two requests in one turn share one acquisition`,
        enters: [`concurrent-requests`],
        build: (generated: History): History =>
          spliced(generated, [
            act(`request-twice`, 0),
            act(`request-twice`, 1),
            act(`release`, 0),
          ]),
      },
      {
        name: `a request is released in its own turn`,
        enters: [`released-while-requesting`],
        build: (generated: History): History =>
          spliced(generated, [
            act(`request-then-release`, 0),
            act(`request`, 1),
            act(`request-then-release`, 2),
          ]),
      },
      {
        name: `failed lock requests leave the tab idle`,
        enters: [`first-request-failed`, `queued-request-failed`],
        build: (generated: History): History =>
          spliced(generated, [
            act(`fail-first`, 0),
            act(`request`, 0),
            act(`fail-queued`, 1),
            act(`request`, 1),
            act(`release`, 0),
          ]),
      },
      {
        name: `a waiter releases after its grant`,
        enters: [`released-after-grant`],
        build: (generated: History): History =>
          spliced(generated, [
            ...contested,
            act(`request`, 2),
            act(`close-then-release-next`, 0),
          ]),
      },
      {
        name: `the environment has no Web Locks API`,
        enters: [`unsupported-environment`],
        build: (generated: History): History => ({
          environment:
            generated.actions.length % 2 === 0 ? `no-locks` : `no-navigator`,
          actions: generated.actions,
        }),
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
