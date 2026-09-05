import { fc } from '@fast-check/vitest'

export type DemandName = `a` | `b`
export type AttemptScope = `current` | `obsolete`
export type AttemptAge = `oldest` | `newest`
export type LifecycleCommand =
  | { type: `request`; demand: DemandName }
  | { type: `abort`; demand: DemandName }
  | { type: `release`; demand: DemandName }
  | {
      type: `settle`
      demand: DemandName
      scope: AttemptScope
      age: AttemptAge
      outcome: `resolve` | `reject`
    }
  | { type: `truncate` }
  | { type: `cleanup` }
  | { type: `restart` }
  | { type: `unsubscribe` }

export const lifecycleCommandArbitrary: fc.Arbitrary<LifecycleCommand> =
  fc.oneof(
    fc.record({
      type: fc.constant(`request` as const),
      demand: fc.constantFrom(`a` as const, `b` as const),
    }),
    fc.record({
      type: fc.constant(`abort` as const),
      demand: fc.constantFrom(`a` as const, `b` as const),
    }),
    fc.record({
      type: fc.constant(`release` as const),
      demand: fc.constantFrom(`a` as const, `b` as const),
    }),
    fc.record({
      type: fc.constant(`settle` as const),
      demand: fc.constantFrom(`a` as const, `b` as const),
      scope: fc.constantFrom(`current` as const, `obsolete` as const),
      age: fc.constantFrom(`oldest` as const, `newest` as const),
      outcome: fc.constantFrom(`resolve` as const, `reject` as const),
    }),
    fc.constant({ type: `truncate` as const }),
    fc.constant({ type: `cleanup` as const }),
    fc.constant({ type: `restart` as const }),
    fc.constant({ type: `unsubscribe` as const }),
  )

export type LifecycleOwner = {
  id: number
  demand: DemandName
  aborted: boolean
  attemptId?: number
}

export type LifecycleAttempt = {
  id: number
  ownerId: number
  demand: DemandName
  session: number
  replay: number
  settled: boolean
  outcome?: `resolve` | `reject`
  gating: boolean
  reportable: boolean
  aborted: boolean
  failure: Error
}

export type LifecycleLoadEvent = Pick<
  LifecycleAttempt,
  `id` | `demand` | `session` | `replay`
>
export type LifecycleUnloadEvent = {
  attemptId: number
  handlerSession: number
}
export type LifecycleErrorEvent = { attemptId: number; error: Error }
export type LifecycleResultKind = `promise` | `true`
export type LifecycleResultEvent = {
  attemptId: number | `unacquired`
  resultKind: LifecycleResultKind
}
export type LifecycleTraceEvent =
  | ({ type: `load` } & LifecycleLoadEvent)
  | ({ type: `unload` } & LifecycleUnloadEvent)
  | { type: `error`; attemptId: number }
  | ({ type: `result` } & LifecycleResultEvent)
  | { type: `status`; status: string }
  | { type: `publication` }

export type LifecycleModel = {
  acquisitionMode: `async-pending` | `sync-success`
  active: boolean
  unsubscribed: boolean
  session: number
  replay: number
  publicationBarrierOpen: boolean
  nextOwnerId: number
  nextAttemptId: number
  owners: Array<LifecycleOwner>
  attempts: Array<LifecycleAttempt>
  loads: Array<LifecycleLoadEvent>
  unloads: Array<LifecycleUnloadEvent>
  errors: Array<LifecycleErrorEvent>
  results: Array<LifecycleResultEvent>
  publications: number
  statuses: Array<string>
  status: string
  collectionStatus: `ready` | `cleaned-up`
  lastError?: Error
  failureForAttempt: (attemptId: number) => Error
  reach: Set<string>
  trace: Array<LifecycleTraceEvent>
}

export type LifecycleEffect = {
  ownerId?: number
  attemptId?: number
  requestResult?: boolean
}

