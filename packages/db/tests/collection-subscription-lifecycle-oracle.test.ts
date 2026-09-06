import { fc, test as fcTest } from '@fast-check/vitest'
import { afterAll, describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { flushPromises } from './utils.js'
import {
  oraclePropertyOptions,
  oracleRandomParameters,
  readOracleRunConfig,
} from './oracle-config.js'
import type { LoadSubsetOptions, SyncConfig } from '../src/types.js'

type StartOutcome = `return` | `throw` | `resolve` | `reject`
type StartReentry =
  | `none`
  | `abort-self`
  | `truncate`
  | `release-self`
  | `release-peer`
  | `unsubscribe`
  | `cleanup`
type RestartReentry =
  | `none`
  | `release-self`
  | `release-peer`
  | `unsubscribe`
  | `cleanup`

const acquisitionPhases = [
  `deferred`,
  `starting`,
  `on-demand`,
  `eager`,
  `retiring`,
  `unavailable`,
] as const
const acquisitionEntries = [
  `request`,
  `resume`,
  `markReady`,
  `markError`,
  `syncReturn`,
] as const
type AcquisitionPhase = (typeof acquisitionPhases)[number]
type AcquisitionEntry = (typeof acquisitionEntries)[number]
type AcquisitionCell = `${AcquisitionPhase}:${AcquisitionEntry}`

type AcquisitionCellDefinition =
  | { kind: `covered` }
  | { kind: `excluded`; reason: string }

const acquisitionCellDefinitions = {
  'deferred:request': { kind: `covered` },
  'deferred:resume': { kind: `covered` },
  'deferred:markReady': {
    kind: `excluded`,
    reason: `the sync callback has not started and cannot mark ready`,
  },
  'deferred:markError': {
    kind: `excluded`,
    reason: `the sync callback has not started and cannot mark error`,
  },
  'deferred:syncReturn': {
    kind: `excluded`,
    reason: `the deferred sync callback has no result to return`,
  },
  'starting:request': { kind: `covered` },
  'starting:resume': {
    kind: `excluded`,
    reason: `resuming the deferred gate enters this phase only once`,
  },
  'starting:markReady': { kind: `covered` },
  'starting:markError': { kind: `covered` },
  'starting:syncReturn': { kind: `covered` },
  'on-demand:request': { kind: `covered` },
  'on-demand:resume': {
    kind: `excluded`,
    reason: `an installed loader is no longer behind the deferred gate`,
  },
  'on-demand:markReady': { kind: `covered` },
  'on-demand:markError': { kind: `covered` },
  'on-demand:syncReturn': {
    kind: `excluded`,
    reason: `the sync callback already returned the installed loader`,
  },
  'eager:request': { kind: `covered` },
  'eager:resume': {
    kind: `excluded`,
    reason: `eager sync is not a deferred subset acquisition`,
  },
  'eager:markReady': {
    kind: `excluded`,
    reason: `eager readiness does not install a subset loader`,
  },
  'eager:markError': {
    kind: `excluded`,
    reason: `eager errors do not change subset acquisition availability`,
  },
  'eager:syncReturn': {
    kind: `excluded`,
    reason: `eager sync results own no subset loader contract`,
  },
  'retiring:request': { kind: `covered` },
  'retiring:resume': {
    kind: `excluded`,
    reason: `retirement is outside the deferred-start gate`,
  },
  'retiring:markReady': {
    kind: `excluded`,
    reason: `callbacks from a retiring session cannot restore availability`,
  },
  'retiring:markError': {
    kind: `excluded`,
    reason: `callbacks from a retiring session are obsolete`,
  },
  'retiring:syncReturn': {
    kind: `excluded`,
    reason: `obsolete returned resources use the resource-installation axis`,
  },
  'unavailable:request': { kind: `covered` },
  'unavailable:resume': {
    kind: `excluded`,
    reason: `same-session recovery uses markReady rather than defer resume`,
  },
  'unavailable:markReady': { kind: `covered` },
  'unavailable:markError': {
    kind: `excluded`,
    reason: `a repeated error leaves acquisition unavailable`,
  },
  'unavailable:syncReturn': {
    kind: `excluded`,
    reason: `handler-less return is the transition into unavailable`,
  },
} satisfies Record<AcquisitionCell, AcquisitionCellDefinition>

const legalAcquisitionCells = new Set<AcquisitionCell>(
  Object.entries(acquisitionCellDefinitions)
    .filter(([, definition]) => definition.kind === `covered`)
    .map(([cell]) => cell as AcquisitionCell),
)
const excludedAcquisitionCells = new Map<AcquisitionCell, string>(
  Object.entries(acquisitionCellDefinitions).flatMap(([cell, definition]) =>
    definition.kind === `excluded`
      ? [[cell as AcquisitionCell, definition.reason]]
      : [],
  ),
)
const observedAcquisitionCells = new Set<AcquisitionCell>()

function acquisitionCase(
  cells: ReadonlyArray<AcquisitionCell>,
  name: string,
  run: (reach: (cell: AcquisitionCell) => void) => void | Promise<void>,
): void {
  const declaredCells = new Set(cells)
  it(name, () =>
    run((cell) => {
      if (!declaredCells.has(cell)) {
        throw new Error(`${name} reached undeclared acquisition cell ${cell}`)
      }
      observedAcquisitionCells.add(cell)
    }),
  )
}

const physicalAcquisitionStates = [
  `none`,
  `starting`,
  `active`,
  `obsolete`,
  `release-debt`,
] as const
const physicalInteractionCauses = [
  `release`,
  `abort`,
  `truncate`,
  `cleanup`,
  `unsubscribe`,
] as const
type PhysicalAcquisitionState = (typeof physicalAcquisitionStates)[number]
type PhysicalInteractionCause = (typeof physicalInteractionCauses)[number]
type PhysicalInteractionCell =
  `${PhysicalAcquisitionState}:${PhysicalInteractionCause}`
type PhysicalInteraction =
  | `no-acquisition`
  | `abort-only`
  | `retire`
  | `preserve-debt`
  | `discard-debt`
  | `retry-debt`
type PhysicalInteractionCellDefinition =
  | { kind: `covered`; interaction: PhysicalInteraction }
  | { kind: `excluded`; reason: string }

const physicalInteractionCellDefinitions = {
  'none:release': {
    kind: `covered`,
    interaction: `no-acquisition`,
  },
  'none:abort': {
    kind: `covered`,
    interaction: `no-acquisition`,
  },
  'none:truncate': {
    kind: `covered`,
    interaction: `no-acquisition`,
  },
  'none:cleanup': {
    kind: `covered`,
    interaction: `no-acquisition`,
  },
  'none:unsubscribe': {
    kind: `covered`,
    interaction: `no-acquisition`,
  },
  'starting:release': { kind: `covered`, interaction: `retire` },
  'starting:abort': { kind: `covered`, interaction: `abort-only` },
  'starting:truncate': { kind: `covered`, interaction: `retire` },
  'starting:cleanup': { kind: `covered`, interaction: `retire` },
  'starting:unsubscribe': { kind: `covered`, interaction: `retire` },
  'active:release': { kind: `covered`, interaction: `retire` },
  'active:abort': {
    kind: `covered`,
    interaction: `abort-only`,
  },
  'active:truncate': { kind: `covered`, interaction: `retire` },
  'active:cleanup': { kind: `covered`, interaction: `retire` },
  'active:unsubscribe': { kind: `covered`, interaction: `retire` },
  'obsolete:release': {
    kind: `excluded`,
    reason: `the replacement owns later release; obsolete work was retired once`,
  },
  'obsolete:abort': {
    kind: `excluded`,
    reason: `obsolete work was already signaled and retired`,
  },
  'obsolete:truncate': {
    kind: `excluded`,
    reason: `another truncate retires the current replacement, not already-obsolete work`,
  },
  'obsolete:cleanup': {
    kind: `excluded`,
    reason: `source cleanup retires the current session; obsolete work was retired once`,
  },
  'obsolete:unsubscribe': {
    kind: `excluded`,
    reason: `unsubscribe retires current ownership; obsolete work was retired once`,
  },
  'release-debt:release': {
    kind: `excluded`,
    reason: `logical release already happened; teardown retries physical debt`,
  },
  'release-debt:abort': {
    kind: `excluded`,
    reason: `the failed physical release is already aborted`,
  },
  'release-debt:truncate': {
    kind: `covered`,
    interaction: `preserve-debt`,
  },
  'release-debt:cleanup': { kind: `covered`, interaction: `discard-debt` },
  'release-debt:unsubscribe': { kind: `covered`, interaction: `retry-debt` },
} satisfies Record<PhysicalInteractionCell, PhysicalInteractionCellDefinition>

const requiredPhysicalInteractions = new Map<
  PhysicalInteractionCell,
  PhysicalInteraction
>(
  Object.entries(physicalInteractionCellDefinitions).flatMap(
    ([cell, definition]) =>
      definition.kind === `covered`
        ? [[cell as PhysicalInteractionCell, definition.interaction]]
        : [],
  ),
)
const observedPhysicalInteractions = new Map<
  PhysicalInteractionCell,
  PhysicalInteraction
>()

function observePhysicalInteraction(
  cell: PhysicalInteractionCell,
  interaction: PhysicalInteraction,
): void {
  observedPhysicalInteractions.set(cell, interaction)
}

const requiredSourceSessionBoundaries = new Set([
  `active-cleanup`,
  `restart-installed`,
  `cleanup-callback-reentry`,
  `obsolete-resource-return`,
] as const)
type SourceSessionBoundary =
  typeof requiredSourceSessionBoundaries extends Set<infer T> ? T : never
const observedSourceSessionBoundaries = new Set<SourceSessionBoundary>()

function observeSourceSessionBoundary(boundary: SourceSessionBoundary): void {
  observedSourceSessionBoundaries.add(boundary)
}

const startOutcomes = [`return`, `throw`, `resolve`, `reject`] as const
const startReentries = [
  `none`,
  `abort-self`,
  `truncate`,
  `release-self`,
  `release-peer`,
  `unsubscribe`,
  `cleanup`,
] as const

type StartScenario = {
  outcome: StartOutcome
  reentry: StartReentry
}

const startScenarios: ReadonlyArray<StartScenario> = startOutcomes.flatMap(
  (outcome) => startReentries.map((reentry) => ({ outcome, reentry })),
)

const failureScenarios = ([`throw`, `reject`] as const).flatMap((outcome) =>
  startReentries.map((reentry) => ({ outcome, reentry })),
)
type FailureDeliverySuffix = `${`throw` | `reject`}:${StartReentry}`
const requiredFailureDeliverySuffixes = new Set<FailureDeliverySuffix>(
  failureScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
)
const observedFailureDeliverySuffixes = new Set<FailureDeliverySuffix>()

const releaseScenarios = ([`return`, `throw`] as const).flatMap((outcome) =>
  ([`none`, `reacquire-self`, `release-peer`, `unsubscribe`] as const).map(
    (reentry) => ({ outcome, reentry }),
  ),
)

const restartScenarios = startOutcomes.flatMap((outcome) =>
  (
    [`none`, `release-self`, `release-peer`, `unsubscribe`, `cleanup`] as const
  ).map((reentry: RestartReentry) => ({ outcome, reentry })),
)

const threeGenerationScenarios = ([`resolve`, `reject`] as const).flatMap(
  (obsoleteOutcome) =>
    ([`resolve`, `reject`] as const).flatMap((currentOutcome) =>
      ([`obsolete-first`, `current-first`] as const).map((settlementOrder) => ({
        obsoleteOutcome,
        currentOutcome,
        settlementOrder,
      })),
    ),
)

type AsyncRestartScenario = {
  demands: ReadonlyArray<`a` | `b`>
  generationOutcomes: ReadonlyArray<ReadonlyArray<`resolve` | `reject`>>
  settlementOrder: `obsolete-first` | `current-first` | `interleaved`
}

const asyncRestartCoverageScenarios = [
  {
    demands: [`a`],
    generationOutcomes: [[`reject`]],
    settlementOrder: `current-first`,
  },
  {
    demands: [`a`],
    generationOutcomes: [[`resolve`], [`resolve`]],
    settlementOrder: `obsolete-first`,
  },
  {
    demands: [`a`, `b`],
    generationOutcomes: [
      [`reject`, `resolve`],
      [`resolve`, `reject`],
    ],
    settlementOrder: `current-first`,
  },
  {
    demands: [`a`, `b`],
    generationOutcomes: [
      [`resolve`, `resolve`],
      [`reject`, `reject`],
      [`resolve`, `resolve`],
    ],
    settlementOrder: `interleaved`,
  },
] as const satisfies ReadonlyArray<AsyncRestartScenario>

const asyncRestartScenarioArbitrary: fc.Arbitrary<AsyncRestartScenario> = fc
  .uniqueArray(fc.constantFrom(`a` as const, `b` as const), {
    minLength: 1,
    maxLength: 2,
  })
  .chain((demands) =>
    fc.record({
      demands: fc.constant(demands),
      generationOutcomes: fc.array(
        fc.array(fc.constantFrom(`resolve` as const, `reject` as const), {
          minLength: demands.length,
          maxLength: demands.length,
        }),
        { minLength: 1, maxLength: 3 },
      ),
      settlementOrder: fc.constantFrom(
        `obsolete-first` as const,
        `current-first` as const,
        `interleaved` as const,
      ),
    }),
  )

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    asyncRestartScenarioArbitrary,
    ({ demands, generationOutcomes, settlementOrder }) => {
      const realizesInterleaving =
        settlementOrder === `interleaved` &&
        demands.length > 1 &&
        generationOutcomes.length > 1
      return [
        `demands=${demands.length}`,
        `generations=${generationOutcomes.length + 1}`,
        `current=${generationOutcomes.at(-1)?.join(`+`)}`,
        `mixed-current=${new Set(generationOutcomes.at(-1)).size > 1}`,
        `obsolete-reject=${generationOutcomes
          .slice(0, -1)
          .some((outcomes) => outcomes.includes(`reject`))}`,
        `requested-order=${
          settlementOrder === `interleaved` && !realizesInterleaving
            ? `degenerate-interleaved`
            : settlementOrder
        }`,
      ]
    },
    oraclePropertyOptions(1_000, `subscription-lifecycle.async-statistics`),
  )
}

