import { fc } from '@fast-check/vitest'
import {
  compareSource,
  createSessionModel,
  persistedPeerOnDemandGrammar,
  planAction,
} from './sync-metadata-session-oracle.js'
import type {
  SessionAction,
  SessionDriver,
  SessionMismatch,
} from './sync-metadata-session-oracle.js'

/**
 * Recovery has three separate boundaries: a replay response is delivered,
 * storage is read, and the captured rows are supplied for application.
 * D15 governs completed storage observations; D9/D18 keep an implicit keep
 * distinct from a durable write. Cleanup invalidates the sync run (glossary).
 *
 * This grammar adds bounded schedules to the session oracle, using its same
 * independent model, action planning and source comparison. It introduces no
 * second metadata policy. A peer write can enter storage before the response
 * is released. During a SQLite hydration scope it instead waits for that
 * scope; the fixture's admission conformance supplies this premise.
 *
 * Limits: one recovery, two rows, on-demand SQLite, a seed, peer write or
 * cleanup at one held boundary. No expiry, generation rotation, restart,
 * leadership turnover, Chromium OPFS or Electron IPC claim follows.
 */
export const recoveryPhases = [`response`, `read`, `application`] as const
export type RecoveryPhase = (typeof recoveryPhases)[number]
export const recoveryInterruptions = [`seed`, `peer`, `cleanup`] as const
export type RecoverySchedule = {
  phase: RecoveryPhase
  interruption: (typeof recoveryInterruptions)[number]
  bare: boolean
  value: number
}

// Each generated batch includes all 18 schedules. Payloads and the initial
// seed's metadata vary without making the timing premise probabilistic.
export const recoveryValueArbitrary = fc.integer({ min: -100, max: 100 })

/** All 18 schedules of one batch, carrying one payload value. */
export function recoverySchedulesOf(value: number): Array<RecoverySchedule> {
  return [false, true].flatMap((bare) =>
    recoveryPhases.flatMap((phase) =>
      recoveryInterruptions.map((interruption) => ({
        phase,
        interruption,
        bare,
        value,
      })),
    ),
  )
}

export const recoverySchedulesArbitrary =
  recoveryValueArbitrary.map(recoverySchedulesOf)

export type RecoveryDriver = SessionDriver & {
  holdRecovery: (phase: RecoveryPhase) => {
    reached: Promise<void>
    release: () => void
  }
  recoveryEvents: () => ReadonlyArray<RecoveryPhase>
  startPeerWrite: (value: unknown) => {
    submitted: Promise<void>
    applied: Promise<void>
  }
  stopSource: () => Promise<void>
}

/**
 * A held or completed cut whose source reads, recovery events, recovery
 * inputs or durable metadata differ from the session model: the law's own
 * failure. Any other error from a schedule is a setup, timing or cleanup
 * failure and keeps its own identity.
 */
export class RecoveryComparisonError extends Error {
  override name = `RecoveryComparisonError`
}

/**
 * The held cuts compare source reads before application and after the
 * interruption. The completed cut uses D15 against model-owned storage.
 * Cleanup compares stale source reads against an empty sync run. Durable
 * metadata is checked independently, including when cleanup discards a pull.
 */
