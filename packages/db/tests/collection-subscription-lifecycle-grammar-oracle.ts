import { fc } from '@fast-check/vitest'

/**
 * # Which subscription histories are legal?
 *
 * A logical demand owns at most one current physical acquisition. Acquisition
 * work may outlive that demand after abort, release, restart, or cleanup. The
 * subscription must therefore track logical owners and acquisition attempts as
 * separate nodes. A sync run groups attempts that can publish one private
 * replacement. A replay generation orders replacements in that sync run.
 *
 * Commands form the history grammar. The model's `request` command combines a
 * new logical owner with any acquisition attempt it starts. Its `release`
 * command combines demand retirement with release of that owner's acquisition
 * lease. `abort` only requests cancellation; it does not retire the owner.
 * `settle` changes an acquisition attempt. `truncate` starts a private
 * replacement. `cleanup` ends the current sync run; `restart` starts a new
 * sync run. `unsubscribe` ends this subscription, retires its logical subset
 * owners, and releases their acquisition leases. It does not end the
 * Collection's sync run. The reducer is a pure reference machine: it never
 * calls an adapter and never reads production state.
 *
 * The model is intentionally one graph rather than one model per assertion.
 * Ownership decides which attempts are live; attempts decide readiness and
 * replacement authority; authority decides publication. Splitting those laws
 * would hide the cross-boundary histories this oracle exists to test. Row
 * contents remain outside this grammar and have their own publication model.
 *
 * Pinned histories name important paths. Generated histories explore adjacent
 * legal commands with fixed and random seeds. The drivers compare production
 * loads, unloads, results, status, errors, and publication against this trace.
 *
 * A demand change is one step (ARCHITECTURE law 9, "Replay participants and
 * failure"). Its `change` command retires several logical owners at once, as
 * a lazy join's demand change retires several segments, and the model judges
 * an open replay once, after every owner in the change has retired. Its
 * `replace` command marks one held owner as the replacement for another's
 * coverage, as a lazy join's fragmented-churn replacement does (law 10,
 * "Source cancellation and applied settlement"): the replacement requests the
 * whole current key union, so while it is held and its own acquisition did
 * not fail, the replay does not fail for the owner it replaces. Retiring the
 * replacement returns that verdict to the replaced owner. Only the
 * demand-change grammar below generates these two commands and the third
 * demand `c`.
 *
 * `LifecycleAttempt` is deliberately broader than production's
 * `SubsetAcquisition`: it begins when `loadSubset` is invoked, including a
 * synchronous throw that creates no acquisition or acquisition lease. Its
 * `syncRunGeneration` and `replayGeneration` map to production's
 * sync-run and truncate-replay generations. These are model projections,
 * not renamed production states.
 */

export type DemandName = `a` | `b` | `c`

/**
 * A bounded callback-reentry grammar for direct snapshots. The callback phase
 * is an observation cut, not a second subscription state machine. A released
 * or unsubscribed request has no authority to publish its local snapshot.
 * A caller can retain the requested predicate and release from every phase,
 * including callbacks that do not receive a release function.
 */
export const reentrantSnapshotHistories = [
  { phase: `loadSubset`, action: `release` },
  { phase: `loadSubset`, action: `unsubscribe` },
  { phase: `onLoadSubsetResult`, action: `release` },
  { phase: `onLoadSubsetResult`, action: `unsubscribe` },
  { phase: `statusLoadingSubset`, action: `release` },
  { phase: `statusLoadingSubset`, action: `unsubscribe` },
  { phase: `onUnoptimized`, action: `release` },
  { phase: `onUnoptimized`, action: `unsubscribe` },
  { phase: `snapshotEvaluation`, action: `release` },
  { phase: `snapshotEvaluation`, action: `unsubscribe` },
] as const

export type AttemptScope = `current` | `obsolete`
export type AttemptAge = `oldest` | `newest`
export type LifecycleCommand =
  | { type: `request`; demand: DemandName }
  | { type: `abort`; demand: DemandName }
  | { type: `release`; demand: DemandName }
  | { type: `change`; release: ReadonlyArray<DemandName> }
  | { type: `replace`; demand: DemandName; replaced: DemandName }
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
  // Owners whose coverage this owner replaces (`replace`).
  replaces?: Array<number>
}

