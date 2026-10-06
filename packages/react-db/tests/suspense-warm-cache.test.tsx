/**
 * A Suspense render asks for its data, so it counts as a preload. When the
 * source Collection already holds the rows, that preload starts the live-query
 * Collection's sync run and makes it ready before the first snapshot is read:
 * the synchronous observation cut. The component renders its data without
 * showing the fallback. Without a DbClient, this holds for eager and on-demand
 * source Collections and for ordered windows. A live-query Collection whose
 * sync run started before the preload would resume acquisition through the
 * restart path, one microtask later, and suspend once.
 */
import { expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { BTreeIndex, createCollection } from '@tanstack/db'
import { Suspense } from 'react'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'

type Row = { id: string; rank: number }
const ROWS: Array<Row> = [
  { id: `a`, rank: 1 },
  { id: `b`, rank: 2 },
  { id: `c`, rank: 3 },
]

for (const syncMode of [`eager`, `on-demand`] as const) {
  for (const shape of [`all`, `window`] as const) {
    it(`${syncMode} ${shape}: a source holding the rows renders without suspending`, () => {
      const source = createCollection<Row>({
        id: `warm-${syncMode}-${shape}`,
        getKey: (row) => row.id,
        syncMode,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of ROWS) write({ type: `insert`, value: row })
            commit()
            markReady()
            return syncMode === `on-demand`
              ? { loadSubset: () => true }
              : undefined
          },
        },
      })
      const renders: Array<string> = []
      function View() {
        const { data } = useLiveSuspenseQuery((q) => {
          const base = q.from({ row: source }).orderBy(({ row }) => row.rank)
          return shape === `window` ? base.limit(2) : base
        })
        renders.push(data.map((row) => row.id).join(``))
        return null
      }
      function Fallback() {
        renders.push(`fallback`)
        return null
      }
      render(
        <Suspense fallback={<Fallback />}>
          <View />
        </Suspense>,
      )
      expect(renders).toEqual([shape === `window` ? `ab` : `abc`])
    })
  }
}
