import fc from 'fast-check'
import { expect, it } from 'vitest'
import {
  OracleFailureReport,
  atOracleCheckpoint,
  createOracleFailureFidelity,
} from './oracle-failure-fidelity'

it(`keeps the first law and checkpoint while reducing a two-fault history`, async () => {
  const fidelity = createOracleFailureFidelity<number>()
  const result = await fc.check(
    fc.asyncProperty(fc.integer({ min: 0, max: 20 }), (input) =>
      fidelity.run(input, () => {
        atOracleCheckpoint(
          input > 0 ? `ordered rows` : `Collection retention`,
          `settled window`,
          () => {
            throw new Error(`deliberate wrong answer`)
          },
        )
      }),
    ),
    { seed: 2291, numRuns: 1 },
  )
  expect(result.failed).toBe(true)
  expect(result.counterexample).toEqual([1])
  expect(result.errorInstance).toBeInstanceOf(OracleFailureReport)
  const report = result.errorInstance as OracleFailureReport
  expect(report.original.fingerprint).toBe(report.reduced.fingerprint)
  expect(report.original.fingerprint).toContain(`ordered rows`)
  expect(report.nonReproducing.map((failure) => failure.fingerprint)).toContain(
    JSON.stringify([`comparison`, `Collection retention`, `settled window`]),
  )
  expect(report.original.trace).not.toBe(report.reduced.trace)
})

it(`preserves an initial setup failure instead of shrinking to a law failure`, async () => {
  const fidelity = createOracleFailureFidelity<number>()
  const result = await fc.check(
    fc.asyncProperty(fc.integer({ min: 0, max: 20 }), (input) =>
      fidelity.run(input, () => {
        if (input > 0) throw new Error(`setup failed`)
        atOracleCheckpoint(`ordered rows`, `settled window`, () => {
          throw new Error(`wrong rows`)
        })
      }),
    ),
    { seed: 2291, numRuns: 1 },
  )
  const report = result.errorInstance as OracleFailureReport
  expect(result.counterexample).toEqual([1])
  expect(report.original.fingerprint).toContain(`setup failed`)
  expect(report.original.fingerprint).toBe(report.reduced.fingerprint)
})

it(`keeps cleanup diagnostics and rejects a matching secondary mismatch`, async () => {
  const fidelity = createOracleFailureFidelity<number>()
  const cleanup = new Error(`cleanup failed`)
  const rowFailure = () => {
    try {
      atOracleCheckpoint(`ordered rows`, `settled window`, () => {
        throw new Error(`wrong rows`)
      })
    } catch (error) {
      return error
    }
    throw new Error(`calibration did not fail`)
  }
  const result = await fc.check(
    fc.asyncProperty(fc.integer({ min: 0, max: 20 }), (input) =>
      fidelity.run(input, () => {
        if (input === 0)
          throw new AggregateError([new Error(`action failed`), rowFailure()])
        throw new AggregateError([rowFailure(), cleanup])
      }),
    ),
    { seed: 2291, numRuns: 1 },
  )
  const report = result.errorInstance as OracleFailureReport
  expect(result.counterexample).toEqual([1])
  expect(report.original.fingerprint).toContain(`ordered rows`)
  expect(report.nonReproducing[0]?.fingerprint).toContain(`action failed`)
  expect((report.original.error as AggregateError).errors).toContain(cleanup)
})

it(`reports a non-reproducing final shrink after the retained error was thrown`, async () => {
  const fidelity = createOracleFailureFidelity<number>()
  const setup = new Error(`final shrink setup failure`)
  const result = await fc.check(
    fc.asyncProperty(fc.integer({ min: 0, max: 1 }), (input) =>
      fidelity.run(input, () => {
        if (input === 0) throw setup
        atOracleCheckpoint(`ordered rows`, `settled window`, () => {
          throw new Error(`wrong rows`)
        })
      }),
    ),
    { seed: 2291, numRuns: 1, examples: [[1]] },
  )
  const report = result.errorInstance as OracleFailureReport
  expect(result.counterexample).toEqual([1])
  expect(report.original.fingerprint).toContain(`ordered rows`)
  expect(report.nonReproducing[0]?.error).toBe(setup)
  expect(report.errors).toContain(setup)
  expect(report.message).toContain(`final shrink setup failure`)
})

it(`finalizes rejected-shrink diagnostics after fast-check renders its error`, async () => {
  const fidelity = createOracleFailureFidelity<number>()
  let failure: unknown
  try {
    await fidelity.assert(() =>
      fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 1 }), (input) =>
          fidelity.run(input, () => {
            if (input === 0) throw new Error(`last setup failure`)
            atOracleCheckpoint(`ordered rows`, `settled window`, () => {
              throw new Error(`wrong rows`)
            })
          }),
        ),
        { seed: 0, numRuns: 1 },
      ),
    )
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(AggregateError)
  expect(String(failure)).toContain(`seed: 0`)
  expect(String(failure)).toContain(`path: "0"`)
  expect(String(failure)).toContain(`last setup failure`)
  expect(String(failure)).toContain(`Original trace: 1`)
  expect(String(failure)).toContain(`Reduced trace: 1`)
  expect((failure as AggregateError).errors[1]).toBeInstanceOf(
    OracleFailureReport,
  )
})
