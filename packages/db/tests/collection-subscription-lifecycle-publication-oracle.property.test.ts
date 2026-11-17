import { fc } from '@fast-check/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
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
  isGeneratedOracleCampaign,
  oracleFixedSeed,
  oracleReplayRequested,
  oracleRoute,
  readOracleRunConfig,
} from './oracle-config.js'
import { oracleProperty } from './oracle-property.js'
import { subscriptionComparison } from './collection-subscription-property-registration.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
} from './oracle-assertion-adapter.js'
import { flushPromises } from './utils.js'
import {
  assertTerminalPublication,
  clonePublicationBatches,
  cloneRow,
  normalizePublicationOrder,
} from './collection-subscription-lifecycle-publication-support'
// The publication command types and the finite row-publication product live
// in this module, unchanged, so the ordinary grammar-size test can import them.
import {
  publicationControlSlices,
  replacementOrderingCases,
  replacementRetirementCases,
  successfulReplacementCases,
} from './collection-subscription-lifecycle-publication-product-oracle.js'
import type {
  PublicationChange,
  PublicationPhase,
  Row,
  RowKey,
  SyncOperations,
  TerminalPublicationSnapshot,
} from './collection-subscription-lifecycle-publication-support'
import type {
  PublicationCommand,
  PublicationProductCase,
  SourceEffect,
  SourceMutation,
} from './collection-subscription-lifecycle-publication-product-oracle.js'
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
 * The lifecycle grammar decides which acquisition attempt is current. This
 * file adds the row-publication node. A truncate opens a private replacement;
 * source writes accumulate there until every gating attempt succeeds. Replay
 * failure keeps the replacement and later source changes private while the
 * last public snapshot remains visible. Releasing the final logical subset
 * owner retires the replacement, since nothing can complete it. A
 * replacement whose current attempt has not failed then publishes the rows
 * it holds, so the subscriber does not keep values the source replaced or
 * deleted during it. One that failed stays private, as a failed replay does
 * until an authoritative replay succeeds, even after its failed owner was
 * released. A later request delivers its installed row, so a row that the
 * subscriber still shows at an older value is updated then.
 * The `Collection.subscribeChanges` API contract in `../src/collection/index.ts`
 * is the authority for callback batches and their per-key causal order. The
 * public Collection lifecycle and shared lifecycle grammar specify cleanup,
 * restart, and which acquisition attempts can authorize a replacement. The
 * Collection's public reads supply the row observation. The coverage map's
 * Collection lifecycle entry limits this owner to Collection publication; it
 * does not establish compiled live-query includes publication or provider
 * behavior beyond the controlled sync adapter below.
 * `requestLimitedSnapshot` promises not to resend keys. A direct snapshot
 * selects keys for this subscription. A source callback can also publish a key
 * that no snapshot selected. Later ordered local snapshots skip either kind of
 * key. A deletion releases a key so a later insert is valid.
 *
 * `source` holds currently installed source rows; `visible` is the public
 * snapshot.
 * `replacement` is the private replacement. `retainedKeys` and `sentKeys` are
 * model-only projections of rows retained after cleanup and keys already sent
 * to this subscriber; neither represents a production ownership state.
 * `PublicationPhase` combines the private replacement and acquisition
 * settlement into one test-case label. It is not a Collection status.
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

/** Resolves a `flip` mutation against the model's visible rows. */
function withFlippedZero(
  command: PublicationCommand,
  publication: PublicationModel,
): PublicationCommand {
  if (command.type !== `source` || !command.flip) return command
  const visible = publication.visible.get(command.key)?.value
  return visible === 0
    ? { ...command, value: Object.is(visible, -0) ? 0 : -0 }
    : command
}

// Reach: source writes that change a public row only by the sign of a zero.
let zeroSignWrites = 0

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

type Replacement = {
  syncRunGeneration: number
  replayGeneration: number
  rows: Map<RowKey, Row>
  failed: boolean
  // A current attempt failed, even if its owner has been released since.
  // Only full retirement reads it: with owners left, a released owner's
  // failure cannot stop a successful replacement.
  everFailed: boolean
}

type PublicationModel = {
  source: Map<RowKey, Row>
  visible: Map<RowKey, Row>
  // Public rows carried across a discarded source/replay, not yet refreshed.
  retainedKeys: Set<RowKey>
  replacement?: Replacement
  batches: Array<Array<PublicationChange>>
  sentKeys: Set<RowKey>
}

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
  visibleBefore: Array<Row>
  writtenRows: Array<Row>
  currentAttempts: number
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
  // After retiring private work, an unseen source row can still be updated.
  // Retained public rows take precedence when reconciling a stale snapshot.
  const previous =
    publication.visible.get(row.id) ?? publication.source.get(row.id)
  if (previous?.value === row.value && !Object.is(previous.value, row.value)) {
    zeroSignWrites++
  }
  publication.source.set(row.id, cloneRow(row))
  publication.retainedKeys.delete(row.id)
  // The same value publishes nothing; -0 and 0 are distinct row values
  // (maintainer decision, 2026-10-29).
  if (previous !== undefined && Object.is(previous.value, row.value)) return
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
  [...left].every(
    ([id, row]) => right.has(id) && Object.is(right.get(id)!.value, row.value),
  )

