// Known ordered-loader defects outside #2136, witnessed through the
// ordered-prefix refetch oracle's production driver and check
// (refetch-ordered-prefix-driver-oracle.ts). Each `it.fails` witness passes
// while the defect reproduces and fails once the loader is fixed, so the limits
// in refetch-ordered-prefix-oracle.test.ts can then be removed.
import { expect, it } from 'vitest'
import { checkCase, startRun } from './refetch-ordered-prefix-driver-oracle'

// Known loader defects outside #2136. These witnesses fail today and
// reproduce on main; `it.fails` turns green work into a red signal once the
// ordered loader is fixed, so the limits above can be removed.
it.fails(
  `an offset-only provider fills a joined window at preload (known loader defect)`,
  async () => {
    const run = await startRun({
      scenario: {
        encoding: `offset`,
        functionKey: false,
        orderKey: `rank`,
        pageCap: undefined,
        terms: 1,
        limit: 1,
        offset: 0,
      },
      initial: [
        { id: 0, rank: 0, marked: true },
        { id: 1, rank: 0, marked: false },
        { id: 2, rank: 0, marked: false },
      ],
      history: [],
    })
    try {
      expect(run.windowIds()).toEqual([0])
    } finally {
      await run.cleanup()
    }
  },
)

it.fails(
  `a capped provider keeps a moved row in the window after a refetch (known loader defect)`,
  async () => {
    await checkCase({
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        orderKey: `rank`,
        pageCap: 2,
        terms: 1,
        limit: 2,
        offset: 1,
      },
      initial: [
        { id: 0, rank: 1, marked: true },
        { id: 1, rank: 0, marked: false },
      ],
      history: [
        { type: `flip`, id: 7 },
        { type: `upsert`, id: 2, rank: 1 },
        { type: `upsert`, id: 7, rank: 0 },
        { type: `refetch` },
        { type: `delete`, id: 3 },
        { type: `invalidate` },
        { type: `upsert`, id: 3, rank: 1 },
        { type: `upsert`, id: 0, rank: 0 },
      ],
    })
  },
)
