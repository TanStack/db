/**
 * Row shape shared by flat-change-tracking-oracle.property.test.ts and
 * flat-change-tracking.test.ts.
 */
export type Row = Record<string, unknown>

export type RowShape = {
  fields: Array<unknown>
  nullPrototype: boolean
  frozen: boolean
  hidden: unknown
}

export const MISSING = Symbol(`missing`)

export const plainRow = (rowFields: Array<unknown>, nullPrototype = false) => ({
  fields: rowFields,
  nullPrototype,
  frozen: false,
  hidden: MISSING,
})

export const FRESH_OBJECT = Symbol(`fresh object`)

export function buildRow(shape: RowShape): Row {
  const row: Row = shape.nullPrototype ? Object.create(null) : {}
  shape.fields.forEach((value, index) => {
    if (value !== MISSING) row[fields[index]!] = value
  })
  if (shape.hidden !== MISSING) {
    Object.defineProperty(row, `h`, {
      value: domainValue(shape.hidden),
      enumerable: false,
      writable: true,
      configurable: true,
    })
  }
  return shape.frozen ? Object.freeze(row) : row
}

export const fields = [`a`, `b`, `c`] as const

export const domainValue = (value: unknown) =>
  value === FRESH_OBJECT ? { nested: 1 } : value
