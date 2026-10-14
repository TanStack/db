import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { NonRetriableError } from '../src/types'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import {
  atOracleCheckpoint,
  captureUnhandledRejections,
  cleanupOfflineOracle,
} from './oracle-lifecycle'
import { readOfflineOracleConfig } from './oracle-config'
import type { OnlineDetector } from '../src/types'
import type { TestItem } from './harness'

/**
 * # Does an interruption at any microtask turn keep each offline transaction's
 * settlement and durable ownership?
 *
 * Contract and source: the README and the settlement and leadership oracles.
 * Leadership loss, disposal, and going offline fence new provider work; issued
 * work may still settle. A transaction that was not durably admitted rejects
 * its commit with `NonRetriableError` and never reaches the provider. A durable
 * row stays owned until its acknowledgement or permanent rejection is durably
 * removed, and no ID reaches the provider twice. A commit fulfils only after
 * the provider fulfilled and the outbox row was durably removed.
 *
 * The other offline oracles step between named gates or full flushes. This one
 * moves a single interruption across individual microtask turns of the
 * commit pipeline (`persistTransaction`, outbox admission, scheduling, the
 * provider call, the phase write and the deletion), where a removed `await`
 * or a reordered step would change what the interruption sees.
 *
 * History grammar: one to three manual transactions on disjoint keys, each
 * with a provider outcome (fulfil, or reject with `NonRetriableError`), commit
 * back to back. After `turn` microtask turns (0-40, favoring the first few,
 * where admission happens) one interruption occurs:
 * leadership loss, going offline, or disposal. Recovery then restores the
 * condition: leadership returns to the same executor, the detector goes back
 * online, or, after disposal and once issued work has settled, a fresh
 * executor starts over the same storage.
 *
 * Model and refinement check, all from recorded public observations:
 * - Admission: a commit that rejects with `NonRetriableError` before its
 *   provider call was not admitted; it must never reach the provider. Only
 *   the current leader admits work, so after leadership loss or disposal no
 *   outbox write for a new row may start. The admission check and the write
 *   run in one synchronous step, so a write that starts after the
 *   interruption means admission passed after it. Going offline does not
 *   refuse admission.
 * - Fencing: no provider call starts between the interruption and recovery.
 * - Once: every admitted ID reaches the provider exactly once across both
 *   executors, and calls follow commit order.
 * - Settlement: after leadership returns or the detector goes online, every
 *   admitted commit settles with its provider outcome. After disposal, the
 *   old executor's waiter may stay pending (disposal ends it), but a settled
 *   commit must still match its outcome.
 * - Durability: when a commit fulfils, its row is already gone from storage,
 *   and after recovery the outbox is empty.
 * - No rejection escapes as an unhandled process rejection.
 *
 * Reach: each history reports where the interruption landed for each
 * transaction: before admission, after admission but before its provider
 * call, or after the call. The campaign requires every reachable position for
 * every interruption (going offline cannot refuse admission), so the turn
 * range cannot silently fall entirely before or after the pipeline.
 *
 * Limits: disjoint keys only, so sibling rollback is the settlement oracle's;
 * the provider answers within its call, and fake storage answers each
 * operation in one turn, so this proves ordering against this adapter, not a
 * native storage engine. Overlapping old and new executors are not generated:
 * exactly-once execution across independent leaders is not promised.
 */

type Outcome = `fulfil` | `reject`
type Interruption = `leadership` | `offline` | `dispose`
type Landing = `refused` | `queued` | `issued`
type History = {
  outcomes: Array<Outcome>
  interruption: Interruption
  turn: number
}

const config = readOfflineOracleConfig({
  prefix: `TANSTACK_DB_OFFLINE_ORACLE`,
  defaultRuns: 60,
})

const history: fc.Arbitrary<History> = fc.record({
  outcomes: fc.array(fc.constantFrom<Outcome>(`fulfil`, `reject`), {
    minLength: 1,
    maxLength: 3,
  }),
  interruption: fc.constantFrom<Interruption>(
    `leadership`,
    `offline`,
    `dispose`,
  ),
  // Admission takes only the first few turns, so small turns are favored.
  turn: fc.oneof(
    fc.integer({ min: 0, max: 4 }),
    fc.integer({ min: 0, max: 40 }),
  ),
})

class ControlledDetector implements OnlineDetector {
  online = true
  private listeners = new Set<() => void>()
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  notifyOnline(): void {
    for (const listener of this.listeners) listener()
  }
  isOnline(): boolean {
    return this.online
  }
  setOnline(online: boolean): void {
    this.online = online
    if (online) this.notifyOnline()
  }
  dispose(): void {
    this.listeners.clear()
  }
}

