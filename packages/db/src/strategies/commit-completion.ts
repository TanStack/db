import type { Transaction } from '../transactions'

/** Wait for the handler even when a rolled-back receipt settles early. */
export function runWithCommitCompletion<T extends object>(
  run: () => Transaction<T>,
  onCommit?: () => Promise<unknown> | undefined,
): Promise<unknown> {
  const transaction = run()
  return onCommit?.() ?? transaction.isPersisted.promise
}
