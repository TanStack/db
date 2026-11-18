/**
 * Electric field parsers decode a provider response before subscriber delivery.
 * A thrown parser cannot publish a prefix. A shape-log parser error given up by
 * app onError ends that sync run; a failed subset parser rejects its acquisition
 * without making the source unhealthy. Both paths can receive a later valid
 * answer: a new eager run, or a new acquisition in the same on-demand run.
 *
 * Authority: ShapeStreamOptions.parser/onError, Electric's documented getKey,
 * glossary atomic publication, loading error, sync error and request error.
 * A key transformed by an authored field parser is legal: getKey selects the
 * application key. Direct PowerSync's raw-id-preservation rule does not apply.
 * Limits: eager shape log and on-demand requestSnapshot over controlled HTTP,
 * 1–4 rows, one initial/live response and one valid next use. No real service,
 * progressive fetchSnapshot, persistence, retry policy or schema validation.
 */
import fc from 'fast-check'
import { sameElectricOracleValue } from './electric-oracle-values'

export type DecoderHistory = {
  mode: `eager` | `on-demand`
  phase: `initial` | `live`
  outcome: `valid` | `throw`
  count: number
  refusalIndex: number
  coordinate: number
}
export const decoderHistoryArb = fc
  .record({
    mode: fc.constantFrom(`eager` as const, `on-demand` as const),
    phase: fc.constantFrom(`initial` as const, `live` as const),
    outcome: fc.constantFrom(`valid` as const, `throw` as const),
    count: fc.integer({ min: 1, max: 4 }),
    refusalIndex: fc.nat({ max: 1000 }),
    coordinate: fc.nat({ max: 1000 }),
  })
  .map(
    (h) => ({ ...h, refusalIndex: h.refusalIndex % h.count }),
    (h) => h as DecoderHistory,
  )
export type DecoderRow = { id: string; value: number }
export type DecoderObservation = {
  before: Array<DecoderRow>
  afterAttempt: Array<DecoderRow>
  publications: Array<Array<DecoderRow>>
  attempt: string
  errorMatches: boolean
  status: string
  sourceErrors: boolean
  sourceError: boolean
  sourceFailureReason: boolean
  sourceCauseMatches: boolean
  nextRows: Array<DecoderRow>
  nextStatus: string
  nextSourceErrors: boolean
  runs: number
  refusalParsed: boolean
  prefixParsed: boolean
  transformedKeyParsed: boolean
  providerReleased: boolean
  receivingErrors?: ReadonlyArray<string>
  cleanupErrors?: ReadonlyArray<string>
}
// The expected rows use authored coordinates, independently of the wire
// encoder and parser. The model has no SDK cursor, Collection queue or cache.
export function decoderModel(h: DecoderHistory) {
  const rows = (next: boolean) =>
    Array.from({ length: h.count }, (_, i) => ({
      id: `app:${h.coordinate}-${i}`,
      value: h.coordinate + i + (next ? 10 : 0),
    }))
  const before = h.phase === `live` ? rows(false) : []
  return {
    before,
    afterAttempt: h.outcome === `throw` ? before : rows(true),
    nextRows: rows(true),
    attempt: h.outcome === `throw` ? `rejected` : `fulfilled`,
    status:
      h.outcome === `throw` && h.phase === `initial`
        ? h.mode === `eager`
          ? `error`
          : `loading`
        : `ready`,
    sourceErrors: h.outcome === `throw` && h.mode === `eager`,
    sourceError: h.outcome === `throw` && h.mode === `eager`,
    sourceFailureReason: false,
    sourceCauseMatches: h.outcome === `throw` && h.mode === `eager`,
    nextStatus: `ready`,
    nextSourceErrors: false,
    runs: h.outcome === `throw` && h.mode === `eager` ? 2 : 1,
  }
}
export function decoderViolations(
  h: DecoderHistory,
  o: DecoderObservation,
): Array<string> {
  const expected = decoderModel(h)
  const errors: Array<string> = []
  for (const key of [
    `before`,
    `afterAttempt`,
    `nextRows`,
    `attempt`,
    `status`,
    `sourceErrors`,
    `sourceError`,
    `sourceFailureReason`,
    `sourceCauseMatches`,
    `nextStatus`,
    `nextSourceErrors`,
    `runs`,
  ] as const)
    if (!sameElectricOracleValue(o[key], expected[key])) errors.push(key)
  if (h.outcome === `throw` && (!o.errorMatches || !o.refusalParsed))
    errors.push(`exact parser refusal`)
  if (
    h.outcome === `throw` &&
    o.publications.some(
      (rows) => !sameElectricOracleValue(rows, expected.before),
    )
  )
    errors.push(`parser prefix published`)
  if (!o.transformedKeyParsed) errors.push(`transformed key receiving premise`)
  if (!o.providerReleased) errors.push(`provider resources released`)
  if (o.receivingErrors?.length) errors.push(`detached receiving errors`)
  return errors
}
export const decoderState = (
  h: Pick<DecoderHistory, `mode` | `phase` | `outcome`>,
) => `${h.mode}:${h.phase}:${h.outcome}`
