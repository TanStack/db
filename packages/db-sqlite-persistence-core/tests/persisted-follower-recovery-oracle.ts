/**
 * The follower generation-notice, remote-demand, and rotated-reacquisition
 * drivers and models of persisted-oracle.test.ts, with their histories. Owns
 * nothing and registers no tests: the oracle runs the histories that
 * production satisfies, and persisted-known-defects.test.ts runs the known
 * limit #2139 witnesses through the same drivers.
 */
import { expect, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import {
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  createDeferred,
  createFollowerTab,
  expectExactSnapshot,
  flushAsyncWork,
  recordedStorageId,
  stripVirtualProps,
  within,
} from './persisted-support'
import { expectedScopedSnapshot } from './persisted-durability-model-oracle'
import type {
  PersistedCollectionCoordinator,
  PersistedStorageTarget,
  PersistenceAdapter,
  ProtocolEnvelope,
  TxCommitted,
} from '../src'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'
import type {
  FollowerRemoteDemandHistory,
  FollowerRow,
  Todo,
  TodoSyncParams,
} from './persisted-support'

/**
 * A follower has no local source. It routes demand to the elected owner,
 * and the owner's commits reach it only as durable rows plus a commit
 * notice. After a cache rotation the follower is in scoped recovery, where
 * durable rows cannot replace source rows. Rotation gives the follower a
 * fresh cache generation, and the follower asks the owner to reacquire
 * every active demand into it. Once those reacquisitions settle, the new
 * generation holds exactly the owner's rows for that demand, so durable
 * rows are authoritative again. The law is therefore: while the
 * reacquisitions are in flight, the follower holds the generation's commit
 * notices; when they settle, scoped recovery ends for that generation and
 * the held notices, and every later one, apply through the normal path.
 * No sender is special: a peer's notice after recovery is an ordinary
 * invalidation that rereads durable rows.
 *
 * The independent model is `expectedScopedSnapshot` with complete demand
 * over the authored durable rows of the current generation. It knows
 * nothing about notices or scoped recovery; the driver applies it only at
 * checkpoints where the owner's evidence has arrived. The ensure log is a
 * separate observation: one acquisition and one reacquisition after
 * rotation, and no other ensure. A bounded leader that re-commits on every
 * ensure makes the alternative design (answer every notice during scoped
 * recovery with a refetch) loop, and the bound turns that loop into an
 * assertion failure.
 *
 * The grammar crosses when the owner first commits the row (before or
 * after the rotation) with a later broadcast for the same key: none, an
 * owner update, or a peer notice that claims a different value. An owner
 * update's durable read either succeeds or fails. Recovery has ended, so a
 * failed read of it is a real failure: the follower becomes terminal and
 * keeps the rows it showed, instead of silently ignoring the failure as if
 * a new recovery had started during the read.
 * The
 * observations are the follower's rows when its first load settles, after
 * the rotation's reacquisition, and after the later broadcast, plus the
 * ensure log at quiescence. The coordinator is a controlled double of an
 * elected owner; it does not prove the browser transport.
 *
 * Known limit (#2139): production does not end a rotated follower's scoped
 * recovery, so this production path's cells are fixed histories that fail until it does.
 */
export type FollowerGenerationNoticeHistory = {
  ownerCommit: `before-rotation` | `after-rotation`
  later: `none` | `owner` | `peer`
  // Applies only to a later owner update.
  ownerRead: `ok` | `fails`
  // Control: an owner notice's read is in flight when rotation starts, and
  // then fails. Recovery owns that read, so its failure is ignored.
  readFailsAsRotationStarts?: boolean
  // How the owner's notices in the rotated generation reach the follower:
  // in order, after a gap in the stream position (the follower's position
  // restarts at zero when it rotates), or as an exact-ID reconciliation
  // reload. Each must publish the same rows once recovery ends.
  noticeShape?: `plain` | `gap` | `reconciliation`
}
export const assertFollowerGenerationNoticeHistory = async ({
  ownerCommit,
  later,
  ownerRead,
  readFailsAsRotationStarts = false,
  noticeShape = `plain`,
}: FollowerGenerationNoticeHistory): Promise<void> => {
  const readFailure = new Error(`owner update read failed`)
  let failNextRead = false
  let holdNextRead:
    { promise: Promise<void>; reject: (e: unknown) => void } | undefined
  const oldStorageId = `follower-notice-old`
  const newStorageId = `follower-notice-new`
  const ownerId = `elected-owner`
  const v1: Todo = { id: `remote`, title: `Owner row` }
  const v2: Todo = { id: `remote`, title: `Owner update` }
  const durable = new Map<string, Map<string, Todo>>([
    [oldStorageId, new Map()],
    [newStorageId, new Map()],
  ])
  let storageId = oldStorageId
  // The owner's upstream row: present from the start, or only once the
  // owner fetched it after the rotation began.
  let upstream: Todo | undefined =
    ownerCommit === `before-rotation` ? v1 : undefined
  const ensures: Array<{ id: string; refetch: boolean }> = []
  const subscribers = new Map<
    string,
    (message: ProtocolEnvelope<unknown>) => void
  >()
  const versions = new Map<string, number>()
  // Enough commits for every legal history; a refetch loop exceeds it.
  const commitBudget = 8
  let commits = 0
  const notify = (id: string, row: Todo, senderId: string) => {
    // A gap skips one stream position in the rotated generation.
    const skip =
      noticeShape === `gap` && id === newStorageId && !versions.has(id) ? 1 : 0
    const version = (versions.get(id) ?? 0) + 1 + skip
    versions.set(id, version)
    const reconciliation =
      noticeShape === `reconciliation` && id === newStorageId
    subscribers.get(id)?.({
      v: 1,
      dbName: `test-db`,
      collectionId: id,
      senderId,
      ts: Date.now(),
      payload: {
        type: `tx:committed`,
        term: 1,
        seq: version,
        txId: `${senderId}-${id}-${version}`,
        latestRowVersion: version,
        requiresFullReload: reconciliation,
        ...(reconciliation ? { reconciliationReload: true } : {}),
        changedRows: [{ key: row.id, value: { ...row } }],
        deletedKeys: [],
      } satisfies TxCommitted,
    })
  }
  const ownerCommits = (id: string, row: Todo) => {
    if (commits++ >= commitBudget) return
    durable.get(id)!.set(row.id, structuredClone(row))
    notify(id, row, ownerId)
  }
  const adapter: PersistenceAdapter = {
    loadSubset: async (target) => {
      const hold = holdNextRead
      if (hold) {
        holdNextRead = undefined
        await hold.promise
      }
      if (failNextRead) {
        failNextRead = false
        throw readFailure
      }
      return Array.from(
        durable.get(recordedStorageId(target))!.values(),
        (value) => ({
          key: value.id,
          value: structuredClone(value),
        }),
      )
    },
    claimCacheGeneration: async () => ({
      storageCollectionId: oldStorageId,
      claimId: `follower-notice-claim`,
      expiresAtMs: Date.now() + 60_000,
    }),
    renewCacheGenerationClaim: async () => Date.now() + 60_000,
    rotateCacheGeneration: async () => {
      storageId = newStorageId
      if (ownerCommit === `after-rotation`) upstream = v1
      return {
        storageCollectionId: newStorageId,
        claimId: `follower-notice-claim`,
        expiresAtMs: Date.now() + 60_000,
      }
    },
    releaseCacheGenerationClaim: async () => {},
    loadResumeSnapshot: async () => ({
      rows: [],
      keySet: { status: `consistent` },
      collectionMetadata: [],
      latestTerm: 0,
      latestSeq: 0,
      latestRowVersion: 0,
      resetEpoch: 0,
    }),
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  }
  const coordinator: PersistedCollectionCoordinator = {
    getNodeId: () => `follower-node`,
    subscribe: (id, onMessage) => {
      subscribers.set(id, onMessage)
      return () => {
        if (subscribers.get(id) === onMessage) subscribers.delete(id)
      }
    },
    publish: () => {},
    isLeader: () => false,
    ensureLeadership: async () => {},
    requestEnsurePersistedIndex: async () => {},
    // The elected owner loads its upstream and commits it into the
    // requested generation before it replies, on every ensure.
    requestEnsureRemoteSubset: async (id, options) => {
      ensures.push({ id, refetch: options.refetch === true })
      if (upstream) ownerCommits(id, upstream)
    },
    requestReleaseRemoteSubset: async () => {},
    registerRemoteSubsetOwner: () => () => {},
    requestApplyCommittedTx: (_id, tx) =>
      Promise.resolve({
        type: `rpc:applyCommittedTx:res`,
        rpcId: tx.txId,
        ok: true,
        term: tx.term,
        seq: tx.seq,
        latestRowVersion: tx.rowVersion,
      }),
    pullSince: () =>
      Promise.resolve({
        type: `rpc:pullSince:res`,
        rpcId: `follower-notice-pull`,
        ok: true,
        latestTerm: 1,
        latestSeq: 0,
        latestRowVersion: 0,
        requiresFullReload: false,
        changedKeys: [],
        deletedKeys: [],
      }),
  }
  let source!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `follower-generation-notice`,
      syncMode: `on-demand`,
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          source = params
          params.markReady()
          return {
            loadSubset: async () => {},
            restartAfterScopedRecovery: async (cacheRotated) => {
              await cacheRotated
            },
          }
        },
      },
      persistence: { adapter, coordinator },
    }),
  )
  const demand: LoadSubsetOptions = { limit: 10 }
  const publicRows = () =>
    new Map(
      Array.from(collection.state, ([key, row]) => [
        String(key),
        stripVirtualProps(row) as Todo,
      ]),
    )
  // A checkpoint after the follower has processed every delivered notice:
  // the scan crosses the same apply mutex the notices use.
  const settled = async (label: string) => {
    await flushAsyncWork()
    await atPersistedOracleCheckpoint(
      source.metadata!.persistence!.scanPersistedRows(),
      label,
    )
    await flushAsyncWork()
  }
  const expectOwnerEvidence = (previous: ReadonlyMap<string, Todo>) => {
    const expected = expectedScopedSnapshot(
      previous,
      durable.get(storageId)!,
      new Map(),
      true,
    )
    expectExactSnapshot(publicRows(), expected)
    return expected
  }
  let hasPrimaryFailure = false
  try {
    collection.startSyncImmediate()
    await collection.stateWhenReady()
    await atPersistedOracleCheckpoint(
      Promise.resolve(collection._sync.loadSubset(demand)),
      `follower demand settled`,
    )
    await settled(`first-ready notices processed`)
    let visible = expectOwnerEvidence(new Map())

    const persistence = source.metadata?.persistence
    if (!persistence?.startScopedRecovery) {
      throw new Error(`Expected scoped recovery capability`)
    }
    let rotation: Promise<void>
    if (readFailsAsRotationStarts) {
      let reject!: (error: unknown) => void
      const promise = new Promise<void>((_resolve, rejectRead) => {
        reject = rejectRead
      })
      void promise.catch(() => undefined)
      holdNextRead = { promise, reject }
      ownerCommits(oldStorageId, {
        id: `remote`,
        title: `Pre-rotation update`,
      })
      await flushAsyncWork()
      rotation = persistence.startScopedRecovery()
      reject(readFailure)
    } else {
      rotation = persistence.startScopedRecovery()
    }
    await atPersistedOracleCheckpoint(
      rotation,
      `follower cache rotation settled`,
    )
    await atPersistedOracleCheckpoint(
      vi.waitFor(() =>
        oracleAssertion('existing comparison at 3796', () =>
          expect(ensures.map(({ id }) => id)).toContain(newStorageId),
        ),
      ),
      `reacquisition reached the owner`,
    )
    await settled(`reacquisition notices processed`)
    // Answering the owner's notice with another refetch would make the
    // owner commit again, and the follower would refetch forever.
    oracleAssertion('existing comparison at 3803', () =>
      expect.soft(ensures).toHaveLength(2),
    )
    visible = expectOwnerEvidence(visible)

    if (later === `owner`) {
      upstream = v2
      failNextRead = ownerRead === `fails`
      ownerCommits(newStorageId, v2)
      if (ownerRead === `fails`) {
        // Not settled(): a terminal runtime rejects the checkpoint scan.
        await flushAsyncWork()
        await vi.waitFor(() =>
          oracleAssertion('existing comparison at 3813', () =>
            expect(collection.status).toBe(`crashed`),
          ),
        )
        expectExactSnapshot(publicRows(), visible)
      } else {
        await settled(`owner update processed`)
        expectOwnerEvidence(visible)
      }
    } else if (later === `peer`) {
      // A peer's notice after recovery is an ordinary invalidation: the
      // follower rereads durable rows, which the peer did not change, so
      // its rows stay as they were and it sends no other ensure.
      notify(newStorageId, { id: `remote`, title: `Peer claim` }, `peer-node`)
      await settled(`peer notice processed`)
      expectOwnerEvidence(visible)
    }

    oracleAssertion('existing comparison at 3828', () =>
      expect(ensures).toEqual([
        { id: oldStorageId, refetch: false },
        { id: newStorageId, refetch: true },
      ]),
    )
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupPersistedOracle(
      [() => collection.cleanup()],
      hasPrimaryFailure,
    )
  }
}

