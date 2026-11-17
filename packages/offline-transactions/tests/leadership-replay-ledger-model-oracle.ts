// The durable replay ledger model: a fold of durable facts that the
// leadership replay oracle compares production with, and that
// leadership-replay-ledger-model.test.ts checks against its authority. This
// module registers no tests.
export type ReplayLedgerEvent =
  | { type: `stored`; id: string }
  | { type: `read-captured`; ids: Array<string> }
  | { type: `durably-removed`; id: string }
  | { type: `read-delivered` }

// The model records durable facts instead of copying OutboxManager's version
// fences. A stale captured value cannot undo a later durable removal. These
// fixtures use FakeStorageAdapter and therefore establish executor/outbox
// behavior, not IndexedDB, LocalStorage, or native transaction completion.
export function foldReplayLedger(events: ReadonlyArray<ReplayLedgerEvent>): {
  unfinished: Array<string>
  staleCapture: Array<string>
} {
  const stored = new Set<string>()
  const removed = new Set<string>()
  let staleCapture: Array<string> = []

  for (const event of events) {
    if (event.type === `stored`) stored.add(event.id)
    else if (event.type === `durably-removed`) removed.add(event.id)
    else if (event.type === `read-captured`) staleCapture = [...event.ids]
  }

  return {
    unfinished: Array.from(stored).filter((id) => !removed.has(id)),
    staleCapture,
  }
}
