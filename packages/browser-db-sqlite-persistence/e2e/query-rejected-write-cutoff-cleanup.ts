// Worker termination can release its OPFS handles in a later native task.
// Retry only the exact transient busy condition after awaited database close.
import { startupTurn } from '../../db-adapter-conformance/tests/persisted-startup-driver'

export async function removeClosedArtifacts(
  remove: () => Promise<void>,
  observe: (cut: string, value: unknown) => void,
  attempts = 100,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      await remove()
      return
    } catch (error) {
      if (!(
        error instanceof DOMException &&
        error.name === 'NoModificationAllowedError'
      ))
        throw error
      observe('opfsCleanupRetry', {
        attempt,
        name: error.name,
        message: error.message,
      })
      if (attempt >= attempts) throw error
      await startupTurn()
    }
  }
}
