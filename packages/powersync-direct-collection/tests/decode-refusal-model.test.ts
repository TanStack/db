/** Positive checker controls; these are not production GREEN evidence. */
import { expect, test } from 'vitest'
import { observeDecodeRefusal } from '../../db-adapter-conformance/tests/decode-refusal-driver'
import { decodeViolations } from '../../db-adapter-conformance/tests/decode-refusal-oracle'
import { directDecodeAdapter } from './decode-refusal-driver'
import type { DecodeHistory } from '../../db-adapter-conformance/tests/decode-refusal-oracle'

const history: DecodeHistory = {
  mode: `on-demand`,
  startup: `cached`,
  phase: `initial`,
  outcome: `valid`,
  throwCause: `error`,
  count: 2,
  refusalIndex: 1,
  overlap: false,
  coordinate: 37,
  epoch: 100,
  flag: true,
}

test(`valid cached source readiness may precede decoded rows`, async () => {
  const raw = await observeDecodeRefusal(
    directDecodeAdapter,
    history,
    `model-valid-cached`,
  )
  expect(decodeViolations(history, raw)).toEqual([])
  expect(decodeViolations(history, { ...raw, readySnapshots: [[]] })).toEqual(
    [],
  )
})

test(`later readiness cannot disguise an earlier cached refusal`, async () => {
  const refused: DecodeHistory = { ...history, outcome: `throw` }
  const raw = await observeDecodeRefusal(
    directDecodeAdapter,
    refused,
    `model-refused-cached`,
  )
  // Supply a coherent alternative observation to the same checker. Clearing
  // admission diagnostics here represents a correctly configured source; the
  // generated production campaign still records and rejects the real defect.
  const permitted = {
    ...raw,
    admissionErrors: [],
    boundaryEvents: [`source ready`, `parser refusal`] as const,
    status: `ready`,
    load: `fulfilled`,
    readySnapshots: [[]],
    query: raw.query && { ...raw.query, sourceStatus: `ready` },
  }
  expect(
    decodeViolations(refused, {
      ...permitted,
      boundaryEvents: [...permitted.boundaryEvents],
    }),
  ).toEqual([])
  expect(
    decodeViolations(refused, {
      ...permitted,
      boundaryEvents: [`parser refusal`, `source ready`],
    }),
  ).toContain(`source readiness, settlement or event order differs`)
})
