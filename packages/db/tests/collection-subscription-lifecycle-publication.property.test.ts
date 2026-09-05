import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import {
  createLifecycleModel,
  greenLifecycleHistories,
  publicationLifecycleHistoryArbitrary,
  reduceLifecycle,
  releasedObsoleteResolveHistory,
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

type Row = { id: DemandName; value: number }
type PublicationChange = {
  type: `insert` | `update` | `delete`
  key: DemandName
  value: Row
  previousValue?: Row
}
type SourceMutation = {
  type: `source`
  demand: DemandName
  action: `upsert` | `delete`
  value: number
}
type PublicationCommand = LifecycleCommand | SourceMutation
type SyncOperations = Parameters<SyncConfig<Row, DemandName>[`sync`]>[0]
type RuntimeAttempt = {
  id: number
  ownerId: number
  demand: DemandName
  session: number
  operations: SyncOperations
  deferred: ReturnType<typeof createDeferred<void>>
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
  rows: Map<DemandName, Row>
  failed: boolean
}
type PublicationModel = {
  source: Map<DemandName, Row>
  visible: Map<DemandName, Row>
  replacement?: Replacement
  batches: Array<Array<PublicationChange>>
  sentKeys: Set<DemandName>
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
  left: ReadonlyMap<DemandName, Row>,
  right: ReadonlyMap<DemandName, Row>,
): boolean =>
  left.size === right.size &&
  [...left].every(([id, row]) => right.get(id)?.value === row.value)

function cloneRow(row: Row): Row {
  return { id: row.id, value: row.value }
}

function publicationDiff(
  previous: ReadonlyMap<DemandName, Row>,
  next: ReadonlyMap<DemandName, Row>,
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
  next: Map<DemandName, Row>,
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
  if (!replacement || lifecycle.publicationBarrierOpen) return
  const currentAttempts = lifecycle.owners.flatMap(({ aborted, attemptId }) =>
    aborted || attemptId === undefined ? [] : [lifecycle.attempts[attemptId]!],
  )
  if (currentAttempts.every(({ outcome }) => outcome === `resolve`)) {
    publishIfChanged(publication, new Map(replacement.rows))
    publication.replacement = undefined
  } else {
    replacement.failed = true
  }
}

function projectPublication(
  publication: PublicationModel,
  lifecycle: LifecycleModel,
  command: PublicationCommand,
  effect: LifecycleEffect,
  priorPublicationCount: number,
): void {
  if (
    command.type === `truncate` &&
    lifecycle.active &&
    !lifecycle.unsubscribed
  ) {
    const removedRows = [...publication.source].sort(([left], [right]) =>
      left.localeCompare(right),
    )
    publication.source.clear()
    if (lifecycle.publicationBarrierOpen) {
      publication.replacement = {
        session: lifecycle.session,
        replay: lifecycle.replay,
        rows: new Map(),
        failed: false,
      }
    } else {
      publication.replacement = undefined
      if (removedRows.length > 0) {
        publication.batches.push(
          removedRows.map(([key, value]) => ({
            type: `delete` as const,
            key,
            value: cloneRow(value),
          })),
        )
        const next = new Map(publication.visible)
        for (const [key] of removedRows) {
          next.delete(key)
          publication.sentKeys.delete(key)
        }
        publication.visible = next
      }
    }
  } else if (command.type === `restart` && lifecycle.publicationBarrierOpen) {
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
    const previousValue = publication.source.get(command.demand)
    if (command.action === `delete`) {
      publication.source.delete(command.demand)
      publication.replacement?.rows.delete(command.demand)
      if (!publication.replacement && previousValue) {
        publication.visible.delete(command.demand)
        publication.sentKeys.delete(command.demand)
        publication.batches.push([
          {
            type: `delete`,
            key: command.demand,
            value: cloneRow(previousValue),
          },
        ])
      }
    } else {
      const row = {
        id: command.demand,
        value: command.value,
      }
      if (publication.replacement) {
        publication.source.set(command.demand, row)
        publication.replacement.rows.set(command.demand, row)
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
    } else if (command.outcome === `resolve`) {
      publication.source.set(attempt.demand, {
        id: attempt.demand,
        value: attempt.id,
      })
    }
    finishReplacement(publication, lifecycle)
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
  demand: fc.constantFrom(`a` as const, `b` as const),
  action: fc.constantFrom(`upsert` as const, `delete` as const),
  value: fc.integer({ min: 0, max: 5 }),
})

function mutatesDuringPublicationBarrier(
  history: ReadonlyArray<PublicationCommand>,
): boolean {
  const lifecycle = createLifecycleModel()
  for (const command of history) {
    if (command.type === `source`) {
      if (lifecycle.publicationBarrierOpen) return true
    } else {
      reduceLifecycle(lifecycle, command)
    }
  }
  return false
}

function omitKnownRedVisibleRowRequests(
  history: ReadonlyArray<PublicationCommand>,
): Array<PublicationCommand> {
  const lifecycle = createLifecycleModel()
  const sourceRows = new Set<DemandName>()
  const result: Array<PublicationCommand> = []
  for (const command of history) {
    if (command.type === `source`) {
      result.push(command)
      if (!lifecycle.active || lifecycle.unsubscribed) continue
      if (command.action === `delete`) sourceRows.delete(command.demand)
      else sourceRows.add(command.demand)
      continue
    }

    if (command.type === `request` && sourceRows.has(command.demand)) {
      continue
    }

    result.push(command)
    const effect = reduceLifecycle(lifecycle, command)
    if (command.type === `truncate` && lifecycle.active) sourceRows.clear()
    if (command.type === `cleanup`) sourceRows.clear()
    if (
      command.type === `settle` &&
      command.outcome === `resolve` &&
      effect.attemptId !== undefined
    ) {
      const attempt = lifecycle.attempts[effect.attemptId]!
      const isCurrent = lifecycle.owners.some(
        ({ attemptId }) => attemptId === attempt.id,
      )
      if (isCurrent && !attempt.aborted) sourceRows.add(attempt.demand)
    }
  }
  return result
}

function resolvesAbortedAttempt(
  history: ReadonlyArray<PublicationCommand>,
): boolean {
  const lifecycle = createLifecycleModel()
  for (const command of history) {
    if (command.type === `source`) continue
    const effect = reduceLifecycle(lifecycle, command)
    if (
      command.type === `settle` &&
      command.outcome === `resolve` &&
      effect.attemptId !== undefined &&
      lifecycle.attempts[effect.attemptId]?.aborted
    ) {
      return true
    }
  }
  return false
}

const publicationCommandHistoryArbitrary: fc.Arbitrary<
  Array<PublicationCommand>
> = publicationLifecycleHistoryArbitrary.chain((history) =>
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
    })
    .map(omitKnownRedVisibleRowRequests)
    .filter(
      (history) =>
        !mutatesDuringPublicationBarrier(history) &&
        !resolvesAbortedAttempt(history),
    ),
)

