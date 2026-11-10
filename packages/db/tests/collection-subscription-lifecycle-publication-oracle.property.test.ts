import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createTransaction } from '../src/transactions.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { valueOrderBy } from './collection-subscription-ordered-fixture.js'
import {
  createLifecycleModel,
  deferralCleanupHistories,
  expectedDeferralBatches,
  greenLifecycleHistories,
  greenLifecycleHistoryArbitrary,
  reduceLifecycle,
} from './collection-subscription-lifecycle-grammar-oracle.js'
import {
  oraclePropertyOptions,
  oracleRandomParameters,
  oracleReplayRequested,
  oracleReplaySkips,
  oracleRuns,
  readOracleRunConfig,
} from './oracle-config.js'
import { createOracleReach } from './oracle-reach.js'
import { recordOracleReplay } from './oracle-replay-witness.js'
import {
  checkPublicSnapshotObservation,
  expectedPublicSnapshot,
  publicSnapshotHistoryArbitrary,
  publicSnapshotHistoryExamples,
} from './collection-public-snapshot-oracle.js'
import { declareOracle } from './oracle-declaration.js'
import { flushPromises } from './utils.js'
import {
  assertTerminalPublication,
  clonePublicationBatches,
  cloneRow,
  normalizePublicationOrder,
} from './collection-subscription-lifecycle-publication-support'
import type {
  PublicSnapshotCommit,
  PublicSnapshotHistory,
  PublicSnapshotObservation,
  PublicSnapshotPhase,
} from './collection-public-snapshot-oracle.js'
import type {
  PublicationChange,
  PublicationPhase,
  Row,
  RowKey,
  SyncOperations,
  TerminalPublicationSnapshot,
} from './collection-subscription-lifecycle-publication-support'
import type {
  DeferralLifecycleCommand,
  DemandName,
  LifecycleAttempt,
  LifecycleCommand,
  LifecycleEffect,
  LifecycleModel,
} from './collection-subscription-lifecycle-grammar-oracle.js'

/**
 * # Which lifecycle work may become public rows?
 *
 * The lifecycle grammar decides acquisition authority, readiness and errors.
 * Raw Collection subscribers observe every applied source transaction, including
 * truncate and partial replay writes. A failed load does not retract those
 * writes. Authority: the maintainer's 2026-10-30 raw-commit decision in
 * docs/contributing/oracle-reviews/2026-10-30-raw-collection-publication-decision.md.
 * Complete-result retention belongs to live queries and is unchanged.
 * The `Collection.subscribeChanges` API contract in `../src/collection/index.ts`
 * supplies callback batches and their per-key causal order. The public
 * Collection lifecycle and shared lifecycle grammar supply cleanup, restart,
 * and acquisition-attempt authority. The coverage map limits this owner to
 * Collection publication, not compiled includes or provider correctness.
 * `requestLimitedSnapshot` promises not to resend keys. A direct snapshot
 * selects keys for this subscription. A source callback can also publish a key
 * that no snapshot selected. Later ordered local snapshots skip either kind of
 * key. A deletion releases a key so a later insert is valid.
 *
 * `source` holds currently installed source rows; `visible` is the public
 * snapshot.
 * `retainedKeys` and `sentKeys` are model-only projections of cleanup-kept rows
 * and keys already sent to this subscriber. A direct subscription survives
 * cleanup without a clear callback. Its next applied source transaction
 * reconciles kept rows against the new run's current source, including when
 * that transaction is empty. Eager readiness retains its complete-source
 * reconciliation. Acquisition settlement alone never chooses raw membership.
 * `PublicationPhase` combines replay acquisition timing and verdict into a
 * diagnostic label. It is not a Collection status or row-visibility policy.
 *
 * The reference state uses plain Maps and batches. It does not copy the
 * subscription implementation. After every command, the driver compares exact
 * insert, update, and delete batches, visible rows, status, syncRuns, and
 * unloads. It also records the phase before each observation so a final-state
 * match cannot hide an early or duplicate publication.
 *
 * A deferral interrupted by cleanup belongs to the ended sync run. Its prior
 * discard cannot suppress a later sync run's subscriber batches. The bounded
 * deferral histories in the shared grammar compare one or two later inserts
 * at the new deferral's close: callback grouping, change type, key, row value,
 * and prior value. Virtual fields are outside this bounded law. An old handle
 * closing during the new deferral cannot publish early or suppress its batch.
 * A compiled live-query includes path remains outside this model.
 *
 * Ownership and caller-promise outcomes stay in the lifecycle-history driver.
 * This separation keeps the row model small while the shared command grammar
 * still exercises their real dependency edge.
 */

type SourceMutation = {
  type: `source`
  key: RowKey
  action: `upsert` | `delete`
  value: number
}

type PublicationCommand =
  | Exclude<LifecycleCommand, { type: `truncate` }>
  | { type: `truncate`; replacement?: Row }
  | SourceMutation

type RuntimeAttempt = {
  id: number
  ownerId: number
  demand: DemandName
  syncRunGeneration: number
  operations: SyncOperations
  deferred: ReturnType<typeof createDeferred<void>>
  signal: AbortSignal | undefined
  settled: boolean
  current: boolean
}

type RuntimeOwner = {
  id: number
  demand: DemandName
  controller: AbortController
  aborted: boolean
  attemptId?: number
}

type PublicationModel = {
  source: Map<RowKey, Row>
  visible: Map<RowKey, Row>
  // Public rows carried across cleanup, before the new source reconciles them.
  retainedKeys: Set<RowKey>
  batches: Array<Array<PublicationChange>>
  sentKeys: Set<RowKey>
}

type SourceEffect = `insert` | `update` | `delete`

type PublicationObservation = {
  index: number
  command: PublicationCommand[`type`]
  phaseBefore: PublicationPhase
  pendingAttemptsBefore: number
  executed: boolean
  sourceEffect?: SourceEffect
  settlement?: `resolve` | `reject`
  publications: number
  unloads: number
  syncRuns: number
  collectionStatus: string
}

type PublicationMismatch = {
  history: string
  commandIndex: number
  command: PublicationCommand
  expected: Array<Array<PublicationChange>>
  observed: Array<Array<PublicationChange>>
}

type PublicationRunOptions = {
  withoutLoader?: boolean
  continueAfterMismatch?: boolean
  historyName?: string
  mismatches?: Array<PublicationMismatch>
  terminal?: {
    order: `oldest-first` | `newest-first`
    outcome: `resolve` | `reject`
    expectedPending: number
    reached: Array<number>
  }
}

function recordSourceWrite(publication: PublicationModel, row: Row): void {
  // This driver requests raw future changes (includeInitialState: false).
  // Cleanup-kept rows reconcile at the next applied source transaction.
  const previous = publication.source.get(row.id)
  publication.source.set(row.id, cloneRow(row))
  if (publication.retainedKeys.size > 0) {
    publishIfChanged(publication, new Map(publication.source))
    publication.retainedKeys.clear()
    return
  }
  if (previous?.value === row.value) return
  publication.visible.set(row.id, cloneRow(row))
  publication.sentKeys.add(row.id)
  publication.batches.push([
    previous
      ? {
          type: `update`,
          key: row.id,
          value: cloneRow(row),
          previousValue: cloneRow(previous),
        }
      : { type: `insert`, key: row.id, value: cloneRow(row) },
  ])
}

const mapsEqual = (
  left: ReadonlyMap<RowKey, Row>,
  right: ReadonlyMap<RowKey, Row>,
): boolean =>
  left.size === right.size &&
  [...left].every(([id, row]) => right.get(id)?.value === row.value)

// Replay timing is diagnostic: the raw source fold has no replay buffer.
function publicationPhase(lifecycle: LifecycleModel): PublicationPhase {
  if (!lifecycle.publicationBarrierOpen) return `public`
  const currentAttemptIds = new Set(
    lifecycle.owners.flatMap(({ aborted, attemptId }) =>
      aborted || attemptId === undefined ? [] : [attemptId],
    ),
  )
  const current = lifecycle.attempts.filter(({ id }) =>
    currentAttemptIds.has(id),
  )
  if (current.some(({ outcome }) => outcome === `reject`))
    return `replay-failed`
  return current.some(({ outcome }) => outcome !== undefined)
    ? `replay-settling`
    : `replay-pending`
}

function publicationDiff(
  previous: ReadonlyMap<RowKey, Row>,
  next: ReadonlyMap<RowKey, Row>,
): Array<PublicationChange> {
  const changes: Array<PublicationChange> = []
  for (const [key, previousValue] of [...previous].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const value = next.get(key)
    if (!value) {
      changes.push({ type: `delete`, key, value: cloneRow(previousValue) })
    } else if (value.value !== previousValue.value) {
      changes.push({
        type: `update`,
        key,
        value: cloneRow(value),
        previousValue: cloneRow(previousValue),
      })
    }
  }
  for (const [key, value] of [...next].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!previous.has(key)) {
      changes.push({ type: `insert`, key, value: cloneRow(value) })
    }
  }
  return changes
}

function publishIfChanged(
  publication: PublicationModel,
  next: Map<RowKey, Row>,
): void {
  if (mapsEqual(publication.visible, next)) return
  publication.batches.push(publicationDiff(publication.visible, next))
  publication.visible = next
  publication.sentKeys = new Set(next.keys())
}

/** Authored source transactions choose raw rows. Acquisition outcomes choose
 * only whether a current attempt authors a source write; they do not keep an
 * applied transaction private or retract it. Cleanup is the sole retained-fold
 * distinction: it clears source without notifying this surviving subscriber.
 */
function projectPublication(
  publication: PublicationModel,
  lifecycle: LifecycleModel,
  command: PublicationCommand,
  effect: LifecycleEffect,
  priorPublicationCount: number,
  eagerRestart: boolean,
): void {
  if (
    command.type === `truncate` &&
    lifecycle.active &&
    !lifecycle.unsubscribed
  ) {
    const previousSource = new Map(publication.source)
    publication.source.clear()
    if (command.replacement)
      publication.source.set(
        command.replacement.id,
        cloneRow(command.replacement),
      )
    if (publication.retainedKeys.size > 0) {
      publishIfChanged(publication, new Map(publication.source))
    } else {
      // Truncate and its replacement writes form one raw sync transaction.
      // Keep delete/insert order for the same key, even for an equal value.
      const changes: Array<PublicationChange> = [
        ...[...previousSource].map(([key, value]) => ({
          type: `delete` as const,
          key,
          value: cloneRow(value),
        })),
        ...[...publication.source].map(([key, value]) => ({
          type: `insert` as const,
          key,
          value: cloneRow(value),
        })),
      ]
      if (changes.length > 0) publication.batches.push(changes)
      publication.visible = new Map(publication.source)
      publication.sentKeys = new Set(publication.source.keys())
    }
    publication.retainedKeys.clear()
  } else if (
    command.type === `source` &&
    lifecycle.active &&
    !lifecycle.unsubscribed
  ) {
    const previousValue = publication.source.get(command.key)
    if (command.action === `delete`) {
      publication.source.delete(command.key)
      if (publication.retainedKeys.size > 0) {
        publishIfChanged(publication, new Map(publication.source))
        publication.retainedKeys.clear()
      } else if (previousValue) {
        publication.visible.delete(command.key)
        publication.sentKeys.delete(command.key)
        publication.batches.push([
          { type: `delete`, key: command.key, value: cloneRow(previousValue) },
        ])
      }
    } else {
      recordSourceWrite(publication, { id: command.key, value: command.value })
    }
  } else if (command.type === `cleanup`) {
    publication.retainedKeys = new Set(publication.visible.keys())
    publication.source.clear()
  } else if (command.type === `settle` && effect.attemptId !== undefined) {
    const attempt = lifecycle.attempts[effect.attemptId]!
    const isCurrent = lifecycle.owners.some(
      ({ attemptId }) => attemptId === attempt.id,
    )
    if (command.outcome === `resolve` && isCurrent && !attempt.aborted)
      recordSourceWrite(publication, { id: attempt.demand, value: attempt.id })
  }

  // An eager-ready restart declares its complete source. On-demand readiness
  // alone supplies no such full-source evidence, so it retains cleanup's fold
  // until an authored transaction or the existing snapshot path reconciles it.
  if (
    eagerRestart &&
    command.type === `restart` &&
    lifecycle.publications > priorPublicationCount &&
    !mapsEqual(publication.visible, publication.source)
  ) {
    publishIfChanged(publication, new Map(publication.source))
    publication.retainedKeys.clear()
    priorPublicationCount++
  }

  for (
    let index = priorPublicationCount;
    index < lifecycle.publications;
    index++
  ) {
    const requested =
      command.type === `request` &&
      lifecycle.active &&
      lifecycle.owners.filter(({ demand }) => demand === command.demand)
        .length === 1
        ? publication.source.get(command.demand)
        : undefined
    const shown = requested && publication.visible.get(requested.id)
    const row =
      requested && requested.value !== shown?.value ? requested : undefined
    publication.batches.push(
      row
        ? [
            shown
              ? {
                  type: `update`,
                  key: row.id,
                  value: cloneRow(row),
                  previousValue: cloneRow(shown),
                }
              : { type: `insert`, key: row.id, value: cloneRow(row) },
          ]
        : [],
    )
    if (requested) publication.retainedKeys.delete(requested.id)
    if (row) {
      publication.visible.set(row.id, cloneRow(row))
      publication.sentKeys.add(row.id)
    }
  }
}

