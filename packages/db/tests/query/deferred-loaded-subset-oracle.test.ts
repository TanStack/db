/**
 * # A deferred window over a held subset publishes without provider work
 *
 * ## Contract
 *
 * `query/live/ARCHITECTURE.md`, "Deferred acquisition": a live query with no
 * subscriber or preload starts no provider work, and an ordered window over an
 * on-demand source is not published until its acquisitions settle, because
 * local rows cannot prove a window. `isSubsetLoaded` is the sync adapter's
 * local statement that the Collection already holds every row of a subset.
 * With that statement the deferred window publishes those rows at once.
 * Acquisition still starts when the query resumes.
 *
 * ## Limits
 *
 * The cells vary the hook over one ordered window on one on-demand source: no
 * hook, a hook that says held, one that says not held, one that throws, and one
 * that returns a truthy non-boolean. A
 * hook that claims rows the Collection does not hold is outside the contract.
 * Joined windows and an open truncate replay are not exercised here.
 *
 * ## Model
 *
 * `publishesBeforeSubscribe` follows from the hook alone: only a `held` answer
 * publishes before a subscriber. Every cell issues no provider request before
 * its subscriber and at least one after it.
 *
 * ## Production path and observation
 *
 * The driver runs a real live query twice over one source: the first preload
 * installs the rows, and the second query is observed before and after its
 * first subscriber through public status, rows and `loadSubset` calls.
 */
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import type { LoadSubsetOptions } from '../../src/types.js'

type Row = { id: number; rank: number; group: string }

const rows: Array<Row> = Array.from({ length: 20 }, (_, id) => ({
  id,
  rank: 100 - id,
  group: id % 2 === 0 ? `even` : `odd`,
}))
const expectedIds = rows
  .filter(({ group }) => group === `even`)
  .slice(0, 3)
  .map(({ id }) => id)

const hookCases = [
  { hook: `none` },
  { hook: `held` },
  { hook: `not-held` },
  { hook: `throws` },
  { hook: `truthy` },
] as const
type HookCase = (typeof hookCases)[number]

const publishesBeforeSubscribe = ({ hook }: HookCase) => hook === `held`

function hookFor({ hook }: HookCase, holdsSubset: () => boolean) {
  switch (hook) {
    case `none`:
      return {}
    case `held`:
      return { isSubsetLoaded: holdsSubset }
    case `not-held`:
      return { isSubsetLoaded: () => false }
    case `truthy`:
      return { isSubsetLoaded: () => 1 as unknown as boolean }
    case `throws`:
      return {
        isSubsetLoaded: (): boolean => {
          throw new Error(`hook failed`)
        },
      }
  }
}

async function runHookCell(cell: HookCase): Promise<void> {
  const loads: Array<LoadSubsetOptions> = []
  // The adapter's statement is true only once a load has installed the rows.
  let holdsSubset = false
  const source = createCollection<Row>({
    id: `deferred-loaded-subset-${cell.hook}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    gcTime: 0,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const written = new Set<number>()
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loads.push(options)
            const where = options.where
              ? compileSingleRowExpression(options.where)
              : undefined
            const answer = [...rows]
              .sort((a, b) => b.rank - a.rank)
              .filter((row) => !where || where(row) === true)
              .slice(0, options.limit)
            return new Promise<void>((resolve) =>
              setTimeout(() => {
                begin()
                for (const row of answer) {
                  if (written.has(row.id)) continue
                  written.add(row.id)
                  write({ type: `insert`, value: { ...row } })
                }
                const receipt = commit()
                holdsSubset = true
                void (receipt === true ? resolve() : receipt.then(resolve))
              }, 1),
            )
          },
          ...hookFor(cell, () => holdsSubset),
        }
      },
    },
  })
  const query = () =>
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ row: source })
          .where(({ row }) => eq(row.group, `even`))
          .orderBy(({ row }) => row.rank, `desc`)
          .limit(3)
          .select(({ row }) => ({ id: row.id })),
    })

  const first = query()
  await first.preload()
  await first.cleanup()
  const before = loads.length

  const again = query()
  try {
    if (publishesBeforeSubscribe(cell)) {
      expect(again.status, `ready before a subscriber`).toBe(`ready`)
      expect(
        Array.from(again.values(), ({ id }) => id),
        `rows before a subscriber`,
      ).toEqual(expectedIds)
    } else {
      expect(again.status, `not ready before a subscriber`).not.toBe(`ready`)
      expect(again.size, `no rows before a subscriber`).toBe(0)
    }
    expect(loads.length, `no provider work before a subscriber`).toBe(before)

    const subscription = again.subscribeChanges(() => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(loads.length, `acquisition starts on resume`).toBeGreaterThan(before)
    expect(
      Array.from(again.values(), ({ id }) => id),
      `rows after a subscriber`,
    ).toEqual(expectedIds)
    subscription.unsubscribe()
  } finally {
    await again.cleanup()
    await source.cleanup()
  }
}

describe(`deferred window over a held subset`, () => {
  oracleProperty({
    id: `deferred-loaded-subset.window`,
    law: {
      statement: `A deferred ordered window publishes before a subscriber only when isSubsetLoaded says the source holds its subset, starts no provider work before then, and still acquires after.`,
      authority: `query/live/ARCHITECTURE.md: Deferred acquisition.`,
      limits: `Five hook answers over one ordered window; joined windows and an open truncate replay are not exercised.`,
    },
    owns: ['src/collection/subscription.ts', 'src/collection/sync.ts'],
    histories: hookCases,
    label: ({ hook }) => `with hook ${hook}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`deferred held window`, plan, observe, () =>
        runHookCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })
})
