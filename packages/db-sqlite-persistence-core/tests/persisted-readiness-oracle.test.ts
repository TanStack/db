import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { persistedCollectionOptions } from '../src/index.js'
import type { PersistenceAdapter } from '../src/index.js'
import type { SyncConfig } from '@tanstack/db'

/**
 * # When does a persisted Collection open from restored rows?
 *
 * A persisted Collection keeps one status: `status` says whether the data can
 * be shown, wherever the rows came from. Without `initialRender`, the
 * Collection waits for its sync adapter, as any Collection does. With
 * `initialRender: { strategy: 'network-first', networkTimeoutMs }`, it prefers
 * the network for `networkTimeoutMs`. Once that deadline passes, or the remote
 * fails, a completed restore that installed rows opens the Collection: status
 * `ready` with the restored rows. Problems the remote reports after that are
 * the Collection's sync errors, and its rows stay.
 *
 * Three boundaries keep `ready` honest:
 *
 * - An empty restore never opens the Collection. It stays `loading` until the
 *   remote answers, so an empty list always means "no rows", not "unknown".
 *   (A Collection that synced to zero rows also waits for the network; the
 *   restore cannot tell the two apart.)
 * - The restore comes first. A remote that answers before the restore
 *   finishes waits for it, so remote rows apply over restored ones. A remote
 *   that became ready then makes the Collection `ready`. A remote that failed
 *   lets restored rows open the Collection, and the failure shows as its
 *   `error`; with no rows the first load fails (`status: 'error'`).
 * - A failed restore is a crash: local storage cannot serve reads.
 *
 * Two more laws hold on the way there:
 *
 * - The wrapper delivers the adapter's calls to core in the order the adapter
 *   made them. `markReady(); fail(e)` in one tick leaves the Collection
 *   `ready` with error `e`, and `reportError(e1); fail(e2)` on a ready
 *   Collection leaves it `ready` with error `e2`: `fail()` after readiness
 *   keeps the rows and clears the retry reason.
 * - A ready callback (`onFirstReady`) or `status:ready` listener that throws
 *   does not change the Collection. The status is already `ready` when they
 *   run, and a crash is only for a Collection that cannot serve reads. The
 *   error surfaces as uncaught, as core reports other subscriber errors.
 *
 * ## The model
 *
 * `expected` replays the events of one history over a small state: the
 * Collection's status, whether the restore finished and with how many rows,
 * whether the deadline passed, the remote calls that wait for the restore,
 * the error the node shows, and the uncaught errors reported so far. It reads
 * no production state.
 *
 * ## The history grammar
 *
 * A history orders up to four events: the restore settles (with rows, empty,
 * or failed), the remote answers, the remote gives up later, and the deadline
 * passes. The remote's answer is one tick of adapter calls: `markReady()`,
 * `markReady()` then `reportError()`, `markReady()` then `fail()`, or
 * `fail()`. A remote that answered ready may give up later: `reportError()`
 * then `fail()` in one tick. Giving up follows the answer and may still come
 * before the restore settles. Each history runs once with quiet ready effects
 * and once with a throwing `onFirstReady` callback and `status:ready`
 * listener. Every ordering of every combination is generated.
 *
 * ## The comparison
 *
 * After every event the driver compares the Collection's status, the messages
 * of its node's `error` and `failureReason`, the keys of its rows while it is
 * `ready`, and the uncaught errors, as a sorted list since their order is not
 * promised. A live query over the Collection follows its status.
 *
 * ## Limits
 *
 * The adapter is a controlled in-memory persistence adapter, not native
 * SQLite. Restarts, cross-tab coordination, and on-demand persistence are
 * outside this owner (on-demand rejects network-first configuration). Calls
 * that break the adapter contract are fixed examples below, not generated.
 */

type Row = { id: string; value: string }
type Restore = `rows` | `empty` | `failed`
type Remote = `ready` | `ready-report` | `ready-fail` | `fail`
type Effects = `quiet` | `throwing`
type Event =
  | { kind: `restore`; outcome: Restore }
  | { kind: `remote`; outcome: Remote }
  | { kind: `give-up` }
  | { kind: `deadline` }

