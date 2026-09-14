// Transport-only optimization: all query results are still recomputed. Equality
// is over complete typed rows, never an id or an inferred affected-row set.
type Snapshot = { id: string; rows: unknown }
export type SnapshotEncoding = 'full' | 'adaptive'

function fingerprint(
  value: unknown,
  ancestors = new Set<object>(),
): string | undefined {
  if (value === null) return 'null'
  if (typeof value === 'string') return 'string:' + JSON.stringify(value)
  if (typeof value === 'boolean') return 'boolean:' + String(value)
  if (typeof value === 'number')
    return Number.isFinite(value)
      ? 'number:' + (Object.is(value, -0) ? '-0' : String(value))
      : undefined
  if (value instanceof Date)
    return Number.isFinite(value.getTime())
      ? 'date:' + value.toISOString()
      : undefined
  if (typeof value !== 'object' || ancestors.has(value)) return undefined
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return undefined
  ancestors.add(value)
  try {
    const keys = Array.isArray(value)
      ? Array.from({ length: value.length }, (_, i) => String(i))
      : Object.keys(value).sort()
    const parts = []
    for (const key of keys) {
      const item = fingerprint(
        (value as Record<string, unknown>)[key],
        ancestors,
      )
      if (item === undefined) return undefined
      parts.push([key, item])
    }
    return (Array.isArray(value) ? 'array:' : 'object:') + JSON.stringify(parts)
  } finally {
    ancestors.delete(value)
  }
}

export function encodeSnapshots(
  snapshots: Snapshot[],
  encoding: SnapshotEncoding = 'adaptive',
  groups?: Readonly<Record<string, string>>,
) {
  const full = { kind: 'confirmed' as const, snapshots }
  if (encoding === 'full' || snapshots.length < 2) return full
  if (groups) {
    const seen = new Set<string>()
    let sharedRelation = false
    for (const snapshot of snapshots) {
      const group = groups[snapshot.id]
      if (group !== undefined && seen.has(group)) {
        sharedRelation = true
        break
      }
      if (group !== undefined) seen.add(group)
    }
    if (!sharedRelation) return full
  }
  // Equal complete rows must have equal ids. Disjoint key sets prove there is
  // nothing to share, without serializing payloads or analyzing predicates.
  const owners = new Map<string, number>()
  let overlappingKeys = false
  for (const [index, snapshot] of snapshots.entries()) {
    if (!Array.isArray(snapshot.rows)) return full
    for (const row of snapshot.rows as unknown[]) {
      if (
        !row ||
        typeof row !== 'object' ||
        !('id' in row) ||
        typeof row.id !== 'string'
      )
        return full
      const owner = owners.get(row.id)
      if (owner !== undefined && owner !== index) overlappingKeys = true
      owners.set(row.id, index)
    }
  }
  if (!overlappingKeys) return full
  const pool: unknown[] = [],
    positions = new Map<string, number>()
  const shared: Array<{ id: string; indexes: number[] }> = []
  for (const snapshot of snapshots) {
    if (!Array.isArray(snapshot.rows)) return full
    const indexes: number[] = []
    for (const row of snapshot.rows) {
      const key = fingerprint(row)
      if (key === undefined) return full
      let position = positions.get(key)
      if (position === undefined) {
        position = pool.length
        pool.push(row)
        positions.set(key, position)
      }
      indexes.push(position)
    }
    shared.push({ id: snapshot.id, indexes })
  }
  const compact = { kind: 'confirmed-shared' as const, pool, snapshots: shared }
  const bytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength
  // A conservative size estimate. Real Start body sizes and CPU costs are
  // measured by the oracle; this is not a claim about compressed HTTP bytes.
  return bytes(compact) < bytes(full) ? compact : full
}
