/**
 * Oracle properties: one constructor for an oracle's law, histories, model,
 * production driver, and check.
 *
 * An oracle file used to assemble these parts by hand: `declareOracle`, a loop
 * of `it` calls, assertions spread through the driver, and its own cleanup and
 * failure text. `oracleProperty` takes the parts and does the mechanics that
 * every oracle shares, so an oracle file holds only the parts that state its
 * law.
 *
 * The parts keep their jobs separate (oracle rubric, ORC-003):
 *
 * - `law` states the promise, its authority, its limits, and its owner in the
 *   coverage map. A failure names it.
 * - `histories` lists every legal history the property runs. This first
 *   version takes an enumerated source, which runs in full: bounded
 *   exhaustiveness (glossary).
 * - `model` gives the expected result of a history, without production.
 * - `driver` runs one history through production and records public
 *   observations with `observe(checkpoint, value)`. It returns nothing, so it
 *   cannot decide a verdict (oracle-framework design, decision D10). A
 *   production error that the law cares about is an observation the driver
 *   records. An error that escapes the driver is a setup error, never a
 *   violation.
 * - `check` compares the observations with the model and returns a verdict.
 *   Only the check can report a violation of the law.
 *
 * Each history is one test, named by `label`. A violation fails it with an
 * `OracleViolation` that names the property, the law, the checkpoint, the
 * difference, and the command that reruns that history. Every observation is
 * also offered to `globalThis.__oracleObserve` when a harness installs one,
 * so the gap report can tell an output the check does not compare from one
 * that never changed.
 *
 * The `oracle/no-unit-test` lint rule treats an `oracleProperty` call as an
 * oracle test whose parts are its arguments, when its options are an object
 * literal with a `check`. The property is its own declaration.
 */
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** A law and where it comes from. */
export interface OracleLaw {
  /** The promise, stated so that a reader could predict an observation. */
  statement: string
  /** The contract document and section, or the maintainer decision. */
  authority: string
  /** What this property does not establish. */
  limits: string
  /** The coverage-map owner. */
  owner: string
}

/** One recorded public fact, at the checkpoint where the contract owes it. */
export interface Observation {
  checkpoint: string
  value: unknown
}

/** The check's judgment of one history. */
export type Verdict =
  | { kind: `pass` }
  | { kind: `violation`; checkpoint: string; difference: string }

export const pass: Verdict = { kind: `pass` }

export function violation(checkpoint: string, difference: string): Verdict {
  return { kind: `violation`, checkpoint, difference }
}

/** The check found a history whose observations the law does not allow. */
export class OracleViolation extends Error {
  override name = `OracleViolation`
}

export interface OraclePropertyOptions<History, Expected> {
  /** A stable identifier, used in failures, the manifest, and replay. */
  id: string
  law: OracleLaw
  /** Every legal history, in a fixed order. */
  histories: ReadonlyArray<History>
  /** A short, unique test name for a history. */
  label: (history: History) => string
  model: (history: History) => Expected
  driver: (
    history: History,
    observe: (checkpoint: string, value: unknown) => void,
  ) => Promise<void> | void
  check: (
    history: History,
    observations: ReadonlyArray<Observation>,
    expected: Expected,
  ) => Verdict
}

declare global {
  // Installed by the gap report's test setup, absent otherwise.
  var __oracleObserve:
    ((checkpoint: string, value: unknown) => void) | undefined
}

export function oracleProperty<History, Expected>(
  options: OraclePropertyOptions<History, Expected>,
): void {
  const { id, law, histories, label } = options
  recordRegistration(options)
  describe(id, () => {
    for (const history of histories) {
      const name = label(history)
      it(name, async () => {
        const observations: Array<Observation> = []
        await options.driver(history, (checkpoint, value) => {
          observations.push({ checkpoint, value })
          globalThis.__oracleObserve?.(checkpoint, value)
        })
        const verdict = options.check(
          history,
          observations,
          options.model(history),
        )
        if (verdict.kind === `violation`) {
          throw new OracleViolation(
            [
              `${id} violated at checkpoint "${verdict.checkpoint}".`,
              `Law: ${law.statement}`,
              `Difference: ${verdict.difference}`,
              `Authority: ${law.authority}`,
              `Known limits: ${law.limits}`,
              `Rerun this history: vitest run ${relativeTestFile()} -t ${JSON.stringify(`${id} ${name}`)}`,
            ].join(`\n`),
          )
        }
      })
    }
  })
}

// A collect-only run (ORACLE_MANIFEST set) records each registration, so the
// committed manifest can be generated without running any history.
function recordRegistration(options: {
  id: string
  law: OracleLaw
  histories: { length: number }
}): void {
  const manifest = process.env.ORACLE_MANIFEST
  if (manifest === undefined) return
  appendFileSync(
    manifest,
    `${JSON.stringify({
      id: options.id,
      file: relativeTestFile(),
      owner: options.law.owner,
      authority: options.law.authority,
      histories: options.histories.length,
    })}\n`,
  )
}

// `expect.getState()` names the test file while it is collected and run.
function relativeTestFile(): string {
  return expect.getState().testPath ?? `<test file>`
}
