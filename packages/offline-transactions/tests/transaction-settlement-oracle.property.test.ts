import fc from 'fast-check'
import { createCollection, createTransaction } from '@tanstack/db'
import { expect, it, vi } from 'vitest'
import { NonRetriableError } from '../src/types'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { DefaultRetryPolicy } from '../src/retry/RetryPolicy'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import { atOracleCheckpoint, cleanupOfflineOracle } from './oracle-lifecycle'
import { readOfflineOracleConfig } from './oracle-config'
import type { TestItem } from './harness'
import type {
  OfflineConfig,
  OfflineTransaction,
  TransactionSignaler,
} from '../src/types'

/**
 * # Does each offline transaction settle only from its own durable history?
 *
 * The README's FIFO, durable-outbox, and NonRetriableError contracts, together
 * with waitForTransactionCompletion's per-ID API, authorize this law:
 * transactions enter a global FIFO, but commit and wait promises belong to one
 * transaction ID. Fulfillment of mutationFn and acknowledged outbox deletion
 * fulfill both caller promises. This alone does not establish server application
 * or public Collection publication.
 * Permanent failure rejects those promises with the same error and rolls back
 * only its local overlay. A peer's provider, retry-record, or durable-admission
 * failure cannot settle or erase independently admitted work.
 *
 * In this fixture, a successful mutationFn updates the modeled server rows and
 * submits their Collection sync writes before returning. Row assertions depend
 * on that controlled premise; the executor does not supply it for every provider.
 * The model is a prefix of completed transaction outcomes and an independently
 * folded map of provider-applied rows. Its `localRows` field represents public
 * Collection rows from optimistic state, not durable outbox entries.
 * Generated histories use 2–5 transactions, 1–3 rows each, shared or disjoint
 * keys, and success or permanent failure at each position. Pinned examples
 * reconstruct all-success, middle-failure, all-failure, and alternating
 * outcomes. Shared keys distinguish sibling rollback from disjoint-key
 * survival. Width distinguishes complete optimistic state for several rows
 * from partial multirow application. Outcome order distinguishes per-ID
 * settlement from a global failure. Two transactions and one row are
 * the marginal peer and width cases. Fresh production IDs exclude duplicate-ID
 * histories; an outcome-less provider call is not a completed history here.
 *
 * Gates expose each provider boundary. The real executor, Collection, and
 * outbox are the driver. At each held-provider checkpoint, the refinement
 * check compares exact calls, IDs, promise outcomes, durable outbox state,
 * provider-applied rows, and public local rows. A wrong global-settlement rule
 * would fulfill a held sibling after the first transaction; the checkpoint
 * compares that sibling with pending, and a wrong-result control verifies the
 * comparison rejects early fulfillment. The simple expected Maps do not copy
 * executor or scheduler internals.
 *
 * Held and failed deletion witnesses split named mutation function fulfillment
 * from durable outbox removal. At the held-delete checkpoint, the public caller
 * and `isPersisted` promises remain pending. A phase-write or deletion failure
 * rejects the caller promise with the storage error, stops the executor, and
 * holds queued peers. An offline executor restart removes a marked outbox entry
 * without another named mutation function call.
 * An admitted outbox entry without a terminal marker can invoke the named
 * mutation function during outbox replay. These two entries distinguish the
 * crash windows around the phase write. The controlled provider and fake
 * storage establish this executor boundary, not real server acknowledgement
 * timing, native storage completion, or multiple-owner leadership. A normal
 * run pairs fixed and seedless campaigns.
 * A permanent named mutation function failure uses a separate rejection-pending
 * marker. The original caller promise rejects with that failure. A storage
 * failure also rejects the executor batch promise and stops further work. An
 * offline executor restart removes a marked outbox entry without another named
 * mutation function call or restoration of optimistic state.
 * Direct executor checks pin the storage error, FIFO peer hold, and refusal of
 * further attempts. Outbox replay can invoke the named mutation function after
 * a crash if the marker write failed.
 * The `shouldRetry` option changes only the decision after a named mutation
 * function rejects. The hook receives the original Error and current retry
 * count once.
 * A non-Error named mutation rejection is converted to an Error before the
 * hook runs; its custom fields are not part of this promise.
 * `true` retries, `false` terminates, and `undefined` delegates to the existing
 * default decision. An absent hook also uses that default. `NonRetriableError`
 * remains permanent without consulting the hook. The existing default policy
 * still supplies retry delay with the configured jitter setting. This oracle
 * checks the default delay path with jitter disabled, not jitter math. The
 * exported default terminates AbortError and messages containing 400, 401,
 * 403, or 422; an ordinary network error or a 404 message retries. These are
 * preservation controls, while the hook rule is the chosen new law.
 * At the durable decision checkpoint, a retry retains the offline transaction
 * at the FIFO head, the public Collection's optimistic state, and both caller
 * promises. The outer optimistic transaction remains pending during retry.
 * A terminal decision removes the outbox entry, rejects those promises with
 * the named mutation function Error, and lets the queued peer run. The controlled
 * provider and storage do not establish real timer accuracy or server idempotency.
 * A throwing hook or a result outside `true`, `false`, and `undefined` is a
 * row-local retry decision failure. The executor records a terminal rejection,
 * removes that row, rejects its public `commit()` with the hook failure, and
 * drops its optimistic state. A queued FIFO peer then runs in the same executor.
 * A Promise returned by an async hook is invalid even if it later rejects;
 * its rejection must not escape as an unhandled process rejection.
 * A commit begun during terminal cleanup may durably join the queue, but its
 * provider waits for the failed head's acknowledged deletion. A write begun
 * before the hook fault may also acknowledge afterward and join that queue.
 * A write rejected before storing its row rejects only its own caller.
 * These controlled histories require terminal marker and deletion success.
 * A failed terminal storage operation remains an executor failure; after a
 * persisted rejection marker, restart removes the failed row without another
 * named mutation function call or optimistic restoration. They do not cover an
 * adapter that stores a row before rejecting its write acknowledgement.
 * Public manual removal may acknowledge deletion while a named mutation
 * function call is held. Once that call fulfills, both success conditions have
 * occurred. The caller promise and local persistence promise must settle
 * without another outbox entry.
 * Here, an offline executor restart constructs a fresh executor over the retained
 * outbox. Outbox replay resumes unfinished durable work, including terminal-phase
 * deletion; neither operation is a Collection sync restart or truncate replay.
 * To replay one oracle shrink directly, set OFFLINE_ORACLE_SEED and
 * OFFLINE_ORACLE_PATH, then select this file and the failing test name.
 */

const settlementOracle = readOfflineOracleConfig({
  prefix: `OFFLINE_ORACLE`,
  defaultRuns: 40,
})
const retryRecordOracle = readOfflineOracleConfig({
  prefix: `OFFLINE_ORACLE`,
  defaultRuns: 20,
})
const admissionOracle = readOfflineOracleConfig({
  prefix: `OFFLINE_ORACLE`,
  defaultRuns: 10,
})
const retryDecisionOracle = readOfflineOracleConfig({
  prefix: `OFFLINE_ORACLE`,
  defaultRuns: 12,
})

type OracleConfig = ReturnType<typeof readOfflineOracleConfig>

function oracleSeeds(fixedSeed: number, config: OracleConfig) {
  return config.seed === undefined ? [fixedSeed, undefined] : [config.seed]
}

function oracleOptions(config: OracleConfig, seed: number | undefined) {
  return {
    numRuns: config.runs,
    ...(seed === undefined ? {} : { seed }),
    ...(config.path === undefined ? {} : { path: config.path }),
  }
}

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const localRows = (rows: Iterable<TestItem>) =>
  [...rows]
    .map(({ id, value, completed, updatedAt }) => ({
      id,
      value,
      completed,
      updatedAt,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

function expectLocalRows(
  actual: Iterable<TestItem>,
  expected: Iterable<TestItem>,
) {
  expect(localRows(actual)).toEqual(localRows(expected))
}

it.each(oracleSeeds(20260913, settlementOracle))(
  `settles each transaction independently while preserving FIFO (seed %s)`,
  async (seed) => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sharedKeys: fc.boolean(),
          width: fc.integer({ min: 1, max: 3 }),
          outcomes: fc.array(fc.boolean(), { minLength: 2, maxLength: 5 }),
        }),
        async ({ sharedKeys, width, outcomes }) => {
          const succeeds = outcomes
          const failures = succeeds.map(
            (_value, index) => new NonRetriableError(`failed-${index}`),
          )
          const entered = succeeds.map(() => gate())
          const release = succeeds.map(() => gate())
          const statuses: Record<string, unknown> = {}
          const observed: Array<Promise<void>> = []
          const observe = (name: string, promise: Promise<unknown>) => {
            statuses[name] = `pending`
            observed.push(
              promise.then(
                () => {
                  statuses[name] = `fulfilled`
                },
                (error: unknown) => {
                  statuses[name] = error
                },
              ),
            )
          }
          const calls: Array<{
            id: string
            rows: Array<Record<string, unknown>>
          }> = []
          const expectedRows = succeeds.map((_, index) =>
            Array.from({ length: width }, (_unused, column) => ({
              id: `${sharedKeys ? 0 : index}:${column}`,
              value: `value-${index}`,
              completed: false,
              updatedAt: new Date(1700000000000 + index),
            })),
          )
          const env = createTestOfflineEnvironment({
            mutationFn: async (params) => {
              const index = calls.length
              const mutations = params.transaction.mutations
              calls.push({
                id: params.transaction.id,
                rows: mutations.map((mutation) =>
                  structuredClone(mutation.modified),
                ),
              })
              if (!entered[index])
                throw new NonRetriableError(`Unexpected extra execution`)
              entered[index].resolve()
              await release[index]!.promise
              if (!succeeds[index]) throw failures[index]
              env.applyMutations(mutations)
            },
          })
          const ids: Array<string> = []
          const expectedServer = new Map<string, TestItem>()
          const assertState = async (completed: number) => {
            expect(calls).toEqual(
              ids
                .slice(0, Math.min(completed + 1, ids.length))
                .map((id, index) => ({ id, rows: expectedRows[index] })),
            )
            const actualStatuses = Object.fromEntries(
              Object.entries(statuses).map(([name, status]) => [
                name,
                status instanceof Error ? status.message : status,
              ]),
            )
            const expectedStatuses = Object.fromEntries(
              ids.flatMap((_id, index) => {
                const status =
                  index < completed
                    ? succeeds[index]
                      ? `fulfilled`
                      : failures[index]!.message
                    : `pending`
                return [
                  [`commit-${index}`, status],
                  [`wait-${index}`, status],
                ]
              }),
            )
            expect(actualStatuses).toEqual(expectedStatuses)
            if (completed === 1) {
              expect(() =>
                expect({ ...actualStatuses, 'wait-1': `fulfilled` }).toEqual(
                  expectedStatuses,
                ),
              ).toThrowError(
                expect.objectContaining({ name: `AssertionError` }),
              )
            }
            for (let index = 0; index < completed; index++) {
              if (!succeeds[index]) {
                expect(statuses[`commit-${index}`]).toBe(failures[index])
                expect(statuses[`wait-${index}`]).toBe(failures[index])
              }
            }
            expect(env.serverState).toEqual(expectedServer)
            // Queued offline transactions already contributed optimistic state.
            // A sibling's failed insert does not remove it.
            const expectedLocal = new Map(expectedServer)
            for (const rows of expectedRows.slice(completed))
              for (const row of rows) expectedLocal.set(row.id, row)
            expectLocalRows(env.collection.toArray, expectedLocal.values())
            if (completed === 1) {
              const wrong = localRows(env.collection.toArray)
              if (wrong.length > 0) wrong[0]!.completed = !wrong[0]!.completed
              else wrong.push(expectedRows[0]![0]!)
              expect(() =>
                expectLocalRows(wrong, expectedLocal.values()),
              ).toThrowError(
                expect.objectContaining({ name: `AssertionError` }),
              )
            }
            expect(
              (await env.executor.peekOutbox()).map((tx) => tx.id),
            ).toEqual(ids.slice(completed))
          }
          let hasPrimaryFailure = false
          try {
            await env.waitForLeader()
            for (let index = 0; index < succeeds.length; index++) {
              const tx = env.executor.createOfflineTransaction({
                mutationFnName: env.mutationFnName,
                autoCommit: false,
              })
              ids.push(tx.id)
              observe(
                `wait-${index}`,
                env.executor.waitForTransactionCompletion(tx.id),
              )
              tx.mutate(() => {
                for (const row of expectedRows[index]!) {
                  if (sharedKeys && index > 0) {
                    env.collection.update(row.id, (draft) => {
                      draft.value = row.value
                      draft.updatedAt = row.updatedAt
                    })
                  } else env.collection.insert(row)
                }
              })
              observe(`commit-${index}`, tx.commit())
              if (index === 0)
                await atOracleCheckpoint(
                  entered[0]!.promise,
                  `first provider entered`,
                )
            }
            // Drain enqueue continuations with the first real provider still held.
            await turn()
            await assertState(0)
            for (let index = 0; index < succeeds.length; index++) {
              release[index]!.resolve()
              if (index + 1 < succeeds.length)
                await atOracleCheckpoint(
                  entered[index + 1]!.promise,
                  `provider ${index + 1} entered`,
                )
              else
                await atOracleCheckpoint(
                  Promise.all(observed),
                  `all transactions settled`,
                )
              await turn()
              if (succeeds[index])
                for (const row of expectedRows[index]!)
                  expectedServer.set(row.id, row)
              await assertState(index + 1)
            }
          } catch (error) {
            hasPrimaryFailure = true
            throw error
          } finally {
            for (const item of release) item.resolve()
            await cleanupOfflineOracle(
              [
                () => Promise.all(observed),
                () => env.executor.dispose(),
                () => env.collection.cleanup(),
              ],
              hasPrimaryFailure,
            )
          }
        },
      ),
      {
        ...oracleOptions(settlementOracle, seed),
        examples: [
          [{ sharedKeys: true, width: 1, outcomes: [true, true] }],
          [{ sharedKeys: false, width: 2, outcomes: [true, false, true] }],
          [{ sharedKeys: true, width: 2, outcomes: [false, false, false] }],
          [{ sharedKeys: true, width: 1, outcomes: [false, true, false] }],
        ],
      },
    )
  },
)

