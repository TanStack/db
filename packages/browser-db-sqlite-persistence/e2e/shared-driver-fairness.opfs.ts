import { openBrowserWASQLiteOPFSDatabase } from '../src/index'
import {
  findSharedDriverFairnessViolation,
  observeSharedDriverFairness,
} from '../tests/shared-driver-fairness-oracle'
import type {
  SharedDriverFairnessObservation,
  SharedDriverFairnessScenario,
  SharedDriverFairnessViolation,
} from '../tests/shared-driver-fairness-oracle'

export type OPFSOracleResult =
  | {
      status: `complete`
      provider: `Chromium OPFSCoopSyncVFS worker`
      observation: SharedDriverFairnessObservation
      violation: SharedDriverFairnessViolation | undefined
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
  let violation: SharedDriverFairnessViolation | undefined
  let primaryFailure: string | undefined
  let opfsCleanupFailures: ReadonlyArray<string> = []
  try {
    observation = await observeSharedDriverFairness(
      () => openBrowserWASQLiteOPFSDatabase({ databaseName }),
      scenarioFromLocation(),
    )
    // Freeze the reached semantic checkpoint before attempting OPFS cleanup.
    violation = findSharedDriverFairnessViolation(observation)
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

  if (observation) {
    window.__tanstackDriverFairnessOracle = {
      status: `complete`,
      provider: `Chromium OPFSCoopSyncVFS worker`,
      observation,
      violation,
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