// One adapter call. The calls of one event happen in the same tick.
type Call = `ready` | `report` | `fail`
const REMOTE_CALLS: Record<Remote, ReadonlyArray<Call>> = {
  ready: [`ready`],
  'ready-report': [`ready`, `report`],
  'ready-fail': [`ready`, `fail`],
  fail: [`fail`],
}
const GIVE_UP_CALLS: ReadonlyArray<Call> = [`report`, `fail`]

const TIMEOUT = 100
const DISK_ROW: Row = { id: `disk`, value: `restored` }
const REMOTE_ROW: Row = { id: `remote`, value: `synced` }
const RESTORE_FAILURE = `restore failed`
const REMOTE_FAILURE = `remote gave up`
const REMOTE_REPORT = `remote retrying`
const READY_CALLBACK_FAILURE = `ready callback threw`
const STATUS_LISTENER_FAILURE = `status listener threw`

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

type Expected = {
  status: `loading` | `ready` | `error` | `crashed`
  error: string | null
  failureReason: string | null
  rows: Array<string>
  uncaught: Array<string>
}

function expected(
  events: ReadonlyArray<Event>,
  effects: Effects,
): Array<Expected> {
  let status: Expected[`status`] = `loading`
  let restore: Restore | `pending` = `pending`
  let deadline = false
  let remoteFailed = false
  const waiting: Array<Call> = []
  let error: string | null = null
  let failureReason: string | null = null
  const rows = new Set<string>()
  const uncaught: Array<string> = []

  // The status is `ready` before ready effects run, so a throwing effect
  // only adds an uncaught error.
  const becomeReady = () => {
    status = `ready`
    if (effects === `throwing`)
      uncaught.push(STATUS_LISTENER_FAILURE, READY_CALLBACK_FAILURE)
  }
  // Restored rows may open the Collection once the network had its chance.
  const openFromDisk = () => {
    if (
      status === `loading` &&
      restore === `rows` &&
      (deadline || remoteFailed)
    )
      becomeReady()
  }
  // The remote's calls apply in the order it made them.
  const apply = (call: Call) => {
    if (call === `ready`) {
      rows.add(REMOTE_ROW.id)
      if (status === `loading`) becomeReady()
    } else if (call === `report`) {
      failureReason = REMOTE_REPORT
    } else {
      remoteFailed = true
      openFromDisk()
      if (status === `ready`) {
        // The rows stay; the stop replaces the retry reason.
        error = REMOTE_FAILURE
        failureReason = null
      } else if (status === `loading`) {
        status = `error`
        error = REMOTE_FAILURE
      }
    }
  }
  // Calls made before the restore settles wait for it.
  const call = (calls: ReadonlyArray<Call>) => {
    if (restore === `pending`) waiting.push(...calls)
    else calls.forEach(apply)
  }

  return events.map((event) => {
    if (status !== `crashed`) {
      if (event.kind === `restore`) {
        restore = event.outcome
        if (event.outcome === `failed`) {
          status = `crashed`
          error = RESTORE_FAILURE
        } else {
          if (event.outcome === `rows`) rows.add(DISK_ROW.id)
          if (waiting.length > 0) waiting.splice(0).forEach(apply)
          else openFromDisk()
        }
      } else if (event.kind === `deadline`) {
        deadline = true
        openFromDisk()
      } else if (event.kind === `give-up`) {
        call(GIVE_UP_CALLS)
      } else {
        call(REMOTE_CALLS[event.outcome])
      }
    }
    return {
      status,
      error,
      failureReason: status === `crashed` ? null : failureReason,
      rows: status === `ready` ? [...rows].sort() : [],
      uncaught: [...uncaught].sort(),
    }
  })
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

function permutations<T>(items: ReadonlyArray<T>): Array<Array<T>> {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  )
}

