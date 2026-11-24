/**
 * # Does the BroadcastChannel leader fallback follow its own requests and
 * releases, including from inside its own gain notification?
 *
 * Law and source: one tab leads outbox processing, and a tab that releases
 * stops leading (docs/guides/offline-transactions.md, "Storage and
 * leadership"; issue #2463). Without Web Locks, BroadcastChannelLeader elects
 * a tab: a request that does not lead starts an election unless one is
 * pending, and reports after one second whether the tab leads. With no other
 * tab answering, the election claims leadership ten seconds after it starts,
 * announces the claim and sends a heartbeat at once and every five seconds. A
 * release stops the heartbeat, cancels a pending election and, if the tab led,
 * reports the loss. The leader state changes at once; listeners hear changes in
 * order, so a release inside a gain notification is heard after the gain.
 *
 * Model: a timeline of the election, heartbeat and request timers, ordered by
 * due time and then by creation, as the timer queue orders them. A listener
 * armed to release, or to release and request again, acts when the tab gains
 * leadership, before the claim is announced.
 *
 * History grammar: up to fourteen actions on one tab: request, release, arm a
 * listener to release or to release and request again on the next gain, and
 * advance time by one, five or ten seconds. Each history ends by disposing the
 * leader.
 *
 * Production driver: the real BroadcastChannelLeader over a controlled channel
 * that records posted message types, with fake timers.
 *
 * Refinement check: after every action, the posted messages, each listener
 * notification, every request result and the leader state equal the model.
 *
 * Known omissions: no peer tab, so no competing heartbeats, elections or
 * claims, and no real BroadcastChannel.
 */
import fc from 'fast-check'
import { expect, vi } from 'vitest'
import { BroadcastChannelLeader } from '../src/coordination/BroadcastChannelLeader'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'

const property = `offline.broadcast-channel-leader`
const MAX_ACTIONS = 14
const ELECTION_MS = 10_000
const HEARTBEAT_MS = 5_000
const REQUEST_MS = 1_000

const reachStates = [
  // An election claimed leadership.
  `claimed`,
  // A leader sent a later heartbeat.
  `heartbeat-repeated`,
  // A request reported that the tab leads.
  `request-true`,
  // A request reported that the tab does not lead.
  `request-false`,
  // A request found the tab already leading.
  `request-while-leading`,
  // A release cancelled a pending election.
  `election-cancelled`,
  // A listener released when told the tab leads.
  `released-on-gain`,
  // A listener released and requested again when told the tab leads.
  `rerequested-on-gain`,
] as const
type ReachState = (typeof reachStates)[number]

type Action =
  | { type: `request` }
  | { type: `release` }
  | { type: `release-on-gain` }
  | { type: `rerequest-on-gain` }
  | { type: `advance`; ms: number }
type History = { actions: Array<Action> }

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Timer = { at: number; seq: number }

class FallbackModel {
  now = 0
  private seq = 0
  leader = false
  private election: Timer | undefined
  private heartbeat: Timer | undefined
  private readonly pending: Array<Timer & { index: number }> = []
  readonly results: Array<boolean | undefined> = []
  readonly posted: Array<string> = []
  readonly notifications: Array<boolean> = []
  armed: `release` | `rerequest` | undefined
  readonly reached = new Set<ReachState>()

  private timer(delay: number): Timer {
    return { at: this.now + delay, seq: this.seq++ }
  }

  request(): void {
    const index = this.results.length
    if (this.leader) {
      this.results.push(true)
      this.reached.add(`request-while-leading`)
      return
    }
    this.results.push(undefined)
    if (!this.election) {
      this.posted.push(`election`)
      this.election = this.timer(ELECTION_MS)
    }
    this.pending.push({ ...this.timer(REQUEST_MS), index })
  }

  release(): void {
    this.heartbeat = undefined
    if (this.election) this.reached.add(`election-cancelled`)
    this.election = undefined
    if (!this.leader) return
    this.leader = false
    this.notifications.push(false)
  }

  private claim(): void {
    this.leader = true
    this.notifications.push(true)
    const armed = this.armed
    this.armed = undefined
    if (armed !== undefined) {
      this.reached.add(
        armed === `release` ? `released-on-gain` : `rerequested-on-gain`,
      )
      this.release()
      if (armed === `rerequest`) this.request()
      // A listener that released leaves nothing to announce.
      return
    }
    this.reached.add(`claimed`)
    this.posted.push(`leadership-claim`, `heartbeat`)
    this.heartbeat = this.timer(HEARTBEAT_MS)
  }

  advance(ms: number): void {
    const until = this.now + ms
    for (;;) {
      const due = [this.election, this.heartbeat, ...this.pending]
        .filter((timer): timer is Timer => timer !== undefined)
        .filter((timer) => timer.at <= until)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0]
      if (!due) break
      this.now = due.at
      if (due === this.election) {
        this.election = undefined
        this.claim()
      } else if (due === this.heartbeat) {
        this.reached.add(`heartbeat-repeated`)
        this.posted.push(`heartbeat`)
        this.heartbeat = { at: this.now + HEARTBEAT_MS, seq: due.seq }
      } else {
        const request = due as Timer & { index: number }
        this.pending.splice(this.pending.indexOf(request), 1)
        this.results[request.index] = this.leader
        this.reached.add(this.leader ? `request-true` : `request-false`)
      }
    }
    this.now = until
  }
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const actionArbitrary: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({ type: fc.constant(`request` as const) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ type: fc.constant(`release` as const) }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ type: fc.constant(`release-on-gain` as const) }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ type: fc.constant(`rerequest-on-gain` as const) }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant(`advance` as const),
      ms: fc.constantFrom(REQUEST_MS, HEARTBEAT_MS, ELECTION_MS),
    }),
  },
)
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  actions: fc.array(actionArbitrary, { minLength: 1, maxLength: MAX_ACTIONS }),
})

