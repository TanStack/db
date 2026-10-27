import fc from 'fast-check'
import { createCollection, createTransaction } from '@tanstack/db'
import { expect, it, vi } from 'vitest'
import { NonRetriableError } from '../src/types'
import { OutboxManager } from '../src/outbox/OutboxManager'
import {
  oracleReplayRequested,
  oracleReplayTest,
} from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import { gate, turn } from './transaction-settlement-support'
import {
  atOracleCheckpoint,
  captureUnhandledRejections,
  cleanupOfflineOracle,
} from './oracle-lifecycle'
import { oracleLaneOptions, readOfflineOracleConfig } from './oracle-config'
import type { TestItem } from './harness'
import type { Transaction } from '@tanstack/db'
import type { OfflineConfig } from '../src/types'

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
 * keys, and success or permanent failure at each position. Each transaction
 * either commits manually or auto-commits after its `mutate()` callback, with
 * `autoCommit: true`, with the option omitted, or as an `OfflineAction`. An
 * auto-commit has no `commit()` caller, so its `isPersisted` is the commit
 * receipt. No failure, manual or auto-committed, may escape as an unhandled
 * process rejection, be logged again, or write debug output. Any position may
 * be preceded by an empty transaction on the same commit path: its callback
 * writes nothing, so it completes without the provider or the outbox, and its
 * receipt and `waitForTransactionCompletion` fulfil before any provider
 * settles. A manual transaction that rolls back before it commits may also
 * precede a position. It also settles without the provider, so its waiter
 * must reject with an Error that names the rollback. Once a transaction's
 * mutation function runs, only the executor settles its waiter. When every
 * transaction has settled, a new waiter for each one rejects instead of
 * waiting forever. A callback that
 * throws leaves its transaction pending, as core
 * transactions do, so its waiter stays pending too; that case is not
 * generated. When nobody reads an auto-commit's receipt, the Collection that
 * tracks the transaction owns its rejection; every generated transaction
 * writes to one. A caller may also register its completion waiter before the
 * transaction is admitted. Pinned examples
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
 * count once. An Error created in another JavaScript realm is still that
 * original Error; its status field remains available to the hook.
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
 * without another outbox entry. If that call rejects instead, a retry decision
 * cannot recreate the removed row. Both caller promises reject with the named
 * mutation function Error, the removed row stays absent, and the same executor
 * can process later work. This law covers acknowledged removal before the
 * provider settles, for both public removal methods and both the default and
 * overridden retry decision.
 * Here, an offline executor restart constructs a fresh executor over the retained
 * outbox. Outbox replay resumes unfinished durable work, including terminal-phase
 * deletion; neither operation is a Collection sync restart or truncate replay.
 * To replay one oracle shrink directly, set TANSTACK_DB_ORACLE_SEED,
 * TANSTACK_DB_ORACLE_PATH, and TANSTACK_DB_ORACLE_PROPERTY to the failing
 * campaign's property (`offline.settlement.*`). The other campaigns in this
 * file stand aside.
 */

// Each campaign is its own replay property, because a recorded path belongs to
// one generator. A path replay of a campaign's property runs only that campaign.
const SETTLEMENT_PROPERTY = `offline.settlement.transaction`
const RETRY_RECORD_PROPERTY = `offline.settlement.retry-record`
const ADMISSION_PROPERTY = `offline.settlement.admission`
const RETRY_DECISION_PROPERTY = `offline.settlement.retry-decision`
const settlementOracle = readOfflineOracleConfig({
  property: SETTLEMENT_PROPERTY,
  defaultRuns: 40,
})
const retryRecordOracle = readOfflineOracleConfig({
  property: RETRY_RECORD_PROPERTY,
  defaultRuns: 20,
})
const admissionOracle = readOfflineOracleConfig({
  property: ADMISSION_PROPERTY,
  defaultRuns: 10,
})

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

