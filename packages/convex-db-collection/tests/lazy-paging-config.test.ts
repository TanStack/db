// Invalid lazy row caps reject before readiness. Each case compares the real
// paginated adapter with written expectations, so it is an ordinary test, not
// a history of lazy-paging-oracle.property.test.ts.
import { createCollection } from '@tanstack/db'
import { expect, it } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import { convexPaginatedCollectionOptions } from '../src/index'
import { withTestCleanup } from './helpers'
import { lazyFixture, lazyQuery } from './lazy-paging-driver'

it.each([0, -1, 1.5, Infinity, NaN])(
  `rejects invalid lazy row caps before readiness: %s`,
  async (maxRows) => {
    const f = lazyFixture([], 1)
    await f.source.cleanup()
    const source = createCollection(
      convexPaginatedCollectionOptions({
        client: f.remote.client,
        query: lazyQuery,
        queryArgs: {},
        syncMode: `on-demand`,
        queryOrder: { field: `rank`, direction: `asc` },
        maxRows,
        getKey: (row) => row.id,
      }),
    )
    const statuses: Array<string> = []
    const off = source.on(`status:change`, ({ status }) => {
      statuses.push(status)
    })
    await withTestCleanup(
      async () => {
        await oracleAssertion(
          `lazy-paging-oracle.property.test.ts:986:toBeInstanceOf`,
          () => expect(source.preload()).rejects.toBeInstanceOf(Error),
        )
        oracleAssertion(
          `lazy-paging-oracle.property.test.ts:987:toBeInstanceOf`,
          () => expect(source.utils.getSyncError()).toBeInstanceOf(RangeError),
        )
        oracleAssertion(
          `lazy-paging-oracle.property.test.ts:988:toContain`,
          () =>
            expect(
              statuses,
              `lazy startup: invalid provider config reported ready`,
            ).not.toContain(`ready`),
        )
        oracleAssertion(
          `lazy-paging-oracle.property.test.ts:992:toHaveLength`,
          () => expect(f.remote.slots).toHaveLength(0),
        )
      },
      off,
      () => source.cleanup(),
    )
  },
)
