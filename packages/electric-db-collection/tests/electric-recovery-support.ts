import { isDeepStrictEqual } from 'node:util'
import { expect } from 'vitest'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import type { Message, Row } from '@electric-sql/client'
import type {
  PersistedCollectionCoordinator,
  PersistedTx,
  PersistenceAdapter,
  ProtocolEnvelope,
  TxCommitted,
} from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils, ElectricSyncMode } from '../src/electric'

/**
 * Shared fixtures for the persisted Electric recovery tests. The Map-backed
 * adapter, the peer publisher, and the whole-trace comparison serve both
 * electric-recovery-oracle.test.ts, which owns the recovery laws, and
 * electric-recovery.test.ts, which holds the hand-written cases.
 */

export type Item = Row & {
  id: number
  name: string
  stable: string
  obsolete?: string
}
export type Exposure = { cut: string; rows: Array<Item> }

export function expectWholeRecoveryTrace(
  entries: Array<Exposure>,
  allowed: Array<Array<Item>>,
) {
  let position = 0
  for (const entry of entries) {
    while (
      position < allowed.length &&
      !isDeepStrictEqual(entry.rows, allowed[position])
    )
      position++
    expect(position, JSON.stringify({ entry, allowed, entries })).toBeLessThan(
      allowed.length,
    )
  }
}

export const oldRow: Item = { id: 1, name: `old`, stable: `stable-1` }
export const otherOldRow: Item = {
  id: 3,
  name: `other-old`,
  stable: `stable-3`,
}
export const freshRow: Item = { id: 2, name: `fresh`, stable: `stable-2` }
export const upToDate: Message<Item> = { headers: { control: `up-to-date` } }

export function change(
  operation: `insert` | `update` | `delete`,
  value: Partial<Item>,
): Message<Item> {
  return { key: String(value.id), value: value as Item, headers: { operation } }
}

export function fixture(
  syncMode: ElectricSyncMode,
  coordinator?: PersistedCollectionCoordinator,
) {
  const rows = new Map<string | number, Item>([[oldRow.id, { ...oldRow }]])
  const metadata = new Map<string, unknown>([
    [
      `electric:resume`,
      {
        kind: `resume`,
        requiresTagState: false,
        offset: `10_0`,
        handle: `shape-old`,
        shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
        updatedAt: 1,
      },
    ],
  ])
  let hydrationGate = Promise.resolve()
  const commits: Array<PersistedTx> = []
  let latestTerm = 0
  let latestSeq = 0
  let latestRowVersion = 0
  let resetEpoch = 0
  let durableRowReads = 0
  const adapter: PersistenceAdapter = {
    loadSubset: () => {
      durableRowReads++
      const snapshot = Array.from(rows, ([key, value]) => ({
        key,
        value: { ...value },
      }))
      return hydrationGate.then(() => snapshot)
    },
    loadResumeSnapshot: async (_collectionId, ctx) => {
      if (ctx?.includeRows !== false) {
        durableRowReads++
        await hydrationGate
      }
      return {
        rows:
          ctx?.includeRows === false
            ? []
            : Array.from(rows, ([key, value]) => ({
                key,
                value: { ...value },
              })),
        keySet: { status: `consistent` },
        collectionMetadata: Array.from(metadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
        latestTerm,
        latestSeq,
        latestRowVersion,
        resetEpoch,
      }
    },
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(metadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    applyCommittedTx: (_collectionId, tx) => {
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) metadata.delete(mutation.key)
        else metadata.set(mutation.key, structuredClone(mutation.value))
      }
      if (tx.truncate) {
        rows.clear()
        resetEpoch++
      }
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) rows.delete(mutation.key)
        else {
          rows.set(
            mutation.key,
            mutation.type === `insert`
              ? (structuredClone(mutation.value) as Item)
              : ({
                  ...rows.get(mutation.key),
                  ...structuredClone(mutation.value),
                } as Item),
          )
        }
      }
      latestTerm = tx.term
      latestSeq = tx.seq
      latestRowVersion = tx.rowVersion
      commits.push(structuredClone(tx))
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
  const collectionId = `persisted-recovery-${syncMode}`
  if (coordinator) {
    coordinator.requestApplyCommittedTx = async (requestedCollectionId, tx) => {
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: requestedCollectionId },
        tx,
      )
      return {
        type: `rpc:applyCommittedTx:res`,
        rpcId: tx.txId,
        ok: true,
        term: tx.term,
        seq: tx.seq,
        latestRowVersion: tx.rowVersion,
      }
    }
  }
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      ElectricCollectionUtils<Item>
    >({
      ...electricCollectionOptions<Item>({
        id: collectionId,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode,
        getKey: (row) => row.id,
        startSync: false,
      }),
      persistence: { adapter, coordinator },
    }),
  )
  const publicRows = () =>
    Array.from(collection.values(), (row) => {
      const {
        $hasPendingWrites: _pending,
        $synced: _synced,
        $origin: _origin,
        $key: _key,
        $collectionId: _collectionId,
        ...value
      } = row
      return structuredClone(value) as Item
    }).sort((a, b) => a.id - b.id)
  const durableRows = () =>
    structuredClone([...rows.values()].sort((a, b) => a.id - b.id))
  const exposures: Array<Exposure> = []
  const record = (cut: string) => {
    exposures.push({ cut, rows: structuredClone(publicRows()) })
  }
  let stopObserving = () => {}
  const start = () => {
    stopObserving()
    collection.startSyncImmediate()
    const subscription = collection.subscribeChanges(() => record(`event`), {
      includeInitialState: false,
    })
    stopObserving = () => subscription.unsubscribe()
    record(`started`)
  }
  return {
    collection,
    rows,
    metadata,
    commits,
    publicRows,
    durableRows,
    exposures,
    record,
    durableRowReadCount: () => durableRowReads,
    latestDurableRowVersion: () => latestRowVersion,
    commitExternalTx: (tx: PersistedTx) =>
      adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        tx,
      ),
    start,
    stopObserving: () => stopObserving(),
    pauseHydration: (gate: Promise<void>) => {
      hydrationGate = gate
    },
  }
}

