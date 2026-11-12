/**
 * Generated refinement of the cross-tab model (cross-tab-oracle.ts).
 *
 * Histories author from each Collection's expected public snapshot, delay peer
 * delivery, reuse keys, replace stores, and restart consumers. Delivery windows
 * overlap real receiver reads behind a native transaction; no write straddles
 * those reads. Each recorded publication is checked against one coherent
 * history of whole effects, with raw event and public status checks. Existing
 * peers and an ordinary successful suffix precede fresh restore.
 *
 * Fixed/random campaigns share the exact property and bounds. Fixed histories
 * reconstruct every action; finite templates enumerate every sender/delivery
 * choice within their stated two-operation scope. This is not exhaustive native
 * scheduling, arbitrary optimistic overlap, or a same-key conflict policy.
 */
import { fc } from '@fast-check/vitest'
import { beforeEach, expect } from 'vitest'
import { oracleProperty, oracleReplayRequested } from '../oracle-config.js'
import { nativeCampaignReceipt } from '../native-campaign-receipt'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../oracle-assertion-adapter'
import { campaignFailure, createCampaignRecorder } from './campaign'
import { runTransportHistory } from './cross-tab-driver'
import { assertSnapshot } from './cross-tab-oracle'
import type { TransportStep } from './cross-tab-driver'

const kinds = [
  'write',
  'delete',
  'clear',
  'import',
  'deliver',
  'restart',
  'omit',
] as const
const stress = process.env.TANSTACK_INDEXEDDB_ORACLE_PROFILE === 'stress'
const runs = stress ? 300 : 30
const step = fc.record({
  kind: fc.constantFrom(...kinds),
  tab: fc.integer({ min: 0, max: stress ? 4 : 2 }),
  key: fc.integer({ min: 0, max: 3 }),
  value: fc.integer({ min: -2, max: 2 }),
  optional: fc.boolean(),
})
const history = fc.array(step, {
  minLength: 0,
  maxLength: stress ? 100 : 20,
  ...(stress ? { size: 'large' as const } : {}),
})
const action = (
  kind: TransportStep['kind'],
  tab = 0,
  key = 0,
): TransportStep => ({ kind, tab, key, value: 2, optional: true })
const stores = stress ? [0, 0, 1, 0, 1] : [0, 0, 1]

// A recorder belongs to one native test. Its unchanged shrink predicate keeps
// the original law, checkpoint and every premise the first failure reached.
const crossTabProperty = `indexeddb.cross-tab-history`
let recorder: ReturnType<typeof createCampaignRecorder<Array<TransportStep>>>
let replayCalls = 0
beforeEach(() => {
  replayCalls = 0
  recorder = createCampaignRecorder(
    'transport',
    history,
    async (steps, receipt) => {
      await runTransportHistory(steps, stores, receipt.reach)
      if (process.env.TANSTACK_INDEXEDDB_ORACLE_CALIBRATION === '1')
        assertSnapshot(
          [{ id: 1, name: 'intentional wrong answer' }],
          [],
          'registered campaign calibration',
        )
    },
  )
})
nativeCampaignReceipt<Array<TransportStep>>((result) =>
  recorder.complete(result, {
    runs: result.runConfiguration.numRuns ?? runs,
    ...(oracleReplayRequested() ? { path: result.runConfiguration.path } : {}),
  }),
)
oracleProperty({
  id: crossTabProperty,
  timeout: 120_000,
  law: {
    statement:
      'Each cross-tab publication refines one coherent history of whole effects at its existing public row, event and status checkpoints.',
    authority:
      'The independent per-Collection model and public IndexedDB contract in cross-tab-oracle.ts.',
    limits:
      'The unchanged bounded controlled Channel and fake-indexeddb histories; native scheduling, arbitrary optimistic overlap and same-key conflict policy remain outside this owner.',
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: { arbitrary: history, runs, fixedSeeds: [11792026] },
  resolve: (steps) => ({ history: steps }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(crossTabProperty, plan, observe, async () => {
      if (oracleReplayRequested() && replayCalls++ > 0) return
      try {
        await recorder.run(plan.history)
      } catch (error) {
        // The recorder rethrows only the same failed law/checkpoint with the
        // first history's full premise set; preserve every other attempt in its report.
        rejectAt(
          campaignFailure(error).checkpoint,
          error instanceof Error
            ? error
            : new Error(String(error), { cause: error }),
        )
      }
    }),
  check: forwardAssertionJudgment,
})

// The fixed reconstruction and the finite two-write template replay through
// the transport driver outside the generated grammar's recorder.
async function reconstructEveryAction() {
  const reached = await runTransportHistory([
    action('write', 0),
    action('delete', 0),
    action('write', 1),
    action('clear', 0),
    action('import', 1),
    action('deliver', 0),
    action('omit', 1),
    action('restart', 2),
  ])
  for (const kind of [...kinds, 'overlapping receivers'])
    expect(reached.has(kind), kind).toBe(true)
}

async function enumerateOrderedWrites() {
  let explored = 0
  // 2 first writers × 2 second writers × 4 delivery subsets = 16 schedules.
  for (const first of [0, 1])
    for (const second of [0, 1])
      for (let mask = 0; mask < 4; mask++) {
        const steps = [action('write', first, 0)]
        for (const tab of [0, 1])
          if (mask & (1 << tab)) steps.push(action('deliver', tab))
        steps.push(action('write', second, 2))
        await runTransportHistory(steps, [0, 0])
        explored++
      }
  expect(explored).toBe(16)
}

oracleProperty({
  id: `indexeddb.cross-tab-history-reconstruction`,
  law: {
    statement:
      'Each cross-tab publication refines one coherent history of whole effects at its existing public row, event and status checkpoints.',
    authority:
      'The independent per-Collection model and public IndexedDB contract in cross-tab-oracle.ts.',
    limits:
      'One fixed history that reconstructs every action and overlapping receiver reads through the transport driver.',
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: ['reconstructs every action and overlapping receiver reads'],
  label: (name) => name,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `indexeddb.cross-tab-history-reconstruction`,
      plan,
      observe,
      () => reconstructEveryAction(),
    ),
  check: forwardAssertionJudgment,
})

oracleProperty({
  id: `indexeddb.cross-tab-history-ordered-writes`,
  law: {
    statement:
      'Each cross-tab publication refines one coherent history of whole effects at its existing public row, event and status checkpoints.',
    authority:
      'The independent per-Collection model and public IndexedDB contract in cross-tab-oracle.ts.',
    limits:
      'The finite template of two ordered writes with every sender and intermediate delivery choice (16 schedules).',
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: [
    'enumerates two ordered writes with every intermediate delivery choice',
  ],
  label: (name) => name,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `indexeddb.cross-tab-history-ordered-writes`,
      plan,
      observe,
      () => enumerateOrderedWrites(),
    ),
  check: forwardAssertionJudgment,
})
