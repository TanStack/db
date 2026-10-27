/**
 * Renderer driver for the persisted demand coverage witness in
 * `tests/persisted-demand-coverage.electron.e2e.test.ts`. It runs in a real
 * Electron renderer and calls the real main process over real IPC through
 * `createElectronSQLitePersistence`. The test runs the app twice: phase `1`
 * is an online session that takes each history's steps, then changes the
 * source. Phase `2` is a later, separate app launch over the same database
 * file, with its upstream load answered as the history says.
 *
 * The histories, the expected checkpoints, and the two session runners are
 * the receiving contract's
 * (`packages/db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`).
 * This driver only opens each history's main-process session and records what
 * the runners observe; the test owns the assertions.
 */
import { createElectronSQLitePersistence } from '../../../src/renderer'
import {
  RECEIVING_HISTORIES,
  recordSession1,
  recordSession2,
} from '../../../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import type {
  ReceivingSession,
  Session1Record,
  Session2Record,
} from '../../../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceResponseEnvelope,
} from '../../../src/protocol'

type HistoryResult = {
  name: string
  error?: string
  session1?: Session1Record
  session2?: Session2Record
}

type Bridge = {
  invoke: (channel: string, ...args: Array<unknown>) => Promise<unknown>
}

declare global {
  interface Window {
    demandBridge: Bridge
  }
}

const bridge = window.demandBridge
const invoke: ElectronPersistenceInvoke = (channel, request) =>
  bridge.invoke(
    channel,
    request,
  ) as Promise<ElectronPersistenceResponseEnvelope>

// Opens the main-process session over one history's database file. The
// renderer's persistence then reaches that file only through IPC.
async function openSession(filename: string): Promise<ReceivingSession> {
  await bridge.invoke(`demand:session`, filename)
  return {
    persistence: createElectronSQLitePersistence({ invoke }),
    close: async () => {
      await bridge.invoke(`demand:close-session`)
    },
  }
}

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search)
  const phase = params.get(`phase`)
  const dir = params.get(`dir`)!
  const results: Array<HistoryResult> = []
  for (const [index, history] of RECEIVING_HISTORIES.entries()) {
    const filename = `${dir}/h${index}.sqlite`
    try {
      const { persistence, close } = await openSession(filename)
      try {
        if (phase === `1`) {
          results.push({
            name: history.id,
            session1: await recordSession1(persistence, history),
          })
        } else {
          results.push({
            name: history.id,
            session2: await recordSession2(persistence, history),
          })
        }
      } finally {
        await close()
      }
    } catch (error) {
      results.push({
        name: history.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  await bridge.invoke(`demand:result`, JSON.stringify({ phase, results }))
}

void run()