export function createLifecycleModel(
  acquisitionMode: LifecycleModel[`acquisitionMode`] = `async-pending`,
  failureForAttempt: (attemptId: number) => Error = (attemptId) =>
    new Error(`attempt ${attemptId} failed`),
): LifecycleModel {
  return {
    acquisitionMode,
    active: true,
    unsubscribed: false,
    session: 0,
    replay: 0,
    publicationBarrierOpen: false,
    nextOwnerId: 0,
    nextAttemptId: 0,
    owners: [],
    attempts: [],
    loads: [],
    unloads: [],
    errors: [],
    results: [],
    publications: 0,
    statuses: [],
    status: `ready`,
    collectionStatus: `ready`,
    reach: new Set(),
    trace: [],
    failureForAttempt,
  }
}

function setStatus(model: LifecycleModel, queuedReplay = false): void {
  if (model.unsubscribed) return
  const status =
    model.active &&
    (queuedReplay || model.attempts.some(({ gating }) => gating))
      ? `loadingSubset`
      : `ready`
  if (status !== model.status) {
    model.status = status
    model.statuses.push(status)
    model.trace.push({ type: `status`, status })
  }
}

// Settled failure is not an authoritative replacement. Keep subsequent reads
// private until the failed owner retires or a new replay succeeds.
function replacementSucceeded(model: LifecycleModel): boolean {
  return model.owners.every(
    ({ attemptId }) =>
      attemptId === undefined ||
      model.attempts[attemptId]!.outcome === `resolve`,
  )
}

function startAttempt(
  model: LifecycleModel,
  owner: LifecycleOwner,
  trace = true,
): LifecycleAttempt {
  const id = model.nextAttemptId++
  const attempt: LifecycleAttempt = {
    id,
    ownerId: owner.id,
    demand: owner.demand,
    session: model.session,
    replay: model.replay,
    settled: model.acquisitionMode === `sync-success`,
    ...(model.acquisitionMode === `sync-success`
      ? { outcome: `resolve` as const }
      : {}),
    gating: model.acquisitionMode === `async-pending`,
    reportable: true,
    aborted: false,
    failure: model.failureForAttempt(id),
  }
  model.attempts.push(attempt)
  model.reach.add(
    `attempt-session:${attempt.session === 0 ? `initial` : `restarted`}`,
  )
  model.reach.add(
    `attempt-replay:${attempt.replay === 0 ? `initial` : `replayed`}`,
  )
  model.reach.add(
    `attempt-location:${attempt.session === 0 ? `initial` : `restarted`}:${attempt.replay === 0 ? `initial` : `replayed`}`,
  )
  model.loads.push({
    id,
    demand: attempt.demand,
    session: attempt.session,
    replay: attempt.replay,
  })
  if (trace) {
    model.trace.push({
      type: `load`,
      id,
      demand: attempt.demand,
      session: attempt.session,
      replay: attempt.replay,
    })
  }
  owner.attemptId = id
  return attempt
}

function retireAttempt(
  model: LifecycleModel,
  owner: LifecycleOwner,
  unload: boolean,
  trace = true,
): void {
  if (owner.attemptId === undefined) return
  const attempt = model.attempts[owner.attemptId]
  owner.attemptId = undefined
  if (!attempt) throw new Error(`model lost attempt`)
  attempt.gating = false
  attempt.reportable = false
  attempt.aborted = true
  if (unload) {
    model.unloads.push({ attemptId: attempt.id, handlerSession: model.session })
    if (trace) {
      model.trace.push({
        type: `unload`,
        attemptId: attempt.id,
        handlerSession: model.session,
      })
    }
  }
}

function selectAttempt(
  model: LifecycleModel,
  command: Extract<LifecycleCommand, { type: `settle` }>,
): LifecycleAttempt | undefined {
  const currentAttemptIds = new Set(
    model.owners.flatMap(({ attemptId }) =>
      attemptId === undefined ? [] : [attemptId],
    ),
  )
  const candidates = model.attempts.filter(
    (attempt) =>
      !attempt.settled &&
      attempt.demand === command.demand &&
      (command.scope === `current`
        ? currentAttemptIds.has(attempt.id)
        : !currentAttemptIds.has(attempt.id)),
  )
  return command.age === `oldest` ? candidates[0] : candidates.at(-1)
}

