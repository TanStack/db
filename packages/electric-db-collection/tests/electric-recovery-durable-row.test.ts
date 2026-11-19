// Checks the recovery fixture's Map adapter, the durable boundary of the
// Electric recovery oracle's driver, against the durable row model. It runs
// no production, so it lives outside the oracle.
import { expect, it } from 'vitest'
import { expectedDurableRow } from './electric-recovery-durable-row-model-oracle'
import {
  fixture,
  freshRow,
  withFixtureCleanup,
} from './electric-recovery-support'

// The Map adapter is the driver's durable boundary. It must enact SQLite's
// distinct row operations before its rows can serve as evidence for a peer
// notice. Insert replaces a same-key row; update retains omitted fields.
it.each([`insert`, `update`] as const)(
  `models a same-key %s against the durable row operation`,
  async (operation) => {
    const f = fixture(`on-demand`)
    await withFixtureCleanup(f, async () => {
      const old = { ...freshRow, obsolete: `old field` }
      await f.commitExternalTx({
        txId: `old`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: old.id, value: old }],
      })
      const next = { ...freshRow, name: `next` }
      await f.commitExternalTx({
        txId: `next`,
        term: 2,
        seq: 1,
        rowVersion: 2,
        mutations: [{ type: operation, key: next.id, value: next }],
      })
      expect(f.rows.get(next.id)).toEqual(
        expectedDurableRow(operation, old, next),
      )
    })
  },
)
