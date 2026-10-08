import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { createCollection } from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { createNodeSQLitePersistence, persistedCollectionOptions } from '../src'
import { assertRuntimeRestartHistory } from '../../db-sqlite-persistence-core/tests/contracts/runtime-bridge-e2e-contract'
import type { LoadSubsetOptions } from '@tanstack/db'

type Row = { id: string; title: string; score: number }

describe(`durable cache and upstream ownership histories`, () => {
  it.each([`throw`, `reject`] as const)(
    `retains cached rows and a live peer after upstream %s and reopen`,
    async (mode) => {
      const directory = mkdtempSync(join(tmpdir(), `db-cache-history-`))
      const filename = join(directory, `state.sqlite`)
      let database = new BetterSqlite3(filename)
      const id = `cached-upstream`
      const cached: Row = { id: `cached`, title: `Durable cache`, score: 42 }
      const next: Row = { ...cached, title: `Healthy peer update`, score: 73 }
      const persistence = createNodeSQLitePersistence({ database })
      const peer: LoadSubsetOptions = { limit: 1 }
      const failed: LoadSubsetOptions = { limit: 1 }
      const leases = new Set<LoadSubsetOptions>()
      const released: Array<LoadSubsetOptions> = []
      const failure = new Error(`upstream unavailable`)
      let publish!: (value: Row) => Promise<void>
      const collection = createCollection(
        persistedCollectionOptions<Row, string>({
          id,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          persistence,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              publish = async (value) => {
                if (!leases.has(peer)) return
                begin()
                write({ type: `update`, value })
                await commit()
              }
              markReady()
              return {
                loadSubset: (options) => {
                  if (options === failed && mode === `throw`) throw failure
                  // A returned Promise transfers a lease; a throw does not.
                  leases.add(options)
                  return options === failed ? Promise.reject(failure) : true
                },
                unloadSubset: (options) => {
                  released.push(options)
                  leases.delete(options)
                },
              }
            },
          },
        }),
      )
      const observe = () =>
        [...collection.values()].map(({ id: rowId, title, score }) => ({
          id: rowId,
          title,
          score,
        }))
      try {
        // This history tests a cache written by the current managed format.
        // The public-ID table represents pre-upgrade on-demand storage and is
        // deliberately isolated from new cache generations.
        const seedClaim = await persistence.adapter.claimCacheGeneration?.(id)
        if (!seedClaim)
          throw new Error(`Node adapter must support cache claims`)
        await persistence.adapter.applyCommittedTx(
          seedClaim.storageCollectionId,
          {
            txId: `seed`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            cacheGenerationClaimId: seedClaim.claimId,
            mutations: [{ type: `insert`, key: cached.id, value: cached }],
          },
        )
        await persistence.adapter.releaseCacheGenerationClaim?.(
          seedClaim.claimId,
        )
        collection.startSyncImmediate()
        await collection._sync.loadSubset(peer)
        await expect(collection._sync.loadSubset(failed)).rejects.toBe(failure)
        expect(observe()).toEqual([cached])
        const cacheReader = new BetterSqlite3(filename)
        try {
          const reader = createNodeSQLitePersistence({
            database: cacheReader,
          }).adapter
          const readerClaim = await reader.claimCacheGeneration?.(id)
          if (!readerClaim)
            throw new Error(`Node adapter must support cache claims`)
          const cachedRows = await reader.loadSubset(
            readerClaim.storageCollectionId,
            {},
            { cacheGenerationClaimId: readerClaim.claimId },
          )
          expect(cachedRows.map(({ value }) => value)).toEqual([cached])
          await reader.releaseCacheGenerationClaim?.(readerClaim.claimId)
        } finally {
          cacheReader.close()
        }
        expect(leases.has(failed)).toBe(mode === `reject`)
        collection._sync.unloadSubset(failed)
        expect(released).toEqual(mode === `reject` ? [failed] : [])
        expect(leases).toEqual(new Set([peer]))
        await publish(next)
        expect(observe()).toEqual([next])
        collection._sync.unloadSubset(peer)
        expect(leases.size).toBe(0)
        await publish({ ...next, score: -1 })
        expect(observe()).toEqual([next])
        await collection.cleanup()
        database.close()
        database = new BetterSqlite3(filename)
        const reopened = createNodeSQLitePersistence({ database }).adapter
        const reopenedClaim = await reopened.claimCacheGeneration?.(id)
        if (!reopenedClaim)
          throw new Error(`Node adapter must support cache claims`)
        expect(
          (
            await reopened.loadSubset(
              reopenedClaim.storageCollectionId,
              {},
              {
                cacheGenerationClaimId: reopenedClaim.claimId,
              },
            )
          ).map(({ value }) => value),
        ).toEqual([next])
        const fresh: Row = { id: `fresh`, title: `Next use`, score: 99 }
        await reopened.applyCommittedTx(reopenedClaim.storageCollectionId, {
          txId: `after-reopen`,
          term: 2,
          seq: 1,
          rowVersion: 2,
          cacheGenerationClaimId: reopenedClaim.claimId,
          mutations: [{ type: `insert`, key: fresh.id, value: fresh }],
        })
        expect(
          (
            await reopened.loadSubset(
              reopenedClaim.storageCollectionId,
              {},
              {
                cacheGenerationClaimId: reopenedClaim.claimId,
              },
            )
          )
            .map(({ value }) => value)
            .sort((a, b) => String(a.id).localeCompare(String(b.id))),
        ).toEqual([next, fresh])
        await reopened.releaseCacheGenerationClaim?.(reopenedClaim.claimId)
      } finally {
        try {
          await collection.cleanup()
        } finally {
          database.close()
          rmSync(directory, { recursive: true, force: true })
        }
      }
    },
  )

  it(`preserves the complete restart history through a real SQLite reopen`, async () => {
    const directory = mkdtempSync(join(tmpdir(), `db-restart-history-`))
    const filename = join(directory, `state.sqlite`)
    let database = new BetterSqlite3(filename)
    let adapter = createNodeSQLitePersistence({ database }).adapter
    let seq = 0
    try {
      await assertRuntimeRestartHistory({
        writeTodoFromClient: async (value) => {
          seq++
          await adapter.applyCommittedTx(`restart`, {
            txId: `write-${seq}`,
            term: 1,
            seq,
            rowVersion: seq,
            mutations: [{ type: `insert`, key: value.id, value }],
          })
        },
        loadTodosFromClient: async () =>
          (await adapter.loadSubset(`restart`, {})).map(({ key, value }) => ({
            key: key as string,
            value: value as Row,
          })),
        restartHost: () => {
          database.close()
          database = new BetterSqlite3(filename)
          adapter = createNodeSQLitePersistence({ database }).adapter
          return Promise.resolve()
        },
        loadUnknownCollectionErrorFromClient: () =>
          Promise.reject(new Error(`not reached`)),
        cleanup: () => {},
      })
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
