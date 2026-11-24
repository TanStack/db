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
 * One joined window covers a held root whose joined source has not answered.
 * An open truncate replay is not exercised here.
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
import { describe, expect, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { CollectionConfigBuilder } from '../../src/query/live/collection-config-builder.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators.js'
import { PropRef } from '../../src/query/ir.js'
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

// More reads than any terminating drain makes.
const joinedReadBudget = 1000

// A held root answers its page and tie synchronously while its joined source
// has started no work. The refill then waits for that work: the deferred query
// must return, and its first subscriber must still reach the right window.
async function runJoinedHeldCell({
  root: history,
}: {
  root: `held` | `held-later`
}): Promise<void> {
  let holds = history === `held`
  let ready = () => {}
  const owners = rows.map(({ id }) => ({ id, active: id % 2 === 0 }))
  const root = createCollection<Row>({
    id: `deferred-loaded-subset-joined-root-${history}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: history === `held`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) write({ type: `insert`, value: { ...row } })
        commit()
        if (history === `held`) markReady()
        else ready = markReady
        return {
          loadSubset: () => true as const,
          isSubsetLoaded: () => holds,
        }
      },
    },
  })
  const joined = createCollection<{ id: number; active: boolean }>({
    id: `deferred-loaded-subset-joined-owners-${history}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const written = new Set<number>()
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const where = options.where
              ? compileSingleRowExpression(options.where)
              : undefined
            return new Promise<void>((resolve) =>
              setTimeout(() => {
                begin()
                for (const owner of owners) {
                  if ((where && where(owner) !== true) || written.has(owner.id))
                    continue
                  written.add(owner.id)
                  write({ type: `insert`, value: owner })
                }
                const receipt = commit()
                void (receipt === true ? resolve() : receipt.then(resolve))
              }, 1),
            )
          },
        }
      },
    },
  })
  const original = CollectionConfigBuilder.prototype.hasPendingJoinedWork
  let joinedReads = 0
  const reads = vi
    .spyOn(CollectionConfigBuilder.prototype, `hasPendingJoinedWork`)
    .mockImplementation(function (this: never, id: string) {
      if (++joinedReads > joinedReadBudget) {
        throw new Error(`joined-work read budget exceeded`)
      }
      return original.call(this, id)
    })
  let live: ReturnType<typeof buildJoined> | undefined
  function buildJoined() {
    return createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ row: root })
          .leftJoin({ owner: joined }, ({ row, owner }) => eq(row.id, owner.id))
          .where(({ owner }) => eq(owner.active, true))
          .orderBy(({ row }) => row.rank, `desc`)
          .limit(3)
          .select(({ row }) => ({ id: row.id })),
    })
  }
  try {
    try {
      live = buildJoined()
      if (history === `held-later`) {
        root.startSyncImmediate()
        holds = true
        ready()
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
    } catch {
      // The read budget ended a spinning drain; the comparison below names it.
    }
    expect(joinedReads, `the deferred query returns`).toBeLessThanOrEqual(
      joinedReadBudget,
    )
    const subscription = live!.subscribeChanges(() => {})
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(
      Array.from(live!.values(), ({ id }) => id),
      `window after a subscriber`,
    ).toEqual(expectedIds)
    subscription.unsubscribe()
  } finally {
    reads.mockRestore()
    await live?.cleanup()
    await root.cleanup()
    await joined.cleanup()
  }
}

