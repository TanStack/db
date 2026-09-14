import { expect } from 'vitest'

/** Read declared fields without repairing malformed adapter observations. */
export function expectResultSurface<
  T extends {
    status: unknown
    isReady: unknown
    isError: unknown
    isEnabled: unknown
  },
>(result: T): T {
  expect(typeof result.status, `raw status`).toBe(`string`)
  for (const key of [`isReady`, `isError`, `isEnabled`] as const)
    expect(typeof result[key], `raw ${key}`).toBe(`boolean`)
  return result
}

/** Selected values, separate from virtual row metadata and framework internals. */
export function selectedRow(row: unknown): Record<PropertyKey, unknown> {
  expect(row).not.toBeNull()
  expect(typeof row).toBe(`object`)
  const value = row as Record<PropertyKey, unknown>
  const virtual = [`$synced`, `$origin`, `$key`, `$collectionId`]
  return Object.fromEntries(
    Reflect.ownKeys(value)
      // Solid stores nonenumerable bookkeeping symbols on its row wrappers.
      // This shared law observes selected values, not all hidden wrapper state.
      .filter(
        (key) =>
          typeof key !== `symbol` ||
          Object.prototype.propertyIsEnumerable.call(value, key),
      )
      .filter((key) => typeof key !== `string` || !virtual.includes(key))
      .map((key) => [key, value[key]]),
  )
}

/** Tiny selected-row fixtures: reorder only; never fold duplicates into a Map. */
export function expectUnorderedRows(
  actual: unknown,
  expected: ReadonlyArray<unknown>,
  field = `id`,
): void {
  const selected = (value: unknown): Array<unknown> => {
    expect(Array.isArray(value)).toBe(true)
    const rows = value as Array<Record<string, unknown>>
    for (const row of rows) {
      expect(row).not.toBeNull()
      expect(typeof row).toBe(`object`)
      expect(typeof row[field]).toBe(`string`)
    }
    return rows.map(selectedRow)
  }
  const remaining = selected(expected)
  const rows = selected(actual)
  expect(rows).toHaveLength(remaining.length)
  // These tiny fixtures need strict selected-value equality, including symbols
  // and absent-vs-undefined fields. Consume one match, never fold duplicates.
  for (const row of rows) {
    const match = remaining.findIndex((candidate) => {
      try {
        expect(row).toStrictEqual(candidate)
        return true
      } catch {
        return false
      }
    })
    expect(match, `No matching selected row`).toBeGreaterThanOrEqual(0)
    remaining.splice(match, 1)
  }
}

export function expectOrderedRows(actual: unknown, expected: unknown): void {
  expect(Array.isArray(actual)).toBe(true)
  expect(Array.isArray(expected)).toBe(true)
  expect((actual as Array<unknown>).map(selectedRow)).toStrictEqual(
    (expected as Array<unknown>).map(selectedRow),
  )
}

/** Source-keyed, single-source projections only, not synthetic join keys. */
export function expectKeyedRows(
  state: ReadonlyMap<unknown, unknown> | undefined,
  expected: ReadonlyArray<{ id: string }>,
): void {
  expect(state).toBeDefined()
  expectUnorderedRows(
    [...state!.entries()].map(([key, value]) => ({
      id: key,
      value: selectedRow(value),
    })),
    expected.map((value) => ({ id: value.id, value })),
  )
}