async function runAsyncRestartScenario(
  scenario: AsyncRestartScenario,
): Promise<Set<string>> {
  type DemandName = `a` | `b`
  type Row = { id: DemandName; version: number }
  type Attempt = {
    session: number
    demand: DemandName
    options: LoadSubsetOptions
    deferred: ReturnType<typeof createDeferred<void>>
  }
  type SettlementEvent = {
    attempt: Attempt
    session: number
    demand: DemandName
    outcome: `resolve` | `reject`
    activeSession: number
  }
  const where = {
    a: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
    b: new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
  }
  const demandForWhere = new Map<unknown, DemandName>([
    [where.a, `a`],
    [where.b, `b`],
  ])
  const attempts: Array<Attempt> = []
  const errors: Array<{ demand: DemandName; error: unknown }> = []
  const publications: Array<Array<Row>> = []
  const statuses: Array<string> = []
  const visible = new Map<string | number, Row>()
  const unloads: Array<{ session: number; demand: DemandName }> = []
  const settlements: Array<SettlementEvent> = []
  const settledAttempts = new Set<Attempt>()
  const publishedBeforeRetirement = new Set<number>()
  const failures = scenario.generationOutcomes.map((_, generation) =>
    scenario.demands.map(
      (demand) => new Error(`session ${generation + 1} ${demand} failed`),
    ),
  )
  let session = -1

  const outcomeFor = (attempt: Attempt) =>
    scenario.generationOutcomes[attempt.session - 1]![
      scenario.demands.indexOf(attempt.demand)
    ]!
  const failureFor = (attempt: Attempt) =>
    failures[attempt.session - 1]![scenario.demands.indexOf(attempt.demand)]!

  const settleAttempt = async (attempt: Attempt): Promise<void> => {
    const outcome = outcomeFor(attempt)
    if (outcome === `resolve`) attempt.deferred.resolve()
    else attempt.deferred.reject(failureFor(attempt))
    await flushPromises()
    settlements.push({
      attempt,
      session: attempt.session,
      demand: attempt.demand,
      outcome,
      activeSession: session,
    })
    settledAttempts.add(attempt)
  }

  const collection = createCollection<Row>({
    id: `async-restart-lifecycle`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        session++
        const ownSession = session
        operations.markReady()
        return {
          loadSubset: (options) => {
            const demand = demandForWhere.get(options.where)
            if (!demand) throw new Error(`unknown async demand`)
            const deferred = createDeferred<void>()
            void deferred.promise.catch(() => {})
            attempts.push({
              session: ownSession,
              demand,
              options,
              deferred,
            })
            return deferred.promise.then(() => {
              operations.begin()
              operations.write({
                type: `insert`,
                value: { id: demand, version: ownSession + 1 },
              })
              const receipt = operations.commit()
              if (receipt !== true) return receipt
              return undefined
            })
          },
          unloadSubset: (options) => {
            const demand = demandForWhere.get(options.where)
            if (!demand) throw new Error(`unknown async demand`)
            unloads.push({ session: ownSession, demand })
          },
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            version: change.value.version,
          })
        }
      }
      publications.push(
        [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
      )
    },
    { includeInitialState: false },
  )
  subscription.on(`loadSubset:error`, ({ options, error }) => {
    const demand = demandForWhere.get(options.where)
    if (!demand) throw new Error(`unknown errored demand`)
    errors.push({ demand, error })
  })
  subscription.on(`status:change`, ({ status }) => statuses.push(status))

  try {
    for (const demand of scenario.demands) {
      subscription.requestSnapshot({ where: where[demand] })
    }
    for (const attempt of attempts.filter(
      ({ session: value }) => value === 0,
    )) {
      attempt.deferred.resolve()
    }
    await flushPromises()
    expect(
      [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      [...scenario.demands]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ id, version: 1 })),
    )

    for (
      let generation = 0;
      generation < scenario.generationOutcomes.length;
      generation++
    ) {
      const discardedSession = session
      await collection.cleanup()
      for (const attempt of attempts.filter(
        ({ session: attemptSession }) => attemptSession === discardedSession,
      )) {
        expect(attempt.options.signal?.aborted).toBe(true)
      }
      collection.startSyncImmediate()
      await flushPromises()
      const expectedSession = generation + 1
      expect(
        attempts
          .filter(
            ({ session: attemptSession }) => attemptSession <= expectedSession,
          )
          .map(({ session: attemptSession, demand }) => ({
            session: attemptSession,
            demand,
          })),
      ).toEqual(
        Array.from({ length: expectedSession + 1 }, (_, attemptSession) =>
          scenario.demands.map((demand) => ({
            session: attemptSession,
            demand,
          })),
        ).flat(),
      )

      const publishesBeforeLaterRestart =
        scenario.settlementOrder === `interleaved` &&
        generation === 0 &&
        scenario.generationOutcomes.length > 1 &&
        scenario.generationOutcomes[generation]!.every(
          (outcome) => outcome === `resolve`,
        )
      if (publishesBeforeLaterRestart) {
        const publicationCount = publications.length
        for (const attempt of attempts.filter(
          ({ session: attemptSession }) => attemptSession === expectedSession,
        )) {
          await settleAttempt(attempt)
        }
        const expectedRows = [...scenario.demands]
          .sort((a, b) => a.localeCompare(b))
          .map((id) => ({ id, version: expectedSession + 1 }))
        expect(
          [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
        ).toEqual(expectedRows)
        expect(publications.slice(publicationCount)).toEqual([expectedRows])
        publishedBeforeRetirement.add(expectedSession)
      }
    }

    const currentSession = scenario.generationOutcomes.length
    expect(
      attempts.map(({ session: attemptSession, demand }) => ({
        session: attemptSession,
        demand,
      })),
    ).toEqual(
      Array.from({ length: currentSession + 1 }, (_, attemptSession) =>
        scenario.demands.map((demand) => ({
          session: attemptSession,
          demand,
        })),
      ).flat(),
    )
    const obsolete = attempts.filter(
      (attempt) =>
        attempt.session > 0 &&
        attempt.session < currentSession &&
        !settledAttempts.has(attempt),
    )
    const current = attempts.filter(
      ({ session: value }) => value === currentSession,
    )
    const orderedAttempts =
      scenario.settlementOrder === `obsolete-first`
        ? [...obsolete, ...current]
        : scenario.settlementOrder === `current-first`
          ? [...current, ...obsolete]
          : attempts
              .filter(({ session: value }) => value > 0)
              .filter((attempt) => !settledAttempts.has(attempt))
              .sort((left, right) =>
                left.demand === right.demand
                  ? right.session - left.session
                  : left.demand.localeCompare(right.demand),
              )

    const settledCurrent: Array<Attempt> = []
    const publicationTraceStart = publications.length
    const statusTraceStart = statuses.length
    const retainedVersion = publishedBeforeRetirement.size
      ? Math.max(...publishedBeforeRetirement) + 1
      : 1
    const assertObservableState = () => {
      const currentComplete = settledCurrent.length === current.length
      const currentSucceeded = current.every(
        (attempt) => outcomeFor(attempt) === `resolve`,
      )
      const visibleVersion =
        currentComplete && currentSucceeded
          ? currentSession + 1
          : retainedVersion
      const expectedRows = [...scenario.demands]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ id, version: visibleVersion }))
      expect(
        [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(expectedRows)
      const expectedFailedAttempts = settledCurrent.filter(
        (attempt) => outcomeFor(attempt) === `reject`,
      )
      expect(errors.map(({ demand }) => demand)).toEqual(
        expectedFailedAttempts.map(({ demand }) => demand),
      )
      for (const [index, { error }] of errors.entries()) {
        expect(error).toBe(failureFor(expectedFailedAttempts[index]!))
      }
      expect(subscription.lastError).toBe(
        expectedFailedAttempts.length
          ? failureFor(expectedFailedAttempts.at(-1)!)
          : undefined,
      )
      expect(subscription.status).toBe(
        currentComplete ? `ready` : `loadingSubset`,
      )
      expect(publications.slice(publicationTraceStart)).toEqual(
        currentComplete && currentSucceeded ? [expectedRows] : [],
      )
      expect(statuses.slice(statusTraceStart)).toEqual(
        currentComplete ? [`ready`] : [],
      )
    }

    for (const attempt of orderedAttempts) {
      await settleAttempt(attempt)
      if (attempt.session === currentSession) settledCurrent.push(attempt)
      assertObservableState()
    }

    const currentSucceeded = current.every(
      (attempt) => outcomeFor(attempt) === `resolve`,
    )
    const expectedVersion = currentSucceeded
      ? currentSession + 1
      : retainedVersion
    expect(
      [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      [...scenario.demands]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ id, version: expectedVersion })),
    )
    if (currentSucceeded) {
      expect(errors).toEqual([])
      expect(subscription.lastError).toBeUndefined()
    } else {
      const expectedFailedAttempts = settledCurrent.filter(
        (attempt) => outcomeFor(attempt) === `reject`,
      )
      expect(errors.map(({ demand }) => demand)).toEqual(
        expectedFailedAttempts.map(({ demand }) => demand),
      )
      for (const [index, { error }] of errors.entries()) {
        expect(error).toBe(failureFor(expectedFailedAttempts[index]!))
      }
      expect(subscription.lastError).toBe(
        failureFor(expectedFailedAttempts.at(-1)!),
      )
    }
    expect(subscription.status).toBe(`ready`)
    for (const attempt of current) {
      expect(attempt.options.signal?.aborted).toBe(false)
    }

    const finalScopes = settlements.map(({ session: attemptSession }) =>
      attemptSession === currentSession ? `current` : `obsolete`,
    )
    const firstCurrent = finalScopes.indexOf(`current`)
    const lastCurrent = finalScopes.lastIndexOf(`current`)
    const firstObsolete = finalScopes.indexOf(`obsolete`)
    const lastObsolete = finalScopes.lastIndexOf(`obsolete`)
    const observedOrder =
      firstCurrent === -1 || firstObsolete === -1
        ? undefined
        : lastObsolete < firstCurrent
          ? `obsolete-first`
          : lastCurrent < firstObsolete
            ? `current-first`
            : `interleaved`
    const currentOutcomes = settlements
      .filter(
        ({ session: attemptSession }) => attemptSession === currentSession,
      )
      .map(({ outcome }) => outcome)
    expect(new Set(settlements.map(({ attempt }) => attempt)).size).toBe(
      settlements.length,
    )
    expect(settlements).toHaveLength(
      attempts.filter(({ session: attemptSession }) => attemptSession > 0)
        .length,
    )
    const reach = new Set([
      `demands:${new Set(attempts.map(({ demand }) => demand)).size}`,
      `sessions:${new Set(attempts.map(({ session }) => session)).size}`,
      ...[...new Set(currentOutcomes)].map((outcome) => `current:${outcome}`),
      `mixed-current:${new Set(currentOutcomes).size > 1}`,
      `obsolete-reject:${settlements.some(
        ({ session: attemptSession, outcome }) =>
          attemptSession < currentSession && outcome === `reject`,
      )}`,
      ...(observedOrder ? [`order:${observedOrder}`] : []),
      `real-interleaving:${settlements.some(
        ({ session: attemptSession, activeSession }) =>
          attemptSession < currentSession &&
          activeSession === attemptSession &&
          publishedBeforeRetirement.has(attemptSession),
      )}`,
    ])

    subscription.unsubscribe()
    for (const attempt of current) {
      expect(attempt.options.signal?.aborted).toBe(true)
    }
    expect(unloads).toEqual(
      scenario.demands.map((demand) => ({
        session: currentSession,
        demand,
      })),
    )
    return reach
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
}