export async function runRecoverySchedule(
  schedule: RecoverySchedule,
  createDriver: () => Promise<RecoveryDriver>,
) {
  const grammar = persistedPeerOnDemandGrammar
  const model = createSessionModel(grammar)
  const driver = await createDriver()
  let checkpoints = 0
  const checkSource = (cut: string, ended = false) => {
    const expected = ended
      ? createSessionModel({ ...grammar, cached: false }).observe()
      : model.observe()
    const mismatch = compareSource(
      checkpoints++,
      `settle`,
      expected,
      driver.observe(),
    )
    if (mismatch)
      throw new RecoveryComparisonError(`${cut}: ${JSON.stringify(mismatch)}`)
  }
  const history: Array<SessionAction> = [
    { type: `seed`, key: 1, bare: schedule.bare },
    { type: `begin` },
    { type: `insertOverSeed`, key: 1, metadata: false },
    { type: `begin` },
    { type: `reinsert`, key: 1, metadata: false },
  ]
  let release: (() => void) | undefined
  let commit: Promise<void> | undefined
  let peer: ReturnType<RecoveryDriver[`startPeerWrite`]> | undefined
  let stopped: Promise<void> | undefined
  let primary: unknown
  let outcome:
    | {
        checkpoints: number
        events: ReadonlyArray<RecoveryPhase>
        inputs: number
      }
    | undefined
  const expectedAbandonment = (error: unknown) =>
    schedule.interruption === `cleanup` &&
    error instanceof Error &&
    error.name === `AbortError`
  try {
    if (driver.takeRecoveryInputs?.().length)
      throw new Error(`recovery schedule unexpectedly started during setup`)
    for (const [step, action] of history.entries()) {
      await planAction(model, action, { s: step })(driver)
      await driver.flush()
      checkSource(`setup action ${step}`)
    }
    const held = driver.holdRecovery(schedule.phase)
    release = held.release
    // Model the authored commit once, independently of how long delivery takes.
    commit = Promise.resolve(
      planAction(model, { type: `commit` }, { s: 5 })(driver),
    )
    let timeout!: ReturnType<typeof setTimeout>
    try {
      await Promise.race([
        held.reached,
        commit.then(() => {
          throw new Error(`commit completed without reaching ${schedule.phase}`)
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `recovery never reached ${schedule.phase} within 5 seconds`,
                ),
              ),
            5_000,
          )
        }),
      ])
    } finally {
      clearTimeout(timeout)
    }
    const expectedEvents = recoveryPhases.slice(
      0,
      recoveryPhases.indexOf(schedule.phase) + 1,
    )
    if (
      JSON.stringify(driver.recoveryEvents()) !== JSON.stringify(expectedEvents)
    )
      throw new RecoveryComparisonError(
        `the recovery hold did not preserve its response/read/application prefix`,
      )
    checkSource(`held ${schedule.phase}`)
    if (schedule.interruption === `seed`) {
      await planAction(
        model,
        { type: `seed`, key: 1, bare: !schedule.bare },
        { interleaved: schedule.value },
      )(driver)
      checkSource(`seed during ${schedule.phase}`)
    } else if (schedule.interruption === `peer`) {
      peer = driver.startPeerWrite(schedule.value)
      await peer.submitted
      if (schedule.phase === `response`) {
        await peer.applied
        model.stagePeerWrite(2, `row`, schedule.value)
      }
      checkSource(`peer submitted during ${schedule.phase}`)
    } else {
      stopped = driver.stopSource()
      checkSource(`cleanup started during ${schedule.phase}`, true)
    }
    release()
    release = undefined
    try {
      await commit
    } catch (error) {
      if (!expectedAbandonment(error)) throw error
    }
    if (stopped) await stopped
    if (schedule.interruption !== `cleanup`) {
      model.observeUnknownStorage()
      if (peer) {
        await peer.applied
        model.peer(2, `row`, schedule.value)
      }
      await driver.flush()
    }
    checkSource(
      `completed ${schedule.phase}`,
      schedule.interruption === `cleanup`,
    )
    const inputs = driver.takeRecoveryInputs?.() ?? []
    if (schedule.interruption !== `cleanup` && inputs.length === 0)
      throw new RecoveryComparisonError(
        `completed recovery supplied no storage input`,
      )
    if (schedule.interruption === `cleanup` && inputs.length !== 0)
      throw new RecoveryComparisonError(
        `an invalidated sync run supplied a recovery input`,
      )
    const expected = model.storedRowMetadata()
    const actual = driver.storedRowMetadata?.()
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      const mismatch: SessionMismatch = {
        step: 6,
        action: `settle`,
        law: `recovery and cleanup do not write metadata`,
        expected,
        actual,
      }
      throw new RecoveryComparisonError(JSON.stringify(mismatch))
    }
    outcome = {
      checkpoints,
      events: driver.recoveryEvents(),
      inputs: inputs.length,
    }
  } catch (error) {
    primary = new Error(`${JSON.stringify(schedule)}: ${String(error)}`, {
      cause: error,
    })
  }
  // Drain before closing the shared connection. Keep secondary diagnostics
  // distinguishable from the first violated law and observation cut.
  const failures: Array<unknown> = []
  try {
    release?.()
  } catch (error) {
    failures.push(error)
  }
  const pending = await Promise.allSettled([commit, peer?.applied, stopped])
  for (const result of pending)
    if (result.status === `rejected` && !expectedAbandonment(result.reason))
      failures.push(result.reason)
  try {
    await driver.cleanup()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length)
    throw new AggregateError(
      primary === undefined ? failures : [primary, ...failures],
      `recovery schedule cleanup failed: ${[primary, ...failures].map(String).join(`; `)}`,
      { cause: primary },
    )
  if (primary !== undefined) throw primary
  return outcome!
}
