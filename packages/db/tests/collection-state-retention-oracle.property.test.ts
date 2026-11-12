import { fc } from '@fast-check/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DuplicateKeySyncError } from '../src/errors.js'
import {
  oracleProperty,
  oracleReplayRequested,
  oracleRoute,
} from './oracle-config.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from './oracle-assertion-adapter.js'
import {
  historyRow,
  optimisticHistory,
  runOptimisticHistory,
} from './optimistic-history-oracle.js'
import type {
  RetainedRow,
  SyncActions,
} from './collection-state-retention-fixture.js'
import type { HistoryRow, OptimisticStep } from './optimistic-history-oracle.js'
import type { Collection } from '../src/collection/index.js'

/**
 * Retained collection state is the last accepted source snapshot plus local
 * whole-row intent; restart changes ownership, not that value contract.
 *
 * A plain Map models source insert/update/delete and truncate-replace batches.
 * A separate lifecycle driver stops and restarts sync, including reentrant
 * commits before and after the old callback returns. The optimistic companion
 * model owns accepted local snapshots, rollback, and settlement. Neither model
 * borrows CollectionState's merge bookkeeping.
 *
 * The oracle compares retained source data, public rows, indexes, events, and
 * sync-run ownership after every cut. This makes stale-sync-run writes and rows
 * that vanish or reappear only after unrelated work observable. After a plain
 * restart, and while a reentrant restart's new transaction is still open, the
 * old run writes and commits a row. Cleanup ended that run, so the row never
 * appears and the commit returns `true`.
 *
 * A source insert of a held key is an equal re-insert only when its row value
 * equals the held one; otherwise it throws `DuplicateKeySyncError`. Row values
 * tell -0 from 0 (maintainer decision 2026-10-29), so values include -0, and
 * an insert that differs from the held row only by a zero's sign is a
 * duplicate (reach `sign-only-reinsert`).
 */

type RetentionAction =
  | { type: `insert`; row: RetainedRow }
  | { type: `update`; row: RetainedRow }
  | { type: `delete`; key: number }
  | { type: `replace`; rows: ReadonlyArray<RetainedRow> }
  | { type: `restart` }
  | {
      type: `reentrantRestart`
      row: RetainedRow
      commitPhase: `insideListener` | `afterOldReturn`
    }

type RetentionHarness = {
  collection: Collection<RetainedRow, number>
  sync: SyncActions
}

const retainedRowArbitrary = fc.record({
  id: fc.integer({ min: 0, max: 3 }),
  // Zeros of both signs are common, so an insert often differs from the
  // held row only by a zero's sign.
  value: fc.oneof(
    { weight: 3, arbitrary: fc.integer({ min: -2, max: 2 }) },
    { weight: 1, arbitrary: fc.constant(0) },
    { weight: 1, arbitrary: fc.constant(-0) },
  ),
})

type RetentionState = `sign-only-reinsert`

function snapshotRetainedRow(row: RetainedRow): RetainedRow {
  return { id: row.id, value: row.value }
}

const retentionActionArbitrary: fc.Arbitrary<RetentionAction> = fc.oneof(
  {
    weight: 4,
    arbitrary: retainedRowArbitrary.map((row) => ({
      type: `insert` as const,
      row,
    })),
  },
  {
    weight: 4,
    arbitrary: retainedRowArbitrary.map((row) => ({
      type: `update` as const,
      row,
    })),
  },
  {
    weight: 4,
    arbitrary: fc
      .integer({ min: 0, max: 3 })
      .map((key) => ({ type: `delete` as const, key })),
  },
  {
    weight: 2,
    arbitrary: fc
      .uniqueArray(retainedRowArbitrary, {
        selector: (row) => row.id,
        maxLength: 4,
      })
      .map((rows) => ({ type: `replace` as const, rows })),
  },
  { weight: 1, arbitrary: fc.constant({ type: `restart` as const }) },
  {
    // Keep each phase at least as likely as the original unsplit restart arm.
    weight: 3,
    arbitrary: fc
      .tuple(
        retainedRowArbitrary,
        fc.constantFrom(`insideListener` as const, `afterOldReturn` as const),
      )
      .map(([row, commitPhase]) => ({
        type: `reentrantRestart` as const,
        row,
        commitPhase,
      })),
  },
)

function createRetentionHarness(): RetentionHarness {
  let sync!: SyncActions
  const collection = createCollection<RetainedRow, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
  })
  return {
    collection,
    get sync() {
      return sync
    },
  }
}

function applyAction(
  action: RetentionAction,
  model: Map<number, RetainedRow>,
  sync: SyncActions,
  enter: (state: RetentionState) => void,
): void {
  sync.begin()
  switch (action.type) {
    case `insert`: {
      const previous = model.get(action.row.id)
      if (
        previous !== undefined &&
        previous.value === action.row.value &&
        !Object.is(previous.value, action.row.value)
      ) {
        enter(`sign-only-reinsert`)
      }
      if (
        previous !== undefined &&
        !Object.is(previous.value, action.row.value)
      ) {
        oracleAssertion('applyAction', () =>
          expect(() =>
            sync.write({
              type: `insert`,
              value: snapshotRetainedRow(action.row),
            }),
          ).toThrow(DuplicateKeySyncError),
        )
        break
      }
      const expectedRow = snapshotRetainedRow(action.row)
      sync.write({ type: `insert`, value: snapshotRetainedRow(action.row) })
      model.set(expectedRow.id, expectedRow)
      break
    }
    case `update`: {
      const expectedRow = snapshotRetainedRow(action.row)
      sync.write({ type: action.type, value: snapshotRetainedRow(action.row) })
      model.set(expectedRow.id, expectedRow)
      break
    }
    case `delete`:
      sync.write({ type: `delete`, key: action.key })
      model.delete(action.key)
      break
    case `replace`:
      sync.truncate()
      model.clear()
      for (const row of action.rows) {
        const expectedRow = snapshotRetainedRow(row)
        sync.write({ type: `insert`, value: snapshotRetainedRow(row) })
        model.set(expectedRow.id, expectedRow)
      }
      break
    case `restart`:
    case `reentrantRestart`:
      throw new Error(`Restart actions require the lifecycle driver`)
  }
  oracleAssertion('applyAction', () => expect(sync.commit()).toBe(true))
}

/**
 * Write and commit from a sync run that cleanup ended. Key 9 is outside the
 * generated keys, so a leaked write shows as an extra row.
 */
function writeFromEndedRun(sync: SyncActions): void {
  sync.begin()
  sync.write({ type: `insert`, value: { id: 9, value: 9 } })
  oracleAssertion(`stale sync run commit`, () =>
    expect(sync.commit(), `stale sync run commit`).toBe(true),
  )
}