// Only a remote that answered ready and is still running can give up later.
const giveUpFollows = (events: ReadonlyArray<Event>) => {
  const answer = events.findIndex((event) => event.kind === `remote`)
  const giveUp = events.findIndex((event) => event.kind === `give-up`)
  return giveUp === -1 || answer < giveUp
}

const histories: Array<{ events: Array<Event>; effects: Effects }> = []
for (const effects of [`quiet`, `throwing`] as const) {
  for (const restore of [`rows`, `empty`, `failed`] as const) {
    for (const remote of [
      `ready`,
      `ready-report`,
      `ready-fail`,
      `fail`,
      undefined,
    ] as const) {
      const canGiveUp = remote === `ready` || remote === `ready-report`
      for (const giveUp of canGiveUp ? [false, true] : [false]) {
        for (const deadline of [true, false]) {
          const events: Array<Event> = [{ kind: `restore`, outcome: restore }]
          if (remote) events.push({ kind: `remote`, outcome: remote })
          if (giveUp) events.push({ kind: `give-up` })
          if (deadline) events.push({ kind: `deadline` })
          for (const ordering of permutations(events).filter(giveUpFollows))
            histories.push({ events: ordering, effects })
        }
      }
    }
  }
}

// The states the ordering and ready-effect laws are about. The driver marks
// them from the model's prediction, before production can disagree.
const reachStates = [
  `fail behind a queued markReady`,
  `fail after reportError on a ready Collection`,
  `calls wait for the restore and give up`,
  `throwing ready effects as the remote opens the Collection`,
  `throwing ready effects as restored rows open the Collection`,
] as const

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

// A persistence adapter whose restore read waits for the history to settle it.
function controlledAdapter() {
  const load = deferred<ReadonlyArray<Row>>()
  void load.promise.catch(() => undefined)
  const adapter: PersistenceAdapter = {
    loadSubset: async () =>
      (await load.promise).map((value) => ({ key: value.id, value })),
    loadResumeSnapshot: async (_id, options) => {
      const rows = options?.includeRows === false ? [] : await load.promise
      return {
        rows: rows.map((value) => ({ key: value.id, value })),
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }
    },
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  }
  return { adapter, load }
}

function networkFirst(id: string, initialRender = true) {
  const fixture = controlledAdapter()
  let remote: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id,
      getKey: (row) => row.id,
      persistence: { adapter: fixture.adapter },
      ...(initialRender
        ? {
            initialRender: {
              strategy: `network-first` as const,
              networkTimeoutMs: TIMEOUT,
            },
          }
        : {}),
      sync: {
        sync: (params) => {
          remote = params
        },
      },
    }),
  )
  return {
    collection,
    restore: (outcome: Restore) =>
      outcome === `failed`
        ? fixture.load.reject(new Error(RESTORE_FAILURE))
        : fixture.load.resolve(outcome === `rows` ? [DISK_ROW] : []),
    // One adapter call, as the remote makes it.
    call: (call: Call) => {
      if (call === `ready`) {
        remote!.begin()
        remote!.write({ type: `insert`, value: REMOTE_ROW })
        remote!.commit()
        remote!.markReady()
      } else if (call === `report`) {
        remote!.reportError(new Error(REMOTE_REPORT))
      } else {
        remote!.fail(new Error(REMOTE_FAILURE))
      }
    },
  }
}

// Registers ready effects that throw: a first-ready callback and a status
// listener. Both run after the status reads `ready`.
function throwOnReady(
  collection: ReturnType<typeof networkFirst>[`collection`],
) {
  collection.onFirstReady(() => {
    throw new Error(READY_CALLBACK_FAILURE)
  })
  collection.on(`status:ready`, () => {
    throw new Error(STATUS_LISTENER_FAILURE)
  })
}

