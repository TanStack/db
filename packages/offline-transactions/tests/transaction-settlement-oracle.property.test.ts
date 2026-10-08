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
 * `true` retries, `false` terminates, and `undefined` delegates to the existing
 * default decision. An absent hook also uses that default. `NonRetriableError`
 * remains permanent without consulting the hook. The existing default policy
 * still supplies retry delay with the configured jitter setting. This oracle
 * checks the default delay path with jitter disabled, not jitter math. The
 * exported default currently treats a 401 message as terminal and an ordinary
 * transient error as retryable. These are preservation controls, while the hook
 * rule is the chosen new law.
 * At the durable decision checkpoint, a retry retains the offline transaction
 * at the FIFO head, the public Collection's optimistic state, and both caller
 * promises. The outer optimistic transaction remains pending during retry.
 * A terminal decision removes the outbox entry, rejects those promises with
 * the named mutation function Error, and lets the queued peer run. The controlled
 * provider and storage do not establish real timer accuracy or server idempotency.
 * A throwing hook or a result outside `true`, `false`, and `undefined` is a
 * configuration failure. The affected public `commit()` promise rejects with
 * that failure, and no retry record is published. The executor stops and
 * releases its active slot. This witness does not judge outbox replay after an
 * offline executor restart over that admitted offline transaction.
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

const retryDecisionCases = [
  { errorKind: `auth`, hook: `retry` },
  { errorKind: `auth`, hook: `defer` },
  { errorKind: `auth`, hook: `absent` },
  { errorKind: `ordinary`, hook: `terminal` },
  { errorKind: `ordinary`, hook: `defer` },
  { errorKind: `ordinary`, hook: `absent` },
  { errorKind: `permanent`, hook: `retry` },
] as const

type RetryDecisionCase = (typeof retryDecisionCases)[number]
const retryDecisionExamples: Array<[RetryDecisionCase, number]> = [
  ...retryDecisionCases.map((scenario): [RetryDecisionCase, number] => [
    scenario,
    1,
  ]),
  [retryDecisionCases[0]!, 3],
]

// This table is the contract model, not a copy of the executor. The permanent
// error has no configurable decision. Otherwise an explicit hook answer wins;
// delegation uses the two established default controls in this grammar. A
// retained FIFO head permits no peer call, while removal permits the first one.
function expectedRetryDecision(
  scenario: RetryDecisionCase,
  headId: string,
  peerIds: Array<string>,
  providerError: Error,
) {
  const retry =
    scenario.errorKind !== `permanent` &&
    (scenario.hook === `retry` ||
      (scenario.hook !== `terminal` && scenario.errorKind === `ordinary`))
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

// Legal histories have one failed FIFO head and 1–3 admitted peers. The seven
// pinned cases cross override, delegation, omission, and permanent failure;
// peer count varies independently. Removing auth retry loses the motivating
// override; removing ordinary terminal loses the opposite decision; removing
// defer or absent conflates two ways to retain default behavior for both error
// classes; removing the permanent case permits an explicit permanent failure
// to retry. One peer is the marginal FIFO witness, while three detect loss of
// a later admitted peer.
// A second failure and hook contract breach have separate witnesses below.
// Duplicate IDs and storage failures belong to other settlement grammars here.
it.each(oracleSeeds(20261008, retryDecisionOracle))(
  `refines an optional retry decision at the durable FIFO checkpoint (seed %s)`,
  async (seed) => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...retryDecisionCases),
        fc.integer({ min: 1, max: 3 }),
        async (scenario, peerCount) => {
          const providerError =
            scenario.errorKind === `permanent`
              ? new NonRetriableError(`validation rejected`)
              : new Error(
                  scenario.errorKind === `auth`
                    ? `HTTP 401 Unauthorized`
                    : `temporary connection failure`,
                )
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
              )
                decisionStored.resolve()
            }

            override async delete(key: string): Promise<void> {
              await super.delete(key)
              if (key === `tx:${headId}`) decisionStored.resolve()
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
        examples: retryDecisionExamples,
      },
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

