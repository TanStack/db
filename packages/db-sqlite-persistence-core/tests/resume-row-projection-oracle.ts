/**
 * SQLite resume snapshots project authored storage keys, independently of a
 * row's value.id. Duplicate requested keys do not duplicate rows; omitted keys
 * select all rows, and includeRows:false selects none. Projection changes no
 * collection metadata, key-set evidence, source-progress evidence, position or
 * reset epoch from the same unchanged durable state.
 *
 * Authority: the existing atomic resume-snapshot contract and the additive
 * rowKeys option's specified SQLite projection semantics introduced by this
 * repair. Generic adapters may return extra rows for the hint. This exact
 * projection law belongs to SQLiteCore. The independent model filters the
 * authored keyed relation with Object.is equality. That equality distinguishes
 * numeric signed zero and string/number keys. The model calls no production
 * key encoder or reader.
 *
 * The Node owner and actual Chromium/worker receiver share this check. The
 * driver supplies authored rows, one projected snapshot and optionally a full
 * snapshot of the unchanged state. The latter enables the certification
 * comparison. An optional stored-row count measures target row SELECT results
 * before decoding or filtering. Its bound is the authored projection's size;
 * it makes no claim about latency, physical scans or query plans. Row order
 * is not a resume-snapshot promise. This bounded check
 * covers transportable JSON row/metadata values and finite numeric/string
 * keys, including numeric 1 versus string '1' and positive/negative zero. It
 * does not judge JSON encoding.
 */
import type { PersistenceAdapter } from '../src'

export type ResumeRowProjectionSnapshot = Awaited<
  ReturnType<PersistenceAdapter[`loadResumeSnapshot`]>
>
export type ResumeRowProjectionInput = {
  storedRows: ReadonlyArray<ResumeRowProjectionSnapshot[`rows`][number]>
  includeRows: boolean
  rowKeys?: ReadonlyArray<string | number>
}
type ProjectionVerdict =
  | { kind: `pass` }
  | {
      kind: `violation`
      law: string
      checkpoint: string
      difference: string
      values: { actual: unknown; expected: unknown }
    }

export function expectedResumeProjectionRows(input: ResumeRowProjectionInput) {
  return input.storedRows.filter(
    ({ key }) =>
      input.includeRows &&
      (input.rowKeys === undefined ||
        input.rowKeys.some((requested) => Object.is(requested, key))),
  )
}

// JSON record property order is immaterial; arrays and primitive types retain
// their meaning. Row metadata absence remains distinct from a stored null.
function canonical(value: unknown): string {
  if (typeof value === `number` && Object.is(value, -0)) return `number:-0`
  if (Array.isArray(value)) return `[${value.map(canonical).join(`,`)}]`
  if (value !== null && typeof value === `object`)
    return (
      `{` +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
        .join(`,`) +
      `}`
    )
  return value === undefined ? `undefined` : JSON.stringify(value)
}
function keyedRows(rows: ResumeRowProjectionInput[`storedRows`]) {
  return rows
    .map(({ key, value, metadata }) => ({
      key,
      value,
      metadata:
        metadata === undefined
          ? { present: false }
          : { present: true, value: metadata },
    }))
    .sort((a, b) => canonical(a.key).localeCompare(canonical(b.key)))
}
function certification(snapshot: ResumeRowProjectionSnapshot) {
  const { rows: _rows, ...facts } = snapshot
  return facts
}
export function checkResumeRowProjection(
  input: ResumeRowProjectionInput,
  projected: ResumeRowProjectionSnapshot,
  full?: ResumeRowProjectionSnapshot,
  materializedRows?: number,
): ProjectionVerdict {
  const actual = keyedRows(projected.rows)
  const expected = keyedRows(expectedResumeProjectionRows(input))
  if (canonical(actual) !== canonical(expected))
    return {
      kind: `violation`,
      law: `SQLite resume row projection`,
      checkpoint: `requested storage rows`,
      difference: `projected rows differ from the authored typed-key selection`,
      values: { actual, expected },
    }
  if (materializedRows !== undefined && materializedRows !== expected.length)
    return {
      kind: `violation`,
      law: `SQLite resume row projection`,
      checkpoint: `stored-row materialization`,
      difference: `rowKeys query materialized ${materializedRows} stored rows; expected ${expected.length}`,
      values: { actual: materializedRows, expected: expected.length },
    }
  if (
    full &&
    canonical(keyedRows(full.rows)) !== canonical(keyedRows(input.storedRows))
  )
    return {
      kind: `violation`,
      law: `SQLite resume row projection`,
      checkpoint: `unchanged durable rows`,
      difference: `full snapshot differs from the authored durable relation`,
      values: {
        actual: keyedRows(full.rows),
        expected: keyedRows(input.storedRows),
      },
    }
  if (
    full &&
    canonical(certification(projected)) !== canonical(certification(full))
  )
    return {
      kind: `violation`,
      law: `SQLite resume row projection`,
      checkpoint: `atomic resume certification`,
      difference: `key projection changed collection-wide resume certification`,
      values: {
        actual: certification(projected),
        expected: certification(full),
      },
    }
  return { kind: `pass` }
}
