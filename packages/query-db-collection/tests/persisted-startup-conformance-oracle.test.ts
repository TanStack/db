/** Query receives the shared persistence law, including its cache origins.
 * Already-available initial/cache results cannot be delivered after restore;
 * fetched answers exercise both schedules. Pending origins hold queryFn until
 * after the startup durable comparison, so refetch cannot conceal the defect.
 */
import { describe } from 'vitest'
import fc from 'fast-check'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { persistedStartupMembershipArb } from '../../db-adapter-conformance/src/persisted-startup-oracle'
import { registerPersistedStartupConformance } from '../../db-adapter-conformance/tests/persisted-startup-oracle-suite'
import {
  queryStartupAdapter,
  queryStartupHistories,
} from './persisted-startup-driver'
import type { QueryStartupHistory } from './persisted-startup-driver'

const startupMembershipArb = persistedStartupMembershipArb(`scoped`)
const queryStartupHistoryArb: fc.Arbitrary<QueryStartupHistory> = fc
  .oneof(
    {
      weight: 3,
      arbitrary: fc.record({
        membership: startupMembershipArb,
        origin: fc.constant(`fetch` as const),
        response: fc.constantFrom(
          `before-restore` as const,
          `after-restore` as const,
        ),
      }),
    },
    {
      weight: 4,
      arbitrary: fc.record({
        membership: startupMembershipArb,
        origin: fc.constantFrom(
          `initial-disabled` as const,
          `initial-pending` as const,
          `cached-disabled` as const,
          `cached-pending` as const,
        ),
        response: fc.constant(`before-restore` as const),
      }),
    },
  )
  .map(({ membership, ...schedule }) => ({ ...membership, ...schedule }))

declareOracle({ grammar: [queryStartupHistoryArb] })
// Keep registration visible to Vitest's static typecheck collector as well
// as its runtime collector; the shared suite registers the actual law checks.
describe(`persisted startup conformance: Query`, () => {
  registerPersistedStartupConformance({
    property: `query.startup-ownership`,
    adapter: queryStartupAdapter,
    histories: queryStartupHistories,
    arbitrary: queryStartupHistoryArb,
    origins: [
      `fetch`,
      `initial-disabled`,
      `initial-pending`,
      `cached-disabled`,
      `cached-pending`,
    ],
    origin: (history) => history.origin,
  })
})