function expectRetainedState(
  collection: Collection<RetainedRow, number>,
  model: ReadonlyMap<number, RetainedRow>,
): void {
  const expectedRows = [...model.entries()].sort(([a], [b]) => a - b)
  const retainedRows = [...collection.base.entries()].sort(([a], [b]) => a - b)

  oracleAssertion('expectRetainedState', () =>
    expect(retainedRows).toEqual(expectedRows),
  )
  oracleAssertion('expectRetainedState', () =>
    expect(
      [...collection._state.rowOrigins.keys()]
        .filter((key) => !model.has(key))
        .sort((a, b) => a - b),
    ).toEqual([]),
  )
  oracleAssertion('expectRetainedState', () =>
    expect(
      [...collection.state.entries()]
        .map(([key, row]) => [key, { id: row.id, value: row.value }] as const)
        .sort(([a], [b]) => a - b),
    ).toEqual(expectedRows),
  )
}

async function runRetentionHistory(
  actions: ReadonlyArray<RetentionAction>,
  enter: (state: RetentionState) => void = () => {},
): Promise<void> {
  const harness = createRetentionHarness()
  const { collection } = harness
  const model = new Map<number, RetainedRow>()
  let primaryFailure: unknown
  let failed = false
  let cleanupFailure: unknown
  let cleanupFailed = false
  try {
    expectRetainedState(collection, model)
    for (const action of actions) {
      if (action.type === `restart`) {
        const oldSync = harness.sync
        await collection.cleanup()
        collection.startSyncImmediate()
        model.clear()
        // Cleanup ended the old run, so its retained actions are inert. Its
        // commit returns `true`: the caller has nothing to wait for.
        writeFromEndedRun(oldSync)
      } else if (action.type === `reentrantRestart`) {
        const oldSync = harness.sync
        const triggerType = model.has(action.row.id) ? `update` : `insert`
        const triggerRow = {
          id: action.row.id,
          value: (model.get(action.row.id)?.value ?? action.row.value) + 1,
        }
        const expectedTriggerRow = snapshotRetainedRow(triggerRow)
        const restartedRow = {
          id: (action.row.id + 1) % 4,
          value: action.row.value + 1,
        }
        const expectedRestartedRow = snapshotRetainedRow(restartedRow)
        let cleanup: Promise<void> | undefined
        let restarted = false
        let restartedSync: SyncActions | undefined
        let restartedReceipt: true | Promise<void> | undefined
        const batches: Array<{
          changes: Array<{
            type: string
            key: string | number
            row: RetainedRow
            previousRow: RetainedRow | undefined
          }>
          rows: Array<RetainedRow>
        }> = []
        const subscription = collection.subscribeChanges(
          (changes) => {
            batches.push({
              changes: changes.map(({ type, key, value, previousValue }) => ({
                type,
                key,
                row: { id: value.id, value: value.value },
                previousRow:
                  previousValue === undefined
                    ? undefined
                    : {
                        id: previousValue.id,
                        value: previousValue.value,
                      },
              })),
              rows: [...collection.values()]
                .map(({ id, value }) => ({ id, value }))
                .sort((left, right) => left.id - right.id),
            })
            if (restarted) return
            restarted = true
            cleanup = collection.cleanup()
            collection.startSyncImmediate()
            restartedSync = harness.sync
            restartedSync.begin()
            restartedSync.write({
              type: `insert`,
              value: snapshotRetainedRow(restartedRow),
            })
            if (action.commitPhase === `insideListener`) {
              restartedReceipt = restartedSync.commit()
            }
          },
          { includeInitialState: false },
        )

        oldSync.begin()
        oldSync.write({
          type: `update`,
          value: snapshotRetainedRow(triggerRow),
        })
        oracleAssertion('runRetentionHistory', () =>
          expect(oldSync.commit()).toBe(true),
        )
        oracleAssertion('runRetentionHistory', () =>
          expect(restarted).toBe(true),
        )
        oracleAssertion('runRetentionHistory', () =>
          expect(restartedSync).toBeDefined(),
        )
        if (restartedSync === undefined) {
          throw new Error(`restarted sync run was not captured`)
        }
        if (action.commitPhase === `insideListener`) {
          oracleAssertion('runRetentionHistory', () =>
            expect(restartedReceipt).toBeDefined(),
          )
          if (restartedReceipt !== true) await restartedReceipt
        } else {
          // The new run's transaction is open here, so a stale write that
          // reached it would apply with the new run's commit.
          writeFromEndedRun(oldSync)
          oracleAssertion('runRetentionHistory', () =>
            expect(restartedSync!.commit()).toBe(true),
          )
        }
        const triggerRows = new Map(model)
        triggerRows.set(expectedTriggerRow.id, expectedTriggerRow)
        oracleAssertion('runRetentionHistory', () =>
          expect(batches).toEqual([
            {
              changes: [
                {
                  type: triggerType,
                  key: expectedTriggerRow.id,
                  row: expectedTriggerRow,
                  previousRow: model.get(expectedTriggerRow.id),
                },
              ],
              rows: [...triggerRows.values()].sort(
                (left, right) => left.id - right.id,
              ),
            },
            {
              // This subscriber observed the trigger, but did not request the
              // earlier initial state. Restart retracts its known old-sync-run row.
              changes: [
                {
                  type: `delete`,
                  key: expectedTriggerRow.id,
                  row: expectedTriggerRow,
                  previousRow: undefined,
                },
              ],
              rows: [],
            },
            {
              changes: [
                {
                  type: `insert`,
                  key: expectedRestartedRow.id,
                  row: expectedRestartedRow,
                  previousRow: undefined,
                },
              ],
              rows: [expectedRestartedRow],
            },
          ]),
        )
        subscription.unsubscribe()

        await cleanup
        model.clear()
        model.set(expectedRestartedRow.id, expectedRestartedRow)
      } else {
        applyAction(action, model, harness.sync, enter)
      }
      expectRetainedState(collection, model)
    }
  } catch (error) {
    primaryFailure = error
    failed = true
  } finally {
    try {
      await collection.cleanup()
    } catch (error) {
      cleanupFailure = error
      cleanupFailed = true
    }
  }
  if (cleanupFailed) {
    if (failed)
      throw new AggregateError(
        [cleanupFailure],
        `Retention history and cleanup both failed`,
        { cause: primaryFailure },
      )
    throw cleanupFailure
  }
  if (failed) throw primaryFailure
}