function publicationPhase(
  publication: PublicationModel,
  lifecycle: LifecycleModel,
): PublicationPhase {
  if (!publication.replacement) return `public`
  if (publication.replacement.failed) return `private-failed`
  const currentAttemptIds = new Set(
    lifecycle.owners.flatMap(({ aborted, attemptId }) =>
      aborted || attemptId === undefined ? [] : [attemptId],
    ),
  )
  return lifecycle.attempts.some(
    ({ id, outcome }) => currentAttemptIds.has(id) && outcome !== undefined,
  )
    ? `private-settling`
    : `private-pending`
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
    } else if (!Object.is(value.value, previousValue.value)) {
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

function finishReplacement(
  publication: PublicationModel,
  lifecycle: LifecycleModel,
): void {
  const replacement = publication.replacement
  if (!replacement) return
  const currentAttempts = lifecycle.owners.flatMap(({ aborted, attemptId }) =>
    aborted || attemptId === undefined ? [] : [lifecycle.attempts[attemptId]!],
  )
  replacement.failed = currentAttempts.some(
    ({ outcome }) => outcome === `reject`,
  )
  replacement.everFailed ||= replacement.failed
  if (lifecycle.publicationBarrierOpen) return
  if (replacement.failed) {
    replacement.failed = true
    if (currentAttempts.length === 0) {
      publication.replacement = undefined
    }
  } else if (
    // A canceled-only reset can establish an empty replacement once older
    // transports settle. Releasing every owner instead retires the work.
    lifecycle.owners.length > 0 &&
    currentAttempts.every(({ outcome }) => outcome === `resolve`)
  ) {
    publishIfChanged(publication, new Map(replacement.rows))
    publication.retainedKeys.clear()
    publication.replacement = undefined
  } else if (lifecycle.owners.length === 0 && !replacement.everFailed) {
    // Releasing the final owner retires a replay that has not failed. Nothing
    // can complete it, so it publishes the rows it holds rather than keep
    // values the source has replaced or deleted.
    publishIfChanged(publication, new Map(replacement.rows))
    publication.retainedKeys.clear()
    publication.replacement = undefined
  } else {
    // Retire private publication work, not the source's independently applied state.
    publication.replacement = undefined
    publication.retainedKeys = new Set(publication.visible.keys())
  }
}

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
    if (command.replacement) {
      publication.source.set(
        command.replacement.id,
        cloneRow(command.replacement),
      )
    }
    if (lifecycle.publicationBarrierOpen) {
      publication.replacement = {
        syncRunGeneration: lifecycle.syncRunGeneration,
        replayGeneration: lifecycle.replayGeneration,
        rows: new Map(publication.source),
        failed: false,
        everFailed: false,
      }
    } else {
      publication.replacement = undefined
      if (
        publication.retainedKeys.size === 0 &&
        (eagerRestart || lifecycle.owners.length === 0)
      ) {
        // Without held publications or replay demand this is a raw source
        // transaction: all old source rows are deleted, even if never shown.
        // A same-key replacement keeps its delete/insert pair in one callback.
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
      } else {
        // Held publications need a replacement diff, not raw source deletes.
        publishIfChanged(publication, new Map(publication.source))
      }
      publication.retainedKeys.clear()
    }
  } else if (
    command.type === `restart` &&
    lifecycle.publications > priorPublicationCount &&
    lifecycle.publicationBarrierOpen
  ) {
    publication.replacement = {
      syncRunGeneration: lifecycle.syncRunGeneration,
      replayGeneration: lifecycle.replayGeneration,
      rows: new Map(),
      failed: false,
      everFailed: false,
    }
  } else if (
    command.type === `source` &&
    lifecycle.active &&
    !lifecycle.unsubscribed
  ) {
    const previousValue = publication.source.get(command.key)
    if (command.action === `delete`) {
      publication.source.delete(command.key)
      publication.replacement?.rows.delete(command.key)
      if (!publication.replacement && previousValue) {
        const deletedValue = publication.retainedKeys.has(command.key)
          ? (publication.visible.get(command.key) ?? previousValue)
          : previousValue
        publication.visible.delete(command.key)
        publication.retainedKeys.delete(command.key)
        publication.sentKeys.delete(command.key)
        publication.batches.push([
          {
            type: `delete`,
            key: command.key,
            value: cloneRow(deletedValue),
          },
        ])
      }
    } else {
      const row = {
        id: command.key,
        value: command.value,
      }
      if (publication.replacement) {
        publication.source.set(command.key, row)
        publication.replacement.rows.set(command.key, row)
      } else {
        recordSourceWrite(publication, row)
      }
    }
  } else if (command.type === `cleanup`) {
    publication.retainedKeys = new Set(publication.visible.keys())
    publication.source.clear()
    publication.replacement = undefined
  } else if (command.type === `release` || command.type === `abort`) {
    // Release changes demand, not source retention. Releasing alone never
    // changes the subscriber's rows; a source write, a successful
    // replacement, or a later request does. An abort ends the owner's load
    // (maintainer decision): the replacement no longer waits for it.
    finishReplacement(publication, lifecycle)
  } else if (command.type === `settle` && effect.attemptId !== undefined) {
    const attempt = lifecycle.attempts[effect.attemptId]!
    const isCurrent = lifecycle.owners.some(
      ({ attemptId }) => attemptId === attempt.id,
    )
    if (command.outcome === `resolve` && isCurrent && !attempt.aborted) {
      const row = { id: attempt.demand, value: command.value ?? attempt.id }
      const replacement = publication.replacement
      if (
        replacement &&
        replacement.syncRunGeneration === attempt.syncRunGeneration &&
        replacement.replayGeneration === attempt.replayGeneration
      ) {
        publication.source.set(row.id, row)
        replacement.rows.set(row.id, row)
      } else {
        recordSourceWrite(publication, row)
      }
    }
    finishReplacement(publication, lifecycle)
  }

  // This fixture marks an eager restart ready with its complete (empty) source.
  // Unlike on-demand restart, that is authority to retire the retained snapshot.
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
    // A request delivers its installed row: an insert when the subscriber
    // does not show it, an update when it shows an older value, such as a
    // row a failed replay kept, and nothing when it shows the same value.
    // Either way the row is no longer retained.
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
              : {
                  type: `insert`,
                  key: row.id,
                  value: cloneRow(row),
                },
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

const sourceMutationArbitrary: fc.Arbitrary<SourceMutation> = fc.oneof(
  fc.record({
    type: fc.constant(`source` as const),
    key: fc.constantFrom(
      `a` as const,
      `b` as const,
      `c` as const,
      `d` as const,
    ),
    action: fc.constantFrom(`upsert` as const, `delete` as const),
    // -0 is a distinct row value from 0, so a write can change only a sign.
    value: fc.oneof(fc.integer({ min: 0, max: 5 }), fc.constant(-0)),
  }),
  // Writes 0 over a non-zero row, and flips the sign of a zero one.
  fc.record({
    type: fc.constant(`source` as const),
    key: fc.constantFrom(`a` as const, `b` as const),
    action: fc.constant(`upsert` as const),
    value: fc.constant(0),
    flip: fc.constant(true),
  }),
)

// Generated publication histories contain 1–20 lifecycle commands from the
// shared grammar plus 1–5 atomic source mutations inserted at any boundary,
// including before the first and after the last lifecycle command. Keys a/b
// can overlap demand; c/d distinguish independent source work. Upsert/delete
// and values 0–5 distinguish insert, update, delete, and unchanged writes.
// Removing insertion position loses public/private timing; removing either
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

/**
 * Cleanup retains subscriber rows, not source rows. A successful restarted
 * acquisition must publish the new source, including an equal retained row.
 * Equality suppresses a public delta; it cannot erase replacement membership.
 * This follows the opening publication law and the cleanup/restart grammar.
 *
 * Cross row equality with demand lifetime and delivery path. An ordinary source
 * write can restore an independent retained row while acquisitions hold the
 * replacement. Another retained row is deliberately omitted: keeping every old
 * row would violate replacement just as deleting an equal restored row does.
 * Current and obsolete resolve/reject outcomes distinguish authority from
 * transport settlement. A failed attempt is followed by an authoritative retry.
 * Every source operation is a complete transaction; malformed writes are excluded.
 * Removing equality loses the reported defect, removing source delivery admits
 * an acquisition-only patch, and removing omission admits a keep-all-rows patch.
 */
const restartOwnerStates = [
  `pending`,
  `settled`,
  `peer`,
  `aborted`,
  `released`,
  `none`,
] as const
const restartRowStates = [`absent`, `equal`, `changed`] as const
const restartDeliveries = [`acquisition`, `source`] as const
const restartOutcomes = [`resolve`, `reject`] as const
const restartPublicationInputArbitrary = fc.record({
  demand: fc.constantFrom(`a` as const, `b` as const),
  value: fc.integer({ min: -100_000, max: 100_000 }),
  obsoleteOutcome: fc.constantFrom(...restartOutcomes),
  priorAcquisitions: fc.integer({ min: 0, max: 3 }),
})
type RestartPublicationInput =
  typeof restartPublicationInputArbitrary extends fc.Arbitrary<infer Input>
    ? Input
    : never

// Only live acquisitions distinguish success from failure or restored equality.
// An inactive acquisition has no delivered row: its retained value is one regime.
const restartScenarios = restartDeliveries.flatMap((delivery) =>
  restartOwnerStates.flatMap((owner) => {
    const live = owner === `pending` || owner === `settled` || owner === `peer`
    const rows =
      delivery === `acquisition` && !live
        ? ([`absent`, `retained`] as const)
        : restartRowStates
    return rows.flatMap((row) =>
      (live ? restartOutcomes : ([`noop`] as const)).map((outcome) => ({
        delivery,
        owner,
        row,
        outcome,
        state: `${delivery}:${owner}:${row}:${outcome}`,
      })),
    )
  }),
)