export const followerGenerationNoticeHistory = fc.record({
  ownerCommit: fc.constantFrom<FollowerGenerationNoticeHistory[`ownerCommit`]>(
    `before-rotation`,
    `after-rotation`,
  ),
  later: fc.constantFrom<FollowerGenerationNoticeHistory[`later`]>(
    `none`,
    `owner`,
    `peer`,
  ),
  ownerRead: fc.constantFrom<FollowerGenerationNoticeHistory[`ownerRead`]>(
    `ok`,
    `fails`,
  ),
})

export const expectedFollowerRemoteDemand = (
  history: FollowerRemoteDemandHistory,
) => {
  const applied = history.apply === `ok`
  return {
    // While the owner's commit has not applied here, nothing has settled.
    whileApplyHeld: { settled: false, rows: undefined },
    settled:
      history.consumer === `live-query`
        ? applied
          ? { outcome: `fulfilled`, rows: [`remote`], status: `ready` }
          : { outcome: `rejected`, rows: undefined, status: `crashed` }
        : applied
          ? {
              outcome: `fulfilled`,
              rows: [`remote`],
              status: undefined,
              releases: 0,
            }
          : {
              outcome: `rejected`,
              rows: undefined,
              status: `crashed`,
              releases: 1,
            },
  }
}

