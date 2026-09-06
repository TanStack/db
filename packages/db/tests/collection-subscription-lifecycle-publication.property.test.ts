import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import {
  createLifecycleModel,
  greenLifecycleHistories,
  greenLifecycleHistoryArbitrary,
  reduceLifecycle,
} from './collection-subscription-lifecycle-grammar.js'
import { oracleRandomParameters, readOracleRunConfig } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { SyncConfig } from '../src/types.js'
import type {
  DemandName,
  LifecycleAttempt,
  LifecycleCommand,
  LifecycleEffect,
  LifecycleModel,
} from './collection-subscription-lifecycle-grammar.js'

type RowKey = DemandName | `c` | `d`
type Row = { id: RowKey; value: number }
type PublicationChange = {
  type: `insert` | `update` | `delete`
  key: RowKey
  value: Row
  previousValue?: Row
}
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
type SyncOperations = Parameters<SyncConfig<Row, RowKey>[`sync`]>[0]
type RuntimeAttempt = {
  id: number
  ownerId: number
  demand: DemandName
  session: number
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
  session: number
  replay: number
  rows: Map<RowKey, Row>
  failed: boolean
}
type PublicationModel = {
  source: Map<RowKey, Row>
  visible: Map<RowKey, Row>
  replacement?: Replacement
  batches: Array<Array<PublicationChange>>
  sentKeys: Set<RowKey>
}
type PublicationPhase =
  | `public`
  | `private-pending`
  | `private-settling`
  | `private-failed`
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
  sessions: number
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
}