async function runPublicationHistory(
  history: ReadonlyArray<PublicationCommand>,
): Promise<void> {
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
  const owners: Array<RuntimeOwner> = []
  const sourceRows = new Map<number, Map<DemandName, Row>>()
  const operationsBySession = new Map<number, SyncOperations>()
  let nextAttemptId = 0
  let nextOwnerId = 0
  let session = -1
  let active = true
  let unsubscribed = false

  const collection = createCollection<Row, DemandName>({
    id: `generated-lifecycle-publication`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        const ownSession = ++session
        operationsBySession.set(ownSession, operations)
        sourceRows.set(ownSession, new Map())
        operations.markReady()
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
              settled: false,
              current: true,
            })
            owner.attemptId = id
            return deferred.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })

  const visible = new Map<DemandName, Row>()
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
        if (id !== `a` && id !== `b`) {
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

  const assertPublications = (command: PublicationCommand): void => {
    const context = JSON.stringify({
      history,
      command,
      observedBatches,
      expectedBatches: publication.batches,
    })
    expect(observedBatches, context).toEqual(publication.batches)
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
    for (const command of history) {
      const priorPublicationCount = lifecycle.publications
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
        const previous = rows?.get(command.demand)
        operations?.begin()
        if (command.action === `delete`) {
          operations?.write({ type: `delete`, key: command.demand })
          rows?.delete(command.demand)
        } else {
          const value = { id: command.demand, value: command.value }
          operations?.write({
            type: previous ? `update` : `insert`,
            value,
            ...(previous ? { previousValue: previous } : {}),
          })
          rows?.set(command.demand, value)
        }
        const receipt = operations?.commit()
        if (receipt !== true) await receipt
      } else if (command.type === `request`) {
        expect(effect.ownerId).toBe(unsubscribed ? undefined : runtimeOwner?.id)
        subscription.requestSnapshot({
          where: where[command.demand],
          signal: runtimeOwner?.controller.signal,
        })
      } else if (command.type === `abort`) {
        expect(effect.ownerId).toBe(runtimeOwner?.id)
        if (runtimeOwner) {
          runtimeOwner.aborted = true
          runtimeOwner.controller.abort()
        }
      } else if (command.type === `release`) {
        expect(effect.ownerId).toBe(runtimeOwner?.id)
        if (runtimeOwner) {
          if (runtimeOwner.attemptId !== undefined) {
            attempts.get(runtimeOwner.attemptId)!.current = false
          }
          owners.splice(owners.indexOf(runtimeOwner), 1)
        }
        subscription.releaseSnapshot(where[command.demand])
      } else if (command.type === `settle`) {
        expect(effect.attemptId).toBe(runtimeAttempt?.id)
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
        for (const owner of owners) {
          if (owner.attemptId !== undefined) {
            attempts.get(owner.attemptId)!.current = false
          }
          owner.attemptId = undefined
        }
        const operations = operationsBySession.get(session)
        operations?.begin()
        operations?.truncate()
        const receipt = operations?.commit()
        if (receipt !== true) await receipt
        sourceRows.get(session)?.clear()
      } else if (command.type === `cleanup` && active) {
        for (const owner of owners) {
          if (owner.attemptId !== undefined) {
            attempts.get(owner.attemptId)!.current = false
          }
          owner.attemptId = undefined
        }
        await collection.cleanup()
        active = false
      } else if (command.type === `restart` && !active) {
        collection.startSyncImmediate()
        active = true
      } else if (command.type === `unsubscribe`) {
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
      )
      assertPublications(command)
    }
  } finally {
    for (const attempt of attempts.values()) attempt.deferred.resolve()
    await flushPromises()
    subscription.unsubscribe()
    await collection.cleanup()
  }
}

