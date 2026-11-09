import { paramsToSearch, toScalarString } from './common'

/** Build the `key.eq.value` search that matches one row by its key columns. */
export function keyColumnsToSearch(
  keys: Array<string>,
  item: object,
): URLSearchParams {
  return paramsToSearch(
    keys.map((key) => ({
      kind: 'column',
      column: key,
      operator: 'eq',
      value: toScalarString(Reflect.get(item, key)),
    })),
  )
}
