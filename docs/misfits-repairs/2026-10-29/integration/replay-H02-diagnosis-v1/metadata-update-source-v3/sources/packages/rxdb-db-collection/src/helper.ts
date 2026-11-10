const RESERVED_RXDB_FIELDS = new Set([
  `_rev`,
  `_deleted`,
  `_attachments`,
  `_meta`,
])

export function stripRxdbFields<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj)) {
    if (RESERVED_RXDB_FIELDS.has(k)) continue
    out[k] = obj[k]
  }
  return out as T
}
