import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import {
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  whenSyncAccepted,
} from '@tanstack/db'
import {
  runOptimisticHistory,
  wrappingSyncHistory,
} from '../../db/tests/optimistic-history-oracle'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import { persistedCollectionOptions } from '../src'
import type { CollectionConfig } from '@tanstack/db'
import type {
  HistoryRow,
  OptimisticStep,
  WrappingSyncLane,
} from '../../db/tests/optimistic-history-oracle'
import type { PersistedTx, PersistenceAdapter } from '../src'

/**
 * The optimistic-history oracle states which rows optimistic and sync
 * histories expose. Persistence is one production path for those laws: a
 * wrapping sync between the source and the Collection. This file runs the
 * oracle's model, grammar, and comparisons through `persistedCollectionOptions`
 * with an in-memory adapter.
 *
 * The persisted wrapper stores source transactions one at a time. The
 * `hold-store` step holds the next stored source transaction; source
 * transactions committed after it reach the Collection only after
 * `release-store`. That is the model's `deferred` state. The two laws under
 * test are the oracle's own: an optimistic mutation is visible in the tick
 * that makes it, and a settled optimistic row stays over the synced rows while
 * a committed sync transaction for its key has not applied, deferred or not.
 *
 * `abort-deferred` aborts one deferred transaction's signal. It never applies:
 * the wrapper discards it when its turn comes, and every settled row it alone
 * held drops in that publication. The model fixes that drop at the turn; an
 * implementation that dropped the hold at abort time would also be legal, and
 * this lane would reject it. The last test checks that each campaign reached
 * a hold across a drain and a hold released by an abort.
 *
 * Grammar limits: a handler cannot await acceptance while a hold is
 * outstanding, because acceptance follows the held durable step. The schema,
 * partial-update, and reentrant lanes stay core-only. The adapter is a Map,
 * so SQLite timing and coordinator messages are outside this lane.
 */
function createHoldingAdapter() {
  const rows = new Map<string | number, HistoryRow>()
  let holdNext = false
  let release: (() => void) | undefined
  let latest = { term: 0, seq: 0, rowVersion: 0 }
  const adapter: PersistenceAdapter = {
    loadSubset: () =>
      Promise.resolve(
        Array.from(rows, ([key, value]) => ({ key, value: { ...value } })),
      ),
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: latest.term,
        latestSeq: latest.seq,
        latestRowVersion: latest.rowVersion,
        resetEpoch: 0,
      }),
    loadCollectionMetadata: () => Promise.resolve([]),
    applyCommittedTx: async (_target, tx: PersistedTx) => {
      if (holdNext && (tx.truncate || tx.mutations.length > 0)) {
        holdNext = false
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      if (tx.truncate) rows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) rows.delete(mutation.key)
        else
          rows.set(mutation.key, {
            ...rows.get(mutation.key),
            ...mutation.value,
          } as HistoryRow)
      }
      latest = { term: tx.term, seq: tx.seq, rowVersion: tx.rowVersion }
    },
    ensureIndex: () => Promise.resolve(),
  }
  return {
    adapter,
    rows,
    holdNextStore: () => {
      holdNext = true
    },
    releaseStore: () => {
      holdNext = false
      release?.()
      release = undefined
    },
  }
}

let laneRun = 0