export const assertFollowerRemoteDemandHistory = async (
  history: FollowerRemoteDemandHistory,
) => {
  const expected = expectedFollowerRemoteDemand(history)
  const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
  const warnings = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const tab = createFollowerTab(history)
  const groupQuery = (group: string) =>
    createLiveQueryCollection((q) =>
      q.from({ row: tab.source }).where(({ row }) => eq(row.group, group)),
    )
  const query = groupQuery(`a`)
  const other = groupQuery(`b`)
  try {
    // The consumer's observation: its outcome, and the demanded rows it
    // sees when it settles.
    const seen: {
      outcome: `pending` | `fulfilled` | `rejected`
      rows?: Array<string>
    } = { outcome: `pending` }
    const demandedRows = () =>
      Array.from(tab.source.values())
        .filter((row) => row.group === `a`)
        .map((row) => row.id)
        .sort()
    let settled: Promise<unknown>
    if (history.consumer === `live-query`) {
      query.onFirstReady(() => {
        seen.rows = query.toArray.map((row) => (row as FollowerRow).id).sort()
      })
      settled = query.preload().then(
        () => (seen.outcome = `fulfilled`),
        () => (seen.outcome = `rejected`),
      )
    } else {
      settled = Promise.resolve(
        tab.source._sync.loadSubset({
          where: new IR.Func(`eq`, [
            new IR.PropRef([`group`]),
            new IR.Value(`a`),
          ]),
        }),
      ).then(
        () => {
          seen.outcome = `fulfilled`
          seen.rows = demandedRows()
        },
        () => (seen.outcome = `rejected`),
      )
    }
    if (history.placement === `queued`) void other.preload().catch(() => {})

    if (history.placement === `queued`) {
      // The owner's broadcast arrives while this hydration holds the apply
      // mutex, so it waits in the queue until the hydration ends.
      await within(tab.otherHydrationStarted)
      await new Promise((resolve) => setTimeout(resolve, 0))
      tab.releaseOtherHydration()
    }
    const applyStarted = await within(tab.applyReadStarted)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Checkpoint: the owner has replied, but its row has not applied here.
    oracleAssertion('existing comparison at 4037', () =>
      expect({
        applyStarted,
        settled: seen.outcome !== `pending`,
        rows: seen.rows,
      }).toEqual({ applyStarted: true, ...expected.whileApplyHeld }),
    )

    tab.releaseApply()
    await within(settled)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Checkpoint: the apply settled.
    const releasesAtSettle = tab.releases()
    oracleAssertion('existing comparison at 4048', () =>
      expect({
        outcome: seen.outcome,
        rows: seen.rows,
        ...(`releases` in expected.settled
          ? { releases: releasesAtSettle }
          : {}),
        status:
          expected.settled.status === undefined
            ? undefined
            : history.consumer === `live-query` &&
                expected.settled.status === `ready`
              ? query.status
              : expected.settled.status === `crashed`
                ? history.consumer === `live-query`
                  ? `${query.status}/${tab.source.status}`
                  : tab.source.status
                : tab.source.status,
      }).toEqual({
        outcome: expected.settled.outcome,
        rows: expected.settled.rows,
        ...(`releases` in expected.settled
          ? { releases: expected.settled.releases }
          : {}),
        status:
          expected.settled.status === `crashed` &&
          history.consumer === `live-query`
            ? `crashed/crashed`
            : expected.settled.status,
      }),
    )
  } finally {
    await query.cleanup()
    await other.cleanup()
    await tab.source.cleanup()
    errors.mockRestore()
    warnings.mockRestore()
  }
}

