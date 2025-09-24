export function serialize(value: unknown): string {
  if (typeof value === `string`) {
    return `'${value}'`
  }

  if (value === null || value === undefined) {
    return `NULL`
  }

  if (typeof value === `boolean`) {
    return value ? `true` : `false`
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`
  }

  if (Array.isArray(value)) {
    return `ARRAY[${value.map(serialize).join(`,`)}]`
  }

  if (typeof value === `object`) {
    throw new Error(`Cannot serialize object: ${JSON.stringify(value)}`)
  }

  return value.toString()
}
