import {
  InvalidPersistedCollectionConfigError,
  SQLiteBigIntOutOfRangeError,
} from './errors'

export const SQLITE_BIGINT_MIN = -9_223_372_036_854_775_808n
export const SQLITE_BIGINT_MAX = 9_223_372_036_854_775_807n
export const PERSISTED_TYPE_TAG = `__tanstack_db_persisted_type__`
export const PERSISTED_VALUE_TAG = `value`

export type SerializedSQLiteBigInt = {
  [PERSISTED_TYPE_TAG]: `bigint`
  [PERSISTED_VALUE_TAG]: string
}

export function assertSQLiteBigIntInRange(value: bigint): bigint {
  if (value < SQLITE_BIGINT_MIN || value > SQLITE_BIGINT_MAX) {
    throw new SQLiteBigIntOutOfRangeError(
      value,
      SQLITE_BIGINT_MIN,
      SQLITE_BIGINT_MAX,
    )
  }
  return value
}

export function serializeSQLiteBigInt(value: bigint): SerializedSQLiteBigInt {
  assertSQLiteBigIntInRange(value)
  return {
    [PERSISTED_TYPE_TAG]: `bigint`,
    [PERSISTED_VALUE_TAG]: value.toString(),
  }
}

type SQLiteTemporalKind = `Temporal.Instant` | `Temporal.PlainDate`
type SQLiteTemporal = {
  epochNanoseconds: bigint
  year: number
  month: number
  day: number
  withCalendar: (calendar: string) => SQLiteTemporal
}
type TemporalConstructor = {
  from: (value: string) => SQLiteTemporal
  prototype: { toString: () => string }
}

export type SerializedSQLiteTemporal = {
  [PERSISTED_TYPE_TAG]: SQLiteTemporalKind
  [PERSISTED_VALUE_TAG]: string
  order: string
}

export function sqliteTemporalKind(
  value: unknown,
): SQLiteTemporalKind | undefined {
  if (value === null || typeof value !== `object`) return
  const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag]
  if (tag === `Temporal.Instant` || tag === `Temporal.PlainDate`) return tag
  return undefined
}

function requireSQLiteTemporalConstructor(
  kind: SQLiteTemporalKind,
): TemporalConstructor {
  const name = kind.slice(`Temporal.`.length)
  const constructor = (
    globalThis as { Temporal?: Record<string, TemporalConstructor> }
  ).Temporal?.[name]
  if (
    typeof constructor?.from !== `function` ||
    typeof constructor.prototype.toString !== `function`
  ) {
    throw new InvalidPersistedCollectionConfigError(
      `Missing global ${kind} constructor for SQLite persistence`,
    )
  }
  return constructor
}

export function reviveSQLiteTemporal(
  kind: SQLiteTemporalKind,
  value: string,
): unknown {
  return requireSQLiteTemporalConstructor(kind).from(value)
}

/** Registered prototype methods validate the brand; user toString is ignored. */
export function serializeSQLiteTemporal(
  value: unknown,
): SerializedSQLiteTemporal | undefined {
  if (value === null || typeof value !== `object`) return
  const prototype = Object.getPrototypeOf(value)
  if (prototype === null || prototype === Object.prototype) return
  const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag]
  if (typeof tag !== `string` || !tag.startsWith(`Temporal.`)) return
  const kind = sqliteTemporalKind(value)
  if (!kind)
    throw new InvalidPersistedCollectionConfigError(
      `Unsupported ${tag} value for SQLite persistence`,
    )
  const constructor = requireSQLiteTemporalConstructor(kind)
  let text: string
  try {
    text = constructor.prototype.toString.call(value)
  } catch {
    throw new InvalidPersistedCollectionConfigError(
      `Invalid ${kind} value for the registered global constructor`,
    )
  }
  const native = constructor.from(text)
  const iso =
    kind === `Temporal.PlainDate` ? native.withCalendar(`iso8601`) : undefined
  // Text keys avoid both floating-point precision loss and SQLite's int64 cap.
  const order = iso
    ? `${String(iso.year + 1_000_000).padStart(7, `0`)}${String(iso.month).padStart(2, `0`)}${String(iso.day).padStart(2, `0`)}`
    : (native.epochNanoseconds + 10_000_000_000_000_000_000_000n)
        .toString()
        .padStart(23, `0`)
  return { [PERSISTED_TYPE_TAG]: kind, [PERSISTED_VALUE_TAG]: text, order }
}

export function sqliteTemporalIdentity(
  value: SerializedSQLiteTemporal,
): string {
  return `${value[PERSISTED_TYPE_TAG]}:${value[PERSISTED_VALUE_TAG]}`
}
