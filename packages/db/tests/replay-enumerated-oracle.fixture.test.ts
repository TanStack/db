/**
 * An enumerated oracle runs named finite cases, without a campaign seed or
 * shrink path. This fixture receives the manifest's direct Vitest command.
 * Its identity model and value comparison expose whether that command ran the
 * requested cases; a neighboring property exposes an overbroad name filter.
 * It calibrates replay routing only, not a TanStack DB runtime law.
 */
import { differs, oracleProperty, pass } from './oracle-config.js'
import type { Observation } from './oracle-config.js'

const law = {
  statement: `Every selected finite case reaches its value comparison.`,
  authority: `oracleProperty enumerated history API and the named replay manifest contract.`,
  limits: `Two finite cases and a neighboring property in a real Vitest child process; no generated seed/path replay.`,
}
// A case's integer is the complete expected public observation. The driver
// reports it unchanged, unless the parent requests a wrong-value calibration.
const model = (history: number) => history
const check = (
  _history: number,
  trace: ReadonlyArray<Observation>,
  expected: number,
) => differs(`value`, `finite value`, trace[0]?.value, expected) ?? pass

oracleProperty({
  id: `oracle-replay.enumerated-calibration`,
  law,
  histories: [1, 2],
  label: (history) => `finite case ${history}`,
  model,
  driver: (history, observe) => {
    observe(
      `value`,
      history +
        (process.env.TANSTACK_DB_ORACLE_ENUMERATED_CALIBRATION === `value`
          ? 1
          : 0),
    )
  },
  check,
})

oracleProperty({
  id: `oracle-replay.enumerated-calibration-neighbor`,
  law,
  histories: [3],
  model,
  driver: (history, observe) => {
    if (process.env.TANSTACK_DB_ORACLE_ENUMERATED_CALIBRATION === `neighbor`)
      throw new Error(`unrelated finite property ran`)
    observe(`value`, history)
  },
  check,
})
