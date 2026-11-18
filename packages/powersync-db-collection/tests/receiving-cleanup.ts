/**
 * Preserve a completed product observation when later receiving teardown
 * fails. A failure before completion remains primary through withOracleCleanup;
 * a completed mismatch stays available to the model's comparison, with every
 * subsequent cleanup error recorded separately.
 */
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'

export type ReceivingCleanup = { cleanupErrors?: ReadonlyArray<string> }
export async function retainNativeObservation<T extends ReceivingCleanup>(
  run: () => Promise<T>,
  cleanups: ReadonlyArray<() => unknown>,
): Promise<T> {
  return retainOracleCleanupObservation(run, cleanups)
}