function restartPublicationHistory(
  {
    demand,
    value,
    obsoleteOutcome,
    priorAcquisitions,
  }: RestartPublicationInput,
  scenario: (typeof restartScenarios)[number],
) {
  const { delivery, owner, row: rowState, outcome } = scenario
  const other = demand === `a` ? `b` : `a`
  const settle = (
    target: DemandName,
    scope: `current` | `obsolete`,
    result: `resolve` | `reject`,
  ): PublicationCommand => ({
    type: `settle`,
    demand: target,
    scope,
    age: `newest`,
    outcome: result,
    // Input data supplies row content. Neither model nor grammar predicts a
    // fixture's attempt counter to manufacture equality.
    value,
  })
  const history: Array<PublicationCommand> = []
  // Retired preliminary loads change attempt numbering without changing the
  // target row. Equality must survive that fixture perturbation.
  for (let index = 0; index < priorAcquisitions; index++)
    history.push(
      { type: `request`, demand: other },
      settle(other, `current`, `resolve`),
      { type: `release`, demand: other },
    )
  if (owner !== `none`) history.push({ type: `request`, demand })
  if (owner === `peer`) history.push({ type: `request`, demand: other })
  if (owner === `settled`) history.push(settle(demand, `current`, `resolve`))
  const target = delivery === `source` ? `c` : demand
  if (rowState !== `absent`)
    history.push({
      type: `source`,
      key: target,
      action: `upsert`,
      value: value + (rowState === `changed` ? 1 : 0),
    })
  else if (owner === `settled` && delivery === `acquisition`)
    history.push({ type: `source`, key: target, action: `delete`, value: 0 })
  history.push({ type: `source`, key: `d`, action: `upsert`, value })
  if (owner === `aborted`) history.push({ type: `abort`, demand })
  if (owner === `released`) history.push({ type: `release`, demand })
  const cleanupIndex = history.length
  history.push({ type: `cleanup` }, { type: `restart` })
  const restartIndex = history.length - 1
  history.push(settle(demand, `obsolete`, obsoleteOutcome))
  if (delivery === `source`)
    history.push({ type: `source`, key: target, action: `upsert`, value })
  const focalIndex = history.length - (delivery === `source` ? 1 : 0)
  history.push(
    settle(demand, `current`, outcome === `noop` ? `resolve` : outcome),
  )
  if (owner === `peer`) history.push(settle(other, `current`, `resolve`))
  if (outcome === `reject`) {
    history.push({ type: `truncate` }, settle(demand, `current`, `resolve`))
    if (owner === `peer`) history.push(settle(other, `current`, `resolve`))
  }
  history.push({ type: `release`, demand })
  if (owner === `peer`) history.push({ type: `release`, demand: other })
  return { history, target, cleanupIndex, restartIndex, focalIndex }
}

// Reach is conditional on facts recorded by the real driver, before comparison
// can hide a missing premise. A successful acquisition records its actual write;
// failure records its settled outcome. Retained equality compares that write
// with the callback-applied row before cleanup, never with an input label.
function observeRestartRow(
  prior: Row | undefined,
  written: Row | undefined,
): `absent` | `retained` | `equal` | `changed` {
  if (!prior) return `absent`
  if (!written) return `retained`
  return prior.value === written.value ? `equal` : `changed`
}

// Owner lifetime is observed from executed operations and adapter callbacks.
// This is a reach classifier, not the reference publication computation.
function observeRestartOwner(
  observations: ReadonlyArray<PublicationObservation>,
  history: ReadonlyArray<PublicationCommand>,
  demand: DemandName,
): (typeof restartOwnerStates)[number] {
  const executed = observations.flatMap((item) =>
    item.executed ? [history[item.index]!] : [],
  )
  if (
    !executed.some((item) => item.type === `request` && item.demand === demand)
  )
    return `none`
  if (
    executed.some((item) => item.type === `release` && item.demand === demand)
  )
    return `released`
  if (executed.some((item) => item.type === `abort` && item.demand === demand))
    return `aborted`
  if (observations.at(-1)!.currentAttempts === 2) return `peer`
  return executed.some(
    (item) =>
      item.type === `settle` &&
      item.demand === demand &&
      item.scope === `current`,
  )
    ? `settled`
    : `pending`
}

/**
 * A restarted direct subscription publishes the current replacement at applied
 * acquisition settlement (ARCHITECTURE, "Cleanup, restart, and detached waiters").
 * Subscription predicates restrict membership; order and limit select a local
 * snapshot, not the order of later callback batches. The same Map diff above
 * judges these receiving paths, including a snapshot of installed rows whose
 * source events were withheld. Source event deferral is an internal controlled
 * seam; this makes no claim about a provider's delivery policy.
 */