it.each([
  { sharedKey: false, failedIndex: 0 },
  { sharedKey: false, failedIndex: 1 },
  { sharedKey: true, failedIndex: 0 },
  { sharedKey: true, failedIndex: 1 },
])(
  `restores whole snapshots across sibling rollback (shared=$sharedKey, failure=$failedIndex)`,
  async ({ sharedKey, failedIndex }) => {
    const rows: Array<TestItem> = [0, 1, 2].map((index) => ({
      id: sharedKey ? `same` : `row-${index}`,
      value: index === 0 ? `initial` : `edited`,
      completed: index === 2,
      updatedAt: new Date(1700000000000),
    }))
    // Seed real serialized mutations, not a second executor with ambiguous
    // in-flight-disposal semantics. No encoder output defines expected rows.
    const storage = new FakeStorageAdapter()
    const seed = createCollection<TestItem, string>({
      id: `test-items`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (ops) => {
          ops.markReady()
        },
      },
    })
    const outbox = new OutboxManager(storage, { [seed.id]: seed })
    const rollbackSeeds: Array<() => void> = []
    try {
      for (const [index, row] of rows.entries()) {
        const tx = createTransaction({
          autoCommit: false,
          mutationFn: () => Promise.resolve(),
        })
        rollbackSeeds.push(() => {
          tx.rollback({ isSecondaryRollback: true })
        })
        void tx.isPersisted.promise.catch(() => {})
        tx.mutate(() => {
          if (sharedKey && index > 0)
            seed.update(row.id, (draft) => {
              if (index === 1) draft.value = row.value
              else draft.completed = row.completed
            })
          else seed.insert(row)
        })
        await outbox.add({
          id: `restored-${index}`,
          mutationFnName: `syncData`,
          mutations: tx.mutations,
          keys: tx.mutations.map(({ globalKey }) => globalKey),
          idempotencyKey: `restore-${index}`,
          createdAt: new Date(1700000000000 + index),
          retryCount: 0,
          nextAttemptAt: 0,
          version: 1,
        })
      }
    } finally {
      for (const rollback of rollbackSeeds) rollback()
      await seed.cleanup()
    }

    const entered = rows.map(() => gate())
    const released = rows.map(() => gate())
    const failure = new NonRetriableError(`restored permanent failure`)
    const outcomes: Array<unknown> = rows.map(() => `pending`)
    const waits: Array<Promise<void>> = []
    const calls: Array<{ id: string; rows: Array<Record<string, unknown>> }> =
      []
    const env = createTestOfflineEnvironment({
      storage,
      mutationFn: async (params) => {
        const index = calls.length
        const mutations = params.transaction.mutations
        calls.push({
          id: params.transaction.id,
          rows: mutations.map((mutation) => structuredClone(mutation.modified)),
        })
        if (!entered[index]) throw new NonRetriableError(`unexpected replay`)
        entered[index].resolve()
        await released[index]!.promise
        if (index === failedIndex) throw failure
        env.applyMutations(mutations)
      },
    })
    const expectedServer = new Map<string, TestItem>()
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      for (const index of rows.keys())
        waits.push(
          env.executor.waitForTransactionCompletion(`restored-${index}`).then(
            () => {
              outcomes[index] = `fulfilled`
            },
            (error: unknown) => {
              outcomes[index] = error
            },
          ),
        )
      await atOracleCheckpoint(entered[0]!.promise, `restored provider entered`)
      expectLocalRows(env.collection.toArray, sharedKey ? [rows[2]!] : rows)
      for (const index of rows.keys()) {
        released[index]!.resolve()
        await atOracleCheckpoint(waits[index]!, `restored ${index} settled`)
        if (index < 2)
          await atOracleCheckpoint(
            entered[index + 1]!.promise,
            `restored sibling still held`,
          )
        await turn()
        if (index !== failedIndex)
          expectedServer.set(rows[index]!.id, rows[index]!)
        // Restoration holds pending snapshots. Core rollback cancels conflicting
        // pending peers, but not disjoint peers or their independently queued work.
        const pending =
          sharedKey && index >= failedIndex ? [] : rows.slice(index + 1)
        const expected = new Map(expectedServer)
        for (const row of pending) expected.set(row.id, row)
        expectLocalRows(env.collection.toArray, expected.values())
        if (index === failedIndex) {
          const wrong = localRows(env.collection.toArray)
          if (wrong.length > 0) wrong.pop()
          else wrong.push(rows[0]!)
          expect(() => expectLocalRows(wrong, expected.values())).toThrowError(
            expect.objectContaining({ name: `AssertionError` }),
          )
        }
        expect(env.serverState).toEqual(expectedServer)
        expect(calls).toEqual(
          rows
            .slice(0, Math.min(index + 2, 3))
            .map((row, call) => ({ id: `restored-${call}`, rows: [row] })),
        )
        expect(outcomes).toEqual(
          rows.map((_row, position) =>
            position > index
              ? `pending`
              : position === failedIndex
                ? failure
                : `fulfilled`,
          ),
        )
        if (index >= failedIndex) expect(outcomes[failedIndex]).toBe(failure)
        expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual(
          rows
            .slice(index + 1)
            .map((_row, offset) => `restored-${index + 1 + offset}`),
        )
      }
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      released.forEach((item) => item.resolve())
      await cleanupOfflineOracle(
        [
          () => Promise.all(waits),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

const retryErrorKinds = [
  `auth`,
  `ordinary`,
  `abort`,
  `bad-request`,
  `forbidden`,
  `unprocessable`,
  `not-found`,
  `permanent`,
] as const
const retryHookAnswers = [`retry`, `terminal`, `defer`, `absent`] as const
const retryDecisionCases = retryErrorKinds.flatMap((errorKind) =>
  retryHookAnswers.map((hook) => ({ errorKind, hook })),
)

type RetryDecisionCase = (typeof retryDecisionCases)[number]
type RetryErrorKind = (typeof retryErrorKinds)[number]
const retryDecisionExamples: Array<[RetryDecisionCase, number]> = [
  ...retryDecisionCases.map((scenario): [RetryDecisionCase, number] => [
    scenario,
    1,
  ]),
  [{ errorKind: `auth`, hook: `retry` }, 3],
]
// fast-check counts examples against numRuns. Reserve a run for every fixed
// cell, then use the configured budget for generated peer-count combinations.
const retryDecisionRuns =
  retryDecisionExamples.length + retryDecisionOracle.runs

// This table is the contract model, not a copy of the executor. The permanent
// error has no configurable decision. Otherwise an explicit hook answer wins;
// delegation uses the established default classifications below. This table
// comes from the exported default's documented behavior, not its classifier.
// A retained FIFO head permits no peer call; removal permits the first one.
const defaultRetryDecision: Record<RetryErrorKind, boolean> = {
  auth: false,
  ordinary: true,
  abort: false,
  'bad-request': false,
  forbidden: false,
  unprocessable: false,
  'not-found': true,
  permanent: false,
}

function expectedRetryDecision(
  scenario: RetryDecisionCase,
  headId: string,
  peerIds: Array<string>,
  providerError: Error,
) {
  const retry =
    scenario.errorKind !== `permanent` &&
    (scenario.hook === `retry` ||
      ((scenario.hook === `defer` || scenario.hook === `absent`) &&
        defaultRetryDecision[scenario.errorKind]))
  const peerRows = peerIds.map((_id, index) => `peer-${index}`)
  return {
    retry,
    calls: retry ? [headId] : [headId, peerIds[0]!],
    outbox: retry
      ? [
          { id: headId, retryCount: 1 },
          ...peerIds.map((id) => ({ id, retryCount: 0 })),
        ]
      : peerIds.map((id) => ({ id, retryCount: 0 })),
    headStatus: retry ? `pending` : providerError,
    localRows: retry ? [`head`, ...peerRows] : peerRows,
  }
}

function retryDecisionProviderError(kind: RetryErrorKind): Error {
  if (kind === `permanent`) return new NonRetriableError(`validation rejected`)
  const messages: Record<Exclude<RetryErrorKind, `permanent`>, string> = {
    auth: `HTTP 401 Unauthorized`,
    ordinary: `temporary connection failure`,
    abort: `request aborted`,
    'bad-request': `HTTP 400 Bad Request`,
    forbidden: `HTTP 403 Forbidden`,
    unprocessable: `HTTP 422 Unprocessable`,
    'not-found': `HTTP 404 Not Found`,
  }
  const error = new Error(messages[kind])
  if (kind === `abort`) error.name = `AbortError`
  return error
}

// Legal histories have one failed FIFO head and 1–3 admitted peers. Every
// listed error kind crosses explicit retry, explicit terminal, delegation, and
// absence. The fixed examples reconstruct all 32 cells; the generated campaign
// varies peer count. Auth and ordinary cross both explicit answers, so treating
// false as delegation or ignoring true changes the durable decision cut. Abort
// and four status classes preserve default boundaries, while 404 is the nearby
// default-retry control. Permanent failure bypasses every hook answer. One peer
// is the marginal FIFO witness; three detect loss of a later admitted peer.
// A second failure and malformed hook result have separate witnesses below.
// Duplicate IDs and storage failures belong to other settlement grammars here.
// After each normal campaign, the reach check proves that fast-check executed
// every fixed cell. A seed-and-path replay runs only its requested history.
it.each(oracleSeeds(20261008, retryDecisionOracle))(
  `refines an optional retry decision at the durable FIFO checkpoint (seed %s)`,
  async (seed) => {
    const reachedCases = new Set<string>()
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...retryDecisionCases),
        fc.integer({ min: 1, max: 3 }),
        async (scenario, peerCount) => {
          reachedCases.add(`${scenario.errorKind}:${scenario.hook}`)
          const providerError = retryDecisionProviderError(scenario.errorKind)
          const firstEntered = gate()
          const releaseFirst = gate()
          const firstPeerEntered = gate()
          const releaseFirstPeer = gate()
          const peersAdmitted = gate()
          const decisionStored = gate()
          let headId = ``
          const peerIds: Array<string> = []
          const admittedPeers = new Set<string>()
          const calls: Array<string> = []
          const hookCalls: Array<{ error: Error; retryCount: number }> = []
          let headAttempts = 0
          let storedDecision: `retry` | `terminal` | undefined
          class DecisionStorage extends FakeStorageAdapter {
            override async set(key: string, value: string): Promise<void> {
              await super.set(key, value)
              if (peerIds.some((id) => key === `tx:${id}`)) {
                admittedPeers.add(key)
                if (admittedPeers.size === peerCount) peersAdmitted.resolve()
              }
              if (
                key === `tx:${headId}` &&
                (JSON.parse(value) as { retryCount: number }).retryCount === 1
              ) {
                storedDecision = `retry`
                decisionStored.resolve()
              }
            }

            override async delete(key: string): Promise<void> {
              await super.delete(key)
              if (key === `tx:${headId}`) {
                storedDecision = `terminal`
                decisionStored.resolve()
              }
            }
          }
          const shouldRetry: NonNullable<OfflineConfig['shouldRetry']> = (
            error: Error,
            retryCount: number,
          ): boolean | undefined => {
            hookCalls.push({ error, retryCount })
            if (scenario.hook === `defer`) return undefined
            return scenario.hook === `retry`
          }
          const config =
            scenario.hook === `absent`
              ? { jitter: false }
              : { jitter: false, shouldRetry }
          const env = createTestOfflineEnvironment({
            storage: new DecisionStorage(),
            config,
            mutationFn: async (params) => {
              const id = params.transaction.id
              calls.push(id)
              if (id === headId && headAttempts++ === 0) {
                firstEntered.resolve()
                await releaseFirst.promise
                throw providerError
              }
              if (id === peerIds[0]) {
                firstPeerEntered.resolve()
                await releaseFirstPeer.promise
              }
              env.applyMutations(params.transaction.mutations)
            },
          })
          const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
          let headCommitStatus: unknown = `pending`
          let headWaitStatus: unknown = `pending`
          const peerStatuses: Array<unknown> = []
          const observed: Array<Promise<void>> = []
          let hasPrimaryFailure = false
          try {
            await env.waitForLeader()
            const head = env.executor.createOfflineTransaction({
              mutationFnName: env.mutationFnName,
              autoCommit: false,
            })
            headId = head.id
            observed.push(
              env.executor.waitForTransactionCompletion(headId).then(
                () => {
                  headWaitStatus = `fulfilled`
                },
                (error: unknown) => {
                  headWaitStatus = error
                },
              ),
            )
            head.mutate(() =>
              env.collection.insert({
                id: `head`,
                value: `head`,
                completed: false,
                updatedAt: new Date(0),
              }),
            )
            observed.push(
              head.commit().then(
                () => {
                  headCommitStatus = `fulfilled`
                },
                (error: unknown) => {
                  headCommitStatus = error
                },
              ),
            )
            await atOracleCheckpoint(
              firstEntered.promise,
              `head provider entered`,
            )

            for (let index = 0; index < peerCount; index++) {
              const peer = env.executor.createOfflineTransaction({
                mutationFnName: env.mutationFnName,
                autoCommit: false,
              })
              peerIds.push(peer.id)
              peer.mutate(() =>
                env.collection.insert({
                  id: `peer-${index}`,
                  value: `peer-${index}`,
                  completed: false,
                  updatedAt: new Date(index + 1),
                }),
              )
              peerStatuses[index] = `pending`
              observed.push(
                peer.commit().then(
                  () => {
                    peerStatuses[index] = `fulfilled`
                  },
                  (error: unknown) => {
                    peerStatuses[index] = error
                  },
                ),
              )
            }
            await atOracleCheckpoint(peersAdmitted.promise, `peers admitted`)

            // The provider failure occurs with later work already durable.
            // Observe only after the head's retry record or deletion settles.
            const releasedAt = Date.now()
            releaseFirst.resolve()
            await atOracleCheckpoint(
              decisionStored.promise,
              `head decision stored`,
            )
            const expected = expectedRetryDecision(
              scenario,
              headId,
              peerIds,
              providerError,
            )
            expect(storedDecision).toBe(expected.retry ? `retry` : `terminal`)
            if (!expected.retry)
              await atOracleCheckpoint(
                firstPeerEntered.promise,
                `terminal decision admitted peer`,
              )
            await turn()
            // These public observations distinguish retaining the head from
            // removing it, including per-ID settlement and optimistic state.
            expect(calls).toEqual(expected.calls)
            expect(
              (await env.executor.peekOutbox()).map(({ id, retryCount }) => ({
                id,
                retryCount,
              })),
            ).toEqual(expected.outbox)
            expect(headCommitStatus).toBe(expected.headStatus)
            expect(headWaitStatus).toBe(expected.headStatus)
            expect(peerStatuses).toEqual(peerIds.map(() => `pending`))
            expect(env.collection.toArray.map(({ id }) => id).sort()).toEqual(
              expected.localRows,
            )
            expect(env.serverState.size).toBe(0)
            expect(hookCalls).toEqual(
              scenario.hook === `absent` || scenario.errorKind === `permanent`
                ? []
                : [{ error: providerError, retryCount: 0 }],
            )
            if (hookCalls.length > 0)
              expect(hookCalls[0]!.error).toBe(providerError)
            if (expected.retry) {
              const [record] = await env.executor.peekOutbox()
              expect(record?.lastError?.message).toBe(providerError.message)
              expect(record!.nextAttemptAt).toBeGreaterThan(releasedAt)
            }

            releaseFirstPeer.resolve()
            if (expected.retry) env.executor.getOnlineDetector().notifyOnline()
            await atOracleCheckpoint(
              Promise.all(observed),
              `retry decision history settled`,
            )
            expect(headCommitStatus).toBe(
              expected.retry ? `fulfilled` : providerError,
            )
            expect(headWaitStatus).toBe(headCommitStatus)
            expect(peerStatuses).toEqual(peerIds.map(() => `fulfilled`))
            expect(calls).toEqual(
              expected.retry
                ? [headId, headId, ...peerIds]
                : [headId, ...peerIds],
            )
            expect(await env.executor.peekOutbox()).toEqual([])
            expect([...env.serverState.keys()].sort()).toEqual(
              expected.localRows,
            )
          } catch (error) {
            hasPrimaryFailure = true
            throw error
          } finally {
            releaseFirst.resolve()
            releaseFirstPeer.resolve()
            const cleanupError = new Error(`retry decision oracle cleanup`)
            if (
              headId &&
              (headCommitStatus === `pending` || headWaitStatus === `pending`)
            )
              env.executor.rejectTransaction(headId, cleanupError)
            for (const [index, id] of peerIds.entries())
              if (peerStatuses[index] === `pending`)
                env.executor.rejectTransaction(id, cleanupError)
            await cleanupOfflineOracle(
              [
                () => Promise.all(observed),
                () => env.executor.dispose(),
                () => env.collection.cleanup(),
                () => warning.mockRestore(),
              ],
              hasPrimaryFailure,
            )
          }
        },
      ),
      {
        ...oracleOptions(retryDecisionOracle, seed),
        numRuns: retryDecisionRuns,
        examples: retryDecisionExamples,
      },
    )
    if (retryDecisionOracle.path === undefined)
      expect([...reachedCases].sort()).toEqual(
        retryDecisionCases
          .map(({ errorKind, hook }) => `${errorKind}:${hook}`)
          .sort(),
      )
  },
)

