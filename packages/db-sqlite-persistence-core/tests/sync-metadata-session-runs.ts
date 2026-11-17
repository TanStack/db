/**
 * Observation and comparison for the SQLite package's sync metadata session
 * properties.
 *
 * The session oracle's laws, model, and per-checkpoint comparison live in
 * `packages/db/tests/sync-metadata-session-oracle.ts`. `runSessionHistory`
 * replays one history through the session model and a production driver
 * together, and compares the source reads, consumer rows, and durable
 * metadata at every action checkpoint and at settlement. It returns the first
 * mismatch, which names the violated law.
 *
 * A property here runs a batch of such histories through several production
 * paths. Its plan names the runs it owes: one per production path and
 * history, each with the number of authored actions. The driver records one
 * `run` observation per run, in order. The check then requires, for every
 * owed run:
 *
 * - it was observed (law `every owed run is observed`);
 * - the session model agreed with production at every checkpoint (the law
 *   that the mismatch names); and
 * - every authored action was legal and ran (law `constructive history`).
 *   The batch grammars are constructive: each action is legal by
 *   construction, so a skipped action means the grammar no longer builds
 *   the premise its case is named for.
 *
 * A run reaches its named state when both hold. This module computes no
 * expected metadata: that is the session model's job.
 */
import { pass, violation } from '../../db/tests/oracle-property'
import { describeMismatch } from '../../db/tests/sync-metadata-session-oracle'
import type {
  Calibration,
  Observation,
  Verdict,
} from '../../db/tests/oracle-property'
import type {
  SessionAction,
  runSessionHistory,
} from '../../db/tests/sync-metadata-session-oracle'

/** A run a plan owes: one history through one production path. */
export type OwedSessionRun = {
  path: string
  name: string
  actions: number
}

/** What a run showed: how many actions ran, and the first mismatch. */
export type SessionRun = OwedSessionRun & {
  steps: number
  mismatch: { law: string; report: string } | null
  /** A production path's extra reach facts, such as recovery inputs. */
  facts?: ReadonlyArray<string>
}

/** Runs one owed history and records what it showed. */
export async function observeSessionRun(
  observe: (checkpoint: string, value: unknown) => void,
  owed: OwedSessionRun,
  history: ReadonlyArray<SessionAction>,
  run: () => ReturnType<typeof runSessionHistory>,
  facts?: (
    result: Awaited<ReturnType<typeof runSessionHistory>>,
  ) => ReadonlyArray<string>,
): Promise<void> {
  const result = await run()
  const value: SessionRun = {
    ...owed,
    steps: result.steps,
    mismatch: result.mismatch
      ? {
          law: result.mismatch.law,
          report: describeMismatch(history, result.mismatch),
        }
      : null,
    ...(facts ? { facts: facts(result) } : {}),
  }
  observe(`run`, value)
}

/** The recorded runs, in order. */
export function sessionRuns(
  observations: ReadonlyArray<Observation>,
): Array<SessionRun> {
  return observations
    .filter((observation) => observation.checkpoint === `run`)
    .map((observation) => observation.value as SessionRun)
}

/** The runs that agreed with the model and ran every authored action. */
export function completedSessionRuns(
  observations: ReadonlyArray<Observation>,
): Array<SessionRun> {
  return sessionRuns(observations).filter(
    (run) => run.mismatch === null && run.steps === run.actions,
  )
}

/**
 * Judges each recorded run before completeness, so a driver error after a
 * recorded mismatch still reports the mismatch. Completeness uses its own
 * checkpoint, which no observation records, so a driver error that cut the
 * trace short is reported as that error.
 */
export function checkSessionRuns(
  observations: ReadonlyArray<Observation>,
  owed: ReadonlyArray<OwedSessionRun>,
  {
    constructive = true,
  }: {
    /**
     * Whether every authored action must run. A general session history may
     * hold actions that are illegal where they fall, which the runner skips,
     * so only a constructive batch requires it.
     */
    constructive?: boolean
  } = {},
): Verdict {
  const runs = sessionRuns(observations)
  for (const [index, run] of runs.entries()) {
    const expected = owed[index]
    if (
      expected === undefined ||
      run.path !== expected.path ||
      run.name !== expected.name ||
      run.actions !== expected.actions
    )
      return violation(
        `run`,
        `run ${index} is not the run the plan owes there`,
        `every owed run is observed`,
        { actual: run, expected: expected ?? null },
      )
    if (run.mismatch !== null)
      return violation(
        `run`,
        `${run.path}: ${run.name}\n${run.mismatch.report}`,
        run.mismatch.law,
      )
    if (constructive && run.steps !== run.actions)
      return violation(
        `run`,
        `${run.path}: ${run.name}: constructive history skipped an authored action`,
        `constructive history`,
        { actual: run.steps, expected: run.actions },
      )
  }
  if (runs.length < owed.length)
    return violation(
      `runs`,
      `${owed.length - runs.length} owed runs were not observed`,
      `every owed run is observed`,
      { actual: runs.length, expected: owed.length },
    )
  return pass
}

/**
 * Wrong answers that the check must reject: a run that reports a session
 * mismatch, and a run that skipped an authored action.
 */
export function sessionRunCalibrations<THistory, TPlan>({
  constructive = true,
}: { constructive?: boolean } = {}): ReadonlyArray<
  Calibration<THistory, TPlan>
> {
  const corruptFirstRun =
    (change: (run: SessionRun) => SessionRun) =>
    (trace: ReadonlyArray<Observation>) => {
      const at = trace.findIndex((entry) => entry.checkpoint === `run`)
      if (at < 0) return undefined
      return trace.map((entry, index) =>
        index === at
          ? { ...entry, value: change(entry.value as SessionRun) }
          : entry,
      )
    }
  return [
    {
      name: `a run reports a session mismatch`,
      law: `calibrated session law`,
      corrupt: corruptFirstRun((run) => ({
        ...run,
        mismatch: { law: `calibrated session law`, report: `calibrated` },
      })),
    },
    ...(constructive
      ? [
          {
            name: `a run skipped an authored action`,
            law: `constructive history`,
            corrupt: corruptFirstRun((run) => ({
              ...run,
              steps: run.steps - 1,
            })),
          },
        ]
      : []),
  ]
}