/**
 * Exhaust the synchronous adapter-start boundary before adding more runtime
 * special cases. Logical demand is visible during this callback, but a
 * physical lease exists only if the callback returns.
 */
describe(`CollectionSubscription demand lifecycle oracle`, () => {
  it(`executes every required async restart regime`, async () => {
    const reach = new Set<string>()
    for (const scenario of asyncRestartCoverageScenarios) {
      for (const label of await runAsyncRestartScenario(scenario)) {
        reach.add(label)
      }
    }
    const required = [
      `demands:1`,
      `demands:2`,
      `sessions:2`,
      `sessions:3`,
      `sessions:4`,
      `current:resolve`,
      `current:reject`,
      `mixed-current:true`,
      `obsolete-reject:true`,
      `order:obsolete-first`,
      `order:current-first`,
      `order:interleaved`,
      `real-interleaving:true`,
    ]
    expect(required.filter((label) => !reach.has(label))).toEqual([])
  })

  it(`covers every finite start, failure-delivery, and release cell`, () => {
    expect(
      new Set(
        startScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(startOutcomes.length * startReentries.length)
    expect(
      new Set(
        failureScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(2 * startReentries.length)
    expect(
      new Set(
        releaseScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(2 * 4)
    expect(
      new Set(
        restartScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(4 * 5)
  })

  it(`accounts for every acquisition phase and entry pair`, () => {
    const allCells = new Set<AcquisitionCell>(
      acquisitionPhases.flatMap((phase) =>
        acquisitionEntries.map((entry) => `${phase}:${entry}` as const),
      ),
    )
    expect(
      new Set([...legalAcquisitionCells, ...excludedAcquisitionCells.keys()]),
    ).toEqual(allCells)
  })

  it(`accounts for every physical acquisition state and interaction cause`, () => {
    const allCells = new Set<PhysicalInteractionCell>(
      physicalAcquisitionStates.flatMap((state) =>
        physicalInteractionCauses.map((cause) => `${state}:${cause}` as const),
      ),
    )
    expect(new Set(Object.keys(physicalInteractionCellDefinitions))).toEqual(
      allCells,
    )
  })

  afterAll(() => {
    expect(observedAcquisitionCells).toEqual(legalAcquisitionCells)
    expect(observedPhysicalInteractions).toEqual(requiredPhysicalInteractions)
    expect(observedSourceSessionBoundaries).toEqual(
      requiredSourceSessionBoundaries,
    )
    expect(observedFailureDeliverySuffixes).toEqual(
      requiredFailureDeliverySuffixes,
    )
  })

  it.each(startScenarios)(
    `keeps logical and physical ownership aligned for $outcome × $reentry`,
    async ({ outcome, reentry }) => {
      const targetWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`target`),
      ])
      const peerWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`peer`)])
      const failure = new Error(`target load failed`)
      const pending = createDeferred<void>()
      // A reentrant release can make the subscription stop observing the
      // adapter Promise. Keep the test process deterministic while separately
      // asserting the subscription's public error trace below.
      void pending.promise.catch(() => {})
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<unknown> = []
      const statuses: Array<string> = []
      const controller = new AbortController()
      let didReenter = false
      let statusAtTruncate: string | undefined
      let truncate!: () => void
      let runReentry = () => {}

      const collection = createCollection<{ id: string }>({
        id: `demand-start-${outcome}-${reentry}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            const { markReady } = operations
            truncate = () => {
              operations.begin()
              operations.truncate()
              operations.commit()
            }
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (options.where === peerWhere) return true
                if (didReenter) return true
                didReenter = true
                runReentry()
                if (outcome === `throw`) throw failure
                if (outcome === `return`) return true
                return pending.promise
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.on(`status:change`, ({ status }) => statuses.push(status))

      if (reentry === `release-peer`) {
        subscription.requestSnapshot({ where: peerWhere })
      }
      runReentry = () => {
        if (reentry === `abort-self`) {
          controller.abort()
        } else if (reentry === `truncate`) {
          truncate()
          statusAtTruncate = subscription.status
        } else if (reentry === `release-self`) {
          subscription.releaseSnapshot(targetWhere)
        } else if (reentry === `release-peer`) {
          subscription.releaseSnapshot(peerWhere)
        } else if (reentry === `unsubscribe`) {
          subscription.unsubscribe()
        } else if (reentry === `cleanup`) {
          void collection.cleanup()
        }
      }

      let thrown: unknown
      try {
        subscription.requestSnapshot({
          where: targetWhere,
          signal: controller.signal,
        })
      } catch (error) {
        thrown = error
      }

      if (reentry === `truncate`) {
        // The old acquisition is obsolete, but the queued replacement still
        // owns a loading interval until its setup and work finish.
        expect(statusAtTruncate).toBe(`loadingSubset`)
        expect(subscription.status).toBe(`loadingSubset`)
        expect(loads).toHaveLength(1)
      }
      const targetLoad = loads.find(({ where }) => where === targetWhere)!
      const peerLoad = loads.find(({ where }) => where === peerWhere)
      const targetWasReleased =
        reentry === `release-self` ||
        reentry === `truncate` ||
        reentry === `unsubscribe` ||
        reentry === `cleanup`
      const targetStarted = outcome !== `throw` && reentry !== `cleanup`

      if (outcome === `resolve`) pending.resolve()
      if (outcome === `reject`) pending.reject(failure)
      await flushPromises()

      const interaction =
        reentry === `abort-self`
          ? `starting:abort`
          : reentry === `truncate`
            ? `starting:truncate`
            : reentry === `release-self`
              ? `starting:release`
              : reentry === `release-peer`
                ? `active:release`
                : reentry === `unsubscribe`
                  ? `starting:unsubscribe`
                  : reentry === `cleanup`
                    ? `starting:cleanup`
                    : undefined
      if (interaction) {
        observePhysicalInteraction(
          interaction,
          reentry === `abort-self` ? `abort-only` : `retire`,
        )
      }

      expect(thrown).toBe(outcome === `throw` ? failure : undefined)
      expect(targetLoad.signal?.aborted).toBe(
        outcome === `throw` || targetWasReleased || reentry === `abort-self`,
      )
      expect(unloads.filter((options) => options === targetLoad)).toHaveLength(
        Number(targetStarted && targetWasReleased),
      )
      expect(unloads.filter((options) => options === peerLoad)).toHaveLength(
        Number(reentry === `release-peer`),
      )
      expect(errors).toEqual(
        (outcome === `throw` || outcome === `reject`) &&
          !targetWasReleased &&
          reentry !== `abort-self`
          ? [failure]
          : [],
      )
      expect(statuses).toEqual(
        reentry === `truncate` ||
          ((outcome === `resolve` || outcome === `reject`) &&
            !targetWasReleased)
          ? [`loadingSubset`, `ready`]
          : [],
      )
      if (reentry === `truncate`) {
        // A synchronous throw never acquired an owner to replay. Returned work
        // retains logical demand, even when its first transport later rejects.
        expect(loads).toHaveLength(outcome === `throw` ? 1 : 2)
        if (outcome !== `throw`) {
          expect(loads[1]).not.toBe(targetLoad)
          expect(loads[1]?.where).toBe(targetWhere)
          expect(loads[1]?.signal?.aborted).toBe(false)
        }
      }

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it.each(failureScenarios)(
    `keeps a $outcome failure primary during $reentry error delivery`,
    async ({ outcome, reentry }) => {
      const targetWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`target`),
      ])
      const peerWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`peer`)])
      const failure = new Error(`target load failed`)
      const pending = createDeferred<void>()
      const loads: Array<LoadSubsetOptions> = []
      const attempts: Array<{
        session: number
        options: LoadSubsetOptions
        result: `peer-return` | `throw` | `pending` | `replay-return`
      }> = []
      const unloads: Array<LoadSubsetOptions> = []
      const sourceCleanupSessions: Array<number> = []
      const errors: Array<unknown> = []
      const statuses: Array<string> = []
      const controller = new AbortController()
      let truncateCount = 0
      let truncate = () => {}
      let targetLoadCount = 0
      let subscription!: ReturnType<
        ReturnType<typeof createCollection<{ id: string }>>[`subscribeChanges`]
      >

      const collection = createCollection<{ id: string }>({
        id: `demand-failure-${outcome}-${reentry}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            truncate = () => {
              truncateCount++
              operations.begin()
              operations.truncate()
              operations.commit()
            }
            const { markReady } = operations
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (options.where === peerWhere) {
                  attempts.push({
                    session: 0,
                    options,
                    result: `peer-return`,
                  })
                  return true
                }
                targetLoadCount++
                if (targetLoadCount > 1) {
                  attempts.push({
                    session: 0,
                    options,
                    result: `replay-return`,
                  })
                  return true
                }
                if (outcome === `throw`) {
                  attempts.push({ session: 0, options, result: `throw` })
                  throw failure
                }
                attempts.push({ session: 0, options, result: `pending` })
                return pending.promise
              },
              unloadSubset: (options) => unloads.push(options),
              cleanup: () => sourceCleanupSessions.push(0),
            }
          },
        },
      })
      subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`status:change`, ({ status }) => statuses.push(status))
      subscription.on(`loadSubset:error`, ({ error }) => {
        errors.push(error)
        if (reentry === `abort-self`) {
          controller.abort()
        } else if (reentry === `truncate`) {
          truncate()
        } else if (reentry === `release-self`) {
          subscription.releaseSnapshot(targetWhere)
        } else if (reentry === `release-peer`) {
          subscription.releaseSnapshot(peerWhere)
        } else if (reentry === `unsubscribe`) {
          subscription.unsubscribe()
        } else if (reentry === `cleanup`) {
          void collection.cleanup()
        }
      })

      subscription.requestSnapshot({ where: peerWhere })
      let thrown: unknown
      try {
        subscription.requestSnapshot({
          where: targetWhere,
          signal: controller.signal,
        })
      } catch (error) {
        thrown = error
      }
      if (outcome === `reject`) {
        pending.reject(failure)
      }
      await flushPromises()

      const targetLoad = loads.find(({ where }) => where === targetWhere)!
      const peerLoad = loads.find(({ where }) => where === peerWhere)!
      const targetAttempts = attempts.filter(
        ({ options }) => options.where === targetWhere,
      )
      const peerAttempts = attempts.filter(
        ({ options }) => options.where === peerWhere,
      )
      const tearsDownTarget =
        reentry === `release-self` || reentry === `unsubscribe`

      expect.soft(thrown).toBe(outcome === `throw` ? failure : undefined)
      expect.soft(errors).toEqual([failure])
      expect.soft(subscription.lastError).toBe(failure)
      expect.soft(targetAttempts[0]?.options).toBe(targetLoad)
      expect.soft(targetAttempts[0]?.session).toBe(0)
      expect
        .soft(targetAttempts[0]?.result)
        .toBe(outcome === `throw` ? `throw` : `pending`)
      expect.soft(controller.signal.aborted).toBe(reentry === `abort-self`)
      expect.soft(truncateCount).toBe(Number(reentry === `truncate`))
      expect
        .soft(unloads.filter((options) => options === targetLoad))
        .toHaveLength(
          Number(
            outcome === `reject` && (tearsDownTarget || reentry === `truncate`),
          ),
        )
      expect
        .soft(unloads.filter((options) => options === peerLoad))
        .toHaveLength(
          Number(
            reentry === `release-peer` ||
              reentry === `unsubscribe` ||
              reentry === `truncate`,
          ),
        )
      expect
        .soft(statuses)
        .toEqual(
          reentry === `truncate`
            ? [`loadingSubset`, `ready`]
            : outcome === `reject`
              ? reentry === `unsubscribe`
                ? [`loadingSubset`]
                : [`loadingSubset`, `ready`]
              : [],
        )
      if (reentry === `abort-self`) {
        expect.soft(targetLoad.signal?.aborted).toBe(true)
        expect.soft(targetAttempts).toHaveLength(1)
        expect.soft(peerAttempts).toHaveLength(1)
      }
      const replacement = targetAttempts[1]?.options
      const peerReplacement = peerAttempts[1]?.options
      if (reentry === `truncate`) {
        expect.soft(targetLoad.signal?.aborted).toBe(true)
        // Error delivery may request replay, but it cannot turn a failed
        // synchronous start into an owned acquisition. Only the peer survives.
        expect.soft(targetAttempts).toHaveLength(outcome === `reject` ? 2 : 1)
        if (outcome === `reject`) {
          expect.soft(replacement).not.toBe(targetLoad)
          expect.soft(replacement?.where).toBe(targetWhere)
          expect.soft(targetAttempts[1]?.session).toBe(0)
          expect.soft(targetAttempts[1]?.result).toBe(`replay-return`)
        } else {
          expect.soft(replacement).toBeUndefined()
        }
        expect.soft(peerLoad.signal?.aborted).toBe(true)
        expect.soft(peerAttempts).toHaveLength(2)
        expect.soft(peerReplacement).not.toBe(peerLoad)
        expect.soft(peerReplacement?.where).toBe(peerWhere)
        expect.soft(peerAttempts[1]?.session).toBe(0)
        expect.soft(peerAttempts[1]?.result).toBe(`peer-return`)
        expect.soft(unloads).toHaveLength(outcome === `reject` ? 2 : 1)
      }
      if (reentry === `cleanup`) {
        expect.soft(collection.status).toBe(`cleaned-up`)
        expect.soft(peerLoad.signal?.aborted).toBe(true)
        expect.soft(targetLoad.signal?.aborted).toBe(true)
        expect.soft(subscription.status).toBe(`ready`)
      }

      subscription.unsubscribe()
      const replays = reentry === `truncate`
      expect
        .soft(targetAttempts)
        .toHaveLength(replays && outcome === `reject` ? 2 : 1)
      expect.soft(peerAttempts).toHaveLength(replays ? 2 : 1)
      expect
        .soft(unloads.filter((options) => options === targetLoad))
        .toHaveLength(Number(outcome === `reject` && reentry !== `cleanup`))
      expect
        .soft(unloads.filter((options) => options === peerLoad))
        .toHaveLength(Number(reentry !== `cleanup`))
      if (replacement) {
        expect
          .soft(unloads.filter((options) => options === replacement))
          .toHaveLength(Number(replays))
        expect.soft(replacement.signal?.aborted).toBe(true)
      }
      if (peerReplacement) {
        expect
          .soft(unloads.filter((options) => options === peerReplacement))
          .toHaveLength(Number(replays))
        expect.soft(peerReplacement.signal?.aborted).toBe(true)
      }
      const expectedUnloads =
        reentry === `cleanup`
          ? 0
          : (outcome === `reject` ? 2 : 1) * (replays ? 2 : 1)
      expect.soft(unloads).toHaveLength(expectedUnloads)
      expect.soft(peerLoad.signal?.aborted).toBe(true)
      expect.soft(targetLoad.signal?.aborted).toBe(true)
      const terminalAttempts = [...attempts]
      const terminalUnloads = [...unloads]
      const terminalStatuses = [...statuses]
      await collection.cleanup()
      expect.soft(sourceCleanupSessions).toEqual([0])
      expect.soft(collection.status).toBe(`cleaned-up`)
      expect.soft(errors).toEqual([failure])
      expect.soft(subscription.lastError).toBe(failure)
      expect.soft(attempts).toEqual(terminalAttempts)
      expect.soft(unloads).toEqual(terminalUnloads)
      expect.soft(statuses).toEqual(terminalStatuses)
      observedFailureDeliverySuffixes.add(`${outcome}:${reentry}`)
    },
  )

  it.each(releaseScenarios)(
    `retires logical ownership once for unload $outcome × $reentry`,
    async ({ outcome, reentry }) => {
      const targetWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`target`),
      ])
      const peerWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`peer`)])
      const releaseFailure = new Error(`target release failed`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<unknown> = []
      let allowRelease = outcome === `return`
      let runReentry = () => {}

      const collection = createCollection<{ id: string }>({
        id: `demand-release-${outcome}-${reentry}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (options === loads[1]) {
                  runReentry()
                  if (!allowRelease) throw releaseFailure
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.requestSnapshot({ where: peerWhere })
      subscription.requestSnapshot({ where: targetWhere })
      const peerLoad = loads[0]!
      const oldTargetLoad = loads[1]!
      runReentry = () => {
        runReentry = () => {}
        if (reentry === `reacquire-self`) {
          subscription.requestSnapshot({ where: targetWhere })
        } else if (reentry === `release-peer`) {
          subscription.releaseSnapshot(peerWhere)
        } else if (reentry === `unsubscribe`) {
          subscription.unsubscribe()
        }
      }

      let thrown: unknown
      try {
        subscription.releaseSnapshot(targetWhere)
      } catch (error) {
        thrown = error
      }
      observePhysicalInteraction(`active:release`, `retire`)
      if (reentry === `unsubscribe`) {
        observePhysicalInteraction(`active:unsubscribe`, `retire`)
      }

      expect(thrown).toBe(outcome === `throw` ? releaseFailure : undefined)
      expect(oldTargetLoad.signal?.aborted).toBe(true)
      expect(
        unloads.filter((options) => options === oldTargetLoad),
      ).toHaveLength(1)
      expect(unloads.filter((options) => options === peerLoad)).toHaveLength(
        Number(reentry === `release-peer` || reentry === `unsubscribe`),
      )
      expect(errors).toEqual(
        outcome === `throw` && reentry !== `unsubscribe`
          ? [releaseFailure]
          : [],
      )
      expect(subscription.lastError).toBe(
        outcome === `throw` ? releaseFailure : undefined,
      )

      allowRelease = true
      subscription.unsubscribe()
      expect(
        unloads.filter((options) => options === oldTargetLoad),
      ).toHaveLength(outcome === `throw` ? 2 : 1)
      const replacement = loads[2]
      expect(
        replacement === undefined
          ? []
          : unloads.filter((options) => options === replacement),
      ).toHaveLength(Number(reentry === `reacquire-self`))
      expect(unloads.filter((options) => options === peerLoad)).toHaveLength(1)
      if (outcome === `throw` && reentry === `unsubscribe`) {
        observePhysicalInteraction(`release-debt:unsubscribe`, `retry-debt`)
      }
      await collection.cleanup()
    },
  )

  it.each([`resolve`, `reject`] as const)(
    `retires a pending replay on cleanup before an obsolete %s`,
    async (outcome) => {
      type Row = { id: string; version: number }
      const replay = createDeferred<void>()
      const replayFailure = new Error(`obsolete replay failed`)
      let begin!: () => void
      let write!: (message: { type: `insert`; value: Row }) => void
      let commit!: () => void
      let truncate!: () => void
      let syncSession = 0
      let loadCount = 0
      const visible = new Map<string | number, Row>()
      const errors: Array<unknown> = []
      const statuses: Array<string> = []

      const collection = createCollection<Row>({
        id: `cleanup-pending-replay-${outcome}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            syncSession++
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            if (syncSession > 1) {
              begin()
              write({ type: `insert`, value: { id: `row`, version: 3 } })
              commit()
            }
            operations.markReady()
            return {
              loadSubset: () => {
                loadCount++
                begin()
                write({
                  type: `insert`,
                  value: { id: `row`, version: loadCount },
                })
                commit()
                return loadCount === 1 || syncSession > 1
                  ? true
                  : replay.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.on(`status:change`, ({ status }) => statuses.push(status))

      subscription.requestSnapshot()
      expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(subscription.status).toBe(`loadingSubset`)

      await collection.cleanup()
      collection.startSyncImmediate()
      expect(syncSession).toBe(2)
      expect([...visible.values()]).toEqual([{ id: `row`, version: 3 }])
      expect(subscription.status).toBe(`loadingSubset`)
      await flushPromises()
      expect(subscription.status).toBe(`ready`)

      if (outcome === `resolve`) replay.resolve()
      else replay.reject(replayFailure)
      await flushPromises()

      expect([...visible.values()]).toEqual([{ id: `row`, version: 3 }])
      expect(errors).toEqual([])
      expect(subscription.lastError).toBeUndefined()
      expect(statuses.at(-1)).toBe(`ready`)

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it(`reacquires surviving on-demand demand after collection restart`, async () => {
    type Row = { id: string; version: number }
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let syncSession = 0
    let loadCount = 0
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const visible = new Map<string | number, Row>()
    const collection = createCollection<Row>({
      id: `restart-surviving-demand`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          syncSession++
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              begin()
              write({
                type: `insert`,
                value: { id: `row`, version: loadCount },
              })
              commit()
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else {
            visible.set(change.key, {
              id: change.value.id,
              version: change.value.version,
            })
          }
        }
      },
      { includeInitialState: false },
    )
    subscription.requestSnapshot()
    expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])

    await collection.cleanup()
    collection.startSyncImmediate()
    expect(subscription.status).toBe(`loadingSubset`)
    expect(loads).toHaveLength(1)
    await flushPromises()

    expect(syncSession).toBe(2)
    expect(loads).toHaveLength(2)
    expect(unloads).toEqual([])
    expect([...visible.values()]).toEqual([{ id: `row`, version: 2 }])
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    expect(unloads).toEqual([loads[1]])
    await collection.cleanup()
  })

  it(`reacquires demand requested while the collection is cleaned up`, async () => {
    const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
    const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
    let syncSession = 0
    const loads: Array<{ session: number; options: LoadSubsetOptions }> = []
    const unloads: Array<{ session: number; options: LoadSubsetOptions }> = []
    const collection = createCollection<{ id: string }>({
      id: `request-while-cleaned-up`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          const session = syncSession++
          markReady()
          return {
            loadSubset: (options) => {
              loads.push({ session, options })
              return true
            },
            unloadSubset: (options) => unloads.push({ session, options }),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where: oldWhere })

    await collection.cleanup()
    subscription.requestSnapshot({ where: newWhere })
    collection.startSyncImmediate()
    await flushPromises()

    expect(loads.map(({ session }) => session)).toEqual([0, 1, 1])
    expect(loads.slice(1).map(({ options }) => options.where)).toEqual([
      oldWhere,
      newWhere,
    ])

    subscription.unsubscribe()
    expect(unloads.map(({ session }) => session)).toEqual([1, 1])
    expect(unloads.map(({ options }) => options.where)).toEqual([
      oldWhere,
      newWhere,
    ])
    await collection.cleanup()
  })

  it(`does not report a detached demand as physically settled`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const observed: Array<unknown> = []
    let loads = 0
    const collection = createCollection<{ id: string }>({
      id: `detached-demand-settlement`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              loads++
              return true
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    await collection.cleanup()
    subscription.requestSnapshot({
      where,
      onLoadSubsetResult: (result) => observed.push(result),
    })

    expect(loads).toBe(0)
    expect(observed).toEqual([expect.any(Promise)])

    collection.startSyncImmediate()
    await flushPromises()
    expect(loads).toBe(1)
    expect(observed).toEqual([expect.any(Promise)])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  acquisitionCase(
    [`starting:request`],
    `includes demand created by the synchronous restart status callback`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const demandForWhere = new Map<unknown, `old` | `new`>([
        [oldWhere, `old`],
        [newWhere, `new`],
      ])
      const loads: Array<{ session: number; demand: `old` | `new` }> = []
      const unloads: Array<{ session: number; demand: `old` | `new` }> = []
      let session = -1
      let requestOnRestart = false
      const collection = createCollection<{ id: string }>({
        id: `restart-status-reentry`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            session++
            const adapterSession = session
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown restart demand`)
                loads.push({ session: adapterSession, demand })
                return true
              },
              unloadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown restart demand`)
                unloads.push({ session: adapterSession, demand })
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`status:change`, ({ status }) => {
        if (!requestOnRestart || status !== `loadingSubset`) return
        requestOnRestart = false
        subscription.requestSnapshot({ where: newWhere })
        reach(`starting:request`)
      })
      subscription.requestSnapshot({ where: oldWhere })

      await collection.cleanup()
      requestOnRestart = true
      collection.startSyncImmediate()
      await flushPromises()

      expect(loads).toEqual([
        { session: 0, demand: `old` },
        { session: 1, demand: `old` },
        { session: 1, demand: `new` },
      ])
      expect(subscription.status).toBe(`ready`)

      subscription.unsubscribe()
      expect(unloads).toEqual([
        { session: 1, demand: `old` },
        { session: 1, demand: `new` },
      ])
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`starting:markReady`],
    `does not settle demand reentered before the restart loader is installed`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const demandForWhere = new Map<unknown, `old` | `new`>([
        [oldWhere, `old`],
        [newWhere, `new`],
      ])
      const loads: Array<{ session: number; demand: `old` | `new` }> = []
      const unloads: Array<{ session: number; demand: `old` | `new` }> = []
      const observed: Array<unknown> = []
      let session = -1
      let requestOnReady = false
      let subscription!: ReturnType<typeof collection.subscribeChanges>
      const collection = createCollection<{ id: string }>({
        id: `restart-ready-reentry`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            session++
            const adapterSession = session
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown ready demand`)
                loads.push({ session: adapterSession, demand })
                return true
              },
              unloadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown ready unload`)
                unloads.push({ session: adapterSession, demand })
              },
            }
          },
        },
      })
      subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const removeReadyListener = collection.on(`status:ready`, () => {
        if (!requestOnReady) return
        requestOnReady = false
        subscription.requestSnapshot({
          where: newWhere,
          onLoadSubsetResult: (result) => observed.push(result),
        })
        reach(`starting:markReady`)
      })
      subscription.requestSnapshot({ where: oldWhere })

      await collection.cleanup()
      requestOnReady = true
      collection.startSyncImmediate()
      await flushPromises()

      expect(loads).toEqual([
        { session: 0, demand: `old` },
        { session: 1, demand: `old` },
        { session: 1, demand: `new` },
      ])
      expect(observed).toEqual([expect.any(Promise)])
      expect(subscription.status).toBe(`ready`)

      removeReadyListener()
      subscription.unsubscribe()
      expect(unloads).toEqual([
        { session: 1, demand: `old` },
        { session: 1, demand: `new` },
      ])
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`unavailable:request`],
    `does not settle demand reentered before a failed restart installs a loader`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const syncFailure = new Error(`replacement sync failed`)
      const demandForWhere = new Map<unknown, `old` | `new`>([
        [oldWhere, `old`],
        [newWhere, `new`],
      ])
      const loads: Array<{ session: number; demand: `old` | `new` }> = []
      const unloads: Array<{ session: number; demand: `old` | `new` }> = []
      const observed: Array<unknown> = []
      let session = -1
      let requestOnError = false
      let subscription!: ReturnType<typeof collection.subscribeChanges>
      const collection = createCollection<{ id: string }>({
        id: `restart-error-reentry`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            session++
            const adapterSession = session
            if (session === 1) throw syncFailure
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown error demand`)
                loads.push({ session: adapterSession, demand })
                return true
              },
              unloadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown error unload`)
                unloads.push({ session: adapterSession, demand })
              },
            }
          },
        },
      })
      subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const removeErrorListener = collection.on(`status:error`, () => {
        if (!requestOnError) return
        requestOnError = false
        subscription.requestSnapshot({
          where: newWhere,
          onLoadSubsetResult: (result) => observed.push(result),
        })
        reach(`unavailable:request`)
      })
      subscription.requestSnapshot({ where: oldWhere })

      await collection.cleanup()
      requestOnError = true
      expect(() => collection.startSyncImmediate()).toThrow(syncFailure)
      expect(observed).toEqual([expect.any(Promise)])
      expect(collection.status).toBe(`error`)
      expect(loads).toEqual([{ session: 0, demand: `old` }])

      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()
      expect(loads).toEqual([
        { session: 0, demand: `old` },
        { session: 2, demand: `old` },
        { session: 2, demand: `new` },
      ])
      expect(subscription.status).toBe(`ready`)

      removeErrorListener()
      subscription.unsubscribe()
      expect(unloads).toEqual([
        { session: 2, demand: `old` },
        { session: 2, demand: `new` },
      ])
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`retiring:request`],
    `does not acquire through a retiring adapter cleanup callback`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const demandForWhere = new Map<unknown, `old` | `new`>([
        [oldWhere, `old`],
        [newWhere, `new`],
      ])
      const loads: Array<{ session: number; demand: `old` | `new` }> = []
      const unloads: Array<{ session: number; demand: `old` | `new` }> = []
      const observed: Array<unknown> = []
      let session = -1
      let requestDuringCleanup = false
      let subscription!: ReturnType<typeof collection.subscribeChanges>
      const collection = createCollection<{ id: string }>({
        id: `adapter-cleanup-reentry`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            session++
            const adapterSession = session
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown cleanup demand`)
                loads.push({ session: adapterSession, demand })
                return true
              },
              unloadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown cleanup unload`)
                unloads.push({ session: adapterSession, demand })
              },
              cleanup: () => {
                if (!requestDuringCleanup) return
                requestDuringCleanup = false
                subscription.requestSnapshot({
                  where: newWhere,
                  onLoadSubsetResult: (result) => observed.push(result),
                })
                reach(`retiring:request`)
                observeSourceSessionBoundary(`cleanup-callback-reentry`)
              },
            }
          },
        },
      })
      subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.requestSnapshot({ where: oldWhere })

      requestDuringCleanup = true
      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()

      expect(loads).toEqual([
        { session: 0, demand: `old` },
        { session: 1, demand: `old` },
        { session: 1, demand: `new` },
      ])
      expect(observed).toEqual([expect.any(Promise)])

      subscription.unsubscribe()
      expect(unloads).toEqual([
        { session: 1, demand: `old` },
        { session: 1, demand: `new` },
      ])
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`eager:request`],
    `does not release a physical subset acquisition in eager mode`,
    async (reach) => {
      let loads = 0
      let unloads = 0
      const collection = createCollection<{ id: string }>({
        id: `eager-subset-ownership`,
        getKey: ({ id }) => id,
        syncMode: `eager`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                return true
              },
              unloadSubset: () => {
                unloads++
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })

      subscription.requestSnapshot()
      reach(`eager:request`)
      subscription.unsubscribe()
      observePhysicalInteraction(`none:unsubscribe`, `no-acquisition`)

      expect(loads).toBe(0)
      expect(unloads).toBe(0)
      await collection.cleanup()
    },
  )

  it(`directly releases eager demand without a physical acquisition`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    let loads = 0
    let unloads = 0
    const collection = createCollection<{ id: string }>({
      id: `eager-direct-release`,
      getKey: ({ id }) => id,
      syncMode: `eager`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              loads++
              return true
            },
            unloadSubset: () => {
              unloads++
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    subscription.requestSnapshot({ where })
    subscription.releaseSnapshot(where)
    observePhysicalInteraction(`none:release`, `no-acquisition`)

    expect(loads).toBe(0)
    expect(unloads).toBe(0)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`truncates eager demand without creating or releasing a physical acquisition`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<{ id: string }>({
      id: `eager-truncate-without-acquisition`,
      getKey: ({ id }) => id,
      syncMode: `eager`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })

    begin()
    truncate()
    commit()
    await flushPromises()
    observePhysicalInteraction(`none:truncate`, `no-acquisition`)

    expect.soft(loads).toEqual([])
    expect.soft(unloads).toEqual([])

    subscription.unsubscribe()
    expect(unloads).toEqual([])
    await collection.cleanup()
  })

  acquisitionCase(
    [`on-demand:request`],
    `does not release a subset request aborted before adapter acquisition`,
    async (reach) => {
      const controller = new AbortController()
      controller.abort()
      let loads = 0
      let unloads = 0
      const errors: Array<unknown> = []
      const collection = createCollection<{ id: string }>({
        id: `pre-aborted-subset-ownership`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                return true
              },
              unloadSubset: () => {
                unloads++
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))

      subscription.requestSnapshot({ signal: controller.signal })
      await flushPromises()
      reach(`on-demand:request`)
      subscription.unsubscribe()
      observePhysicalInteraction(`none:unsubscribe`, `no-acquisition`)

      expect(loads).toBe(0)
      expect(unloads).toBe(0)
      expect(errors).toEqual([])
      await collection.cleanup()
    },
  )

  it(`directly releases pre-aborted demand without a physical acquisition`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const controller = new AbortController()
    controller.abort()
    let loads = 0
    let unloads = 0
    const errors: Array<unknown> = []
    const collection = createCollection<{ id: string }>({
      id: `pre-aborted-direct-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              loads++
              return true
            },
            unloadSubset: () => {
              unloads++
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))

    subscription.requestSnapshot({
      where,
      signal: controller.signal,
    })
    await flushPromises()
    subscription.releaseSnapshot(where)
    observePhysicalInteraction(`none:release`, `no-acquisition`)

    expect(loads).toBe(0)
    expect(unloads).toBe(0)
    expect(errors).toEqual([])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it.each([false, true])(
    `ignores a pre-aborted snapshot without changing an existing demand: %s`,
    async (existingDemand) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      let publications = 0
      let results = 0
      const collection = createCollection<{ id: string }>({
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: `insert`, value: { id: `row` } })
            commit()
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => publications++, {
        includeInitialState: false,
      })
      try {
        if (existingDemand) subscription.requestSnapshot({ where })
        const previousPublications = publications
        const previousLoads = [...loads]
        const controller = new AbortController()
        controller.abort()

        expect(
          subscription.requestSnapshot({
            where,
            signal: controller.signal,
            replaceExistingDemand: true,
            onLoadSubsetResult: () => results++,
          }),
        ).toBe(false)
        await flushPromises()
        expect(publications).toBe(previousPublications)
        expect(results).toBe(0)
        expect(loads).toEqual(previousLoads)
        expect(unloads).toEqual([])
        if (existingDemand) expect(loads[0]!.signal?.aborted).toBe(false)

        subscription.releaseSnapshot(where)
        expect(unloads).toEqual(previousLoads)
        subscription.unsubscribe()
        expect(unloads).toEqual(previousLoads)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`aborts detached demand without creating a physical acquisition`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const controller = new AbortController()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<{ id: string }>({
      id: `detached-abort-without-acquisition`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    await collection.cleanup()
    subscription.requestSnapshot({ where, signal: controller.signal })
    controller.abort()
    await flushPromises()
    observePhysicalInteraction(`none:abort`, `no-acquisition`)

    expect(loads).toEqual([])
    expect(unloads).toEqual([])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`keeps an aborted active acquisition until its owner retires`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const controller = new AbortController()
    const pending = createDeferred<void>()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<{ id: string }>({
      id: `active-abort-before-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return pending.promise
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    subscription.requestSnapshot({ where, signal: controller.signal })
    const acquisition = loads[0]!
    controller.abort()
    await flushPromises()
    observePhysicalInteraction(`active:abort`, `abort-only`)

    expect(loads).toEqual([acquisition])
    expect(acquisition.signal?.aborted).toBe(true)
    expect(unloads).toEqual([])

    pending.resolve()
    await flushPromises()
    subscription.unsubscribe()
    expect(unloads).toEqual([acquisition])
    await collection.cleanup()
  })

  acquisitionCase(
    [`on-demand:request`, `on-demand:markReady`],
    `acquires before and after ready once the on-demand loader is installed`,
    async (reach) => {
      const beforeReady = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`before`),
      ])
      const afterReady = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`after`),
      ])
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      let markReady!: () => void
      const collection = createCollection<{ id: string }>({
        id: `installed-loader-before-ready`,
        getKey: ({ id }) => id,
        startSync: false,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            markReady = operations.markReady
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      collection.startSyncImmediate()
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const removeReadyListener = collection.on(`status:ready`, () => {
        subscription.requestSnapshot({ where: afterReady })
        reach(`on-demand:markReady`)
      })

      subscription.requestSnapshot({ where: beforeReady })
      reach(`on-demand:request`)
      expect(collection.status).toBe(`loading`)
      expect(loads.map(({ where }) => where)).toEqual([beforeReady])

      markReady()
      await flushPromises()
      expect(loads.map(({ where }) => where)).toEqual([beforeReady, afterReady])

      removeReadyListener()
      subscription.unsubscribe()
      expect(unloads).toEqual(loads)
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`deferred:request`, `deferred:resume`],
    `owns deferred-start acquisition only when it reaches the adapter`,
    async (reach) => {
      for (const action of [`resume`, `release-before-resume`] as const) {
        const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
        const loads: Array<LoadSubsetOptions> = []
        const unloads: Array<LoadSubsetOptions> = []
        const collection = createCollection<{ id: string }>({
          id: `deferred-start-${action}`,
          getKey: ({ id }) => id,
          startSync: false,
          syncMode: `on-demand`,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {
                loadSubset: (options) => {
                  loads.push(options)
                  return true
                },
                unloadSubset: (options) => unloads.push(options),
              }
            },
          },
        })
        expect(collection._deferSyncStart()).toBe(true)
        const subscription = collection.subscribeChanges(() => {}, {
          includeInitialState: false,
        })
        subscription.requestSnapshot({ where })
        reach(`deferred:request`)
        expect(loads).toEqual([])

        if (action === `release-before-resume`) {
          subscription.releaseSnapshot(where)
        }
        collection._resumeSyncStart()
        await flushPromises()
        if (action === `resume`) reach(`deferred:resume`)

        expect(loads).toHaveLength(action === `resume` ? 1 : 0)
        subscription.unsubscribe()
        expect(unloads).toHaveLength(action === `resume` ? 1 : 0)
        if (action === `resume`) expect(unloads).toEqual(loads)
        await collection.cleanup()
      }
    },
  )

  it.each([`cleanup`, `release`, `unsubscribe`, `resume`] as const)(
    `settles queued demand according to whether it starts: %s`,
    async (action) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const observed: Array<true | Promise<void>> = []
      let loads = 0
      const collection = createCollection<{ id: string }>({
        id: `deferred-start-cleanup-before-resume`,
        getKey: ({ id }) => id,
        startSync: false,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                return true
              },
            }
          },
        },
      })
      expect(collection._deferSyncStart()).toBe(true)
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.requestSnapshot({
        where,
        onLoadSubsetResult: (result) => observed.push(result),
      })

      if (action === `cleanup`) await collection.cleanup()
      else if (action === `release`) subscription.releaseSnapshot(where)
      else if (action === `unsubscribe`) subscription.unsubscribe()
      else collection._resumeSyncStart()
      await flushPromises()
      if (action === `cleanup`) {
        observePhysicalInteraction(`none:cleanup`, `no-acquisition`)
      }

      expect(loads).toBe(action === `resume` ? 1 : 0)
      expect(observed).toHaveLength(1)
      const deferredResult = observed[0]
      expect(deferredResult).toBeInstanceOf(Promise)
      if (!(deferredResult instanceof Promise)) {
        throw new Error(`deferred acquisition did not return a promise`)
      }
      if (action === `resume`)
        await expect(deferredResult).resolves.toBeUndefined()
      else
        await expect(deferredResult).rejects.toMatchObject({
          name: `AbortError`,
        })

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`starting:syncReturn`],
    `does not settle ready-callback demand when on-demand sync returns no loader`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const loads: Array<LoadSubsetOptions> = []
      const observed: Array<unknown> = []
      let session = 0
      let requestOnReady = false
      let subscription!: ReturnType<typeof collection.subscribeChanges>
      const collection = createCollection<{ id: string }>({
        id: `ready-before-invalid-on-demand-return`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            const ownSession = session++
            markReady()
            if (ownSession === 1) return
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
      subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const removeReadyListener = collection.on(`status:ready`, () => {
        if (!requestOnReady) return
        requestOnReady = false
        subscription.requestSnapshot({
          where: newWhere,
          onLoadSubsetResult: (result) => observed.push(result),
        })
      })
      subscription.requestSnapshot({ where: oldWhere })

      await collection.cleanup()
      requestOnReady = true
      expect(() => collection.startSyncImmediate()).toThrow(
        /did not return a loadSubset handler/,
      )
      reach(`starting:syncReturn`)

      expect(observed).toEqual([expect.any(Promise)])
      expect(collection.status).toBe(`error`)
      expect(loads.map(({ where }) => where)).toEqual([oldWhere])

      removeReadyListener()
      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it(`retires resources returned after ready-callback cleanup invalidates sync`, async () => {
    const cleanupSessions: Array<number> = []
    let session = 0
    let cleanOnReady = false
    const collection = createCollection<{ id: string }>({
      id: `obsolete-sync-return`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          const ownSession = session++
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {},
            cleanup: () => cleanupSessions.push(ownSession),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const removeReadyListener = collection.on(`status:ready`, () => {
      if (!cleanOnReady) return
      cleanOnReady = false
      void collection.cleanup()
    })

    await collection.cleanup()
    cleanOnReady = true
    collection.startSyncImmediate()
    observeSourceSessionBoundary(`obsolete-resource-return`)

    expect(collection.status).toBe(`cleaned-up`)
    expect(cleanupSessions).toEqual([0, 1])

    removeReadyListener()
    subscription.unsubscribe()
    await collection.cleanup()
  })

  it.each(
    ([false, true] as const).flatMap((restart) =>
      (
        [`loading`, `ready`, `adapter-throw`, `ready-effect-throw`] as const
      ).map((entry) => ({ restart, entry })),
    ),
  )(
    `retires startup at $entry with nested restart=$restart`,
    async ({ entry, restart }) => {
      const failure = new Error(`obsolete startup failed`)
      const cleanups: Array<number> = []
      const loads: Array<number> = []
      const unloads: Array<number> = []
      let session = -1
      let retire = false
      const collection = createCollection<{ id: string }>({
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            const ownSession = ++session
            markReady()
            if (ownSession === 1 && entry === `adapter-throw`) throw failure
            return {
              loadSubset: () => {
                loads.push(ownSession)
                return true
              },
              unloadSubset: () => unloads.push(ownSession),
              cleanup: () => cleanups.push(ownSession),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      let removeListener = () => {}
      try {
        await collection.cleanup()
        const retireSession = () => {
          if (!retire) return
          retire = false
          void collection.cleanup()
          if (restart) collection.startSyncImmediate()
          if (entry === `ready-effect-throw`) throw failure
        }
        removeListener =
          entry === `ready-effect-throw`
            ? collection.onFirstReady(retireSession)
            : collection.on(
                entry === `loading` ? `status:loading` : `status:ready`,
                retireSession,
              )
        retire = true
        if (entry === `adapter-throw` || entry === `ready-effect-throw`) {
          expect(() => collection.startSyncImmediate()).toThrow(failure)
        } else {
          collection.startSyncImmediate()
        }
        await flushPromises()

        expect(collection.status).toBe(restart ? `ready` : `cleaned-up`)
        const returnsObsoleteCleanup =
          entry === `ready` || entry === `ready-effect-throw`
        expect(cleanups).toEqual(returnsObsoleteCleanup ? [0, 1] : [0])
        expect(session).toBe(
          entry === `loading` ? (restart ? 1 : 0) : restart ? 2 : 1,
        )

        if (restart) {
          subscription.requestSnapshot({
            where: new Func(`eq`, [new PropRef([`id`]), new Value(`row`)]),
          })
          expect(loads).toEqual([session])
          subscription.unsubscribe()
          expect(unloads).toEqual([session])
        } else {
          expect(loads).toEqual([])
          expect(unloads).toEqual([])
        }
      } finally {
        removeListener()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  acquisitionCase(
    [`starting:markError`, `unavailable:markReady`],
    `retains demand requested during initial error for same-session recovery`,
    async (reach) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const loads: Array<LoadSubsetOptions> = []
      const observed: Array<unknown> = []
      let syncSession = 0
      let recover!: () => void
      let subscription!: ReturnType<typeof collection.subscribeChanges>
      const collection = createCollection<{ id: string }>({
        id: `sync-entry-error-ready-recovery`,
        getKey: ({ id }) => id,
        startSync: false,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markError, markReady }) => {
            if (syncSession++ === 0) {
              markReady()
              return {
                loadSubset: (options) => {
                  loads.push(options)
                  return true
                },
                unloadSubset: () => {},
              }
            }
            recover = markReady
            markError(new Error(`initial sync failed`))
            reach(`starting:markError`)
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
      subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      await collection.cleanup()
      const removeErrorListener = collection.on(`status:error`, () => {
        subscription.requestSnapshot({
          where,
          onLoadSubsetResult: (result) => observed.push(result),
        })
      })

      collection.startSyncImmediate()
      await flushPromises()
      expect.soft(collection.status).toBe(`error`)
      expect.soft(loads).toEqual([])
      expect.soft(observed).toEqual([expect.any(Promise)])

      recover()
      reach(`unavailable:markReady`)
      await flushPromises()

      expect(collection.status).toBe(`ready`)
      expect(loads.map(({ where: loadedWhere }) => loadedWhere)).toEqual([
        where,
      ])
      expect(observed).toEqual([expect.any(Promise)])
      await expect(observed[0]).resolves.toBeUndefined()

      removeErrorListener()
      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it.each(
    ([`error`, `cleaned-up`] as const).flatMap((unavailable) =>
      (
        [
          `return`,
          `resolve`,
          `reject`,
          `throw`,
          `release`,
          `unsubscribe`,
          `cleanup`,
          `abort`,
        ] as const
      ).flatMap((outcome) =>
        (outcome === `release` ||
        outcome === `unsubscribe` ||
        outcome === `cleanup` ||
        outcome === `abort`
          ? ([`before`, `during`] as const)
          : ([`during`] as const)
        ).flatMap((phase) =>
          // Ordered snapshots do not accept an external AbortSignal.
          (outcome === `abort`
            ? ([`snapshot`] as const)
            : ([`snapshot`, `limited`] as const)
          ).map((entry) => ({ unavailable, outcome, phase, entry })),
        ),
      ),
    ),
  )(
    `observes unavailable demand synchronously: $entry / $unavailable / $outcome / $phase`,
    async ({ unavailable, outcome, phase, entry }) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const transport = createDeferred<void>()
      const failure = new Error(`recovery acquisition failed`)
      const signal = new AbortController()
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const rows = new Map<string | number, { id: string }>()
      let operations!: Parameters<SyncConfig<{ id: string }>[`sync`]>[0]
      const collection = createCollection<{ id: string }>({
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (next) => {
            operations = next
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (outcome === `throw`) throw failure
                operations.begin()
                operations.write({ type: `insert`, value: { id: `row` } })
                operations.commit()
                return outcome === `return` ? true : transport.promise
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) rows.delete(change.key)
            else rows.set(change.key, change.value)
          }
        },
        { includeInitialState: false },
      )
      let result: true | Promise<void> | undefined
      let release: (() => void) | undefined
      const settlements: Array<unknown> = []
      const visibleOnSuccess: Array<Array<string>> = []
      let callbacks = 0
      try {
        if (entry === `limited`) {
          subscription.setOrderByIndex(
            collection.createIndex((row) => row.id, { indexType: BTreeIndex }),
          )
        }
        if (unavailable === `error`)
          operations.markError(new Error(`initial error`))
        else await collection.cleanup()
        const onLoadSubsetResult = (
          value: true | Promise<void>,
          _options: LoadSubsetOptions,
          releaseDemand?: () => void,
        ) => {
          callbacks++
          result = value
          release = releaseDemand
          if (value instanceof Promise)
            void value.then(
              () => {
                visibleOnSuccess.push([...rows.values()].map(({ id }) => id))
                settlements.push(`success`)
              },
              (error: unknown) => settlements.push(error),
            )
        }
        if (entry === `snapshot`) {
          subscription.requestSnapshot({
            where,
            signal: signal.signal,
            onLoadSubsetResult,
          })
        } else {
          subscription.requestLimitedSnapshot({
            orderBy: [
              {
                expression: new PropRef([`id`]),
                compareOptions: { direction: `asc`, nulls: `first` },
              },
            ],
            limit: 1,
            onLoadSubsetResult,
          })
        }
        // Production callers copy the result as soon as requestSnapshot returns.
        expect(callbacks).toBe(1)
        expect(result).toBeInstanceOf(Promise)
        await flushPromises()
        expect(settlements).toEqual([])
        expect(loads).toEqual([])
        const recover = () => {
          if (unavailable === `cleaned-up`) collection.startSyncImmediate()
          operations.markReady()
        }
        if (phase === `during`) {
          recover()
          await flushPromises()
          expect(loads).toHaveLength(1)
          if (outcome !== `return` && outcome !== `throw`) {
            expect(settlements).toEqual([])
            expect([...rows.values()]).toEqual([])
          }
        }
        if (outcome === `release`) release!()
        else if (outcome === `unsubscribe`) subscription.unsubscribe()
        else if (outcome === `cleanup`) await collection.cleanup()
        else if (outcome === `abort`) signal.abort()
        else if (outcome === `reject`) transport.reject(failure)
        else if (outcome === `resolve`) transport.resolve()
        await flushPromises()
        if (outcome === `return` || outcome === `resolve`) {
          expect(settlements).toEqual([`success`])
          expect(visibleOnSuccess).toEqual([[`row`]])
          expect([...rows.values()].map(({ id }) => id)).toEqual([`row`])
        } else if (outcome === `throw` || outcome === `reject`) {
          expect(settlements).toHaveLength(1)
          expect(settlements[0]).toBe(failure)
          expect([...rows.values()]).toEqual([])
        } else {
          expect(settlements).toEqual([
            expect.objectContaining({ name: `AbortError` }),
          ])
          expect(unloads).toEqual(
            phase === `during` &&
              (outcome === `release` || outcome === `unsubscribe`)
              ? loads
              : [],
          )
          if (phase === `before` && outcome !== `cleanup`) {
            recover()
            await flushPromises()
            expect(loads).toEqual([])
          }
          if (outcome === `cleanup`) {
            // Cleanup ends this wait, not the surviving subscription's demand.
            collection.startSyncImmediate()
            operations.markReady()
            await flushPromises()
            expect(loads).toHaveLength(phase === `before` ? 1 : 2)
          }
          // Non-cooperative late settlement cannot rewrite the observed outcome.
          transport.resolve()
          await flushPromises()
          expect(settlements).toEqual([
            expect.objectContaining({ name: `AbortError` }),
          ])
        }
        expect(callbacks).toBe(1)
      } finally {
        transport.resolve()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`re-enables an installed loader after same-session initial recovery`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const loads: Array<LoadSubsetOptions> = []
    let markError!: (error: unknown) => void
    let markReady!: () => void
    const collection = createCollection<{ id: string }>({
      id: `installed-loader-error-ready-recovery`,
      getKey: ({ id }) => id,
      startSync: false,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          markError = operations.markError
          markReady = operations.markReady
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
    collection.startSyncImmediate()
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    markError(new Error(`initial sync failed`))
    markReady()
    subscription.requestSnapshot({ where })

    expect(collection.status).toBe(`ready`)
    expect(loads.map(({ where: loadedWhere }) => loadedWhere)).toEqual([where])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`releases unavailable demand without creating a physical acquisition`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    let markError!: (error: unknown) => void
    let markReady!: () => void
    const collection = createCollection<{ id: string }>({
      id: `release-unavailable-demand`,
      getKey: ({ id }) => id,
      startSync: false,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          markError = operations.markError
          markReady = operations.markReady
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    collection.startSyncImmediate()
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    markError(new Error(`initial sync failed`))
    subscription.requestSnapshot({ where })
    subscription.releaseSnapshot(where)
    markReady()
    await flushPromises()

    expect(loads).toHaveLength(0)
    expect(unloads).toHaveLength(0)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  acquisitionCase(
    [`on-demand:markError`],
    `defers demand while an installed loader is in initial error`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const loads: Array<LoadSubsetOptions> = []
      let markError!: (error: unknown) => void
      let markReady!: () => void
      const collection = createCollection<{ id: string }>({
        id: `installed-loader-initial-error`,
        getKey: ({ id }) => id,
        startSync: false,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            markError = operations.markError
            markReady = operations.markReady
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
      collection.startSyncImmediate()
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.requestSnapshot({ where: oldWhere })
      const removeErrorListener = collection.on(`status:error`, () => {
        subscription.requestSnapshot({ where: newWhere })
        reach(`on-demand:markError`)
      })

      markError(new Error(`initial sync failed`))

      await flushPromises()
      expect.soft(collection.status).toBe(`error`)
      expect.soft(loads.map(({ where }) => where)).toEqual([oldWhere])

      markReady()
      await flushPromises()
      expect(loads.map(({ where }) => where)).toEqual([oldWhere, newWhere])

      removeErrorListener()
      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it.each(
    ([`loading`, `ready`] as const).flatMap((phase) =>
      ([`cleanup`, `release`, `unsubscribe`] as const).map((action) => ({
        phase,
        action,
      })),
    ),
  )(
    `cancels queued acquisition during $phase via $action`,
    async ({ phase, action }) => {
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      let cancelOnEntry = false
      const observed: Array<true | Promise<void>> = []
      const collection = createCollection<{ id: string }>({
        id: `deferred-resume-cleanup`,
        getKey: ({ id }) => id,
        startSync: false,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      expect(collection._deferSyncStart()).toBe(true)
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const removeReadyListener = collection.on(`status:${phase}`, () => {
        if (!cancelOnEntry) return
        cancelOnEntry = false
        if (action === `cleanup`) void collection.cleanup()
        else if (action === `release`) subscription.releaseSnapshot(where)
        else subscription.unsubscribe()
      })
      subscription.requestSnapshot({
        where,
        onLoadSubsetResult: (result) => observed.push(result),
      })

      try {
        cancelOnEntry = true
        collection._resumeSyncStart()
        await flushPromises()

        expect(collection.status).toBe(
          action === `cleanup` ? `cleaned-up` : `ready`,
        )
        expect(loads).toHaveLength(0)
        expect(unloads).toHaveLength(0)
        expect(observed).toHaveLength(1)
        await expect(observed[0]).rejects.toMatchObject({ name: `AbortError` })
      } finally {
        removeReadyListener()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`keeps an eager subscription ready after collection restart`, async () => {
    const collection = createCollection<{ id: string }>({
      id: `eager-subscription-restart`,
      getKey: ({ id }) => id,
      syncMode: `eager`,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot()

    await collection.cleanup()
    collection.startSyncImmediate()
    await flushPromises()

    expect(collection.status).toBe(`ready`)
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`retires restart loading when the replacement sync fails`, async () => {
    const syncFailure = new Error(`replacement sync failed`)
    let session = 0
    const collection = createCollection<{ id: string }>({
      id: `failed-sync-restart`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          if (session++ > 0) throw syncFailure
          markReady()
          return { loadSubset: () => true }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot()

    await collection.cleanup()
    expect(() => collection.startSyncImmediate()).toThrow(syncFailure)
    await flushPromises()

    expect(collection.status).toBe(`error`)
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`retires failed physical release with its source session cleanup`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const releaseFailure = new Error(`release failed`)
    let unloads = 0
    let sourceCleanups = 0
    const collection = createCollection<{ id: string }>({
      id: `cleanup-release-debt`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {
              unloads++
              if (unloads === 1) throw releaseFailure
            },
            cleanup: () => {
              sourceCleanups++
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })
    expect(() => subscription.releaseSnapshot(where)).toThrow(releaseFailure)

    await collection.cleanup()
    expect(unloads).toBe(1)
    expect(sourceCleanups).toBe(1)
    observeSourceSessionBoundary(`active-cleanup`)

    await collection.cleanup()
    expect(unloads).toBe(1)
    expect(sourceCleanups).toBe(1)
    observePhysicalInteraction(`release-debt:cleanup`, `discard-debt`)
    subscription.unsubscribe()
  })

  it.each(
    ([`return`, `throw`] as const).flatMap((outcome) =>
      [false, true].map((releaseSelf) => ({ outcome, releaseSelf })),
    ),
  )(
    `retires only the acquired lease for aborted replay with unload=$outcome, releaseSelf=$releaseSelf`,
    async ({ outcome, releaseSelf }) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const controller = new AbortController()
      const failure = new Error(`release failed`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<unknown> = []
      let releaseOwner = () => {}
      let operations!: Parameters<SyncConfig<{ id: string }, string>[`sync`]>[0]
      const collection = createCollection<{ id: string }, string>({
        id: `aborted-replay-release`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (nextOperations) => {
            operations = nextOperations
            operations.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (unloads.length === 1) {
                  if (releaseSelf) releaseOwner()
                  if (outcome === `throw`) throw failure
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      releaseOwner = () => subscription.releaseSnapshot(where)
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      try {
        subscription.requestSnapshot({ where, signal: controller.signal })
        controller.abort()
        operations.begin()
        operations.truncate()
        const receipt = operations.commit()
        if (receipt !== true) await receipt
        await flushPromises()

        expect(loads).toHaveLength(1)
        expect(unloads).toHaveLength(1)
        expect(unloads[0]).toBe(loads[0])
        expect(loads[0]!.signal!.aborted).toBe(true)
        expect(subscription.status).toBe(`ready`)
        expect(errors).toHaveLength(outcome === `throw` ? 1 : 0)
        if (outcome === `throw`) expect(errors[0]).toBe(failure)

        releaseOwner()
        expect(unloads).toHaveLength(1)
        subscription.unsubscribe()
        expect(unloads).toHaveLength(outcome === `throw` ? 2 : 1)
        for (const options of unloads) expect(options).toBe(loads[0])
        expect(loads).toHaveLength(1)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`adapter`, `error-listener`] as const).flatMap((reentry) =>
      [1, 2].map((failures) => ({ reentry, failures })),
    ),
  )(
    `retries the exact failed release after $reentry reentry with $failures failures`,
    async ({ reentry, failures }) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const failure = new Error(`physical release failed`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<Error> = []
      const nestedFailures: Array<unknown> = []
      let releaseOwner = () => {}
      const collection = createCollection<{ id: string }>({
        id: `release-reentry-${reentry}-${failures}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (unloads.length === 1 && reentry === `adapter`) {
                  releaseOwner()
                }
                if (unloads.length <= failures) throw failure
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      releaseOwner = () => {
        try {
          subscription.unsubscribe()
        } catch (error) {
          nestedFailures.push(error)
        }
      }
      subscription.on(`loadSubset:error`, ({ error }) => {
        errors.push(error)
        if (errors.length === 1 && reentry === `error-listener`) releaseOwner()
      })
      try {
        subscription.requestSnapshot({ where })
        expect(() => subscription.releaseSnapshot(where)).toThrow(failure)
        // Adapter reentry is still inside unload and cannot retry it. Error
        // delivery is after unload throws: teardown must see a retryable lease.
        const initialAttempts = reentry === `adapter` ? 1 : 2
        expect(unloads).toHaveLength(initialAttempts)
        expect(collection.subscriberCount).toBe(0)
        if (reentry === `error-listener`) expect(errors[0]).toBe(failure)
        expect(nestedFailures).toEqual(
          reentry === `error-listener` && failures === 2 ? [failure] : [],
        )
        if (unloads.length <= failures) {
          if (unloads.length < failures) {
            expect(() => subscription.unsubscribe()).toThrow(failure)
          }
          subscription.unsubscribe()
        }
        expect(unloads).toHaveLength(failures + 1)
        subscription.unsubscribe()
        expect(unloads).toHaveLength(failures + 1)
        expect(loads).toHaveLength(1)
        for (const options of unloads) expect(options).toBe(loads[0])
      } finally {
        await collection.cleanup()
        subscription.unsubscribe()
      }
    },
  )

  it(`keeps failed physical release debt out of truncate replay`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const releaseFailure = new Error(`release failed`)
    let unloads = 0
    let operations!: Parameters<SyncConfig<{ id: string }, string>[`sync`]>[0]
    const collection = createCollection<{ id: string }, string>({
      id: `truncate-release-debt`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (nextOperations) => {
          operations = nextOperations
          operations.markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {
              unloads++
              if (unloads === 1) throw releaseFailure
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })
    expect(() => subscription.releaseSnapshot(where)).toThrow(releaseFailure)

    operations.begin()
    operations.truncate()
    const receipt = operations.commit()
    if (receipt !== true) await receipt
    expect(unloads).toBe(1)

    subscription.unsubscribe()
    expect(unloads).toBe(2)
    observePhysicalInteraction(`release-debt:truncate`, `preserve-debt`)
    await collection.cleanup()
  })

  it(`does not retry cleanup debt through a replacement adapter session`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    let syncSession = 0
    const unloadSessions: Array<number> = []
    const releaseFailure = new Error(`old session release failed`)
    const collection = createCollection<{ id: string }>({
      id: `cleanup-debt-session`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          const session = syncSession++
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {
              unloadSessions.push(session)
              if (session === 0) throw releaseFailure
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })
    expect(() => subscription.releaseSnapshot(where)).toThrow(releaseFailure)

    await collection.cleanup()
    collection.startSyncImmediate()
    await flushPromises()
    subscription.unsubscribe()

    expect(unloadSessions).toEqual([0])
    await collection.cleanup()
  })

  it.each(restartScenarios)(
    `keeps restart ownership aligned for $outcome × $reentry`,
    async ({ outcome, reentry }) => {
      type DemandName = `target` | `peer`
      const targetWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`target`),
      ])
      const peerWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`peer`)])
      const demandForWhere = new Map<unknown, DemandName>([
        [targetWhere, `target`],
        [peerWhere, `peer`],
      ])
      const failure = new Error(`restart acquisition failed`)
      const pending = createDeferred<void>()
      void pending.promise.catch(() => {})
      const loads: Array<{ session: number; demand: DemandName }> = []
      const unloads: Array<{ session: number; demand: DemandName }> = []
      const sourceCleanups: Array<number> = []
      const errors: Array<unknown> = []
      let session = -1
      let ranReentry = false
      let subscription!: ReturnType<
        ReturnType<typeof createCollection<{ id: string }>>[`subscribeChanges`]
      >

      const collection = createCollection<{ id: string }>({
        id: `restart-${outcome}-${reentry}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            session++
            const adapterSession = session
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown restart demand`)
                loads.push({ session: adapterSession, demand })
                if (adapterSession === 0 || demand === `peer`) return true
                if (!ranReentry) {
                  ranReentry = true
                  if (reentry === `release-self`) {
                    subscription.releaseSnapshot(targetWhere)
                  } else if (reentry === `release-peer`) {
                    subscription.releaseSnapshot(peerWhere)
                  } else if (reentry === `unsubscribe`) {
                    subscription.unsubscribe()
                  } else if (reentry === `cleanup`) {
                    void collection.cleanup()
                  }
                }
                if (outcome === `throw`) throw failure
                if (outcome === `return`) return true
                return pending.promise
              },
              unloadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown restart demand`)
                unloads.push({ session: adapterSession, demand })
              },
              cleanup: () => sourceCleanups.push(adapterSession),
            }
          },
        },
      })
      subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.requestSnapshot({ where: targetWhere })
      subscription.requestSnapshot({ where: peerWhere })

      await collection.cleanup()
      expect(sourceCleanups).toEqual([0])
      observePhysicalInteraction(`active:cleanup`, `retire`)
      collection.startSyncImmediate()
      observeSourceSessionBoundary(`restart-installed`)
      await flushPromises()
      if (outcome === `resolve`) pending.resolve()
      if (outcome === `reject`) pending.reject(failure)
      await flushPromises()

      const targetEstablished = outcome !== `throw` && reentry !== `cleanup`
      const targetSurvives = reentry === `none` || reentry === `release-peer`
      const peerStarts =
        reentry !== `release-peer` &&
        reentry !== `unsubscribe` &&
        reentry !== `cleanup`
      expect(loads).toEqual([
        { session: 0, demand: `target` },
        { session: 0, demand: `peer` },
        { session: 1, demand: `target` },
        ...(peerStarts ? [{ session: 1, demand: `peer` as const }] : []),
      ])
      expect(errors).toEqual(
        (outcome === `throw` || outcome === `reject`) && targetSurvives
          ? [failure]
          : [],
      )

      if (reentry !== `unsubscribe`) subscription.unsubscribe()
      expect(unloads).toEqual([
        ...(targetEstablished && !targetSurvives
          ? [{ session: 1, demand: `target` as const }]
          : []),
        ...(targetEstablished && targetSurvives
          ? [{ session: 1, demand: `target` as const }]
          : []),
        ...(peerStarts ? [{ session: 1, demand: `peer` as const }] : []),
      ])
      await collection.cleanup()
      expect(sourceCleanups).toEqual([0, 1])
    },
  )

  it.each(
    ([`initial`, `replay`] as const).flatMap((origin) =>
      ([`resolve`, `reject`] as const).flatMap((oldOutcome) =>
        ([`old-first`, `current-first`] as const).map((order) => ({
          origin,
          oldOutcome,
          order,
        })),
      ),
    ),
  )(
    `separates publication from readiness for pending $origin work, $oldOutcome, $order`,
    async ({ origin, oldOutcome, order }) => {
      type Row = { id: string; version: number }
      const where = {
        a: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
        b: new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
      }
      const loads: Array<{
        options: LoadSubsetOptions
        deferred: ReturnType<typeof createDeferred<void>>
      }> = []
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<unknown> = []
      const visible = new Map<string | number, Row>()
      let emptyBatches = 0
      let replacementChanges = 0
      let operations!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
      const collection = createCollection<Row, string>({
        id: `publication-readiness-boundary`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (nextOperations) => {
            operations = nextOperations
            operations.markReady()
            return {
              loadSubset: (options) => {
                const deferred = createDeferred<void>()
                void deferred.promise.catch(() => {})
                loads.push({ options, deferred })
                return deferred.promise
              },
              unloadSubset: (options) => {
                unloads.push(options)
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          if (changes.length === 0) emptyBatches++
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
              if (change.value.id === `b` && change.value.version === 2)
                replacementChanges++
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      const write = async (id: string, version: number) => {
        operations.begin()
        operations.write({
          type: collection.has(id) ? `update` : `insert`,
          value: { id, version },
        })
        const receipt = operations.commit()
        if (receipt !== true) await receipt
      }
      const truncate = async () => {
        operations.begin()
        operations.truncate()
        const receipt = operations.commit()
        if (receipt !== true) await receipt
        await flushPromises()
      }
      const settle = async (
        attempt: (typeof loads)[number],
        outcome: `resolve` | `reject`,
        id = `b`,
      ) => {
        // The source cannot cancel transport promptly, but must suppress its
        // canceled writes. Late settlement does not install an obsolete row.
        if (outcome === `resolve`) {
          if (!attempt.options.signal?.aborted) await write(id, 2)
          attempt.deferred.resolve()
        } else attempt.deferred.reject(new Error(`obsolete source failed`))
        await flushPromises()
      }
      try {
        subscription.requestSnapshot({ where: where.b })
        await write(`b`, 0)
        if (origin === `replay`) {
          loads[0]!.deferred.resolve()
          await flushPromises()
          await truncate()
        }
        const old = loads.at(-1)!
        await truncate()
        const current = loads.at(-1)!
        expect(old.options.signal?.aborted).toBe(true)
        expect([...visible.values()]).toEqual([{ id: `b`, version: 0 }])
        if (order === `old-first`) {
          await settle(old, oldOutcome)
          expect(subscription.status).toBe(`loadingSubset`)
          expect([...visible.values()]).toEqual([{ id: `b`, version: 0 }])
        }
        await settle(current, `resolve`)
        const privateReplay = origin === `replay` && order === `current-first`
        expect([...visible.values()]).toEqual([
          { id: `b`, version: privateReplay ? 0 : 2 },
        ])
        expect(subscription.status).toBe(
          order === `old-first` ? `ready` : `loadingSubset`,
        )
        const emptyBeforeRequest = emptyBatches
        subscription.requestSnapshot({ where: where.a })
        expect(emptyBatches - emptyBeforeRequest).toBe(privateReplay ? 0 : 1)
        await settle(loads.at(-1)!, `resolve`, `a`)
        expect([...visible.values()]).toEqual(
          privateReplay
            ? [{ id: `b`, version: 0 }]
            : [
                { id: `b`, version: 2 },
                { id: `a`, version: 2 },
              ],
        )
        if (order === `current-first`) await settle(old, oldOutcome)
        expect([...visible.values()]).toEqual([
          { id: `b`, version: 2 },
          { id: `a`, version: 2 },
        ])
        expect(subscription.status).toBe(`ready`)
        expect(errors).toEqual([])
        expect(replacementChanges).toBe(1)
        subscription.unsubscribe()
        expect(unloads).toHaveLength(loads.length)
        for (const { options } of loads)
          expect(unloads.filter((value) => value === options)).toHaveLength(1)
      } finally {
        for (const { deferred } of loads) deferred.resolve()
        await flushPromises()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(threeGenerationScenarios)(
    `fences three generations for $obsoleteOutcome/$currentOutcome settled $settlementOrder`,
    async ({ obsoleteOutcome, currentOutcome, settlementOrder }) => {
      type Row = { id: string; version: number }
      const obsolete = createDeferred<void>()
      const current = createDeferred<void>()
      void obsolete.promise.catch(() => {})
      void current.promise.catch(() => {})
      const obsoleteFailure = new Error(`obsolete generation failed`)
      const currentFailure = new Error(`current generation failed`)
      const visible = new Map<string | number, Row>()
      const errors: Array<unknown> = []
      const unloadSessions: Array<number> = []
      let session = -1

      const collection = createCollection<Row>({
        id: `three-generation-${obsoleteOutcome}-${currentOutcome}-${settlementOrder}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            session++
            const ownSession = session
            operations.markReady()
            return {
              loadSubset: (options) => {
                if (ownSession === 0) {
                  operations.begin()
                  operations.write({
                    type: `insert`,
                    value: { id: `row`, version: 1 },
                  })
                  operations.commit(options.signal)
                  return true
                }
                const gate = ownSession === 1 ? obsolete : current
                const outcome =
                  ownSession === 1 ? obsoleteOutcome : currentOutcome
                const failure =
                  ownSession === 1 ? obsoleteFailure : currentFailure
                return gate.promise.then(() => {
                  if (outcome === `reject`) throw failure
                  operations.begin()
                  operations.write({
                    type: `insert`,
                    value: { id: `row`, version: ownSession + 1 },
                  })
                  const receipt = operations.commit(options.signal)
                  if (receipt !== true) return receipt
                  return undefined
                })
              },
              unloadSubset: () => unloadSessions.push(ownSession),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.requestSnapshot()
      expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])

      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()
      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()
      expect(subscription.status).toBe(`loadingSubset`)

      const settleObsolete = () =>
        obsoleteOutcome === `resolve`
          ? obsolete.resolve()
          : obsolete.reject(obsoleteFailure)
      const settleCurrent = () =>
        currentOutcome === `resolve`
          ? current.resolve()
          : current.reject(currentFailure)
      if (settlementOrder === `obsolete-first`) {
        settleObsolete()
        await flushPromises()
        expect(subscription.status).toBe(`loadingSubset`)
        settleCurrent()
      } else {
        settleCurrent()
        await flushPromises()
        settleObsolete()
      }
      await flushPromises()

      expect([...visible.values()]).toEqual([
        currentOutcome === `resolve`
          ? { id: `row`, version: 3 }
          : { id: `row`, version: 1 },
      ])
      expect(errors).toEqual(
        currentOutcome === `reject` ? [currentFailure] : [],
      )
      expect(subscription.lastError).toBe(
        currentOutcome === `reject` ? currentFailure : undefined,
      )
      expect(subscription.status).toBe(`ready`)

      subscription.unsubscribe()
      expect(unloadSessions).toEqual([2])
      await collection.cleanup()
    },
  )

  it(`treats an externally aborted replay as failed without publishing partial rows`, async () => {
    type Row = { id: string; value: string }
    const abort = new AbortController()
    const replay = createDeferred<void>()
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const visible = new Map<string | number, Row>()
    const collection = createCollection<Row>({
      id: `externally-aborted-replay`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: () => {
              loadCount++
              begin()
              write({
                type: `insert`,
                value: {
                  id: `row`,
                  value: loadCount === 1 ? `old` : `partial`,
                },
              })
              commit()
              return loadCount === 1 ? true : replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else {
            visible.set(change.key, {
              id: change.value.id,
              value: change.value.value,
            })
          }
        }
      },
      { includeInitialState: false },
    )

    subscription.requestSnapshot({ signal: abort.signal })
    expect([...visible.values()]).toEqual([{ id: `row`, value: `old` }])
    begin()
    truncate()
    commit()
    await flushPromises()
    abort.abort()
    replay.reject(new DOMException(`aborted`, `AbortError`))
    await flushPromises()

    expect([...visible.values()]).toEqual([{ id: `row`, value: `old` }])
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`enters loading status when a truncate queues replay work`, async () => {
    const replay = createDeferred<void>()
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<{ id: string }>({
      id: `queued-replay-status`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return loads.length === 1 ? true : replay.promise
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })
    const original = loads[0]!

    begin()
    truncate()
    commit()
    observePhysicalInteraction(`active:truncate`, `retire`)

    expect(loads).toHaveLength(1)
    expect(subscription.status).toBe(`loadingSubset`)

    await flushPromises()
    const replacement = loads[1]!
    expect(loads).toHaveLength(2)
    expect(original.signal?.aborted).toBe(true)
    expect(unloads).toEqual([original])
    expect(replacement).not.toBe(original)
    expect(replacement.where).toBe(where)
    expect(replacement.signal?.aborted).toBe(false)
    replay.resolve()
    await flushPromises()
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    expect(unloads).toEqual([original, replacement])
    await collection.cleanup()
  })

  it.each(startOutcomes)(
    `retires replay setup when its adapter cleans up before %s`,
    async (outcome) => {
      type Row = { id: string; version: number }
      const pending = createDeferred<void>()
      void pending.promise.catch(() => {})
      const failure = new Error(`obsolete replay failed`)
      let begin!: () => void
      let write!: (message: { type: `insert`; value: Row }) => void
      let commit!: () => void
      let truncate!: () => void
      let loadCount = 0
      const visible = new Map<string | number, Row>()
      const errors: Array<unknown> = []
      const statuses: Array<string> = []

      const collection = createCollection<Row>({
        id: `reentrant-cleanup-${outcome}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: () => {
                loadCount++
                begin()
                write({
                  type: `insert`,
                  value: { id: `row`, version: loadCount },
                })
                commit()
                if (loadCount === 1) return true
                void collection.cleanup()
                if (outcome === `throw`) throw failure
                if (outcome === `return`) return true
                return pending.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.on(`status:change`, ({ status }) => statuses.push(status))
      subscription.requestSnapshot()

      begin()
      truncate()
      commit()
      await flushPromises()
      if (outcome === `resolve`) pending.resolve()
      if (outcome === `reject`) pending.reject(failure)
      await flushPromises()

      expect(collection.status).toBe(`cleaned-up`)
      expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])
      expect(errors).toEqual([])
      expect(subscription.lastError).toBeUndefined()
      expect(subscription.status).toBe(`ready`)
      expect(statuses.at(-1)).not.toBe(`loadingSubset`)

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  const { multiplier, ...replay } = readOracleRunConfig()

  fcTest.prop([asyncRestartScenarioArbitrary], {
    numRuns: 30 * multiplier,
    seed: 1_657_002,
  })(
    `fences async demand settlements across restart generations for a fixed seed`,
    async (scenario) => {
      await runAsyncRestartScenario(scenario)
    },
    120_000,
  )

  fcTest.prop(
    [asyncRestartScenarioArbitrary],
    oracleRandomParameters(
      30 * multiplier,
      replay,
      `subscription-lifecycle.async-restart`,
    ),
  )(
    `fences async demand settlements across restart generations for a random or replayed seed`,
    async (scenario) => {
      await runAsyncRestartScenario(scenario)
    },
    120_000,
  )
})