// The long churn history: a thousand unique keys, each inserted and deleted.
function uniqueKeyChurn(): Array<RetentionAction> {
  const keyCount = 1_000
  const actions: Array<RetentionAction> = []
  for (let key = 0; key < keyCount; key++) {
    actions.push({ type: `insert`, row: { id: key, value: key } })
    actions.push({ type: `delete`, key })
  }
  return actions
}
// Named regressions through the generated retention property's driver. The
// generated grammar maps its elements, so it cannot take these histories back.
const retentionFixedHistories: Array<{
  name: string
  actions: ReadonlyArray<RetentionAction>
}> = [
  {
    name: `retains only keys in the authoritative synced state`,
    actions: [
      { type: `insert`, row: { id: 1, value: 1 } },
      { type: `insert`, row: { id: 2, value: 2 } },
      { type: `delete`, key: 1 },
      { type: `update`, row: { id: 1, value: -1 } },
      { type: `replace`, rows: [{ id: 3, value: 0 }] },
      { type: `delete`, key: 3 },
    ],
  },
  {
    name: `retains a missing row introduced by a sync update`,
    actions: [{ type: `update`, row: { id: 1, value: 1 } }],
  },
  {
    name: `releases retained keys after long unique-key churn`,
    actions: uniqueKeyChurn(),
  },
]
oracleProperty({
  id: `collection-state.retention-fixed`,
  law: {
    statement: `Retained Collection state follows the independent source Map across source changes and sync-run cleanup and restart.`,
    authority: `The Collection sync and cleanup contracts, including the signed-zero reinsertion decision stated above`,
    limits: `Named regressions that the generated retention grammar cannot produce; each is replayed through the same driver and comparison.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: retentionFixedHistories,
  label: ({ name }) => name,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.retention-fixed`,
      plan,
      observe,
      () => runRetentionHistory(plan.history.actions),
    ),
  check: forwardAssertionJudgment,
})

const reentrantRestartCases = ([`insert`, `update`] as const).flatMap(
  (triggerType) =>
    ([`insideListener`, `afterOldReturn`] as const).map(
      (commitPhase) => [triggerType, commitPhase] as const,
    ),
)
async function runReentrantRestartCase([
  triggerType,
  commitPhase,
]: (typeof reentrantRestartCases)[number]): Promise<void> {
  await runRetentionHistory([
    ...(triggerType === `update`
      ? ([{ type: `insert`, row: { id: 1, value: 1 } }] as const)
      : []),
    {
      type: `reentrantRestart`,
      row: { id: 1, value: 1 },
      commitPhase,
    },
  ])
}
oracleProperty({
  id: `collection-state.retention-reentrant-restart`,
  law: {
    statement: `Retained Collection state follows the independent source Map when a listener restarts the sync run inside an old-sync-run commit.`,
    authority: `The Collection sync and cleanup contracts, including the signed-zero reinsertion decision stated above`,
    limits: `An insert or update trigger, with the restarted row committed inside the listener or after the old commit returns.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: reentrantRestartCases,
  label: ([triggerType, commitPhase]) =>
    `retains an old-sync-run ${triggerType} and a restarted row committed ${commitPhase}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.retention-reentrant-restart`,
      plan,
      observe,
      () => runReentrantRestartCase(plan.history),
    ),
  check: forwardAssertionJudgment,
})

// One element in ten writes a zero to a key, then inserts the other zero:
// random actions rarely put the two next to each other.
const signFlipArbitrary = fc
  .record({ id: fc.integer({ min: 0, max: 3 }), zero: fc.constantFrom(0, -0) })
  .map(({ id, zero }): Array<RetentionAction> => [
    { type: `update`, row: { id, value: zero } },
    { type: `insert`, row: { id, value: Object.is(zero, -0) ? 0 : -0 } },
  ])
const retentionHistory = fc
  .array(
    fc.oneof(
      { weight: 9, arbitrary: retentionActionArbitrary.map((a) => [a]) },
      { weight: 1, arbitrary: signFlipArbitrary },
    ),
    { minLength: 1, maxLength: 20 },
  )
  .map((elements) => elements.flat())

// Keep the original per-history dedupe and five-history minimum for
// sign-only reinsertion, independently in each generated campaign.
describe(`retained state campaign reach`, () => {
  let signOnlyReinserts = 0
  beforeEach(() => {
    signOnlyReinserts = 0
  })
  afterEach(({ task }) => {
    if (
      task.name !== `determinism` &&
      task.result?.state !== `fail` &&
      !oracleReplayRequested()
    )
      expect(
        signOnlyReinserts,
        `sign-only-reinsert history minimum`,
      ).toBeGreaterThanOrEqual(5)
  })
  oracleProperty({
    id: `collection-state.retention`,
    law: {
      statement: `Retained Collection state follows the independent source Map across source changes and sync-run cleanup and restart.`,
      authority: `The Collection sync and cleanup contracts, including the signed-zero reinsertion decision stated above`,
      limits: `The existing four-key source grammar and controlled restart callbacks; broader provider timing and concurrent local mutation histories remain outside this driver.`,
    },
    // What this oracle owns: the gap report judges the retained Collection state,
    // in state.ts and the sync writes that feed it in sync.ts, by this file's
    // tests.
    owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
    histories: {
      arbitrary: retentionHistory,
      runs: 100,
      fixedSeeds: [1_902],
      measured: [`sign-only-reinsert`],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) => {
      const entered = new Set<RetentionState>()
      return recordAssertionJudgment(
        `collection-state.retention`,
        plan,
        observe,
        () =>
          runRetentionHistory(plan.history, (state) => {
            if (!entered.has(state)) {
              entered.add(state)
              signOnlyReinserts++
              observe(`reach`, state)
            }
          }),
      )
    },
    check: forwardAssertionJudgment,
  })
})

// The partial-update production path reuses those histories and marks source batches
// partial from a separate stream, so the full-mode campaigns keep their
// seeded histories. It runs with the default `partial` row update mode.
const markPartial = (step: OptimisticStep, partial: boolean): OptimisticStep =>
  step.type === `sync`
    ? { ...step, partial }
    : (step.type === `edit` || step.type === `delete`) && step.inHandler
      ? { ...step, inHandler: { ...step.inHandler, partial } }
      : step
const partialHistory = fc
  .record({
    history: optimisticHistory,
    marks: fc.array(fc.boolean(), { minLength: 24, maxLength: 24 }),
  })
  .map(({ history, marks }) => ({
    initial: history.initial,
    steps: history.steps.map((step, index) => markPartial(step, marks[index]!)),
  }))

// These are fixed histories for the same model and driver as randomized runs,
// not separate assertions that only know the reported final state.
const directDeletionDropCases = [false, true].flatMap((acceptBeforeTruncate) =>
  [false, true].flatMap((replacementHasKey) =>
    [false, true].map((reinsert) => ({
      acceptBeforeTruncate,
      replacementHasKey,
      reinsert,
    })),
  ),
)
async function runDirectDeletionDropCase({
  acceptBeforeTruncate,
  replacementHasKey,
  reinsert,
}: (typeof directDeletionDropCases)[number]): Promise<void> {
  const row = { id: 1, a: 1, b: 2, c: 3 }
  const steps: Array<OptimisticStep> = [
    { type: `delete`, key: 1, optimistic: true },
    ...(acceptBeforeTruncate
      ? [{ type: `settle`, slot: 0, success: true, cascade: false } as const]
      : []),
    ...(reinsert
      ? [
          {
            type: `edit`,
            key: 1,
            fields: { a: 4 },
            optimistic: true,
          } as const,
        ]
      : []),
    {
      type: `sync`,
      rows: replacementHasKey ? [row] : [],
      truncate: true,
      copies: 1,
    },
    ...(!acceptBeforeTruncate
      ? [{ type: `settle`, slot: 0, success: true, cascade: false } as const]
      : []),
    ...(reinsert
      ? [{ type: `settle`, slot: 0, success: true, cascade: false } as const]
      : []),
    {
      type: `sync`,
      rows: [{ id: 2, a: 2, b: 2, c: 2 }],
      truncate: false,
      copies: 1,
    },
  ]
  const counts = await runOptimisticHistory([row], steps)
  expect(counts.deletes).toBe(1)
  expect(counts.settlements).toBe(reinsert ? 2 : 1)
}
oracleProperty({
  id: `collection-state.direct-deletion-drop`,
  law: {
    statement: `A direct deletion's optimistic state drops at settlement across a source replacement and a later sync, as the history model predicts.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `The eight orderings of acceptance before or after a truncate, a replacement with or without the key, and an optional re-insert.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: directDeletionDropCases,
  label: (row) =>
    `drops a direct deletion at settlement across replacement and later sync: ${JSON.stringify(row)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.direct-deletion-drop`,
      plan,
      observe,
      () => runDirectDeletionDropCase(plan.history),
    ),
  check: forwardAssertionJudgment,
})