const sourceMutationArbitrary: fc.Arbitrary<SourceMutation> = fc.record({
  type: fc.constant(`source` as const),
  key: fc.constantFrom(`a` as const, `b` as const, `c` as const, `d` as const),
  action: fc.constantFrom(`upsert` as const, `delete` as const),
  value: fc.integer({ min: 0, max: 5 }),
})

// Generated publication histories contain 1–20 lifecycle commands from the
// shared grammar plus 1–5 atomic source mutations inserted at any boundary,
// including before the first and after the last lifecycle command. Keys a/b
// can overlap demand; c/d distinguish independent source work. Upsert/delete
// and values 0–5 distinguish insert, update, delete, and unchanged writes.
// Removing insertion position loses replay timing; removing either
// key class loses demand overlap or independent publication. Without delete,
// a source row cannot retract; without repeated writes and distinct values,
// unchanged-write silence cannot be distinguished from an actual update. The
// value field on delete is inert and contributes no separate semantic axis.
// A source mutation after unsubscribe is legal and checks callback silence.
// The bounded product below supplies fixed witnesses for each phase, source
// effect, settlement, suffix, and prior independent row. Named histories below
// reconstruct generated failures at their recorded seed and shrink path.
// Truncate-with-replacement rows are outside this random grammar and have
// separate fixed cases. A malformed sync transaction with an unmatched begin
// is excluded: each generated source mutation commits as one transaction.
const publicationCommandHistoryArbitrary: fc.Arbitrary<
  Array<PublicationCommand>
> = greenLifecycleHistoryArbitrary.chain((history) =>
  fc
    .array(
      fc.record({
        position: fc.integer({ min: 0, max: history.length }),
        command: sourceMutationArbitrary,
      }),
      { minLength: 1, maxLength: 5 },
    )
    .map((insertions) => {
      const commands: Array<PublicationCommand> = [...history]
      for (const { position, command } of insertions.sort(
        (left, right) => right.position - left.position,
      )) {
        commands.splice(position, 0, command)
      }
      return commands
    }),
)

