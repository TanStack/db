/**
 * Formats a value for display in the data table
 * - Primitives are displayed as-is
 * - Objects and arrays are converted to short representations (max 40 chars)
 * - Long strings are truncated
 * - Date objects show the full ISO string
 */
export function formatValueForTable(value: any): string {
  if (value === null) return `null`
  if (value === undefined) return `undefined`

  const type = typeof value

  switch (type) {
    case `string`:
      return value.length > 40 ? value.substring(0, 37) + `...` : value
    case `number`:
    case `boolean`:
      return String(value)
    case `object`:
      if (value instanceof Date) {
        return value.toISOString()
      }
      if (Array.isArray(value)) {
        const arrayStr = `[${value.length} items]`
        return arrayStr.length > 40
          ? arrayStr.substring(0, 37) + `...`
          : arrayStr
      } else {
        const keys = Object.keys(value)
        const objectStr = `{${keys.length} keys}`
        return objectStr.length > 40
          ? objectStr.substring(0, 37) + `...`
          : objectStr
      }
    default:
      return String(value)
  }
}

/**
 * Gets the full value for tooltip display
 */
export function getFullValue(value: any): string {
  if (value === null) return `null`
  if (value === undefined) return `undefined`

  const type = typeof value

  switch (type) {
    case `string`:
      return value
    case `number`:
    case `boolean`:
      return String(value)
    case `object`:
      if (value instanceof Date) {
        return value.toISOString()
      }
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    default:
      return String(value)
  }
}

/**
 * Extracts all unique keys from an array of objects
 */
export function extractKeysFromData(data: Array<any>): Array<string> {
  const keys = new Set<string>()

  for (const item of data) {
    if (!item || typeof item !== `object`) continue

    // Try multiple strategies to handle proxies and non-plain objects
    try {
      const own = Reflect.ownKeys(item)
      for (const key of own) {
        if (typeof key === `string`) keys.add(key)
      }
    } catch {}

    try {
      Object.getOwnPropertyNames(item).forEach((k) => keys.add(k))
    } catch {}

    // Fallback to enumerable keys (works well with many proxies)

    for (const k in item) {
      keys.add(k)
    }
  }

  return Array.from(keys).sort()
}
