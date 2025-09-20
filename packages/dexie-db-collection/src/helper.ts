const RESERVED_DEXIE_FIELDS = new Set([
  `_dexieMeta`,
  `_updatedAt`,
  `_createdAt`,
])

export function stripDexieFields<T extends Record<string, any>>(
  obj: T | any
): T {
  if (!obj) return obj
  const out: any = Array.isArray(obj) ? [] : {}
  for (const k of Object.keys(obj)) {
    if (RESERVED_DEXIE_FIELDS.has(k)) continue
    out[k] = obj[k]
  }
  return out as T
}

export function addDexieMetadata<T extends Record<string, any>>(
  obj: T,
  isUpdate = false
): T & { _updatedAt: number; _createdAt?: number } {
  const now = Date.now()
  const result = { ...obj } as any

  result._updatedAt = now
  if (!isUpdate) {
    result._createdAt = now
  }

  return result
}
