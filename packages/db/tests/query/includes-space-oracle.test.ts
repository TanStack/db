import { describe, expect } from 'vitest'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import { countEntries, withSpaceFixture } from './includes-space-helpers.js'
import type { AdapterState } from './includes-space-helpers.js'

/**
 * # Does nested Collection materialization retain only reachable facades?
 *
 * The nested-materialization contract in ARCHITECTURE.md gives one Collection
 * facade to each active bucket and releases retired buckets. Its space law
 * bounds retained facades by reachable relationships. A facade must not be
 * created per leaf or retained for a retired bucket at initial publication.
 *
 * The default fixture has two branches per root, five twigs per branch, and
 * ten leaves per twig. Facades exist for the root-to-branch, branch-to-twig, and
 * twig-to-leaf buckets. The expected count is therefore `roots + branches +
 * twigs`. Changing leaf count from zero to one to ten changes public row
 * volume while keeping those relationship buckets and their facade count.
 *
 * This oracle also checks setup ownership. All four source preloads must settle
 * before cleanup starts. A preload or index-creation failure cleans every
 * source, restores test instrumentation, preserves the first failure, and
 * reports cleanup failures separately.
 *
 * Facade-map inspection is a test diagnostic, not a runtime API. The count is a
 * bounded space invariant for this fixed topology, not a general heap measure.
 * It does not measure retained D2 rows, demand, or route churn.
 */

// The space law counts one facade for each reachable bucket: each root, the two
// branches under it, and the five twigs under each branch. Leaves change row
// volume but add no facade, so the count does not depend on leafCount.
function expectedFacadeCount(rootCount: number): number {
  return rootCount + rootCount * 2 + rootCount * 2 * 5
}

// The existing judgment of one fixed topology: preload it, then compare every
// constructed and retained facade with the reachable-bucket count above.
async function judgeReachableFacades(rootCount: number): Promise<void> {
  await withSpaceFixture(rootCount, async (fixture, entries) => {
    await fixture.live.preload()

    const adapters = new Set(entries.mock.contexts as Array<AdapterState>)
    const created = new Set(
      entries.mock.results
        .filter((result) => result.type === `return`)
        .map((result) => result.value),
    )
    expect(created.size).toBe(expectedFacadeCount(rootCount))
    expect(new Set([...created].map((entry) => entry.collection)).size).toBe(
      expectedFacadeCount(rootCount),
    )
    expect(
      [...adapters].reduce(
        (n, adapter) => n + countEntries(adapter.entries),
        0,
      ),
    ).toBe(expectedFacadeCount(rootCount))
    expect(
      [...adapters].reduce(
        (n, adapter) => n + countEntries(adapter.retiredEntries),
        0,
      ),
    ).toBe(0)
  })
}

const reachableFacadesLaw = `Nested Collection materialization constructs and retains exactly one facade per reachable bucket at initial publication, independent of leaf volume.`

describe(`nested Collection materialization space oracle`, () => {
  oracleProperty({
    id: `includes-space.reachable-facades`,
    law: {
      statement: reachableFacadesLaw,
      authority: `The nested-materialization and space laws (law 13) in packages/db/src/query/live/ARCHITECTURE.md, stated above.`,
      limits: `The three enumerated root counts of the fixed two-branch, five-twig topology at initial publication; no retained D2 row, demand, route-churn, or general heap claim.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/local-only.ts#localOnlyCollectionOptions`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/bucket-facade-adapter.ts`,
    ],
    histories: [0, 1, 20],
    label: (rootCount) =>
      `constructs exactly one facade per reachable bucket for ${rootCount} roots`,
    resolve: (rootCount) => ({ rootCount }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(reachableFacadesLaw, plan, observe, () =>
        judgeReachableFacades(plan.rootCount),
      ),
    check: forwardAssertionJudgment,
  })
})