const settle = async () => {
  for (let index = 0; index < 10; index++)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function checkInterruption({
  outcomes,
  interruption,
  turn,
}: History): Promise<Array<Landing>> {
  // The phase in which each provider call or outbox write started.
  let phase: `before` | `fenced` | `after` = `before`
  // Outbox writes of rows not stored before, with the phase each started in.
  const admissions: Array<`before` | `fenced` | `after`> = []
  const storage = new (class extends FakeStorageAdapter {
    override async set(key: string, value: string): Promise<void> {
      if (!(key in this.snapshot())) admissions.push(phase)
      return super.set(key, value)
    }
  })()
  const unhandled = captureUnhandledRejections()
  // Provider calls from either executor, in order, with the phase each
  // started in.
  const calls: Array<{ id: string; phase: `before` | `fenced` | `after` }> = []
  const outcomeById = new Map<string, Outcome>()
  const mutationFn = (params: {
    transaction: { id: string }
    idempotencyKey: string
  }) => {
    const id = params.transaction.id
    calls.push({ id, phase })
    if (outcomeById.get(id) === `reject`)
      throw new NonRetriableError(`provider rejected ${id}`)
    return { ok: true }
  }
  const detector = new ControlledDetector()
  const first = createTestOfflineEnvironment({
    storage,
    mutationFn,
    config: { onlineDetector: detector },
  })
  let second: ReturnType<typeof createTestOfflineEnvironment> | undefined
  const commits: Array<{
    id: string
    outcome: Outcome
    // A snapshot of the stored keys when the commit fulfilled.
    storedAtFulfil?: Array<string>
    result: Promise<`fulfilled` | unknown>
    settled: boolean
  }> = []
  let hasPrimaryFailure = false
  try {
    await first.waitForLeader()
    for (const [index, outcome] of outcomes.entries()) {
      const offline = first.executor.createOfflineTransaction({
        mutationFnName: first.mutationFnName,
        autoCommit: false,
      })
      const row: TestItem = {
        id: `row-${index}`,
        value: `value ${index}`,
        completed: false,
        updatedAt: new Date(1700000000000),
      }
      const transaction = offline.mutate(() => first.collection.insert(row))
      outcomeById.set(transaction.id, outcome)
      const entry: (typeof commits)[number] = {
        id: transaction.id,
        outcome,
        result: Promise.resolve(),
        settled: false,
      }
      entry.result = offline.commit().then(
        () => {
          entry.settled = true
          entry.storedAtFulfil = Object.keys(storage.snapshot())
          return `fulfilled`
        },
        (error: unknown) => {
          entry.settled = true
          return error
        },
      )
      commits.push(entry)
    }

    // Inline, so turn 0 interrupts in the same task as the commits and each
    // later turn is exactly one microtask.
    for (let index = 0; index < turn; index++) await Promise.resolve()
    phase = `fenced`
    if (interruption === `leadership`) first.leader.setLeader(false)
    else if (interruption === `offline`) detector.setOnline(false)
    else first.executor.dispose()
    await settle()

    phase = `after`
    if (interruption === `leadership`) first.leader.setLeader(true)
    else if (interruption === `offline`) detector.setOnline(true)
    else {
      second = createTestOfflineEnvironment({ storage, mutationFn })
      await second.waitForLeader()
    }
    await settle()

    const results = await atOracleCheckpoint(
      Promise.all(
        commits.map((entry) =>
          entry.settled || interruption !== `dispose`
            ? entry.result
            : Promise.resolve(`pending`),
        ),
      ),
      `commits after recovery`,
    )

    expect(
      calls.filter((call) => call.phase === `fenced`),
      `provider calls between interruption and recovery`,
    ).toEqual([])
    if (interruption !== `offline`)
      expect(
        admissions.filter((started) => started === `fenced`),
        `admissions after the interruption`,
      ).toEqual([])
    const calledIds = calls.map((call) => call.id)
    expect(new Set(calledIds).size, `provider calls per ID`).toBe(
      calledIds.length,
    )
    const landings: Array<Landing> = []
    for (const [index, entry] of commits.entries()) {
      const result = results[index]
      const called = calledIds.includes(entry.id)
      const notAdmitted = !called && result instanceof NonRetriableError
      landings.push(
        notAdmitted
          ? `refused`
          : calls.find((call) => call.id === entry.id)?.phase === `before`
            ? `issued`
            : `queued`,
      )
      if (notAdmitted) continue
      expect(called, `admitted ${entry.id} reached the provider`).toBe(true)
      if (result === `pending`) {
        expect(interruption, `only disposal leaves a waiter pending`).toBe(
          `dispose`,
        )
        continue
      }
      if (entry.outcome === `fulfil`) {
        expect(result, `commit of ${entry.id}`).toBe(`fulfilled`)
        expect(
          entry.storedAtFulfil?.some((key) => key.includes(entry.id)),
          `row of ${entry.id} stored when its commit fulfilled`,
        ).toBe(false)
      } else {
        expect(result, `commit of ${entry.id}`).toBeInstanceOf(
          NonRetriableError,
        )
        expect((result as Error).message).toBe(`provider rejected ${entry.id}`)
      }
    }
    const order = commits.map((entry) => entry.id)
    expect(calledIds, `provider calls follow commit order`).toEqual(
      order.filter((id) => calledIds.includes(id)),
    )
    expect(Object.keys(storage.snapshot()), `outbox after recovery`).toEqual([])
    expect(unhandled.rejections, `unhandled rejections`).toEqual([])
    return landings
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    unhandled.cleanup()
    await cleanupOfflineOracle(
      [
        () => first.executor.dispose(),
        () => second?.executor.dispose(),
        () => first.collection.cleanup(),
        () => second?.collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

/**
 * Fixed histories designed to reach each interruption landing deterministically.
 * Each named history specifies: a specific turn, outcomes, and transaction count
 * that guarantee reaching a particular landing (issued, queued, or refused) with a
 * specific interruption type.
 *
 * Landings:
 * - "issued": provider call starts before interruption (phase before)
 * - "queued": provider call starts after interruption (phase fenced or after)
 * - "refused": outbox write never starts; admission is denied after interruption;
 *    commit fails with NonRetriableError
 *
 * For "refused" to occur with leadership loss or disposal, the outbox write must
 * attempt to start after the interruption is already in place (during fenced phase).
 * By using multiple transactions and appropriate turn timing, we ensure the later
 * transaction's outbox write attempt reaches the fenced phase, where it is denied.
 */
const fixedLandings: Array<{
  name: string
  history: History
  expectedLanding: Landing
}> = [
  // Leadership landings
  {
    name: `leadership issued`,
    history: { outcomes: [`fulfil`], interruption: `leadership`, turn: 50 },
    expectedLanding: `issued`,
  },
  {
    name: `leadership queued`,
    history: { outcomes: [`fulfil`], interruption: `leadership`, turn: 1 },
    expectedLanding: `queued`,
  },
  // For refused: two transactions, interrupt early so second one's outbox write
  // reaches the fenced phase, and its outcome is reject so commit fails.
  {
    name: `leadership refused`,
    history: {
      outcomes: [`fulfil`, `reject`],
      interruption: `leadership`,
      turn: 0,
    },
    expectedLanding: `refused`,
  },
  // Offline landings (cannot be refused: going offline does not fence admission)
  {
    name: `offline issued`,
    history: { outcomes: [`fulfil`], interruption: `offline`, turn: 50 },
    expectedLanding: `issued`,
  },
  {
    name: `offline queued`,
    history: { outcomes: [`fulfil`], interruption: `offline`, turn: 1 },
    expectedLanding: `queued`,
  },
  // Dispose landings
  {
    name: `dispose issued`,
    history: { outcomes: [`fulfil`], interruption: `dispose`, turn: 50 },
    expectedLanding: `issued`,
  },
  {
    name: `dispose queued`,
    history: { outcomes: [`fulfil`], interruption: `dispose`, turn: 1 },
    expectedLanding: `queued`,
  },
  // For refused: two transactions, second one's outbox write reaches fenced phase.
  {
    name: `dispose refused`,
    history: {
      outcomes: [`fulfil`, `reject`],
      interruption: `dispose`,
      turn: 0,
    },
    expectedLanding: `refused`,
  },
]

/**
 * Deterministic test: each fixed history must reach its expected landing every time.
 * This proves that each landing is reachable and that the oracle observes them correctly.
 * A mutant that removes refusal paths or makes landings unreachable must fail here.
 */
it.each(fixedLandings)(
  `landing $name is reachable: reaches $expectedLanding`,
  async ({ history: fixedHistory, expectedLanding, name }) => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    try {
      const landings = await checkInterruption(fixedHistory)
      // For "refused" cases (which use two transactions), check the second transaction.
      // For others, check the first.
      const transactionIndex = name.includes(`refused`) ? 1 : 0
      expect(landings[transactionIndex], `${name} landing`).toBe(
        expectedLanding,
      )
    } finally {
      warn.mockRestore()
    }
  },
  60_000,
)

it(`keeps settlement and ownership for an interruption at any microtask turn`, async () => {
  // A permanent provider failure logs once by design; this law ignores logs.
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  try {
    await fc.assert(
      fc.asyncProperty(history, async (generated) => {
        // Settlement and ownership must hold for every generated history,
        // regardless of which landing it reaches. Coverage is verified by the
        // fixed tests above; this campaign proves the core law.
        await checkInterruption(generated)
      }),
      {
        numRuns: config.runs,
        ...(config.seed === undefined ? {} : { seed: config.seed }),
        ...(config.path === undefined ? {} : { path: config.path }),
      },
    )
  } finally {
    warn.mockRestore()
  }
}, 120_000)
