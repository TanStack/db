/**
 * Shared production composition for persisted-startup-oracle.ts. The adapter
 * supplies a real Collection, delivery control, and (for scoped sources) its
 * metadata projection. The host supplies storage and holds the first row read.
 * Seed through public persisted sync, then compare before any refresh, inside
 * refresh fulfillment, after its durable read, and after a local-only reopen.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import {
  PersistedStartupViolation,
  persistedStartupCutViolations,
  persistedStartupPremiseViolations,
  persistedStartupViolations,
  sortedStartupRows,
  startupRows,
} from '../src/persisted-startup-oracle'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { HeldCall } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type {
  PersistedStartupHistory,
  PersistedStartupObservation,
  StartupRow,
  StartupScope,
  StartupSnapshot,
} from '../src/persisted-startup-oracle'

export function isStartupRowRead(sql: string): boolean {
  return sql
    .replace(/\s+/g, ` `)
    .trim()
    .startsWith(`SELECT key, value, metadata, row_version FROM`)
}

export interface PersistedStartupSource {
  collection: {
    preload: () => Promise<void>
    cleanup: () => Promise<void>
    readonly size: number
    values: () => IterableIterator<StartupRow>
  }
  snapshot: () => StartupSnapshot
  deliver: () => Promise<void>
  responseAvailable: () => boolean
  refresh: () => Promise<unknown>
  dispose: () => unknown
  checkStartup?: () => Array<string>
}
export interface PersistedStartupAdapter<H extends PersistedStartupHistory> {
  scope: StartupScope
  seedMetadata?: (h: H, id: string, row: StartupRow) => Record<string, unknown>
  owners?: (metadata: unknown, id: string) => Array<string>
  create: (
    persistence: PersistedCollectionPersistence,
    h: H,
    id: string,
  ) => PersistedStartupSource | Promise<PersistedStartupSource>
}
export const startupTurn = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))
export async function untilStartup(premise: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt++) {
    if (premise()) return
    await startupTurn()
  }
  throw new Error(`Persisted startup driver did not reach its premise`)
}

export async function observePersistedStartup<
  H extends PersistedStartupHistory,
>(
  adapter: PersistedStartupAdapter<H>,
  persistence: PersistedCollectionPersistence,
  holdBaseline: (id: string) => HeldCall,
  h: H,
  id: string,
  readRowCount: () => number,
  onStartup: () => void = () => {},
): Promise<PersistedStartupObservation> {
  const seed = createCollection(
    persistedCollectionOptions<StartupRow, string>({
      id,
      getKey: (row) => row.id,
      persistence,
      sync: {
        sync: ({ begin, write, metadata, commit, markReady }) => {
          begin()
          for (const row of startupRows(h.previous, 1)) {
            write({ type: `insert`, value: row })
            if (adapter.seedMetadata)
              metadata!.row.set(row.id, adapter.seedMetadata(h, id, row))
          }
          commit()
          markReady()
        },
      },
    }),
  )
  await withOracleCleanup(() => seed.preload(), [() => seed.cleanup()])
  const initialReadCount = readRowCount()
  const hold = holdBaseline(id)
  let source: PersistedStartupSource | undefined
  return withOracleCleanup(async () => {
    source = await adapter.create(persistence, h, id)
    const current = source
    const assertCut = (cut: string, actual: StartupSnapshot) => {
      const violations = persistedStartupCutViolations(
        h,
        adapter.scope,
        cut,
        actual,
      )
      if (violations.length) throw new PersistedStartupViolation(violations)
    }
    const durableSnapshot = async (): Promise<StartupSnapshot> => {
      const stored = await persistence.adapter.loadResumeSnapshot(
        { kind: `eager`, collectionId: id },
        { includeRows: true },
      )
      return {
        rows: sortedStartupRows(
          stored.rows.map((row) => row.value as StartupRow),
        ),
        ...(adapter.scope === `scoped`
          ? {
              owners: [...stored.rows]
                .sort((a, b) => String(a.key).localeCompare(String(b.key)))
                .map((row): [string, Array<string>] => [
                  String(row.key),
                  adapter.owners!(row.metadata, id),
                ]),
            }
          : {}),
      }
    }
    const ready = current.collection.preload()
    await untilStartup(hold.isHeld)
    if (h.response === `before-restore`) await current.deliver()
    await startupTurn()
    const responseBeforeRestore = current.responseAvailable() && hold.isHeld()
    hold.release()
    if (h.response === `after-restore`) {
      await untilStartup(() => current.collection.size > 0)
      await current.deliver()
    }
    await ready
    const startup = current.snapshot()
    if (responseBeforeRestore !== (h.response === `before-restore`))
      throw new Error(`Startup response/restore premise was not reached`)
    onStartup()
    assertCut(`startup`, startup)
    // Work is captured before the observation's own durable read.
    const startupRowReads = readRowCount() - initialReadCount
    const premiseViolations = [
      ...persistedStartupPremiseViolations(h, {
        responseBeforeRestore,
        startupRowReads,
      }),
      ...(current.checkStartup?.() ?? []),
    ]
    if (premiseViolations.length)
      throw new PersistedStartupViolation(premiseViolations)
    const startupDurable = await durableSnapshot()
    assertCut(`startupDurable`, startupDurable)
    const refresh = await current.refresh().then(() => {
      const captured = current.snapshot()
      assertCut(`refresh`, captured)
      return captured
    })
    const durable = await durableSnapshot()
    assertCut(`durable`, durable)
    await current.collection.cleanup()
    const reopened = createCollection(
      persistedCollectionOptions<StartupRow, string>({
        id,
        getKey: (row) => row.id,
        persistence,
      }),
    )
    return withOracleCleanup(async () => {
      await reopened.preload()
      const observation = {
        responseBeforeRestore,
        startupRowReads,
        startup,
        startupDurable,
        refresh,
        durable,
        reopened: sortedStartupRows(reopened.values()),
      }
      const violations = persistedStartupViolations(
        h,
        adapter.scope,
        observation,
      )
      if (violations.length) throw new PersistedStartupViolation(violations)
      return observation
    }, [() => reopened.cleanup()])
  }, [() => hold.uninstall(), () => source?.dispose()])
}