function persistedLane(): WrappingSyncLane & {
  rows: Map<string | number, HistoryRow>
} {
  const store = createHoldingAdapter()
  const id = `persisted-optimistic-history-${++laneRun}`
  return {
    db: {
      createCollection,
      createLiveQueryCollection,
      createTransaction,
      whenSyncAccepted,
    },
    rows: store.rows,
    wrap: (config) =>
      persistedCollectionOptions<HistoryRow, number>({
        ...(config as CollectionConfig<HistoryRow, number>),
        id,
        persistence: { adapter: store.adapter },
      }) as unknown as CollectionConfig<HistoryRow>,
    holdNextStore: store.holdNextStore,
    releaseStore: store.releaseStore,
    // The wrapper's turns are promise and timer continuations.
    settle: async () => {
      for (let turn = 0; turn < 10; turn++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    },
  }
}

// Each campaign must reach the states its laws are about, not only pass.
type CampaignReach = {
  runs: number
  deferredHolds: number
  abortReleases: number
}
const reach: Record<`fixed` | `random`, CampaignReach> = {
  fixed: { runs: 0, deferredHolds: 0, abortReleases: 0 },
  random: { runs: 0, deferredHolds: 0, abortReleases: 0 },
}

async function runPersistedHistory(
  {
    initial,
    steps,
  }: {
    initial: Array<HistoryRow>
    steps: Array<OptimisticStep>
  },
  campaign?: CampaignReach,
) {
  const lane = persistedLane()
  const counts = await runOptimisticHistory(initial, steps, undefined, {
    wrapping: lane,
  })
  if (!campaign) return
  campaign.runs++
  campaign.deferredHolds += counts.deferredHolds
  campaign.abortReleases += counts.abortReleases
}

// A handler commits its server row and returns without awaiting acceptance;
// the source's acknowledgement came at commit. The insert's stored row holds
// the store, so the update's server row is deferred when both settle.
const insertThenUpdateBehindHeldStore: Array<OptimisticStep> = [
  { type: `hold-store` },
  {
    type: `edit`,
    key: 1,
    fields: { a: 1 },
    optimistic: true,
    inHandler: {
      type: `sync`,
      rows: [{ id: 1, a: 1, b: 0, c: 0 }],
      truncate: false,
      copies: 1,
    },
  },
  {
    type: `edit`,
    key: 1,
    fields: { a: 2 },
    optimistic: true,
    inHandler: {
      type: `sync`,
      rows: [{ id: 1, a: 2, b: 0, c: 0 }],
      truncate: false,
      copies: 1,
    },
  },
  { type: `settle`, slot: 0, success: true, cascade: false },
  { type: `settle`, slot: 0, success: true, cascade: false },
  { type: `release-store` },
]

it(`keeps a settled update over its insert while the update's server row waits behind a held store`, async () => {
  await runPersistedHistory({
    initial: [],
    steps: insertThenUpdateBehindHeldStore,
  })
})

it(`reconstructs the persisted grammar and excludes awaited acceptance during a hold`, () => {
  const samples = fc.sample(wrappingSyncHistory, {
    seed: 22_011,
    numRuns: 200,
  })
  const steps = samples.flatMap((sample) => sample.steps)
  expect(steps.some((step) => step.type === `hold-store`)).toBe(true)
  expect(steps.some((step) => step.type === `release-store`)).toBe(true)
  for (const sample of samples) {
    let holding = false
    for (const step of sample.steps) {
      if (step.type === `hold-store`) holding = true
      if (step.type === `release-store`) holding = false
      if (holding && (step.type === `edit` || step.type === `delete`))
        expect(step.inHandler?.awaitReceipt ?? false).toBe(false)
    }
  }
})

fcTest.prop([wrappingSyncHistory], {
  numRuns: oracleRuns(40),
  seed: 22_012,
})(
  `persisted Collections match optimistic histories with a fixed seed`,
  (history) => runPersistedHistory(history, reach.fixed),
  60_000,
)
fcTest.prop(
  [wrappingSyncHistory],
  oraclePropertyOptions(40, `sqlite-persistence.optimistic-history`),
)(
  `persisted Collections match optimistic histories with a random or replayed seed`,
  (history) => runPersistedHistory(history, reach.random),
  60_000,
)

// A replay runs one history, so only full campaigns owe this reach.
it(`persisted campaigns reach deferred holds and holds released by an abort`, () => {
  if (process.env.TANSTACK_DB_ORACLE_SEED !== undefined) return
  for (const [name, campaign] of Object.entries(reach)) {
    if (campaign.runs === 0) continue
    expect(campaign.deferredHolds, `${name} deferred holds`).toBeGreaterThan(0)
    expect(campaign.abortReleases, `${name} abort releases`).toBeGreaterThan(0)
  }
})