export type LifecycleAttempt = {
  id: number
  ownerId: number
  demand: DemandName
  syncRunGeneration: number
  replayGeneration: number
  outcome?: `resolve` | `reject`
  gating: boolean
  inReplacement: boolean
  reportable: boolean
  aborted: boolean
  failure: Error
}

export type LifecycleLoadEvent = Pick<
  LifecycleAttempt,
  `id` | `demand` | `syncRunGeneration` | `replayGeneration`
>
export type LifecycleUnloadEvent = {
  attemptId: number
  handlerSyncRunGeneration: number
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
  cancellation: `manual` | `reject`
  active: boolean
  unsubscribed: boolean
  syncRunGeneration: number
  replayGeneration: number
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
  // The owners one `change` retired, in release order.
  ownerIds?: Array<number>
  attemptId?: number
  requestResult?: boolean
}

export function createLifecycleModel(
  acquisitionMode: LifecycleModel[`acquisitionMode`] = `async-pending`,
  failureForAttempt: (attemptId: number) => Error = (attemptId) =>
    new Error(`attempt ${attemptId} failed`),
  cancellation: LifecycleModel[`cancellation`] = `manual`,
): LifecycleModel {
  return {
    acquisitionMode,
    cancellation,
    active: true,
    unsubscribed: false,
    syncRunGeneration: 0,
    replayGeneration: 0,
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
// private until the failed owner retires or a new replay succeeds. A held
// replacement whose own acquisition did not fail covers the owners it
// replaces, so their failure does not fail the replay. An owner without a
// current acquisition attempt owes nothing, as before.
function replacementSucceeded(model: LifecycleModel): boolean {
  const loaded = ({ attemptId }: LifecycleOwner) =>
    attemptId === undefined || model.attempts[attemptId]!.outcome === `resolve`
  return (
    !model.attempts.some(
      ({ gating, inReplacement }) => gating && inReplacement,
    ) &&
    model.owners.every(
      (owner) =>
        loaded(owner) ||
        model.owners.some(
          (replacement) =>
            replacement.replaces?.includes(owner.id) && loaded(replacement),
        ),
    )
  )
}

// Judge an open replay: success closes the publication barrier.
function judgeReplay(model: LifecycleModel): void {
  if (!model.publicationBarrierOpen || !replacementSucceeded(model)) return
  model.publicationBarrierOpen = false
  if (
    model.owners.some(
      ({ attemptId }) =>
        attemptId !== undefined &&
        model.attempts[attemptId]!.outcome === `reject`,
    )
  )
    model.reach.add(`replacement-decides-failed-owner`)
}

// What judging the open replay now would decide. Only `change` asks, to name
// the histories in which judging between its releases would differ.
function replayVerdict(
  model: LifecycleModel,
): `closed` | `open` | `failed` | `succeeded` {
  if (!model.publicationBarrierOpen) return `closed`
  if (
    model.attempts.some(({ gating, inReplacement }) => gating && inReplacement)
  )
    return `open`
  return replacementSucceeded(model) ? `succeeded` : `failed`
}

// Retire one logical owner and its acquisition lease without judging the
// replay: the caller judges once its whole demand change has retired.
function retireOwner(
  model: LifecycleModel,
  demand: DemandName,
): LifecycleOwner | undefined {
  const index = model.owners.findIndex((owner) => owner.demand === demand)
  if (index === -1) return undefined
  const [owner] = model.owners.splice(index, 1)
  retireAttempt(model, owner!, { unload: true })
  // Retirement removes the logical owner, including its older transports.
  for (const attempt of model.attempts) {
    if (attempt.ownerId === owner!.id) attempt.gating = false
  }
  return owner
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
    syncRunGeneration: model.syncRunGeneration,
    replayGeneration: model.replayGeneration,
    ...(model.acquisitionMode === `sync-success`
      ? { outcome: `resolve` as const }
      : {}),
    gating: model.acquisitionMode === `async-pending`,
    // Initial/progressive acquisition can hold readiness without joining the
    // authoritative replacement's publication boundary.
    inReplacement: model.publicationBarrierOpen,
    reportable: true,
    aborted: false,
    failure: model.failureForAttempt(id),
  }
  model.attempts.push(attempt)
  model.reach.add(
    `attempt-sync-run:${attempt.syncRunGeneration === 0 ? `initial` : `restarted`}`,
  )
  model.reach.add(
    `attempt-replay:${attempt.replayGeneration === 0 ? `initial` : `replayed`}`,
  )
  model.reach.add(
    `attempt-location:${attempt.syncRunGeneration === 0 ? `initial` : `restarted`}:${attempt.replayGeneration === 0 ? `initial` : `replayed`}`,
  )
  model.loads.push({
    id,
    demand: attempt.demand,
    syncRunGeneration: attempt.syncRunGeneration,
    replayGeneration: attempt.replayGeneration,
  })
  if (trace) {
    model.trace.push({
      type: `load`,
      id,
      demand: attempt.demand,
      syncRunGeneration: attempt.syncRunGeneration,
      replayGeneration: attempt.replayGeneration,
    })
  }
  owner.attemptId = id
  return attempt
}

function retireAttempt(
  model: LifecycleModel,
  owner: LifecycleOwner,
  options: { unload: boolean; trace?: boolean; keepPending?: boolean },
): void {
  if (owner.attemptId === undefined) return
  const attempt = model.attempts[owner.attemptId]
  owner.attemptId = undefined
  if (!attempt) throw new Error(`model lost attempt`)
  attempt.gating = options.keepPending === true && attempt.outcome === undefined
  attempt.reportable = false
  abortAttempt(model, attempt)
  if (options.unload) {
    model.unloads.push({
      attemptId: attempt.id,
      handlerSyncRunGeneration: model.syncRunGeneration,
    })
    if (options.trace !== false) {
      model.trace.push({
        type: `unload`,
        attemptId: attempt.id,
        handlerSyncRunGeneration: model.syncRunGeneration,
      })
    }
  }
}

function abortAttempt(model: LifecycleModel, attempt: LifecycleAttempt): void {
  attempt.aborted = true
  if (model.cancellation === `reject` && attempt.outcome === undefined) {
    attempt.outcome = `reject`
    attempt.gating = false
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
      attempt.outcome === undefined &&
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
      model.syncRunGeneration++
      model.replayGeneration = 0
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
      abortAttempt(model, attempt)
      attempt.reportable = false
    }
    // Prompt cancellation settles the attempt, so the replay is judged as
    // after any settlement: a held replacement can still cover it.
    judgeReplay(model)
    setStatus(model)
    return { ownerId: owner.id }
  }

  if (command.type === `release`) {
    const owner = retireOwner(model, command.demand)
    if (!owner) {
      model.reach.add(`noop:release`)
      return {}
    }
    model.reach.add(`effective:release`)
    judgeReplay(model)
    setStatus(model)
    return { ownerId: owner.id }
  }

  if (command.type === `change`) {
    // Law 9: the change is one step. Every named owner retires first, and
    // the replay is judged once after the last. The verdicts between its
    // releases are recorded only to name the histories they would mislead.
    const verdicts: Array<ReturnType<typeof replayVerdict>> = []
    const retired: Array<LifecycleOwner> = []
    for (const demand of command.release) {
      const owner = retireOwner(model, demand)
      if (!owner) continue
      retired.push(owner)
      verdicts.push(replayVerdict(model))
    }
    if (retired.length === 0) {
      model.reach.add(`noop:change`)
      return {}
    }
    model.reach.add(`effective:change`)
    const verdict = verdicts.at(-1)!
    if (retired.length > 1 && verdict !== `closed`)
      model.reach.add(`change:several-owners-during-replay`)
    const between = verdicts.slice(0, -1)
    if (verdict === `failed` && between.includes(`succeeded`))
      model.reach.add(`change:between-releases-would-publish`)
    if (verdict === `succeeded` && between.includes(`failed`))
      model.reach.add(`change:between-releases-would-fail`)
    judgeReplay(model)
    setStatus(model)
    return { ownerIds: retired.map(({ id }) => id) }
  }

  if (command.type === `replace`) {
    const replacement = model.owners.find(
      ({ demand }) => demand === command.demand,
    )
    if (!replacement) {
      model.reach.add(`noop:replace`)
      return {}
    }
    model.reach.add(`effective:replace`)
    replacement.replaces = model.owners
      .filter(({ demand }) => demand === command.replaced)
      .map(({ id }) => id)
    return { ownerId: replacement.id }
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
    judgeReplay(model)
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
      model.replayGeneration > 0 &&
      model.attempts.some(
        ({ syncRunGeneration, outcome }) =>
          syncRunGeneration === model.syncRunGeneration &&
          outcome === undefined,
      )
    ) {
      model.reach.add(`overlapping-replay`)
    }
    model.replayGeneration++
    // Replay setup is asynchronous even when every acquisition is synchronous
    // or canceled. Logical owners queue setup; live owners start acquisitions.
    setStatus(model, model.owners.length > 0)
    // A canceled-only truncate starts no new work, but cannot end a prior
    // replay's publication wait while that owner still owes settlement.
    model.publicationBarrierOpen =
      model.owners.some(({ aborted }) => !aborted) ||
      model.attempts.some(
        ({ gating, inReplacement }) => gating && inReplacement,
      )
    for (const owner of model.owners) {
      // Replacing an acquisition is not releasing its logical owner. Delayed
      // cancellation still holds readiness; replay work also holds publication.
      retireAttempt(model, owner, {
        unload: true,
        keepPending: true,
      })
      if (!owner.aborted) {
        startAttempt(model, owner)
      }
    }
    judgeReplay(model)
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
      ({ syncRunGeneration }) => syncRunGeneration === model.syncRunGeneration,
    )
    if (
      current.some(({ outcome }) => outcome !== undefined) &&
      current.some(({ outcome }) => outcome === undefined)
    ) {
      model.reach.add(`partial-generation-supersession`)
    }
    for (const owner of model.owners)
      retireAttempt(model, owner, { unload: false })
    for (const attempt of model.attempts) attempt.gating = false
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
    model.syncRunGeneration++
    model.replayGeneration = 0
    model.publicationBarrierOpen = model.owners.some(({ aborted }) => !aborted)
    model.collectionStatus = `ready`
    setStatus(model, model.owners.length > 0)
    const replayLoads: Array<LifecycleLoadEvent> = []
    for (const owner of model.owners) {
      if (!owner.aborted) replayLoads.push(startAttempt(model, owner, false))
    }
    judgeReplay(model)
    model.publications++
    model.trace.push({ type: `publication` })
    for (const load of replayLoads) {
      model.trace.push({
        type: `load`,
        id: load.id,
        demand: load.demand,
        syncRunGeneration: load.syncRunGeneration,
        replayGeneration: load.replayGeneration,
      })
    }
    setStatus(model)
    return {}
  }

  model.reach.add(`effective:unsubscribe`)
  for (const owner of model.owners)
    retireAttempt(model, owner, { unload: true })
  model.owners.length = 0
  model.unsubscribed = true
  return {}
}