// Fixed histories from review probes. A sync transaction still open when the mutation
// settles is not accepted, so it holds nothing and attributes nothing: after
// it commits or aborts, a later remote write is remote. A completed key that
// no queued sync touches stays remote while another key's sync is held.
const openSyncAttributionCases = [false, true].flatMap((optimistic) =>
  [false, true].map((commit) => ({ optimistic, commit })),
)
async function runOpenSyncAttributionCase({
  optimistic,
  commit,
}: (typeof openSyncAttributionCases)[number]): Promise<void> {
  const counts = await runOptimisticHistory(
    [{ id: 1, a: 0, b: 0, c: 0 }],
    [
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic },
      {
        type: `open`,
        batch: {
          type: `sync`,
          rows: [{ id: 1, a: 2, b: 0, c: 0 }],
          truncate: false,
          copies: 1,
        },
      },
      { type: `settle`, slot: 0, success: true, cascade: false },
      { type: `close`, commit },
      {
        type: `sync`,
        rows: [{ id: 1, a: 3, b: 0, c: 0 }],
        truncate: false,
        copies: 1,
      },
    ],
  )
  expect(counts.openBatches).toBe(1)
  expect(counts.abortedBatches).toBe(Number(!commit))
}
oracleProperty({
  id: `collection-state.open-sync-attribution`,
  law: {
    statement: `A sync transaction still open when a mutation settles is not accepted, holds nothing, and attributes nothing; a later remote write is remote.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `Fixed review-probe histories: an optimistic or non-optimistic edit with the open transaction committed or aborted.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: openSyncAttributionCases,
  label: (row) =>
    `attributes nothing to a sync transaction open at settlement: ${JSON.stringify(row)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.open-sync-attribution`,
      plan,
      observe,
      () => runOpenSyncAttributionCase(plan.history),
    ),
  check: forwardAssertionJudgment,
})
// Named regressions through the generated optimistic-history property's
// driver. The generated grammar maps its elements, so it cannot take these
// histories back.
const optimisticFixedHistories: Array<{
  name: string
  initial: Array<HistoryRow>
  steps: Array<OptimisticStep>
}> = [
  {
    name: `keeps an unrelated completed key remote while another key's sync is held`,
    initial: [
      { id: 1, a: 0, b: 0, c: 0 },
      { id: 2, a: 0, b: 0, c: 0 },
    ],
    steps: [
      { type: `edit`, key: 2, fields: { a: 2 }, optimistic: true },
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      {
        type: `sync`,
        rows: [{ id: 2, a: 5, b: 0, c: 0 }],
        truncate: false,
        copies: 1,
      },
      { type: `settle`, slot: 1, success: true, cascade: false },
      { type: `settle`, slot: 0, success: true, cascade: false },
      {
        type: `sync`,
        rows: [{ id: 1, a: 9, b: 0, c: 0 }],
        truncate: false,
        copies: 1,
      },
    ],
  },
  // Fixed regressions of random-campaign counterexamples. A rollback while a sync
  // transaction on its key is still open must publish the drop. When two
  // completed transactions are held on one key, the newer one's row shows.
  {
    name: `publishes a rollback while a sync transaction on its key is open`,
    initial: [],
    steps: [
      {
        type: `open`,
        batch: {
          type: `sync`,
          rows: [],
          deletes: [],
          truncate: false,
          copies: 1,
        },
      },
      { type: `edit`, key: 2, fields: { c: 0 }, optimistic: true },
      { type: `close`, commit: true },
      {
        type: `open`,
        batch: {
          type: `sync`,
          rows: [{ id: 2, a: 0, b: 0, c: 0 }],
          deletes: [],
          truncate: false,
          copies: 1,
        },
      },
      { type: `settle`, slot: 0, success: false, cascade: false },
      { type: `sync`, rows: [], deletes: [1], truncate: false, copies: 1 },
    ],
  },
  {
    name: `shows the newer of two held completed rows on one key`,
    initial: [],
    steps: [
      {
        type: `edit`,
        key: 1,
        fields: { c: 0 },
        optimistic: true,
        inHandler: {
          type: `sync`,
          rows: [],
          deletes: [],
          truncate: false,
          copies: 1,
        },
      },
      {
        type: `delete`,
        key: 1,
        optimistic: false,
        inHandler: {
          type: `sync`,
          rows: [],
          deletes: [1],
          truncate: false,
          copies: 1,
        },
      },
      {
        type: `sync`,
        rows: [{ id: 1, a: 0, b: 0, c: 0 }],
        deletes: [1],
        truncate: false,
        copies: 1,
      },
      { type: `edit`, key: 1, fields: { c: 1 }, optimistic: true },
      { type: `settle`, slot: 2, success: true, cascade: false },
      { type: `settle`, slot: 0, success: true, cascade: false },
      { type: `delete`, key: 1, optimistic: false },
    ],
  },
  {
    name: `publishes prior optimistic ownership when rollback reveals an identical authoritative row`,
    initial: [{ id: 3, a: 0, b: 0, c: 0 }],
    steps: [
      { type: `delete`, key: 3, optimistic: true },
      { type: `edit`, key: 3, fields: { c: 0 }, optimistic: true },
      { type: `sync`, rows: [], truncate: false, copies: 1 },
      { type: `settle`, slot: 0, success: true, cascade: false },
      { type: `settle`, slot: 0, success: false, cascade: false },
    ],
  },
]
oracleProperty({
  id: `collection-state.optimistic-fixed`,
  law: {
    statement: `Optimistic ownership, row publication and request settlement follow the independent history model.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `Named regressions that the generated optimistic-history grammar cannot produce; each is replayed through the same driver and comparison.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: optimisticFixedHistories,
  label: ({ name }) => name,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.optimistic-fixed`,
      plan,
      observe,
      async () => {
        await runOptimisticHistory(plan.history.initial, plan.history.steps)
      },
    ),
  check: forwardAssertionJudgment,
})

// Fixed regression of a random-campaign counterexample. A confirmed delete must clear the
// key's local attribution, so a later source reinsert is remote.
async function runSourceReinsertAttributionHistory(): Promise<void> {
  const row = { id: 2, a: 0, b: 0, c: 0 }
  const counts = await runOptimisticHistory(
    [],
    [
      {
        type: `sync`,
        rows: [row],
        truncate: false,
        copies: 1,
      },
      {
        type: `delete`,
        key: 2,
        optimistic: false,
        inHandler: {
          type: `sync`,
          rows: [],
          deletes: [2],
          truncate: false,
          copies: 1,
        },
      },
      {
        type: `edit`,
        key: 1,
        fields: { b: 0 },
        optimistic: false,
        inHandler: {
          type: `sync`,
          rows: [row],
          truncate: false,
          copies: 1,
        },
      },
    ],
  )
  expect(counts.sourceDeletes).toBe(1)
}
const sourceReinsertAttributionHistorys = [
  {
    name: `attributes a source reinsert after a confirmed delete to the source`,
  },
]
oracleProperty({
  id: `collection-state.source-reinsert-attribution`,
  law: {
    statement: `A confirmed delete clears the key's local attribution, so a later source reinsert is remote.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `One fixed regression of a random-campaign counterexample.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: sourceReinsertAttributionHistorys,
  label: ({ name }) => name,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.source-reinsert-attribution`,
      plan,
      observe,
      () => runSourceReinsertAttributionHistory(),
    ),
  check: forwardAssertionJudgment,
})

it(`writes source inserts and deletes in the fixed campaign`, async () => {
  oracleRoute(`fixed seed`)
  const histories = fc.sample(optimisticHistory, { seed: 86103, numRuns: 40 })
  let inserts = 0
  let deletes = 0
  let absentDeletes = 0
  for (const { initial, steps } of histories) {
    const counts = await runOptimisticHistory(initial, steps)
    inserts += counts.sourceInserts
    deletes += counts.sourceDeletes
    absentDeletes += counts.absentSourceDeletes
  }
  expect(inserts).toBeGreaterThan(0)
  expect(deletes).toBeGreaterThan(absentDeletes)
  expect(absentDeletes).toBeGreaterThan(0)
})

it(`writes distinguishing partial updates in the fixed partial campaign`, async () => {
  oracleRoute(`fixed seed`)
  const histories = fc.sample(partialHistory, { seed: 86104, numRuns: 40 })
  let distinguishing = 0
  for (const { initial, steps } of histories) {
    const counts = await runOptimisticHistory(initial, steps, undefined, {
      partialUpdates: true,
    })
    distinguishing += counts.distinguishingPartialUpdates
  }
  expect(distinguishing).toBeGreaterThan(0)
})

// Reach: an edit over an in-flight optimistic write that changes the
// visible row only by a zero's sign. Neither the pending-writes flag nor
// deep equality without signed zeros sees that change.
it(`writes zero-sign edits over in-flight writes in the fixed campaign`, async () => {
  oracleRoute(`fixed seed`)
  const histories = fc.sample(optimisticHistory, { seed: 86103, numRuns: 40 })
  let zeroSignEdits = 0
  for (const { initial, steps } of histories) {
    const counts = await runOptimisticHistory(initial, steps)
    zeroSignEdits += counts.zeroSignEditsOverPending
  }
  expect(zeroSignEdits).toBeGreaterThan(0)
})

// Fixed histories for a source delete of a key the source never held. The
// backend accepted an optimistic insert, then deleted the row before the
// source streamed it. The model's drain applies the delete to the applied
// synced rows, where it changes nothing, so the visible result follows from
// the settlement-drop law alone. The driver compares every step with the
// model; each count below proves the fixed history reached its premise.
function absentKeyDelete(truncate = false) {
  return {
    type: `sync` as const,
    rows: [],
    deletes: [1],
    truncate,
    copies: 1,
  }
}

// Committed while the insert persists, or inside its handler, the delete is
// queued. The settled insert's row is held with it, and the drop and the
// delete publish together, so the row is gone after settlement.
const absentKeyDeleteDropCases = [
  `while persisting`,
  `inside the handler`,
] as const
async function runAbsentKeyDeleteDropCase(
  delivery: (typeof absentKeyDeleteDropCases)[number],
): Promise<void> {
  const inHandler = delivery === `inside the handler`
  const counts = await runOptimisticHistory(
    [{ id: 2, a: 0, b: 0, c: 0 }],
    [
      {
        type: `edit`,
        key: 1,
        fields: { a: 1 },
        optimistic: true,
        ...(inHandler ? { inHandler: absentKeyDelete() } : {}),
      },
      ...(inHandler ? [] : [absentKeyDelete()]),
      { type: `settle`, slot: 0, success: true, cascade: false },
    ],
  )
  expect(counts.absentSourceDeletes).toBe(1)
  expect(counts.queued).toBe(1)
  expect(counts.handlerBatches).toBe(inHandler ? 1 : 0)
}
oracleProperty({
  id: `collection-state.absent-key-delete-drop`,
  law: {
    statement: `A queued source delete of a never-held key publishes with the settled insert's drop, so the row is gone after settlement.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `The delete committed while the insert persists or inside its handler.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: absentKeyDeleteDropCases,
  label: (delivery) =>
    `removes a settled insert in its drop publication when the source deletes a key it never held ${String(delivery)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.absent-key-delete-drop`,
      plan,
      observe,
      () => runAbsentKeyDeleteDropCase(plan.history),
    ),
  check: forwardAssertionJudgment,
})

