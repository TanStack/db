/**
 * Electron app driver for the reload class oracle in
 * `packages/db-sqlite-persistence-core/tests/reload-class-oracle.ts`, which
 * owns the law, model, histories, driver loop, and comparison. It runs every
 * fixed history in a real Electron renderer: each tab is the real renderer
 * persistence and an ElectronCollectionCoordinator over Chromium's Web Locks
 * and BroadcastChannel, calling the real main process over real IPC. The tabs
 * of one history share a renderer, as windows share a main process. Statement
 * latency is the real IPC round trip. The main process records statements and
 * runs the hold seams, because the adapter runs there.
 */
import {
  fixedReloadHistories,
  observeReload,
  reloadViolations,
} from '../../../../db-sqlite-persistence-core/tests/reload-class-oracle'
import { createElectronSQLitePersistence } from '../../../src/renderer'
import { ElectronCollectionCoordinator } from '../../../src/electron-coordinator'
import { createSqlRecording } from './sql-recording'
import type { RecordedSql } from './sql-recording'
import type {
  HeldCall,
  ReloadHost,
  ReloadSeams,
} from '../../../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceResponseEnvelope,
} from '../../../src/protocol'

type Bridge = {
  invoke: (channel: string, ...args: Array<unknown>) => Promise<unknown>
  on: (channel: string, listener: (...args: Array<unknown>) => void) => void
}

declare global {
  interface Window {
    reloadBridge: Bridge
  }
}

const bridge = window.reloadBridge
const recording = createSqlRecording()
bridge.on(`reload:sql`, (entry) => recording.accept(entry as RecordedSql))
async function flushRecording() {
  const snapshot = (await bridge.invoke(`reload:trace`)) as {
    frame: number
    entries: Array<RecordedSql>
  }
  if (snapshot.frame !== recording.frame())
    throw new Error(`SQL recording frame changed during its observation`)
  for (const entry of snapshot.entries) recording.accept(entry)
}
const invoke: ElectronPersistenceInvoke = (channel, request) =>
  bridge.invoke(
    channel,
    request,
  ) as Promise<ElectronPersistenceResponseEnvelope>
const heldTokens = new Set<string>()
bridge.on(`reload:held`, (token) => heldTokens.add(token as string))

function remoteHold(seam: keyof ReloadSeams, storageId: string): HeldCall {
  const token = crypto.randomUUID()
  let released = false
  void bridge.invoke(`reload:hold`, token, seam, storageId)
  return {
    isHeld: () => !released && heldTokens.has(token),
    release: () => {
      released = true
      void bridge.invoke(`reload:release`, token)
    },
    uninstall: () => {
      released = true
      void bridge.invoke(`reload:uninstall`, token)
    },
  }
}

function electronAppHost(filename: string): ReloadHost {
  let renderers = 0
  return {
    seams: {
      holdFirstRowSnapshot: (storageId) =>
        remoteHold(`holdFirstRowSnapshot`, storageId),
      holdFirstWrite: (storageId) => remoteHold(`holdFirstWrite`, storageId),
      holdFirstSubsetLoad: (storageId) =>
        remoteHold(`holdFirstSubsetLoad`, storageId),
    },
    adapterPerTab: false,
    controlsLatency: false,
    setStatementLatency: () => {},
    record: async (next) => {
      if (next) {
        const frame = recording.begin(next)
        await bridge.invoke(`reload:record`, frame, true)
      } else {
        await recording.stop(
          bridge.invoke(`reload:record`, recording.frame(), false) as Promise<
            Array<RecordedSql>
          >,
        )
      }
    },
    flushRecord: flushRecording,
    rawQuery: async (sql, params = []) =>
      (await bridge.invoke(`reload:raw`, filename, sql, [...params])) as Array<
        Record<string, unknown>
      >,
    rawExec: async (sql) => {
      await bridge.invoke(`reload:raw-exec`, filename, sql)
    },
    openTab: async (dbName) => {
      if (renderers++ === 0) await bridge.invoke(`reload:session`, filename)
      const coordinator = new ElectronCollectionCoordinator({ dbName })
      return {
        persistence: createElectronSQLitePersistence({
          coordinator,
          invoke,
        }),
        isLeader: (storageId) => coordinator.isLeader(storageId),
        close: async () => {
          coordinator.dispose()
          if (--renderers === 0) await bridge.invoke(`reload:close-session`)
        },
      }
    },
  }
}

async function run() {
  const directory = new URLSearchParams(location.search).get(`dir`)!
  const results = []
  for (const [index, [name, history]] of fixedReloadHistories.entries()) {
    try {
      const observation = await observeReload(
        electronAppHost(`${directory}/h${index}.sqlite`),
        history,
      )
      const violations = reloadViolations(history, observation)
      results.push({
        name,
        violations,
        // Keep the raw record when a receiving law fails. IPC ordering cannot
        // be diagnosed from the final violation names alone.
        ...(violations.length > 0 ? { observation } : {}),
      })
    } catch (error) {
      results.push({
        name,
        failedBeforeCheckpoint:
          error instanceof Error ? error.message : String(error),
      })
    }
  }
  await bridge.invoke(
    `reload:result`,
    JSON.stringify({
      expected: fixedReloadHistories.map(([name]) => name),
      results,
    }),
  )
}

void run()
