/** Query receives the shared persistence law, including its cache origins.
 * Already-available initial/cache results cannot be delivered after restore;
 * fetched answers exercise both schedules. Pending origins hold queryFn until
 * after the startup durable comparison, so refetch cannot conceal the defect.
 */
import { describe } from 'vitest'
import fc from 'fast-check'
import { registerPersistedStartupConformance } from '../../db-adapter-conformance/tests/persisted-startup-oracle-suite'
import {
  queryStartupAdapter,
  queryStartupHistories,
} from './persisted-startup-driver'
import type { QueryStartupHistory } from './persisted-startup-driver'

// The record states the same legal language as the former chained render
// grammar. A cached/initial answer is already available before restore, while
// only a held fetch can cross restore or reach network-first fallback. Optional
// fields are absent when that action was not authored, matching fixed replays.
const queryStartupHistoryArb: fc.Arbitrary<QueryStartupHistory> = fc
  .record(
    {
      previous: fc.integer({ min: 0, max: 7 }),
      next: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 7 })),
      peer: fc.boolean(),
      origin: fc.constantFrom(
        `fetch` as const,
        `initial-disabled` as const,
        `initial-pending` as const,
        `cached-disabled` as const,
        `cached-pending` as const,
      ),
      response: fc.constantFrom(
        `before-restore` as const,
        `after-restore` as const,
        `after-deadline` as const,
      ),
      mutation: fc.constant(`persisting` as const),
      previousOwner: fc.constant(`none` as const),
      initialRender: fc.constant(`network-first` as const),
    },
    { requiredKeys: [`previous`, `next`, `peer`, `origin`, `response`] },
  )
  .filter(
    (h) =>
      (!h.peer || h.previous !== 0) &&
      (h.previousOwner === undefined || h.previous !== 0) &&
      (h.origin === `fetch` || h.response === `before-restore`) &&
      (h.response !== `after-deadline` ||
        (h.initialRender === `network-first` && h.previous !== 0)),
  )

// Keep registration visible to Vitest's static typecheck collector as well
// as its runtime collector; the shared suite registers the actual law checks.
describe(`persisted startup conformance: Query`, () => {
  registerPersistedStartupConformance({
    property: `query.startup-ownership`,
    adapter: queryStartupAdapter,
    // The receiving path judges persisted startup through this adapter entry.
    // The shared model owns replacement; this list lets the gap CLI credit it.
    owns: [`src/query.ts#queryCollectionOptions`],
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
