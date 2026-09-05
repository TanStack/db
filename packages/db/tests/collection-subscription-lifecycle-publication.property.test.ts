import { test as fcTest } from '@fast-check/vitest'
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
type SyncOperations = Parameters<SyncConfig<Row, DemandName>[`sync`]>[0]
type RuntimeAttempt = {
  id: number
  ownerId: number
  demand: DemandName
  session: number
  operations: SyncOperations
  deferred: ReturnType<typeof createDeferred<void>>
  settled: boolean
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
}
type PublicationModel = {
  visible: Map<DemandName, Row>
  replacement?: Replacement
  snapshots: Array<Array<Row>>
}

const sortedRows = (rows: ReadonlyMap<DemandName, Row>): Array<Row> =>
  [...rows.values()]
    .map((row) => ({ ...row }))
    .sort((left, right) => left.id.localeCompare(right.id))

const mapsEqual = (
  left: ReadonlyMap<DemandName, Row>,
  right: ReadonlyMap<DemandName, Row>,
): boolean =>
  left.size === right.size &&
  [...left].every(([id, row]) => right.get(id)?.value === row.value)

function publishIfChanged(
  publication: PublicationModel,
  next: Map<DemandName, Row>,
): void {
  if (mapsEqual(publication.visible, next)) return
  publication.visible = next
  publication.snapshots.push(sortedRows(next))
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
  }
  publication.replacement = undefined
}

function projectPublication(
  publication: PublicationModel,
  lifecycle: LifecycleModel,
  command: LifecycleCommand,
  effect: LifecycleEffect,
  priorPublicationCount: number,
): void {
  if (command.type === `truncate` && lifecycle.publicationBarrierOpen) {
    publication.replacement = {
      session: lifecycle.session,
      replay: lifecycle.replay,
      rows: new Map(),
    }
  } else if (command.type === `restart` && lifecycle.publicationBarrierOpen) {
    publication.replacement = {
      session: lifecycle.session,
      replay: lifecycle.replay,
      rows: new Map(),
    }
  } else if (command.type === `cleanup`) {
    publication.replacement = undefined
  } else if (command.type === `release`) {
    if (
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
        replacement.rows.set(row.id, row)
      } else {
        const next = new Map(publication.visible)
        next.set(row.id, row)
        publishIfChanged(publication, next)
      }
    }
    finishReplacement(publication, lifecycle)
  }

  for (
    let index = priorPublicationCount;
    index < lifecycle.publications;
    index++
  ) {
    publication.snapshots.push(sortedRows(publication.visible))
  }
}

async function runPublicationHistory(
  history: ReadonlyArray<LifecycleCommand>,
): Promise<void> {
  const lifecycle = createLifecycleModel()
  const publication: PublicationModel = {
    visible: new Map(),
    snapshots: [],
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
  const sourceRows = new Map<number, Set<DemandName>>()
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
        sourceRows.set(ownSession, new Set())
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
  const observedSnapshots: Array<Array<Row>> = []
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        const id = String(change.key)
        if (id !== `a` && id !== `b`) {
          throw new Error(`publication used an unknown row key`)
        }
        if (change.type === `delete`) visible.delete(id)
        else visible.set(id, { id, value: change.value.value })
      }
      observedSnapshots.push(sortedRows(visible))
    },
    { includeInitialState: false },
  )

  const writeAttempt = async (attempt: RuntimeAttempt): Promise<void> => {
    const rows = sourceRows.get(attempt.session)
    attempt.operations.begin()
    attempt.operations.write({
      type: rows?.has(attempt.demand) ? `update` : `insert`,
      value: { id: attempt.demand, value: attempt.id },
    })
    const receipt = attempt.operations.commit()
    if (receipt !== true) await receipt
    rows?.add(attempt.demand)
  }

  const assertSnapshots = (command: LifecycleCommand): void => {
    expect(observedSnapshots, JSON.stringify({ history, command })).toEqual(
      publication.snapshots,
    )
  }

  const selectRuntimeAttempt = (
    command: Extract<LifecycleCommand, { type: `settle` }>,
  ): RuntimeAttempt | undefined => {
    if (unsubscribed) return undefined
    const currentAttemptIds = new Set(
      owners.flatMap(({ attemptId }) =>
        attemptId === undefined ? [] : [attemptId],
      ),
    )
    const candidates = [...attempts.values()].filter(
      (attempt) =>
        !attempt.settled &&
        attempt.demand === command.demand &&
        (command.scope === `current`
          ? currentAttemptIds.has(attempt.id)
          : !currentAttemptIds.has(attempt.id)),
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
      const effect = reduceLifecycle(lifecycle, command)

      if (command.type === `request`) {
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
        if (runtimeOwner) owners.splice(owners.indexOf(runtimeOwner), 1)
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
        for (const owner of owners) owner.attemptId = undefined
        const operations = operationsBySession.get(session)
        operations?.begin()
        operations?.truncate()
        const receipt = operations?.commit()
        if (receipt !== true) await receipt
        sourceRows.get(session)?.clear()
      } else if (command.type === `cleanup` && active) {
        for (const owner of owners) owner.attemptId = undefined
        await collection.cleanup()
        active = false
      } else if (command.type === `restart` && !active) {
        collection.startSyncImmediate()
        active = true
      } else if (command.type === `unsubscribe`) {
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
      assertSnapshots(command)
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

  const { multiplier, ...replay } = readOracleRunConfig()
  const runs = 60 * multiplier

  fcTest.prop([publicationLifecycleHistoryArbitrary], {
    numRuns: runs,
    seed: 1_657_005,
  })(
    `matches row publications for a fixed seed`,
    runPublicationHistory,
    120_000,
  )
  fcTest.prop(
    [publicationLifecycleHistoryArbitrary],
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
