// A model rule of the durable replay ledger, checked against its authority
// without production. The leadership replay oracle in
// leadership-replay-oracle.property.test.ts compares production with the
// same fold.
import { expect, it } from 'vitest'
import { foldReplayLedger } from './leadership-replay-ledger-model-oracle'
import type { ReplayLedgerEvent } from './leadership-replay-ledger-model-oracle'

it(`append-only replay judgment rejects stale admission after durable removal`, () => {
  const ledger: Array<ReplayLedgerEvent> = [
    { type: `stored`, id: `removed` },
    { type: `stored`, id: `peer` },
    { type: `read-captured`, ids: [`removed`, `peer`] },
    { type: `durably-removed`, id: `removed` },
    { type: `read-delivered` },
  ]
  const expected = foldReplayLedger(ledger)

  expect(expected.unfinished).toEqual([`peer`])
  expect(expected.staleCapture).not.toEqual(expected.unfinished)
})
