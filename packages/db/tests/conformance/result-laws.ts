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
  const ordered = (value: unknown): Array<unknown> => {
    expect(Array.isArray(value)).toBe(true)
    const rows = value as Array<Record<string, unknown>>
    for (const row of rows) {
      expect(row).not.toBeNull()
      expect(typeof row).toBe(`object`)
      expect(typeof row[field]).toBe(`string`)
    }
    return [...rows]
      .sort((a, b) => {
        const left = a[field] as string
        const right = b[field] as string
        return left < right ? -1 : left > right ? 1 : 0
      })
      .map(selectedRow)
  }
  expect(ordered(actual)).toStrictEqual(ordered(expected))
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