export type PersistedRestartObservation = {
  checkpoint: `post-restart-up-to-date`
  requestedOffset: string | undefined
  requestedHandle: string | undefined
  visibleRows: Array<Item>
  durableRows: Array<Item>
  durableResumeKind: unknown
  status: string
}

export function expectPersistedRestartLaw(
  actual: PersistedRestartObservation,
  expected: PersistedRestartObservation,
): void {
  expect(actual).toEqual(expected)
}

export function attachRecoveryCleanupDiagnostics(
  primary: unknown,
  cleanupEvidence: string,
  cleanupFailures: ReadonlyArray<unknown>,
): Error {
  const error =
    primary instanceof Error
      ? primary
      : new Error(`Persisted restart oracle failed with a non-Error value`, {
          cause: primary,
        })
  Object.defineProperty(error, `cleanupEvidence`, {
    value: cleanupEvidence,
    enumerable: true,
  })
  if (cleanupFailures.length > 0) {
    Object.defineProperty(error, `cleanupFailures`, {
      value: [...cleanupFailures],
      enumerable: true,
    })
  }
  return error
}

export async function withFixtureCleanup(
  f: ReturnType<typeof fixture>,
  run: () => Promise<void>,
  beforeCleanup?: () => void,
): Promise<void> {
  let failed = false
  let primaryFailure: unknown
  try {
    await run()
  } catch (error) {
    failed = true
    primaryFailure = error
  }
  const cleanupFailures: Array<unknown> = []
  try {
    beforeCleanup?.()
  } catch (error) {
    cleanupFailures.push(
      new Error(`Recovery gate release failed`, { cause: error }),
    )
  }
  try {
    f.stopObserving()
  } catch (error) {
    cleanupFailures.push(
      new Error(`Recovery observer cleanup failed`, { cause: error }),
    )
  }
  try {
    await f.collection.cleanup()
  } catch (error) {
    cleanupFailures.push(
      new Error(`Recovery Collection cleanup failed`, { cause: error }),
    )
  }
  if (failed) {
    throw attachRecoveryCleanupDiagnostics(
      primaryFailure,
      cleanupFailures.length === 0
        ? `passed: recovery fixture cleanup`
        : `failed: recovery fixture cleanup`,
      cleanupFailures,
    )
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `Recovery fixture cleanup failed`)
  }
}

export function externalPublisher() {
  let receive: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  let id = ``
  let term = 100
  const coordinator: PersistedCollectionCoordinator = {
    getNodeId: () => `local`,
    subscribe: (collectionId, callback) => {
      id = collectionId
      receive = callback
      return () => {
        receive = undefined
      }
    },
    publish: () => {},
    isLeader: () => true,
    ensureLeadership: () => Promise.resolve(),
    requestEnsurePersistedIndex: () => Promise.resolve(),
    requestEnsureRemoteSubset: () => Promise.resolve(),
    requestReleaseRemoteSubset: () => Promise.resolve(),
    registerRemoteSubsetOwner: () => () => {},
    requestApplyCommittedTx: (_collectionId, tx) =>
      Promise.resolve({
        type: `rpc:applyCommittedTx:res`,
        rpcId: tx.txId,
        ok: true,
        term: tx.term,
        seq: tx.seq,
        latestRowVersion: tx.rowVersion,
      }),
  }
  return {
    coordinator,
    publish: async (
      fixtureState: ReturnType<typeof fixture>,
      row: Item,
      deleted: boolean,
      fullReload: boolean,
      operation?: `insert` | `update`,
    ) => {
      const revision = term++
      const rowVersion = fixtureState.latestDurableRowVersion() + 1
      const txId = `peer-${revision}`
      // Commit the peer's rows, marker, and stream position before its
      // notice. A notice with no matching durable position is not a legal
      // ordinary publication history.
      await fixtureState.commitExternalTx({
        txId,
        term: revision,
        seq: 1,
        rowVersion,
        mutations: deleted
          ? [{ type: `delete`, key: row.id, value: row }]
          : [
              {
                type:
                  operation ??
                  (fixtureState.rows.has(row.id) ? `update` : `insert`),
                key: row.id,
                value: row,
              },
            ],
        collectionMetadataMutations: [
          { type: `set`, key: `oracle:publication`, value: revision },
        ],
      })
      const committed: TxCommitted = fullReload
        ? {
            type: `tx:committed`,
            term: revision,
            seq: 1,
            txId,
            latestRowVersion: rowVersion,
            requiresFullReload: true,
          }
        : {
            type: `tx:committed`,
            term: revision,
            seq: 1,
            txId,
            latestRowVersion: rowVersion,
            requiresFullReload: false,
            changedRows: deleted ? [] : [{ key: row.id, value: row }],
            deletedKeys: deleted ? [row.id] : [],
            collectionMetadataMutations: [
              { type: `set`, key: `oracle:publication`, value: revision },
            ],
          }
      receive?.({
        v: 1,
        dbName: id,
        collectionId: id,
        senderId: `peer`,
        ts: Date.now(),
        payload: committed,
      })
      return revision
    },
  }
}