// Core reports a subscriber error as uncaught by throwing it from a
// microtask. This records each such error instead of letting it escape.
function captureUncaught(): Array<string> {
  const uncaught: Array<string> = []
  const queue = globalThis.queueMicrotask.bind(globalThis)
  vi.spyOn(globalThis, `queueMicrotask`).mockImplementation((task) =>
    queue(() => {
      try {
        task()
      } catch (error) {
        uncaught.push(error instanceof Error ? error.message : String(error))
      }
    }),
  )
  return uncaught
}

function observe(
  collection: ReturnType<typeof networkFirst>[`collection`],
  uncaught: ReadonlyArray<string>,
) {
  return {
    status: collection.status,
    error: collection.health.error?.message ?? null,
    failureReason: collection.health.failureReason?.message ?? null,
    rows:
      collection.status === `ready`
        ? collection.toArray.map((row) => row.id).sort()
        : [],
    uncaught: [...uncaught].sort(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe(`persisted readiness oracle`, () => {
  const reach = createOracleReach(`persisted-readiness.history`, reachStates)
  let historiesRan = 0
  afterAll(() => {
    // A filtered run checks the histories it ran, not reach.
    if (historiesRan === histories.length) reach.assertReached()
  })

  it.each(
    histories.map(
      ({ events, effects }) =>
        [`${effects}: ${describe_(events)}`, events, effects] as const,
    ),
  )(`%s`, async (name, events, effects) => {
    const source = networkFirst(`network-first-${name}`)
    if (effects === `throwing`) throwOnReady(source.collection)
    const live = createLiveQueryCollection((q) =>
      q.from({ row: source.collection }),
    )
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const uncaught = captureUncaught()
    reach.beginHistory()
    try {
      void source.collection.preload().catch(() => undefined)
      void live.preload().catch(() => undefined)
      await vi.advanceTimersByTimeAsync(0)
      const model = expected(events, effects)
      for (const [index, event] of events.entries()) {
        markReach(reach, events, model, index, effects)
        if (event.kind === `restore`) source.restore(event.outcome)
        else if (event.kind === `deadline`)
          await vi.advanceTimersByTimeAsync(TIMEOUT)
        else
          for (const call of event.kind === `give-up`
            ? GIVE_UP_CALLS
            : REMOTE_CALLS[event.outcome])
            source.call(call)
        await vi.advanceTimersByTimeAsync(0)
        const label = `after ${describe_(events.slice(0, index + 1))}`
        expect(observe(source.collection, uncaught), label).toEqual(
          model[index],
        )
        // A live query over the Collection shows the same status, by
        // live-query readiness, until the Collection ends its first load.
        if (model[index]!.status !== `crashed`)
          expect(live.status, `${label}: live query`).toBe(model[index]!.status)
      }
      historiesRan++
    } finally {
      vi.mocked(globalThis.queueMicrotask).mockRestore()
      consoleError.mockRestore()
      await live.cleanup()
      await source.collection.cleanup({ dependents: true })
    }
  })

  // The wrapper delivers the adapter's calls after startup, so a contract
  // violation cannot throw back at the adapter. It crashes the Collection
  // with the violation as its cause, as a throwing sync function does.
  it.each([
    {
      violation: `reportError() before markReady()`,
      calls: [`report`] as const,
      cause: /reportError/,
    },
  ])(`crashes on $violation`, async ({ violation, calls, cause }) => {
    const source = networkFirst(`contract-violation ${violation}`, false)
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      void source.collection.preload().catch(() => undefined)
      source.restore(`empty`)
      await vi.advanceTimersByTimeAsync(0)
      calls.forEach(source.call)
      await vi.advanceTimersByTimeAsync(0)
      expect(source.collection.status).toBe(`crashed`)
      expect(source.collection.health.error?.message).toMatch(cause)
    } finally {
      consoleError.mockRestore()
      await source.collection.cleanup({ dependents: true })
    }
  })

  // A run's markReady() after its fail() does nothing (core API decision
  // F18/F6): the stopped Collection stays ready with its error.
  it(`ignores markReady() after fail() on a ready Collection`, async () => {
    const source = networkFirst(`mark-ready-after-fail`, false)
    try {
      void source.collection.preload().catch(() => undefined)
      source.restore(`empty`)
      await vi.advanceTimersByTimeAsync(0)
      for (const call of [`ready`, `fail`, `ready`] as const) source.call(call)
      await vi.advanceTimersByTimeAsync(0)
      expect({
        status: source.collection.status,
        error: source.collection.health.error?.message,
      }).toEqual({ status: `ready`, error: REMOTE_FAILURE })
    } finally {
      await source.collection.cleanup({ dependents: true })
    }
  })

  it(`keeps a Collection without initialRender on the network boundary`, async () => {
    const source = networkFirst(`no-initial-render`, false)
    try {
      void source.collection.preload().catch(() => undefined)
      source.restore(`rows`)
      await vi.advanceTimersByTimeAsync(TIMEOUT * 10)
      expect(source.collection.status).toBe(`loading`)
      source.call(`ready`)
      await vi.advanceTimersByTimeAsync(0)
      expect(source.collection.status).toBe(`ready`)
    } finally {
      await source.collection.cleanup({ dependents: true })
    }
  })

  it(`defaults the network-first deadline to three seconds`, async () => {
    const fixture = controlledAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `default-network-deadline`,
        getKey: (row) => row.id,
        persistence: { adapter: fixture.adapter },
        initialRender: { strategy: `network-first` },
        sync: { sync: () => {} },
      }),
    )
    try {
      void collection.preload().catch(() => undefined)
      fixture.load.resolve([DISK_ROW])
      await vi.advanceTimersByTimeAsync(2_999)
      expect(collection.status).toBe(`loading`)
      await vi.advanceTimersByTimeAsync(1)
      expect(collection.status).toBe(`ready`)
    } finally {
      await collection.cleanup({ dependents: true })
    }
  })

  it(`rejects network-first initial rendering for on-demand persistence`, () => {
    const fixture = controlledAdapter()
    expect(() =>
      persistedCollectionOptions<Row, string>({
        id: `local-on-demand`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        initialRender: { strategy: `network-first`, networkTimeoutMs: 100 },
        persistence: { adapter: fixture.adapter },
      }),
    ).toThrow(/network-first.*eager/i)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    `rejects an invalid network timeout (%s)`,
    (networkTimeoutMs) => {
      const fixture = controlledAdapter()
      expect(() =>
        persistedCollectionOptions<Row, string>({
          id: `invalid-network-deadline`,
          getKey: (row) => row.id,
          persistence: { adapter: fixture.adapter },
          initialRender: { strategy: `network-first`, networkTimeoutMs },
        }),
      ).toThrow(/networkTimeoutMs/)
    },
  )
})