export const followerRemoteDemandHistories: Array<FollowerRemoteDemandHistory> =
  ([`direct`, `queued`, `rotated`, `expired`] as const).flatMap((placement) =>
    ([`ok`, `fails`] as const).flatMap((apply) =>
      ([`live-query`, `load`] as const).map((consumer) => ({
        placement,
        apply,
        consumer,
      })),
    ),
  )
// Scoped recovery means durable rows cannot replace source rows. Owner
// evidence is an exception only in a rotated generation, which holds
// nothing but the owner's writes. Without a managed generation the old
// durable cache stays in place, so the model predicts that an owner notice
// during that recovery republishes none of the untrusted durable rows.
/**
 * After a cache rotation, a follower reacquires every active demand into
 * the new generation through the owner. The owner commits each demand's
 * rows into that generation and broadcasts them before it replies, so the
 * follower holds those notices. Scoped recovery may end only once every
 * reacquisition has succeeded: before that, the new generation is still
 * incomplete and its durable rows have no authority. Starting scoped
 * recovery withdraws the old generation's rows.
 *
 * The independent model knows each demand's row version per generation:
 * the owner wrote version 1 into the old generation and writes version 2
 * into the new one when it reacquires the demand. Until every
 * reacquisition has settled, neither demand shows a row. If all succeed,
 * both show the new generation's rows, including an owner update that
 * arrived while the reacquisitions were settling. If any fails, the
 * follower stays in scoped recovery, shows no row from the incomplete
 * generation, and the source reports the failure as soon as that
 * reacquisition settles. A reacquisition is a remote request, so the
 * failure is the ready source's failure reason (`reportError()`: the source
 * keeps syncing), never a crash; a crash is only for local storage or an
 * internal invariant (glossary "crash"; maintainer decision for PR #2168).
 *
 * A demand that the caller releases or aborts while it reacquires no longer
 * needs the new generation's rows: its aborted ensure is neither a failure
 * nor a reported error, and the other demands decide the outcome. Releasing
 * it twice changes nothing. A load that fails on its own still counts as a
 * failure even though the failed load gives up its demand.
 *
 * A new demand loaded while the reacquisitions are in flight settles only
 * once they all have: with the rows of the new generation if recovery
 * ended, or rejected if it did not. Its own ensure answering early does not
 * make its held rows visible.
 *
 * Only a recovery that rotated can end this way. A recovery that keeps the
 * old generation, or one in which this node is the leader, leaves scoped
 * recovery in place, and a newer rotation supersedes an older one's
 * reacquisition.
 *
 * Known limit (#2139): production does not yet end scoped recovery after a
 * rotation, so the histories in which recovery should end, or in which a
 * new demand waits for it, are fixed histories that fail.
 *
 * Limits. A failed reacquisition is not retried; the follower stays in
 * scoped recovery until a later recovery rotates again.
 *
 * The grammar crosses the order in which two demands' reacquisitions
 * settle, whether the owner updates demand a's row (version 3) between
 * the first and last settlement, which reacquisitions fail or are released,
 * and whether a new demand loads during reacquisition. Separate cells start
 * rotation from two reads that find the claim lost, supersede reacquisition
 * by a rotation as leader, and recover without rotating. The driver
 * observes the rows, the new load's outcome, and the source status after
 * every settlement, plus the ensure count, which a refetch loop would
 * exceed.
 */
