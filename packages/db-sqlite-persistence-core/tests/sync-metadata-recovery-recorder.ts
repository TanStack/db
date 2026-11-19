import type { SessionRecoveryInput } from '../../db/tests/sync-metadata-session-oracle'

/**
 * Response delivery is transport evidence. Only a successful hydration task
 * that read storage supplies a completed model input. Keep outstanding inputs
 * visible so a skipped task cannot silently produce a green comparison.
 */
export function createRecoveryRecorder() {
  const pending = new Set<SessionRecoveryInput>()
  const completed: Array<SessionRecoveryInput> = []
  let generation = 0
  return {
    pendingCount: () => pending.size,
    delivered: (input: SessionRecoveryInput) => pending.add(input),
    hydrate: async <T>(task: (read: () => void) => Promise<T>) => {
      const inputs = [...pending]
      const started = generation
      let reads = 0
      const result = await task(() => reads++)
      if (started !== generation) return result
      if (inputs.length && reads === 0)
        throw new Error(`recovery response completed no storage observation`)
      for (const input of inputs) {
        pending.delete(input)
        completed.push(input)
      }
      return result
    },
    take: () => {
      if (pending.size)
        throw new Error(`recovery response was not applied before comparison`)
      return completed.splice(0)
    },
    // Cleanup invalidates the sync run. Its late response supplies no model
    // transition, even when the transport itself completed successfully.
    discard: () => {
      generation++
      pending.clear()
      completed.length = 0
    },
  }
}
