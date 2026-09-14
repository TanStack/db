export type QueryParams = Readonly<Record<string, string | number | boolean>>
export type QueryInstance = {
  id: string
  definition: string
  version: string
  params: QueryParams
  certificate?: string
  hasBaseline?: boolean
  optimistic?: boolean
}
export function queryInstance(
  definition: string,
  version: string,
  input: QueryParams,
): QueryInstance {
  const entries = Object.entries(input).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  for (const [key, value] of entries) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      !['string', 'number', 'boolean'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isSafeInteger(value))
    )
      throw Error('Unsupported query parameter')
  }
  const params = Object.freeze(Object.fromEntries(entries))
  return {
    id: entries.length ? JSON.stringify([definition, params]) : definition,
    definition,
    version,
    params,
  }
}