/** Pure reference transition. It never reads adapter callbacks or SUT state. */
export function reduceLifecycle(
  model: LifecycleModel,
  command: LifecycleCommand,
): LifecycleEffect {
  model.reach.add(`command:${command.type}`)
  if (model.unsubscribed) {
    if (command.type === `cleanup` && model.active) {
      model.reach.add(`effective:cleanup`)
      model.active = false
      model.collectionStatus = `cleaned-up`
    } else if (command.type === `restart` && !model.active) {
      model.reach.add(`effective:restart`)
      model.active = true
      model.session++
      model.replay = 0
      model.publicationBarrierOpen = false
      model.collectionStatus = `ready`
    } else {
      model.reach.add(`noop:${command.type}`)
    }
    return { requestResult: false }
  }

  if (command.type === `request`) {
    model.reach.add(`effective:request`)
    if (model.owners.some(({ demand }) => demand === command.demand)) {
      model.reach.add(`duplicate-owner`)
    }
    if (!model.active) model.reach.add(`request-while-cleaned`)
    const owner: LifecycleOwner = {
      id: model.nextOwnerId++,
      demand: command.demand,
      aborted: false,
    }
    model.owners.push(owner)
    if (model.active) {
      const attemptId = startAttempt(model, owner).id
      const result = {
        attemptId,
        resultKind:
          model.acquisitionMode === `async-pending`
            ? (`promise` as const)
            : (`true` as const),
      }
      model.results.push(result)
      model.trace.push({ type: `result`, ...result })
    } else {
      // A waiting owner gets a promise now, without claiming an acquisition.
      const result = { attemptId: `unacquired`, resultKind: `promise` } as const
      model.results.push(result)
      model.trace.push({ type: `result`, ...result })
    }
    setStatus(model)
    if (!model.publicationBarrierOpen) {
      model.publications++
      model.trace.push({ type: `publication` })
    }
    return { ownerId: owner.id, requestResult: true }
  }

  if (command.type === `abort`) {
    const owner = model.owners.find(
      ({ demand, aborted }) => demand === command.demand && !aborted,
    )
    if (!owner) {
      model.reach.add(`noop:abort`)
      return {}
    }
    model.reach.add(`effective:abort`)
    owner.aborted = true
    if (owner.attemptId !== undefined) {
      const attempt = model.attempts[owner.attemptId]!
      attempt.aborted = true
      attempt.reportable = false
    }
    return { ownerId: owner.id }
  }

  if (command.type === `release`) {
    const index = model.owners.findIndex(
      ({ demand }) => demand === command.demand,
    )
    if (index === -1) {
      model.reach.add(`noop:release`)
      return {}
    }
    model.reach.add(`effective:release`)
    const [owner] = model.owners.splice(index, 1)
    retireAttempt(model, owner!, true)
    if (model.publicationBarrierOpen && replacementSucceeded(model)) {
      model.publicationBarrierOpen = false
    }
    setStatus(model)
    return { ownerId: owner!.id }
  }

  if (command.type === `settle`) {
    const attempt = selectAttempt(model, command)
    if (!attempt) {
      model.reach.add(`noop:settle`)
      return {}
    }
    model.reach.add(`effective:settle`)
    model.reach.add(`settle-scope:${command.scope}`)
    model.reach.add(`settle-age:${command.age}`)
    model.reach.add(`settle-outcome:${command.outcome}`)
    model.reach.add(`settle:${command.scope}:${command.age}:${command.outcome}`)
    attempt.settled = true
    attempt.outcome = command.outcome
    attempt.gating = false
    if (
      command.outcome === `reject` &&
      attempt.reportable &&
      !attempt.aborted
    ) {
      model.lastError = attempt.failure
      model.errors.push({ attemptId: attempt.id, error: attempt.failure })
      model.trace.push({ type: `error`, attemptId: attempt.id })
    }
    if (model.publicationBarrierOpen && replacementSucceeded(model)) {
      model.publicationBarrierOpen = false
    }
    setStatus(model)
    return { attemptId: attempt.id }
  }

  if (command.type === `truncate`) {
    if (!model.active) {
      model.reach.add(`noop:truncate`)
      return {}
    }
    model.reach.add(`effective:truncate`)
    if (
      model.replay > 0 &&
      model.attempts.some(
        ({ session, settled }) => session === model.session && !settled,
      )
    ) {
      model.reach.add(`overlapping-replay`)
    }
    model.replay++
    // Replay setup is asynchronous even when every acquisition is synchronous
    // or canceled. Logical owners queue setup; live owners start acquisitions.
    setStatus(model, model.owners.length > 0)
    model.publicationBarrierOpen = model.owners.some(({ aborted }) => !aborted)
    const replayTrace: Array<LifecycleTraceEvent> = []
    for (const owner of model.owners) {
      const retiredAttemptId = owner.attemptId
      retireAttempt(model, owner, true, false)
      if (!owner.aborted) {
        const attempt = startAttempt(model, owner, false)
        replayTrace.push({
          type: `load`,
          id: attempt.id,
          demand: attempt.demand,
          session: attempt.session,
          replay: attempt.replay,
        })
      }
      if (retiredAttemptId !== undefined) {
        replayTrace.push({
          type: `unload`,
          attemptId: retiredAttemptId,
          handlerSession: model.session,
        })
      }
    }
    if (model.publicationBarrierOpen && replacementSucceeded(model)) {
      model.publicationBarrierOpen = false
    }
    model.trace.push(...replayTrace)
    setStatus(model)
    return {}
  }

  if (command.type === `cleanup`) {
    if (!model.active) {
      model.reach.add(`noop:cleanup`)
      return {}
    }
    model.reach.add(`effective:cleanup`)
    const current = model.attempts.filter(
      ({ session }) => session === model.session,
    )
    if (
      current.some(({ settled }) => settled) &&
      current.some(({ settled }) => !settled)
    ) {
      model.reach.add(`partial-generation-supersession`)
    }
    for (const owner of model.owners) retireAttempt(model, owner, false)
    model.active = false
    model.publicationBarrierOpen = false
    model.collectionStatus = `cleaned-up`
    setStatus(model)
    return {}
  }

  if (command.type === `restart`) {
    if (model.active) {
      model.reach.add(`noop:restart`)
      return {}
    }
    model.reach.add(`effective:restart`)
    model.active = true
    model.session++
    model.replay = 0
    model.publicationBarrierOpen = model.owners.some(({ aborted }) => !aborted)
    model.collectionStatus = `ready`
    setStatus(model, model.owners.length > 0)
    const replayLoads: Array<LifecycleLoadEvent> = []
    for (const owner of model.owners) {
      if (!owner.aborted) replayLoads.push(startAttempt(model, owner, false))
    }
    if (model.publicationBarrierOpen && replacementSucceeded(model)) {
      model.publicationBarrierOpen = false
    }
    if (!model.unsubscribed) {
      model.publications++
      model.trace.push({ type: `publication` })
    }
    for (const load of replayLoads) {
      model.trace.push({
        type: `load`,
        id: load.id,
        demand: load.demand,
        session: load.session,
        replay: load.replay,
      })
    }
    setStatus(model)
    return {}
  }

  model.reach.add(`effective:unsubscribe`)
  for (const owner of model.owners) retireAttempt(model, owner, true)
  model.owners.length = 0
  model.unsubscribed = true
  return {}
}