// The model of public Collection rows after a restored snapshot settles. The
// server rows are the durable provider results so far, and each queued restored
// row is still visible. Restoration holds pending snapshots. Core rollback
// cancels conflicting pending peers, but not disjoint peers or their
// independently queued work.
function expectedRestoredLocalRows(
  rows: Array<TestItem>,
  sharedKey: boolean,
  failedIndex: number,
  index: number,
  expectedServer: Map<string, TestItem>,
): Map<string, TestItem> {
  const pending = sharedKey && index >= failedIndex ? [] : rows.slice(index + 1)
  const expected = new Map(expectedServer)
  for (const row of pending) expected.set(row.id, row)
  return expected
}

/**
 * How a generated transaction commits: by `commit()`, by auto-commit with the
 * option set or omitted, or as an `OfflineAction`, which always auto-commits.
 */
type SettlementCommit = `manual` | `auto` | `default` | `action`

const settlementTransaction = fc
  .record({
    succeeds: fc.boolean(),
    commit: fc.constantFrom<SettlementCommit>(
      `manual`,
      `auto`,
      `default`,
      `action`,
    ),
    readReceipt: fc.boolean(),
    // The caller may wait for completion before the transaction is admitted,
    // which only a transaction object made before mutate() allows.
    waitBefore: fc.boolean(),
    // An empty transaction on the same commit path runs first. Its callback
    // writes nothing, so it completes without the provider or the outbox.
    emptyBefore: fc.boolean(),
    // A manual transaction writes a row of its own and rolls back before it
    // commits. It also settles without the provider, and its waiter rejects
    // with an Error that names the rollback.
    rolledBackBefore: fc.boolean(),
  })
  .map((tx) =>
    // An OfflineAction has no transaction object before mutate().
    tx.commit === `action` ? { ...tx, waitBefore: false } : tx,
  )