export const greenLifecycleHistoryArbitrary = fc.array(
  lifecycleCommandArbitrary,
  { minLength: 1, maxLength: 20 },
)

export const syncLifecycleHistoryArbitrary = fc.array(
  lifecycleCommandArbitrary,
  { minLength: 1, maxLength: 20 },
)

/**
 * The demand-change grammar: three demands, with `change` and `replace`.
 * Each history first requests all three demands in any order, names a
 * replacement, and truncates soon after. A few current settlements and then
 * a change meet the open replay, and a snapshot request right after the
 * change observes whether the replay still holds publication. The change
 * often retires the replacement and the third owner, keeping the replaced
 * one; a later `replace` may name another. The suffix weights
 * settlements and changes, the commands whose order decides the verdict;
 * every other lifecycle command stays legal anywhere.
 */
const anyDemand = fc.constantFrom<DemandName>(`a`, `b`, `c`)
type ReplaceCommand = Extract<LifecycleCommand, { type: `replace` }>
const replaceArbitrary: fc.Arbitrary<ReplaceCommand> = fc
  .tuple(anyDemand, anyDemand)
  .filter(([demand, replaced]) => demand !== replaced)
  .map(([demand, replaced]) => ({ type: `replace`, demand, replaced }))
const currentSettleArbitrary: fc.Arbitrary<LifecycleCommand> = fc
  .tuple(anyDemand, fc.constantFrom(`resolve` as const, `reject` as const))
  .map(([demand, outcome]) => settle(demand, `current`, `oldest`, outcome))
