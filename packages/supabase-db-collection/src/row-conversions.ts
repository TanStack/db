/**
 * Per-column conversions from a row as it travels over the wire to the row the
 * collection holds (`parse`), and back (`serialize`).
 *
 * PostgREST and Realtime speak JSON, so a `timestamptz` arrives as a string and
 * a `bigint` as a number (and `JSON.stringify` throws on a `bigint` request
 * body). A collection whose schema declares `Date` or `bigint` columns needs
 * these conversions to read and write them.
 *
 * A conversion is only called for a column that is present in the row and not
 * `null` / `undefined`; those pass through unchanged, so nullable columns need
 * no special handling.
 */
export interface RowConversions<TItem> {
  /**
   * Converts a column value received from PostgREST or Realtime into the value
   * the collection holds. Applies to rows read, rows returned by inserts and
   * updates, and Realtime payloads.
   */
  parse?: {
    [K in keyof TItem]?: (value: unknown) => NonNullable<TItem[K]>
  }
  /**
   * Converts a column value held by the collection into the JSON-serializable
   * value sent to PostgREST in insert and update bodies, and used to match rows
   * by key on update and delete.
   */
  serialize?: {
    [K in keyof TItem]?: (value: NonNullable<TItem[K]>) => unknown
  }
}

/**
 * The conversions with their per-column types erased. The caller's options are
 * type-checked against {@link RowConversions}; the plumbing that applies them
 * only needs to look a column up by name.
 */
export interface ColumnConversions {
  parse?: Record<string, (value: unknown) => unknown>
  serialize?: Record<string, (value: never) => unknown>
}

const convertRow = (
  row: object,
  conversions: Record<string, (value: never) => unknown> | undefined,
): Record<string, unknown> => {
  if (!conversions) {
    return { ...row }
  }
  const converted: Record<string, unknown> = { ...row }
  for (const [column, convert] of Object.entries(conversions)) {
    const value = converted[column]
    if (value != null) {
      converted[column] = convert(value as never)
    }
  }
  return converted
}

/** Applies `parse` to a row received from the server. */
export const parseRow = <TItem extends object>(
  row: object,
  { parse }: ColumnConversions,
): TItem => convertRow(row, parse) as TItem

/** Applies `serialize` to a row about to be sent to the server. */
export const serializeRow = (
  row: object,
  { serialize }: ColumnConversions,
): Record<string, unknown> => convertRow(row, serialize)