// Marks the declared states the history enters with its next event, as the
// model predicts them.
function markReach(
  reach: ReturnType<typeof createOracleReach<(typeof reachStates)[number]>>,
  events: ReadonlyArray<Event>,
  model: ReadonlyArray<Expected>,
  index: number,
  effects: Effects,
) {
  const event = events[index]!
  const before = index === 0 ? `loading` : model[index - 1]!.status
  const after = model[index]!
  if (before === `crashed`) return
  if (event.kind === `remote` && event.outcome === `ready-fail`)
    reach.reach(`fail behind a queued markReady`)
  if (event.kind === `give-up`) {
    if (before === `ready`)
      reach.reach(`fail after reportError on a ready Collection`)
    if (events.slice(0, index).every((earlier) => earlier.kind !== `restore`))
      reach.reach(`calls wait for the restore and give up`)
  }
  if (effects === `throwing` && before !== `ready` && after.status === `ready`)
    reach.reach(
      after.rows.includes(REMOTE_ROW.id)
        ? `throwing ready effects as the remote opens the Collection`
        : `throwing ready effects as restored rows open the Collection`,
    )
}

function describe_(events: ReadonlyArray<Event>): string {
  return events
    .map((event) =>
      event.kind === `deadline` || event.kind === `give-up`
        ? event.kind
        : `${event.kind}:${event.outcome}`,
    )
    .join(` > `)
}