function recordSourceWrite(publication: PublicationModel, row: Row): void {
  const previousVisible = publication.visible.get(row.id)
  publication.source.set(row.id, cloneRow(row))
  publication.visible.set(row.id, cloneRow(row))
  publication.sentKeys.add(row.id)
  if (previousVisible?.value === row.value) return
  publication.batches.push([
    previousVisible
      ? {
          type: `update`,
          key: row.id,
          value: cloneRow(row),
          previousValue: cloneRow(previousVisible),
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

function cloneRow(row: Row): Row {
  return { id: row.id, value: row.value }
}

function clonePublicationBatches(
  batches: ReadonlyArray<ReadonlyArray<PublicationChange>>,
): Array<Array<PublicationChange>> {
  return batches.map((batch) =>
    batch.map((change) => ({
      ...change,
      value: cloneRow(change.value),
      ...(change.previousValue
        ? { previousValue: cloneRow(change.previousValue) }
        : {}),
    })),
  )
}

function normalizePublicationOrder(
  batches: ReadonlyArray<ReadonlyArray<PublicationChange>>,
): Array<Array<PublicationChange>> {
  // Distinct keys have no canonical delivery order within one callback.
  // Keep callback boundaries and stable order among changes to the same key.
  return clonePublicationBatches(batches).map((batch) =>
    batch.sort((left, right) => left.key.localeCompare(right.key)),
  )
}

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
    ({ id, settled }) => currentAttemptIds.has(id) && settled,
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
    publication.replacement = undefined
  } else {
    // Retire private publication work, not the source's independently applied state.
    publication.replacement = undefined
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
    publication.source.clear()
    if (command.replacement) {
      publication.source.set(
        command.replacement.id,
        cloneRow(command.replacement),
      )
    }
    if (lifecycle.publicationBarrierOpen) {
      publication.replacement = {
        session: lifecycle.session,
        replay: lifecycle.replay,
        rows: new Map(publication.source),
        failed: false,
      }
    } else {
      publication.replacement = undefined
      // An authoritative reset also removes rows retained across cleanup.
      publishIfChanged(publication, new Map(publication.source))
    }
  } else if (
    command.type === `restart` &&
    lifecycle.publications > priorPublicationCount &&
    lifecycle.publicationBarrierOpen
  ) {
    publication.replacement = {
      session: lifecycle.session,
      replay: lifecycle.replay,
      rows: new Map(),
      failed: false,
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
        publication.visible.delete(command.key)
        publication.sentKeys.delete(command.key)
        publication.batches.push([
          {
            type: `delete`,
            key: command.key,
            value: cloneRow(previousValue),
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
    publication.source.clear()
    publication.replacement = undefined
  } else if (command.type === `release`) {
    if (
      effect.ownerId !== undefined &&
      publication.replacement &&
      !lifecycle.owners.some(({ demand }) => demand === command.demand)
    ) {
      const next = new Map(publication.visible)
      next.delete(command.demand)
      publication.replacement.rows.delete(command.demand)
      publishIfChanged(publication, next)
    }
    finishReplacement(publication, lifecycle)
  } else if (command.type === `settle` && effect.attemptId !== undefined) {
    const attempt = lifecycle.attempts[effect.attemptId]!
    const isCurrent = lifecycle.owners.some(
      ({ attemptId }) => attemptId === attempt.id,
    )
    if (command.outcome === `resolve` && isCurrent && !attempt.aborted) {
      const row = { id: attempt.demand, value: attempt.id }
      const replacement = publication.replacement
      if (
        replacement &&
        replacement.session === attempt.session &&
        replacement.replay === attempt.replay
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
    priorPublicationCount++
  }

  for (
    let index = priorPublicationCount;
    index < lifecycle.publications;
    index++
  ) {
    const row =
      command.type === `request` &&
      lifecycle.active &&
      lifecycle.owners.filter(({ demand }) => demand === command.demand)
        .length === 1 &&
      !publication.sentKeys.has(command.demand)
        ? publication.source.get(command.demand)
        : undefined
    publication.batches.push(
      row
        ? [
            {
              type: `insert`,
              key: row.id,
              value: cloneRow(row),
            },
          ]
        : [],
    )
    if (row) publication.sentKeys.add(row.id)
  }
}

const sourceMutationArbitrary: fc.Arbitrary<SourceMutation> = fc.record({
  type: fc.constant(`source` as const),
  key: fc.constantFrom(`a` as const, `b` as const, `c` as const, `d` as const),
  action: fc.constantFrom(`upsert` as const, `delete` as const),
  value: fc.integer({ min: 0, max: 5 }),
})

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
  options: PublicationRunOptions = {},
): Promise<Array<PublicationObservation>> {
  const check = options.continueAfterMismatch ? expect.soft : expect
  const observations: Array<PublicationObservation> = []
  const lifecycle = createLifecycleModel()
  const publication: PublicationModel = {
    source: new Map(),
    visible: new Map(),
    batches: [],
    sentKeys: new Set(),
  }
  const where = {
    a: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
    b: new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
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
  const operationsBySession = new Map<number, SyncOperations>()
  let nextAttemptId = 0
  let nextOwnerId = 0
  let session = -1
  let active = true
  let unsubscribed = false

  const collection = createCollection<Row, RowKey>({
    id: `generated-lifecycle-publication`,
    getKey: ({ id }) => id,
    syncMode: options.withoutLoader ? `eager` : `on-demand`,
    sync: {
      sync: (operations) => {
        const ownSession = ++session
        operationsBySession.set(ownSession, operations)
        sourceRows.set(ownSession, new Map())
        operations.markReady()
        if (options.withoutLoader) return
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
            attempts.set(id, {
              id,
              ownerId: owner.id,
              demand,
              session: ownSession,
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
  const subscription = collection.subscribeChanges(
    (changes) => {
      const batch = changes.map(
        (change): PublicationChange => ({
          type: change.type,
          key: change.key,
          value: cloneRow(change.value),
          ...(change.previousValue === undefined
            ? {}
            : { previousValue: cloneRow(change.previousValue) }),
        }),
      )
      for (const change of batch) {
        const id = String(change.key)
        if (id !== `a` && id !== `b` && id !== `c` && id !== `d`) {
          throw new Error(`publication used an unknown row key`)
        }
        if (change.type === `delete`) visible.delete(id)
        else visible.set(id, { id, value: change.value.value })
      }
      observedBatches.push(batch)
    },
    { includeInitialState: false },
  )

  const writeAttempt = async (attempt: RuntimeAttempt): Promise<void> => {
    // Cancellation fences request-scoped writes at the adapter boundary.
    // Transport may settle later; it must not publish canceled snapshot rows.
    if (attempt.signal?.aborted) return
    const rows = sourceRows.get(attempt.session)
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
      options.mismatches &&
      JSON.stringify(normalizedObserved) !== JSON.stringify(expected)
    ) {
      const historyName = options.historyName ?? JSON.stringify(history)
      options.mismatches.push({
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

  try {
    for (const [index, command] of history.entries()) {
      const priorPublicationCount = lifecycle.publications
      const phaseBefore = publicationPhase(publication, lifecycle)
      const pendingAttemptsBefore = [...attempts.values()].filter(
        ({ current, settled }) => current && !settled,
      ).length
      const observedPublicationCount = observedBatches.length
      const expectedPublicationCount = publication.batches.length
      const unloadCount = unloads.length
      const sessionCount = operationsBySession.size
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
        const operations = operationsBySession.get(session)
        const rows = sourceRows.get(session)
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
        const operations = operationsBySession.get(session)
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
        sourceRows.get(session)?.clear()
        if (command.replacement) {
          sourceRows
            .get(session)
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
        options.withoutLoader ?? false,
      )
      // Public retention never rewrites the independently installed source.
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
        sessions: operationsBySession.size - sessionCount,
        collectionStatus: collection.status,
      })
    }
  } finally {
    for (const attempt of attempts.values()) attempt.deferred.resolve()
    await flushPromises()
    subscription.unsubscribe()
    await collection.cleanup()
  }
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
  const hasPeer = phase === `private-settling` || phase === `private-failed`

  if (priorIndependentRow === `present`) {
    push({ type: `source`, key: `d`, action: `upsert`, value: 30 })
  }
  push({ type: `request`, demand: `a` })
  if (hasPeer) push({ type: `request`, demand: `b` })
  if (phase !== `public`) {
    push(settleCurrent(`a`, `resolve`))
    if (hasPeer) push(settleCurrent(`b`, `resolve`))
    push({ type: `truncate` })
    if (phase === `private-settling`) {
      push(settleCurrent(`b`, `resolve`))
    } else if (phase === `private-failed`) {
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
  `private-pending`,
  `private-settling`,
  `private-failed`,
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
    (phase === `private-pending` || phase === `private-settling`) &&
    sourceEffect !== `delete` &&
    settlement === `resolve`,
)
const replacementOrderingCases = publicationProductCases.filter(
  ({ phase, sourceEffect, settlement, suffix, priorIndependentRow }) =>
    (phase === `private-pending` || phase === `private-settling`) &&
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
        publications:
          scenario.settlement === `resolve` &&
          scenario.phase !== `private-failed`
            ? 1
            : 0,
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
      expect(suffix.sessions, scenario.name).toBe(1)
    } else {
      const ownerCount =
        scenario.phase === `private-settling` ||
        scenario.phase === `private-failed`
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

describe(`CollectionSubscription lifecycle publication oracle`, () => {
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

  it.each([
    `none`,
    `missing`,
    `duplicate`,
    `value`,
    `previous-value`,
    `split`,
    `merge`,
    `same-key-order`,
  ] as const)(
    `normalizes only independent change order with corruption: %s`,
    (corruption) => {
      const baseline: Array<Array<PublicationChange>> = [
        [
          {
            type: `update`,
            key: `a`,
            value: { id: `a`, value: 1 },
            previousValue: { id: `a`, value: 0 },
          },
          { type: `delete`, key: `b`, value: { id: `b`, value: 0 } },
          { type: `insert`, key: `c`, value: { id: `c`, value: 1 } },
        ],
        [
          {
            type: `update`,
            key: `a`,
            value: { id: `a`, value: 2 },
            previousValue: { id: `a`, value: 1 },
          },
          { type: `delete`, key: `a`, value: { id: `a`, value: 2 } },
        ],
      ]
      const permutations = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ]
      for (const permutation of permutations) {
        const candidate = clonePublicationBatches(baseline)
        const changes = candidate[0]!
        if (corruption === `value`) changes[0]!.value.value++
        if (corruption === `previous-value`) changes[0]!.previousValue!.value++
        candidate[0] = permutation.map((index) => changes[index]!)
        if (corruption === `missing`) candidate[0].pop()
        if (corruption === `duplicate`) candidate[0].push(changes[0]!)
        if (corruption === `split`)
          candidate.splice(1, 0, candidate[0].splice(1))
        if (corruption === `merge`) candidate.splice(0, 2, candidate.flat())
        if (corruption === `same-key-order`) candidate[1]!.reverse()
        const actual = normalizePublicationOrder(candidate)
        const expected = normalizePublicationOrder(baseline)
        if (corruption === `none`) expect(actual).toEqual(expected)
        else expect(actual).not.toEqual(expected)
      }
    },
  )

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

  it(`matches row publications for lifecycle control cells`, async () => {
    expectNoPublicationMismatches(
      await runPublicationProduct(publicationControlCases),
    )
  })

  it(`preserves independent source work when a successful replay publishes`, async () => {
    expectNoPublicationMismatches(
      await runPublicationProduct(successfulReplacementCases),
    )
  })

  it(`publishes complete replacement batches regardless of independent key order`, async () => {
    expectNoPublicationMismatches(
      await runPublicationProduct(replacementOrderingCases),
    )
  })

  it(`retires incomplete or failed replacement without changing independent public rows`, async () => {
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

  it(`publishes independent source changes with a successful replay`, async () => {
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

  it(`keeps later source changes private after a failed replay`, async () => {
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

  it(`retires failed private replacement rows when its final owner releases`, async () => {
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

  it(`keeps a restarted snapshot private while canceled replay work settles`, async () => {
    // Seed 2018803696, path 65:10:2:10:13:12:12:0:0:0. A canceled-only
    // truncate does not discharge the earlier replay's publication wait.
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