// Once the optimistic state has dropped, the key is absent from the visible
// rows, and the delete changes nothing a reader can see.
async function runAbsentKeyDeleteAfterDropHistory(): Promise<void> {
  const counts = await runOptimisticHistory(
    [{ id: 2, a: 0, b: 0, c: 0 }],
    [
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      { type: `settle`, slot: 0, success: true, cascade: false },
      absentKeyDelete(),
    ],
  )
  expect(counts.absentSourceDeletes).toBe(1)
  expect(counts.queued).toBe(0)
}
const absentKeyDeleteAfterDropHistorys = [
  {
    name: `leaves the visible rows unchanged when the source deletes a never-held key after the drop`,
  },
]
oracleProperty({
  id: `collection-state.absent-key-delete-after-drop`,
  law: {
    statement: `Once the optimistic state has dropped, a source delete of a never-held key changes nothing a reader can see.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `One fixed history.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: absentKeyDeleteAfterDropHistorys,
  label: ({ name }) => name,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.absent-key-delete-after-drop`,
      plan,
      observe,
      () => runAbsentKeyDeleteAfterDropHistory(),
    ),
  check: forwardAssertionJudgment,
})

// The nearby boundary: a persisting request keeps its optimistic row. A
// queued delete waits for settlement. A truncate that carries the delete
// applies at once, and the persisting insert overlays the replacement.
const absentKeyDeletePersistingCases = [false, true]
async function runAbsentKeyDeletePersistingCase(
  truncate: (typeof absentKeyDeletePersistingCases)[number],
): Promise<void> {
  const counts = await runOptimisticHistory(
    [{ id: 2, a: 0, b: 0, c: 0 }],
    [
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      absentKeyDelete(truncate),
      { type: `settle`, slot: 0, success: true, cascade: false },
    ],
  )
  expect(counts.absentSourceDeletes).toBe(1)
  expect(truncate ? counts.snapshotOverrides : counts.queued).toBe(1)
}
oracleProperty({
  id: `collection-state.absent-key-delete-persisting`,
  law: {
    statement: `A persisting insert keeps its optimistic row when the source deletes a key it never held: a queued delete waits for settlement, and a truncate that carries the delete applies at once under the overlay.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `The delete as a queued batch or carried by a truncate.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: absentKeyDeletePersistingCases,
  label: (truncate) =>
    `keeps a persisting insert's optimistic row when the source deletes a key it never held, truncate=${String(truncate)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.absent-key-delete-persisting`,
      plan,
      observe,
      () => runAbsentKeyDeletePersistingCase(plan.history),
    ),
  check: forwardAssertionJudgment,
})

