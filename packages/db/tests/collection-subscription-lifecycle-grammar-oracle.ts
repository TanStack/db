import { fc } from '@fast-check/vitest'
import { declareOracle } from './oracle-declaration.js'

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
 * lease. `abort` cancels the owner's current acquisition attempt but does not
 * retire the owner. An abort ends the load (maintainer decision): from that
 * moment the attempt holds no readiness, no replay waits for it, and a later
 * settlement reports nothing. A replay that replaces an attempt aborts it
 * too. `settle` changes an acquisition attempt. `truncate` starts a private
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
 * Fixed histories name important paths. Generated histories explore adjacent
 * legal commands with fixed and random seeds. The drivers compare production
 * loads, unloads, results, status, errors, and publication against this trace.
 *
 * A demand change is one step (ARCHITECTURE normative law 9, "Publication";
 * replay failure is in the "Replay participants and failure" section). Its
 * `change` command retires several logical owners at once, as a lazy join's
 * demand change retires several segments, and the model judges
 * an open replay once, after every owner in the change has retired. Its
 * `replace` command marks one held owner as the replacement for another's
 * coverage, as a lazy join's fragmented-churn replacement does (ARCHITECTURE
 * normative law 10, "Initial demand"; the source rule is in the "Source
 * cancellation and applied settlement" section): the replacement requests the
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
 * Ordinary subscription admission may start one sync run. Cleanup from its
 * loading or ready callback retires that start; admission must not retry it.
 * A loading callback runs before the adapter enters, so it can prevent even
 * that first adapter invocation. A pending adapter cleanup retains the ready
 * public status until cleanup settles, as specified in the glossary.
 *
 * These finite histories and their independent judgment are shared by the core
 * admission driver and the real React abandoned-render receiving driver. A
 * pending cleanup is legal only after ready, when an adapter resource exists.
 */
export const subscriberStartCleanupHistories = [
  { cleanupAt: `none`, cleanupPending: false },
  { cleanupAt: `loading`, cleanupPending: false },
  { cleanupAt: `ready`, cleanupPending: false },
  { cleanupAt: `ready`, cleanupPending: true },
] as const

export function modelSubscriberStartCleanup({
  cleanupAt,
  cleanupPending,
}: (typeof subscriberStartCleanupHistories)[number]) {
  const starts = cleanupAt === `loading` ? 0 : 1
  const cleanups = cleanupAt === `ready` ? 1 : 0
  const statusOnReturn =
    cleanupAt === `none` || cleanupPending ? `ready` : `cleaned-up`
  const statusAfterCleanup = cleanupAt === `none` ? `ready` : `cleaned-up`
  const statusesOnReturn: Array<`loading` | `ready` | `cleaned-up`> = [
    `loading`,
  ]
  if (starts) statusesOnReturn.push(`ready`)
  if (statusOnReturn === `cleaned-up`) statusesOnReturn.push(`cleaned-up`)
  const statusesAfterCleanup = cleanupPending
    ? [...statusesOnReturn, `cleaned-up`]
    : statusesOnReturn
  return {
    starts,
    cleanups,
    statusOnReturn,
    statusAfterCleanup,
    statusesOnReturn,
    statusesAfterCleanup,
  }
}

/**
 * Resumption transfers one logical subscription from deferred to acquiring.
 * Unsubscription at any startup callback removes that owner permanently.
 * Cleanup can additionally invalidate the sync run, before or after adapter
 * entry. Notification happens only for a transfer that actually committed;
 * an unsubscribe from that notification contributes its matching decrement.
 * This token-count judgment uses no production acquisition state machine.
 */
export const subscriberResumeRetirementHistories = (
  [`none`, `loading`, `ready`, `subscribers`] as const
).flatMap((retireAt) =>
  (retireAt === `none` ? [false] : [false, true]).map((cleanup) => ({
    retireAt,
    cleanup,
  })),
)

export function modelSubscriberResumeRetirement({
  retireAt,
  cleanup,
}: (typeof subscriberResumeRetirementHistories)[number]) {
  return {
    starts: cleanup && retireAt === `loading` ? 0 : 1,
    acquiring: retireAt === `none` ? 1 : 0,
    // Cleanup forgets first demand when no acquiring owner survives.
    subscriberOrPreload: !cleanup || retireAt === `none`,
    counts:
      retireAt === `none` ? [1] : retireAt === `subscribers` ? [1, 0] : [],
  }
}

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
  // Aborted before it settled: the abort ended the load, so its outcome
  // decides nothing.
  endedByAbort: boolean
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
  // The lifecycle table row that decided this command.
  transition?: string
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