const demandChangeCommandArbitrary: fc.Arbitrary<LifecycleCommand> = fc.oneof(
  // A current acquisition's own outcome decides the verdict most often.
  { weight: 6, arbitrary: currentSettleArbitrary },
  {
    weight: 1,
    arbitrary: fc
      .record({
        demand: anyDemand,
        scope: fc.constantFrom(`current` as const, `obsolete` as const),
        age: fc.constantFrom(`oldest` as const, `newest` as const),
        outcome: fc.constantFrom(`resolve` as const, `reject` as const),
      })
      .map(({ demand, scope, age, outcome }) =>
        settle(demand, scope, age, outcome),
      ),
  },
  {
    // A change that keeps one owner can leave it to a failed verdict.
    weight: 3,
    arbitrary: fc
      .tuple(anyDemand, anyDemand)
      .filter(([first, second]) => first !== second)
      .map(([first, second]): LifecycleCommand => ({
        type: `change`,
        release: [first, second],
      })),
  },
  {
    weight: 1,
    arbitrary: fc
      .shuffledSubarray<DemandName>([`a`, `b`, `c`], { minLength: 3 })
      .map((release): LifecycleCommand => ({ type: `change`, release })),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(
        fc.constantFrom(
          `request` as const,
          `release` as const,
          `abort` as const,
        ),
        anyDemand,
      )
      .map(([type, demand]): LifecycleCommand => ({ type, demand })),
  },
  { weight: 1, arbitrary: replaceArbitrary },
  {
    weight: 1,
    arbitrary: fc.constantFrom<LifecycleCommand>(
      { type: `truncate` },
      { type: `cleanup` },
      { type: `restart` },
      { type: `unsubscribe` },
    ),
  },
)