// A handler that confirms its own request through sync, before it returns,
// optionally awaiting the commit receipt. The batch waits for settlement and
// publishes together with the drop of the request's optimistic state.
const handlerConfirmationCases = [`insert`, `update`, `delete`].flatMap(
  (kind) => [false, true].map((awaitReceipt) => ({ kind, awaitReceipt })),
)
async function runHandlerConfirmationCase({
  kind,
  awaitReceipt,
}: (typeof handlerConfirmationCases)[number]): Promise<void> {
  const existing = { id: 1, a: 0, b: 0, c: 0 }
  const confirmed = { id: 1, a: 1, b: 1, c: 1 }
  const batch = {
    type: `sync`,
    rows: kind === `delete` ? [] : [confirmed],
    truncate: false,
    copies: 1,
    awaitReceipt,
  } as const
  const counts = await runOptimisticHistory(
    kind === `insert` ? [] : [existing],
    [
      kind === `delete`
        ? { type: `delete`, key: 1, optimistic: true, inHandler: batch }
        : {
            type: `edit`,
            key: 1,
            fields: { a: 1, b: 1, c: 1 },
            optimistic: true,
            inHandler: batch,
          },
      { type: `settle`, slot: 0, success: true, cascade: false },
      {
        type: `sync`,
        rows: [{ id: 1, a: 2, b: 2, c: 2 }],
        truncate: false,
        copies: 1,
      },
    ],
  )
  expect(counts.handlerBatches).toBe(1)
  expect(counts.awaitedReceipts).toBe(Number(awaitReceipt))
}
oracleProperty({
  id: `collection-state.handler-confirmation`,
  law: {
    statement: `A request its own handler confirms through sync publishes with the drop of its optimistic state at settlement.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `Insert, update, and delete requests, with or without awaiting the commit receipt.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: handlerConfirmationCases,
  label: (row) =>
    `publishes a request confirmed inside its own handler at settlement: ${JSON.stringify(row)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.handler-confirmation`,
      plan,
      observe,
      () => runHandlerConfirmationCase(plan.history),
    ),
  check: forwardAssertionJudgment,
})