/**
 * ## Transition table
 *
 * The reducer is an extended state machine. Its phase is a function of two
 * model flags: `unsubscribed` (this subscription has ended) and `active` (the
 * Collection's sync run is live). Each row of `lifecycleTable` fires when its
 * event matches the command, the phase is one of its `from` phases, and its
 * guard holds. Rows are tried in order: an effective row precedes the noop row
 * that catches the same event when its guard fails. The engine asserts that
 * each row ends in its `to` phase, so a row whose effect disagrees with the
 * table fails at once.
 *
 * Rows do not write reach. `lifecycleReach` declares each reach label as a
 * predicate over one step: the row that fired, the command, state captured
 * before the effect, the facts the effect recorded, and the attempts it
 * created. Transition coverage is therefore a property of the table: a label
 * `effective:<event>` or `noop:<event>` names the kind of row that fired.
 *
 * `reads` and `writes` list the extended-state variables that a row's guard or
 * effect reads or changes. Every row also reads `phase`, because its `from`
 * dispatch does. Two rows interact when the second reads a variable the first
 * writes. Coverage measures those adjacent pairs.
 */

export type LifecyclePhase =
  `live` | `cleaned-up` | `unsubscribed` | `unsubscribed-cleaned-up`

export type LifecycleStateVariable =
  | `phase`
  | `owners`
  | `attempts`
  | `generations`
  | `publication-barrier`
  | `collection-status`

export type ReplayVerdict = `closed` | `open` | `failed` | `succeeded`

/** Facts an effect records for the reach predicates. They are data, not reach. */
export type LifecycleStepFacts = {
  // `change`: the replay verdict after each release, in release order.
  releaseVerdicts: Array<ReplayVerdict>
  // This step's replay judgment closed the barrier on a failed owner.
  replayFailedOwnerDecided: boolean
}

