/** Test-only transport recorder. The main process owns sequence and frame IDs. */
export type RecordedSql = {
  frame: number
  sequence: number
  session: number
  sql: string
  params: ReadonlyArray<unknown>
}
export function createSqlRecording() {
  let frame = 0
  let receive: ((sql: string, params: ReadonlyArray<unknown>) => void) | null =
    null
  let nextSequence = 1
  const pending = new Map<number, RecordedSql>()
  return {
    begin(next: typeof receive) {
      receive = next
      nextSequence = 1
      pending.clear()
      return ++frame
    },
    accept(entry: RecordedSql) {
      if (entry.frame !== frame || entry.sequence < nextSequence) return
      pending.set(entry.sequence, entry)
      for (
        let current = pending.get(nextSequence);
        current;
        current = pending.get(nextSequence)
      ) {
        pending.delete(nextSequence++)
        receive?.(current.sql, current.params)
      }
    },
    async stop(finalEntries: Promise<ReadonlyArray<RecordedSql>>) {
      for (const entry of await finalEntries) this.accept(entry)
      this.begin(null)
    },
    frame: () => frame,
  }
}