const checkSettlement = async (seed: number | undefined): Promise<void> => {
  await fc.assert(
    fc.asyncProperty(
      // One record per transaction, so every commit path and an unread
      // receipt are as likely at every position.
      fc.record({
        sharedKeys: fc.boolean(),
        width: fc.integer({ min: 1, max: 3 }),
        transactions: fc.array(settlementTransaction, {
          minLength: 2,
          maxLength: 5,
        }),
      }),
      async ({ sharedKeys, width, transactions }) => {
        const succeeds = transactions.map((tx) => tx.succeeds)
        // Every path but a manual commit commits after the mutate callback.
        const autoCommits = transactions.map((tx) => tx.commit !== `manual`)
        // An auto-commit's receipt may go unread, as a caller may.
        const unread = transactions.map(
          (tx, index) => autoCommits[index]! && !tx.readReceipt,
        )
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
        // Empty and rolled-back transactions, which settle without the provider.
        const settledIds: Array<string> = []
        const made: Array<Transaction> = []
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
          const expectedStatuses = Object.fromEntries([
            ...emptyReceipts.map((name) => [name, `fulfilled`]),
            // A plain rollback rejects isPersisted with no reason (core
            // contract); the waiter names the rollback with an Error.
            ...rolledBack.flatMap(({ wait, receipt }) => [
              [receipt, undefined],
              [wait, `Offline transaction was rolled back`],
            ]),
            ...ids.flatMap((_id, index) => {
              const status =
                index < completed
                  ? succeeds[index]
                    ? `fulfilled`
                    : failures[index]!.message
                  : `pending`
              return [
                ...(unread[index] ? [] : [[`commit-${index}`, status]]),
                [`wait-${index}`, status],
              ]
            }),
          ])
          expect(actualStatuses).toEqual(expectedStatuses)
          if (completed === 1) {
            expect(() =>
              expect({ ...actualStatuses, 'wait-1': `fulfilled` }).toEqual(
                expectedStatuses,
              ),
            ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
          }
          for (let index = 0; index < completed; index++) {
            if (!succeeds[index]) {
              if (!unread[index])
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
            ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
          }
          expect((await env.executor.peekOutbox()).map((tx) => tx.id)).toEqual(
            ids.slice(completed),
          )
        }
        // Receipts of empty transactions, which settle before any provider.
        const emptyReceipts: Array<string> = []
        // Receipts of transactions rolled back before they commit.
        const rolledBack: Array<{ wait: string; receipt: string }> = []
        // Start a transaction on one commit path. An auto-commit has no
        // commit() caller; its receipt is isPersisted, which settles like a
        // manual commit's.
        const start = (
          commit: SettlementCommit,
          write: () => void,
          beforeMutate?: (id: string) => void,
        ) => {
          if (commit === `action`) {
            const transaction = env.executor.createOfflineAction({
              mutationFnName: env.mutationFnName,
              onMutate: write,
            })(undefined)
            return {
              transaction,
              receipt: () => transaction.when(`settled`),
            }
          }
          const tx = env.executor.createOfflineTransaction({
            mutationFnName: env.mutationFnName,
            // A transaction auto-commits when the option is omitted.
            ...(commit === `default` ? {} : { autoCommit: commit === `auto` }),
          })
          beforeMutate?.(tx.id)
          const transaction = tx.mutate(write)
          return {
            transaction,
            receipt: (): Promise<unknown> =>
              commit === `manual` ? tx.commit() : transaction.when(`settled`),
          }
        }
        let hasPrimaryFailure = false
        // No failure, manual or auto-committed, escapes as an unhandled
        // process rejection, and none is logged again: isPersisted reports
        // it.
        const { rejections: unhandled, cleanup: cleanupUnhandled } =
          captureUnhandledRejections()
        const logged = vi.spyOn(console, `error`).mockImplementation(() => {})
        // Settlement writes no debug output.
        const debug = vi.spyOn(console, `log`).mockImplementation(() => {})
        try {
          await env.waitForLeader()
          for (let index = 0; index < succeeds.length; index++) {
            const { commit, emptyBefore, rolledBackBefore } =
              transactions[index]!
            if (rolledBackBefore) {
              const tx = env.executor.createOfflineTransaction({
                mutationFnName: env.mutationFnName,
                autoCommit: false,
              })
              const transaction = tx.mutate(() =>
                env.collection.insert({
                  id: `rolled-${index}`,
                  value: `rolled`,
                  completed: false,
                  updatedAt: new Date(0),
                }),
              )
              const names = {
                wait: `rolled-wait-${index}`,
                receipt: `rolled-receipt-${index}`,
              }
              observe(
                names.wait,
                env.executor.waitForTransactionCompletion(transaction.id),
              )
              observe(names.receipt, transaction.when(`settled`))
              rolledBack.push(names)
              settledIds.push(transaction.id)
              tx.rollback()
            }
            if (emptyBefore) {
              const empty = start(commit, () => {})
              observe(
                `empty-wait-${index}`,
                env.executor.waitForTransactionCompletion(empty.transaction.id),
              )
              emptyReceipts.push(`empty-wait-${index}`)
              settledIds.push(empty.transaction.id)
              if (!unread[index]) {
                observe(`empty-commit-${index}`, empty.receipt())
                emptyReceipts.push(`empty-commit-${index}`)
              }
            }
            const write = () => {
              for (const row of expectedRows[index]!) {
                if (sharedKeys && index > 0) {
                  env.collection.update(row.id, (draft) => {
                    draft.value = row.value
                    draft.updatedAt = row.updatedAt
                  })
                } else env.collection.insert(row)
              }
            }
            const waitFor = (id: string) =>
              observe(
                `wait-${index}`,
                env.executor.waitForTransactionCompletion(id),
              )
            const { transaction, receipt } = start(
              commit,
              write,
              transactions[index]!.waitBefore ? waitFor : undefined,
            )
            ids.push(transaction.id)
            made.push(transaction)
            if (!(`wait-${index}` in statuses)) waitFor(transaction.id)
            if (!unread[index]) observe(`commit-${index}`, receipt())
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
          await turn()
          expect(unhandled, `unhandled rejections`).toEqual([])
          // A waiter registered after its transaction settled has nothing to
          // wait for, so it rejects instead of hanging. This covers every
          // settlement path: the provider, an empty transaction, and a
          // rollback before commit. An id this executor never saw can still
          // arrive from another tab, so its waiter stays pending.
          const lateOutcome = (id: string) =>
            env.executor.waitForTransactionCompletion(id).then(
              () => `fulfilled`,
              (error: unknown) =>
                error instanceof Error &&
                error.message.includes(`already settled`)
                  ? `rejected`
                  : `wrong rejection: ${String(error)}`,
            )
          const late = [...ids, ...settledIds].map((id) => ({
            id,
            outcome: lateOutcome(id),
          }))
          const unknown = lateOutcome(`never-queued`)
          await turn()
          const pending = turn().then(() => `pending`)
          for (const { id, outcome } of late)
            expect(
              await Promise.race([outcome, pending]),
              `late waiter for ${id}`,
            ).toBe(`rejected`)
          expect(
            await Promise.race([unknown, pending]),
            `waiter for an unknown id`,
          ).toBe(`pending`)
          // A receipt nobody read still settles with its own outcome; read
          // it only now, after the unhandled-rejection checkpoint.
          for (const [index, transaction] of made.entries()) {
            if (!unread[index]) continue
            if (succeeds[index])
              await expect(transaction.when(`settled`)).resolves.toBe(
                transaction,
              )
            else
              await expect(transaction.when(`settled`)).rejects.toBe(
                failures[index],
              )
          }
          // A failure of the mutation function is reported through the
          // receipt only; nothing is logged as an error.
          expect(logged.mock.calls, `errors logged`).toEqual([])
          expect(debug.mock.calls, `debug output`).toEqual([])
        } catch (error) {
          hasPrimaryFailure = true
          throw error
        } finally {
          cleanupUnhandled()
          logged.mockRestore()
          debug.mockRestore()
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
      ...oracleLaneOptions(settlementOracle, seed),
      examples: [
        [
          {
            sharedKeys: true,
            width: 1,
            transactions: [
              {
                succeeds: true,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
              {
                succeeds: true,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
            ],
          },
        ],
        [
          {
            sharedKeys: false,
            width: 2,
            transactions: [
              {
                succeeds: true,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
              {
                succeeds: false,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
              {
                succeeds: true,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
            ],
          },
        ],
        [
          {
            sharedKeys: true,
            width: 2,
            transactions: [
              {
                succeeds: false,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
              {
                succeeds: false,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
              {
                succeeds: false,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
            ],
          },
        ],
        [
          {
            sharedKeys: true,
            width: 1,
            transactions: [
              {
                succeeds: false,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
              {
                succeeds: true,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
              {
                succeeds: false,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
            ],
          },
        ],
        [
          {
            sharedKeys: true,
            width: 1,
            transactions: [
              {
                succeeds: false,
                commit: `auto`,
                readReceipt: false,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: false,
              },
              {
                succeeds: true,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: true,
              },
              {
                succeeds: false,
                commit: `auto`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: false,
              },
            ],
          },
        ],
        // A failed auto-commit with the default option, and a failed
        // action, settle through isPersisted only.
        [
          {
            sharedKeys: false,
            width: 1,
            transactions: [
              {
                succeeds: false,
                commit: `default`,
                readReceipt: false,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: false,
              },
              {
                succeeds: false,
                commit: `action`,
                readReceipt: true,
                emptyBefore: false,
                rolledBackBefore: false,
                waitBefore: false,
              },
            ],
          },
        ],
        // Empty transactions on every commit path complete without the
        // provider, before and between real ones.
        [
          {
            sharedKeys: false,
            width: 1,
            transactions: [
              {
                succeeds: true,
                commit: `manual`,
                readReceipt: true,
                emptyBefore: true,
                rolledBackBefore: true,
                waitBefore: false,
              },
              {
                succeeds: false,
                commit: `auto`,
                readReceipt: false,
                emptyBefore: true,
                rolledBackBefore: true,
                waitBefore: false,
              },
              {
                succeeds: true,
                commit: `default`,
                readReceipt: true,
                emptyBefore: true,
                rolledBackBefore: true,
                waitBefore: false,
              },
              {
                succeeds: true,
                commit: `action`,
                readReceipt: true,
                emptyBefore: true,
                rolledBackBefore: true,
                waitBefore: false,
              },
            ],
          },
        ],
      ],
    },
  )
}

oracleReplayTest(it).each([20260913])(
  `settles each transaction independently while preserving FIFO (seed %s)`,
  checkSettlement,
)
oracleReplayTest(it, SETTLEMENT_PROPERTY).each([undefined])(
  `settles each transaction independently while preserving FIFO (seed %s)`,
  checkSettlement,
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
        const expected = expectedRestoredLocalRows(
          rows,
          sharedKey,
          failedIndex,
          index,
          expectedServer,
        )
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
const retryDecisionOracle = readOfflineOracleConfig({
  property: RETRY_DECISION_PROPERTY,
  defaultRuns: 12,
  reservedRuns: retryDecisionExamples.length,
})

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
async function checkRetryDecision(seed: number | undefined): Promise<void> {
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
          expect([...env.serverState.keys()].sort()).toEqual(expected.localRows)
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
      ...oracleLaneOptions(retryDecisionOracle, seed),
      examples: retryDecisionExamples,
    },
  )
  if (!oracleReplayRequested())
    expect([...reachedCases].sort()).toEqual(
      retryDecisionCases
        .map(({ errorKind, hook }) => `${errorKind}:${hook}`)
        .sort(),
    )
}

oracleReplayTest(it).each([20261008])(
  `refines an optional retry decision at the durable FIFO checkpoint (seed %s)`,
  checkRetryDecision,
)
oracleReplayTest(it, RETRY_DECISION_PROPERTY).each([undefined])(
  `refines an optional retry decision at the durable FIFO checkpoint (seed %s)`,
  checkRetryDecision,
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
      const persisted = transaction.when(`settled`).then(
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
      ...oracleLaneOptions(retryRecordOracle, seed),
      examples: [[2], [5]],
    },
  )
}

oracleReplayTest(it).each([20260916])(
  `keeps admitted transactions pending when a peer's retry record cannot be updated (seed %s)`,
  checkRetryRecordFailure,
)
oracleReplayTest(it, RETRY_RECORD_PROPERTY).each([undefined])(
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
      ...oracleLaneOptions(admissionOracle, seed),
      examples: [[0], [1], [2]],
    },
  )
}

oracleReplayTest(it).each([20260916])(
  `rejects only the transaction whose durable admission fails (seed %s)`,
  checkDurableAdmissionFailure,
)
oracleReplayTest(it, ADMISSION_PROPERTY).each([undefined])(
  `rejects only the transaction whose durable admission fails (seed %s)`,
  checkDurableAdmissionFailure,
)

// The checks run generated histories and compare production with each model's
// prediction at every checkpoint. The models state the settlement rules: the
// retry decision table and FIFO local rows, and the visibility and provider
// eligibility of a started peer. Fixed scenarios whose expectations are
// written by hand are not oracle tests; they live in transaction-settlement.test.ts.
declareOracle({
  check: [
    checkSettlement,
    checkRetryDecision,
    checkRetryRecordFailure,
    checkDurableAdmissionFailure,
  ],
  model: [
    expectedRetryDecision,
    expectedRestoredLocalRows,
    expectedStartedPeer,
  ],
})