// A configuration failure is observed through public commit(), not only the
// executor's internal batch promise. The provider error is a 401, so ignoring
// the hook would instead take the established terminal path. The retained
// outbox row distinguishes failure before a retry decision from a terminal one.
it.each([`throw`, `invalid`] as const)(
  `rejects public commit when shouldRetry fails (%s)`,
  async (failureKind) => {
    const providerError = new Error(`HTTP 401 Unauthorized`)
    const hookError = new Error(`retry decision unavailable`)
    const providerEntered = gate()
    const releaseProvider = gate()
    let hookCalls = 0
    const config = {
      jitter: false,
      shouldRetry: (
        _error: Error,
        _retryCount: number,
      ): boolean | undefined => {
        hookCalls++
        if (failureKind === `throw`) throw hookError
        return null as unknown as boolean | undefined
      },
    }
    const env = createTestOfflineEnvironment({
      config,
      mutationFn: async () => {
        providerEntered.resolve()
        await releaseProvider.promise
        throw providerError
      },
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let transactionId = ``
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
      await atOracleCheckpoint(
        observedCommit,
        `invalid decision settled caller`,
      )

      if (failureKind === `throw`) expect(commitStatus).toBe(hookError)
      else {
        expect(commitStatus).toBeInstanceOf(Error)
        expect(commitStatus).not.toBe(providerError)
      }
      expect(hookCalls).toBe(1)
      const remaining = await env.executor.peekOutbox()
      expect(remaining).toHaveLength(1)
      expect(remaining[0]).toMatchObject({
        id: transactionId,
        retryCount: 0,
        nextAttemptAt: admitted!.nextAttemptAt,
      })
      expect(remaining[0]?.lastError).toBeUndefined()
      expect(remaining[0]?.outboxPhase).toBeUndefined()
      await turn()
      expect(env.executor.getRunningCount()).toBe(0)
      expect(env.mutationCalls).toHaveLength(1)
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
          () => env.collection.cleanup(),
          () => warning.mockRestore(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

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

it(`preserves permanent provider failure when rejection cleanup also fails`, async () => {
  const deletionAttempted = gate()
  const restartedDeletionAttempted = gate()
  const releaseRestartedDeletion = gate()
  const primaryError = new NonRetriableError(`provider rejected permanently`)
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
    mutationFn: () => {
      providerCalls++
      return Promise.reject(primaryError)
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
      name: `NonRetriableError`,
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
})

it(`stops the executor batch when terminal deletion fails`, async () => {
  const providerError = new NonRetriableError(`provider rejected`)
  const storageError = new Error(`delete rejected`)
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  class Storage extends FakeStorageAdapter {
    failDeletes = true
    override async delete(key: string): Promise<void> {
      if (this.failDeletes) throw storageError
      await super.delete(key)
    }
  }
  const storage = new Storage()
  const outbox = new OutboxManager(storage, {})
  const scheduler = new KeyScheduler()
  const rejections: Array<Error> = []
  const resolutions: Array<string> = []
  let peerCalls = 0
  const signaler: TransactionSignaler = {
    isOfflineEnabled: true,
    isOnline: () => true,
    resolveTransaction: (id) => resolutions.push(id),
    rejectTransaction: (_id, error) => rejections.push(error),
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
      jitter: false,
    },
    signaler,
  )
  const transaction: OfflineTransaction = {
    id: `terminal-delete-failure`,
    mutationFnName: `syncData`,
    mutations: [],
    keys: [],
    idempotencyKey: `terminal-delete-failure`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    version: 1,
  }
  const peer: OfflineTransaction = {
    ...transaction,
    id: `terminal-delete-peer`,
    mutationFnName: `peer`,
    idempotencyKey: `terminal-delete-peer`,
    createdAt: new Date(1),
  }
  await outbox.add(transaction)
  await outbox.add(peer)
  scheduler.schedule(peer)
  try {
    await expect(executor.execute(transaction)).rejects.toBe(storageError)
    expect(rejections).toEqual([providerError])
    expect(resolutions).toEqual([])
    expect(peerCalls).toBe(0)
    expect(scheduler.getPendingCount()).toBe(2)
    expect((await outbox.get(transaction.id))?.outboxPhase).toBe(
      `rejection-pending`,
    )

    storage.failDeletes = false
    executor.resetRetryDelays()
    await expect(executor.executeAll()).rejects.toBe(storageError)
    expect(peerCalls).toBe(0)
    expect(resolutions).toEqual([])
    expect(scheduler.getPendingCount()).toBe(2)
    expect((await outbox.get(transaction.id))?.outboxPhase).toBe(
      `rejection-pending`,
    )
  } finally {
    executor.pause()
    warning.mockRestore()
  }
})

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
