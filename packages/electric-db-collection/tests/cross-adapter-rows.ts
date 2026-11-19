/**
 * Record all application data. Collection's four reserved virtual root fields
 * have their own owner; removing any other field could hide an adapter leak.
 */
export function electricApplicationRows<Row extends { id: string | number }>(
  values: Iterable<Row>,
): Array<Row> {
  return [...values]
    .map((value) => {
      const row: Row & Record<string, unknown> = { ...value }
      for (const name of [
        `$collectionId`,
        `$hasPendingWrites`,
        `$key`,
        `$origin`,
      ])
        delete row[name]
      return row
    })
    .sort((a, b) =>
      typeof a.id === `number` && typeof b.id === `number`
        ? a.id - b.id
        : String(a.id).localeCompare(String(b.id)),
    )
}
