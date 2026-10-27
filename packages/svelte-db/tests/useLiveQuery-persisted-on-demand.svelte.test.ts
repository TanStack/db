import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { eq } from '@tanstack/db'
import { SQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
import { createSerializedNodeSqliteDriver as createDriver } from '../../db-sqlite-persistence-core/tests/helpers/node-sqlite-driver'
import {
  A1,
  A2,
  FRAMEWORK_HISTORY_IDS,
  coverageRecords,
  createReceivingSource,
  receivingHistory,
  recordCheckpoints,
  session2SourceOptions,
} from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import { coverageViolations } from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import type {
  Session1Record,
  Session2Record,
  SourceEvent,
} from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import type { QueryObservation } from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'

/**
 * # Does a Svelte live query settle offline on a covered on-demand demand?
 *
 * Receiving witness for persisted demand coverage. The law, the histories, and
 * the checkpoint records are the receiving contract's
 * (`db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`),
 * and the shared judge (`db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle.ts`)
 * judges each record. The law's authority is
 * `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`.
 *
 * Histories: `FRAMEWORK_HISTORY_IDS` (`covered`, `never`, and
 * `covered-upstream-fails-at-once`). Session 1 is online and answers its load
 * at once through the source, or loads nothing. Session 2 is offline on the
 * same `node:sqlite` database, with the history's upstream behavior.
 *
 * Production path: `useLiveQuery` -> `createLiveQueryObserver` -> the live
 * query's on-demand `loadSubset` -> the persisted wrapper, which waits for the
 * network-first wait and then settles a covered demand from its restored rows.
 *
 * Observation: at each checkpoint of session 2, the primitive's `isReady` and
 * `data`.
 *
 * Limits: Svelte does not consume the network-first initial-render gate.
 * `preloadForInitialRender` and `isInitialRenderReady` are called only by
 * `react-db` and `solid-db`, so this witness checks the wrapper's settlement
 * through query readiness and rows, not a Svelte render gate. It uses one
 * filter, one primitive instance per session, and no component lifecycle.
 */

function queryGroupA(
  collection: ReturnType<typeof createReceivingSource>[`collection`],
) {
  return useLiveQuery((q) =>
    q.from({ row: collection }).where(({ row }) => eq(row.group, `a`)),
  )
}

// `useLiveQuery` registers Svelte effects, so each query mounts in its own
// effect root; the returned `dispose` tears that root down.
function mountGroupA(
  collection: ReturnType<typeof createReceivingSource>[`collection`],
) {
  const mounted: { query?: ReturnType<typeof queryGroupA> } = {}
  const dispose = $effect.root(() => {
    mounted.query = queryGroupA(collection)
  })
  return { query: mounted.query!, dispose }
}

function observeQuery(query: ReturnType<typeof queryGroupA>): QueryObservation {
  if (!query.isReady) return { status: `loading` }
  return {
    status: `ready`,
    rows: query.data.map((row) => row.id).sort(),
  }
}

describe(`Svelte useLiveQuery over a persisted on-demand Collection offline`, () => {
  it.each(FRAMEWORK_HISTORY_IDS.map(receivingHistory))(
    `$description`,
    async (history) => {
      vi.spyOn(console, `warn`).mockImplementation(() => {})
      vi.spyOn(console, `error`).mockImplementation(() => {})
      const driver = createDriver(new DatabaseSync(`:memory:`))
      const persistence = () => ({
        adapter: new SQLiteCorePersistenceAdapter({ driver }),
      })

      const session1Events: Array<SourceEvent> = []
      if (history.session1.length > 0) {
        const first = createReceivingSource({
          persistence: persistence(),
          waitMs: 0,
          behavior: `answer-at-once`,
          events: session1Events,
          answerRows: [A1, A2],
        })
        const { query, dispose } = mountGroupA(first.collection)
        await vi.waitFor(() => expect(query.isReady).toBe(true))
        dispose()
        await new Promise((resolve) => setTimeout(resolve, 50))
        await first.collection.cleanup()
      }
      const session1: Session1Record = { events: session1Events }

      const second = createReceivingSource({
        persistence: persistence(),
        ...session2SourceOptions(history),
        events: [],
      })
      const loadStartedAt = Date.now()
      const { query, dispose } = mountGroupA(second.collection)
      try {
        const checkpoints = await recordCheckpoints(
          () => observeQuery(query),
          () => second.received.length,
          loadStartedAt,
        )
        const session2: Session2Record = {
          sent: [...second.received],
          ...checkpoints,
        }
        // Positive witness: session 2 asked the offline source for group a.
        expect(session2.sent.length).toBeGreaterThan(0)
        const records = coverageRecords(history, session1, session2)
        expect(coverageViolations(records.beforeDeadline)).toEqual([])
        expect(coverageViolations(records.afterDeadline)).toEqual([])
      } finally {
        dispose()
        await second.collection.cleanup()
      }
    },
  )
})