function crossesPendingReplaySupersession(
  history: ReadonlyArray<LifecycleCommand>,
): boolean {
  const model = createLifecycleModel()
  let hasPendingSupersession = false
  for (const command of history) {
    if (
      command.type === `truncate` &&
      model.active &&
      model.owners.some(({ attemptId }) =>
        attemptId === undefined ? false : !model.attempts[attemptId]!.settled,
      )
    ) {
      hasPendingSupersession = true
    }
    reduceLifecycle(model, command)
    const currentAttemptIds = new Set(
      model.owners.flatMap(({ attemptId }) =>
        attemptId === undefined ? [] : [attemptId],
      ),
    )
    if (
      hasPendingSupersession &&
      model.status === `ready` &&
      model.attempts.some(
        ({ id, settled }) => !currentAttemptIds.has(id) && !settled,
      )
    ) {
      return true
    }
  }
  return false
}

function replaysAbortedDemand(
  history: ReadonlyArray<LifecycleCommand>,
): boolean {
  const model = createLifecycleModel()
  for (const command of history) {
    const wouldReplay =
      (command.type === `truncate` && model.active) ||
      (command.type === `restart` && !model.active)
    if (wouldReplay && model.owners.some(({ aborted }) => aborted)) return true
    reduceLifecycle(model, command)
  }
  return false
}