const defaultHistory = (
  truncate: boolean,
  success: boolean,
): Array<OptimisticStep> => [
  { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
  { type: `edit`, key: 1, fields: { b: 2 }, optimistic: true },
  { type: `settle`, slot: 1, success: true, cascade: false },
  { type: `sync`, rows: [], truncate, copies: 1 },
  { type: `settle`, slot: 0, success, cascade: false },
]
const validatedDefaultsCases = [false, true].flatMap((truncate) =>
  [false, true].map((success) => ({ truncate, success })),
)
async function runValidatedDefaultsCase({
  truncate,
  success,
}: (typeof validatedDefaultsCases)[number]): Promise<void> {
  for (const insertDefault of [3, 11])
    await runOptimisticHistory(
      [],
      defaultHistory(truncate, success),
      undefined,
      { insertDefault },
    )
}
oracleProperty({
  id: `collection-state.validated-defaults`,
  law: {
    statement: `Validated schema defaults stay with the authored fields until settlement, across a sync with or without truncate and an accepted or rejected request.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `Two insert defaults (3 and 11) over the four truncate and settlement outcomes.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: validatedDefaultsCases,
  label: (row) =>
    `keeps validated defaults with authored fields until settlement: ${JSON.stringify(row)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.validated-defaults`,
      plan,
      observe,
      () => runValidatedDefaultsCase(plan.history),
    ),
  check: forwardAssertionJudgment,
  calibrations: [
    {
      name: `rejects a default lost only after settlement`,
      law: `collection-state.validated-defaults`,
      // The mutant runs on the history the old calibration used; any other
      // history reports no rejection, so the framework moves on to the next.
      driver: (plan, observe) =>
        recordAssertionJudgment(
          `collection-state.validated-defaults`,
          plan,
          observe,
          async () => {
            if (!(plan.history.truncate && plan.history.success)) return
            const steps = defaultHistory(true, true)
            try {
              await runOptimisticHistory([], steps, `retained-default`, {
                insertDefault: 3,
              })
            } catch (error) {
              // Exactly the old matcher: an AssertionError rejects the mutant.
              if (error instanceof Error && error.name === `AssertionError`)
                rejectAt(`calibration retained-default`, error)
              throw new Error(
                `retained-default was not rejected by an AssertionError: ${String(error)}`,
              )
            }
          },
        ),
    },
  ],
})
// A partial source update merges into the source row, not into an optimistic
// row. Here the source holds key 1 with c = 7. An optimistic delete and a
// re-insert that took the schema default for `c` both persist when the partial
// update arrives, so the update is held. When both settle, their optimistic
// state drops and the held update publishes with the drop. The row keeps
// c = 7, the source's merged value.
const partialOverPersistingDefault = (
  insertDefault: number,
): Array<OptimisticStep> => [
  { type: `delete`, key: 1, optimistic: true },
  { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
  {
    type: `sync`,
    rows: [{ id: 1, a: 2, b: 2, c: insertDefault + 5 }],
    truncate: false,
    copies: 1,
    partial: true,
  },
  { type: `settle`, slot: 0, success: true, cascade: false },
  { type: `settle`, slot: 0, success: true, cascade: false },
]
const partialOverDefaultCases = [3, 11]
async function runPartialOverDefaultCase(
  insertDefault: (typeof partialOverDefaultCases)[number],
): Promise<void> {
  const counts = await runOptimisticHistory(
    [{ id: 1, a: 0, b: 0, c: 7 }],
    partialOverPersistingDefault(insertDefault),
    undefined,
    { insertDefault, partialUpdates: true },
  )
  expect(counts.distinguishingPartialUpdates).toBe(1)
  expect(counts.queued).toBe(1)
}
oracleProperty({
  id: `collection-state.partial-over-default`,
  law: {
    statement: `A held partial source update merges into the source row, not the optimistic row, under a persisting schema default.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `Two insert defaults (3 and 11) with one held partial update.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: partialOverDefaultCases,
  label: (insertDefault) =>
    `merges a held partial update into the source row under a persisting schema default (${insertDefault})`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.partial-over-default`,
      plan,
      observe,
      () => runPartialOverDefaultCase(plan.history),
    ),
  check: forwardAssertionJudgment,
  calibrations: [
    {
      name: `rejects a partial update applied as a full replacement`,
      law: `collection-state.partial-over-default`,
      // The mutant runs on the history the old calibration used; any other
      // history reports no rejection, so the framework moves on to the next.
      driver: (plan, observe) =>
        recordAssertionJudgment(
          `collection-state.partial-over-default`,
          plan,
          observe,
          async () => {
            if (plan.history !== 3) return
            const steps = partialOverPersistingDefault(3)
            try {
              await runOptimisticHistory(
                [{ id: 1, a: 0, b: 0, c: 7 }],
                steps,
                `partial-as-full`,
                { insertDefault: 3, partialUpdates: true },
              )
            } catch (error) {
              // Exactly the old matcher: a row observation must reject the
              // replaced row, not the mutant checkpoint.
              if (
                error instanceof Error &&
                /whole forward publication|: reads .* expected |rows visible when settlement completed/.test(
                  error.message,
                )
              )
                rejectAt(`calibration partial-as-full`, error)
              throw new Error(
                `partial-as-full was not rejected at a row observation: ${String(error)}`,
              )
            }
          },
        ),
    },
  ],
})

const insertionPrefix: Array<OptimisticStep> = [
  { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
  { type: `edit`, key: 1, fields: { b: 2 }, optimistic: true },
  { type: `settle`, slot: 1, success: true, cascade: false },
]
const acceptedSnapshotReplayProperty = {
  'before delete': `collection-state.accepted-snapshot.before-delete`,
  'during delete': `collection-state.accepted-snapshot.during-delete`,
  'after rollback': `collection-state.accepted-snapshot.after-rollback`,
} as const
async function runAcceptedSnapshotHistory(
  timing: keyof typeof acceptedSnapshotReplayProperty,
  [row, reject]: [HistoryRow, boolean],
): Promise<void> {
  const truncate: OptimisticStep = {
    type: `sync`,
    rows: [],
    truncate: true,
    copies: 1,
  }
  const counts = await runOptimisticHistory(
    [{ id: row.id, a: 9, b: 9, c: 9 }],
    [
      {
        type: `edit`,
        key: row.id,
        fields: { a: row.a, b: row.b, c: row.c },
        optimistic: true,
      },
      { type: `settle`, slot: 0, success: true, cascade: false },
      ...(timing === `before delete` ? [truncate] : []),
      { type: `delete`, key: row.id, optimistic: true },
      ...(timing === `during delete` ? [truncate] : []),
      {
        type: `settle`,
        slot: 0,
        success: false,
        cascade: false,
        failure: reject ? `reject` : `rollback`,
      },
      ...(timing === `after rollback` ? [truncate] : []),
      // The completed row already dropped at settlement. Preserve later
      // key reuse after an ordinary sync.
      {
        type: `sync`,
        rows: [],
        truncate: false,
        copies: 1,
      },
      {
        type: `edit`,
        key: row.id,
        fields: { a: row.a + 1 },
        optimistic: true,
      },
      { type: `settle`, slot: 0, success: true, cascade: false },
    ],
  )
  // A truncate before the delete removes the row the delete would name.
  const deletes = timing === `before delete` ? 0 : 1
  oracleAssertion('runAcceptedSnapshotHistory', () =>
    expect(counts.deletes).toBe(deletes),
  )
  oracleAssertion('runAcceptedSnapshotHistory', () =>
    expect(counts.settlements).toBe(2 + deletes),
  )
}
for (const timing of [
  `before delete`,
  `during delete`,
  `after rollback`,
] as const) {
  oracleProperty({
    id: acceptedSnapshotReplayProperty[timing],
    law: {
      statement: `A completed optimistic row drops at settlement and a truncate around deletion does not revive it.`,
      authority: `The optimistic snapshot, settlement and source replacement laws in optimistic-history-oracle.ts`,
      limits: `The existing one-key truncate and delete ordering grammar with controlled source work; other provider hosts and arbitrary overlapping histories remain outside this driver.`,
    },
    owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
    histories: {
      arbitrary: fc.tuple(historyRow, fc.boolean()),
      runs: 30,
      fixedSeeds: [86105],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        acceptedSnapshotReplayProperty[timing],
        plan,
        observe,
        () => runAcceptedSnapshotHistory(timing, plan.history),
      ),
    check: forwardAssertionJudgment,
  })
}

const insertUpdateReplayCases = [true, false]
async function runInsertUpdateReplayCase(
  success: (typeof insertUpdateReplayCases)[number],
): Promise<void> {
  await runOptimisticHistory(
    [],
    [...insertionPrefix, { type: `settle`, slot: 0, success, cascade: false }],
  )
}
oracleProperty({
  id: `collection-state.insert-update-replay`,
  law: {
    statement: `An insert and its update replay across settlement, as the history model predicts.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `The insertion prefix with the insert accepted or rejected.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: insertUpdateReplayCases,
  label: (success) =>
    `replays an insert and its update across settlement, accepted=${String(success)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.insert-update-replay`,
      plan,
      observe,
      () => runInsertUpdateReplayCase(plan.history),
    ),
  check: forwardAssertionJudgment,
})
const syncRowOverlayCases = [true, false]
async function runSyncRowOverlayCase(
  truncate: (typeof syncRowOverlayCases)[number],
): Promise<void> {
  await runOptimisticHistory(
    [{ id: 1, a: 0, b: 0, c: 0 }],
    [
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      {
        type: `sync`,
        rows: [{ id: 1, a: 0, b: 2, c: 3 }],
        truncate,
        copies: 1,
      },
      { type: `settle`, slot: 0, success: true, cascade: false },
    ],
  )
}
oracleProperty({
  id: `collection-state.sync-row-overlay`,
  law: {
    statement: `A sync row stays behind an optimistic row until settlement, with or without truncate.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `One key with a sync batch that does or does not truncate.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: syncRowOverlayCases,
  label: (truncate) =>
    `hides a sync row behind an optimistic row until settlement, truncate=${String(truncate)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.sync-row-overlay`,
      plan,
      observe,
      () => runSyncRowOverlayCase(plan.history),
    ),
  check: forwardAssertionJudgment,
})
async function runBufferedUpdateDeleteHistory(): Promise<void> {
  const counts = await runOptimisticHistory(
    [],
    [
      { type: `edit`, key: 1, fields: { c: 0 }, optimistic: true },
      { type: `edit`, key: 1, fields: { b: 1 }, optimistic: true },
      { type: `sync`, rows: [], truncate: false, copies: 1 },
      { type: `settle`, slot: 0, success: true, cascade: false },
      { type: `settle`, slot: 0, success: false, cascade: false },
    ],
  )
  expect(counts).toMatchObject({
    edits: 2,
    settlements: 2,
    failures: 1,
    queued: 1,
  })
}
const bufferedUpdateDeleteHistorys = [
  {
    name: `publishes the subscriber-visible row when a buffered optimistic update becomes a delete`,
  },
]
oracleProperty({
  id: `collection-state.buffered-update-delete`,
  law: {
    statement: `When a buffered optimistic update becomes a delete, the subscriber-visible row is published, as the history model predicts.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `One fixed history.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: bufferedUpdateDeleteHistorys,
  label: ({ name }) => name,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.buffered-update-delete`,
      plan,
      observe,
      () => runBufferedUpdateDeleteHistory(),
    ),
  check: forwardAssertionJudgment,
})
// Each settled delete or edit drops its optimistic state, whatever order the
// requests settle in. A truncate between settlements does not revive them.
const settlementOrdersCases = [false, true].flatMap((truncate) =>
  [false, true].flatMap((editSettlesFirst) =>
    [false, true].map((insertAccepted) => ({
      truncate,
      editSettlesFirst,
      insertAccepted,
    })),
  ),
)
async function runSettlementOrdersCase({
  truncate,
  editSettlesFirst,
  insertAccepted,
}: (typeof settlementOrdersCases)[number]): Promise<void> {
  const replacement: OptimisticStep = {
    type: `sync`,
    rows: [],
    truncate: true,
    copies: 1,
  }
  const acceptedSettlements: Array<OptimisticStep> = editSettlesFirst
    ? [
        { type: `settle`, slot: 2, success: true, cascade: false },
        { type: `settle`, slot: 0, success: true, cascade: false },
      ]
    : [
        { type: `settle`, slot: 0, success: true, cascade: false },
        { type: `settle`, slot: 1, success: true, cascade: false },
      ]
  const counts = await runOptimisticHistory(
    [{ id: 1, a: 0, b: 0, c: 0 }],
    [
      { type: `delete`, key: 1, optimistic: true },
      { type: `edit`, key: 1, fields: { c: 0 }, optimistic: true },
      { type: `edit`, key: 1, fields: { c: 1 }, optimistic: true },
      ...acceptedSettlements,
      ...(truncate ? [replacement] : []),
      { type: `settle`, slot: 0, success: insertAccepted, cascade: false },
    ],
  )
  expect(counts).toMatchObject({
    edits: 3,
    deletes: 1,
    settlements: 3,
    failures: Number(!insertAccepted),
    replacements: Number(truncate),
  })
}
oracleProperty({
  id: `collection-state.settlement-orders`,
  law: {
    statement: `Each settled delete or edit drops its optimistic state, whatever order the requests settle in; a truncate between settlements does not revive them.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `The eight orderings of an optional truncate, edit-first settlement, and an accepted or rejected insert.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: settlementOrdersCases,
  label: (row) =>
    `drops each settled delete and edit across settlement orders: ${JSON.stringify(row)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.settlement-orders`,
      plan,
      observe,
      () => runSettlementOrdersCase(plan.history),
    ),
  check: forwardAssertionJudgment,
})
oracleProperty({
  id: `collection-state.optimistic-history`,
  law: {
    statement: `Optimistic ownership, row publication and request settlement follow the independent history model.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `The existing bounded optimistic-history grammar and controlled Collection sync path; provider acknowledgement timing and other framework hosts remain outside this driver.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: {
    arbitrary: optimisticHistory,
    runs: 100,
    fixedSeeds: [86103],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.optimistic-history`,
      plan,
      observe,
      async () => {
        const { initial, steps } = plan.history
        await runOptimisticHistory(initial, steps)
      },
    ),
  check: forwardAssertionJudgment,
})
// An aborted open batch never applies, so the source's own rows must return
// to their state before it. A later partial update then omits `c` again, and
// the Collection keeps the held `c`. Shrunk from seed -526998278.
async function runAbortedDeletePartialHistory(): Promise<void> {
  const counts = await runOptimisticHistory(
    [{ id: 1, a: 0, b: 0, c: 0 }],
    [
      {
        type: `open`,
        batch: {
          type: `sync`,
          rows: [],
          deletes: [1],
          truncate: false,
          copies: 1,
        },
      },
      { type: `close`, commit: false },
      {
        type: `sync`,
        rows: [{ id: 1, a: 0, b: 0, c: -1 }],
        deletes: [],
        truncate: false,
        copies: 1,
        partial: true,
      },
    ],
    undefined,
    { partialUpdates: true },
  )
  expect(counts).toMatchObject({
    openBatches: 1,
    abortedBatches: 1,
    distinguishingPartialUpdates: 1,
  })
}
const abortedDeletePartialHistorys = [
  {
    name: `merges a partial update after an aborted source delete`,
  },
]
oracleProperty({
  id: `collection-state.aborted-delete-partial`,
  law: {
    statement: `An aborted open batch never applies, so a later partial update merges over the source's prior row and keeps the held field.`,
    authority: `The optimistic snapshot and settlement laws in optimistic-history-oracle.ts`,
    limits: `One fixed history shrunk from seed -526998278.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: abortedDeletePartialHistorys,
  label: ({ name }) => name,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.aborted-delete-partial`,
      plan,
      observe,
      () => runAbortedDeletePartialHistory(),
    ),
  check: forwardAssertionJudgment,
})
oracleProperty({
  id: `collection-state.optimistic-history-partial`,
  law: {
    statement: `Partial source updates preserve omitted fields through optimistic ownership, publication and settlement histories.`,
    authority: `The partial-update and optimistic settlement laws in optimistic-history-oracle.ts`,
    limits: `The existing partial marks over the bounded optimistic-history grammar and controlled Collection sync path; provider timing and other framework hosts remain outside this driver.`,
  },
  owns: [`src/collection/state.ts`, `src/collection/sync.ts`],
  histories: {
    arbitrary: partialHistory,
    runs: 100,
    fixedSeeds: [86104],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `collection-state.optimistic-history-partial`,
      plan,
      observe,
      async () => {
        const { initial, steps } = plan.history
        await runOptimisticHistory(initial, steps, undefined, {
          partialUpdates: true,
        })
      },
    ),
  check: forwardAssertionJudgment,
})