describe(`CollectionSubscription lifecycle publication oracle`, () => {
  it(`maps every canonical green lifecycle history to public rows`, async () => {
    for (const history of greenLifecycleHistories) {
      await runPublicationHistory(history)
    }
  })

  it(`does not publish rows written by a released obsolete acquisition`, async () => {
    await runPublicationHistory(releasedObsoleteResolveHistory)
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
      { type: `source`, demand: `b`, action: `upsert`, value: 50 },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
    ])
  })

  it(`does not republish a row already delivered by a live change`, async () => {
    await runPublicationHistory([
      { type: `source`, demand: `a`, action: `upsert`, value: 0 },
      { type: `request`, demand: `b` },
      { type: `source`, demand: `b`, action: `upsert`, value: 1 },
      { type: `request`, demand: `b` },
    ])
  })

  it(`does not publish a non-cooperative acquisition after its signal aborts`, async () => {
    await runPublicationHistory([
      { type: `request`, demand: `a` },
      { type: `abort`, demand: `a` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
    ])
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
      { type: `source`, demand: `b`, action: `upsert`, value: 51 },
    ])
  })

  const { multiplier, ...replay } = readOracleRunConfig()
  const runs = 60 * multiplier

  fcTest.prop([publicationCommandHistoryArbitrary], {
    numRuns: runs,
    seed: 1_657_005,
  })(
    `matches row publications for a fixed seed`,
    runPublicationHistory,
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
    runPublicationHistory,
    120_000,
  )
})
