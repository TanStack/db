import { describe, expect, it } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter'
import type { Observation } from './oracle-property'

function recording() {
  const plan = {}
  const trace: Array<Observation> = []
  const observe = (checkpoint: string, value: unknown) => {
    trace.push({ checkpoint, value })
  }
  return { plan, trace, observe }
}

function assertion() {
  try {
    expect(`actual`).toBe(`expected`)
  } catch (error) {
    return error as Error
  }
  throw new Error(`the deliberately wrong assertion passed`)
}

describe(`existing assertion judgment transport`, () => {
  it(`keeps the comparison error object, cause and stack outside data observations`, async () => {
    const { plan, trace, observe } = recording()
    const original = assertion()
    const stack = original.stack
    await recordAssertionJudgment(`existing law`, plan, observe, () => {
      oracleAssertion(`old checkpoint`, () => {
        throw original
      })
    })
    const verdict = recordedAssertionJudgment(plan, trace)
    expect(verdict.kind).toBe(`violation`)
    if (verdict.kind !== `violation`) throw new Error(`missing violation`)
    expect(verdict.cause).toBe(original)
    expect(original.stack).toBe(stack)
    expect(verdict.checkpoint).toBe(`old checkpoint`)
    expect(trace).toEqual([
      { checkpoint: `old checkpoint`, value: { kind: `violation` } },
    ])
    expect(forwardAssertionJudgment(plan, trace, verdict)).toBe(verdict)
  })

  it(`preserves awaited matcher rejection identity`, async () => {
    const { plan, trace, observe } = recording()
    const original = assertion()
    await recordAssertionJudgment(`existing law`, plan, observe, async () => {
      await oracleAssertion(`async comparison`, () => Promise.reject(original))
    })
    const verdict = recordedAssertionJudgment(plan, trace)
    expect(verdict.kind).toBe(`violation`)
    if (verdict.kind === `violation`) expect(verdict.cause).toBe(original)
  })

  it(`propagates an unmarked production AssertionError unchanged`, async () => {
    const { plan, observe } = recording()
    const original = assertion()
    await expect(
      recordAssertionJudgment(`law`, plan, observe, () => {
        throw original
      }),
    ).rejects.toBe(original)
  })

  it(`propagates a runtime failure inside an authored comparison unchanged`, async () => {
    const { plan, observe } = recording()
    const original = new TypeError(`broken runtime`)
    await expect(
      recordAssertionJudgment(`law`, plan, observe, () => {
        oracleAssertion(`comparison`, () => {
          throw original
        })
      }),
    ).rejects.toBe(original)
  })

  it(`preserves a mixed comparison and cleanup aggregate unchanged`, async () => {
    const { plan, observe } = recording()
    const original = assertion()
    try {
      oracleAssertion(`comparison`, () => {
        throw original
      })
    } catch {}
    const mixed = new AggregateError(
      [original, new Error(`cleanup failed`)],
      `both`,
      { cause: original },
    )
    await expect(
      recordAssertionJudgment(`law`, plan, observe, () => {
        throw mixed
      }),
    ).rejects.toBe(mixed)
  })

  it(`recognizes an authored checkpoint wrapper without replacing it`, async () => {
    const { plan, trace, observe } = recording()
    const original = assertion()
    const wrapped = new Error(`checkpoint failed`, { cause: original })
    wrapped.name = `OracleCheckpointFailure`
    await recordAssertionJudgment(`law`, plan, observe, () => {
      oracleAssertion(`checkpoint`, () => {
        throw wrapped
      })
    })
    const verdict = recordedAssertionJudgment(plan, trace)
    expect(verdict.kind).toBe(`violation`)
    if (verdict.kind === `violation`) expect(verdict.cause).toBe(wrapped)
  })

  it(`rejects a missing successful judgment`, () => {
    const { plan, trace } = recording()
    expect(recordedAssertionJudgment(plan, trace).kind).toBe(`violation`)
  })
})
