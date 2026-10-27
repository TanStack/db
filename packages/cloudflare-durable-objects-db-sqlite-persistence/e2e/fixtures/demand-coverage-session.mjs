// @ts-nocheck
/**
 * Durable Object side of the persisted demand coverage witness
 * (`e2e/cloudflare-persisted-demand-coverage.e2e.test.ts`). The worker runs
 * one session per request, against the Durable Object's own storage, through
 * the real `createCloudflareDOSQLitePersistence`. The test restarts wrangler
 * between session 1 and session 2, so session 2 reads what workerd persisted.
 * The histories and the session runners are the receiving contract's
 * (`packages/db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`),
 * imported here into the worker bundle. This module records what it observes;
 * the test owns the judgment, through the shared judge once it is published.
 */
import {
  receivingHistory,
  recordSession1,
  recordSession2,
} from '../../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts'
import { createCloudflareDOSQLitePersistence } from '../../dist/esm/index.js'

// Runs one session. `phase` is `session1` (online, takes the history's steps)
// or `session2` (offline, returns the record). Errors reject to the caller.
export async function runDemandCoverageSession(storage, body) {
  const persistence = createCloudflareDOSQLitePersistence({ storage })
  const history = receivingHistory(body.history)
  if (body.phase === `session1`) {
    return {
      phase: `session1`,
      record: await recordSession1(persistence, history),
    }
  }
  return {
    phase: `session2`,
    record: await recordSession2(persistence, history),
  }
}
