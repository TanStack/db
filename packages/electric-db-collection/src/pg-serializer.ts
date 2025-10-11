export function serialize(value: unknown): string {
  if (typeof value === `string`) {
    return `'${value}'`
  }

  if (typeof value === `number`) {
    return value.toString()
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

  throw new Error(`Cannot serialize value: ${JSON.stringify(value)}`)
}