export const greenLifecycleHistoryArbitrary = fc
  .array(lifecycleCommandArbitrary, { minLength: 1, maxLength: 20 })
  // Each excluded transition has a named failing witness below. Abort itself
  // remains in the green campaign; only replaying its retired owner is red.
  .filter((history) => !replaysAbortedDemand(history))
  .filter((history) => !crossesPendingReplaySupersession(history))

function publishesReleasedObsoleteAttempt(
  history: ReadonlyArray<LifecycleCommand>,
): boolean {
  const model = createLifecycleModel()
  for (const command of history) {
    const effect = reduceLifecycle(model, command)
    if (
      command.type === `settle` &&
      command.outcome === `resolve` &&
      effect.attemptId !== undefined &&
      !model.owners.some(({ attemptId }) => attemptId === effect.attemptId)
    ) {
      return true
    }
  }
  return false
}

export const publicationLifecycleHistoryArbitrary =
  greenLifecycleHistoryArbitrary.filter(
    (history) => !publishesReleasedObsoleteAttempt(history),
  )

function crossesSynchronousReplay(
  history: ReadonlyArray<LifecycleCommand>,
): boolean {
  const model = createLifecycleModel(`sync-success`)
  for (const command of history) {
    const replaysOwnedDemand =
      (command.type === `truncate` &&
        model.active &&
        model.owners.length > 0) ||
      (command.type === `restart` && !model.active && model.owners.length > 0)
    if (replaysOwnedDemand) {
      return true
    }
    reduceLifecycle(model, command)
  }
  return false
}

export const syncLifecycleHistoryArbitrary = fc
  .array(lifecycleCommandArbitrary, { minLength: 1, maxLength: 20 })
  // Synchronous replay currently emits a false loading cycle. The fixed red
  // history owns that class until production satisfies the protocol.
  .filter((history) => !crossesSynchronousReplay(history))

export const settle = (
  demand: DemandName,
  scope: AttemptScope,
  age: AttemptAge,
  outcome: `resolve` | `reject`,
): LifecycleCommand => ({ type: `settle`, demand, scope, age, outcome })

const compoundSettlementHistories = ([`current`, `obsolete`] as const).flatMap(
  (scope) =>
    ([`oldest`, `newest`] as const).flatMap((age) =>
      ([`resolve`, `reject`] as const).map((outcome) => [
        { type: `request`, demand: `a` } as const,
        { type: `request`, demand: `a` } as const,
        ...(scope === `obsolete`
          ? ([
              { type: `release`, demand: `a` },
              { type: `release`, demand: `a` },
            ] as const)
          : []),
        settle(`a`, scope, age, outcome),
      ]),
    ),
)

export const compoundLifecycleCoverageHistories: ReadonlyArray<
  ReadonlyArray<LifecycleCommand>
> = [
  ...compoundSettlementHistories,
  [
    { type: `request`, demand: `a` },
    settle(`a`, `current`, `oldest`, `resolve`),
    { type: `truncate` },
    settle(`a`, `current`, `oldest`, `resolve`),
  ],
]

export const greenLifecycleHistories: ReadonlyArray<
  ReadonlyArray<LifecycleCommand>