// A source that becomes ready after the hook settled a deferred demand owes
// that demand nothing: its window is published and it is not loading.
async function runSourceReadyCell({
  source: history,
}: {
  source:
    `late-ready` | `released` | `held-later` | `never-held` | `ready-in-sync`
}): Promise<void> {
  let ready!: () => void
  const startsLate =
    history === `held-later` ||
    history === `never-held` ||
    history === `ready-in-sync`
  let holds = !startsLate
  const asked: Array<LoadSubsetOptions> = []
  const source = createCollection<Row>({
    id: `deferred-loaded-subset-source-${history}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: !startsLate,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) write({ type: `insert`, value: { ...row } })
        commit()
        ready = markReady
        // The adapter is ready before it returns its hook.
        if (history === `ready-in-sync`) markReady()
        return {
          loadSubset: () => true as const,
          isSubsetLoaded: (options: LoadSubsetOptions) => {
            asked.push(options)
            return holds
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    startSync: true,
    query: (q) =>
      q
        .from({ row: source })
        .where(({ row }) => eq(row.group, `even`))
        .orderBy(({ row }) => row.rank, `desc`)
        .limit(3)
        .select(({ row }) => ({ id: row.id })),
  })
  try {
    // Once the adapter no longer vouches for the rows, the demand is
    // unanswered and the deferred query is waiting on it.
    if (history === `released`) holds = false
    // The source starts while the hook says not held, so the demand is
    // reported as loading. Once the hook holds it and the source is ready,
    // nothing is left to load until a subscriber resumes acquisition.
    const deferred = startsLate
      ? source.subscribeChanges(() => {}, { deferAcquisition: true })
      : undefined
    if (deferred) {
      deferred.requestSnapshot({ where: eq(new PropRef([`group`]), `even`) })
      if (history === `ready-in-sync`) holds = true
      source.startSyncImmediate()
      if (history !== `ready-in-sync`)
        expect(deferred.status, `loading while not held`).toBe(`loadingSubset`)
      holds = history !== `never-held`
    }
    if (history !== `ready-in-sync`) ready()
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (history === `never-held`) {
      expect(deferred!.status, `an unheld demand keeps loading`).toBe(
        `loadingSubset`,
      )
      expect(live.size, `an unheld window stays unpublished`).toBe(0)
      // Its first page never settled, so the loader asked for no tie.
      expect(
        asked.filter(
          (options) =>
            options.subscription !== deferred && options.limit === undefined,
        ),
        `an unheld page starts no tie`,
      ).toEqual([])
      expect(live.isLoadingSubset, `an unheld window is loading`).toBe(true)
      deferred!.unsubscribe()
    } else if (history === `held-later` || history === `ready-in-sync`) {
      expect(deferred!.status, `a held demand stops loading`).toBe(`ready`)
      expect(
        Array.from(live.values(), ({ id }) => id),
        `a demand that became held publishes its window`,
      ).toEqual(expectedIds)
      expect(live.isLoadingSubset, `the held window is not loading`).toBe(false)
      deferred!.unsubscribe()
    } else if (history === `released`) {
      expect(live.isLoadingSubset, `an unanswered demand is loading`).toBe(true)
    } else {
      expect(
        Array.from(live.values(), ({ id }) => id),
        `published window`,
      ).toEqual(expectedIds)
      expect(live.isLoadingSubset, `a settled demand is not loading`).toBe(
        false,
      )
    }
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
}

describe(`deferred window over a held subset`, () => {
  oracleProperty({
    id: `deferred-loaded-subset.joined`,
    law: {
      statement: `A deferred joined window over a held root returns while its joined source has not answered, and reaches the right window after its first subscriber.`,
      authority: `query/live/ARCHITECTURE.md: Deferred acquisition; Ordered requests, continuation, and recovery.`,
      limits: `One LEFT-joined filter whose root answers synchronously.`,
    },
    owns: ['src/query/live/ordered-source-loader.ts'],
    histories: [{ root: `held` }, { root: `held-later` }] as Array<{
      root: `held` | `held-later`
    }>,
    label: ({ root }) => `${root} root with an unanswered joined source`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`deferred joined window`, plan, observe, () =>
        runJoinedHeldCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `deferred-loaded-subset.source-ready`,
    law: {
      statement: `A deferred demand the hook settled is not reported as loading when its source later becomes ready, unless the adapter no longer vouches for its rows, and stops being reported as loading once the adapter does.`,
      authority: `query/live/ARCHITECTURE.md: Deferred acquisition.`,
      limits: `One ordered window whose source becomes ready after the hook answered, with the hook still holding, after it stopped, after it began holding, when it never held, and when the source is ready before it returns the hook.`,
    },
    owns: ['src/collection/subscription.ts'],
    histories: [
      { source: `late-ready` },
      { source: `released` },
      { source: `held-later` },
      { source: `never-held` },
      { source: `ready-in-sync` },
    ] as Array<{
      source:
        | `late-ready`
        | `released`
        | `held-later`
        | `never-held`
        | `ready-in-sync`
    }>,
    label: ({ source }) => `${source} source`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`deferred source ready`, plan, observe, () =>
        runSourceReadyCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })

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