const request: Action = { type: `request` }
const release: Action = { type: `release` }
const advance = (ms: number): Action => ({ type: `advance`, ms })

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

async function runHistory(
  history: History,
  reach: (state: ReachState) => void,
): Promise<void> {
  vi.useFakeTimers()
  // The leader schedules elections and heartbeats through window, which fake
  // timers leave alone in this environment.
  const timers = [
    vi
      .spyOn(window, `setTimeout`)
      .mockImplementation(((callback: () => void, delay?: number) =>
        setTimeout(callback, delay)) as never),
    vi
      .spyOn(window, `setInterval`)
      .mockImplementation(((callback: () => void, delay?: number) =>
        setInterval(callback, delay)) as never),
  ]
  const posted: Array<string> = []
  class ControlledChannel {
    constructor(readonly name: string) {}
    addEventListener() {}
    removeEventListener() {}
    postMessage(message: { type: string }) {
      posted.push(message.type)
    }
    close() {}
  }
  vi.stubGlobal(`BroadcastChannel`, ControlledChannel)
  const leader = new BroadcastChannelLeader(`oracle-fallback`)
  const model = new FallbackModel()
  const notifications: Array<boolean> = []
  const results: Array<{ value?: boolean }> = []
  let armed: `release` | `rerequest` | undefined
  const observe = (promise: Promise<boolean>) => {
    const outcome: { value?: boolean } = {}
    results.push(outcome)
    void promise.then((value) => {
      outcome.value = value
    })
  }
  // Registered first, so it acts before later listeners hear the gain.
  leader.onLeadershipChange((isLeader) => {
    if (!isLeader || !armed) return
    const action = armed
    armed = undefined
    leader.releaseLeadership()
    if (action === `rerequest`) observe(leader.requestLeadership())
  })
  leader.onLeadershipChange((isLeader) => {
    notifications.push(isLeader)
  })

  const check = (label: string) => {
    expect(posted, `${label}: posted messages`).toEqual(model.posted)
    expect(notifications, `${label}: notifications`).toEqual(
      model.notifications,
    )
    expect(
      results.map((outcome) => outcome.value),
      `${label}: request results`,
    ).toEqual(model.results)
    expect(leader.isLeader(), `${label}: leader`).toBe(model.leader)
  }

  try {
    for (const [step, action] of history.actions.entries()) {
      const label = `step ${step} ${action.type}`
      if (action.type === `request`) {
        model.request()
        observe(leader.requestLeadership())
      } else if (action.type === `release`) {
        model.release()
        leader.releaseLeadership()
      } else if (action.type === `advance`) {
        model.advance(action.ms)
        await vi.advanceTimersByTimeAsync(action.ms)
      } else {
        armed = action.type === `release-on-gain` ? `release` : `rerequest`
        model.armed = armed
      }
      // Settle resolved requests without moving time.
      await vi.advanceTimersByTimeAsync(0)
      check(label)
    }
    model.release()
    leader.dispose()
    check(`dispose`)
    for (const state of model.reached) reach(state)
  } finally {
    leader.dispose()
    for (const timer of timers) timer.mockRestore()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
}

oracleProperty({
  id: property,
  law: {
    statement: `Without Web Locks, a request that does not lead starts an election unless one is pending and reports after one second whether the tab leads; an unanswered election claims leadership ten seconds after it starts and announces it with a heartbeat that repeats every five seconds; a release stops the heartbeat, cancels a pending election and reports a loss once. The leader state changes at once, a release or a new request inside the gain notification is heard after the gain and leaves no claim announced, and a release while not leading notifies nothing.`,
    authority: `Issue #2463, docs/guides/offline-transactions.md "Storage and leadership", and the LeaderElection contract in packages/offline-transactions/src/types.ts.`,
    limits: `One tab over a controlled channel with fake timers; up to fourteen actions; no peer tab and no real BroadcastChannel.`,
  },
  owns: [
    `src/coordination/BroadcastChannelLeader.ts`,
    `src/coordination/LeaderElection.ts`,
  ],
  histories: {
    arbitrary: historyArbitrary,
    runs: 60,
    fixedSeeds: [2463],
    states: reachStates,
    constructed: [
      {
        name: `an election claims, heartbeats and is released`,
        enters: [
          `claimed`,
          `heartbeat-repeated`,
          `request-true`,
          `request-false`,
          `request-while-leading`,
        ],
        build: (): History => ({
          actions: [
            request,
            advance(HEARTBEAT_MS),
            advance(REQUEST_MS),
            advance(REQUEST_MS),
            advance(REQUEST_MS),
            advance(REQUEST_MS),
            request,
            advance(REQUEST_MS),
            request,
            advance(HEARTBEAT_MS),
            release,
          ],
        }),
      },
      {
        name: `a release cancels a pending election`,
        enters: [`election-cancelled`],
        build: (): History => ({
          actions: [request, release, advance(ELECTION_MS)],
        }),
      },
      {
        name: `a listener releases when told the tab leads`,
        enters: [`released-on-gain`],
        build: (): History => ({
          actions: [
            { type: `release-on-gain` },
            request,
            advance(ELECTION_MS),
            advance(ELECTION_MS),
          ],
        }),
      },
      {
        name: `a listener releases and requests again when told the tab leads`,
        enters: [`rerequested-on-gain`, `request-false`, `claimed`],
        build: (): History => ({
          actions: [
            { type: `rerequest-on-gain` },
            request,
            advance(ELECTION_MS),
            advance(REQUEST_MS),
            advance(ELECTION_MS),
          ],
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