> = [
  [
    { type: `request`, demand: `a` },
    { type: `abort`, demand: `a` },
    settle(`a`, `current`, `oldest`, `reject`),
    { type: `release`, demand: `a` },
  ],
  [
    { type: `request`, demand: `a` },
    { type: `request`, demand: `a` },
    settle(`a`, `current`, `newest`, `resolve`),
    settle(`a`, `current`, `oldest`, `resolve`),
    { type: `release`, demand: `a` },
    { type: `release`, demand: `a` },
  ],
  [
    { type: `request`, demand: `a` },
    { type: `request`, demand: `b` },
    settle(`a`, `current`, `oldest`, `resolve`),
    { type: `cleanup` },
    { type: `restart` },
    settle(`b`, `obsolete`, `oldest`, `reject`),
    settle(`a`, `current`, `oldest`, `resolve`),
    settle(`b`, `current`, `oldest`, `reject`),
  ],
  [
    { type: `cleanup` },
    { type: `request`, demand: `a` },
    { type: `restart` },
    settle(`a`, `current`, `oldest`, `resolve`),
    { type: `truncate` },
    { type: `cleanup` },
    { type: `restart` },
    { type: `release`, demand: `a` },
    { type: `unsubscribe` },
  ],
  [
    { type: `request`, demand: `a` },
    settle(`a`, `current`, `oldest`, `reject`),
    { type: `cleanup` },
    { type: `restart` },
    settle(`a`, `current`, `oldest`, `resolve`),
  ],
  [
    { type: `abort`, demand: `a` },
    { type: `release`, demand: `a` },
    settle(`a`, `current`, `oldest`, `resolve`),
    { type: `truncate` },
    { type: `cleanup` },
    { type: `truncate` },
    { type: `cleanup` },
    { type: `restart` },
    { type: `restart` },
    { type: `unsubscribe` },
    { type: `request`, demand: `b` },
    { type: `unsubscribe` },
  ],
]

export const syncLifecycleHistory: ReadonlyArray<LifecycleCommand> = [
  { type: `request`, demand: `a` },
  { type: `request`, demand: `a` },
  { type: `release`, demand: `a` },
  { type: `request`, demand: `b` },
  { type: `truncate` },
  { type: `release`, demand: `a` },
  { type: `release`, demand: `b` },
  { type: `cleanup` },
  { type: `restart` },
  { type: `unsubscribe` },
]

export const pendingSupersessionHistory: ReadonlyArray<LifecycleCommand> = [
  { type: `request`, demand: `a` },
  { type: `request`, demand: `a` },
  { type: `truncate` },
  { type: `truncate` },
  settle(`a`, `current`, `newest`, `resolve`),
  settle(`a`, `current`, `oldest`, `reject`),
  { type: `release`, demand: `a` },
]

export const abortReplayHistory: ReadonlyArray<LifecycleCommand> = [
  { type: `request`, demand: `a` },
  { type: `abort`, demand: `a` },
  settle(`a`, `current`, `oldest`, `reject`),
  { type: `truncate` },
  { type: `release`, demand: `a` },
]

export const abortedRestartHistory: ReadonlyArray<LifecycleCommand> = [
  { type: `request`, demand: `a` },
  { type: `cleanup` },
  { type: `abort`, demand: `a` },
  { type: `restart` },
  { type: `release`, demand: `a` },
]

export const mixedAbortedRestartHistory: ReadonlyArray<LifecycleCommand> = [
  { type: `request`, demand: `a` },
  { type: `request`, demand: `b` },
  { type: `abort`, demand: `a` },
  settle(`a`, `current`, `oldest`, `reject`),
  { type: `cleanup` },
  { type: `restart` },
  settle(`b`, `current`, `oldest`, `resolve`),
  { type: `release`, demand: `a` },
  { type: `release`, demand: `b` },
  { type: `unsubscribe` },
]

export const releasedObsoleteResolveHistory: ReadonlyArray<LifecycleCommand> = [
  { type: `request`, demand: `a` },
  { type: `release`, demand: `a` },
  settle(`a`, `obsolete`, `oldest`, `resolve`),
]
