import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SQLiteCorePersistenceAdapter } from '../src'
import {
  SqliteCliDriver,
  runSQLiteBindingCapacityOracleSuite,
  runSQLiteCoreAdapterContractSuite,
} from './sqlite-core-adapter-oracle.test'

// A managed physical storage ID must travel through the real sqlite3 CLI
// driver, which passes SQL as a process argument. A NUL in that ID prevents
// claim creation before any row or public Collection can be restored.
it(`persists a claimed on-demand row through sqlite3 CLI arguments`, async () => {
  const directory = mkdtempSync(join(tmpdir(), `db-sqlite-cli-cache-`))
  const adapter = new SQLiteCorePersistenceAdapter({
    driver: new SqliteCliDriver(join(directory, `state.sqlite`)),
  })
  let claim:
    Awaited<ReturnType<typeof adapter.claimCacheGeneration>> | undefined
  try {
    claim = await adapter.claimCacheGeneration(`cli-managed-cache`)
    await adapter.applyCommittedTx(claim.storageCollectionId, {
      txId: `source-row`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      cacheGenerationClaimId: claim.claimId,
      mutations: [
        { type: `insert`, key: `row`, value: { id: `row`, title: `Fresh` } },
      ],
    })
    expect(
      (
        await adapter.loadResumeSnapshot(claim.storageCollectionId, {
          cacheGenerationClaimId: claim.claimId,
        })
      ).rows.map(({ value }) => value),
    ).toEqual([{ id: `row`, title: `Fresh` }])
  } finally {
    if (claim) await adapter.releaseCacheGenerationClaim(claim.claimId)
    rmSync(directory, { recursive: true, force: true })
  }
})

runSQLiteCoreAdapterContractSuite(`SQLiteCorePersistenceAdapter (sqlite3 CLI)`)
runSQLiteBindingCapacityOracleSuite()