export type RotatedReacquisitionHistory = {
  order: [`a`, `b`] | [`b`, `a`]
  noticeBetween: boolean
  // Which reacquisitions fail. `released` means demand b is released
  // while it reacquires, so its ensure aborts; that is not a failure.
  fails: `none` | `a` | `b` | `both` | `released`
  // A new demand, c, loads while the reacquisitions are in flight.
  newDemand?: boolean
  // While reacquisition is in flight, the node is elected leader and a
  // second rotation supersedes the first; it then follows again, and a new
  // demand c loads. With nothing reacquiring, the node stays in scoped
  // recovery: held notices must still be handled, not queued forever.
  supersededAsLeader?: boolean
  // How rotation starts: the source asks for scoped recovery after both
  // demands loaded, or both demands' first reads are in flight when the
  // cache claim is found lost.
  trigger?: `source` | `claim-lost-during-reads`
}
export type VersionedRow = { id: string; group: string; v: number }
export type ReacquisitionObservation = {
  rows: Record<`a` | `b` | `c`, number | undefined>
  // The new demand's load, when the history has one.
  newLoad?: `pending` | `fulfilled` | `rejected`
  // `retrying`: ready, with a failure reason.
  status: `crashed` | `retrying` | `healthy`
}
export const expectedReacquisition = (
  history: RotatedReacquisitionHistory,
  settled: number,
): ReacquisitionObservation => {
  const fails = (group: `a` | `b`) =>
    history.fails === group || history.fails === `both`
  const allSettled = settled === 2
  const ended = allSettled && !fails(`a`) && !fails(`b`)
  // A failed reacquisition is reported when it settles, and the next
  // remote request that succeeds clears it (maintainer decision: a coarse
  // clear). A released demand's aborted ensure is neither.
  let failed = false
  for (const group of history.order.slice(0, settled))
    if (fails(group)) failed = true
    else if (!(group === `b` && history.fails === `released`)) failed = false
  return {
    rows: ended
      ? {
          a: history.noticeBetween ? 3 : 2,
          // A released demand's held notice still applies once recovery
          // ends; the new generation's rows are trusted then.
          b: 2,
          c: history.newDemand ? 2 : undefined,
        }
      : { a: undefined, b: undefined, c: undefined },
    ...(history.newDemand
      ? {
          newLoad: !allSettled
            ? (`pending` as const)
            : ended
              ? (`fulfilled` as const)
              : (`rejected` as const),
        }
      : {}),
    status: failed ? `retrying` : `healthy`,
  }
}

