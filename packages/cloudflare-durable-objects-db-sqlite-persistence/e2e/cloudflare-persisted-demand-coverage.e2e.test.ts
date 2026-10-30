/**
 * # Receiving witness: persisted demand coverage over Cloudflare Durable Objects
 *
 * Law and authority: the receiving contract
 * (`packages/db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`)
 * holds the histories and records the sessions. The law is
 * `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * and the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`
 * owns it across its cells. This file is the Cloudflare host: it checks the
 * same law through the Durable Object persistence
 * (`createCloudflareDOSQLitePersistence`) inside a real workerd runtime started
 * by `wrangler dev --local --persist-to`. The primary oracle does not run workerd.
 *
 * Histories: every history of `RECEIVING_HISTORIES`. Each history has its own
 * wrangler persist directory.
 *
 * Production path: the test starts wrangler and posts session 1 to the Durable
 * Object (`/demand-session`, phase `session1`). The Durable Object runs the
 * contract's recorder in `e2e/fixtures/demand-coverage-session.mjs` over its
 * own storage. The test stops wrangler, starts it again over the same persist
 * directory, and posts session 2 (phase `session2`).
 *
 * Observations: the session 1 source log, and the session 2 loads and two
 * checkpoints, read inside the Durable Object.
 *
 * Limits: local workerd with the Durable Object's SQLite storage, one Durable
 * Object name, and a process restart between the sessions. It does not cover
 * deployed Cloudflare, the browser or React adapter, or multi-object
 * coordination.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RECEIVING_HISTORIES,
  coverageRecords,
} from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import { coverageViolations } from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import { postJson, startWranglerRuntime } from './fixtures/wrangler-runtime'
import type {
  Session1Record,
  Session2Record,
} from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'

describe(`cloudflare durable object persisted demand coverage (wrangler local, receiving witness)`, () => {
  it.each(RECEIVING_HISTORIES)(
    `$description`,
    async (history) => {
      const tempDirectory = mkdtempSync(join(tmpdir(), `db-cloudflare-demand-`))
      const persistPath = join(tempDirectory, `wrangler-state`)
      try {
        // Session 1 is online. It runs in one wrangler process, then stops.
        const first = await startWranglerRuntime({ persistPath })
        let session1Record: Session1Record | undefined
        try {
          const session1 = await postJson<{ record: Session1Record }>(
            first,
            `/demand-session`,
            { phase: `session1`, history: history.id },
          )
          if (!session1.ok) {
            throw new Error(`${session1.error.name}: ${session1.error.message}`)
          }
          session1Record = session1.rows?.record
        } finally {
          await first.stop()
        }

        // Session 2 is a later process over the same persist directory.
        const second = await startWranglerRuntime({ persistPath })
        try {
          const session2 = await postJson<{ record: Session2Record }>(
            second,
            `/demand-session`,
            { phase: `session2`, history: history.id },
          )
          if (!session2.ok) {
            throw new Error(`${session2.error.name}: ${session2.error.message}`)
          }
          const session2Record = session2.rows?.record
          // Positive witness: session 2 asked the offline source.
          expect(session2Record?.sent.length ?? 0).toBeGreaterThan(0)
          expect(session1Record).toBeDefined()
          const records = coverageRecords(
            history,
            session1Record as Session1Record,
            session2Record as Session2Record,
          )
          expect(coverageViolations(records.beforeDeadline)).toEqual([])
          expect(coverageViolations(records.afterDeadline)).toEqual([])
        } finally {
          await second.stop()
        }
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
    90_000,
  )
})
