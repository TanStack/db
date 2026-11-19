// The durable row model of the recovery fixture's Map adapter: the row each
// SQLite operation leaves. electric-recovery-durable-row.test.ts checks the
// fixture against it. This module registers no tests.
import type { Item } from './electric-recovery-support'

/**
 * The Map adapter stands in for SQLite's row operations. An insert replaces
 * the row; an update keeps the fields that the command omits.
 */
export function expectedDurableRow(
  operation: `insert` | `update`,
  previous: Item,
  next: Item,
): Item {
  return operation === `insert` ? next : { ...previous, ...next }
}