export const assertRotatedReacquisition = async (
  history: RotatedReacquisitionHistory,
) => {
  const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
  const warnings = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const oldStorageId = `reacquire-old`
  const newStorageId = `reacquire-new`
  const durable = new Map<string, Map<string, VersionedRow>>([
    [oldStorageId, new Map()],
    [newStorageId, new Map()],
  ])
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  const seqs = new Map<string, number>()
  const ownerCommits = (storageId: string, row: VersionedRow) => {
    const seq = (seqs.get(storageId) ?? 0) + 1
    seqs.set(storageId, seq)
    durable.get(storageId)!.set(row.id, row)
    const payload: TxCommitted = {
      type: `tx:committed`,
      term: 1,
      seq,
      txId: `owner-${storageId}-${seq}`,
      latestRowVersion: seq,
      requiresFullReload: false,
      changedRows: [{ key: row.id, value: row }],
      deletedKeys: [],
    }
    subscriber?.({
      v: 1,
      dbName: `test-db`,
      collectionId: storageId,
      senderId: `owner`,
      ts: Date.now(),
      payload,
    })
  }
  type Reply = {
    resolve: () => void
    reject: (error: unknown) => void
  }
  const replies = new Map<string, Reply>()
  let ensures = 0
  let cEnsures = 0
  const groupOf = (options: LoadSubsetOptions) => {
    const where = options.where as IR.Func | undefined
    const value = where?.args[1] as IR.Value | undefined
    return value?.value as `a` | `b` | `c` | undefined
  }
  const duringReads = history.trigger === `claim-lost-during-reads`
  const firstReads = createDeferred()
  let reads = 0
  let claimLost = false
  const adapter = {
    loadSubset: async (
      target: PersistedStorageTarget,
    ): Promise<Array<{ key: string; value: VersionedRow }>> => {
      if (duringReads && ++reads <= 2) {
        await firstReads.promise
        claimLost = true
      }
      return Array.from(
        durable.get(recordedStorageId(target))!.values(),
        (value) => ({ key: value.id, value: { ...value } }),
      )
    },
    claimCacheGeneration: async () => ({
      storageCollectionId: oldStorageId,
      claimId: `reacquire-claim`,
      expiresAtMs: Date.now() + 60_000,
    }),
    renewCacheGenerationClaim: async () =>
      claimLost ? undefined : Date.now() + 60_000,
    rotateCacheGeneration: async () => {
      claimLost = false
      return {
        storageCollectionId: newStorageId,
        claimId: `reacquire-claim-2`,
        expiresAtMs: Date.now() + 60_000,
      }
    },
    releaseCacheGenerationClaim: async () => {},
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  } as unknown as PersistenceAdapter
  let leader = false
  const coordinator = {
    getNodeId: () => `follower`,
    subscribe: (
      _collectionId: string,
      onMessage: (message: ProtocolEnvelope<unknown>) => void,
    ) => {
      subscriber = onMessage
      return () => {
        subscriber = undefined
      }
    },
    publish: () => {},
    isLeader: () => leader,
    ensureLeadership: async () => {},
    requestEnsurePersistedIndex: async () => {},
    // The owner commits the demand's row into the requesting generation
    // and broadcasts it before it replies. In the new generation the
    // driver releases the reply; a later refetch finds nothing new.
    requestEnsureRemoteSubset: (
      storageId: string,
      options: LoadSubsetOptions,
    ) => {
      ensures++
      const group = groupOf(options)
      if (!group) return Promise.resolve()
      if (storageId === oldStorageId) {
        ownerCommits(oldStorageId, { id: `${group}-row`, group, v: 1 })
        return Promise.resolve()
      }
      if (group === `c`) cEnsures++
      if (replies.has(group) || (group === `c` && cEnsures > 1))
        return Promise.resolve()
      ownerCommits(newStorageId, { id: `${group}-row`, group, v: 2 })
      // The new demand's ensure answers at once; the follower must still
      // hold its rows until reacquisition ends.
      if (group === `c`) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        replies.set(group, { resolve, reject })
      })
    },
    requestReleaseRemoteSubset: async () => {},
    registerRemoteSubsetOwner: () => () => {},
    requestApplyCommittedTx: (_collectionId: string, tx: TxCommitted) =>
      Promise.resolve({
        type: `rpc:applyCommittedTx:res`,
        rpcId: tx.txId,
        ok: true,
        term: tx.term,
        seq: tx.seq,
        latestRowVersion: tx.seq,
      }),
    pullSince: (storageId: string) =>
      Promise.resolve({
        type: `rpc:pullSince:res`,
        rpcId: `reacquire-pull`,
        ok: true,
        latestTerm: 1,
        latestSeq: seqs.get(storageId) ?? 0,
        latestRowVersion: seqs.get(storageId) ?? 0,
        requiresFullReload: true,
        changedKeys: [],
        deletedKeys: [],
      }),
  } as unknown as PersistedCollectionCoordinator
  let sourceParams: SyncConfig<VersionedRow, string>[`sync`] extends (
    params: infer P,
  ) => unknown
    ? P
    : never
  const source = createCollection(
    persistedCollectionOptions<VersionedRow, string>({
      id: `follower-reacquire-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      persistence: { adapter, coordinator },
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          sourceParams = params
          // A ready source: only a ready Collection can carry the failed
          // reacquisition as its failure reason.
          params.markReady()
          return {
            loadSubset: () => Promise.resolve(),
            restartAfterScopedRecovery: () => {},
          }
        },
      },
    }),
  )
  source.startSyncImmediate()
  let newLoad: `pending` | `fulfilled` | `rejected` = `pending`
  const observe = (): ReacquisitionObservation => ({
    rows: {
      a: source.get(`a-row`)?.v,
      b: source.get(`b-row`)?.v,
      c: source.get(`c-row`)?.v,
    },
    ...(history.newDemand ? { newLoad } : {}),
    status:
      source.status === `crashed`
        ? `crashed`
        : source.health.failureReason
          ? `retrying`
          : `healthy`,
  })
  const turn = () => new Promise((resolve) => setTimeout(resolve, 0))
  const settle = async () => {
    for (let i = 0; i < 8; i++) await turn()
  }
  const demand = (group: `a` | `b` | `c`): LoadSubsetOptions => ({
    where: new IR.Func(`eq`, [new IR.PropRef([`group`]), new IR.Value(group)]),
  })
  const demands = { a: demand(`a`), b: demand(`b`), c: demand(`c`) }
  const load = (group: `a` | `b` | `c`) =>
    source._sync.loadSubset(demands[group])
  try {
    if (duringReads) {
      // Both first reads are in flight when the claim is found lost.
      void Promise.resolve(load(`a`)).catch(() => undefined)
      void Promise.resolve(load(`b`)).catch(() => undefined)
      await settle()
      firstReads.resolve()
    } else {
      for (const group of [`a`, `b`] as const) await load(group)
      await settle()
      oracleAssertion('existing comparison at 4476', () =>
        expect(observe().rows).toEqual({ a: 1, b: 1 }),
      )
      void sourceParams!.metadata!.persistence!.startScopedRecovery!()
    }
    await vi.waitFor(
      () =>
        oracleAssertion('existing comparison at 4479', () =>
          expect(replies.size).toBe(2),
        ),
      { timeout: 2_000 },
    )
    await settle()
    if (history.newDemand) {
      void Promise.resolve(load(`c`)).then(
        () => (newLoad = `fulfilled`),
        () => (newLoad = `rejected`),
      )
    }
    if (history.fails === `released`) {
      // Releasing the same demand twice must be idempotent.
      source._sync.unloadSubset(demands.b)
      source._sync.unloadSubset(demands.b)
    }
    await settle()
    // Checkpoint: both reacquisitions are in flight.
    oracleAssertion('existing comparison at 4494', () =>
      expect(observe()).toEqual(expectedReacquisition(history, 0)),
    )
    if (history.supersededAsLeader) {
      leader = true
      await sourceParams!.metadata!.persistence!.startScopedRecovery!()
      await settle()
      leader = false
      let outcome: `pending` | `fulfilled` | `rejected` = `pending`
      void Promise.resolve(load(`c`)).then(
        () => (outcome = `fulfilled`),
        () => (outcome = `rejected`),
      )
      await settle()
      // Checkpoint: the superseded reacquisition no longer holds notices.
      // The node stays in scoped recovery with nothing reacquiring, so the
      // owner's notice for c is handled by one refetch instead of waiting
      // in the queue forever; the untrusted generation shows no row.
      oracleAssertion('existing comparison at 4510', () =>
        expect({ outcome, cEnsures, c: source.get(`c-row`)?.v }).toEqual({
          outcome: `fulfilled`,
          cEnsures: 2,
          c: undefined,
        }),
      )
      for (const reply of replies.values()) reply.resolve()
      return
    }
    for (const [index, group] of history.order.entries()) {
      if (index === 1 && history.noticeBetween) {
        ownerCommits(newStorageId, { id: `a-row`, group: `a`, v: 3 })
        await settle()
      }
      if (history.fails === `released` && group === `b`) {
        const aborted = new Error(`released`)
        aborted.name = `AbortError`
        replies.get(group)!.reject(aborted)
      } else if (history.fails === group || history.fails === `both`)
        replies.get(group)!.reject(new Error(`reacquire ${group} failed`))
      else replies.get(group)!.resolve()
      await settle()
      // Checkpoint: after each settlement.
      oracleAssertion('existing comparison at 4532', () =>
        expect(observe()).toEqual(expectedReacquisition(history, index + 1)),
      )
    }
    // Two acquisitions and two reacquisitions, a new demand's ensure, plus
    // one refresh per held notice when recovery stays; a refetch loop
    // exceeds the bound.
    oracleAssertion('existing comparison at 4537', () =>
      expect(ensures).toBeLessThanOrEqual(16),
    )
  } finally {
    await source.cleanup()
    errors.mockRestore()
    warnings.mockRestore()
  }
}

export const rotatedReacquisitionHistories: Array<RotatedReacquisitionHistory> =
  (
    [
      [`a`, `b`],
      [`b`, `a`],
    ] as const
  ).flatMap((order) =>
    [false, true].flatMap((noticeBetween) =>
      ([`none`, `a`, `b`, `both`, `released`] as const).flatMap((fails) =>
        [false, true].map((newDemand) => ({
          order: [...order],
          noticeBetween,
          fails,
          newDemand,
        })),
      ),
    ),
  )
// Known limit: see #2139. Recovery never ends today, so the histories in
// which it should end, or in which a new demand must wait for it, fail.
export const reacquisitionLimit = ({
  fails,
  newDemand,
}: RotatedReacquisitionHistory) =>
  newDemand === true || fails === `none` || fails === `released`