// A change that retires a replacement and another owner, but keeps the owner
// it replaces, is the shape whose verdict depends on judging once.
function changeArbitrary(
  replace: ReplaceCommand,
): fc.Arbitrary<LifecycleCommand> {
  const other = ([`a`, `b`, `c`] as const).find(
    (demand) => demand !== replace.demand && demand !== replace.replaced,
  )!
  return fc.oneof(
    {
      weight: 2,
      arbitrary: fc.constantFrom<LifecycleCommand>(
        { type: `change`, release: [other, replace.demand] },
        { type: `change`, release: [replace.demand, other] },
      ),
    },
    { weight: 2, arbitrary: demandChangeCommandArbitrary },
  )
}

export const demandChangeLifecycleHistoryArbitrary: fc.Arbitrary<
  Array<LifecycleCommand>
> = replaceArbitrary.chain((replace) =>
  fc
    .tuple(
      fc.shuffledSubarray<LifecycleCommand>(
        [
          { type: `request`, demand: `a` },
          { type: `request`, demand: `b` },
          { type: `request`, demand: `c` },
        ],
        { minLength: 3 },
      ),
      fc.array(demandChangeCommandArbitrary, { maxLength: 2 }),
      // Each demand's current acquisition may settle once, in any order.
      fc
        .tuple(
          ...([`a`, `b`, `c`] as const).map((demand) =>
            fc
              .constantFrom(`resolve` as const, `reject` as const, undefined)
              .map(
                (outcome) =>
                  outcome && settle(demand, `current`, `oldest`, outcome),
              ),
          ),
        )
        .chain((settles) => {
          const present = settles.filter((command) => command !== undefined)
          return fc.shuffledSubarray(present, { minLength: present.length })
        }),
      changeArbitrary(replace),
      // A snapshot request observes whether the replay still holds
      // publication.
      anyDemand.map((demand): LifecycleCommand => ({
        type: `request`,
        demand,
      })),
      fc.array(demandChangeCommandArbitrary, { maxLength: 6 }),
    )
    .map(([requests, before, settles, change, request, after]) => [
      ...requests,
      replace,
      ...before,
      { type: `truncate` },
      ...settles,
      change,
      request,
      ...after,
    ]),
)