const restartReceiverPaths = [
  `direct`,
  `filtered`,
  `ordered`,
  `snapshot`,
] as const
async function runRestartReceiver(
  input: RestartPublicationInput,
  path: (typeof restartReceiverPaths)[number],
  relation: (typeof restartRowStates)[number],
): Promise<string> {
  const gate = createDeferred<void>()
  let operations: SyncOperations | undefined
  let restarting = false
  let loads = 0
  const source = createCollection<Row, RowKey>({
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (ops) => {
        operations = ops
        ops.markReady()
        return {
          loadSubset: () => {
            loads++
            return restarting ? gate.promise : true
          },
        }
      },
    },
  })
  const shown = new Map<RowKey, Row>()
  const batches: Array<Array<PublicationChange>> = []
  const subscription = source.subscribeChanges(
    (changes) => {
      const batch = changes.map((change): PublicationChange => ({
        type: change.type,
        key: change.key,
        value: cloneRow(change.value),
        ...(change.previousValue
          ? { previousValue: cloneRow(change.previousValue) }
          : {}),
      }))
      for (const change of batch) {
        if (change.type === `delete`) shown.delete(change.key)
        else shown.set(change.key, cloneRow(change.value))
      }
      batches.push(batch)
    },
    {
      includeInitialState: false,
      ...(path === `filtered`
        ? {
            whereExpression: new Func(`not`, [
              new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
            ]),
          }
        : {}),
    },
  )
  const selected = (rows: ReadonlyArray<Row>) =>
    new Map(
      rows
        .filter(({ id }) => path !== `filtered` || id !== `b`)
        .map((row) => [row.id, cloneRow(row)] as const),
    )
  const write = (rows: ReadonlyArray<Row>) => {
    if (!operations) throw new Error(`missing receiver sync run`)
    operations.begin()
    for (const row of rows)
      operations.write({ type: `insert`, value: cloneRow(row) })
    const receipt = operations.commit()
    oracleAssertion(`lifecycle publication comparison at 867`, () =>
      expect(receipt).toBe(true),
    )
  }
  const priorRows: Array<Row> = [
    ...(relation === `absent`
      ? []
      : [
          {
            id: `a` as const,
            value: input.value + (relation === `changed` ? 1 : 0),
          },
        ]),
    { id: `b`, value: input.value },
    { id: `d`, value: input.value },
  ]
  const nextRows: Array<Row> = [
    { id: `a`, value: input.value },
    { id: `b`, value: input.value + 2 },
  ]
  const failures: Array<unknown> = []
  let reached = ``
  try {
    write(priorRows)
    subscription.requestSnapshot()
    await flushPromises()
    oracleAssertion(`lifecycle publication comparison at 891`, () =>
      expect(shown).toEqual(selected(priorRows)),
    )
    const prior = new Map(shown)
    await source.cleanup()
    restarting = true
    source.startSyncImmediate()
    await flushPromises()
    oracleAssertion(`lifecycle publication comparison at 897`, () =>
      expect(loads).toBe(2),
    )
    oracleAssertion(`lifecycle publication comparison at 898`, () =>
      expect(subscription.status).toBe(`loadingSubset`),
    )
    const start = batches.length
    // A snapshot must be able to supply replacement membership independently
    // of source callbacks. The held events still publish before settlement.
    const held = path === `snapshot` ? source._deferPublication() : undefined
    write(nextRows)
    if (path === `snapshot` || path === `ordered`) {
      subscription.requestSnapshot(
        path === `ordered` ? { orderBy: valueOrderBy(), limit: 3 } : {},
      )
    }
    held?.publish()
    oracleAssertion(`lifecycle publication comparison at 910`, () =>
      expect([...source.values()].map(cloneRow)).toEqual(nextRows),
    )
    oracleAssertion(`lifecycle publication comparison at 911`, () =>
      expect(shown).toEqual(prior),
    )
    oracleAssertion(`lifecycle publication comparison at 912`, () =>
      expect(batches.slice(start)).toEqual([]),
    )
    const observedRelation = observeRestartRow(
      prior.get(`a`),
      cloneRow(source.get(`a`)!),
    )
    oracleAssertion(`lifecycle publication comparison at 917`, () =>
      expect(observedRelation).toBe(relation),
    )
    reached = `${path}:${observedRelation}`
    gate.resolve()
    await flushPromises()
    const next = selected(nextRows)
    oracleAssertion(`lifecycle publication comparison at 922`, () =>
      expect(normalizePublicationOrder(batches.slice(start))).toEqual(
        normalizePublicationOrder([publicationDiff(prior, next)]),
      ),
    )
    oracleAssertion(`lifecycle publication comparison at 925`, () =>
      expect(shown).toEqual(next),
    )
    oracleAssertion(`lifecycle publication comparison at 926`, () =>
      expect(subscription.status).toBe(`ready`),
    )
  } catch (error) {
    failures.push(error)
  } finally {
    gate.resolve()
    try {
      subscription.unsubscribe()
    } catch (error) {
      failures.push(error)
    }
    try {
      await source.cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1)
    throw new AggregateError(failures, `receiver and cleanup failed`, {
      cause: failures[0],
    })
  return reached
}

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

  const writeAttempt = async (
    attempt: RuntimeAttempt,
    rowValue = attempt.id,
  ): Promise<Row | undefined> => {
    // Cancellation fences request-scoped writes at the adapter boundary.
    // Transport may settle later; it must not publish canceled snapshot rows.
    if (attempt.signal?.aborted) return
    const rows = sourceRows.get(attempt.syncRunGeneration)
    const previous = rows?.get(attempt.demand)
    const value = { id: attempt.demand, value: rowValue }
    attempt.operations.begin()
    attempt.operations.write({
      type: previous ? `update` : `insert`,
      value,
      ...(previous ? { previousValue: previous } : {}),
    })
    const receipt = attempt.operations.commit()
    if (receipt !== true) await receipt
    rows?.set(attempt.demand, value)
    return cloneRow(value)
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
    oracleAssertion(`lifecycle publication comparison at 1157`, () =>
      check(normalizedObserved, context).toEqual(expected),
    )
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
    for (const [index, authored] of history.entries()) {
      const command = withFlippedZero(authored, publication)
      const priorPublicationCount = lifecycle.publications
      const phaseBefore = publicationPhase(publication, lifecycle)
      const pendingAttemptsBefore = [...attempts.values()].filter(
        ({ current, settled }) => current && !settled,
      ).length
      const observedPublicationCount = observedBatches.length
      const expectedPublicationCount = publication.batches.length
      const unloadCount = unloads.length
      const syncRunCount = operationsBySyncRun.size
      const visibleBefore = [...visible.values()].map(cloneRow)
      const writtenRows: Array<Row> = []
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
          writtenRows.push(cloneRow(value))
        }
        const receipt = operations?.commit()
        if (receipt !== true) await receipt
      } else if (command.type === `request`) {
        oracleAssertion(`lifecycle publication comparison at 1245`, () =>
          check(effect.ownerId).toBe(
            unsubscribed ? undefined : runtimeOwner?.id,
          ),
        )
        executed = runtimeOwner !== undefined && !unsubscribed
        subscription.requestSnapshot({
          where: where[command.demand],
          signal: runtimeOwner?.controller.signal,
        })
      } else if (command.type === `abort`) {
        oracleAssertion(`lifecycle publication comparison at 1252`, () =>
          check(effect.ownerId).toBe(runtimeOwner?.id),
        )
        executed = runtimeOwner !== undefined
        if (runtimeOwner) {
          runtimeOwner.aborted = true
          runtimeOwner.controller.abort()
        }
      } else if (command.type === `release`) {
        oracleAssertion(`lifecycle publication comparison at 1259`, () =>
          check(effect.ownerId).toBe(runtimeOwner?.id),
        )
        executed = runtimeOwner !== undefined
        if (runtimeOwner) {
          if (runtimeOwner.attemptId !== undefined) {
            attempts.get(runtimeOwner.attemptId)!.current = false
          }
          owners.splice(owners.indexOf(runtimeOwner), 1)
        }
        subscription.releaseSnapshot(where[command.demand])
      } else if (command.type === `settle`) {
        oracleAssertion(`lifecycle publication comparison at 1269`, () =>
          check(effect.attemptId).toBe(runtimeAttempt?.id),
        )
        executed = runtimeAttempt !== undefined
        if (runtimeAttempt) settlement = command.outcome
        if (effect.attemptId !== undefined && runtimeAttempt) {
          runtimeAttempt.settled = true
          const expected = lifecycle.attempts[
            effect.attemptId
          ] as LifecycleAttempt
          if (command.outcome === `resolve`) {
            const written = await writeAttempt(runtimeAttempt, command.value)
            if (written) writtenRows.push(written)
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
      // Public retention never rewrites the independently installed source.
      // The publication model stops tracking source commands after unsubscribe;
      // its callback-silence assertions below still cover that suffix.
      if (!lifecycle.unsubscribed)
        oracleAssertion(`lifecycle publication comparison at 1345`, () =>
          check(
            [...(active ? collection.values() : [])]
              .map(cloneRow)
              .sort((left, right) => left.id.localeCompare(right.id)),
            `source state after command ${index}: ${JSON.stringify(command)}`,
          ).toEqual(
            [...publication.source.values()].sort((left, right) =>
              left.id.localeCompare(right.id),
            ),
          ),
        )
      assertPublications(
        command,
        index,
        expectedPublicationCount,
        observedPublicationCount,
      )
      oracleAssertion(`lifecycle publication comparison at 1361`, () =>
        check(
          [...visible.values()].sort((left, right) =>
            left.id.localeCompare(right.id),
          ),
          `consumer state after command ${index}: ${JSON.stringify(command)}`,
        ).toEqual(
          [...publication.visible.values()].sort((left, right) =>
            left.id.localeCompare(right.id),
          ),
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
        visibleBefore,
        writtenRows,
        currentAttempts: [...attempts.values()].filter(
          ({ current, signal }) => current && !signal?.aborted,
        ).length,
      })
    }
    if (runOptions.terminal) {
      const terminal = runOptions.terminal
      const pending = [...attempts.values()].filter(({ settled }) => !settled)
      oracleAssertion(`lifecycle publication comparison at 1393`, () =>
        expect(pending).toHaveLength(terminal.expectedPending),
      )
      oracleAssertion(`lifecycle publication comparison at 1394`, () =>
        expect(pending.length).toBeGreaterThan(0),
      )
      if (terminal.order === `newest-first`) pending.reverse()
      subscription.unsubscribe()
      unsubscribed = true
      const retired = captureTerminal()
      oracleAssertion(`lifecycle publication comparison at 1399`, () =>
        expect(retired.subscriberCount).toBe(0),
      )
      for (const attempt of pending) {
        oracleAssertion(`lifecycle publication comparison at 1401`, () =>
          expect(outcomes.has(attempt.id)).toBe(false),
        )
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
          oracleAssertion(`lifecycle publication comparison at 1415`, () =>
            expect(outcome).toEqual({ state: `resolved` }),
          )
        else {
          oracleAssertion(`lifecycle publication comparison at 1417`, () =>
            expect(outcome?.state).toBe(`rejected`),
          )
          if (outcome?.state === `rejected`)
            oracleAssertion(`lifecycle publication comparison at 1418`, () =>
              expect(outcome.error).toBe(failure),
            )
        }
        assertTerminalPublication(captureTerminal(), retired)
      }
      oracleAssertion(`lifecycle publication comparison at 1422`, () =>
        expect(terminal.reached).toEqual(pending.map(({ id }) => id)),
      )
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
    oracleAssertion(`lifecycle publication comparison at 1657`, () =>
      expect(observations).toHaveLength(scenario.history.length),
    )
    oracleAssertion(`lifecycle publication comparison at 1658`, () =>
      expect(observations[scenario.focalSourceIndex]).toMatchObject({
        command: `source`,
        phaseBefore: scenario.phase,
        executed: true,
        sourceEffect: scenario.sourceEffect,
      }),
    )
    if (scenario.settlementIndex === undefined) {
      oracleAssertion(`lifecycle publication comparison at 1665`, () =>
        expect(
          observations[scenario.pendingProbeIndex]!.pendingAttemptsBefore,
          scenario.name,
        ).toBe(1),
      )
    } else {
      const settlementIndex = scenario.settlementIndex
      oracleAssertion(`lifecycle publication comparison at 1670`, () =>
        expect(observations[settlementIndex]).toMatchObject({
          command: `settle`,
          executed: true,
          settlement: scenario.settlement,
          publications:
            scenario.settlement === `resolve` &&
            scenario.phase !== `private-failed`
              ? 1
              : 0,
        }),
      )
    }

    const suffix = observations[scenario.suffixIndex]!
    oracleAssertion(`lifecycle publication comparison at 1683`, () =>
      expect(suffix).toMatchObject({
        command: scenario.suffix,
        executed: true,
      }),
    )
    if (scenario.suffix === `release`) {
      oracleAssertion(`lifecycle publication comparison at 1688`, () =>
        expect(suffix.unloads, scenario.name).toBe(1),
      )
    } else if (scenario.suffix === `cleanup`) {
      oracleAssertion(`lifecycle publication comparison at 1690`, () =>
        expect(suffix.collectionStatus, scenario.name).toBe(`cleaned-up`),
      )
    } else if (scenario.suffix === `restart`) {
      oracleAssertion(`lifecycle publication comparison at 1692`, () =>
        expect(suffix.syncRuns, scenario.name).toBe(1),
      )
    } else {
      const ownerCount =
        scenario.phase === `private-settling` ||
        scenario.phase === `private-failed`
          ? 2
          : 1
      oracleAssertion(`lifecycle publication comparison at 1699`, () =>
        expect(suffix.unloads, scenario.name).toBe(ownerCount),
      )
    }

    oracleAssertion(`lifecycle publication comparison at 1702`, () =>
      expect(observations[scenario.postUnsubscribeProbeIndex]).toMatchObject({
        command: `source`,
        executed: true,
        publications: 0,
      }),
    )
    reached.add(scenario.name)
  }

  oracleAssertion(`lifecycle publication comparison at 1710`, () =>
    expect(reached).toEqual(new Set(scenarios.map(({ name }) => name))),
  )
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
  oracleAssertion(`lifecycle publication comparison at 1726`, () =>
    expect(
      summary,
      `publication product mismatches: ${JSON.stringify(summary)}`,
    ).toEqual([]),
  )
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
          oracleAssertion(`lifecycle publication comparison at 1772`, () =>
            expect(batches).toEqual(expectedDeferralBatches(commands)),
          )
        } else if (command.handle === `outer` && subscription) {
          oracleAssertion(`lifecycle publication comparison at 1774`, () =>
            expect(batches).toEqual([]),
          )
        }
      } else if (command.type === `write`) {
        operations.begin()
        operations.write({
          type: `insert`,
          value: { id: command.key, value: command.key.charCodeAt(0) },
        })
        operations.commit()
        if (subscription)
          oracleAssertion(`lifecycle publication comparison at 1783`, () =>
            expect(batches).toEqual([]),
          )
      } else if (command.type === `cleanup`) {
        await collection.cleanup()
        oracleAssertion(`lifecycle publication comparison at 1786`, () =>
          expect(collection.status).toBe(`cleaned-up`),
        )
      } else if (command.type === `restart`) {
        collection.startSyncImmediate()
        oracleAssertion(`lifecycle publication comparison at 1789`, () =>
          expect(collection.get(`a`)).toBeUndefined(),
        )
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
    oracleAssertion(`lifecycle publication comparison at 1805`, () =>
      expect(syncRuns).toBe(2),
    )
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
// Each property below names, in `owns`, what the gap report judges: which
// rows a subscription publishes to subscribers, in subscription.ts and in the
// Collection state that holds the rows, across replay, restart, and cleanup.
describe(`CollectionSubscription lifecycle publication oracle`, () => {
  // A local snapshot selects source rows for this subscriber. Selection and
  // publication are distinct: replay can hold a selection privately, while
  // every subscription mode tracks keys delivered through public callbacks.
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
  async function runSelectionCase({
    includeInitialState,
    first,
    reenter,
  }: (typeof selectionCases)[number]): Promise<void> {
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
      oracleAssertion(`lifecycle publication comparison at 2015`, () =>
        expect(observedBatches.map((batch) => [...batch].sort())).toEqual(
          expectedBatches.map((batch) => [...batch].sort()),
        ),
      )
      oracleAssertion(`lifecycle publication comparison at 2018`, () =>
        expect(invalidChanges).toEqual([]),
      )
      oracleAssertion(`lifecycle publication comparison at 2019`, () =>
        expect([...visible].sort()).toEqual([...selected].sort()),
      )
      // Local selections do not certify a provider prefix. Without an
      // explicit offset, the adapter request begins at the source prefix
      // and carries no key-based cursor hint, including after a full read.
      oracleAssertion(`lifecycle publication comparison at 2023`, () =>
        expect(loads.at(-1)).toMatchObject({ offset: 0 }),
      )
      oracleAssertion(`lifecycle publication comparison at 2024`, () =>
        expect(loads.at(-1)?.cursor?.lastKey).toBeUndefined(),
      )
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  }
  oracleProperty({
    id: `subscription-lifecycle.publication-selection`,
    law: {
      statement: `Across a local snapshot and later ordered snapshots, a callback consumer receives each locally selected key once, the independent selection model predicts the selected keys and batches, and the adapter request starts at the source prefix without a key cursor.`,
      authority: `Collection.subscribeChanges and requestSnapshot / requestLimitedSnapshot, as the local-selection paragraph above states.`,
      limits: `The 14 enumerated first-snapshot, includeInitialState, and re-entry cases over three static distinct-ranked rows.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: selectionCases,
    label: ({ includeInitialState, first, reenter }) =>
      `selects each local key once across ${first} then ordered, includeInitialState=${includeInitialState}, reenter=${reenter}`,
    ...subscriptionComparison<(typeof selectionCases)[number]>(
      `subscription-lifecycle.publication-selection`,
      runSelectionCase,
    ),
    check: forwardAssertionJudgment,
  })
  oracleProperty({
    id: `subscription-lifecycle.publication-deferral-cleanup`,
    law: {
      statement: `After each bounded deferral cleanup history, independent source batches publish exactly as the deferral model predicts.`,
      authority: `The deferral cleanup law in the opening contract above and the shared lifecycle grammar's deferral histories.`,
      limits: `The 32 bounded deferral cleanup histories.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: deferralCleanupHistories,
    label: ({ name }) =>
      `publishes independent batches after deferral cleanup: ${name}`,
    ...subscriptionComparison<(typeof deferralCleanupHistories)[number]>(
      `subscription-lifecycle.publication-deferral-cleanup`,
      ({ commands }) => runDeferralCleanupHistory(commands),
    ),
    check: forwardAssertionJudgment,
  })
  const retiredTransportCases = (
    [`initial`, `replay`, `restart`] as const
  ).flatMap((phase) =>
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
  )
  async function runRetiredTransportCase({
    phase,
    demandCount,
    outcome,
    order,
  }: (typeof retiredTransportCases)[number]): Promise<void> {
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
    oracleAssertion(`lifecycle publication comparison at 2083`, () =>
      expect(new Set(reached).size).toBe(
        demandCount * (phase === `initial` ? 1 : 2),
      ),
    )
  }
  oracleProperty({
    id: `subscription-lifecycle.publication-retired-transports`,
    law: {
      statement: `Settling a retired transport, in either order and with either outcome, publishes nothing to the subscriber and reaches every pending attempt, as the publication model predicts.`,
      authority: `Collection.subscribeChanges and the terminal-publication law of the lifecycle/publication contract above.`,
      limits: `The 24 enumerated phase, demand-count, outcome, and settlement-order cases.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: retiredTransportCases,
    label: (row) =>
      `observes retired transports without subscriber activity: ${JSON.stringify(row)}`,
    ...subscriptionComparison<(typeof retiredTransportCases)[number]>(
      `subscription-lifecycle.publication-retired-transports`,
      runRetiredTransportCase,
    ),
    check: forwardAssertionJudgment,
  })
  const rawResetCases = (
    [`none`, `retained`, `refreshed`, `new`] as const
  ).flatMap((baseline) =>
    ([`delete`, `empty`, `same`, `other`] as const).map((reset) => ({
      baseline,
      reset,
    })),
  )
  async function runRawResetCase({
    baseline,
    reset,
  }: (typeof rawResetCases)[number]): Promise<void> {
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
  }
  oracleProperty({
    id: `subscription-lifecycle.publication-raw-reset`,
    law: {
      statement: `Each command publishes the exact coherent callback batches and public rows predicted by the independent publication model.`,
      authority: `Collection.subscribeChanges, public Collection lifecycle, and the shared lifecycle grammar as stated above.`,
      limits: `The 16 enumerated baseline and reset cases after a cleanup and restart.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: rawResetCases,
    label: ({ baseline, reset }) =>
      `distinguishes raw source resets from retained replacements: ${baseline}/${reset}`,
    ...subscriptionComparison<(typeof rawResetCases)[number]>(
      `subscription-lifecycle.publication-raw-reset`,
      runRawResetCase,
    ),
    check: forwardAssertionJudgment,
  })
  // The finite row-publication product, run in its four control slices and
  // its three replacement families. Each history replays its scenarios through
  // runPublicationProduct and the shared publication comparison.
  const publicationProductHistories = [
    ...publicationControlSlices.map(({ name, scenarios }) => ({
      name: `matches row publications for lifecycle control cells ${name}`,
      scenarios,
    })),
    {
      name: `preserves independent source work when a successful replay publishes`,
      scenarios: successfulReplacementCases,
    },
    {
      name: `publishes complete replacement batches regardless of independent key order`,
      scenarios: replacementOrderingCases,
    },
    {
      name: `retires incomplete or failed replacement without changing independent public rows`,
      scenarios: replacementRetirementCases,
    },
  ] satisfies Array<{
    name: string
    scenarios: ReadonlyArray<PublicationProductCase>
  }>
  oracleProperty({
    id: `subscription-lifecycle.publication-product`,
    law: {
      statement: `Each command publishes the exact coherent callback batches and public rows predicted by the independent publication model.`,
      authority: `Collection.subscribeChanges, public Collection lifecycle, and the shared lifecycle grammar as stated above.`,
      limits: `The 288-cell publication phase, source effect, settlement, suffix, and prior-row product, in four control slices and three replacement families.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: publicationProductHistories,
    label: ({ name }) => name,
    ...subscriptionComparison<(typeof publicationProductHistories)[number]>(
      `subscription-lifecycle.publication-product`,
      async ({ scenarios }) => {
        expectNoPublicationMismatches(await runPublicationProduct(scenarios))
      },
    ),
    check: forwardAssertionJudgment,
  })
  // Releasing the final owner retires a replay that has not failed; it
  // publishes the rows it holds, so none of these rows stays stale.
  const staleRowHistories = [
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
      `a row retained by a failed replay and deleted before the next one`,
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
      `an undemanded row retained by a failed replay and deleted before the next one`,
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
  ] as Array<[string, Array<PublicationCommand>]>
  const emptyResetCases = [false, true].flatMap((restart) =>
    [false, true].map((canceledOwner) => ({ restart, canceledOwner })),
  )
  async function runEmptyResetCase({
    restart,
    canceledOwner,
  }: (typeof emptyResetCases)[number]): Promise<void> {
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
  }
  oracleProperty({
    id: `subscription-lifecycle.publication-empty-reset`,
    law: {
      statement: `Each command publishes the exact coherent callback batches and public rows predicted by the independent publication model.`,
      authority: `Collection.subscribeChanges, public Collection lifecycle, and the shared lifecycle grammar as stated above.`,
      limits: `The 4 enumerated restart and canceled-owner cases around a repeated authoritative empty truncate.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: emptyResetCases,
    label: (row) =>
      `publishes an authoritative empty reset: ${JSON.stringify(row)}`,
    ...subscriptionComparison<(typeof emptyResetCases)[number]>(
      `subscription-lifecycle.publication-empty-reset`,
      runEmptyResetCase,
    ),
    check: forwardAssertionJudgment,
  })
  const retainedReplacementCases = [false, true].flatMap((canceledOwner) =>
    (
      [
        { id: `a`, value: 0 },
        { id: `a`, value: 1 },
        { id: `c`, value: 2 },
      ] satisfies Array<Row>
    ).map((replacement) => ({ canceledOwner, replacement })),
  )
  async function runRetainedReplacementCase({
    canceledOwner,
    replacement,
  }: (typeof retainedReplacementCases)[number]): Promise<void> {
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
  }
  oracleProperty({
    id: `subscription-lifecycle.publication-retained-replacement`,
    law: {
      statement: `Each command publishes the exact coherent callback batches and public rows predicted by the independent publication model.`,
      authority: `Collection.subscribeChanges, public Collection lifecycle, and the shared lifecycle grammar as stated above.`,
      limits: `The 6 enumerated canceled-owner and replacement-row cases after a cleanup and restart.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: retainedReplacementCases,
    label: (row) =>
      `installs a retained-row replacement atomically: ${JSON.stringify(row)}`,
    ...subscriptionComparison<(typeof retainedReplacementCases)[number]>(
      `subscription-lifecycle.publication-retained-replacement`,
      runRetainedReplacementCase,
    ),
    check: forwardAssertionJudgment,
  })
  const eagerRestartReplacements = [
    undefined,
    { id: `a`, value: 0 },
    { id: `a`, value: 1 },
    { id: `c`, value: 2 },
  ] satisfies Array<Row | undefined>
  async function runEagerRestartCase(
    replacement: (typeof eagerRestartReplacements)[number],
  ): Promise<void> {
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
  }
  oracleProperty({
    id: `subscription-lifecycle.publication-eager-restart`,
    law: {
      statement: `Each command publishes the exact coherent callback batches and public rows predicted by the independent publication model.`,
      authority: `Collection.subscribeChanges, public Collection lifecycle, and the shared lifecycle grammar as stated above.`,
      limits: `The 4 enumerated truncate replacements of an eager restart without a loader.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: eagerRestartReplacements,
    label: (replacement) =>
      `publishes eager restart before a later source reset: ${JSON.stringify(replacement)}`,
    ...subscriptionComparison<(typeof eagerRestartReplacements)[number]>(
      `subscription-lifecycle.publication-eager-restart`,
      runEagerRestartCase,
    ),
    check: forwardAssertionJudgment,
  })
  // Named regressions and the canonical green and stale-row histories. The
  // publication command grammar draws its histories through `chain`, so it
  // cannot take these back as fixed histories; each one replays through the
  // same driver and comparison as the generated publication-history campaign.
  const publicationFixedHistories: Array<{
    name: string
    commands: ReadonlyArray<PublicationCommand>
    options?: { continueAfterMismatch: boolean }
  }> = [
    {
      name: `keeps raw source updates after retiring the final replay owner`,
      commands: [
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
      ],
    },
    {
      name: `keeps raw truncate deletes after retiring the final replay owner`,
      commands: [
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
      ],
    },
    {
      name: `records requested snapshot rows before a canceled reset`,
      commands: [
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
      ],
    },
    {
      name: `does not invent a publication for an unchanged private row`,
      commands: [
        { type: `request`, demand: `a` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `source`, key: `a`, action: `upsert`, value: 5 },
        { type: `release`, demand: `a` },
        { type: `source`, key: `a`, action: `upsert`, value: 5 },
        { type: `unsubscribe` },
      ],
    },
    {
      name: `reconciles a repeated reset after the last replay owner aborts`,
      commands: [
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
      ],
    },
    {
      name: `keeps independent source rows when a replay settles after redundant restart calls`,
      commands: [
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
      ],
    },
    {
      name: `suppresses canceled source writes when a released acquisition settles`,
      commands: [
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
      options: { continueAfterMismatch: true },
    },
    {
      name: `publishes an authoritative truncate after the final demand is released`,
      commands: [
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
      ],
    },
    {
      name: `publishes independent source changes with a successful replay`,
      commands: [
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
      options: { continueAfterMismatch: true },
    },
    {
      name: `does not republish a row already delivered by a live change`,
      commands: [
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
      options: { continueAfterMismatch: true },
    },
    {
      name: `suppresses canceled source writes when an aborted acquisition settles`,
      commands: [
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
      options: { continueAfterMismatch: true },
    },
    {
      name: `keeps later source changes private after a failed replay`,
      commands: [
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
      ],
    },
    // Law 9: a failed replay stays private until an authoritative replay
    // succeeds, even after its failed owner is released and nothing remains.
    {
      name: `keeps a failed replay private when its final owner releases`,
      commands: [
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
      ],
    },
    {
      name: `retires failed private replacement rows when its final owner releases`,
      commands: [
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
      options: { continueAfterMismatch: true },
    },
    // The history above with zeros: the failed replay retains b as -0, and the
    // later source write of 0 must reconcile as an update, since -0 and 0 are
    // distinct row values (maintainer decision, 2026-10-29).
    {
      name: `reconciles a retained -0 row with a later source write of 0`,
      commands: [
        { type: `source`, key: `b`, action: `upsert`, value: -0 },
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
        { type: `source`, key: `b`, action: `upsert`, value: 0 },
        { type: `cleanup` },
        { type: `restart` },
        { type: `unsubscribe` },
      ],
      options: { continueAfterMismatch: true },
    },
    {
      name: `does not delete an independent public row when releasing a restarted demand`,
      commands: [
        { type: `source`, key: `b`, action: `upsert`, value: 0 },
        { type: `request`, demand: `a` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `release`, demand: `a` },
        { type: `unsubscribe` },
        { type: `source`, key: `b`, action: `upsert`, value: 1 },
      ],
      options: { continueAfterMismatch: true },
    },
    // Seed 2018803696, path 65:10:2:10:13:12:12:0:0:0. A canceled-only
    // truncate does not discharge the earlier replay's publication wait.
    {
      name: `keeps a restarted snapshot private while canceled replay work settles`,
      commands: [
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
      options: { continueAfterMismatch: true },
    },
    // Seed 2018803696, path 65:29:0:0:0 exposed the model's missing retained-row
    // deletion: an authoritative empty reset is not limited to resident rows.
    {
      name: `matches retained rows across an empty restart and canceled-only truncates`,
      commands: [
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
      options: { continueAfterMismatch: true },
    },
    // Seed 1657005, path 164:18 after removing the visible-row request omission.
    {
      name: `resets retained rows after no-op cleanup and release commands`,
      commands: [
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
      ],
    },
    // Seed 333468655, path 59:13:0:0:0.
    {
      name: `resets retained rows after the last replay owner retires`,
      commands: [
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
      ],
    },
    // Seed 1337491191, path 591:20:1:8:8:8:7:7.
    {
      name: `does not restore source rows when the final replay owner retires`,
      commands: [
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
      ],
    },
    // Original generated failure: seed -1439698414, path 1:22.
    {
      name: `keeps an equal row restored by the restarted acquisition`,
      commands: [
        { type: `source`, key: `b`, action: `upsert`, value: 1 },
        { type: `request`, demand: `b` },
        { type: `cleanup` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `restart` },
        {
          type: `settle`,
          demand: `b`,
          scope: `current`,
          age: `newest`,
          outcome: `resolve`,
        },
        { type: `abort`, demand: `a` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `reject`,
        },
        { type: `release`, demand: `b` },
      ],
    },
    ...greenLifecycleHistories.map((commands, index) => ({
      name: `maps every canonical green lifecycle history to public rows: ${index}`,
      commands,
    })),
    ...staleRowHistories.map(([name, commands]) => ({
      name: `leaves no stale row after a retired replay: ${name}`,
      commands,
    })),
  ]
  oracleProperty({
    id: `subscription-lifecycle.publication-fixed`,
    law: {
      statement: `Each command publishes the exact coherent callback batches and public rows predicted by the independent publication model.`,
      authority: `Collection.subscribeChanges, public Collection lifecycle, and the shared lifecycle grammar as stated above.`,
      limits: `Named regressions and canonical histories that the generated publication command grammar cannot take back; each is replayed through the same driver and comparison.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: publicationFixedHistories,
    label: ({ name }) => name,
    ...subscriptionComparison<(typeof publicationFixedHistories)[number]>(
      `subscription-lifecycle.publication-fixed`,
      async ({ commands, options }) => {
        await runPublicationHistory(commands, options)
      },
    ),
    check: forwardAssertionJudgment,
  })

  const { multiplier } = readOracleRunConfig()
  const restartProperty = `subscription-lifecycle.restart-publication`
  const restartStates = [
    ...restartScenarios.map(({ state }) => state),
    ...restartReceiverPaths.flatMap((path) =>
      restartRowStates.map((row) => `${path}:${row}`),
    ),
  ]
  const restartCounts = new Map(restartStates.map((state) => [state, 0]))
  let countingRestartCampaign = false
  beforeEach(({ task }) => {
    countingRestartCampaign =
      task.suite?.name === restartProperty &&
      isGeneratedOracleCampaign(task.name)
    if (countingRestartCampaign)
      for (const state of restartStates) restartCounts.set(state, 0)
  })
  afterEach(({ task }) => {
    if (
      !countingRestartCampaign ||
      task.result?.errors?.length ||
      oracleReplayRequested()
    )
      return
    // Every original delivery and receiver cell still needs twelve histories
    // per campaign. Only their registration is shared.
    oracleAssertion(`lifecycle publication comparison at 2924`, () =>
      expect(
        [...restartCounts].filter(([, count]) => count < 12 * multiplier),
      ).toEqual([]),
    )
    process.stdout.write(
      `${restartProperty} ${task.name} census ${JSON.stringify(Object.fromEntries(restartCounts))}\n`,
    )
  })
  const checkRestartPublication = async (
    input: RestartPublicationInput,
  ): Promise<void> => {
    for (const delivery of restartDeliveries) {
      for (const scenario of restartScenarios.filter(
        (item) => item.delivery === delivery,
      )) {
        const { history, target, cleanupIndex, restartIndex, focalIndex } =
          restartPublicationHistory(input, scenario)
        const observations = await runPublicationHistory(history)
        oracleAssertion(`lifecycle publication comparison at 2938`, () =>
          expect(observations[restartIndex]?.executed).toBe(true),
        )
        oracleAssertion(`lifecycle publication comparison at 2939`, () =>
          expect(observations[restartIndex]?.syncRuns).toBe(1),
        )
        const focal = observations[focalIndex]!
        const prior = observations[cleanupIndex]!.visibleBefore.find(
          ({ id }) => id === target,
        )
        const written = focal.writtenRows.find(({ id }) => id === target)
        const current = observations.find((item) => {
          const command = history[item.index]
          return (
            item.index > restartIndex &&
            command?.type === `settle` &&
            command.scope === `current`
          )
        })!
        const actualOwner = observeRestartOwner(
          observations.slice(0, cleanupIndex),
          history,
          input.demand,
        )
        oracleAssertion(`lifecycle publication comparison at 2958`, () =>
          expect(actualOwner).toBe(scenario.owner),
        )
        const actualOutcome = current.settlement ?? `noop`
        // Failed acquisitions write nothing. Observe the row relation on
        // their authoritative retry, after proving the actual rejection.
        const delivered =
          written ??
          (actualOutcome === `reject`
            ? observations
                .slice(focalIndex + 1)
                .flatMap((item) => item.writtenRows)
                .find(({ id }) => id === target)
            : undefined)
        const actualRow = observeRestartRow(prior, delivered)
        oracleAssertion(`lifecycle publication comparison at 2971`, () =>
          expect(actualOutcome).toBe(scenario.outcome),
        )
        oracleAssertion(`lifecycle publication comparison at 2972`, () =>
          expect(actualRow).toBe(scenario.row),
        )
        const live =
          scenario.owner === `pending` ||
          scenario.owner === `settled` ||
          scenario.owner === `peer`
        oracleAssertion(`lifecycle publication comparison at 2977`, () =>
          expect(observations[restartIndex]!.currentAttempts).toBe(
            live ? (scenario.owner === `peer` ? 2 : 1) : 0,
          ),
        )
        if (countingRestartCampaign) {
          const state = `${delivery}:${actualOwner}:${actualRow}:${actualOutcome}`
          restartCounts.set(state, restartCounts.get(state)! + 1)
        }
      }
    }
    for (const path of restartReceiverPaths) {
      for (const row of restartRowStates) {
        const state = await runRestartReceiver(input, path, row)
        if (countingRestartCampaign)
          restartCounts.set(state, restartCounts.get(state)! + 1)
      }
    }
  }
  oracleProperty({
    id: `subscription-lifecycle.restart-publication`,
    law: {
      statement: `Restarted row publication follows prior row equality, logical owner state, and authoritative acquisition outcome at every existing receiving path.`,
      authority: `The lifecycle/publication contract above and the existing independent restart observation relation.`,
      limits: `The unchanged finite owner/row/outcome product, acquisition and source delivery, and the three controlled receiving paths.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: {
      arbitrary: restartPublicationInputArbitrary,
      runs: 12,
      fixedSeeds: [2310],
    },
    ...subscriptionComparison(restartProperty, checkRestartPublication),
    check: forwardAssertionJudgment,
    // Two delivery campaigns and four receiver campaigns previously each
    // had a 120-second deadline; preserve their total allowance when grouped.
    timeout: 720_000,
  })
  const runs = 60 * multiplier
  // Preserve the original fixed campaign's zero-sign minimum and sample order.
  it(`reaches a zero-sign source write in the fixed campaign`, async () => {
    oracleRoute(`fixed seed`)
    let reached = 0
    for (const history of fc.sample(
      publicationCommandHistoryArbitrary,
      oracleFixedSeed(1_657_005, { numRuns: runs }),
    )) {
      const before = zeroSignWrites
      await runPublicationHistory(history)
      if (zeroSignWrites > before) reached++
    }
    if (!oracleReplayRequested()) {
      oracleAssertion(`lifecycle publication comparison at 3018`, () =>
        expect(reached).toBeGreaterThanOrEqual(5),
      )
      process.stdout.write(
        `lifecycle-publication.zero-sign census ${reached} (minimum 5)\n`,
      )
    }
  }, 120_000)
  oracleProperty({
    id: `subscription-lifecycle.publication-history`,
    law: {
      statement: `Each command publishes the exact coherent callback batches and public rows predicted by the independent publication model.`,
      authority: `Collection.subscribeChanges, public Collection lifecycle, and the shared lifecycle grammar as stated above.`,
      limits: `The unchanged controlled source-write/lifecycle command grammar; live-query includes and real-provider behavior remain outside this owner.`,
    },
    owns: [`src/collection/subscription.ts`, `src/collection/state.ts`],
    histories: {
      arbitrary: publicationCommandHistoryArbitrary,
      runs: 60,
      fixedSeeds: [1_657_005],
    },
    ...subscriptionComparison<Array<PublicationCommand>>(
      `subscription-lifecycle.publication-history`,
      async (history) => {
        await runPublicationHistory(history)
      },
    ),
    check: forwardAssertionJudgment,
    timeout: 120_000,
  })
})
