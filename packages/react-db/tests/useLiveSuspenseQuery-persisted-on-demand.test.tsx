import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { render as renderComponent, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { eq } from '@tanstack/db'
import { SQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
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
 * # Does React Suspense release offline on a covered on-demand demand?
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
 * at once, through the source, or loads nothing. Session 2 is offline, on the
 * same `node:sqlite` database, with the history's upstream behavior.
 *
 * Production path: `useLiveSuspenseQuery` under `Suspense`, over a real
 * persisted on-demand Collection and `SQLiteCorePersistenceAdapter`.
 *
 * Observation: at each checkpoint of session 2, whether the fallback still
 * renders (`loading`) or the rendered ids are shown (`ready`).
 *
 * Limits: one filter, one React render path, no StrictMode. The
 * network-first gate is the Suspense gate, so this host checks the gate the
 * wrapper feeds as well as the wrapper's settlement.
 */

function GroupA({
  collection,
}: {
  collection: ReturnType<typeof createReceivingSource>[`collection`]
}) {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ row: collection }).where(({ row }) => eq(row.group, `a`)),
  )
  return (
    <div>
      {data
        .map((row) => row.id)
        .sort()
        .join(`,`) || `empty`}
    </div>
  )
}

// Reads the Suspense output: the fallback while the query is loading, or the
// rendered ids once it is ready.
function renderedOutcome(
  view: ReturnType<typeof renderComponent>,
): QueryObservation {
  if (view.queryByText(`Loading`) !== null) return { status: `loading` }
  const text = view.container.textContent
  return {
    status: `ready`,
    rows: text === `empty` ? [] : text.split(`,`),
  }
}

describe(`React Suspense over a persisted on-demand Collection offline`, () => {
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
        const view = renderComponent(
          <Suspense fallback={<div>Loading</div>}>
            <GroupA collection={first.collection} />
          </Suspense>,
        )
        await waitFor(() => expect(view.getByText(`a1,a2`)).toBeTruthy())
        view.unmount()
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
      const view = renderComponent(
        <Suspense fallback={<div>Loading</div>}>
          <GroupA collection={second.collection} />
        </Suspense>,
      )
      try {
        const checkpoints = await recordCheckpoints(
          () => renderedOutcome(view),
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
        view.unmount()
        await second.collection.cleanup()
      }
    },
  )
})