export function lifecyclePhase(model: LifecycleModel): LifecyclePhase {
  if (model.unsubscribed)
    return model.active ? `unsubscribed` : `unsubscribed-cleaned-up`
  return model.active ? `live` : `cleaned-up`
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
// replaces, so their failure does not fail the replay; a replacement whose
// attempt an abort ended before it settled loaded nothing, so it covers
// nothing (law 10: an obsolete replacement cannot retire coverage). An owner
// without a current acquisition attempt owes nothing, as before, and so does
// one whose attempt was aborted: the abort ended its load, so it decides
// nothing.
function replacementSucceeded(model: LifecycleModel): boolean {
  const loaded = ({ attemptId }: LifecycleOwner) =>
    attemptId === undefined ||
    (model.attempts[attemptId]!.outcome === `resolve` &&
      !model.attempts[attemptId]!.endedByAbort)
  const owesNothing = ({ attemptId }: LifecycleOwner) =>
    attemptId === undefined || model.attempts[attemptId]!.endedByAbort
  return (
    !model.attempts.some(
      ({ gating, inReplacement }) => gating && inReplacement,
    ) &&
    model.owners.every(
      (owner) =>
        loaded(owner) ||
        owesNothing(owner) ||
        model.owners.some(
          (replacement) =>
            replacement.replaces?.includes(owner.id) && loaded(replacement),
        ),
    )
  )
}

// Judge an open replay: success closes the publication barrier. Returns
// whether the closing judgment decided a failed owner.
function judgeReplay(model: LifecycleModel): boolean {
  if (!model.publicationBarrierOpen || !replacementSucceeded(model))
    return false
  model.publicationBarrierOpen = false
  return model.owners.some(
    ({ attemptId }) =>
      attemptId !== undefined &&
      model.attempts[attemptId]!.outcome === `reject` &&
      !model.attempts[attemptId]!.endedByAbort,
  )
}

// What judging the open replay now would decide. Only `change` asks, to name
// the histories in which judging between its releases would differ.
function replayVerdict(model: LifecycleModel): ReplayVerdict {
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
    endedByAbort: false,
    failure: model.failureForAttempt(id),
  }
  model.attempts.push(attempt)
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
  options: { unload: boolean; trace?: boolean },
): void {
  if (owner.attemptId === undefined) return
  const attempt = model.attempts[owner.attemptId]
  owner.attemptId = undefined
  if (!attempt) throw new Error(`model lost attempt`)
  attempt.gating = false
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

// An abort ends the load: it stops gating at once, whether the adapter
// settles it promptly (`reject`) or later (`manual`).
function abortAttempt(model: LifecycleModel, attempt: LifecycleAttempt): void {
  attempt.aborted = true
  if (attempt.outcome === undefined) attempt.endedByAbort = true
  attempt.gating = false
  if (model.cancellation === `reject` && attempt.outcome === undefined)
    attempt.outcome = `reject`
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

// A logical owner admitted by `request`. An active Collection starts its
// acquisition; a cleaned-up one holds the owner without claiming one.
function admitRequest(
  model: LifecycleModel,
  demand: DemandName,
  acquires: boolean,
): LifecycleEffect {
  const owner: LifecycleOwner = {
    id: model.nextOwnerId++,
    demand,
    aborted: false,
  }
  model.owners.push(owner)
  // A waiting owner gets a promise now, without claiming an acquisition.
  const result = acquires
    ? {
        attemptId: startAttempt(model, owner).id,
        resultKind:
          model.acquisitionMode === `async-pending`
            ? (`promise` as const)
            : (`true` as const),
      }
    : ({ attemptId: `unacquired`, resultKind: `promise` } as const)
  model.results.push(result)
  model.trace.push({ type: `result`, ...result })
  setStatus(model)
  if (!model.publicationBarrierOpen) {
    model.publications++
    model.trace.push({ type: `publication` })
  }
  return { ownerId: owner.id, requestResult: true }
}

// Replay setup is asynchronous even when every acquisition is synchronous or
// canceled. Logical owners queue setup; live owners start acquisitions.
function startReplay(model: LifecycleModel, facts: LifecycleStepFacts): void {
  model.replayGeneration++
  setStatus(model, model.owners.length > 0)
  // A canceled-only truncate starts no new work. It still opens the
  // barrier when a prior replay's current attempt was pending; aborting that
  // attempt below ends its wait.
  model.publicationBarrierOpen =
    model.owners.some(({ aborted }) => !aborted) ||
    model.attempts.some(({ gating, inReplacement }) => gating && inReplacement)
  for (const owner of model.owners) {
    // Replacing an acquisition is not releasing its logical owner, but it
    // ends the replaced load: it holds neither readiness nor publication.
    retireAttempt(model, owner, { unload: true })
    if (!owner.aborted) startAttempt(model, owner)
  }
  facts.replayFailedOwnerDecided = judgeReplay(model)
  setStatus(model)
}

/** The command's type, or the wildcard for every command. */
type LifecycleEvent = LifecycleCommand[`type`] | `*`
type CommandFor<E extends LifecycleEvent> = E extends `*`
  ? LifecycleCommand
  : Extract<LifecycleCommand, { type: E }>

export type LifecycleRow = {
  id: string
  kind: `effect` | `noop`
  from: ReadonlyArray<LifecyclePhase>
  event: LifecycleEvent
  to: LifecyclePhase | `same`
  guard?: (model: LifecycleModel, command: LifecycleCommand) => boolean
  reads: ReadonlyArray<LifecycleStateVariable>
  writes: ReadonlyArray<LifecycleStateVariable>
  effect: (
    model: LifecycleModel,
    command: LifecycleCommand,
    facts: LifecycleStepFacts,
  ) => LifecycleEffect
  // The contract clause or dated decision for this row. A noop row cites no
  // contract clause: it encodes the grammar's convention that a command with
  // no target changes nothing.
  authority: string
}

type RowSpec<E extends LifecycleEvent> = {
  id: string
  from: ReadonlyArray<LifecyclePhase>
  event: E
  to: LifecyclePhase | `same`
  guard?: (model: LifecycleModel, command: CommandFor<E>) => boolean
  reads?: ReadonlyArray<LifecycleStateVariable>
  writes: ReadonlyArray<LifecycleStateVariable>
  effect: (
    model: LifecycleModel,
    command: CommandFor<E>,
    facts: LifecycleStepFacts,
  ) => LifecycleEffect
  authority: string
}

// The event dispatch selects the command type, so each row's typed command is
// the one the engine passes it.
function defineRow<E extends LifecycleEvent>(spec: RowSpec<E>): LifecycleRow {
  return {
    id: spec.id,
    kind: `effect`,
    from: spec.from,
    event: spec.event,
    to: spec.to,
    guard: spec.guard as LifecycleRow[`guard`],
    reads: spec.reads ?? [],
    writes: spec.writes,
    effect: spec.effect as LifecycleRow[`effect`],
    authority: spec.authority,
  }
}

function defineNoopRow<E extends LifecycleEvent>(spec: {
  id: string
  from: ReadonlyArray<LifecyclePhase>
  event: E
  reads: ReadonlyArray<LifecycleStateVariable>
  result?: LifecycleEffect
  authority: string
}): LifecycleRow {
  return {
    id: spec.id,
    kind: `noop`,
    from: spec.from,
    event: spec.event,
    to: `same`,
    reads: spec.reads,
    writes: [],
    effect: () => spec.result ?? {},
    authority: spec.authority,
  }
}

const ENDED: ReadonlyArray<LifecyclePhase> = [
  `unsubscribed`,
  `unsubscribed-cleaned-up`,
]
const SUBSCRIBED: ReadonlyArray<LifecyclePhase> = [`live`, `cleaned-up`]
const LIVE: ReadonlyArray<LifecyclePhase> = [`live`]
const CLEANED: ReadonlyArray<LifecyclePhase> = [`cleaned-up`]

/**
 * The lifecycle table. Rows are tried in order, so an effective row precedes
 * the noop row for its event. Authority cites the header of the grammar file, ARCHITECTURE
 * normative laws (law N), the glossary, or a code comment that states the rule. The noop rows and the inferences marked "inference" have
 * no contract clause: they follow the grammar's convention.
 */
export const lifecycleTable: ReadonlyArray<LifecycleRow> = [
  // An ended subscription keeps only the Collection's sync-run lifecycle.
  defineRow({
    id: `ended-cleanup`,
    from: [`unsubscribed`],
    event: `cleanup`,
    to: `unsubscribed-cleaned-up`,
    writes: [`phase`, `collection-status`],
    effect: (model) => {
      model.active = false
      model.collectionStatus = `cleaned-up`
      return { requestResult: false }
    },
    authority: `Header: \`cleanup\` ends the current sync run. An unsubscribed subscription keeps the Collection's sync run, so this cleanup still applies. Adapter cleanup timing is outside this grammar.`,
  }),
  defineRow({
    id: `ended-restart`,
    from: [`unsubscribed-cleaned-up`],
    event: `restart`,
    to: `unsubscribed`,
    writes: [
      `phase`,
      `generations`,
      `publication-barrier`,
      `collection-status`,
    ],
    effect: (model) => {
      model.active = true
      model.syncRunGeneration++
      model.replayGeneration = 0
      model.publicationBarrierOpen = false
      model.collectionStatus = `ready`
      return { requestResult: false }
    },
    authority: `Header: \`restart\` starts a new sync run; unsubscribe does not end the Collection's sync run, so restart applies only after cleanup.`,
  }),
  defineNoopRow({
    id: `ended-noop`,
    from: ENDED,
    event: `*`,
    reads: [],
    result: { requestResult: false },
    authority: `none: no contract clause. Unsubscribe ends this subscription, so a later command has no target. Grammar convention, flagged.`,
  }),

  defineRow({
    id: `request-live`,
    from: LIVE,
    event: `request`,
    to: `same`,
    reads: [`publication-barrier`],
    writes: [`owners`, `attempts`],
    effect: (model, command) => admitRequest(model, command.demand, true),
    authority: `Header: "a request combines a new logical owner with any acquisition attempt it starts."`,
  }),
  defineRow({
    id: `request-cleaned`,
    from: CLEANED,
    event: `request`,
    to: `same`,
    reads: [`publication-barrier`],
    writes: [`owners`],
    effect: (model, command) => admitRequest(model, command.demand, false),
    authority: `Header: a request admits a logical owner. A Collection that is cleaned up starts no attempt; the cleanedRestartDemandCases comment says a demand created while cleaned up waits for the next sync run's evidence.`,
  }),

  defineRow({
    id: `abort-owner`,
    from: SUBSCRIBED,
    event: `abort`,
    to: `same`,
    guard: (model, command) =>
      model.owners.some(
        ({ demand, aborted }) => demand === command.demand && !aborted,
      ),
    reads: [`owners`, `attempts`, `publication-barrier`],
    writes: [`owners`, `attempts`, `publication-barrier`],
    effect: (model, command, facts) => {
      const owner = model.owners.find(
        ({ demand, aborted }) => demand === command.demand && !aborted,
      )!
      owner.aborted = true
      if (owner.attemptId !== undefined) {
        const attempt = model.attempts[owner.attemptId]!
        abortAttempt(model, attempt)
        attempt.reportable = false
      }
      // The abort ends the attempt, so the replay is judged as after any
      // settlement: a held replacement can still cover it.
      facts.replayFailedOwnerDecided = judgeReplay(model)
      setStatus(model)
      return { ownerId: owner.id }
    },
    authority: `Header: "abort cancels the owner's current acquisition attempt but does not retire the owner"; "an abort ends the load" (maintainer decision), so the attempt holds no readiness and a later settlement reports nothing.`,
  }),
  defineNoopRow({
    id: `abort-noop`,
    from: SUBSCRIBED,
    event: `abort`,
    reads: [`owners`],
    authority: `none: no live owner for the demand. Grammar convention, flagged.`,
  }),

  defineRow({
    id: `release-owner`,
    from: SUBSCRIBED,
    event: `release`,
    to: `same`,
    guard: (model, command) =>
      model.owners.some(({ demand }) => demand === command.demand),
    reads: [`owners`, `attempts`, `publication-barrier`],
    writes: [`owners`, `attempts`, `publication-barrier`],
    effect: (model, command, facts) => {
      const owner = retireOwner(model, command.demand)!
      facts.replayFailedOwnerDecided = judgeReplay(model)
      setStatus(model)
      return { ownerId: owner.id }
    },
    authority: `Header: "release combines demand retirement with release of that owner's acquisition lease."`,
  }),
  defineNoopRow({
    id: `release-noop`,
    from: SUBSCRIBED,
    event: `release`,
    reads: [`owners`],
    authority: `none: no logical owner for the demand. Grammar convention, flagged.`,
  }),

  defineRow({
    id: `change-demands`,
    from: SUBSCRIBED,
    event: `change`,
    to: `same`,
    guard: (model, command) =>
      command.release.some((demand) =>
        model.owners.some((owner) => owner.demand === demand),
      ),
    reads: [`owners`, `attempts`, `publication-barrier`],
    writes: [`owners`, `attempts`, `publication-barrier`],
    effect: (model, command, facts) => {
      // Law 9: the change is one step. Every named owner retires first, and
      // the replay is judged once after the last. The verdicts between its
      // releases are recorded only to name the histories they would mislead.
      const retired: Array<LifecycleOwner> = []
      for (const demand of command.release) {
        const owner = retireOwner(model, demand)
        if (!owner) continue
        retired.push(owner)
        facts.releaseVerdicts.push(replayVerdict(model))
      }
      facts.replayFailedOwnerDecided = judgeReplay(model)
      setStatus(model)
      return { ownerIds: retired.map(({ id }) => id) }
    },
    authority: `ARCHITECTURE normative law 9 ("A demand change counts as one step"); header: \`change\` "retires several logical owners at once".`,
  }),
  defineNoopRow({
    id: `change-noop`,
    from: SUBSCRIBED,
    event: `change`,
    reads: [`owners`],
    authority: `none: no named demand has a logical owner. Grammar convention, flagged.`,
  }),

  defineRow({
    id: `replace-owner`,
    from: SUBSCRIBED,
    event: `replace`,
    to: `same`,
    guard: (model, command) =>
      model.owners.some(({ demand }) => demand === command.demand),
    reads: [`owners`],
    writes: [`owners`],
    effect: (model, command) => {
      const replacement = model.owners.find(
        ({ demand }) => demand === command.demand,
      )!
      replacement.replaces = model.owners
        .filter(({ demand }) => demand === command.replaced)
        .map(({ id }) => id)
      return { ownerId: replacement.id }
    },
    authority: `ARCHITECTURE normative law 10 ("A fragmented churn replacement retires prior coverage only after its union applies; failure preserves it"); header: \`replace\` "marks one held owner as the replacement".`,
  }),
  defineNoopRow({
    id: `replace-noop`,
    from: SUBSCRIBED,
    event: `replace`,
    reads: [`owners`],
    authority: `none: no logical owner for the replacement. Grammar convention, flagged.`,
  }),

  defineRow({
    id: `settle-attempt`,
    from: SUBSCRIBED,
    event: `settle`,
    to: `same`,
    guard: (model, command) => selectAttempt(model, command) !== undefined,
    reads: [`attempts`, `publication-barrier`],
    writes: [`attempts`, `publication-barrier`],
    effect: (model, command, facts) => {
      const attempt = selectAttempt(model, command)!
      attempt.outcome = command.outcome
      attempt.gating = false
      // A reject reports only while the attempt is reportable and was not
      // ended by an abort: a later outcome decides nothing.
      if (
        command.outcome === `reject` &&
        attempt.reportable &&
        !attempt.aborted
      ) {
        model.lastError = attempt.failure
        model.errors.push({ attemptId: attempt.id, error: attempt.failure })
        model.trace.push({ type: `error`, attemptId: attempt.id })
      }
      facts.replayFailedOwnerDecided = judgeReplay(model)
      setStatus(model)
      return { attemptId: attempt.id }
    },
    authority: `Header: "settle changes an acquisition attempt". A reject reports only while the attempt is reportable and not ended by an abort ("a later settlement reports nothing").`,
  }),
  defineNoopRow({
    id: `settle-noop`,
    from: SUBSCRIBED,
    event: `settle`,
    reads: [`attempts`],
    authority: `none: no open attempt matches the scope and age. Grammar convention, flagged.`,
  }),

  defineRow({
    id: `truncate-replay`,
    from: LIVE,
    event: `truncate`,
    to: `same`,
    reads: [`generations`, `owners`, `attempts`, `publication-barrier`],
    writes: [`generations`, `attempts`, `publication-barrier`],
    effect: (model, _command, facts) => {
      startReplay(model, facts)
      return {}
    },
    authority: `ARCHITECTURE normative law 9 (a truncate replacement stays private until work started by its active replay demands settles); header: "A replay that replaces an attempt aborts it too."`,
  }),
  defineNoopRow({
    id: `truncate-noop`,
    from: CLEANED,
    event: `truncate`,
    reads: [`phase`],
    authority: `inference from the cleanup sentence: no sync run is active, so a truncate has no replay to start. Flagged.`,
  }),

  defineRow({
    id: `cleanup-run`,
    from: LIVE,
    event: `cleanup`,
    to: `cleaned-up`,
    reads: [`owners`, `attempts`, `generations`],
    writes: [`attempts`, `publication-barrier`, `phase`, `collection-status`],
    effect: (model) => {
      for (const owner of model.owners)
        retireAttempt(model, owner, { unload: false })
      for (const attempt of model.attempts) attempt.gating = false
      model.active = false
      model.publicationBarrierOpen = false
      model.collectionStatus = `cleaned-up`
      setStatus(model)
      return {}
    },
    authority: `Header: \`cleanup\` "ends the current sync run"; ARCHITECTURE normative law 14: cleanup start closes restart admission.`,
  }),
  defineNoopRow({
    id: `cleanup-noop`,
    from: CLEANED,
    event: `cleanup`,
    reads: [`phase`],
    authority: `inference from the cleanup sentence: the sync run already ended. Flagged.`,
  }),

  defineRow({
    id: `restart-run`,
    from: CLEANED,
    event: `restart`,
    to: `live`,
    reads: [`owners`, `phase`],
    writes: [
      `phase`,
      `generations`,
      `attempts`,
      `publication-barrier`,
      `collection-status`,
    ],
    effect: (model, _command, facts) => {
      model.active = true
      model.syncRunGeneration++
      model.replayGeneration = 0
      model.publicationBarrierOpen = model.owners.some(
        ({ aborted }) => !aborted,
      )
      model.collectionStatus = `ready`
      setStatus(model, model.owners.length > 0)
      const replayLoads: Array<LifecycleLoadEvent> = []
      for (const owner of model.owners) {
        if (!owner.aborted) replayLoads.push(startAttempt(model, owner, false))
      }
      facts.replayFailedOwnerDecided = judgeReplay(model)
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
    },
    authority: `Header: \`restart\` "starts a new sync run"; an aborted owner is not restarted ("an abort ends the load").`,
  }),
  defineNoopRow({
    id: `restart-noop`,
    from: LIVE,
    event: `restart`,
    reads: [`phase`],
    authority: `inference from the restart sentence: the sync run is still active. Flagged.`,
  }),

  defineRow({
    id: `unsubscribe-live`,
    from: LIVE,
    event: `unsubscribe`,
    to: `unsubscribed`,
    reads: [`owners`, `attempts`],
    writes: [`owners`, `attempts`, `phase`],
    effect: (model) => {
      for (const owner of model.owners)
        retireAttempt(model, owner, { unload: true })
      model.owners.length = 0
      model.unsubscribed = true
      return {}
    },
    authority: `Header: "unsubscribe ends this subscription, retires its logical subset owners, and releases their acquisition leases. It does not end the Collection's sync run."`,
  }),
  defineRow({
    id: `unsubscribe-cleaned`,
    from: CLEANED,
    event: `unsubscribe`,
    to: `unsubscribed-cleaned-up`,
    reads: [`owners`, `attempts`],
    writes: [`owners`, `attempts`, `phase`],
    effect: (model) => {
      for (const owner of model.owners)
        retireAttempt(model, owner, { unload: true })
      model.owners.length = 0
      model.unsubscribed = true
      return {}
    },
    authority: `Header: as unsubscribe-live. The cleaned-up Collection keeps its status.`,
  }),
]

/** Reach labels, each a predicate over one step. */
export type LifecycleStep = {
  command: LifecycleCommand
  row: LifecycleRow
  before: {
    attemptCount: number
    duplicateOwner: boolean
    overlappingReplay: boolean
    partialGenerationSupersession: boolean
  }
  facts: LifecycleStepFacts
  attempts: ReadonlyArray<LifecycleAttempt>
}

function attemptLabels(attempt: LifecycleAttempt): Array<string> {
  const sync = attempt.syncRunGeneration === 0 ? `initial` : `restarted`
  const replay = attempt.replayGeneration === 0 ? `initial` : `replayed`
  return [
    `attempt-sync-run:${sync}`,
    `attempt-replay:${replay}`,
    `attempt-location:${sync}:${replay}`,
  ]
}

function settleLabels(command: Extract<LifecycleCommand, { type: `settle` }>) {
  return [
    `settle-scope:${command.scope}`,
    `settle-age:${command.age}`,
    `settle-outcome:${command.outcome}`,
    `settle:${command.scope}:${command.age}:${command.outcome}`,
  ]
}

export const lifecycleReach: ReadonlyArray<
  (step: LifecycleStep) => ReadonlyArray<string>
> = [
  ({ command, row }) => [
    `command:${command.type}`,
    `${row.kind === `effect` ? `effective` : `noop`}:${command.type}`,
  ],
  ({ before, row }) =>
    row.id === `request-live` || row.id === `request-cleaned`
      ? before.duplicateOwner
        ? [`duplicate-owner`]
        : []
      : [],
  ({ row }) => (row.id === `request-cleaned` ? [`request-while-cleaned`] : []),
  ({ before, row }) =>
    row.id === `truncate-replay` && before.overlappingReplay
      ? [`overlapping-replay`]
      : [],
  ({ before, row }) =>
    row.id === `cleanup-run` && before.partialGenerationSupersession
      ? [`partial-generation-supersession`]
      : [],
  ({ command, row }) =>
    row.kind === `effect` && command.type === `settle`
      ? settleLabels(command)
      : [],
  ({ attempts }) => attempts.flatMap(attemptLabels),
  ({ facts }) =>
    facts.replayFailedOwnerDecided ? [`replacement-decides-failed-owner`] : [],
  ({ facts, row }) => {
    if (row.id !== `change-demands`) return []
    const verdicts = facts.releaseVerdicts
    const verdict = verdicts.at(-1)!
    const between = verdicts.slice(0, -1)
    const labels: Array<string> = []
    if (verdicts.length > 1 && verdict !== `closed`)
      labels.push(`change:several-owners-during-replay`)
    if (verdict === `failed` && between.includes(`succeeded`))
      labels.push(`change:between-releases-would-publish`)
    if (verdict === `succeeded` && between.includes(`failed`))
      labels.push(`change:between-releases-would-fail`)
    return labels
  },
]

function observeBefore(
  model: LifecycleModel,
  command: LifecycleCommand,
): LifecycleStep[`before`] {
  const current = model.attempts.filter(
    ({ syncRunGeneration }) => syncRunGeneration === model.syncRunGeneration,
  )
  return {
    attemptCount: model.attempts.length,
    duplicateOwner:
      command.type === `request` &&
      model.owners.some(({ demand }) => demand === command.demand),
    overlappingReplay:
      command.type === `truncate` &&
      model.replayGeneration > 0 &&
      current.some(({ outcome }) => outcome === undefined),
    partialGenerationSupersession:
      command.type === `cleanup` &&
      current.some(({ outcome }) => outcome !== undefined) &&
      current.some(({ outcome }) => outcome === undefined),
  }
}

/** Pure reference transition. It never reads adapter callbacks or SUT state. */
export function reduceLifecycle(
  model: LifecycleModel,
  command: LifecycleCommand,
): LifecycleEffect {
  const phase = lifecyclePhase(model)
  const row = lifecycleTable.find(
    (candidate) =>
      candidate.from.includes(phase) &&
      (candidate.event === `*` || candidate.event === command.type) &&
      (candidate.guard?.(model, command) ?? true),
  )
  if (!row)
    throw new Error(`lifecycle table has no row for ${phase} ${command.type}`)
  const before = observeBefore(model, command)
  const facts: LifecycleStepFacts = {
    releaseVerdicts: [],
    replayFailedOwnerDecided: false,
  }
  const effect = row.effect(model, command, facts)
  if (row.to !== `same` && lifecyclePhase(model) !== row.to)
    throw new Error(
      `lifecycle row ${row.id} ended in ${lifecyclePhase(model)}, not ${row.to}`,
    )
  const step: LifecycleStep = {
    command,
    row,
    before,
    facts,
    attempts: model.attempts.slice(before.attemptCount),
  }
  for (const label of lifecycleReach.flatMap((rule) => rule(step)))
    model.reach.add(label)
  return { ...effect, transition: row.id }
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
 * # How often does a reload acquire a demand parked behind a failed first load?
 *
 * While an on-demand Collection shows a failed first load, a subscription's
 * new demand parks: it is held, and no request reaches the adapter. A reload
 * retires the failed sync run and replays the demand (ARCHITECTURE law 16);
 * the new run's readiness restarts the detached demand; and a snapshot that
 * the new run commits replaces the rows and replays the demand again. Core
 * binds each acquisition to the current replay attempt ("Replay participants
 * and failure"), and a replay attempt loads each demand it replays once. So
 * every trigger that names the same attempt shares one acquisition: one
 * `loadSubset` per attempt that starts work, and an `unloadSubset` only for
 * an acquisition that a later attempt replaced.
 *
 * Histories (`newRun`), inside the new run's `sync()` unless named: it marks
 * ready and commits nothing else; it marks ready and then commits a
 * snapshot; it commits a snapshot and then marks ready; or it marks ready
 * and commits a snapshot after the first load settled. A snapshot inside
 * `sync()` supersedes the reload's replay before that replay starts any
 * request, so readiness and the snapshot name one attempt. A later snapshot
 * is a newer attempt: it replaces the settled acquisition and loads again.
 *
 * The model predicts the adapter's loads and unloads, the settlement of the
 * parked request's `onLoadSubsetResult` promise, and the subscription's and
 * the Collection's status. Rows, asynchronous failures, and a second reload
 * are outside this account.
 */
export type ParkedReloadDemandCase = {
  newRun:
    | `ready`
    | `ready-then-snapshot`
    | `snapshot-then-ready`
    | `ready-then-later-snapshot`
}

export const parkedReloadDemandCases: ReadonlyArray<ParkedReloadDemandCase> = (
  [
    `ready`,
    `ready-then-snapshot`,
    `snapshot-then-ready`,
    `ready-then-later-snapshot`,
  ] as const
).map((newRun) => ({ newRun }))

export function expectedParkedReloadDemand({
  newRun,
}: ParkedReloadDemandCase): {
  loads: number
  unloads: number
  result: `fulfilled`
  status: `ready`
  collectionStatus: `ready`
} {
  // Attempts that start work: the reload's replay, which a snapshot inside
  // `sync()` supersedes before it begins, and a later snapshot's replay.
  const attempts = newRun === `ready-then-later-snapshot` ? 2 : 1
  return {
    loads: attempts,
    // Each later attempt replaces the acquisition of the one before it.
    unloads: attempts - 1,
    result: `fulfilled`,
    status: `ready`,
    collectionStatus: `ready`,
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

/**
 * A render sync-start handoff reports exceptions from the starts it performs.
 * A Collection's recorded failure is a readable status, not evidence that this
 * handoff threw. The ordinary React contract exposes that status as a flag;
 * an explicit preload separately owns reporting its source startup failure.
 *
 * The status follows the glossary. A `fail()` before Collection readiness is a
 * loading error: status `error` (`isLoadingError`). A throwing sync function
 * is a crash: status `crashed` (`isCrashed`), whichever start ran it. Origin
 * decides only who owns the exception, never which status the source shows.
 *
 * This projection retains error origin and timing because either changes the
 * permitted synchronous result. It does not model source rows or recovery.
 * Before-release histories use independent demand to release the same gate.
 */
export type StartHandoffHistory = {
  outcome: `ready` | `fail` | `throw`
  timing: `before-release` | `during-release`
  cause: `error` | `undefined`
}

export function expectedStartHandoff(history: StartHandoffHistory) {
  return {
    throws: history.outcome === `throw` && history.timing === `during-release`,
    status:
      history.outcome === `ready`
        ? `ready`
        : history.outcome === `fail`
          ? `error`
          : `crashed`,
    starts: 1,
  } as const
}

declareOracle({
  model: [
    createLifecycleModel,
    reduceLifecycle,
    expectedCleanedRestartDemand,
    expectedParkedReloadDemand,
    expectedDeferralBatches,
    expectedStartHandoff,
    modelSubscriberStartCleanup,
  ],
  grammar: [parkedReloadDemandCases],
})