// The no-hook run is the reference for existing retry timing. With the same
// retry count, ordinary Error, disabled jitter, and clock, adding a true hook
// may change the decision path but not the durable deadline. Comparing outbox
// records leaves the choice of delay implementation to production.
it(`preserves the default retry deadline when the hook agrees`, async () => {
  const fixedNow = 1_000_000
  const providerError = new Error(`temporary connection failure`)
  const hookCalls: Array<{ error: Error; retryCount: number }> = []
  const clock = vi.spyOn(Date, `now`).mockReturnValue(fixedNow)
  const signaler: TransactionSignaler = {
    isOfflineEnabled: true,
    isOnline: () => true,
    resolveTransaction: () => {
      throw new Error(`failed provider cannot resolve`)
    },
    rejectTransaction: () => {
      throw new Error(`ordinary failure should retry`)
    },
    registerRestorationTransaction: () => {},
  }
  const observeDeadline = async (withHook: boolean): Promise<number> => {
    const outbox = new OutboxManager(new FakeStorageAdapter(), {})
    const executor = new TransactionExecutor(
      new KeyScheduler(),
      outbox,
      {
        collections: {},
        mutationFns: {
          syncData: () => Promise.reject(providerError),
        },
        jitter: false,
        ...(withHook
          ? {
              shouldRetry: (error: Error, retryCount: number) => {
                hookCalls.push({ error, retryCount })
                return true
              },
            }
          : {}),
      },
      signaler,
    )
    const transaction: OfflineTransaction = {
      id: withHook ? `hooked-deadline` : `default-deadline`,
      mutationFnName: `syncData`,
      mutations: [],
      keys: [],
      idempotencyKey: withHook ? `hooked-deadline` : `default-deadline`,
      createdAt: new Date(0),
      retryCount: 0,
      nextAttemptAt: 0,
      version: 1,
    }
    await outbox.add(transaction)
    try {
      await atOracleCheckpoint(
        executor.execute(transaction),
        `retry deadline ${withHook ? `with` : `without`} hook`,
      )
      const stored = await outbox.get(transaction.id)
      expect(stored).toMatchObject({ retryCount: 1 })
      return stored!.nextAttemptAt
    } finally {
      executor.pause()
    }
  }

  try {
    const defaultDeadline = await observeDeadline(false)
    const hookedDeadline = await observeDeadline(true)
    expect(defaultDeadline).toBeGreaterThan(fixedNow)
    expect(hookedDeadline).toBe(defaultDeadline)
    expect(hookCalls).toEqual([{ error: providerError, retryCount: 0 }])
    expect(hookCalls[0]?.error).toBe(providerError)
  } finally {
    clock.mockRestore()
  }
})