/**
 * The shrunk lazy-join trace: `b` replaces `a`, the replay loads `b` and
 * fails `a`, and one change retires `c`, whose replay load is still pending,
 * and then `b`. Judged after `c` alone, `b` still covers `a` and the replay
 * would publish; judged after the whole change, `a` is held and failed, so
 * the replay fails and a later snapshot stays private.
 */
export const changeRetiresReplacementHistory: ReadonlyArray<LifecycleCommand> =
  [
    { type: `request`, demand: `a` },
    { type: `request`, demand: `b` },
    { type: `request`, demand: `c` },
    { type: `replace`, demand: `b`, replaced: `a` },
    { type: `truncate` },
    {
      type: `settle`,
      demand: `b`,
      scope: `current`,
      age: `oldest`,
      outcome: `resolve`,
    },
    {
      type: `settle`,
      demand: `a`,
      scope: `current`,
      age: `oldest`,
      outcome: `reject`,
    },
    { type: `change`, release: [`c`, `b`] },
    { type: `request`, demand: `c` },
  ]

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

/**
 * A demand created while its Collection is cleaned up waits for the next sync
 * run's evidence. An eager source supplies that evidence through Collection
 * readiness and starts no physical acquisition. An on-demand source supplies
 * it through one settled acquisition. Either mode must reconcile the complete
 * replacement rows before the direct subscription's `onLoadSubsetResult`
 * promise fulfills.
 *
 * These cases are a bounded history grammar, not a projection of the
 * subscription implementation. Explicit and default eager configuration must
 * have the same behavior. Empty and nonempty replacements must remove an older
 * public row. An optional eager loader proves that eager mode bypasses it; the
 * absent-loader cases preserve the valid Query Collection boundary. Truncate
 * can revise the restarted run's private replacement, and `error` can pause it
 * for legal same-run recovery; neither is eager readiness. The model predicts
 * only the cleanup-detached `onLoadSubsetResult` promise settlement,
 * subscriber-applied rows, subscription readiness, Collection status, and
 * physical acquisition count. Public preload failure, demands first admitted
 * after restart, terminal failure, retired owners, and asynchronous
 * acquisitions remain outside this focused account.
 */
export type CleanedRestartDemandCase = {
  syncMode: `default-eager` | `eager` | `on-demand`
  loader: `absent` | `present`
  replacement: `empty` | `row`
  interruption: `none` | `truncate` | `failed-then-reload`
}

export const cleanedRestartDemandCases: ReadonlyArray<CleanedRestartDemandCase> =
  [
    ...([`empty`, `row`] as const).flatMap((replacement) =>
      ([`default-eager`, `eager`] as const).flatMap((syncMode) =>
        ([`absent`, `present`] as const).flatMap((loader) =>
          ([`none`, `truncate`, `failed-then-reload`] as const).map(
            (interruption) => ({
              syncMode,
              loader,
              replacement,
              interruption,
            }),
          ),
        ),
      ),
    ),
    ...([`empty`, `row`] as const).map((replacement) => ({
      syncMode: `on-demand` as const,
      loader: `present` as const,
      replacement,
      interruption: `none` as const,
    })),
  ]

