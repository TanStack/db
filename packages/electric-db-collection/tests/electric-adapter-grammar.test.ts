// Calibrates the Electric adapter oracle's grammars and comparisons without
// production: each grammar reconstructs its fixed-seed sample and rejects
// ablated, out-of-range and foreign campaigns, and each comparison rejects a
// named wrong answer. The oracle in electric-oracle.property.test.ts runs the
// same parts against production.
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { oracleReplayTest } from '../../db/tests/oracle-config'
import {
  change,
  mustRefetch,
  subsetEnd,
  upToDate,
} from './electric-adapter-support'
import {
  expectPersistenceInterleavingObservation,
  expectQueuedPresenceAtDurabilityHold,
  isSdkResetFramedPartition,
  persistenceInterleavingCampaignArbitrary,
  queuedPresenceArbitraries,
  queuedPresenceFixedSeed,
  queuedPresenceHistories,
  reconstructPersistenceInterleavingCampaign,
  reconstructQueuedPresenceCampaign,
} from './electric-adapter-grammar-oracle'
import type { OracleRow } from './electric-adapter-support'
import type { Message } from '@electric-sql/client'

oracleReplayTest(it)(
  `reconstructs the queued-presence grammar and rejects ablated, out-of-range, and foreign campaigns`,
  () => {
    const campaigns = fc.sample(fc.tuple(...queuedPresenceArbitraries), {
      seed: queuedPresenceFixedSeed,
      numRuns: 20,
    })
    for (const [histories, names] of campaigns) {
      expect(reconstructQueuedPresenceCampaign({ histories, names })).toEqual({
        histories,
        names,
      })
    }

    const witness = {
      histories: [...queuedPresenceHistories],
      names: [``, `x`.repeat(12)] as [string, string],
    }
    expect(reconstructQueuedPresenceCampaign(witness)).toEqual(witness)
    expect(() =>
      reconstructQueuedPresenceCampaign({ names: witness.names }),
    ).toThrow()
    expect(() =>
      reconstructQueuedPresenceCampaign({ histories: witness.histories }),
    ).toThrow()
    expect(() =>
      reconstructQueuedPresenceCampaign({
        ...witness,
        histories: witness.histories.slice(1),
      }),
    ).toThrow()
    expect(() =>
      reconstructQueuedPresenceCampaign({
        ...witness,
        histories: [
          `insert-update`,
          `insert-update`,
          `delete-update`,
          `truncate-update`,
        ],
      }),
    ).toThrow()
    expect(() =>
      reconstructQueuedPresenceCampaign({
        ...witness,
        histories: [
          `insert-update`,
          `update-update`,
          `delete-update`,
          `replace-update`,
        ],
      }),
    ).toThrow()
    expect(() =>
      reconstructQueuedPresenceCampaign({
        ...witness,
        names: [`x`.repeat(13), ``],
      }),
    ).toThrow()
  },
)

oracleReplayTest(it)(
  `rejects named wrong answer: later callback publishes before durability`,
  () => {
    expect(() =>
      expectQueuedPresenceAtDurabilityHold(
        [
          [1, `holds persistence`, `stable-1`],
          [2, `later`, `stable-2`],
        ],
        `insert-update`,
        { id: 1, name: `holds persistence`, stable: `stable-1` },
      ),
    ).toThrow()
  },
)

oracleReplayTest(it)(
  `keeps SDK reset callbacks separate from every neighboring message kind`,
  () => {
    const neighbors: Array<Message<OracleRow>> = [
      change(`insert`, 1, `row`),
      change(`update`, 1, `row`),
      change(`delete`, 1, `row`),
      {
        headers: { event: `move-out`, patterns: [{ pos: 0, value: `left` }] },
      },
      upToDate,
      subsetEnd,
      mustRefetch,
    ]
    expect(isSdkResetFramedPartition([[mustRefetch]])).toBe(true)
    for (const neighbor of neighbors) {
      for (const messages of [
        [neighbor, mustRefetch],
        [mustRefetch, neighbor],
      ]) {
        expect(
          isSdkResetFramedPartition([messages]),
          JSON.stringify(messages),
        ).toBe(false)
        expect(
          isSdkResetFramedPartition(messages.map((message) => [message])),
        ).toBe(true)
      }
    }
  },
)

oracleReplayTest(it)(
  `reconstructs persistence-interleaving campaigns and rejects ablated, out-of-range, and foreign histories`,
  () => {
    const campaigns = fc.sample(persistenceInterleavingCampaignArbitrary, {
      seed: 18_530_601,
      numRuns: 20,
    })
    for (const campaign of campaigns) {
      expect(reconstructPersistenceInterleavingCampaign(campaign)).toEqual(
        campaign,
      )
      expect(() =>
        reconstructPersistenceInterleavingCampaign({
          names: campaign.names,
        }),
      ).toThrow()
      expect(() =>
        reconstructPersistenceInterleavingCampaign({
          histories: campaign.histories,
        }),
      ).toThrow()
      expect(() =>
        reconstructPersistenceInterleavingCampaign({
          ...campaign,
          histories: [`open-transaction-hydration`, `foreign`],
        }),
      ).toThrow()
      expect(() =>
        reconstructPersistenceInterleavingCampaign({
          ...campaign,
          names: [``, campaign.names[1]],
        }),
      ).toThrow()
    }
  },
)

oracleReplayTest(it)(
  `rejects named wrong answers for persistence interleavings`,
  () => {
    const names: [string, string] = [`before`, `after`]
    expect(() =>
      expectPersistenceInterleavingObservation(
        {
          kind: `open-transaction-hydration`,
          hydrationStartedBeforeCommit: true,
          hydrationOutcomeBeforeRelease: `AbortError`,
          cachedRowBeforeRelease: true,
          hydrationOutcome: `fulfilled`,
          publicRowsAtHydrationSettlement: [],
          deliveryErrors: [`InvalidPersistedCollectionConfigError`],
          publicRows: [],
          durableRows: [],
          status: `ready`,
          publicError: undefined,
        },
        names,
      ),
    ).toThrow()
    expect(() =>
      expectPersistenceInterleavingObservation(
        {
          kind: `subset-supersedes-absence`,
          publicRows: [],
          durableRows: [],
          status: `ready`,
          publicError: undefined,
        },
        names,
      ),
    ).toThrow()
  },
)