// Two ordinary provider failures are a legal history. The first explicit
// answer keeps the head. On the second failure, false removes it while
// undefined delegates to the default and keeps it for a third attempt. The
// distinct Errors expose a stale-error decision at the second durable cut.
it.each([`terminal`, `defer`] as const)(
  `passes the second error and retry count to the decision hook (%s)`,
  async (secondDecision) => {
    const firstError = new Error(`temporary first failure`)
    const secondError = new Error(`temporary second failure`)
    const firstRetryStored = gate()
    const secondDecisionStored = gate()
    const hookCalls: Array<{ error: Error; retryCount: number }> = []
    let transactionId = ``
    class DecisionStorage extends FakeStorageAdapter {
      override async set(key: string, value: string): Promise<void> {
        await super.set(key, value)
        if (key !== `tx:${transactionId}`) return
        const record = JSON.parse(value) as { retryCount: number }
        if (record.retryCount === 1) firstRetryStored.resolve()
        if (record.retryCount === 2) secondDecisionStored.resolve()
      }

      override async delete(key: string): Promise<void> {
        await super.delete(key)
        if (key === `tx:${transactionId}`) secondDecisionStored.resolve()
      }
    }
    const config = {
      jitter: false,
      shouldRetry: (error: Error, retryCount: number): boolean | undefined => {
        hookCalls.push({ error, retryCount })
        if (retryCount === 0) return true
        return secondDecision === `terminal` ? false : undefined
      },
    }
    const env = createTestOfflineEnvironment({
      storage: new DecisionStorage(),
      config,
      mutationFn: (params) => {
        const attempt = env.mutationCalls.length
        if (attempt === 1) throw firstError
        if (attempt === 2) throw secondError
        env.applyMutations(params.transaction.mutations)
      },
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let commitStatus: unknown = `pending`
    let waitStatus: unknown = `pending`
    const observed: Array<Promise<void>> = []
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      const tx = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      transactionId = tx.id
      const observedWait = env.executor
        .waitForTransactionCompletion(tx.id)
        .then(
          () => {
            waitStatus = `fulfilled`
          },
          (error: unknown) => {
            waitStatus = error
          },
        )
      tx.mutate(() =>
        env.collection.insert({
          id: `retry-count`,
          value: `pending`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      const observedCommit = tx.commit().then(
        () => {
          commitStatus = `fulfilled`
        },
        (error: unknown) => {
          commitStatus = error
        },
      )
      observed.push(observedCommit, observedWait)
      await atOracleCheckpoint(firstRetryStored.promise, `first retry stored`)
      expect((await env.executor.peekOutbox())[0]?.retryCount).toBe(1)
      expect(commitStatus).toBe(`pending`)
      expect(waitStatus).toBe(`pending`)

      await turn()
      env.executor.getOnlineDetector().notifyOnline()
      await atOracleCheckpoint(
        secondDecisionStored.promise,
        `second decision stored`,
      )
      await turn()
      expect(hookCalls).toEqual([
        { error: firstError, retryCount: 0 },
        { error: secondError, retryCount: 1 },
      ])
      expect(hookCalls[0]?.error).toBe(firstError)
      expect(hookCalls[1]?.error).toBe(secondError)
      expect(env.mutationCalls).toHaveLength(2)
      if (secondDecision === `defer`) {
        expect(await env.executor.peekOutbox()).toMatchObject([
          { id: tx.id, retryCount: 2 },
        ])
        expect(commitStatus).toBe(`pending`)
        expect(waitStatus).toBe(`pending`)
        env.executor.getOnlineDetector().notifyOnline()
        await atOracleCheckpoint(
          Promise.all([observedCommit, observedWait]),
          `delegated second retry settled caller`,
        )
        expect(env.mutationCalls).toHaveLength(3)
        expect(commitStatus).toBe(`fulfilled`)
        expect(waitStatus).toBe(`fulfilled`)
        expect(await env.executor.peekOutbox()).toEqual([])
      } else {
        expect(await env.executor.peekOutbox()).toEqual([])
        await atOracleCheckpoint(
          Promise.all([observedCommit, observedWait]),
          `second failure settled caller`,
        )
        expect(commitStatus).toBe(secondError)
        expect(waitStatus).toBe(secondError)
      }
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      if (
        transactionId &&
        (commitStatus === `pending` || waitStatus === `pending`)
      )
        env.executor.rejectTransaction(
          transactionId,
          new Error(`retry count oracle cleanup`),
        )
      await cleanupOfflineOracle(
        [
          () => Promise.all(observed),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
          () => warning.mockRestore(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

// The public hook always receives an Error, including when the named mutation
// function rejects with a primitive or object. Returning false distinguishes
// this hook decision from the default retry for these inputs. The public commit
// rejection must be the same converted Error observed by the hook.
it.each([
  { label: `string`, rejection: `network disconnected` },
  { label: `object`, rejection: { status: 401 } },
])(
  `passes a converted Error to shouldRetry for a $label rejection`,
  async ({ rejection }) => {
    const hookCalls: Array<{ error: Error; retryCount: number }> = []
    const env = createTestOfflineEnvironment({
      config: {
        shouldRetry: (error, retryCount) => {
          hookCalls.push({ error, retryCount })
          return false
        },
      },
      mutationFn: () => Promise.reject(rejection),
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let transactionId = ``
    let observedCommit: Promise<void> | undefined
    let commitStatus: unknown = `pending`
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      const tx = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      transactionId = tx.id
      tx.mutate(() =>
        env.collection.insert({
          id: `converted-error`,
          value: `pending`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      observedCommit = tx.commit().then(
        () => {
          commitStatus = `fulfilled`
        },
        (error: unknown) => {
          commitStatus = error
        },
      )
      await atOracleCheckpoint(
        observedCommit,
        `non-Error rejection settled caller`,
      )
      expect(hookCalls).toEqual([{ error: expect.any(Error), retryCount: 0 }])
      expect(hookCalls[0]?.error).not.toBe(rejection)
      expect(commitStatus).toBe(hookCalls[0]?.error)
      expect(await env.executor.peekOutbox()).toEqual([])
      expect(env.collection.toArray).toEqual([])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      if (transactionId && commitStatus === `pending`)
        env.executor.rejectTransaction(
          transactionId,
          new Error(`non-Error rejection oracle cleanup`),
        )
      await cleanupOfflineOracle(
        [
          () => observedCommit,
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
          () => warning.mockRestore(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

// A configuration failure is observed through public commit(), not only the
// executor's internal batch promise. The provider error is a 401, so ignoring
// the hook would reject with the provider error. A Promise is invalid whether
// it fulfills or rejects; its later rejection must stay within this row-local
// failure boundary rather than become an unhandled process rejection. A fresh
// executor over the same storage must skip the failed row.
it.each([
  `throw`,
  `null`,
  `zero`,
  `promise-fulfilled`,
  `promise-rejected`,
] as const)(
  `rejects public commit when shouldRetry fails (%s)`,
  async (failureKind) => {
    const providerError = new Error(`HTTP 401 Unauthorized`)
    const hookError = new Error(`retry decision unavailable`)
    const asyncError = new Error(`async retry decision failed`)
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    const providerEntered = gate()
    const releaseProvider = gate()
    const terminalMarkerStored = gate()
    const retryRecordStored = gate()
    let hookCalls = 0
    let transactionId = ``
    class DecisionStorage extends FakeStorageAdapter {
      override async set(key: string, value: string): Promise<void> {
        await super.set(key, value)
        if (key !== `tx:${transactionId}`) return
        const record = JSON.parse(value) as {
          outboxPhase?: string
          retryCount: number
        }
        if (record.outboxPhase === `rejection-pending`)
          terminalMarkerStored.resolve()
        if (record.retryCount === 1) retryRecordStored.resolve()
      }
    }
    const config = {
      jitter: false,
      shouldRetry: (
        _error: Error,
        _retryCount: number,
      ): boolean | undefined => {
        hookCalls++
        if (failureKind === `throw`) throw hookError
        if (failureKind === `null`)
          return null as unknown as boolean | undefined
        if (failureKind === `zero`) return 0 as unknown as boolean | undefined
        // An async hook returns a Promise. Neither outcome is a synchronous
        // retry decision, and a rejection must still be observed.
        return (failureKind === `promise-rejected`
          ? Promise.reject(asyncError)
          : Promise.resolve(true)) as unknown as boolean | undefined
      },
    }
    const storage = new DecisionStorage()
    const env = createTestOfflineEnvironment({
      storage,
      config,
      mutationFn: async () => {
        providerEntered.resolve()
        await releaseProvider.promise
        throw providerError
      },
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let restarted: ReturnType<typeof createTestOfflineEnvironment> | undefined
    let commitStatus: unknown = `pending`
    let hasPrimaryFailure = false
    try {
      process.on(`unhandledRejection`, onUnhandled)
      await env.waitForLeader()
      const tx = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      transactionId = tx.id
      tx.mutate(() =>
        env.collection.insert({
          id: `invalid-decision`,
          value: `pending`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      const observedCommit = tx.commit().then(
        () => {
          commitStatus = `fulfilled`
        },
        (error: unknown) => {
          commitStatus = error
        },
      )
      await atOracleCheckpoint(providerEntered.promise, `provider entered`)
      const [admitted] = await env.executor.peekOutbox()
      expect(admitted?.retryCount).toBe(0)
      releaseProvider.resolve()
      // The first durable decision must be terminal. A mistaken implementation
      // that awaits a Promise answer stores a retry record instead of a marker.
      const storedDecision = await atOracleCheckpoint(
        Promise.race([
          terminalMarkerStored.promise.then(() => `terminal` as const),
          retryRecordStored.promise.then(() => `retry` as const),
        ]),
        `invalid decision recorded`,
      )
      expect(storedDecision).toBe(`terminal`)
      await atOracleCheckpoint(
        observedCommit,
        `invalid decision settled caller`,
      )

      if (failureKind === `throw`) expect(commitStatus).toBe(hookError)
      else {
        expect(commitStatus).toBeInstanceOf(TypeError)
        expect(commitStatus).not.toBe(providerError)
      }
      expect(hookCalls).toBe(1)
      const remaining = await env.executor.peekOutbox()
      await turn()
      expect(unhandled).toEqual([])
      expect(env.executor.getRunningCount()).toBe(0)
      expect(env.mutationCalls).toHaveLength(1)
      expect(env.collection.toArray).toEqual([])

      env.executor.dispose()
      restarted = createTestOfflineEnvironment({
        storage,
        mutationFn: (params) => {
          restarted!.applyMutations(params.transaction.mutations)
        },
      })
      await restarted.waitForLeader()
      const fresh = restarted.executor.createOfflineTransaction({
        mutationFnName: restarted.mutationFnName,
        autoCommit: false,
      })
      fresh.mutate(() =>
        restarted!.collection.insert({
          id: `after-hook-failure`,
          value: `fresh`,
          completed: false,
          updatedAt: new Date(1),
        }),
      )
      await atOracleCheckpoint(fresh.commit(), `fresh work after hook failure`)
      // The new transaction proves that restart has passed the FIFO head.
      // A retained failed row would have called the provider before this one.
      expect(
        restarted.mutationCalls.map(({ transaction: { id } }) => id),
      ).toEqual([fresh.id])
      expect(remaining).toEqual([])
      expect(await restarted.executor.peekOutbox()).toEqual([])
      expect(restarted.collection.toArray.map(({ id }) => id)).toEqual([
        `after-hook-failure`,
      ])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseProvider.resolve()
      if (transactionId && commitStatus === `pending`)
        env.executor.rejectTransaction(
          transactionId,
          new Error(`invalid decision oracle cleanup`),
        )
      await cleanupOfflineOracle(
        [
          () => env.executor.dispose(),
          () => restarted?.executor.dispose(),
          () => env.collection.cleanup(),
          () => restarted?.collection.cleanup(),
          () => warning.mockRestore(),
          () => process.off(`unhandledRejection`, onUnhandled),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

// The model treats an acknowledged peer write as queued work. The hook fault
// belongs to the head row; a peer admitted before or during terminal cleanup
// stays pending until the head's deletion acknowledges and its provider runs.
// This relation does not copy the executor's queue or cleanup machinery.
function expectedHookFaultPeerAtHeldCleanup(): {
  durable: true
  outcome: `pending`
} {
  return { durable: true, outcome: `pending` }
}

function observedFaultAdmissionOutcome(value: unknown) {
  if (value instanceof Error) return `rejected`
  return value
}

// Legal history: the FIFO head enters its named mutation function, one peer
// becomes durable, then the hook throws or returns an invalid result. Storage
// holds the terminal marker read, write, or deletion while a second public commit
// joins the queue. The held cut compares settlement, exact outbox contents,
// provider calls, and optimistic rows. After deletion, both peers must run in
// FIFO order in this executor. The held Promise rejects only after both peers
// settle, so its later failure must not escape as an unhandled process
// rejection. No storage write fails.
it.each([
  [`throw`, `marker`],
  [`throw`, `read`],
  [`throw`, `deletion`],
  [`invalid`, `marker`],
  [`invalid`, `read`],
  [`invalid`, `deletion`],
  [`promise-late-rejection`, `deletion`],
] as const)(
  `admits queued work during %s hook failure and %s cleanup`,
  async (failureKind, heldStep) => {
    const providerError = new Error(`HTTP 401 Unauthorized`)
    const hookError = new Error(`retry decision failed`)
    const asyncError = new Error(`async retry decision failed`)
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    const providerEntered = gate()
    const releaseProvider = gate()
    const hookEntered = gate()
    const preFaultStored = gate()
    const terminalCleanupEntered = gate()
    const releaseTerminalCleanup = gate()
    const postFaultStored = gate()
    let headId = ``
    let preFaultId = ``
    let postFaultId = ``
    let holdTerminalRead = false
    let asyncDecision: Promise<boolean> | undefined
    let rejectAsyncDecision: ((error: Error) => void) | undefined
    let lateDecisionRejected = false
    const providerCalls: Array<string> = []

    class HeldTerminalDeleteStorage extends FakeStorageAdapter {
      override async get(key: string): Promise<string | null> {
        if (heldStep === `read` && key === `tx:${headId}` && holdTerminalRead) {
          holdTerminalRead = false
          terminalCleanupEntered.resolve()
          await releaseTerminalCleanup.promise
        }
        return super.get(key)
      }

      override async set(key: string, value: string): Promise<void> {
        if (
          heldStep === `marker` &&
          key === `tx:${headId}` &&
          (JSON.parse(value) as { outboxPhase?: string }).outboxPhase ===
            `rejection-pending`
        ) {
          terminalCleanupEntered.resolve()
          await releaseTerminalCleanup.promise
        }
        await super.set(key, value)
        if (key === `tx:${preFaultId}`) preFaultStored.resolve()
        if (key === `tx:${postFaultId}`) postFaultStored.resolve()
      }

      override async delete(key: string): Promise<void> {
        if (heldStep === `deletion` && key === `tx:${headId}`) {
          terminalCleanupEntered.resolve()
          await releaseTerminalCleanup.promise
        }
        await super.delete(key)
      }
    }

    const env = createTestOfflineEnvironment({
      storage: new HeldTerminalDeleteStorage(),
      config: {
        shouldRetry: (): boolean | undefined => {
          hookEntered.resolve()
          holdTerminalRead = true
          if (failureKind === `throw`) throw hookError
          if (failureKind === `promise-late-rejection`) {
            asyncDecision = new Promise<boolean>((_resolve, reject) => {
              rejectAsyncDecision = reject
            })
            return asyncDecision as unknown as boolean | undefined
          }
          return null as unknown as boolean | undefined
        },
      },
      mutationFn: async ({ transaction }) => {
        providerCalls.push(transaction.id)
        if (transaction.id === headId) {
          providerEntered.resolve()
          await releaseProvider.promise
          throw providerError
        }
        env.applyMutations(transaction.mutations)
      },
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const errorLog = vi.spyOn(console, `error`).mockImplementation(() => {})
    const observed: Array<Promise<void>> = []
    const outcomes = new Map<string, unknown>()
    let hasPrimaryFailure = false

    // The production driver uses public transactions and their commit promises.
    // Each outcome starts pending so the held checkpoint can reject early success.
    function createObservedTransaction(rowId: string, updatedAt: number) {
      const tx = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      tx.mutate(() =>
        env.collection.insert({
          id: rowId,
          value: rowId,
          completed: false,
          updatedAt: new Date(updatedAt),
        }),
      )
      outcomes.set(tx.id, `pending`)
      const commit = tx.commit().then(
        () => {
          outcomes.set(tx.id, `fulfilled`)
        },
        (error: unknown) => {
          outcomes.set(tx.id, error)
        },
      )
      observed.push(commit)
      return { id: tx.id, commit }
    }

    try {
      process.on(`unhandledRejection`, onUnhandled)
      await env.waitForLeader()
      const head = createObservedTransaction(`head`, 0)
      headId = head.id
      await atOracleCheckpoint(providerEntered.promise, `head provider entered`)

      const preFault = createObservedTransaction(`before-fault`, 1)
      preFaultId = preFault.id
      await atOracleCheckpoint(preFaultStored.promise, `pre-fault peer durable`)
      releaseProvider.resolve()
      await atOracleCheckpoint(hookEntered.promise, `retry hook failed`)
      await atOracleCheckpoint(
        terminalCleanupEntered.promise,
        `terminal ${heldStep} held`,
      )

      const postFault = createObservedTransaction(`after-fault`, 2)
      postFaultId = postFault.id
      const firstObservation = await atOracleCheckpoint(
        Promise.race([
          postFault.commit.then(() => `settled` as const),
          postFaultStored.promise.then(() => `durable` as const),
        ]),
        `post-fault admission or rejection`,
      )

      const before = expectedHookFaultPeerAtHeldCleanup()
      const after = expectedHookFaultPeerAtHeldCleanup()
      const outboxAtHeldCleanup = await env.executor.peekOutbox()
      const durableIds = new Set(outboxAtHeldCleanup.map(({ id }) => id))
      // The race rejects an early admission refusal at this exact cut;
      // waiting for final cleanup alone would hide the transient violation.
      expect(firstObservation).toBe(`durable`)
      expect(durableIds.has(preFault.id)).toBe(before.durable)
      expect(durableIds.has(postFault.id)).toBe(after.durable)
      expect([...durableIds].sort()).toEqual(
        [head.id, preFault.id, postFault.id].sort(),
      )
      expect(observedFaultAdmissionOutcome(outcomes.get(preFault.id))).toBe(
        before.outcome,
      )
      expect(observedFaultAdmissionOutcome(outcomes.get(postFault.id))).toBe(
        after.outcome,
      )
      expect(outcomes.get(head.id)).toBe(`pending`)
      expect(
        outboxAtHeldCleanup.find(({ id }) => id === head.id)?.outboxPhase,
      ).toBe(heldStep === `deletion` ? `rejection-pending` : undefined)
      expect(
        outboxAtHeldCleanup.find(({ id }) => id === preFault.id)?.outboxPhase,
      ).toBeUndefined()
      expect(providerCalls).toEqual([head.id])
      expect(env.collection.toArray.map(({ id }) => id).sort()).toEqual([
        `after-fault`,
        `before-fault`,
        `head`,
      ])

      releaseTerminalCleanup.resolve()
      await atOracleCheckpoint(head.commit, `failed head settled`)
      if (failureKind === `throw`) expect(outcomes.get(head.id)).toBe(hookError)
      else expect(outcomes.get(head.id)).toBeInstanceOf(TypeError)
      await atOracleCheckpoint(preFault.commit, `pre-fault peer settled`)
      await atOracleCheckpoint(postFault.commit, `post-fault peer settled`)
      expect(outcomes.get(preFault.id)).toBe(`fulfilled`)
      expect(outcomes.get(postFault.id)).toBe(`fulfilled`)
      expect(await env.executor.peekOutbox()).toEqual([])
      expect(providerCalls).toEqual([head.id, preFault.id, postFault.id])
      expect(env.collection.toArray.map(({ id }) => id).sort()).toEqual([
        `after-fault`,
        `before-fault`,
      ])
      if (failureKind === `promise-late-rejection`) {
        expect(rejectAsyncDecision).toBeTypeOf(`function`)
        rejectAsyncDecision?.(asyncError)
        lateDecisionRejected = true
      }
      await turn()
      expect(unhandled).toEqual([])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      if (asyncDecision && !lateDecisionRejected) {
        // Release a mutant that wrongly awaits this test-owned Promise.
        void asyncDecision.catch(() => {})
        rejectAsyncDecision?.(asyncError)
      }
      releaseProvider.resolve()
      releaseTerminalCleanup.resolve()
      const cleanupError = new Error(`hook-fault admission oracle cleanup`)
      for (const [id, outcome] of outcomes)
        if (outcome === `pending`)
          env.executor.rejectTransaction(id, cleanupError)
      await cleanupOfflineOracle(
        [
          () => Promise.all(observed),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
          () => warning.mockRestore(),
          () => errorLog.mockRestore(),
          () => process.off(`unhandledRejection`, onUnhandled),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

// A storage row may be visible before its write acknowledges. The independent
// model keeps visibility, acknowledgement, and provider eligibility separate:
// the peer cannot run before both its write and the failed head's deletion
// acknowledge. It does not copy the executor's queue or cleanup machinery.
type StartedWriteCut =
  | { stored: false; acknowledgement: `held` }
  | { stored: true; acknowledgement: `held` | `fulfilled` }
  | { stored: false; acknowledgement: `rejected` }

function expectedStartedPeer(
  cut: StartedWriteCut,
  headRemoved: boolean,
): {
  visible: boolean
  caller: `pending` | `rejected`
  providerEligible: boolean
} {
  return {
    visible: cut.stored,
    caller: cut.acknowledgement === `rejected` ? `rejected` : `pending`,
    providerEligible: cut.acknowledgement === `fulfilled` && headRemoved,
  }
}

// Legal grammar: the head provider is held while a peer starts a public commit.
// The peer write acknowledges before the fault, remains held before storage, or
// becomes visible before its acknowledgement. A held write may acknowledge
// during the head's terminal marker or after head deletion; one write rejects
// before changing storage. Throwing and invalid hooks cross every write cut.
// The driver compares both public promises, Collection rows, exact outbox IDs,
// and provider calls before and after the two acknowledgements. A successful
// peer must finish in this executor; this is not a fresh-executor replay law.
it.each([
  [`throw`, `durable-before`],
  [`throw`, `late-during-marker`],
  [`throw`, `visible-before-ack`],
  [`throw`, `visible-across-cleanup`],
  [`throw`, `late-after-cleanup`],
  [`throw`, `failure-before-store`],
  [`invalid`, `durable-before`],
  [`invalid`, `late-during-marker`],
  [`invalid`, `visible-before-ack`],
  [`invalid`, `visible-across-cleanup`],
  [`invalid`, `late-after-cleanup`],
  [`invalid`, `failure-before-store`],
] as const)(
  `settles a started peer across %s hook failure and %s write`,
  async (failureKind, peerWriteCase) => {
    const providerError = new Error(`HTTP 401 Unauthorized`)
    const hookError = new Error(`retry decision failed`)
    const storageError = new Error(`peer outbox write failed`)
    const providerEntered = gate()
    const releaseProvider = gate()
    const peerWriteEntered = gate()
    const peerRowStored = gate()
    const releasePeerWrite = gate()
    const peerWriteSettled = gate()
    const hookEntered = gate()
    const terminalMarkerEntered = gate()
    const releaseTerminalMarker = gate()
    const peerProviderEntered = gate()
    const releasePeerProvider = gate()
    const providerCalls: Array<string> = []
    let headId = ``
    let peerId = ``
    let holdPeerWrite = peerWriteCase !== `durable-before`

    class ControlledStorage extends FakeStorageAdapter {
      override async set(key: string, value: string): Promise<void> {
        if (
          key === `tx:${headId}` &&
          (JSON.parse(value) as { outboxPhase?: string }).outboxPhase ===
            `rejection-pending`
        ) {
          terminalMarkerEntered.resolve()
          await releaseTerminalMarker.promise
        }
        if (key === `tx:${peerId}`) {
          peerWriteEntered.resolve()
          if (
            (peerWriteCase === `visible-before-ack` ||
              peerWriteCase === `visible-across-cleanup`) &&
            holdPeerWrite
          ) {
            await super.set(key, value)
            peerRowStored.resolve()
            await releasePeerWrite.promise
            holdPeerWrite = false
            peerWriteSettled.resolve()
            return
          }
          if (holdPeerWrite) {
            await releasePeerWrite.promise
            holdPeerWrite = false
            if (peerWriteCase === `failure-before-store`) {
              peerWriteSettled.resolve()
              throw storageError
            }
          }
        }
        await super.set(key, value)
        if (key === `tx:${peerId}`) {
          peerRowStored.resolve()
          peerWriteSettled.resolve()
        }
      }
    }

    const storage = new ControlledStorage()
    const env = createTestOfflineEnvironment({
      storage,
      config: {
        shouldRetry: (): boolean | undefined => {
          hookEntered.resolve()
          if (failureKind === `throw`) throw hookError
          return null as unknown as boolean | undefined
        },
      },
      mutationFn: async ({ transaction }) => {
        providerCalls.push(transaction.id)
        if (transaction.id === headId) {
          providerEntered.resolve()
          await releaseProvider.promise
          throw providerError
        }
        peerProviderEntered.resolve()
        await releasePeerProvider.promise
        env.applyMutations(transaction.mutations)
      },
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const errorLog = vi.spyOn(console, `error`).mockImplementation(() => {})
    const observed: Array<Promise<void>> = []
    const outcomes = new Map<string, { commit: unknown; persisted: unknown }>()
    let hasPrimaryFailure = false

    function createObservedTransaction(rowId: string, updatedAt: number) {
      const tx = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      const transaction = tx.mutate(() =>
        env.collection.insert({
          id: rowId,
          value: rowId,
          completed: false,
          updatedAt: new Date(updatedAt),
        }),
      )
      const outcome = {
        commit: `pending` as unknown,
        persisted: `pending` as unknown,
      }
      outcomes.set(tx.id, outcome)
      const commit = tx.commit().then(
        () => {
          outcome.commit = `fulfilled`
        },
        (error: unknown) => {
          outcome.commit = error
        },
      )
      const persisted = transaction.isPersisted.promise.then(
        () => {
          outcome.persisted = `fulfilled`
        },
        (error: unknown) => {
          outcome.persisted = error
        },
      )
      observed.push(commit, persisted)
      return { id: tx.id, commit, persisted, outcome }
    }

    try {
      await env.waitForLeader()
      const head = createObservedTransaction(`head`, 0)
      headId = head.id
      await atOracleCheckpoint(providerEntered.promise, `head provider entered`)

      const peer = createObservedTransaction(`peer`, 1)
      peerId = peer.id
      await atOracleCheckpoint(peerWriteEntered.promise, `peer write started`)
      if (peerWriteCase === `durable-before`)
        await atOracleCheckpoint(
          peerWriteSettled.promise,
          `peer durable before fault`,
        )
      if (
        peerWriteCase === `visible-before-ack` ||
        peerWriteCase === `visible-across-cleanup`
      )
        await atOracleCheckpoint(
          peerRowStored.promise,
          `peer visible before ack`,
        )

      releaseProvider.resolve()
      await atOracleCheckpoint(hookEntered.promise, `retry hook failed`)
      await atOracleCheckpoint(
        terminalMarkerEntered.promise,
        `terminal marker held`,
      )
      const atFault = expectedStartedPeer(
        peerWriteCase === `durable-before`
          ? { stored: true, acknowledgement: `fulfilled` }
          : peerWriteCase === `visible-before-ack` ||
              peerWriteCase === `visible-across-cleanup`
            ? { stored: true, acknowledgement: `held` }
            : { stored: false, acknowledgement: `held` },
        false,
      )
      expect(head.outcome.commit).toBe(`pending`)
      expect(peer.outcome.commit).toBe(atFault.caller)
      expect(peer.outcome.persisted).toBe(atFault.caller)
      expect(providerCalls).toEqual([head.id])
      expect(atFault.providerEligible).toBe(false)
      expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual(
        atFault.visible ? [head.id, peer.id] : [head.id],
      )
      expect(env.collection.toArray.map(({ id }) => id)).toEqual([
        `head`,
        `peer`,
      ])

      const writeAfterCleanup =
        peerWriteCase === `late-after-cleanup` ||
        peerWriteCase === `visible-across-cleanup`
      if (!writeAfterCleanup) {
        releasePeerWrite.resolve()
        await atOracleCheckpoint(peerWriteSettled.promise, `peer write settled`)
      }
      const afterWrite = expectedStartedPeer(
        peerWriteCase === `failure-before-store`
          ? { stored: false, acknowledgement: `rejected` }
          : writeAfterCleanup
            ? peerWriteCase === `visible-across-cleanup`
              ? { stored: true, acknowledgement: `held` }
              : { stored: false, acknowledgement: `held` }
            : { stored: true, acknowledgement: `fulfilled` },
        false,
      )
      if (peerWriteCase === `failure-before-store`) {
        await atOracleCheckpoint(peer.commit, `failed peer commit settled`)
        await atOracleCheckpoint(
          peer.persisted,
          `failed peer persistence settled`,
        )
        expect(peer.outcome.commit).toBe(storageError)
        expect(peer.outcome.persisted).toBe(storageError)
      } else {
        await turn()
        expect(peer.outcome.commit).toBe(afterWrite.caller)
        expect(peer.outcome.persisted).toBe(afterWrite.caller)
      }
      expect(afterWrite.providerEligible).toBe(false)
      expect(providerCalls).toEqual([head.id])
      expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual(
        afterWrite.visible ? [head.id, peer.id] : [head.id],
      )

      releaseTerminalMarker.resolve()
      await atOracleCheckpoint(head.commit, `failed head settled`)
      await atOracleCheckpoint(
        head.persisted,
        `failed head persistence settled`,
      )
      if (failureKind === `throw`) {
        expect(head.outcome.commit).toBe(hookError)
        expect(head.outcome.persisted).toBe(hookError)
      } else {
        expect(head.outcome.commit).toBeInstanceOf(TypeError)
        expect(head.outcome.persisted).toBeInstanceOf(TypeError)
      }

      if (writeAfterCleanup) {
        // A visible row without write acknowledgement cannot run even after
        // the failed head is removed.
        expect(providerCalls).toEqual([head.id])
        expect(peer.outcome.commit).toBe(`pending`)
        expect(peer.outcome.persisted).toBe(`pending`)
        expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual(
          peerWriteCase === `visible-across-cleanup` ? [peer.id] : [],
        )
        releasePeerWrite.resolve()
        await atOracleCheckpoint(
          peerWriteSettled.promise,
          `late peer write settled`,
        )
      }

      if (peerWriteCase === `failure-before-store`) {
        expect(providerCalls).toEqual([head.id])
        expect(await env.executor.peekOutbox()).toEqual([])
        expect(env.collection.toArray).toEqual([])
      } else {
        const firstPeerEvent = await atOracleCheckpoint(
          Promise.race([
            peerProviderEntered.promise.then(() => `provider` as const),
            peer.commit.then(() => `settled` as const),
          ]),
          `peer provider or early settlement`,
        )
        expect(firstPeerEvent).toBe(`provider`)
        expect(peer.outcome.commit).toBe(`pending`)
        expect(peer.outcome.persisted).toBe(`pending`)
        expect(providerCalls).toEqual([head.id, peer.id])
        expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
          peer.id,
        ])
        releasePeerProvider.resolve()
        await atOracleCheckpoint(peer.commit, `peer commit settled`)
        await atOracleCheckpoint(peer.persisted, `peer persistence settled`)
        expect(peer.outcome.commit).toBe(`fulfilled`)
        expect(peer.outcome.persisted).toBe(`fulfilled`)
        expect(providerCalls).toEqual([head.id, peer.id])
        expect(await env.executor.peekOutbox()).toEqual([])
        expect(env.collection.toArray.map(({ id }) => id)).toEqual([`peer`])
      }
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseProvider.resolve()
      releasePeerWrite.resolve()
      releaseTerminalMarker.resolve()
      releasePeerProvider.resolve()
      const cleanupError = new Error(`started-peer oracle cleanup`)
      for (const [id, outcome] of outcomes)
        if (outcome.commit === `pending` || outcome.persisted === `pending`)
          env.executor.rejectTransaction(id, cleanupError)
      await cleanupOfflineOracle(
        [
          () => Promise.all(observed),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
          () => warning.mockRestore(),
          () => errorLog.mockRestore(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

// A hook failure removes only the head. The already queued peer then runs in
// the same batch, and a later batch remains available for new work.
it(`continues queued work after shouldRetry throws`, async () => {
  const providerError = new Error(`HTTP 401 Unauthorized`)
  const hookError = new Error(`retry decision failed`)
  const outbox = new OutboxManager(new FakeStorageAdapter(), {})
  const scheduler = new KeyScheduler()
  const rejections: Array<Error> = []
  const resolutions: Array<string> = []
  let peerCalls = 0
  const signaler: TransactionSignaler = {
    isOfflineEnabled: true,
    isOnline: () => true,
    resolveTransaction: (id) => {
      if (id === `hook-failure-head`)
        throw new Error(`failed head cannot resolve`)
      resolutions.push(id)
    },
    rejectTransaction: (_id, error) => rejections.push(error),
    registerRestorationTransaction: () => {},
  }
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {
        head: () => Promise.reject(providerError),
        peer: () => {
          peerCalls++
          return Promise.resolve()
        },
      },
      shouldRetry: () => {
        throw hookError
      },
    },
    signaler,
  )
  const head: OfflineTransaction = {
    id: `hook-failure-head`,
    mutationFnName: `head`,
    mutations: [],
    keys: [],
    idempotencyKey: `hook-failure-head`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    version: 1,
  }
  const peer: OfflineTransaction = {
    ...head,
    id: `hook-failure-peer`,
    mutationFnName: `peer`,
    idempotencyKey: `hook-failure-peer`,
    createdAt: new Date(1),
  }
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  try {
    await outbox.add(head)
    await outbox.add(peer)
    scheduler.schedule(peer)
    await expect(executor.execute(head)).resolves.toBeUndefined()
    expect(rejections).toEqual([hookError])
    expect(await outbox.get(head.id)).toBeNull()
    expect(await outbox.get(peer.id)).toBeNull()
    expect(scheduler.getPendingCount()).toBe(0)
    expect(peerCalls).toBe(1)
    expect(resolutions).toEqual([peer.id])
    await expect(executor.executeAll()).resolves.toBeUndefined()
    expect(peerCalls).toBe(1)
    expect(resolutions).toEqual([peer.id])
  } finally {
    executor.pause()
    warning.mockRestore()
  }
})

// A first-provider retry-record write fails after 2–5 transactions have been
// admitted. Two is the marginal held-head/peer history; five checks that every
// later peer survives. Removing the peer removes the independence question.
// The fixture does not generate a duplicate ID or a successful retry-record
// write, because neither has this failure premise.
async function checkRetryRecordFailure(seed: number | undefined) {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (count) => {
      const storageError = new Error(`retry record unavailable`)
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      class RetryStorage extends FakeStorageAdapter {
        failUpdate = true
        override async set(key: string, value: string): Promise<void> {
          if (this.failUpdate && JSON.parse(value).retryCount > 0) {
            this.failUpdate = false
            throw storageError
          }
          await super.set(key, value)
        }
      }
      const entered = gate()
      const release = gate()
      const calls: Array<string> = []
      const statuses: Array<unknown> = []
      const observed: Array<Promise<void>> = []
      const ids: Array<string> = []
      const env = createTestOfflineEnvironment({
        storage: new RetryStorage(),
        config: { jitter: false },
        mutationFn: async (params) => {
          calls.push(params.transaction.id)
          if (calls.length === 1) {
            entered.resolve()
            await release.promise
            throw new Error(`temporary provider failure`)
          }
          env.applyMutations(params.transaction.mutations)
        },
      })
      let hasPrimaryFailure = false
      try {
        await env.waitForLeader()
        for (let index = 0; index < count; index++) {
          const tx = env.executor.createOfflineTransaction({
            mutationFnName: env.mutationFnName,
            autoCommit: false,
          })
          ids.push(tx.id)
          tx.mutate(() =>
            env.collection.insert({
              id: `row-${index}`,
              value: `value-${index}`,
              completed: false,
              updatedAt: new Date(0),
            }),
          )
          statuses[index] = `pending`
          observed.push(
            tx.commit().then(
              () => {
                statuses[index] = `fulfilled`
              },
              (error: unknown) => {
                statuses[index] = error
              },
            ),
          )
          if (index === 0)
            await atOracleCheckpoint(
              entered.promise,
              `first retry provider entered`,
            )
        }
        await turn()
        release.resolve()
        await turn()
        expect(calls).toEqual([ids[0]])
        expect(statuses).toEqual(ids.map(() => `pending`))
        expect(() =>
          expect([`fulfilled`, ...statuses.slice(1)]).toEqual(
            ids.map(() => `pending`),
          ),
        ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
        expect(warning).toHaveBeenCalledWith(
          `Failed to execute transactions:`,
          storageError,
        )
        expect((await env.executor.peekOutbox()).map((tx) => tx.id)).toEqual(
          ids,
        )
        env.executor.getOnlineDetector().notifyOnline()
        await atOracleCheckpoint(
          Promise.all(observed),
          `retry recovery settled`,
        )
        expect(calls).toEqual([ids[0], ...ids])
        expect(statuses).toEqual(ids.map(() => `fulfilled`))
        expect(await env.executor.peekOutbox()).toEqual([])
        expect([...env.serverState.keys()]).toEqual(
          ids.map((_id, index) => `row-${index}`),
        )
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        release.resolve()
        await cleanupOfflineOracle(
          [
            () => env.executor.getOnlineDetector().notifyOnline(),
            () => turn(),
            () => env.executor.dispose(),
            () => env.collection.cleanup(),
            () => {
              warning.mockRestore()
            },
          ],
          hasPrimaryFailure,
        )
      }
    }),
    {
      ...oracleOptions(retryRecordOracle, seed),
      examples: [[2], [5]],
    },
  )
}

it.each(oracleSeeds(20260916, retryRecordOracle))(
  `keeps admitted transactions pending when a peer's retry record cannot be updated (seed %s)`,
  checkRetryRecordFailure,
)

// The failed durable write can be first, middle, or last among three distinct
// IDs. All positions are pinned, so the conditional failure premise is reached
// at each boundary. Removing the two admitted peers would hide accidental
// global rejection. A duplicate ID is outside this legal admission grammar.
async function checkDurableAdmissionFailure(seed: number | undefined) {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 2 }), async (failedIndex) => {
      const storageError = new Error(`admission unavailable`)
      class Storage extends FakeStorageAdapter {
        writes = 0
        override async set(key: string, value: string): Promise<void> {
          if (this.writes++ === failedIndex) throw storageError
          await super.set(key, value)
        }
      }
      const release = gate()
      const env = createTestOfflineEnvironment({
        storage: new Storage(),
        mutationFn: async (params) => {
          await release.promise
          env.applyMutations(params.transaction.mutations)
        },
      })
      const ids: Array<string> = []
      const statuses: Array<unknown> = []
      const observed: Array<Promise<void>> = []
      let hasPrimaryFailure = false
      try {
        await env.waitForLeader()
        for (let index = 0; index < 3; index++) {
          const tx = env.executor.createOfflineTransaction({
            mutationFnName: env.mutationFnName,
            autoCommit: false,
          })
          ids.push(tx.id)
          tx.mutate(() =>
            env.collection.insert({
              id: `row-${index}`,
              value: `value-${index}`,
              completed: false,
              updatedAt: new Date(0),
            }),
          )
          statuses[index] = `pending`
          observed.push(
            tx.commit().then(
              () => {
                statuses[index] = `fulfilled`
              },
              (error: unknown) => {
                statuses[index] = error
              },
            ),
          )
          await turn()
        }
        expect(statuses[failedIndex]).toBe(storageError)
        expect((await env.executor.peekOutbox()).map((tx) => tx.id)).toEqual(
          ids.filter((_id, index) => index !== failedIndex),
        )
        release.resolve()
        await atOracleCheckpoint(
          Promise.all(observed),
          `admitted peers settled`,
        )
        expect(env.mutationCalls.map((call) => call.transaction.id)).toEqual(
          ids.filter((_id, index) => index !== failedIndex),
        )
        for (let index = 0; index < 3; index++) {
          expect(statuses[index]).toBe(
            index === failedIndex ? storageError : `fulfilled`,
          )
          expect(env.collection.has(`row-${index}`)).toBe(index !== failedIndex)
        }
        const expectedStatuses = ids.map((_id, index) =>
          index === failedIndex ? storageError : `fulfilled`,
        )
        expect(() =>
          expect(statuses.map(() => storageError)).toEqual(expectedStatuses),
        ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
        expect(await env.executor.peekOutbox()).toEqual([])
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        release.resolve()
        await cleanupOfflineOracle(
          [
            () => turn(),
            () => env.executor.dispose(),
            () => env.collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    }),
    {
      ...oracleOptions(admissionOracle, seed),
      examples: [[0], [1], [2]],
    },
  )
}

it.each(oracleSeeds(20260916, admissionOracle))(
  `rejects only the transaction whose durable admission fails (seed %s)`,
  checkDurableAdmissionFailure,
)

it(`keeps commit pending until successful outbox deletion`, async () => {
  const deletionEntered = gate()
  const releaseDeletion = gate()
  class Storage extends FakeStorageAdapter {
    override async delete(key: string): Promise<void> {
      if (key.startsWith(`tx:`)) {
        deletionEntered.resolve()
        await releaseDeletion.promise
      }
      await super.delete(key)
    }
  }
  const env = createTestOfflineEnvironment({ storage: new Storage() })
  let commitStatus: unknown = `pending`
  let persistedStatus: unknown = `pending`
  let transactionId = ``
  let observed: Promise<void> | undefined
  let observedPersistence: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const transaction = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    transactionId = transaction.id
    const localTransaction = transaction.mutate(() =>
      env.collection.insert({
        id: `held-delete`,
        value: `provider-applied`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observedPersistence = localTransaction.isPersisted.promise.then(
      () => {
        persistedStatus = `fulfilled`
      },
      (error: unknown) => {
        persistedStatus = error
      },
    )
    observed = transaction.commit().then(
      () => {
        commitStatus = `fulfilled`
      },
      (error: unknown) => {
        commitStatus = error
      },
    )

    await atOracleCheckpoint(deletionEntered.promise, `outbox deletion entered`)
    await turn()
    expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
      transactionId,
    ])
    expect(env.serverState.has(`held-delete`)).toBe(true)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      transactionId,
    ])
    expect([commitStatus, persistedStatus, localTransaction.state]).toEqual([
      `pending`,
      `pending`,
      `persisting`,
    ])

    releaseDeletion.resolve()
    await atOracleCheckpoint(
      Promise.all([observed, observedPersistence]),
      `outbox deletion settled caller`,
    )
    expect([commitStatus, persistedStatus, localTransaction.state]).toEqual([
      `fulfilled`,
      `fulfilled`,
      `completed`,
    ])
    expect(await env.executor.peekOutbox()).toEqual([])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseDeletion.resolve()
    if (commitStatus === `pending` && transactionId)
      env.executor.resolveTransaction(transactionId, undefined)
    await cleanupOfflineOracle(
      [
        () => Promise.all([observed, observedPersistence]),
        () => env.executor.dispose(),
        () => env.collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
})

it.each([`removeFromOutbox`, `clearOutbox`] as const)(
  `settles active provider work after %s acknowledges outbox deletion`,
  async (removal) => {
    const providerEntered = gate()
    const releaseProvider = gate()
    const env = createTestOfflineEnvironment({
      mutationFn: async (params) => {
        providerEntered.resolve()
        await releaseProvider.promise
        env.applyMutations(params.transaction.mutations)
      },
    })
    let transactionId = ``
    let commitStatus: unknown = `pending`
    let persistedStatus: unknown = `pending`
    let observed: Promise<void> | undefined
    let observedPersistence: Promise<void> | undefined
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      const transaction = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      transactionId = transaction.id
      const localTransaction = transaction.mutate(() =>
        env.collection.insert({
          id: `manually-removed-active`,
          value: `provider-applied`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      observedPersistence = localTransaction.isPersisted.promise.then(
        () => {
          persistedStatus = `fulfilled`
        },
        (error: unknown) => {
          persistedStatus = error
        },
      )
      observed = transaction.commit().then(
        () => {
          commitStatus = `fulfilled`
        },
        (error: unknown) => {
          commitStatus = error
        },
      )

      await atOracleCheckpoint(providerEntered.promise, `provider held`)
      expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
        transactionId,
      ])
      if (removal === `removeFromOutbox`)
        await env.executor.removeFromOutbox(transactionId)
      else await env.executor.clearOutbox()
      expect(await env.executor.peekOutbox()).toEqual([])
      expect([commitStatus, persistedStatus, localTransaction.state]).toEqual([
        `pending`,
        `pending`,
        `persisting`,
      ])

      releaseProvider.resolve()
      await atOracleCheckpoint(
        Promise.all([observed, observedPersistence]),
        `provider fulfillment after ${removal} deletion settled caller`,
      )
      expect([commitStatus, persistedStatus, localTransaction.state]).toEqual([
        `fulfilled`,
        `fulfilled`,
        `completed`,
      ])
      expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
        transactionId,
      ])
      expect(env.serverState.has(`manually-removed-active`)).toBe(true)
      expect(await env.executor.peekOutbox()).toEqual([])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseProvider.resolve()
      if (commitStatus === `pending` && transactionId)
        env.executor.resolveTransaction(transactionId, undefined)
      await cleanupOfflineOracle(
        [
          () => Promise.all([observed, observedPersistence]),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

it(`stops successful provider work when outbox deletion fails`, async () => {
  const firstProviderEntered = gate()
  const releaseFirstProvider = gate()
  const deletionAttempted = gate()
  const storageError = new Error(`acknowledgement cleanup failed`)
  let transactionId = ``
  class Storage extends FakeStorageAdapter {
    attempts = 0
    override async delete(key: string): Promise<void> {
      if (key === `tx:${transactionId}`) {
        this.attempts++
        deletionAttempted.resolve()
        throw storageError
      }
      await super.delete(key)
    }
  }
  const storage = new Storage()
  const env = createTestOfflineEnvironment({
    storage,
    mutationFn: async (params) => {
      if (params.transaction.id === transactionId) {
        firstProviderEntered.resolve()
        await releaseFirstProvider.promise
      }
      env.applyMutations(params.transaction.mutations)
    },
  })
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  let commitStatus: unknown = `pending`
  let persistedStatus: unknown = `pending`
  let peerStatus: unknown = `pending`
  let peerId = ``
  let observed: Promise<void> | undefined
  let observedPersistence: Promise<void> | undefined
  let observedPeer: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const transaction = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    transactionId = transaction.id
    const localTransaction = transaction.mutate(() =>
      env.collection.insert({
        id: `successful-cleanup-failure`,
        value: `provider-applied`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observedPersistence = localTransaction.isPersisted.promise.then(
      () => {
        persistedStatus = `fulfilled`
      },
      (error: unknown) => {
        persistedStatus = error
      },
    )
    observed = transaction.commit().then(
      () => {
        commitStatus = `fulfilled`
      },
      (error: unknown) => {
        commitStatus = error
      },
    )

    await atOracleCheckpoint(
      firstProviderEntered.promise,
      `first provider held`,
    )
    const peer = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    peerId = peer.id
    peer.mutate(() =>
      env.collection.insert({
        id: `queued-peer`,
        value: `provider-applied`,
        completed: false,
        updatedAt: new Date(1),
      }),
    )
    observedPeer = peer.commit().then(
      () => {
        peerStatus = `fulfilled`
      },
      (error: unknown) => {
        peerStatus = error
      },
    )
    await turn()
    releaseFirstProvider.resolve()

    await atOracleCheckpoint(
      deletionAttempted.promise,
      `successful acknowledgement cleanup attempted`,
    )
    await turn()

    expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
      transactionId,
    ])
    expect(env.serverState.has(`successful-cleanup-failure`)).toBe(true)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      transactionId,
      peerId,
    ])
    expect([
      commitStatus,
      persistedStatus,
      localTransaction.state,
      peerStatus,
    ]).toEqual([storageError, storageError, `failed`, `pending`])

    env.executor.getOnlineDetector().notifyOnline()
    await turn()
    expect(storage.attempts).toBe(1)
    expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
      transactionId,
    ])
    expect(peerStatus).toBe(`pending`)
    const later = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    later.mutate(() =>
      env.collection.insert({
        id: `after-storage-stop`,
        value: `not-admitted`,
        completed: false,
        updatedAt: new Date(2),
      }),
    )
    await expect(later.commit()).rejects.toBe(storageError)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      transactionId,
      peerId,
    ])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseFirstProvider.resolve()
    if (commitStatus === `pending` && transactionId)
      env.executor.resolveTransaction(transactionId, undefined)
    if (peerStatus === `pending` && peerId)
      env.executor.resolveTransaction(peerId, undefined)
    await cleanupOfflineOracle(
      [
        () => Promise.all([observed, observedPersistence, observedPeer]),
        () => env.executor.dispose(),
        () => env.collection.cleanup(),
        () => warning.mockRestore(),
      ],
      hasPrimaryFailure,
    )
  }
})

it(`stops after a failed deletion-pending write and holds its queued peer`, async () => {
  const firstProviderEntered = gate()
  const releaseFirstProvider = gate()
  const markerWriteFailed = gate()
  const markerError = new Error(`deletion-pending record unavailable`)
  let headId = ``
  class Storage extends FakeStorageAdapter {
    markerWrites = 0
    deletedIds: Array<string> = []

    override async set(key: string, value: string): Promise<void> {
      if (
        key === `tx:${headId}` &&
        (JSON.parse(value) as { outboxPhase?: string }).outboxPhase ===
          `deletion-pending`
      ) {
        this.markerWrites++
        markerWriteFailed.resolve()
        throw markerError
      }
      await super.set(key, value)
    }

    override async delete(key: string): Promise<void> {
      if (key.startsWith(`tx:`)) this.deletedIds.push(key.slice(3))
      await super.delete(key)
    }
  }
  const storage = new Storage()
  const env = createTestOfflineEnvironment({
    storage,
    mutationFn: async (params) => {
      if (params.transaction.id === headId) {
        firstProviderEntered.resolve()
        await releaseFirstProvider.promise
      }
      env.applyMutations(params.transaction.mutations)
    },
  })
  let headStatus: unknown = `pending`
  let persistedStatus: unknown = `pending`
  let peerStatus: unknown = `pending`
  let peerId = ``
  let observedHead: Promise<void> | undefined
  let observedPersistence: Promise<void> | undefined
  let observedPeer: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const head = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    headId = head.id
    const localTransaction = head.mutate(() =>
      env.collection.insert({
        id: `marker-write-head`,
        value: `provider-applied`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observedPersistence = localTransaction.isPersisted.promise.then(
      () => {
        persistedStatus = `fulfilled`
      },
      (error: unknown) => {
        persistedStatus = error
      },
    )
    observedHead = head.commit().then(
      () => {
        headStatus = `fulfilled`
      },
      (error: unknown) => {
        headStatus = error
      },
    )

    await atOracleCheckpoint(firstProviderEntered.promise, `head provider held`)
    const peer = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    peerId = peer.id
    peer.mutate(() =>
      env.collection.insert({
        id: `marker-write-peer`,
        value: `queued`,
        completed: false,
        updatedAt: new Date(1),
      }),
    )
    observedPeer = peer.commit().then(
      () => {
        peerStatus = `fulfilled`
      },
      (error: unknown) => {
        peerStatus = error
      },
    )
    await turn()
    releaseFirstProvider.resolve()

    await atOracleCheckpoint(
      markerWriteFailed.promise,
      `fulfilled-provider marker write failed`,
    )
    await turn()
    expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
      headId,
    ])
    expect(env.serverState.has(`marker-write-head`)).toBe(true)
    expect(env.serverState.has(`marker-write-peer`)).toBe(false)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      headId,
      peerId,
    ])
    expect((await env.executor.peekOutbox())[0]?.outboxPhase).toBeUndefined()
    expect(storage.deletedIds).toEqual([])
    expect([
      headStatus,
      persistedStatus,
      localTransaction.state,
      peerStatus,
    ]).toEqual([markerError, markerError, `failed`, `pending`])

    env.executor.getOnlineDetector().notifyOnline()
    await turn()
    expect(storage.markerWrites).toBe(1)
    expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
      headId,
    ])
    expect(storage.deletedIds).toEqual([])
    expect(peerStatus).toBe(`pending`)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      headId,
      peerId,
    ])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseFirstProvider.resolve()
    if (headStatus === `pending` && headId)
      env.executor.resolveTransaction(headId, undefined)
    if (peerStatus === `pending` && peerId)
      env.executor.resolveTransaction(peerId, undefined)
    await cleanupOfflineOracle(
      [
        () => Promise.all([observedHead, observedPersistence, observedPeer]),
        () => env.executor.dispose(),
        () => env.collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
})

it(`restarts a fulfilled provider transaction after a stopped deletion failure`, async () => {
  const firstDeletionAttempted = gate()
  const restartedDeletionAttempted = gate()
  const storageError = new Error(`acknowledgement cleanup failed`)
  const providerCalls: Array<{ id: string; idempotencyKey: string }> = []
  let providerFulfilled = false
  class Storage extends FakeStorageAdapter {
    failDeletes = true
    completedWritesAfterProviderFulfilled = 0

    override async set(key: string, value: string): Promise<void> {
      await super.set(key, value)
      if (providerFulfilled) this.completedWritesAfterProviderFulfilled++
    }

    override async delete(key: string): Promise<void> {
      if (key.startsWith(`tx:`)) {
        if (this.failDeletes) {
          firstDeletionAttempted.resolve()
          throw storageError
        }
        restartedDeletionAttempted.resolve()
      }
      await super.delete(key)
    }
  }
  const storage = new Storage()
  const first = createTestOfflineEnvironment({
    storage,
    mutationFn: (params) => {
      providerCalls.push({
        id: params.transaction.id,
        idempotencyKey: params.idempotencyKey,
      })
      first.applyMutations(params.transaction.mutations)
      providerFulfilled = true
    },
  })
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  let second: ReturnType<typeof createTestOfflineEnvironment> | undefined
  let transactionId = ``
  let commitStatus: unknown = `pending`
  let persistedStatus: unknown = `pending`
  let observed: Promise<void> | undefined
  let observedPersistence: Promise<void> | undefined
  let replayStatus: unknown = `pending`
  let observedReplay: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await first.waitForLeader()
    const transaction = first.executor.createOfflineTransaction({
      mutationFnName: first.mutationFnName,
      autoCommit: false,
      idempotencyKey: `restart-after-provider-fulfillment`,
    })
    transactionId = transaction.id
    const localTransaction = transaction.mutate(() =>
      first.collection.insert({
        id: `restart-after-delete-failure`,
        value: `provider-applied`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observedPersistence = localTransaction.isPersisted.promise.then(
      () => {
        persistedStatus = `fulfilled`
      },
      (error: unknown) => {
        persistedStatus = error
      },
    )
    observed = transaction.commit().then(
      () => {
        commitStatus = `fulfilled`
      },
      (error: unknown) => {
        commitStatus = error
      },
    )

    await atOracleCheckpoint(
      firstDeletionAttempted.promise,
      `first deletion failed after provider fulfillment`,
    )
    await turn()
    expect(providerCalls).toEqual([
      {
        id: transactionId,
        idempotencyKey: `restart-after-provider-fulfillment`,
      },
    ])
    expect(first.serverState.has(`restart-after-delete-failure`)).toBe(true)
    expect((await first.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      transactionId,
    ])
    expect([commitStatus, persistedStatus, localTransaction.state]).toEqual([
      storageError,
      storageError,
      `failed`,
    ])
    expect(storage.completedWritesAfterProviderFulfilled).toBeGreaterThan(0)
    const markerWrites = storage.completedWritesAfterProviderFulfilled

    first.executor.dispose()
    storage.failDeletes = false
    second = createTestOfflineEnvironment({
      storage,
      config: {
        // Filtering unfulfilled work cannot cancel already fulfilled provider
        // work whose only remaining obligation is durable deletion.
        beforeRetry: () => [],
      },
      mutationFn: (params) => {
        providerCalls.push({
          id: params.transaction.id,
          idempotencyKey: params.idempotencyKey,
        })
      },
    })
    observedReplay = second.executor
      .waitForTransactionCompletion(transactionId)
      .then(
        () => {
          replayStatus = `fulfilled`
        },
        (error: unknown) => {
          replayStatus = error
        },
      )
    await second.waitForLeader()
    await atOracleCheckpoint(
      restartedDeletionAttempted.promise,
      `restarted deletion attempted`,
    )
    expect(await second.executor.peekOutbox()).toEqual([])
    await atOracleCheckpoint(observedReplay, `restarted deletion settled`)
    expect(replayStatus).toBe(`fulfilled`)
    expect(providerCalls).toEqual([
      {
        id: transactionId,
        idempotencyKey: `restart-after-provider-fulfillment`,
      },
    ])
    expect(storage.completedWritesAfterProviderFulfilled).toBe(markerWrites)
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    if (commitStatus === `pending` && transactionId)
      first.executor.resolveTransaction(transactionId, undefined)
    await cleanupOfflineOracle(
      [
        () => Promise.all([observed, observedPersistence]),
        () => observedReplay,
        () => first.executor.dispose(),
        () => second?.executor.dispose(),
        () => first.collection.cleanup(),
        () => second?.collection.cleanup(),
        () => warning.mockRestore(),
      ],
      hasPrimaryFailure,
    )
  }
})

it(`replays an admitted row with no fulfilled-provider checkpoint`, async () => {
  const deletionCompleted = gate()
  class Storage extends FakeStorageAdapter {
    override async delete(key: string): Promise<void> {
      await super.delete(key)
      if (key === `tx:legacy-unmarked-transaction`) deletionCompleted.resolve()
    }
  }
  const storage = new Storage()
  const seed = createCollection<TestItem, string>({
    id: `test-items`,
    getKey: (row) => row.id,
    startSync: true,
    sync: { sync: (ops) => ops.markReady() },
  })
  const outbox = new OutboxManager(storage, { [seed.id]: seed })
  const seedTransaction = createTransaction({
    autoCommit: false,
    mutationFn: () => Promise.resolve(),
  })
  void seedTransaction.isPersisted.promise.catch(() => {})
  try {
    seedTransaction.mutate(() =>
      seed.insert({
        id: `legacy-unmarked`,
        value: `replay-me`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    await outbox.add({
      id: `legacy-unmarked-transaction`,
      mutationFnName: `syncData`,
      mutations: seedTransaction.mutations,
      keys: seedTransaction.mutations.map(({ globalKey }) => globalKey),
      idempotencyKey: `legacy-unmarked-key`,
      createdAt: new Date(0),
      retryCount: 0,
      nextAttemptAt: 0,
      version: 1,
    })
  } finally {
    seedTransaction.rollback({ isSecondaryRollback: true })
    await seed.cleanup()
  }

  const providerEntered = gate()
  const providerCalls: Array<{ id: string; idempotencyKey: string }> = []
  const env = createTestOfflineEnvironment({
    storage,
    mutationFn: (params) => {
      providerCalls.push({
        id: params.transaction.id,
        idempotencyKey: params.idempotencyKey,
      })
      env.applyMutations(params.transaction.mutations)
      providerEntered.resolve()
    },
  })
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    await atOracleCheckpoint(
      providerEntered.promise,
      `unmarked provider replay`,
    )
    expect(providerCalls).toEqual([
      {
        id: `legacy-unmarked-transaction`,
        idempotencyKey: `legacy-unmarked-key`,
      },
    ])
    expect(env.serverState.has(`legacy-unmarked`)).toBe(true)
    await atOracleCheckpoint(
      deletionCompleted.promise,
      `unmarked replay outbox deletion`,
    )
    expect(await env.executor.peekOutbox()).toEqual([])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupOfflineOracle(
      [() => env.executor.dispose(), () => env.collection.cleanup()],
      hasPrimaryFailure,
    )
  }
})

// Deletion failure leaves a durable terminal marker. The two causes must both
// retain their own error and skip the provider when a fresh executor removes it.
async function checkTerminalFailureWithFailedDeletion(
  failureKind: `provider` | `hook`,
) {
  const deletionAttempted = gate()
  const restartedDeletionAttempted = gate()
  const releaseRestartedDeletion = gate()
  const primaryError =
    failureKind === `provider`
      ? new NonRetriableError(`provider rejected permanently`)
      : new Error(`retry decision failed`)
  const providerError =
    failureKind === `provider`
      ? primaryError
      : new Error(`HTTP 401 Unauthorized`)
  const storageError = new Error(`rejection cleanup failed`)
  class Storage extends FakeStorageAdapter {
    failDeletes = true
    override async delete(key: string): Promise<void> {
      if (key.startsWith(`tx:`)) {
        if (this.failDeletes) {
          deletionAttempted.resolve()
          throw storageError
        }
        restartedDeletionAttempted.resolve()
        await releaseRestartedDeletion.promise
      }
      await super.delete(key)
    }
  }
  const storage = new Storage()
  let providerCalls = 0
  const env = createTestOfflineEnvironment({
    storage,
    config:
      failureKind === `hook`
        ? {
            shouldRetry: () => {
              throw primaryError
            },
          }
        : {},
    mutationFn: () => {
      providerCalls++
      return Promise.reject(providerError)
    },
  })
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  let restarted: ReturnType<typeof createTestOfflineEnvironment> | undefined
  let status: unknown = `pending`
  let replayStatus: unknown = `pending`
  let transactionId = ``
  let observed: Promise<void> | undefined
  let observedReplay: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const transaction = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    transactionId = transaction.id
    transaction.mutate(() =>
      env.collection.insert({
        id: `permanent-cleanup-failure`,
        value: `optimistic`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observed = transaction.commit().then(
      () => {
        status = `fulfilled`
      },
      (error: unknown) => {
        status = error
      },
    )

    await atOracleCheckpoint(
      deletionAttempted.promise,
      `permanent rejection cleanup attempted`,
    )
    await turn()

    expect(status).toBe(primaryError)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      transaction.id,
    ])
    expect((await env.executor.peekOutbox())[0]).toMatchObject({
      outboxPhase: `rejection-pending`,
      lastError: { message: primaryError.message },
    })
    expect(providerCalls).toBe(1)

    env.executor.dispose()
    storage.failDeletes = false
    restarted = createTestOfflineEnvironment({
      storage,
      mutationFn: () => {
        providerCalls++
      },
    })
    observedReplay = restarted.executor
      .waitForTransactionCompletion(transactionId)
      .then(
        () => {
          replayStatus = `fulfilled`
        },
        (error: unknown) => {
          replayStatus = error
        },
      )
    await restarted.waitForLeader()
    await atOracleCheckpoint(
      restartedDeletionAttempted.promise,
      `terminal rejection deletion retried after restart`,
    )
    expect(providerCalls).toBe(1)
    expect(restarted.collection.toArray).toEqual([])
    releaseRestartedDeletion.resolve()
    await atOracleCheckpoint(observedReplay, `terminal replay settled`)
    expect(replayStatus).toMatchObject({
      name: primaryError.name,
      message: primaryError.message,
    })
    expect(await restarted.executor.peekOutbox()).toEqual([])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseRestartedDeletion.resolve()
    if (status === `pending` && transactionId)
      env.executor.rejectTransaction(transactionId, primaryError)
    if (replayStatus === `pending` && transactionId)
      restarted?.executor.rejectTransaction(transactionId, primaryError)
    await cleanupOfflineOracle(
      [
        () => observed,
        () => observedReplay,
        () => env.executor.dispose(),
        () => restarted?.executor.dispose(),
        () => env.collection.cleanup(),
        () => restarted?.collection.cleanup(),
        () => warning.mockRestore(),
      ],
      hasPrimaryFailure,
    )
  }
}

it.each([`provider`, `hook`] as const)(
  `preserves terminal %s failure when rejection cleanup also fails`,
  checkTerminalFailureWithFailedDeletion,
)

// The row-local hook law ends when terminal storage fails. A failed marker or
// deletion leaves the head's durable ownership unresolved, so the executor
// must stop before the queued peer runs. The failed head keeps the hook error;
// the batch reports the storage error. Provider-failure deletion is an adjacent
// control that preserves the established storage-stop boundary.
it.each([
  [`provider`, `deletion`],
  [`hook`, `marker`],
  [`hook`, `deletion`],
] as const)(
  `stops queued work after %s terminal failure and failed %s`,
  async (failureKind, failedStep) => {
    const providerError =
      failureKind === `provider`
        ? new NonRetriableError(`provider rejected`)
        : new Error(`HTTP 401 Unauthorized`)
    const hookError = new Error(`retry decision failed`)
    const callerError = failureKind === `hook` ? hookError : providerError
    const storageError = new Error(`${failedStep} rejected`)
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    class Storage extends FakeStorageAdapter {
      failCleanup = true

      override async set(key: string, value: string): Promise<void> {
        if (
          this.failCleanup &&
          failedStep === `marker` &&
          key === `tx:terminal-cleanup-head` &&
          (JSON.parse(value) as { outboxPhase?: string }).outboxPhase ===
            `rejection-pending`
        )
          throw storageError
        await super.set(key, value)
      }

      override async delete(key: string): Promise<void> {
        if (this.failCleanup && failedStep === `deletion`) throw storageError
        await super.delete(key)
      }
    }
    const storage = new Storage()
    const outbox = new OutboxManager(storage, {})
    const scheduler = new KeyScheduler()
    const rejections: Array<{ id: string; error: Error }> = []
    const resolutions: Array<string> = []
    let peerCalls = 0
    const signaler: TransactionSignaler = {
      isOfflineEnabled: true,
      isOnline: () => true,
      resolveTransaction: (id) => resolutions.push(id),
      rejectTransaction: (id, error) => rejections.push({ id, error }),
      registerRestorationTransaction: () => {},
    }
    const executor = new TransactionExecutor(
      scheduler,
      outbox,
      {
        collections: {},
        mutationFns: {
          syncData: () => Promise.reject(providerError),
          peer: () => {
            peerCalls++
            return Promise.resolve()
          },
        },
        ...(failureKind === `hook`
          ? {
              shouldRetry: () => {
                throw hookError
              },
            }
          : {}),
        jitter: false,
      },
      signaler,
    )
    const transaction: OfflineTransaction = {
      id: `terminal-cleanup-head`,
      mutationFnName: `syncData`,
      mutations: [],
      keys: [],
      idempotencyKey: `terminal-cleanup-head`,
      createdAt: new Date(0),
      retryCount: 0,
      nextAttemptAt: 0,
      version: 1,
    }
    const peer: OfflineTransaction = {
      ...transaction,
      id: `terminal-cleanup-peer`,
      mutationFnName: `peer`,
      idempotencyKey: `terminal-cleanup-peer`,
      createdAt: new Date(1),
    }
    await outbox.add(transaction)
    await outbox.add(peer)
    scheduler.schedule(peer)
    try {
      await expect(executor.execute(transaction)).rejects.toBe(storageError)
      expect(rejections).toEqual([{ id: transaction.id, error: callerError }])
      expect(resolutions).toEqual([])
      expect(peerCalls).toBe(0)
      expect(scheduler.getPendingCount()).toBe(2)
      expect((await outbox.get(transaction.id))?.outboxPhase).toBe(
        failedStep === `deletion` ? `rejection-pending` : undefined,
      )
      expect(await outbox.get(peer.id)).toMatchObject({ id: peer.id })

      storage.failCleanup = false
      executor.resetRetryDelays()
      await expect(executor.executeAll()).rejects.toBe(storageError)
      await expect(executor.execute(peer)).rejects.toBe(storageError)
      expect(peerCalls).toBe(0)
      expect(resolutions).toEqual([])
      expect(scheduler.getPendingCount()).toBe(2)
      expect(await outbox.get(peer.id)).toMatchObject({ id: peer.id })
    } finally {
      executor.pause()
      warning.mockRestore()
    }
  },
)

it(`stops after failed deletion without rerunning the provider`, async () => {
  const storageError = new Error(`delete rejected`)
  const rejections: Array<Error> = []
  const retryCounts: Array<number> = []
  const delay = vi.spyOn(DefaultRetryPolicy.prototype, `calculateDelay`)
  delay.mockImplementation((retryCount) => {
    retryCounts.push(retryCount)
    return 60_000
  })
  class Storage extends FakeStorageAdapter {
    override delete(): Promise<void> {
      return Promise.reject(storageError)
    }
  }
  const outbox = new OutboxManager(new Storage(), {})
  const scheduler = new KeyScheduler()
  let providerCalls = 0
  const signaler: TransactionSignaler = {
    isOfflineEnabled: true,
    isOnline: () => true,
    resolveTransaction: () => {
      throw new Error(`deletion has not succeeded`)
    },
    rejectTransaction: (_id, error) => rejections.push(error),
    registerRestorationTransaction: () => {},
  }
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {
        syncData: () => {
          providerCalls++
          return Promise.resolve()
        },
      },
      jitter: false,
    },
    signaler,
  )
  const transaction: OfflineTransaction = {
    id: `deletion-backoff`,
    mutationFnName: `syncData`,
    mutations: [],
    keys: [],
    idempotencyKey: `deletion-backoff`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    version: 1,
  }
  await outbox.add(transaction)
  try {
    await expect(executor.execute(transaction)).rejects.toBe(storageError)
    executor.resetRetryDelays()
    await expect(executor.executeAll()).rejects.toBe(storageError)
    expect(retryCounts).toEqual([])
    expect(rejections).toEqual([storageError])
    expect(providerCalls).toBe(1)
    expect((await outbox.get(transaction.id))?.outboxPhase).toBe(
      `deletion-pending`,
    )
  } finally {
    executor.pause()
    delay.mockRestore()
  }
})
