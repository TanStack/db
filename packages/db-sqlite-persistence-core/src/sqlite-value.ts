import { SQLiteBigIntOutOfRangeError } from './errors'

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
