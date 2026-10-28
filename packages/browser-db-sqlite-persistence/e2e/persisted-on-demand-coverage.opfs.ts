/**
 * Chromium receiving driver for persisted demand coverage, over real OPFS with
 * the wa-sqlite worker driver. It runs one session per page load over the same
 * OPFS database. The Playwright spec (`persisted-on-demand-coverage.opfs.spec.ts`)
 * navigates the page from session 1 to session 2, so session 2 is a later page
 * over the same storage.
 *
 * # Law, authority, and histories
 *
 * The law and the histories are the receiving contract's
 * (`packages/db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`).
 * The law is `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`;
 * the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`
 * owns it across its cells. This page is the browser host.
 *
 * # Production path
 *
 * Each session opens `openBrowserWASQLiteOPFSDatabase` and
 * `createBrowserWASQLitePersistence`, and the contract builds the Collection
 * with `persistedCollectionOptions`. The coordinated scenario also passes a
 * `BrowserCollectionCoordinator`. Session 1 closes its database (and
 * coordinator, if any) before the page navigates.
 *
 * # Observations
 *
 * The page records the session 1 source log, and the session 2 loads the
 * source received with its two checkpoints. Session 2 then runs the shared
 * judge (`persisted-demand-coverage-model-oracle.ts`) over those records and
 * reports its violations. The page states no expected result itself.
 *
 * # Limits
 *
 * One driver (wa-sqlite over OPFS in Chromium, one tab at a time). It does not
 * cover Firefox or WebKit, real multi-tab coordination, or the Electron and
 * Node drivers (the node witness covers better-sqlite3).
 */
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src/index'
import {
  coverageRecords,
  receivingHistory,
  recordSession1,
  recordSession2,
} from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import { coverageViolations } from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import type {
  ReceivingSession,
  Session1Record,
  Session2Record,
} from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'

// Session 2's record, and the shared judge's violations at each checkpoint.
// `violations` is absent for the coordinated run, which the law does not cover.
export type Session2Result =
  | {
      record: Session2Record
      violations?: {
        beforeDeadline: Array<string>
        afterDeadline: Array<string>
      }
    }
  | { error: string }

declare global {
  interface Window {
    __persistedOnDemandSession1?: Session1Record | { error: string }
    __persistedOnDemandSession2?: Session2Result
  }
}

// Session 1's record reaches session 2 through sessionStorage, which the tab
// keeps across the spec's navigation.
const storageKey = (databaseName: string) =>
  `persisted-demand-coverage:${databaseName}`

// Opens one session's storage. `close` releases the coordinator and the
// database so that the next page can open the same OPFS file.
async function openSession(
  databaseName: string,
  coordinated: boolean,
): Promise<ReceivingSession> {
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  // Without a coordinator the wrapper uses the default single-process
  // coordinator, the only one the law covers (guide: sqlite-persistence.md).
  const coordinator = coordinated
    ? new BrowserCollectionCoordinator({ dbName: databaseName })
    : undefined
  const persistence = createBrowserWASQLitePersistence({
    database,
    ...(coordinator ? { coordinator } : {}),
    schemaMismatchPolicy: `reset`,
  })
  return {
    persistence,
    close: async () => {
      coordinator?.dispose()
      await database.close?.()
    },
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const phase = params.get(`phase`)
  const history = receivingHistory(params.get(`history`)!)
  const coordinated = params.get(`coordinator`) === `browser`
  const databaseName = params.get(`db`)
  if (!databaseName) throw new Error(`missing db parameter`)
  const session = await openSession(databaseName, coordinated)
  try {
    if (phase === `1`) {
      const record = await recordSession1(session.persistence, history)
      sessionStorage.setItem(storageKey(databaseName), JSON.stringify(record))
      window.__persistedOnDemandSession1 = record
      return
    }
    const session1 = JSON.parse(
      sessionStorage.getItem(storageKey(databaseName)) ?? `null`,
    ) as Session1Record
    const record = await recordSession2(session.persistence, history)
    if (coordinated) {
      window.__persistedOnDemandSession2 = { record }
      return
    }
    const records = coverageRecords(history, session1, record)
    window.__persistedOnDemandSession2 = {
      record,
      violations: {
        beforeDeadline: coverageViolations(records.beforeDeadline),
        afterDeadline: coverageViolations(records.afterDeadline),
      },
    }
  } catch (error) {
    if (phase === `1`)
      window.__persistedOnDemandSession1 = { error: String(error) }
    else window.__persistedOnDemandSession2 = { error: String(error) }
  } finally {
    await session.close()
  }
}

void main()
