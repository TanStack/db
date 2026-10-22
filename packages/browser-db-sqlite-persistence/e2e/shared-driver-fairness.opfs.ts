/**
 * Real-provider refinement of the shared-driver fairness oracle. The page runs
 * the same legal neutral and fixed-storm histories through public `preload()`,
 * the browser/core adapter boundary, and Chromium's OPFSCoopSyncVFS worker. It
 * freezes logical completions, public rows, raw dequeue reach, and the K=1
 * violation result before cleanup, then reports provider cleanup separately.
 * This fixture adds real OPFS/worker evidence; it does not claim multi-tab,
 * multi-process, non-Chromium, latency, or unbounded-eventuality coverage.
 */
import { openBrowserWASQLiteOPFSDatabase } from '../src/index'
import {
  findSharedDriverFairnessLawViolations,
  observeSharedDriverFairness,
} from '../tests/shared-driver-fairness-oracle'
import type {
  SharedDriverFairnessLawViolation,
  SharedDriverFairnessObservation,
  SharedDriverFairnessScenario,
} from '../tests/shared-driver-fairness-oracle'

export type OPFSOracleResult =
  | {
      status: `complete`
      provider: `Chromium OPFSCoopSyncVFS worker`
      observation: SharedDriverFairnessObservation
      lawViolations: ReadonlyArray<SharedDriverFairnessLawViolation>
      opfsCleanupFailures: ReadonlyArray<string>
    }
  | {
      status: `failed-before-checkpoint`
      provider: `Chromium OPFSCoopSyncVFS worker`
      primaryFailure: string
      opfsCleanupFailures: ReadonlyArray<string>
    }

declare global {
  interface Window {
    __tanstackDriverFairnessOracle?: OPFSOracleResult
  }
}

async function removeOPFSArtifacts(
  databaseName: string,
): Promise<ReadonlyArray<string>> {
  const failures: Array<string> = []
  const root = await navigator.storage.getDirectory()
  for (const suffix of [``, `-journal`, `-wal`]) {
    try {
      await root.removeEntry(`${databaseName}${suffix}`)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === `NotFoundError`)) {
        failures.push(
          `${databaseName}${suffix}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  // OPFSCoopSyncVFS creates one private temporary access-handle directory per
  // worker. This page owns its isolated origin for the fixture run.
  const iterableRoot = root as FileSystemDirectoryHandle & {
    entries: () => AsyncIterableIterator<[string, FileSystemHandle]>
  }
  for await (const [name, handle] of iterableRoot.entries()) {
    if (handle.kind !== `directory` || !name.startsWith(`.ahp-`)) continue
    try {
      await root.removeEntry(name, { recursive: true })
    } catch (error) {
      failures.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return failures
}

function scenarioFromLocation(): SharedDriverFairnessScenario {
  const mode = new URL(location.href).searchParams.get(`mode`)
  if (mode === `neutral`) {
    return {
      id: `opfs-neutral-reach`,
      work: [0, 1].map((index) => ({
        kind: `hydrate` as const,
        id: `hydrate-${index}`,
        seededRows: [
          { id: `row-${index}-0`, value: index * 10 },
          { id: `row-${index}-1`, value: index * 10 + 1 },
        ],
      })),
    }
  }
  if (mode === `interleaved`) {
    // A backlog beyond K=1 before the first hydrate, then hydrates queued ahead
    // of later persists: the hydrate-before-later-persist cell.
    const persist = (index: number) => ({
      kind: `persist` as const,
      id: `persist-${index}`,
      mutationsPerPersist: 2,
    })
    const hydrate = (index: number) => ({
      kind: `hydrate` as const,
      id: `hydrate-${index}`,
      seededRows: [
        { id: `row-${index}-0`, value: index * 10 },
        { id: `row-${index}-1`, value: index * 10 + 1 },
      ],
    })
    return {
      id: `opfs-fixed-interleaved`,
      work: [
        persist(0),
        persist(1),
        persist(2),
        hydrate(0),
        persist(3),
        hydrate(1),
        persist(4),
        hydrate(2),
      ],
    }
  }
  return {
    id: `opfs-fixed-persist-storm`,
    work: [
      ...Array.from({ length: 5 }, (_, index) => ({
        kind: `persist` as const,
        id: `persist-${index}`,
        mutationsPerPersist: 2,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        kind: `hydrate` as const,
        id: `hydrate-${index}`,
        seededRows: [
          { id: `row-${index}-0`, value: index * 10 },
          { id: `row-${index}-1`, value: index * 10 + 1 },
        ],
      })),
    ],
  }
}

async function run(): Promise<void> {
  const status = document.querySelector<HTMLOutputElement>(`#oracle-status`)
  const databaseName = `ws5b-${crypto.randomUUID()}.sqlite`
  let observation: SharedDriverFairnessObservation | undefined
  let lawViolations: ReadonlyArray<SharedDriverFairnessLawViolation> = []
  let primaryFailure: string | undefined
  let opfsCleanupFailures: ReadonlyArray<string> = []
  try {
    observation = await observeSharedDriverFairness(
      () => openBrowserWASQLiteOPFSDatabase({ databaseName }),
      scenarioFromLocation(),
    )
    // Freeze the reached semantic checkpoint before attempting OPFS cleanup.
    lawViolations = findSharedDriverFairnessLawViolations(observation)
  } catch (error) {
    primaryFailure = error instanceof Error ? error.message : String(error)
  }

  try {
    opfsCleanupFailures = await removeOPFSArtifacts(databaseName)
  } catch (cleanupError) {
    opfsCleanupFailures = [
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError),
    ]
  }

  if (observation && primaryFailure === undefined) {
    window.__tanstackDriverFairnessOracle = {
      status: `complete`,
      provider: `Chromium OPFSCoopSyncVFS worker`,
      observation,
      lawViolations,
      opfsCleanupFailures,
    }
    if (status) status.value = `complete`
  } else {
    window.__tanstackDriverFairnessOracle = {
      status: `failed-before-checkpoint`,
      provider: `Chromium OPFSCoopSyncVFS worker`,
      primaryFailure: primaryFailure ?? `unknown failure before checkpoint`,
      opfsCleanupFailures,
    }
    if (status) status.value = `failed-before-checkpoint`
  }
}

void run()
