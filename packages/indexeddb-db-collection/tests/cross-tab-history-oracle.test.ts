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
 * Fixed/random campaigns share the exact property and bounds. Pinned histories
 * reconstruct every action; finite templates enumerate every sender/delivery
 * choice within their stated two-operation scope. This is not exhaustive native
 * scheduling, arbitrary optimistic overlap, or a same-key conflict policy.
 */
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { runCampaign } from './campaign'
import { runTransportHistory } from './cross-tab-driver'
import {
  CrossTabModel,
  assertPublicationHistory,
  assertReplay,
  assertSnapshot,
  assertStatuses,
} from './cross-tab-oracle'
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

async function campaign(seed?: number, path?: string) {
  await runCampaign(
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
    { runs, seed, path },
  )
}

if (process.env.TANSTACK_INDEXEDDB_ORACLE_SEED) {
  const seed = Number(process.env.TANSTACK_INDEXEDDB_ORACLE_SEED)
  if (!Number.isInteger(seed)) throw new Error('Invalid oracle replay seed')
  it(
    'replays the selected cross-tab history',
    () => campaign(seed, process.env.TANSTACK_INDEXEDDB_ORACLE_PATH),
    120_000,
  )
} else {
  it(
    'refines independent per-Collection snapshots with fixed histories',
    () => campaign(11792026),
    120_000,
  )
  it(
    'refines independent per-Collection snapshots with fresh histories',
    () => campaign(),
    120_000,
  )
}

it('reconstructs every action and overlapping receiver reads', async () => {
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
})

it('enumerates two ordered writes with every intermediate delivery choice', async () => {
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
}, 60_000)

it('requires local admission to distinguish identical durable deletions', () => {
  const row = { id: 0, name: 'old' }
  const delayed = new CrossTabModel([0, 0], [[row]])
  delayed.accept(0, { rows: [], deletes: [0], replace: false })
  expect(delayed.durable[0]).toEqual([])
  expect(delayed.publicSnapshots[1]).toEqual([row])
  // A durable-only projection rejects the locally legal update: explicit
  // grammar calibration, not a claimed production mutant.
  expect(() =>
    assertSnapshot(
      delayed.durable[0]!,
      delayed.publicSnapshots[1]!,
      'local admission',
    ),
  ).toThrow('public rows at local admission')
  delayed.receive(1, [{ rows: [], deletes: [0], replace: false }])
  expect(delayed.publicSnapshots[1]).toEqual([])
})

it('rejects repaired partial publications and malformed raw deltas', () => {
  const before = [
    { id: 0, name: 'a' },
    { id: 1, name: 'b' },
  ]
  const after = [
    { id: 0, name: 'new a' },
    { id: 1, name: 'new b' },
  ]
  const effect = { rows: after, deletes: [], replace: false }
  const first = {
    key: 0,
    type: 'update' as const,
    value: after[0]!,
    previousValue: before[0]!,
  }
  const second = {
    key: 1,
    type: 'update' as const,
    value: after[1]!,
    previousValue: before[1]!,
  }
  expect(() =>
    assertPublicationHistory(
      before,
      [
        { changes: [first], rows: [after[0]!, before[1]!] },
        { changes: [second], rows: after },
      ],
      [effect],
      'control',
    ),
  ).toThrow('atomic publication')
  for (const corrupt of [
    { ...first, type: 'insert' as const },
    { ...first, previousValue: { id: 0, name: 'wrong' } },
  ])
    expect(() =>
      assertPublicationHistory(
        before,
        [{ changes: [corrupt, second], rows: after }],
        [effect],
        'control',
      ),
    ).toThrow('event semantics')
  assertPublicationHistory(
    before,
    [{ changes: [first, second], rows: after }],
    [effect],
    'healthy control',
  )
  expect(() =>
    assertStatuses(['ready', 'error', 'ready'], ['ready'], 'repaired error'),
  ).toThrow('Collection status')
  expect(() =>
    assertReplay({
      inputReconstructed: true,
      premiseReached: false,
      sameFailure: false,
    }),
  ).toThrow('failure replay')
})

it('replays a generated intentional mismatch at its original law and checkpoint', () => {
  const property = fc.property(fc.integer({ min: 1, max: 20 }), (value) =>
    assertSnapshot(
      [{ id: value, name: 'wrong' }],
      [{ id: value, name: 'right' }],
      'replay calibration',
    ),
  )
  const original = fc.check(property, { seed: 1179 })
  expect(original.failed).toBe(true)
  const replay = fc.check(property, {
    seed: original.seed,
    path: original.counterexamplePath ?? undefined,
    endOnFailure: true,
  })
  assertReplay({
    inputReconstructed:
      JSON.stringify(original.counterexample) ===
      JSON.stringify(replay.counterexample),
    premiseReached: replay.numRuns > 0,
    sameFailure:
      replay.failed &&
      String(replay.error).includes('public rows at replay calibration'),
  })
})

it('rejects wrong raw event keys before folding including duplicate malformed inserts', () => {
  const row = { id: 1, name: 'accepted value' }
  const effect = { rows: [row], deletes: [], replace: false }
  for (const key of ['wrong', '1']) {
    const change = { key, type: 'insert' as const, value: row }
    for (const changes of [[change], [change, change]])
      expect(() =>
        assertPublicationHistory(
          [],
          [{ changes, rows: [row] }],
          [effect],
          'raw key identity',
        ),
      ).toThrow('event semantics')
  }
  expect(() =>
    assertPublicationHistory(
      [row],
      [
        {
          changes: [
            {
              key: 1,
              type: 'update',
              previousValue: row,
              value: { ...row, id: '1' },
            },
          ],
          rows: [{ ...row, id: '1' }],
        },
      ],
      [{ ...effect, rows: [{ ...row, id: '1' }] }],
      'update key identity',
    ),
  ).toThrow('event semantics')
})

it('replays only the selected history after the original failure is repaired', async () => {
  // This shrink path has a later sibling. fast-check check() continues into
  // that sibling when the selected counterexample passes, despite numRuns: 1.
  const arbitrary = fc.integer({ min: 0, max: 100 })
  const original = fc.check(
    fc.property(arbitrary, (value) => value < 10),
    { seed: 11792027, numRuns: 30 },
  )
  expect(original.counterexample).toEqual([10])
  expect(original.counterexamplePath).toBe('0:1:0:0:1')
  const observed: Array<number> = []
  await runCampaign(
    'repaired-replay-control',
    arbitrary,
    (value) => {
      observed.push(value)
      return Promise.resolve()
    },
    { runs: 30, seed: original.seed, path: original.counterexamplePath! },
  )
  expect(observed).toEqual([10])
})