async function runPublicationHistory(
  history: ReadonlyArray<PublicationCommand>,
  runOptions: PublicationRunOptions = {},
): Promise<Array<PublicationObservation>> {
  const check = runOptions.continueAfterMismatch ? expect.soft : expect
  const observations: Array<PublicationObservation> = []
  const lifecycle = createLifecycleModel()
  const publication: PublicationModel = {
    source: new Map(),
    visible: new Map(),
    retainedKeys: new Set(),
    batches: [],
    sentKeys: new Set(),
  }
  // The publication arbitrary draws only `a` and `b`; `c` belongs to the
  // demand-change grammar and completes the record.
  const where: Record<DemandName, Func> = {
    a: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
    b: new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
    c: new Func(`eq`, [new PropRef([`id`]), new Value(`c`)]),
  }
  const demandForWhere = new Map<unknown, DemandName>([
    [where.a, `a`],
    [where.b, `b`],
  ])
  const attempts = new Map<number, RuntimeAttempt>()
  const attemptForOptions = new Map<unknown, number>()
  const unloads: Array<number> = []
  const owners: Array<RuntimeOwner> = []
  const sourceRows = new Map<number, Map<RowKey, Row>>()
  const operationsBySyncRun = new Map<number, SyncOperations>()
  const outcomes = new Map<
    number,
    { state: `resolved` } | { state: `rejected`; error: unknown }
  >()
  const outcomeObservers = new Map<number, Promise<void>>()
  let nextAttemptId = 0
  let nextOwnerId = 0
  let syncRun = -1
  let active = true
  let unsubscribed = false

  const collection = createCollection<Row, RowKey>({
    id: `generated-lifecycle-publication`,
    getKey: ({ id }) => id,
    syncMode: runOptions.withoutLoader ? `eager` : `on-demand`,
    sync: {
      sync: (operations) => {
        const ownSyncRun = ++syncRun
        operationsBySyncRun.set(ownSyncRun, operations)
        sourceRows.set(ownSyncRun, new Map())
        operations.markReady()
        if (runOptions.withoutLoader) return
        return {
          loadSubset: (options) => {
            const demand = demandForWhere.get(options.where)
            if (!demand) throw new Error(`publication load lost its demand`)
            const owner = owners.find(
              (candidate) =>
                candidate.demand === demand &&
                !candidate.aborted &&
                candidate.attemptId === undefined,
            )
            if (!owner) throw new Error(`publication load has no runtime owner`)
            const id = nextAttemptId++
            const deferred = createDeferred<void>()
            void deferred.promise.catch(() => undefined)
            if (runOptions.terminal) {
              outcomeObservers.set(
                id,
                deferred.promise.then(
                  () => {
                    outcomes.set(id, { state: `resolved` })
                  },
                  (error: unknown) => {
                    outcomes.set(id, { state: `rejected`, error })
                  },
                ),
              )
            }
            attempts.set(id, {
              id,
              ownerId: owner.id,
              demand,
              syncRunGeneration: ownSyncRun,
              operations,
              deferred,
              signal: options.signal,
              settled: false,
              current: true,
            })
            attemptForOptions.set(options, id)
            owner.attemptId = id
            return deferred.promise
          },
          unloadSubset: (options) => {
            const attemptId = attemptForOptions.get(options)
            if (attemptId === undefined) {
              throw new Error(`publication unload lost its acquisition`)
            }
            unloads.push(attemptId)
          },
        }
      },
    },
  })

  const visible = new Map<RowKey, Row>()
  const observedBatches: Array<Array<PublicationChange>> = []
  const statusEvents: TerminalPublicationSnapshot[`statusEvents`] = []
  const errorEvents: Array<unknown> = []
  const subscription = collection.subscribeChanges(
    (changes) => {
      const batch = changes.map((change): PublicationChange => {
        const key: unknown = change.key
        if (key !== `a` && key !== `b` && key !== `c` && key !== `d`) {
          throw new Error(`publication used an unknown row key`)
        }
        return {
          type: change.type,
          key,
          value: cloneRow(change.value),
          ...(change.previousValue === undefined
            ? {}
            : { previousValue: cloneRow(change.previousValue) }),
        }
      })
      for (const change of batch) {
        const id = change.key
        if (change.type === `delete`) visible.delete(id)
        else visible.set(id, { id, value: change.value.value })
      }
      observedBatches.push(batch)
    },
    { includeInitialState: false },
  )
  if (runOptions.terminal) {
    subscription.on(`status:change`, ({ previousStatus, status }) => {
      statusEvents.push({ previousStatus, status })
    })
    subscription.on(`loadSubset:error`, ({ error }) => errorEvents.push(error))
  }
  const captureTerminal = (): TerminalPublicationSnapshot => ({
    batches: clonePublicationBatches(observedBatches),
    visible: [...visible.values()].map(cloneRow),
    statusEvents: statusEvents.map((event) => ({ ...event })),
    errors: [...errorEvents],
    status: subscription.status,
    subscriberCount: collection.subscriberCount,
    attempts: attempts.size,
    unloads: [...unloads],
    syncRuns: operationsBySyncRun.size,
  })

  const writeAttempt = async (attempt: RuntimeAttempt): Promise<void> => {
    // Cancellation fences request-scoped writes at the adapter boundary.
    // Transport may settle later; it must not publish canceled snapshot rows.
    if (attempt.signal?.aborted) return
    const rows = sourceRows.get(attempt.syncRunGeneration)
    const previous = rows?.get(attempt.demand)
    const value = { id: attempt.demand, value: attempt.id }
    attempt.operations.begin()
    attempt.operations.write({
      type: previous ? `update` : `insert`,
      value,
      ...(previous ? { previousValue: previous } : {}),
    })
    const receipt = attempt.operations.commit()
    if (receipt !== true) await receipt
    rows?.set(attempt.demand, value)
  }

  const assertPublications = (
    command: PublicationCommand,
    commandIndex: number,
    expectedStart: number,
    observedStart: number,
  ): void => {
    const expectedBatches = publication.batches.slice(expectedStart)
    const observed = observedBatches.slice(observedStart)
    const expected = normalizePublicationOrder(expectedBatches)
    const normalizedObserved = normalizePublicationOrder(observed)
    const context = JSON.stringify({
      history,
      command,
      commandIndex,
      observed,
      expected: expectedBatches,
    })
    if (
      runOptions.mismatches &&
      JSON.stringify(normalizedObserved) !== JSON.stringify(expected)
    ) {
      const historyName = runOptions.historyName ?? JSON.stringify(history)
      runOptions.mismatches.push({
        history: historyName,
        commandIndex,
        command,
        expected: clonePublicationBatches(expectedBatches),
        observed: clonePublicationBatches(observed),
      })
      return
    }
    check(normalizedObserved, context).toEqual(expected)
  }

  const selectRuntimeAttempt = (
    command: Extract<LifecycleCommand, { type: `settle` }>,
  ): RuntimeAttempt | undefined => {
    if (unsubscribed) return undefined
    const candidates = [...attempts.values()].filter(
      (attempt) =>
        !attempt.settled &&
        attempt.demand === command.demand &&
        attempt.current === (command.scope === `current`),
    )
    return command.age === `oldest` ? candidates[0] : candidates.at(-1)
  }

  const failures: Array<unknown> = []
  try {
    for (const [index, command] of history.entries()) {
      const priorPublicationCount = lifecycle.publications
      const phaseBefore = publicationPhase(lifecycle)
      const pendingAttemptsBefore = [...attempts.values()].filter(
        ({ current, settled }) => current && !settled,
      ).length
      const observedPublicationCount = observedBatches.length
      const expectedPublicationCount = publication.batches.length
      const unloadCount = unloads.length
      const syncRunCount = operationsBySyncRun.size
      let executed = false
      let sourceEffect: SourceEffect | undefined
      let settlement: `resolve` | `reject` | undefined
      const runtimeOwner =
        command.type === `request`
          ? {
              id: nextOwnerId++,
              demand: command.demand,
              controller: new AbortController(),
              aborted: false,
            }
          : command.type === `abort`
            ? owners.find(
                ({ demand, aborted }) => demand === command.demand && !aborted,
              )
            : command.type === `release`
              ? owners.find(({ demand }) => demand === command.demand)
              : undefined
      if (command.type === `request` && !unsubscribed)
        owners.push(runtimeOwner!)
      const runtimeAttempt =
        command.type === `settle` ? selectRuntimeAttempt(command) : undefined
      const effect =
        command.type === `source`
          ? ({} satisfies LifecycleEffect)
          : reduceLifecycle(lifecycle, command)

      if (command.type === `source` && active) {
        const operations = operationsBySyncRun.get(syncRun)
        const rows = sourceRows.get(syncRun)
        const previous = rows?.get(command.key)
        executed = operations !== undefined && rows !== undefined
        sourceEffect =
          command.action === `delete`
            ? previous
              ? `delete`
              : undefined
            : previous
              ? `update`
              : `insert`
        operations?.begin()
        if (command.action === `delete`) {
          operations?.write({ type: `delete`, key: command.key })
          rows?.delete(command.key)
        } else {
          const value = { id: command.key, value: command.value }
          operations?.write({
            type: previous ? `update` : `insert`,
            value,
            ...(previous ? { previousValue: previous } : {}),
          })
          rows?.set(command.key, value)
        }
        const receipt = operations?.commit()
        if (receipt !== true) await receipt
      } else if (command.type === `request`) {
        check(effect.ownerId).toBe(unsubscribed ? undefined : runtimeOwner?.id)
        executed = runtimeOwner !== undefined && !unsubscribed
        subscription.requestSnapshot({
          where: where[command.demand],
          signal: runtimeOwner?.controller.signal,
        })
      } else if (command.type === `abort`) {
        check(effect.ownerId).toBe(runtimeOwner?.id)
        executed = runtimeOwner !== undefined
        if (runtimeOwner) {
          runtimeOwner.aborted = true
          runtimeOwner.controller.abort()
        }
      } else if (command.type === `release`) {
        check(effect.ownerId).toBe(runtimeOwner?.id)
        executed = runtimeOwner !== undefined
        if (runtimeOwner) {
          if (runtimeOwner.attemptId !== undefined) {
            attempts.get(runtimeOwner.attemptId)!.current = false
          }
          owners.splice(owners.indexOf(runtimeOwner), 1)
        }
        subscription.releaseSnapshot(where[command.demand])
      } else if (command.type === `settle`) {
        check(effect.attemptId).toBe(runtimeAttempt?.id)
        executed = runtimeAttempt !== undefined
        if (runtimeAttempt) settlement = command.outcome
        if (effect.attemptId !== undefined && runtimeAttempt) {
          runtimeAttempt.settled = true
          const expected = lifecycle.attempts[
            effect.attemptId
          ] as LifecycleAttempt
          if (command.outcome === `resolve`) {
            await writeAttempt(runtimeAttempt)
            runtimeAttempt.deferred.resolve()
          } else {
            runtimeAttempt.deferred.reject(expected.failure)
          }
        }
      } else if (command.type === `truncate` && active) {
        executed = true
        for (const owner of owners) {
          if (owner.attemptId !== undefined) {
            attempts.get(owner.attemptId)!.current = false
          }
          owner.attemptId = undefined
        }
        const operations = operationsBySyncRun.get(syncRun)
        operations?.begin()
        operations?.truncate()
        if (command.replacement) {
          operations?.write({
            type: `insert`,
            value: cloneRow(command.replacement),
          })
        }
        const receipt = operations?.commit()
        if (receipt !== true) await receipt
        sourceRows.get(syncRun)?.clear()
        if (command.replacement) {
          sourceRows
            .get(syncRun)
            ?.set(command.replacement.id, cloneRow(command.replacement))
        }
      } else if (command.type === `cleanup` && active) {
        executed = true
        for (const owner of owners) {
          if (owner.attemptId !== undefined) {
            attempts.get(owner.attemptId)!.current = false
          }
          owner.attemptId = undefined
        }
        await collection.cleanup()
        active = false
      } else if (command.type === `restart` && !active) {
        executed = true
        collection.startSyncImmediate()
        active = true
      } else if (command.type === `unsubscribe`) {
        executed = !unsubscribed
        for (const attempt of attempts.values()) attempt.current = false
        subscription.unsubscribe()
        unsubscribed = true
        owners.length = 0
      }

      await flushPromises()
      projectPublication(
        publication,
        lifecycle,
        command,
        effect,
        priorPublicationCount,
        runOptions.withoutLoader ?? false,
      )
      // The expected callback fold never rewrites the independently installed source.
      // The publication model stops tracking source commands after unsubscribe;
      // its callback-silence assertions below still cover that suffix.
      if (!lifecycle.unsubscribed)
        check(
          [...(active ? collection.values() : [])]
            .map(cloneRow)
            .sort((left, right) => left.id.localeCompare(right.id)),
          `source state after command ${index}: ${JSON.stringify(command)}`,
        ).toEqual(
          [...publication.source.values()].sort((left, right) =>
            left.id.localeCompare(right.id),
          ),
        )
      assertPublications(
        command,
        index,
        expectedPublicationCount,
        observedPublicationCount,
      )
      check(
        [...visible.values()].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        `consumer state after command ${index}: ${JSON.stringify(command)}`,
      ).toEqual(
        [...publication.visible.values()].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
      )
      observations.push({
        index,
        command: command.type,
        phaseBefore,
        pendingAttemptsBefore,
        executed,
        ...(sourceEffect ? { sourceEffect } : {}),
        ...(settlement ? { settlement } : {}),
        publications: observedBatches.length - observedPublicationCount,
        unloads: unloads.length - unloadCount,
        syncRuns: operationsBySyncRun.size - syncRunCount,
        collectionStatus: collection.status,
      })
    }
    if (runOptions.terminal) {
      const terminal = runOptions.terminal
      const pending = [...attempts.values()].filter(({ settled }) => !settled)
      expect(pending).toHaveLength(terminal.expectedPending)
      expect(pending.length).toBeGreaterThan(0)
      if (terminal.order === `newest-first`) pending.reverse()
      subscription.unsubscribe()
      unsubscribed = true
      const retired = captureTerminal()
      expect(retired.subscriberCount).toBe(0)
      for (const attempt of pending) {
        expect(outcomes.has(attempt.id)).toBe(false)
        const failure = new Error(`retired publication transport ${attempt.id}`)
        attempt.settled = true
        if (terminal.outcome === `resolve`) {
          await writeAttempt(attempt)
          attempt.deferred.resolve()
        } else {
          attempt.deferred.reject(failure)
        }
        await outcomeObservers.get(attempt.id)
        await flushPromises()
        terminal.reached.push(attempt.id)
        const outcome = outcomes.get(attempt.id)
        if (terminal.outcome === `resolve`)
          expect(outcome).toEqual({ state: `resolved` })
        else {
          expect(outcome?.state).toBe(`rejected`)
          if (outcome?.state === `rejected`) expect(outcome.error).toBe(failure)
        }
        assertTerminalPublication(captureTerminal(), retired)
      }
      expect(terminal.reached).toEqual(pending.map(({ id }) => id))
    }
  } catch (error) {
    failures.push(error)
  } finally {
    for (const attempt of attempts.values()) attempt.deferred.resolve()
    try {
      await flushPromises()
    } catch (error) {
      failures.push(error)
    }
    try {
      subscription.unsubscribe()
    } catch (error) {
      failures.push(error)
    }
    try {
      await collection.cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      `Publication history and cleanup failed`,
      {
        cause: failures[0],
      },
    )
  return observations
}

type ProductSettlement = `none` | `resolve` | `reject`

type ProductSuffix = `release` | `cleanup` | `restart` | `unsubscribe`

type PriorIndependentRow = `absent` | `present`

type PublicationProductCase = {
  name: string
  phase: PublicationPhase
  sourceEffect: SourceEffect
  settlement: ProductSettlement
  suffix: ProductSuffix
  priorIndependentRow: PriorIndependentRow
  history: Array<PublicationCommand>
  focalSourceIndex: number
  settlementIndex?: number
  pendingProbeIndex: number
  suffixIndex: number
  postUnsubscribeProbeIndex: number
}

const settleCurrent = (
  demand: DemandName,
  outcome: `resolve` | `reject`,
): LifecycleCommand => ({
  type: `settle`,
  demand,
  scope: `current`,
  age: `oldest`,
  outcome,
})

function createPublicationProductCase(
  phase: PublicationPhase,
  sourceEffect: SourceEffect,
  settlement: ProductSettlement,
  suffix: ProductSuffix,
  priorIndependentRow: PriorIndependentRow,
): PublicationProductCase {
  const history: Array<PublicationCommand> = []
  const push = (command: PublicationCommand): number =>
    history.push(command) - 1
  const hasPeer = phase === `replay-settling` || phase === `replay-failed`

  if (priorIndependentRow === `present`) {
    push({ type: `source`, key: `d`, action: `upsert`, value: 30 })
  }
  push({ type: `request`, demand: `a` })
  if (hasPeer) push({ type: `request`, demand: `b` })
  if (phase !== `public`) {
    push(settleCurrent(`a`, `resolve`))
    if (hasPeer) push(settleCurrent(`b`, `resolve`))
    push({ type: `truncate` })
    if (phase === `replay-settling`) {
      push(settleCurrent(`b`, `resolve`))
    } else if (phase === `replay-failed`) {
      push(settleCurrent(`b`, `reject`))
    }
  }

  if (sourceEffect !== `insert`) {
    push({ type: `source`, key: `c`, action: `upsert`, value: 40 })
  }
  const focalSourceIndex = push({
    type: `source`,
    key: `c`,
    action: sourceEffect === `delete` ? `delete` : `upsert`,
    value: 41,
  })
  const settlementIndex =
    settlement === `none` ? undefined : push(settleCurrent(`a`, settlement))
  const pendingProbeIndex = history.length

  let suffixIndex: number
  if (suffix === `release`) {
    suffixIndex = push({ type: `release`, demand: `a` })
    if (hasPeer) suffixIndex = push({ type: `release`, demand: `b` })
    push({ type: `unsubscribe` })
  } else if (suffix === `cleanup`) {
    suffixIndex = push({ type: `cleanup` })
    push({ type: `unsubscribe` })
  } else if (suffix === `restart`) {
    push({ type: `cleanup` })
    suffixIndex = push({ type: `restart` })
    push({ type: `unsubscribe` })
  } else {
    suffixIndex = push({ type: `unsubscribe` })
  }
  if (suffix === `cleanup`) push({ type: `restart` })
  const postUnsubscribeProbeIndex = push({
    type: `source`,
    key: `d`,
    action: `upsert`,
    value: 99,
  })

  return {
    name: `${phase}:${sourceEffect}:${settlement}:${suffix}:prior-${priorIndependentRow}`,
    phase,
    sourceEffect,
    settlement,
    suffix,
    priorIndependentRow,
    history,
    focalSourceIndex,
    ...(settlementIndex === undefined ? {} : { settlementIndex }),
    pendingProbeIndex,
    suffixIndex,
    postUnsubscribeProbeIndex,
  }
}

const publicationPhases = [
  `public`,
  `replay-pending`,
  `replay-settling`,
  `replay-failed`,
] as const

const sourceEffects = [`insert`, `update`, `delete`] as const

const productSettlements = [`none`, `resolve`, `reject`] as const

const productSuffixes = [
  `release`,
  `cleanup`,
  `restart`,
  `unsubscribe`,
] as const

const priorIndependentRows = [`absent`, `present`] as const

const publicationProductCases = publicationPhases.flatMap((phase) =>
  sourceEffects.flatMap((sourceEffect) =>
    productSettlements.flatMap((settlement) =>
      productSuffixes.flatMap((suffix) =>
        priorIndependentRows.map((priorIndependentRow) =>
          createPublicationProductCase(
            phase,
            sourceEffect,
            settlement,
            suffix,
            priorIndependentRow,
          ),
        ),
      ),
    ),
  ),
)

const successfulReplacementCases = publicationProductCases.filter(
  ({ phase, sourceEffect, settlement }) =>
    (phase === `replay-pending` || phase === `replay-settling`) &&
    sourceEffect !== `delete` &&
    settlement === `resolve`,
)

const replacementOrderingCases = publicationProductCases.filter(
  ({ phase, sourceEffect, settlement, suffix, priorIndependentRow }) =>
    (phase === `replay-pending` || phase === `replay-settling`) &&
    sourceEffect === `delete` &&
    settlement === `resolve` &&
    suffix !== `release` &&
    priorIndependentRow === `present`,
)

const replacementRetirementCases = publicationProductCases.filter(
  (scenario) =>
    scenario.phase !== `public` &&
    scenario.suffix === `release` &&
    !successfulReplacementCases.includes(scenario) &&
    !replacementOrderingCases.includes(scenario),
)

const publicationControlCases = publicationProductCases.filter(
  (scenario) =>
    !successfulReplacementCases.includes(scenario) &&
    !replacementOrderingCases.includes(scenario) &&
    !replacementRetirementCases.includes(scenario),
)

// Keep each semantic cell intact while giving the aggregate campaign several
// scheduler cuts. One 204-history test can exceed Vitest's per-test deadline
// when the full oracle portfolio runs concurrently, even though no history is
// slow or stuck.
const publicationControlSlices = Array.from({ length: 4 }, (_, index) => ({
  name: `${index * 51 + 1}-${(index + 1) * 51}`,
  scenarios: publicationControlCases.slice(index * 51, (index + 1) * 51),
}))

async function runPublicationProduct(
  scenarios: ReadonlyArray<PublicationProductCase>,
): Promise<Array<PublicationMismatch>> {
  const mismatches: Array<PublicationMismatch> = []
  const reached = new Set<string>()

  for (const scenario of scenarios) {
    const observations = await runPublicationHistory(scenario.history, {
      historyName: scenario.name,
      mismatches,
    })
    expect(observations).toHaveLength(scenario.history.length)
    expect(observations[scenario.focalSourceIndex]).toMatchObject({
      command: `source`,
      phaseBefore: scenario.phase,
      executed: true,
      sourceEffect: scenario.sourceEffect,
    })
    if (scenario.settlementIndex === undefined) {
      expect(
        observations[scenario.pendingProbeIndex]!.pendingAttemptsBefore,
        scenario.name,
      ).toBe(1)
    } else {
      expect(observations[scenario.settlementIndex]).toMatchObject({
        command: `settle`,
        executed: true,
        settlement: scenario.settlement,
        publications: scenario.settlement === `resolve` ? 1 : 0,
      })
    }

    const suffix = observations[scenario.suffixIndex]!
    expect(suffix).toMatchObject({
      command: scenario.suffix,
      executed: true,
    })
    if (scenario.suffix === `release`) {
      expect(suffix.unloads, scenario.name).toBe(1)
    } else if (scenario.suffix === `cleanup`) {
      expect(suffix.collectionStatus, scenario.name).toBe(`cleaned-up`)
    } else if (scenario.suffix === `restart`) {
      expect(suffix.syncRuns, scenario.name).toBe(1)
    } else {
      const ownerCount =
        scenario.phase === `replay-settling` ||
        scenario.phase === `replay-failed`
          ? 2
          : 1
      expect(suffix.unloads, scenario.name).toBe(ownerCount)
    }

    expect(observations[scenario.postUnsubscribeProbeIndex]).toMatchObject({
      command: `source`,
      executed: true,
      publications: 0,
    })
    reached.add(scenario.name)
  }

  expect(reached).toEqual(new Set(scenarios.map(({ name }) => name)))
  return mismatches
}

function expectNoPublicationMismatches(
  mismatches: ReadonlyArray<PublicationMismatch>,
): void {
  const summary = mismatches.map(
    ({ history, commandIndex, command, expected, observed }) => ({
      history,
      commandIndex,
      command,
      expected,
      observed,
    }),
  )
  expect(
    summary,
    `publication product mismatches: ${JSON.stringify(summary)}`,
  ).toEqual([])
}

let deferralHistoryId = 0

async function runDeferralCleanupHistory(
  commands: ReadonlyArray<DeferralLifecycleCommand>,
): Promise<void> {
  let operations!: SyncOperations
  let syncRuns = 0
  const collection = createCollection<Row, RowKey>({
    id: `publication-after-deferral-cleanup-${deferralHistoryId++}`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (next) => {
        syncRuns++
        operations = next
        next.markReady()
      },
    },
  })
  const batches: Array<
    Array<
      Omit<PublicationChange, `previousValue`> & { previousValue?: Row | null }
    >
  > = []
  const handles = new Map<
    `outer` | `inner` | `current`,
    ReturnType<typeof collection._deferPublication>
  >()
  let subscription: ReturnType<typeof collection.subscribeChanges> | undefined
  const failures: Array<unknown> = []

  try {
    for (const command of commands) {
      if (command.type === `open`) {
        handles.set(command.handle, collection._deferPublication())
      } else if (command.type === `close`) {
        const handle = handles.get(command.handle)
        if (!handle) throw new Error(`missing ${command.handle} handle`)
        handle[command.outcome]()
        if (command.handle === `current`) {
          expect(batches).toEqual(expectedDeferralBatches(commands))
        } else if (command.handle === `outer` && subscription) {
          expect(batches).toEqual([])
        }
      } else if (command.type === `write`) {
        operations.begin()
        operations.write({
          type: `insert`,
          value: { id: command.key, value: command.key.charCodeAt(0) },
        })
        operations.commit()
        if (subscription) expect(batches).toEqual([])
      } else if (command.type === `cleanup`) {
        await collection.cleanup()
        expect(collection.status).toBe(`cleaned-up`)
      } else if (command.type === `restart`) {
        collection.startSyncImmediate()
        expect(collection.get(`a`)).toBeUndefined()
      } else {
        subscription = collection.subscribeChanges(
          (changes) =>
            batches.push(
              changes.map(({ type, key, value, previousValue }) => ({
                type,
                key,
                value: cloneRow(value),
                ...(previousValue === undefined ? {} : { previousValue }),
              })),
            ),
          { includeInitialState: false },
        )
      }
    }
    expect(syncRuns).toBe(2)
  } catch (error) {
    failures.push(error)
  } finally {
    try {
      subscription?.unsubscribe()
    } catch (error) {
      failures.push(error)
    }
    try {
      await collection.cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1)
    throw new AggregateError(failures, `Deferral history and cleanup failed`, {
      cause: failures[0],
    })
}

// The selection model: each local choice selects only the keys not yet
// selected, and records the batch that a callback consumer should observe.
// Both snapshot methods make the same choices, so `first` only changes the
// rows of the first full or explicit snapshot.
function expectedSelection(
  first: `full` | `explicit` | `one` | `none`,
  snapshotRows: ReadonlyArray<{ id: string; value: number }>,
): {
  batches: Array<Array<string>>
  selected: Set<string>
} {
  const selected = new Set<string>()
  const expectedBatches: Array<Array<string>> = []
  const firstRows =
    first === `one`
      ? snapshotRows.filter(({ id }) => id === `one`)
      : first === `none`
        ? []
        : snapshotRows
  const choose = (rows: ReadonlyArray<{ id: string; value: number }>) => {
    const batch = rows
      .filter(({ id }) => !selected.has(id))
      .map(({ id }) => `insert:${id}`)
    for (const row of rows) selected.add(row.id)
    if (batch.length > 0) expectedBatches.push(batch)
  }
  choose(firstRows)
  const orderedChoice = snapshotRows.find(({ id }) => !selected.has(id))
  choose(orderedChoice ? [orderedChoice] : [])
  const nextOrderedChoice = snapshotRows.find(({ id }) => !selected.has(id))
  choose(nextOrderedChoice ? [nextOrderedChoice] : [])
  return { batches: expectedBatches, selected }
}

// The publication check compares each command's batches, visible rows, status,
// and unloads with the model. The model predicts the publication step by
// step, and the selection model predicts which keys local snapshots select.
declareOracle({
  check: [runPublicationHistory, runPublicationProduct],
  model: [
    projectPublication,
    publicationDiff,
    publishIfChanged,
    recordSourceWrite,
    expectedSelection,
  ],
  grammar: [deferralCleanupHistories, publicationProductCases],
})

describe(`CollectionSubscription lifecycle publication oracle`, () => {
  // A local snapshot selects source rows for this subscriber. Selection and
  // source application are distinct: snapshots select keys, while each
  // subscription mode also tracks keys delivered through raw source callbacks.
  // For these static, distinct-ranked rows, the reference model selects the
  // requested predicate's rows, then the first unselected ordered row. A
  // callback consumer must never receive a second insert for a present key.
  const snapshotRows = [
    { id: `one`, value: 1 },
    { id: `two`, value: 2 },
    { id: `three`, value: 3 },
  ] as const
  type SnapshotRow = { id: string; value: number }
  type FirstSnapshot = `full` | `explicit` | `one` | `none`
  const selectionCases = ([undefined, false] as const)
    .flatMap((includeInitialState) =>
      ([`full`, `explicit`, `one`, `none`] as const).map((first) => ({
        includeInitialState,
        first,
        reenter: false,
      })),
    )
    .concat([
      { includeInitialState: undefined, first: `full`, reenter: true },
      { includeInitialState: false, first: `full`, reenter: true },
      { includeInitialState: undefined, first: `explicit`, reenter: true },
      { includeInitialState: false, first: `explicit`, reenter: true },
      { includeInitialState: undefined, first: `one`, reenter: true },
      { includeInitialState: false, first: `one`, reenter: true },
    ]) satisfies Array<{
    includeInitialState: undefined | false
    first: FirstSnapshot
    reenter: boolean
  }>
  it.each(selectionCases)(
    `selects each local key once across $first then ordered, includeInitialState=$includeInitialState, reenter=$reenter`,
    async ({ includeInitialState, first, reenter }) => {
      // Local selections are modeled by expectedSelection; visible is the
      // independent callback consumer's row set.
      const { batches: expectedBatches, selected } = expectedSelection(
        first,
        snapshotRows,
      )

      const observedBatches: Array<Array<string>> = []
      const visible = new Set<string>()
      const invalidChanges: Array<string> = []
      const loads: Array<{ cursor?: { lastKey?: string | number } }> = []
      const collection = createCollection<SnapshotRow>({
        id: `snapshot-selection-${first}-${includeInitialState}-${reenter}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            operations.begin()
            for (const value of snapshotRows)
              operations.write({ type: `insert`, value })
            operations.commit()
            operations.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const orderBy = valueOrderBy()
      let inFirstCallback = false
      let nested = false
      const subscription = collection.subscribeChanges(
        (changes) => {
          const batch: Array<string> = []
          for (const change of changes) {
            batch.push(`${change.type}:${change.key}`)
            if (change.type === `insert`) {
              if (visible.has(String(change.key)))
                invalidChanges.push(`duplicate insert:${change.key}`)
              visible.add(String(change.key))
            } else if (change.type === `delete`) {
              visible.delete(String(change.key))
            }
          }
          if (batch.length > 0) observedBatches.push(batch)
          if (reenter && inFirstCallback && !nested) {
            nested = true
            subscription.requestLimitedSnapshot({
              orderBy,
              limit: 1,
              minValues: [1],
            })
          }
        },
        { includeInitialState },
      )
      subscription.setOrderByIndex(index)
      try {
        inFirstCallback = true
        if (first === `full`) subscription.requestSnapshot()
        else if (first === `explicit`) subscription.requestSnapshot({})
        else
          subscription.requestSnapshot({
            where: new Func(`eq`, [
              new PropRef([`id`]),
              new Value(first === `one` ? `one` : `missing`),
            ]),
          })
        inFirstCallback = false
        if (!reenter)
          subscription.requestLimitedSnapshot({
            orderBy,
            limit: 1,
            minValues: [1],
          })
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [1],
        })

        // Snapshot enumeration order is not part of the key-selection law.
        expect(observedBatches.map((batch) => [...batch].sort())).toEqual(
          expectedBatches.map((batch) => [...batch].sort()),
        )
        expect(invalidChanges).toEqual([])
        expect([...visible].sort()).toEqual([...selected].sort())
        // Local selections do not certify a provider prefix. Without an
        // explicit offset, the adapter request begins at the source prefix
        // and carries no key-based cursor hint, including after a full read.
        expect(loads.at(-1)).toMatchObject({ offset: 0 })
        expect(loads.at(-1)?.cursor?.lastKey).toBeUndefined()
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
  it(`reconstructs every bounded deferral cleanup history`, () => {
    expect(deferralCleanupHistories).toHaveLength(32)
    expect(new Set(deferralCleanupHistories.map(({ name }) => name)).size).toBe(
      32,
    )
  })
  it.each(deferralCleanupHistories)(
    `publishes independent batches after deferral cleanup: $name`,
    async ({ commands }) => {
      await runDeferralCleanupHistory(commands)
    },
  )
  it.each(
    ([`initial`, `replay`, `restart`] as const).flatMap((phase) =>
      [1, 2].flatMap((demandCount) =>
        ([`resolve`, `reject`] as const).flatMap((outcome) =>
          ([`oldest-first`, `newest-first`] as const).map((order) => ({
            phase,
            demandCount,
            outcome,
            order,
          })),
        ),
      ),
    ),
  )(
    `observes retired transports without subscriber activity: %j`,
    async ({ phase, demandCount, outcome, order }) => {
      const history: Array<PublicationCommand> = [
        { type: `source`, key: `c`, action: `upsert`, value: 42 },
        { type: `request`, demand: `a` },
        ...(demandCount === 2
          ? [{ type: `request` as const, demand: `b` as const }]
          : []),
        ...(phase === `replay`
          ? [{ type: `truncate` as const }]
          : phase === `restart`
            ? [{ type: `cleanup` as const }, { type: `restart` as const }]
            : []),
      ]
      const reached: Array<number> = []
      await runPublicationHistory(history, {
        terminal: {
          order,
          outcome,
          expectedPending: demandCount * (phase === `initial` ? 1 : 2),
          reached,
        },
      })
      expect(new Set(reached).size).toBe(
        demandCount * (phase === `initial` ? 1 : 2),
      )
    },
  )
  it(`keeps raw source updates after retiring the final replay owner`, async () => {
    await runPublicationHistory([
      { type: `cleanup` },
      { type: `release`, demand: `b` },
      { type: `request`, demand: `b` },
      { type: `restart` },
      { type: `source`, key: `d`, action: `upsert`, value: 0 },
      { type: `abort`, demand: `b` },
      { type: `release`, demand: `b` },
      { type: `abort`, demand: `b` },
      { type: `source`, key: `d`, action: `upsert`, value: 4 },
      { type: `release`, demand: `b` },
      { type: `restart` },
      { type: `unsubscribe` },
    ])
  })
  it(`keeps raw truncate deletes after retiring the final replay owner`, async () => {
    await runPublicationHistory([
      {
        type: `settle`,
        demand: `a`,
        scope: `obsolete`,
        age: `oldest`,
        outcome: `reject`,
      },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `reject`,
      },
      { type: `request`, demand: `a` },
      { type: `cleanup` },
      { type: `restart` },
      { type: `source`, key: `a`, action: `upsert`, value: 5 },
      { type: `release`, demand: `a` },
      { type: `restart` },
      { type: `truncate` },
    ])
  })
  it(`records requested snapshot rows before a canceled reset`, async () => {
    await runPublicationHistory([
      { type: `request`, demand: `b` },
      { type: `truncate` },
      { type: `source`, key: `b`, action: `upsert`, value: 0 },
      { type: `release`, demand: `b` },
      { type: `request`, demand: `b` },
      { type: `restart` },
      { type: `abort`, demand: `a` },
      { type: `abort`, demand: `b` },
      { type: `restart` },
      { type: `truncate` },
      { type: `restart` },
      { type: `unsubscribe` },
      { type: `release`, demand: `b` },
    ])
  })
  it(`does not republish an unchanged raw source row`, async () => {
    await runPublicationHistory([
      { type: `request`, demand: `a` },
      { type: `cleanup` },
      { type: `restart` },
      { type: `source`, key: `a`, action: `upsert`, value: 5 },
      { type: `release`, demand: `a` },
      { type: `source`, key: `a`, action: `upsert`, value: 5 },
      { type: `unsubscribe` },
    ])
  })
  it.each(
    ([`none`, `retained`, `refreshed`, `new`] as const).flatMap((baseline) =>
      ([`delete`, `empty`, `same`, `other`] as const).map((reset) => ({
        baseline,
        reset,
      })),
    ),
  )(
    `distinguishes raw source resets from retained replacements: $baseline/$reset`,
    async ({ baseline, reset }) => {
      await runPublicationHistory([
        ...(baseline === `retained` || baseline === `refreshed`
          ? [{ type: `source`, key: `d`, action: `upsert`, value: 0 } as const]
          : []),
        { type: `request`, demand: `a` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `source`, key: `a`, action: `upsert`, value: 5 },
        { type: `release`, demand: `a` },
        ...(baseline === `refreshed` || baseline === `new`
          ? [{ type: `source`, key: `d`, action: `upsert`, value: 0 } as const]
          : []),
        reset === `delete`
          ? { type: `source`, key: `a`, action: `delete`, value: 0 }
          : {
              type: `truncate`,
              ...(reset === `same`
                ? { replacement: { id: `a`, value: 5 } as const }
                : reset === `other`
                  ? { replacement: { id: `c`, value: 6 } as const }
                  : {}),
            },
        { type: `unsubscribe` },
      ])
    },
  )
  it(`reconciles a repeated reset after the last replay owner aborts`, async () => {
    await runPublicationHistory([
      { type: `source`, key: `a`, action: `upsert`, value: 0 },
      { type: `request`, demand: `a` },
      { type: `truncate` },
      { type: `abort`, demand: `a` },
      { type: `truncate` },
      {
        type: `settle`,
        demand: `a`,
        scope: `obsolete`,
        age: `newest`,
        outcome: `resolve`,
      },
      { type: `cleanup` },
    ])
  })
  it(`keeps independent source rows when a replay settles after redundant restart calls`, async () => {
    await runPublicationHistory([
      { type: `source`, key: `a`, action: `upsert`, value: 0 },
      { type: `request`, demand: `a` },
      {
        type: `settle`,
        demand: `b`,
        scope: `current`,
        age: `oldest`,
        outcome: `reject`,
      },
      { type: `truncate` },
      { type: `source`, key: `b`, action: `upsert`, value: 1 },
      { type: `restart` },
      {
        type: `settle`,
        demand: `b`,
        scope: `current`,
        age: `newest`,
        outcome: `reject`,
      },
      { type: `restart` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `truncate` },
      { type: `request`, demand: `b` },
      { type: `cleanup` },
    ])
  })
  it(`defines all 288 unique row-publication lifecycle cells`, () => {
    expect(publicationProductCases).toHaveLength(288)
    expect(new Set(publicationProductCases.map(({ name }) => name)).size).toBe(
      288,
    )
    expect(successfulReplacementCases).toHaveLength(32)
    expect(replacementOrderingCases).toHaveLength(6)
    expect(replacementRetirementCases).toHaveLength(46)
    expect(publicationControlCases).toHaveLength(204)
  })
  it.each(publicationControlSlices)(
    `matches row publications for lifecycle control cells $name`,
    async ({ scenarios }) => {
      expectNoPublicationMismatches(await runPublicationProduct(scenarios))
    },
  )
  it(`preserves independent source commits while replay acquisitions settle`, async () => {
    expectNoPublicationMismatches(
      await runPublicationProduct(successfulReplacementCases),
    )
  })
  it(`publishes raw transactions regardless of independent key order`, async () => {
    expectNoPublicationMismatches(
      await runPublicationProduct(replacementOrderingCases),
    )
  })
  it(`retires replay demand without retracting applied source rows`, async () => {
    expectNoPublicationMismatches(
      await runPublicationProduct(replacementRetirementCases),
    )
  })
  it(`maps every canonical green lifecycle history to public rows`, async () => {
    for (const history of greenLifecycleHistories) {
      await runPublicationHistory(history)
    }
  })
  it(`suppresses canceled source writes when a released acquisition settles`, async () => {
    await runPublicationHistory(
      [
        { type: `request`, demand: `a` },
        { type: `request`, demand: `b` },
        { type: `release`, demand: `a` },
        {
          type: `settle`,
          demand: `a`,
          scope: `obsolete`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `release`, demand: `b` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `unsubscribe` },
      ],
      { continueAfterMismatch: true },
    )
  })
  it(`publishes an authoritative truncate after the final demand is released`, async () => {
    await runPublicationHistory([
      { type: `request`, demand: `b` },
      {
        type: `settle`,
        demand: `b`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `release`, demand: `b` },
      { type: `truncate` },
      { type: `unsubscribe` },
    ])
  })
  it(`publishes independent source changes before a successful replay settles`, async () => {
    await runPublicationHistory(
      [
        { type: `request`, demand: `a` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `truncate` },
        { type: `source`, key: `b`, action: `upsert`, value: 50 },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `release`, demand: `a` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `unsubscribe` },
      ],
      { continueAfterMismatch: true },
    )
  })
  it(`does not republish a row already delivered by a live change`, async () => {
    await runPublicationHistory(
      [
        { type: `source`, key: `a`, action: `upsert`, value: 0 },
        { type: `request`, demand: `b` },
        { type: `source`, key: `b`, action: `upsert`, value: 1 },
        { type: `request`, demand: `b` },
        { type: `release`, demand: `b` },
        { type: `release`, demand: `b` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `unsubscribe` },
      ],
      { continueAfterMismatch: true },
    )
  })
  it(`suppresses canceled source writes when an aborted acquisition settles`, async () => {
    await runPublicationHistory(
      [
        { type: `request`, demand: `a` },
        { type: `abort`, demand: `a` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `release`, demand: `a` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `unsubscribe` },
      ],
      { continueAfterMismatch: true },
    )
  })
  it(`publishes later source changes after a failed replay`, async () => {
    await runPublicationHistory([
      { type: `request`, demand: `a` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `truncate` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `reject`,
      },
      { type: `source`, key: `b`, action: `upsert`, value: 51 },
    ])
  })
  // Demand retirement cannot retract applied source commits. These histories
  // keep same-key writes, deletes and undemanded rows visible at every commit.
  it.each([
    [
      `a value written during the replay`,
      [
        { type: `source`, key: `a`, action: `upsert`, value: 1 },
        { type: `request`, demand: `a` },
        { type: `truncate` },
        { type: `abort`, demand: `a` },
        { type: `source`, key: `a`, action: `upsert`, value: 0 },
        { type: `release`, demand: `a` },
        { type: `request`, demand: `a` },
      ],
    ],
    [
      `a value written again after the replay retired`,
      [
        { type: `source`, key: `a`, action: `upsert`, value: 1 },
        { type: `request`, demand: `a` },
        { type: `truncate` },
        { type: `abort`, demand: `a` },
        { type: `source`, key: `a`, action: `upsert`, value: 2 },
        { type: `release`, demand: `a` },
        { type: `source`, key: `a`, action: `upsert`, value: 2 },
      ],
    ],
    [
      `a row no demand names`,
      [
        { type: `source`, key: `c`, action: `upsert`, value: 1 },
        { type: `request`, demand: `a` },
        { type: `truncate` },
        { type: `abort`, demand: `a` },
        { type: `source`, key: `c`, action: `upsert`, value: 2 },
        { type: `release`, demand: `a` },
      ],
    ],
    [
      `a row deleted during the replay`,
      [
        { type: `source`, key: `a`, action: `upsert`, value: 1 },
        { type: `request`, demand: `a` },
        { type: `truncate` },
        { type: `abort`, demand: `a` },
        { type: `source`, key: `a`, action: `delete`, value: 0 },
        { type: `release`, demand: `a` },
        { type: `request`, demand: `a` },
      ],
    ],
    [
      `a row deleted during a failed replay before the next one`,
      [
        { type: `source`, key: `a`, action: `upsert`, value: 1 },
        { type: `request`, demand: `a` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `truncate` },
        { type: `source`, key: `a`, action: `delete`, value: 0 },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `reject`,
        },
        { type: `release`, demand: `a` },
        { type: `request`, demand: `b` },
        {
          type: `settle`,
          demand: `b`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `truncate` },
        { type: `release`, demand: `b` },
      ],
    ],
    [
      `an undemanded row deleted during a failed replay before the next one`,
      [
        { type: `source`, key: `c`, action: `upsert`, value: 1 },
        { type: `request`, demand: `a` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `truncate` },
        { type: `source`, key: `c`, action: `delete`, value: 0 },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `reject`,
        },
        { type: `release`, demand: `a` },
        { type: `request`, demand: `b` },
        {
          type: `settle`,
          demand: `b`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `truncate` },
        { type: `release`, demand: `b` },
      ],
    ],
  ] as Array<[string, Array<PublicationCommand>]>)(
    `leaves no stale row after a retired replay: %s`,
    async (_, history) => {
      await runPublicationHistory(history)
    },
  )
  // Replay failure decides acquisition authority, not applied raw membership.
  // Retiring its failed owner does not retract or republish source rows.
  it(`keeps applied rows when a failed replay final owner releases`, async () => {
    await runPublicationHistory([
      { type: `source`, key: `a`, action: `upsert`, value: 1 },
      { type: `request`, demand: `a` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `truncate` },
      { type: `source`, key: `a`, action: `upsert`, value: 5 },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `reject`,
      },
      { type: `release`, demand: `a` },
    ])
  })
  it(`keeps publishing source writes after failed replay retirement`, async () => {
    await runPublicationHistory(
      [
        { type: `source`, key: `b`, action: `upsert`, value: 7 },
        { type: `request`, demand: `a` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `truncate` },
        { type: `source`, key: `b`, action: `upsert`, value: 51 },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `reject`,
        },
        { type: `release`, demand: `a` },
        { type: `source`, key: `b`, action: `upsert`, value: 8 },
        { type: `cleanup` },
        { type: `restart` },
        { type: `unsubscribe` },
      ],
      { continueAfterMismatch: true },
    )
  })
  it(`does not delete an independent public row when releasing a restarted demand`, async () => {
    await runPublicationHistory(
      [
        { type: `source`, key: `b`, action: `upsert`, value: 0 },
        { type: `request`, demand: `a` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `release`, demand: `a` },
        { type: `unsubscribe` },
        { type: `source`, key: `b`, action: `upsert`, value: 1 },
      ],
      { continueAfterMismatch: true },
    )
  })
  it(`publishes restarted source commits while canceled replay work settles`, async () => {
    // Seed 2018803696, path 65:10:2:10:13:12:12:0:0:0. A canceled-only
    // truncate does not discharge the earlier replay's acquisition wait.
    await runPublicationHistory(
      [
        { type: `source`, key: `a`, action: `upsert`, value: 0 },
        { type: `cleanup` },
        { type: `request`, demand: `b` },
        { type: `restart` },
        { type: `abort`, demand: `b` },
        { type: `truncate` },
        { type: `request`, demand: `a` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        {
          type: `settle`,
          demand: `b`,
          scope: `obsolete`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `release`, demand: `a` },
        { type: `release`, demand: `b` },
        { type: `unsubscribe` },
      ],
      { continueAfterMismatch: true },
    )
  })
  it(`matches retained rows across an empty restart and canceled-only truncates`, async () => {
    // Seed 2018803696, path 65:29:0:0:0 exposed the model's missing retained-row
    // deletion: an authoritative empty reset is not limited to resident rows.
    await runPublicationHistory(
      [
        { type: `source`, key: `a`, action: `upsert`, value: 0 },
        { type: `release`, demand: `a` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `request`, demand: `b` },
        { type: `restart` },
        { type: `abort`, demand: `b` },
        { type: `abort`, demand: `b` },
        { type: `truncate` },
        { type: `truncate` },
        { type: `request`, demand: `b` },
        {
          type: `settle`,
          demand: `b`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        {
          type: `settle`,
          demand: `b`,
          scope: `obsolete`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `release`, demand: `b` },
        { type: `release`, demand: `b` },
        { type: `unsubscribe` },
      ],
      { continueAfterMismatch: true },
    )
  })
  it.each(
    [false, true].flatMap((restart) =>
      [false, true].map((canceledOwner) => ({ restart, canceledOwner })),
    ),
  )(
    `publishes an authoritative empty reset: %j`,
    async ({ restart, canceledOwner }) => {
      await runPublicationHistory([
        { type: `source`, key: `a`, action: `upsert`, value: 0 },
        ...(restart
          ? [{ type: `cleanup` } as const, { type: `restart` } as const]
          : []),
        ...(canceledOwner
          ? [
              { type: `request`, demand: `b` } as const,
              { type: `abort`, demand: `b` } as const,
            ]
          : []),
        { type: `truncate` },
        { type: `truncate` },
        { type: `request`, demand: `a` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `release`, demand: `a` },
        { type: `release`, demand: `b` },
        { type: `unsubscribe` },
      ])
    },
  )
  it.each(
    [false, true].flatMap((canceledOwner) =>
      (
        [
          { id: `a`, value: 0 },
          { id: `a`, value: 1 },
          { id: `c`, value: 2 },
        ] satisfies Array<Row>
      ).map((replacement) => ({ canceledOwner, replacement })),
    ),
  )(
    `installs a retained-row replacement atomically: %j`,
    async ({ canceledOwner, replacement }) => {
      await runPublicationHistory([
        { type: `source`, key: `a`, action: `upsert`, value: 0 },
        { type: `cleanup` },
        { type: `restart` },
        ...(canceledOwner
          ? [
              { type: `request`, demand: `b` } as const,
              { type: `abort`, demand: `b` } as const,
            ]
          : []),
        { type: `truncate`, replacement },
        { type: `source`, key: replacement.id, action: `upsert`, value: 3 },
        { type: `release`, demand: `b` },
        { type: `unsubscribe` },
      ])
    },
  )
  it.each([
    undefined,
    { id: `a`, value: 0 },
    { id: `a`, value: 1 },
    { id: `c`, value: 2 },
  ] satisfies Array<Row | undefined>)(
    `publishes eager restart before a later source reset: %j`,
    async (replacement) => {
      await runPublicationHistory(
        [
          { type: `source`, key: `a`, action: `upsert`, value: 0 },
          { type: `cleanup` },
          { type: `restart` },
          { type: `truncate`, replacement },
          { type: `source`, key: `a`, action: `upsert`, value: 3 },
          { type: `unsubscribe` },
        ],
        { withoutLoader: true },
      )
    },
  )
  it(`resets retained rows after no-op cleanup and release commands`, async () => {
    // Seed 1657005, path 164:18 after removing the visible-row request omission.
    await runPublicationHistory([
      { type: `source`, key: `a`, action: `upsert`, value: 1 },
      { type: `cleanup` },
      { type: `cleanup` },
      { type: `release`, demand: `b` },
      { type: `restart` },
      { type: `truncate` },
      { type: `request`, demand: `a` },
      { type: `release`, demand: `a` },
      { type: `request`, demand: `a` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `release`, demand: `a` },
      { type: `unsubscribe` },
    ])
  })
  it(`resets retained rows after the last replay owner retires`, async () => {
    // Seed 333468655, path 59:13:0:0:0.
    await runPublicationHistory([
      { type: `source`, key: `a`, action: `upsert`, value: 0 },
      { type: `request`, demand: `b` },
      { type: `truncate` },
      { type: `release`, demand: `b` },
      { type: `truncate` },
      { type: `release`, demand: `a` },
      { type: `truncate` },
      { type: `request`, demand: `a` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `release`, demand: `a` },
      { type: `unsubscribe` },
    ])
  })
  it(`does not restore source rows when the final replay owner retires`, async () => {
    // Seed 1337491191, path 591:20:1:8:8:8:7:7.
    await runPublicationHistory([
      { type: `source`, key: `a`, action: `upsert`, value: 0 },
      { type: `restart` },
      { type: `truncate` },
      { type: `source`, key: `a`, action: `upsert`, value: 0 },
      { type: `request`, demand: `b` },
      { type: `truncate` },
      { type: `release`, demand: `b` },
      { type: `source`, key: `a`, action: `delete`, value: 0 },
      { type: `source`, key: `a`, action: `upsert`, value: 1 },
      { type: `unsubscribe` },
    ])
  })
  const { multiplier, ...replay } = readOracleRunConfig()
  const runs = 60 * multiplier
  fcTest.prop([publicationCommandHistoryArbitrary], {
    numRuns: runs,
    seed: 1_657_005,
  })(
    `matches row publications for a fixed seed`,
    async (history) => {
      await runPublicationHistory(history)
    },
    120_000,
  )
  fcTest.prop(
    [publicationCommandHistoryArbitrary],
    oracleRandomParameters(
      runs,
      replay,
      `subscription-lifecycle.publication-history`,
    ),
  )(
    `matches row publications for a random or replayed seed`,
    async (history) => {
      await runPublicationHistory(history)
    },
    120_000,
  )
})

/** Raw source commits have one public result for reads and full-state raw
 * subscribers. The shared companion owns the clarified maintainer law.
 * This driver authors source transactions, records their applied prefixes and
 * every public callback, and never reads replay state to predict public rows.
 * The primary model above enacts the same law with exact callback batches.
 * This companion driver adds every public read path at applied transaction cuts.
 */
type AtomicSnapshotCut = {
  label: string
  history: PublicSnapshotHistory
  phase: PublicSnapshotPhase
  observation: PublicSnapshotObservation
}
const atomicSnapshotReachStates = [
  `held-after-truncate`,
  `held-after-candidate-commit`,
  `held-after-equal-followup`,
  `quiet-failure`,
  `failed-retirement`,
  `successful-retry`,
  `successful-publication`,
  `cleanup-old-work-fenced`,
  `restarted-publication`,
] as const

async function receiveAtomicPublicSnapshot(
  history: PublicSnapshotHistory,
  retireFailure = false,
): Promise<{
  cuts: Array<AtomicSnapshotCut>
  reached: Set<(typeof atomicSnapshotReachStates)[number]>
  progress: Array<string>
  receipts: Array<{ applied: boolean; rejected?: unknown }>
}> {
  const cuts: Array<AtomicSnapshotCut> = []
  const reached = new Set<(typeof atomicSnapshotReachStates)[number]>()
  const progress: Array<string> = []
  const fold = new Map<RowKey, Row>()
  const keys: Array<RowKey> = [`a`, `b`, `c`, `d`]
  const where = new Map<DemandName, Func>([
    [`a`, new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])],
    [`b`, new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])],
  ])
  type Load = {
    options: { signal?: AbortSignal }
    deferred: ReturnType<typeof createDeferred<void>>
    group: number
    outcome: `pending` | `resolve` | `reject`
  }
  const loads: Array<Load> = []
  const receipts: Array<{ applied: boolean; rejected?: unknown }> = []
  const appliedCommits: Array<PublicSnapshotCommit> = []
  let publishingCommit: PublicSnapshotCommit | undefined
  const errors: Array<unknown> = []
  let operations!: SyncOperations
  let replaying = false
  let currentHistory = history
  let currentPhase: PublicSnapshotPhase = `initial`
  const phase = () => currentPhase
  let recording = false
  let run = 0
  let group = 0
  const collection = createCollection<Row, RowKey>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (next) => {
        operations = next
        run++
        next.markReady()
        return {
          loadSubset: (options) => {
            if (!replaying) return true
            const deferred = createDeferred<void>()
            void deferred.promise.catch(() => undefined)
            loads.push({ options, deferred, group, outcome: `pending` })
            return deferred.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  let index = collection.createIndex((row) => row.value, {
    indexType: BTreeIndex,
  })
  const observe = (): PublicSnapshotObservation => ({
    appliedCommits: [
      ...appliedCommits,
      ...(publishingCommit ? [publishingCommit] : []),
    ],
    reads: {
      get: keys.flatMap((key) => {
        const row = collection.get(key)
        return row === undefined ? [] : [cloneRow(row)]
      }),
      values: [...collection.values()].map(cloneRow),
      entries: [...collection.entries()].map(([, row]) => cloneRow(row)),
      toArray: collection.toArray.map(cloneRow),
    },
    keys: {
      has: keys.filter((key) => collection.has(key)),
      keys: [...collection.keys()],
      indexedSelection: [...index.lookup(`gte`, Number.NEGATIVE_INFINITY)],
    },
    sizes: { size: collection.size },
    foldedRows: [...fold.values()].map(cloneRow),
  })
  const record = (label: string) => {
    if (collection.indexes.get(index.id) !== index)
      throw new Error(
        `Public index observation requires an active registered index`,
      )
    cuts.push({
      label,
      history: currentHistory,
      phase: currentPhase,
      observation: observe(),
    })
  }
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.type === `delete`) fold.delete(change.key)
        else fold.set(change.key, cloneRow(change.value))
      }
      if (recording) record(`callback:${cuts.length}`)
    },
    { includeInitialState: false },
  )
  subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))

  // Submission is independent of receipt fulfillment. Adapter load success
  // below still waits for the exact applied receipt; changing that promise
  // into acceptance would make a different protocol pass this driver.
  const commit = (
    rows: ReadonlyArray<Row>,
    truncate = false,
    update = false,
  ) => {
    const authored: PublicSnapshotCommit = {
      ...(truncate ? { truncate: true } : {}),
      rows: rows.map(cloneRow),
    }
    operations.begin()
    if (truncate) operations.truncate()
    for (const row of rows)
      operations.write({
        type: update ? `update` : `insert`,
        value: cloneRow(row),
      })
    // Core calls a raw subscriber while this authored transaction publishes,
    // before returning its receipt. That callback cut includes this commit.
    publishingCommit = authored
    let receipt: ReturnType<SyncOperations[`commit`]>
    try {
      receipt = operations.commit()
    } finally {
      publishingCommit = undefined
    }
    if (receipt === true) appliedCommits.push(authored)
    const observation: { applied: boolean; rejected?: unknown } = {
      applied: receipt === true,
    }
    receipts.push(observation)
    const applied =
      receipt === true
        ? Promise.resolve()
        : receipt.then(
            () => {
              observation.applied = true
              appliedCommits.push(authored)
            },
            (error: unknown) => {
              observation.rejected = error
              throw error
            },
          )
    void applied.catch(() => undefined)
    return applied
  }
  const flush = async () => {
    await flushPromises()
    await flushPromises()
  }
  const succeed = (load: Load, rows: ReadonlyArray<Row>) => {
    const applied = commit(rows)
    // Provider success still waits for its exact applied receipt. The raw
    // commit is public before the whole replay's provider work succeeds.
    void applied.then(
      () => {
        if (load.options.signal?.aborted) return
        load.outcome = `resolve`
        if (
          loads
            .filter((candidate) => candidate.group === load.group)
            .every((candidate) => candidate.outcome === `resolve`)
        )
          currentPhase = `complete`
        load.deferred.resolve()
      },
      (error: unknown) => load.deferred.reject(error),
    )
  }
  const startReplay = async () => {
    replaying = true
    group++
    currentPhase = `held`
    const start = loads.length
    void commit([], true)
    await flush()
    if (loads.length - start !== 2)
      throw new Error(
        `Replay setup did not acquire both retained demands: ${loads.length - start}`,
      )
    return loads.slice(start)
  }
  const failure = new Error(`controlled replay failure`)
  const cleanupFailures: Array<unknown> = []
  try {
    // Initial source delivery is complete before either logical demand starts.
    recording = true
    await commit(history.initial)
    await flush()
    record(`initial-publication`)
    for (const predicate of where.values())
      subscription.requestSnapshot({ where: predicate })
    await flush()
    const replay = await startReplay()
    reached.add(`held-after-truncate`)
    record(`after-truncate-before-provider-delivery`)
    const firstRows = history.replacement.filter(({ id }) => id !== `b`)
    const lastRows = history.replacement.filter(({ id }) => id === `b`)
    succeed(replay[0]!, firstRows)
    await flush()
    reached.add(`held-after-candidate-commit`)
    record(`candidate-applied-while-sibling-held`)
    // An equal follow-up cannot repair a missing earlier raw publication.
    const equal = firstRows[0]
    if (equal) {
      void commit([equal], false, true)
      await flush()
      reached.add(`held-after-equal-followup`)
      record(`equal-followup-while-sibling-held`)
    }
    if (history.outcome === `reject`) {
      replay[1]!.outcome = `reject`
      replay[1]!.deferred.reject(failure)
      await flush()
      const quietFailure = replay.every((load) => load.outcome !== `pending`)
      currentPhase = quietFailure ? `failed` : `held`
      record(
        quietFailure
          ? `quiet-failure`
          : `failed-response-with-first-load-pending`,
      )
      if (quietFailure) reached.add(`quiet-failure`)
      else
        progress.push(
          `Applied receipt held the first load before replay failure could be judged`,
        )
      if (quietFailure && !errors.includes(failure))
        progress.push(`Replay did not report its exact injected Error`)
      if (retireFailure) {
        // Retire successful demand first, failed demand last. This cannot
        // manufacture a successful remaining-demand verdict between releases.
        subscription.releaseSnapshot(where.get(`a`)!)
        subscription.releaseSnapshot(where.get(`b`)!)
        await flush()
        if (!replay.every((load) => load.options.signal?.aborted))
          throw new Error(
            `Final-owner retirement did not abort each acquisition`,
          )
        currentPhase = `failed`
        reached.add(`failed-retirement`)
        record(`quiet-failed-final-owner-retirement`)
      } else {
        currentHistory = { ...history, outcome: `resolve` }
        const retry = await startReplay()
        succeed(retry[0]!, firstRows)
        await flush()
        record(`retry-sibling-held`)
        succeed(retry[1]!, lastRows)
        await flush()
        record(`successful-authoritative-retry`)
        if (phase() === `complete`) reached.add(`successful-retry`)
        else
          progress.push(
            `Applied receipt held a load needed by successful replay: retry`,
          )
      }
    } else {
      succeed(replay[1]!, lastRows)
      await flush()
      record(`successful-coherent-publication`)
      if (phase() === `complete`) reached.add(`successful-publication`)
      else
        progress.push(
          `Applied receipt held a load needed by successful replay: initial`,
        )
    }
    // Cleanup-time fold/direct equality is not asserted. Old provider work
    // must still lose authority, and a new run must publish only its own rows.
    recording = false
    await collection.cleanup()
    expect(collection.toArray, `cleanup clears direct rows`).toEqual([])
    for (const load of loads) load.deferred.resolve()
    await flush()
    expect(collection.toArray, `old work stays fenced after cleanup`).toEqual(
      [],
    )
    reached.add(`cleanup-old-work-fenced`)
    const beforeRun = run
    replaying = false
    collection.startSyncImmediate()
    await flush()
    expect(run, `restart starts a new sync run`).toBe(beforeRun + 1)
    // Cleanup removes index registration. Observe the new run through an active
    // index, created before its source transaction so maintenance stays tested.
    index = collection.createIndex((row) => row.value, {
      indexType: BTreeIndex,
    })
    // A new authoritative snapshot establishes a coherent active-run cut.
    currentHistory = { ...history, outcome: `resolve` }
    currentPhase = `complete`
    replaying = false
    await commit(history.replacement, true)
    await flush()
    recording = true
    record(`restarted-authoritative-publication`)
    reached.add(`restarted-publication`)
  } finally {
    recording = false
    for (const load of loads) load.deferred.resolve()
    try {
      subscription.unsubscribe()
    } catch (error) {
      cleanupFailures.push(error)
    }
    try {
      await collection.cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (cleanupFailures.length > 0)
    throw new AggregateError(
      cleanupFailures,
      `Atomic public snapshot cleanup failed`,
    )
  return { cuts, reached, progress, receipts }
}

function checkAtomicPublicSnapshot(
  result: Awaited<ReturnType<typeof receiveAtomicPublicSnapshot>>,
): void {
  const failures: Array<Error> = []
  for (const cut of result.cuts) {
    try {
      checkPublicSnapshotObservation(cut.history, cut.phase, cut.observation)
    } catch (error) {
      failures.push(
        new Error(`Collection public snapshot at ${cut.label}`, {
          cause: error,
        }),
      )
    }
  }
  if (failures.length > 0) {
    process.stdout.write(
      `PUBLIC_SNAPSHOT_COUNTEREXAMPLE ${JSON.stringify({
        cuts: result.cuts,
        progress: result.progress,
        receipts: result.receipts,
      })}\n`,
    )
    throw new AggregateError(
      failures,
      `Collection public snapshot mismatches at ${failures.map(({ message }) => message).join(`; `)}`,
      { cause: failures[0] },
    )
  }
  expect(
    result.progress,
    `Applied-receipt protocol progress is a separate obligation`,
  ).toEqual([])
}

declareOracle({
  check: [checkAtomicPublicSnapshot],
  grammar: [publicSnapshotHistoryArbitrary],
})

describe(`Collection atomic public snapshot`, () => {
  it(`rejects stale, missing, extra and absent raw public observations`, () => {
    const history = publicSnapshotHistoryExamples.find(
      ({ initial, replacement, outcome }) =>
        initial.length > 0 &&
        replacement.some(
          ({ value }, index) => value !== initial[index]?.value,
        ) &&
        outcome === `resolve`,
    )!
    const appliedCommits: Array<PublicSnapshotCommit> = [
      { truncate: true, rows: history.replacement },
    ]
    const expected = expectedPublicSnapshot(history, appliedCommits)
    const valid = {
      appliedCommits,
      reads: { values: expected },
      foldedRows: expected,
    }
    checkPublicSnapshotObservation(history, `held`, valid)
    // A later load failure cannot retract a source transaction that applied.
    checkPublicSnapshotObservation(
      { ...history, outcome: `reject` },
      `failed`,
      valid,
    )
    for (const rows of [
      history.initial,
      expected.slice(1),
      [...expected, { id: `d` as const, value: 999 }],
    ])
      expect(() =>
        checkPublicSnapshotObservation(history, `held`, {
          ...valid,
          reads: { values: rows },
        }),
      ).toThrow()
    expect(() =>
      checkPublicSnapshotObservation(history, `held`, {
        ...valid,
        foldedRows: history.initial,
      }),
    ).toThrow()
    expect(() =>
      checkPublicSnapshotObservation(history, `held`, { ...valid, reads: {} }),
    ).toThrow()
    expect(() =>
      checkPublicSnapshotObservation(history, `held`, {
        appliedCommits,
        reads: valid.reads,
      } as unknown as PublicSnapshotObservation),
    ).toThrow()
    expect(() =>
      checkPublicSnapshotObservation(history, `held`, {
        reads: valid.reads,
        foldedRows: expected,
      } as unknown as PublicSnapshotObservation),
    ).toThrow()
    expect(() =>
      checkPublicSnapshotObservation(history, `held`, {
        ...valid,
        keys: { indexedSelection: [] },
      }),
    ).toThrow()
  })
  // Named replay inputs use the same provider driver and shared judgment.
  // They do not contribute to the generated campaign's reach counters.
  it.each(
    publicSnapshotHistoryExamples.map((history, index) => ({ history, index })),
  )(`replays atomic public snapshot input $index`, async ({ history }) => {
    const failures: Array<unknown> = []
    for (const retire of history.outcome === `reject`
      ? [false, true]
      : [false]) {
      const result = await receiveAtomicPublicSnapshot(history, retire)
      try {
        checkAtomicPublicSnapshot(result)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        `Atomic snapshot replay inputs failed`,
        { cause: failures[0] },
      )
  })
  const property = `subscription-lifecycle.atomic-public-snapshot`
  const checkCampaign = async (campaign: `fixed` | `random`) => {
    const reach = createOracleReach(property, atomicSnapshotReachStates, {
      minimum: 5,
    })
    const samples: Array<
      Array<Set<(typeof atomicSnapshotReachStates)[number]>>
    > = []
    const checkHistory = async (history: PublicSnapshotHistory) => {
      const sample: (typeof samples)[number] = []
      samples.push(sample)
      const failures: Array<unknown> = []
      // Run both continuations even when the first visibility comparison is
      // RED. Failure cannot silently remove the retirement receiving path.
      for (const retire of history.outcome === `reject`
        ? [false, true]
        : [false]) {
        reach.beginHistory()
        const result = await receiveAtomicPublicSnapshot(history, retire)
        sample.push(result.reached)
        for (const state of result.reached) reach.reach(state)
        try {
          checkAtomicPublicSnapshot(result)
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          `Atomic snapshot continuations failed`,
          { cause: failures[0] },
        )
    }
    const details = await fc.check(
      fc.asyncProperty(publicSnapshotHistoryArbitrary, checkHistory),
      campaign === `fixed`
        ? { seed: 20261030, numRuns: oracleRuns(60) }
        : oraclePropertyOptions(60, property),
    )
    recordOracleReplay(property, details)
    const counts = (records: typeof samples) =>
      Object.fromEntries(
        atomicSnapshotReachStates.map((state) => [
          state,
          records.flat().filter((states) => states.has(state)).length,
        ]),
      )
    process.stdout.write(
      `${JSON.stringify({ property, campaign, seed: details.seed, path: details.counterexamplePath, failed: details.failed, runs: details.numRuns, completedGeneratedReach: counts(samples.slice(0, details.numRuns)), completedShrinkReach: counts(samples.slice(details.numRuns)) })}\n`,
    )
    if (details.failed)
      throw new Error(
        fc.defaultReportMessage(details) ?? `Atomic Collection snapshot failed`,
        { cause: details.errorInstance },
      )
    reach.assertReached()
  }
  it.skipIf(oracleReplayRequested())(
    `checks atomic Collection public snapshots (fixed campaign)`,
    () => checkCampaign(`fixed`),
    120_000,
  )
  it.skipIf(oracleReplaySkips(property))(
    `checks atomic Collection public snapshots (random or replay campaign)`,
    () => checkCampaign(`random`),
    120_000,
  )
})

/**
 * Cleanup leaves a surviving raw subscriber's fold intact until an applied
 * source transaction reconciles it. An optimistic transaction is a different
 * boundary: it publishes its own intent and drops that intent at settlement.
 * It supplies no evidence that untouched cleanup-retained rows disappeared.
 * Authority: Collection.cleanup() in ../src/collection/index.ts documents
 * source clearing, surviving direct subscriptions, and reacquisition after
 * restart. The 2026-10-30 raw-collection-publication-decision.md distinguishes
 * applied source transactions from acquisition and graph-result completion.
 * Together with cleanup's established no-clear-callback contract, this makes
 * absent-row reconciliation source-only. Transaction.when(`settled`) supplies
 * optimistic settlement drop, also enacted by optimistic-history-oracle.ts.
 *
 * This receiving extension uses the same publication Map and diff. Its only
 * extra model fact is whether the disjoint optimistic row is present. Direct
 * reads use the cleared source plus that row; the callback fold also retains
 * the old rows. Those observations intentionally differ until source applies.
 * Bootstrap callback grouping, overlapping retained-key mutations, multiple
 * optimistic transactions, providers, and live queries are outside this law.
 */
type CleanupOptimisticHistory = {
  initial: Array<Row & { id: DemandName }>
  optimisticValue: number
  outcome: `resolve` | `reject`
  sourceNonempty: boolean
  sourceValue: number
}

// One to three unique a/b/c rows ensure a retained key exists. Disjoint d
// isolates untouched-row retention from the mutation's own effects. Values
// 0..5 exercise equal and changed rows. Both settlement outcomes drop d.
// Empty and nonempty later transactions distinguish source origin from a
// nonempty change batch. The driver never authors a source transaction during
// reacquisition, so a source-applied optimistic checkpoint is not legal here.
// Removing cleanup, the pending load, or d loses the reported witness. The
// minimal a=0/d=1 input reconstructs it without a separate expected answer.
const cleanupOptimisticHistoryArbitrary: fc.Arbitrary<CleanupOptimisticHistory> =
  fc.record({
    initial: fc.uniqueArray(
      fc.record({
        id: fc.constantFrom(`a` as const, `b` as const, `c` as const),
        value: fc.integer({ min: 0, max: 5 }),
      }),
      { minLength: 1, maxLength: 3, selector: ({ id }) => id },
    ),
    optimisticValue: fc.integer({ min: 0, max: 5 }),
    outcome: fc.constantFrom(`resolve` as const, `reject` as const),
    sourceNonempty: fc.boolean(),
    sourceValue: fc.integer({ min: 0, max: 5 }),
  })

const cleanupOptimisticReachStates = [
  `restart-source-pending`,
  `optimistic-before-source`,
  `settlement-before-source`,
  `later-source-applied`,
] as const

type CleanupOptimisticCut = {
  label: string
  directRows: Array<Row>
  expectedDirectRows: Array<Row>
  foldedRows: Array<Row>
  expectedFoldedRows: Array<Row>
  batches: Array<Array<PublicationChange>>
  expectedBatches: Array<Array<PublicationChange>>
}

function checkCleanupOptimisticPublication(cut: CleanupOptimisticCut): void {
  const sorted = (rows: ReadonlyArray<Row>) =>
    [...rows].sort((left, right) => left.id.localeCompare(right.id))
  expect(cut.directRows, `${cut.label}: direct current rows`).toEqual(
    sorted(cut.expectedDirectRows),
  )
  expect(
    normalizePublicationOrder(cut.batches),
    `${cut.label}: exact callback batches`,
  ).toEqual(normalizePublicationOrder(cut.expectedBatches))
  expect(
    sorted(cut.foldedRows),
    `${cut.label}: surviving subscriber fold`,
  ).toEqual(sorted(cut.expectedFoldedRows))
}

async function receiveCleanupOptimisticPublication(
  history: CleanupOptimisticHistory,
): Promise<{
  cuts: Array<CleanupOptimisticCut>
  reached: Set<(typeof cleanupOptimisticReachStates)[number]>
}> {
  const publication: PublicationModel = {
    source: new Map(history.initial.map((row) => [row.id, cloneRow(row)])),
    visible: new Map(history.initial.map((row) => [row.id, cloneRow(row)])),
    retainedKeys: new Set(),
    sentKeys: new Set(history.initial.map(({ id }) => id)),
    batches: [],
  }
  const lifecycle = createLifecycleModel()
  const cuts: Array<CleanupOptimisticCut> = []
  const reached = new Set<(typeof cleanupOptimisticReachStates)[number]>()
  const fold = new Map<RowKey, Row>()
  const batches: Array<Array<PublicationChange>> = []
  const operations: Array<SyncOperations> = []
  const loads: Array<{
    generation: number
    signal: AbortSignal | undefined
    done: ReturnType<typeof createDeferred<void>>
  }> = []
  const mutation = createDeferred<void>()
  void mutation.promise.catch(() => undefined)
  let sourceTransactions = 0
  let bootstrapBatches = 0
  let optimisticVisible = false
  const optimistic: Row = { id: `d`, value: history.optimisticValue }
  const collection = createCollection<Row, RowKey>({
    id: `cleanup-optimistic-publication`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (ownOperations) => {
        const generation = operations.push(ownOperations)
        ownOperations.markReady()
        return {
          loadSubset: ({ signal }) => {
            const done = createDeferred<void>()
            void done.promise.catch(() => undefined)
            loads.push({ generation, signal, done })
            // Pending means no provider row was delivered, not merely that a
            // promise remains pending after source writes already applied.
            return done.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(
    (changes) => {
      const batch = changes.map((change): PublicationChange => ({
        type: change.type,
        key: change.key,
        value: cloneRow(change.value),
        ...(change.previousValue === undefined
          ? {}
          : { previousValue: cloneRow(change.previousValue) }),
      }))
      batches.push(batch)
      for (const change of batch) {
        if (change.type === `delete`) fold.delete(change.key)
        else fold.set(change.key, cloneRow(change.value))
      }
    },
    { includeInitialState: false },
  )
  const record = (label: string) => {
    const current = new Map(publication.source)
    if (optimisticVisible) current.set(optimistic.id, cloneRow(optimistic))
    cuts.push({
      label,
      directRows: [...collection.values()]
        .map(cloneRow)
        .sort((left, right) => left.id.localeCompare(right.id)),
      expectedDirectRows: [...current.values()].map(cloneRow),
      foldedRows: [...fold.values()].map(cloneRow),
      expectedFoldedRows: [...publication.visible.values()].map(cloneRow),
      batches: clonePublicationBatches(batches.slice(bootstrapBatches)),
      expectedBatches: clonePublicationBatches(publication.batches),
    })
  }
  const assertHeldSource = () => {
    expect(operations).toHaveLength(2)
    expect(
      loads.some(
        ({ generation, signal }) => generation === 2 && !signal?.aborted,
      ),
    ).toBe(true)
    expect(sourceTransactions).toBe(1)
  }
  let transaction: ReturnType<typeof createTransaction<Row>> | undefined
  const failures: Array<unknown> = []
  try {
    const first = operations[0]!
    first.begin()
    for (const row of history.initial)
      first.write({ type: `insert`, value: cloneRow(row) })
    const receipt = first.commit()
    sourceTransactions++
    if (receipt !== true) await receipt
    reduceLifecycle(lifecycle, {
      type: `request`,
      demand: history.initial[0]!.id,
    })
    subscription.requestSnapshot({
      where: new Func(`eq`, [
        new PropRef([`id`]),
        new Value(history.initial[0]!.id),
      ]),
    })
    await flushPromises()
    bootstrapBatches = batches.length
    record(`bootstrap`)

    await collection.cleanup()
    const cleanup: PublicationCommand = { type: `cleanup` }
    const beforeCleanup = lifecycle.publications
    projectPublication(
      publication,
      lifecycle,
      cleanup,
      reduceLifecycle(lifecycle, cleanup),
      beforeCleanup,
      false,
    )
    const restart: PublicationCommand = { type: `restart` }
    const beforeRestart = lifecycle.publications
    const restartEffect = reduceLifecycle(lifecycle, restart)
    collection.startSyncImmediate()
    await flushPromises()
    // Readiness has its own empty callback in the shared lifecycle model. It
    // announces ready without declaring the on-demand source complete.
    projectPublication(
      publication,
      lifecycle,
      restart,
      restartEffect,
      beforeRestart,
      false,
    )
    assertHeldSource()
    reached.add(`restart-source-pending`)
    record(`restart before source transaction`)

    // The independent expectation changes only d. Missing source rows have
    // not received a source verdict, so this publication cannot delete them.
    const withOptimistic = new Map(publication.visible)
    withOptimistic.set(optimistic.id, cloneRow(optimistic))
    publishIfChanged(publication, withOptimistic)
    optimisticVisible = true
    transaction = createTransaction<Row>({ mutationFn: () => mutation.promise })
    transaction.mutate(() => collection.insert(cloneRow(optimistic)))
    assertHeldSource()
    reached.add(`optimistic-before-source`)
    record(`same-turn optimistic insert before source transaction`)
    await flushPromises()
    record(`held optimistic insert before source transaction`)

    if (history.outcome === `resolve`) mutation.resolve()
    else mutation.reject(new Error(`controlled optimistic rejection`))
    await transaction.when(`settled`).catch(() => undefined)
    await flushPromises()
    optimisticVisible = false
    const withoutOptimistic = new Map(publication.visible)
    withoutOptimistic.delete(optimistic.id)
    publishIfChanged(publication, withoutOptimistic)
    assertHeldSource()
    reached.add(`settlement-before-source`)
    record(`optimistic settlement before source transaction`)

    const sourceRows: Array<Row> = history.sourceNonempty
      ? [{ id: history.initial[0]!.id, value: history.sourceValue }]
      : []
    const latest = operations[1]!
    latest.begin()
    for (const row of sourceRows)
      latest.write({ type: `insert`, value: cloneRow(row) })
    const laterReceipt = latest.commit()
    sourceTransactions++
    if (laterReceipt !== true) await laterReceipt
    publication.source = new Map(
      sourceRows.map((row) => [row.id, cloneRow(row)]),
    )
    publishIfChanged(publication, new Map(publication.source))
    publication.retainedKeys.clear()
    reached.add(`later-source-applied`)
    record(`later applied source transaction`)
  } catch (error) {
    failures.push(error)
  } finally {
    mutation.resolve()
    if (transaction) await transaction.when(`settled`).catch(() => undefined)
    subscription.unsubscribe()
    for (const { done } of loads) done.resolve()
    try {
      await collection.cleanup()
    } catch (error) {
      failures.push(
        new Error(`Cleanup optimistic publication teardown`, { cause: error }),
      )
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `Cleanup optimistic publication driver failed`,
      {
        cause: failures[0],
      },
    )
  return { cuts, reached }
}

declareOracle({
  check: [checkCleanupOptimisticPublication],
  model: [publishIfChanged],
  grammar: [cleanupOptimisticHistoryArbitrary],
})

describe(`Collection cleanup and optimistic publication`, () => {
  const property = `subscription-lifecycle.cleanup-optimistic-publication`
  const checkCampaign = async (campaign: `fixed` | `random`) => {
    const reach = createOracleReach(property, cleanupOptimisticReachStates, {
      minimum: 5,
    })
    const samples: Array<Set<(typeof cleanupOptimisticReachStates)[number]>> =
      []
    const details = await fc.check(
      fc.asyncProperty(cleanupOptimisticHistoryArbitrary, async (history) => {
        reach.beginHistory()
        const result = await receiveCleanupOptimisticPublication(history)
        samples.push(result.reached)
        for (const state of result.reached) reach.reach(state)
        for (const cut of result.cuts) checkCleanupOptimisticPublication(cut)
      }),
      campaign === `fixed`
        ? { seed: 20261030, numRuns: oracleRuns(60) }
        : oraclePropertyOptions(60, property),
    )
    recordOracleReplay(property, details)
    const counts = (records: typeof samples) =>
      Object.fromEntries(
        cleanupOptimisticReachStates.map((state) => [
          state,
          records.filter((states) => states.has(state)).length,
        ]),
      )
    process.stdout.write(
      `${JSON.stringify({ property, campaign, seed: details.seed, path: details.counterexamplePath, failed: details.failed, runs: details.numRuns, completedGeneratedReach: counts(samples.slice(0, details.numRuns)), completedShrinkReach: counts(samples.slice(details.numRuns)) })}\n`,
    )
    if (details.failed)
      throw new Error(
        fc.defaultReportMessage(details) ??
          `Cleanup optimistic publication failed`,
        { cause: details.errorInstance },
      )
    reach.assertReached()
  }
  it.skipIf(oracleReplayRequested())(
    `keeps cleanup-retained rows through optimistic publication (fixed campaign)`,
    () => checkCampaign(`fixed`),
    120_000,
  )
  it.skipIf(oracleReplaySkips(property))(
    `keeps cleanup-retained rows through optimistic publication (random or replay campaign)`,
    () => checkCampaign(`random`),
    120_000,
  )
})
