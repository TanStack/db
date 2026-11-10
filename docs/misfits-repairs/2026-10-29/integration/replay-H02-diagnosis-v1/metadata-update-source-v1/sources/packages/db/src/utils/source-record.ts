/**
 * Creates a record keyed by source ids. Each source id is unique, so a plain
 * object would receive a new hidden class for every compiled query. A record
 * without a prototype avoids those shape transitions and cannot confuse an
 * alias such as `constructor` with an inherited member.
 */
export function createSourceRecord<T>(): Record<string, T> {
  return Object.create(null)
}