export function expectedCleanedRestartDemand(
  history: CleanedRestartDemandCase,
): {
  beforeEagerReady?: {
    physicalAcquisitions: 0
    result: `pending`
    status: `loadingSubset`
    collectionStatus: `loading`
  }
  afterInterruption?: {
    physicalAcquisitions: 0
    result: `pending`
    status: `loadingSubset`
    collectionStatus: `loading` | `error`
  }
  settled: {
    physicalAcquisitions: number
    result: `fulfilled`
    status: `ready`
    rows: Array<{ id: string }>
    collectionStatus: `ready`
  }
} {
  return {
    ...(history.syncMode !== `on-demand`
      ? {
          beforeEagerReady: {
            physicalAcquisitions: 0 as const,
            result: `pending` as const,
            status: `loadingSubset` as const,
            collectionStatus: `loading` as const,
          },
        }
      : {}),
    ...(history.syncMode !== `on-demand` && history.interruption !== `none`
      ? {
          afterInterruption: {
            physicalAcquisitions: 0 as const,
            result: `pending` as const,
            status: `loadingSubset` as const,
            collectionStatus:
              history.interruption === `failed-then-reload`
                ? (`error` as const)
                : (`loading` as const),
          },
        }
      : {}),
    settled: {
      physicalAcquisitions: history.syncMode === `on-demand` ? 1 : 0,
      result: `fulfilled`,
      status: `ready`,
      rows: history.replacement === `row` ? [{ id: `replacement` }] : [],
      collectionStatus: `ready`,
    },
  }
}

/**
 * Publication deferral is outside acquisition ownership above. These commands
 * project only its sync-run boundary and later subscriber batches. The first
 * run's nested handles can outlive cleanup; the restarted run is independent.
 */
export type DeferralLifecycleCommand =
  | { type: `open`; handle: `outer` | `inner` | `current` }
  | {
      type: `close`
      handle: `outer` | `inner` | `current`
      outcome: `publish` | `discard`
    }
  | { type: `write`; key: `a` | `c` | `d` }
  | { type: `cleanup` }
  | { type: `restart` }
  | { type: `subscribe` }

type OldHandleClose =
  | `never`
  | `before-current`
  | `during-current-publish`
  | `during-current-discard`

export const deferralCleanupHistories = (
  [`publish`, `discard`] as const
).flatMap((innerOutcome) =>
  (
    [
      `never`,
      `before-current`,
      `during-current-publish`,
      `during-current-discard`,
    ] as ReadonlyArray<OldHandleClose>
  ).flatMap((oldHandleClose) =>
    ([`publish`, `discard`] as const).flatMap((currentOutcome) =>
      ([1, 2] as const).map((rowCount) => ({
        name: `${innerOutcome}:old-${oldHandleClose}:${currentOutcome}:${rowCount}-rows`,
        commands: [
          { type: `open`, handle: `outer` },
          { type: `write`, key: `a` },
          { type: `open`, handle: `inner` },
          { type: `close`, handle: `inner`, outcome: innerOutcome },
          { type: `cleanup` },
          { type: `restart` },
          ...(oldHandleClose === `before-current`
            ? [{ type: `close`, handle: `outer`, outcome: `publish` }]
            : []),
          { type: `subscribe` },
          { type: `open`, handle: `current` },
          { type: `write`, key: `c` },
          ...(rowCount === 2 ? [{ type: `write`, key: `d` }] : []),
          ...(oldHandleClose === `during-current-publish` ||
          oldHandleClose === `during-current-discard`
            ? [
                {
                  type: `close`,
                  handle: `outer`,
                  outcome:
                    oldHandleClose === `during-current-publish`
                      ? `publish`
                      : `discard`,
                },
              ]
            : []),
          { type: `close`, handle: `current`, outcome: currentOutcome },
        ] as ReadonlyArray<DeferralLifecycleCommand>,
      })),
    ),
  ),
)

// A fresh run publishes only its own writes when its deferral closes. This
// reference ignores production depth, revision, queue, and discard fields.
export function expectedDeferralBatches(
  commands: ReadonlyArray<DeferralLifecycleCommand>,
): Array<
  Array<{
    type: `insert`
    key: `c` | `d`
    value: { id: `c` | `d`; value: number }
  }>
> {
  const restart = commands.findIndex(({ type }) => type === `restart`)
  const writes = commands
    .slice(restart + 1)
    .flatMap((command) =>
      command.type === `write` && command.key !== `a` ? [command.key] : [],
    )
  const close = commands.find(
    (command) => command.type === `close` && command.handle === `current`,
  )
  return close?.type === `close` && close.outcome === `publish`
    ? [
        writes.map((key) => ({
          type: `insert`,
          key,
          value: { id: key, value: key.charCodeAt(0) },
        })),
      ]
    : []
}
