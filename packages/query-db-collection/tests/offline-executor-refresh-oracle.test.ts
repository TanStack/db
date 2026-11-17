import fc from 'fast-check'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  barrierModel,
  checkBarrier,
} from '../../offline-transactions/tests/executor-refresh-barrier-oracle'
import { driveQueryBarrier } from './offline-executor-refresh-driver'
import type {
  BarrierCut,
  BarrierHistory,
} from '../../offline-transactions/tests/executor-refresh-barrier-oracle'

// QueryDB consumes the same barrier through a real refetch receipt. Promise
// settlement alone can leave that consumer waiting if the executor retains a
// field the adapter still treats as active. This receiving path therefore feeds
// public refetch settlement and rows into the same independent judgment in executor-refresh-barrier-oracle.ts.
// The established offline-refresh e2e contract supplies the stale-read premise.
// It uses controlled Node/jsdom scheduling, not native browser online events.
const queryBarrierHistory: fc.Arbitrary<BarrierHistory> = fc.record({
  count: fc.integer({ min: 1, max: 3 }),
  overlap: fc.constant(false),
  retire: fc.constant(false),
  notifications: fc.integer({ min: 1, max: 3 }),
})
const queryBarrierStates = [
  `pending refresh barrier`,
  `stale refetch delivered`,
  `query deferred by barrier`,
  `query refresh settled`,
]
oracleProperty<BarrierHistory, ReturnType<typeof barrierModel>>({
  id: `offline.executor-connectivity-query-db`,
  law: {
    statement: `A real QueryDB refetch that receives stale data during restored durable replay remains pending while provider work is held, then fulfills with fresh rows after provider settlement and acknowledged outbox cleanup.`,
    authority: `Collection.deferDataRefresh public JSDoc; QueryDB external refetch settlement owner and offline-refresh e2e stale-read premise. Persisting local mutations have a separate fetch-settlement exception.`,
    limits: `Real QueryClient and QueryDB Collection in Node/jsdom, one to three restored offline inserts with per-ID waiters, controlled query backend and provider; no native browser event or remote durability claim. Local persisting-mutation refetches may settle at fetch; overlap and retirement remain with the core receiving path.`,
  },
  histories: {
    arbitrary: queryBarrierHistory,
    runs: 12,
    fixedSeeds: [20261110],
    states: queryBarrierStates,
    constructed: queryBarrierStates.map((state) => ({
      name: state,
      enters: [state],
      build: (plan) => plan,
    })),
  },
  model: barrierModel,
  driver: driveQueryBarrier,
  check: checkBarrier,
  calibrations: [
    {
      name: `a settled core barrier leaves the public refetch pending`,
      law: `query refresh settlement`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `batch completed`
            ? {
                ...entry,
                value: {
                  ...(entry.value as BarrierCut),
                  query: {
                    ...(entry.value as BarrierCut).query!,
                    receipt: `pending`,
                  },
                },
              }
            : entry,
        ),
    },
    {
      name: `a stale refetch settles before the held provider`,
      law: `query refresh settlement`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `stale refetch held`
            ? {
                ...entry,
                value: {
                  ...(entry.value as BarrierCut),
                  query: {
                    ...(entry.value as BarrierCut).query!,
                    receipt: `fulfilled`,
                  },
                },
              }
            : entry,
        ),
    },
  ],
})
