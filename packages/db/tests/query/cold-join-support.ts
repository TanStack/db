/**
 * Fixture and cleanup helpers shared by the cold-join reconciliation oracle and
 * its ordinary unit tests in cold-join-reconciliation.test.ts. They build
 * equality sources, compare join pairs, and release resources after a check.
 * The laws are owned by cold-join-reconciliation-oracle.test.ts.
 */
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import type { Collection } from '../../src/collection/index.js'
import type { SyncConfig } from '../../src/types.js'

export type EqualityRow = { id: number; value: unknown }
export type JoinPair = readonly [number | undefined, number | undefined]
export type EqualityMode = `off` | `eager`
export type MutableEqualitySource<T extends { id: number }> = Collection<
  T,
  number
> & {
  oracleReplace: (row: T) => Promise<void>
}

let equalitySourceId = 0

export function createEqualitySource<T extends { id: number }>(
  label: string,
  rows: ReadonlyArray<T>,
  autoIndex: EqualityMode,
): MutableEqualitySource<T> {
  let actions!: Parameters<SyncConfig<T, number>[`sync`]>[0]
  const collection = createCollection<T, number>({
    id: `${label}-${equalitySourceId++}`,
    getKey: (row) => row.id,
    autoIndex,
    defaultIndexType: autoIndex === `eager` ? BTreeIndex : undefined,
    startSync: true,
    sync: {
      sync: (nextActions) => {
        actions = nextActions
        const { begin, write, commit, markReady } = nextActions
        begin()
        for (const row of rows) write({ type: `insert`, value: { ...row } })
        commit()
        markReady()
      },
    },
  })
  return Object.assign(collection, {
    oracleReplace: async (row: T) => {
      actions.begin()
      actions.write({ type: `update`, value: row })
      await actions.commit()
    },
  })
}

export function sortJoinPairs(pairs: Array<JoinPair>): Array<JoinPair> {
  return pairs.sort(
    ([leftA, rightA], [leftB, rightB]) =>
      (leftA ?? Number.POSITIVE_INFINITY) -
        (leftB ?? Number.POSITIVE_INFINITY) ||
      (rightA ?? Number.POSITIVE_INFINITY) -
        (rightB ?? Number.POSITIVE_INFINITY),
  )
}

export async function cleanupAll(
  ...resources: Array<{ cleanup: () => Promise<void> }>
) {
  const results = await Promise.allSettled(
    resources.map((resource) =>
      Promise.resolve().then(() => resource.cleanup()),
    ),
  )
  const errors = results.flatMap((result) =>
    result.status === `rejected` ? [result.reason] : [],
  )
  if (errors.length)
    throw new AggregateError(errors, `join oracle cleanup failed`)
}

export async function checkWithCleanup(
  check: () => Promise<void>,
  ...resources: Array<{ cleanup: () => Promise<void> }>
): Promise<void> {
  let primaryFailure: unknown
  let checkFailed = false
  try {
    await check()
  } catch (error) {
    primaryFailure = error
    checkFailed = true
  }

  try {
    await cleanupAll(...resources)
  } catch (cleanupFailure) {
    if (checkFailed) {
      throw new AggregateError(
        [primaryFailure, cleanupFailure],
        `join oracle check and cleanup failed`,
        { cause: primaryFailure },
      )
    }
    throw cleanupFailure
  }
  if (checkFailed) throw primaryFailure
}
