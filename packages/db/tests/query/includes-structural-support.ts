// Fixture sources, pending-work cleanup, and row shapes shared by the
// structural include oracle in includes-oracle.property.test.ts. These helpers
// compare nothing: they build controlled collections, track transactions so a
// failed test can release them, and project rows for the public-row checks.
// The laws and their models are owned by the oracle file.
import { createControlledCollection as createOracleControlledCollection } from './includes-oracle-helpers.js'
import type {
  ScopedInclude,
  ScopedSubquery,
} from './includes-scope-identity-oracle.js'

export type RootRow = {
  id: number
  group: number
  value: number
  position: number
}

export type ChildRow = RootRow & {
  parentGroup: number
}

export function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: Array<T> = [],
  rowUpdateMode: `partial` | `full` = `partial`,
) {
  return createOracleControlledCollection(name, initialData, {
    rowUpdateMode,
  })
}

export function stripVirtualProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVirtualProperties)
  }
  if (!value || typeof value !== `object`) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith(`$`))
      .map(([key, entry]) => [key, stripVirtualProperties(entry)]),
  )
}

export type Sources = ReturnType<typeof createSources>

export function createSources(rowUpdateMode: `partial` | `full` = `partial`) {
  return {
    roots: createControlledCollection<RootRow>(
      `oracle-roots`,
      [],
      rowUpdateMode,
    ),
    levels: [
      createControlledCollection<ChildRow>(`oracle-level-1`, [], rowUpdateMode),
      createControlledCollection<ChildRow>(`oracle-level-2`, [], rowUpdateMode),
      createControlledCollection<ChildRow>(`oracle-level-3`, [], rowUpdateMode),
      createControlledCollection<ChildRow>(`oracle-level-4`, [], rowUpdateMode),
    ] as const,
  }
}

export type PendingTransaction = ReturnType<
  Sources[`roots`][`collection`][`update`]
>

export type PendingWork = {
  transaction: PendingTransaction
  release: () => void
  releaseAttempted: boolean
  released: boolean
  settled: boolean
  receipt: Promise<void>
}

export function trackPendingWork(
  pending: Set<PendingWork>,
  transaction: PendingTransaction,
  release: () => void,
): PendingWork {
  const entry: PendingWork = {
    transaction,
    release,
    releaseAttempted: false,
    released: false,
    settled: false,
    receipt: Promise.resolve(),
  }
  pending.add(entry)
  const settled = () => {
    entry.settled = true
    if (entry.released) pending.delete(entry)
  }
  entry.receipt = transaction.isPersisted.promise.then(settled, settled)
  return entry
}

export function releasePendingWork(
  pending: Set<PendingWork>,
  entry: PendingWork,
  release: () => void,
): void {
  entry.releaseAttempted = true
  release()
  entry.released = true
  if (entry.settled) pending.delete(entry)
}

export async function cleanupPendingWork(
  pending: Set<PendingWork>,
  collections: ReadonlyArray<{ cleanup: () => Promise<void> }>,
): Promise<void> {
  const errors: Array<unknown> = []
  const entries = [...pending]
  const attempt = (work: () => void) => {
    try {
      work()
    } catch (error) {
      errors.push(error)
    }
  }
  for (const entry of entries) {
    if (
      entry.transaction.state === `pending` ||
      entry.transaction.state === `persisting`
    )
      attempt(() => {
        entry.transaction.rollback()
      })
    if (!entry.releaseAttempted)
      attempt(() => releasePendingWork(pending, entry, entry.release))
  }
  if (errors.length === 0)
    await Promise.all(entries.map(({ receipt }) => receipt))
  const results = await Promise.allSettled(
    collections.map(async (collection) => collection.cleanup()),
  )
  for (const result of results)
    if (result.status === `rejected`) errors.push(result.reason as unknown)
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1)
    throw new AggregateError(errors, `Core oracle cleanup failed`)
}

export async function withPendingWorkCleanup(
  pending: Set<PendingWork>,
  collections: ReadonlyArray<{ cleanup: () => Promise<void> }>,
  work: () => Promise<void>,
): Promise<void> {
  let primary: { error: unknown } | undefined
  try {
    await work()
  } catch (error) {
    primary = { error }
  }
  try {
    await cleanupPendingWork(pending, collections)
  } catch (error) {
    if (!primary) throw error
    throw new AggregateError(
      [primary.error, error],
      `Core oracle work and cleanup failed`,
      {
        cause: primary.error,
      },
    )
  }
  if (primary) throw primary.error
}

export const plainSubquery: ScopedSubquery = {
  joins: `refs`,
  refsJoin: `left`,
  predicates: [`subActive`],
  predicateForm: `separate`,
  body: `plain`,
  subSelect: `row`,
}

export const refsInclude: ScopedInclude = {
  body: `plain`,
  form: `toArray`,
  source: `refs`,
  clientFilter: false,
  outerSelect: `spread`,
}
