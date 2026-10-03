/**
 * Browser driver for a source sync transaction that begins while persisted
 * hydration is held, then commits after that hydration scope exits. The real
 * Electric SDK supplies the transaction and the real OPFS adapter supplies
 * the durable rows. Only response delivery, hydration return, and commit
 * invocation are held by this fixture.
 */
import { IR, createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../../electric-db-collection/src/electric'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src/index'
import type { ElectricCollectionUtils } from '../../electric-db-collection/src/electric'

type Item = { id: string; label: string }

export type HydrationStraddleReach = {
  hydrationLoadReturned: boolean
  hydrationHeld: boolean
  sourceBeginDuringHydration: boolean
  rowCommitParked: boolean
  hydrationScopeExited: boolean
  rowCommitApplied: boolean
  // Fixture-only cut after the load, success-path unload, and error handling.
  subsetLoadAndReleaseChainSettled: boolean
}

export type HydrationStraddleObservation = {
  phase: `starting` | `ready` | `failed`
  failure?: string
  status: string
  isLeader: boolean
  publicRows: Array<Item>
  durableRows: Array<Item>
  reach: HydrationStraddleReach
}

type HydrationStraddleProbe = {
  startHydration: () => void
  reach: () => HydrationStraddleReach
  diagnostic: () => {
    phase: HydrationStraddleObservation[`phase`]
    stage: string
    failure?: string
    status: string
    publicRows: Array<Item>
    reach: HydrationStraddleReach
    events: Array<string>
  }
  observe: () => Promise<HydrationStraddleObservation>
  releaseHydration: () => void
  releaseCommit: () => void
  cleanup: () => Promise<Array<string>>
}

declare global {
  interface Window {
    __electricHydrationStraddleProbe?: HydrationStraddleProbe
  }
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

function sortedRows(rows: Iterable<Item>): Array<Item> {
  return Array.from(rows, ({ id, label }) => ({ id, label })).sort((a, b) =>
    a.id.localeCompare(b.id),
  )
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message || (error instanceof Error ? error.name : `Unknown failure`)
}

const parameters = new URL(location.href).searchParams
const databaseId = parameters.get(`databaseId`)
const collectionId = parameters.get(`collectionId`)
const table = parameters.get(`table`)
const mode = parameters.get(`mode`)
if (!databaseId || !collectionId || !table) {
  throw new Error(`Missing Electric hydration-straddle oracle parameters`)
}
if (mode !== `controlled` && mode !== `plain`) {
  throw new Error(`Invalid Electric hydration-straddle oracle mode`)
}

const releaseHydration = gate()
const releaseCommit = gate()
const reach: HydrationStraddleReach = {
  hydrationLoadReturned: false,
  hydrationHeld: false,
  sourceBeginDuringHydration: false,
  rowCommitParked: false,
  hydrationScopeExited: false,
  rowCommitApplied: false,
  subsetLoadAndReleaseChainSettled: false,
}
const events: Array<string> = []
let phase: HydrationStraddleObservation[`phase`] = `starting`
let stage = `opening database`
let failure: string | undefined
let status = () => `unavailable`
let isLeader = () => false
let publicRows = (): Array<Item> => []
let durableRows = (): Promise<Array<Item>> => Promise.resolve([])
let startHydration: () => void = () => {
  throw new Error(`Collection is not ready for controlled hydration`)
}
let controlArmed = false
let cleaned = false
const cleanupTasks: Array<() => Promise<void> | void> = []

window.__electricHydrationStraddleProbe = {
  startHydration: () => startHydration(),
  reach: () => ({ ...reach }),
  diagnostic: () => ({
    phase,
    stage,
    ...(failure ? { failure } : {}),
    status: status(),
    publicRows: publicRows(),
    reach: { ...reach },
    events: [...events],
  }),
  observe: async () => ({
    phase,
    ...(failure ? { failure } : {}),
    status: status(),
    isLeader: isLeader(),
    publicRows: publicRows(),
    durableRows: await durableRows(),
    reach: { ...reach },
  }),
  releaseHydration: () => releaseHydration.open(),
  releaseCommit: () => releaseCommit.open(),
  cleanup: async () => {
    if (cleaned) return []
    cleaned = true
    releaseHydration.open()
    releaseCommit.open()
    const failures: Array<string> = []
    for (const cleanup of cleanupTasks) {
      try {
        await cleanup()
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    return failures
  },
}

try {
  const database = await openBrowserWASQLiteOPFSDatabase({
    databaseName: `${databaseId}.sqlite`,
  })
  events.push(`database-open`)
  cleanupTasks.unshift(async () => database.close?.())
  const coordinator = new BrowserCollectionCoordinator({ dbName: databaseId })
  cleanupTasks.unshift(() => coordinator.dispose())
  const persistence = createBrowserWASQLitePersistence({
    database,
    coordinator,
  })

  const source = electricCollectionOptions<Item>({
    id: collectionId,
    shapeOptions: {
      url: `${location.origin}/electric/v1/shape`,
      params: { table: `public.${table}` },
    },
    syncMode: `on-demand`,
    getKey: (item) => item.id,
  })
  const sourceSync = source.sync
  const openSourceTransactions: Array<{
    beganDuringHydration: boolean
    writes: number
  }> = []
  const controlledSync = {
    ...sourceSync,
    sync: (params: Parameters<typeof sourceSync.sync>[0]) =>
      sourceSync.sync({
        ...params,
        begin: (...args) => {
          events.push(`source-begin`)
          const beganDuringHydration = controlArmed && reach.hydrationHeld
          if (beganDuringHydration) reach.sourceBeginDuringHydration = true
          openSourceTransactions.push({ beganDuringHydration, writes: 0 })
          return params.begin(...args)
        },
        write: (...args) => {
          events.push(`source-write`)
          const active = openSourceTransactions.at(-1)
          if (active) active.writes++
          return params.write(...args)
        },
        commit: (...args) => {
          events.push(`source-commit`)
          const active = openSourceTransactions.pop()
          if (
            mode !== `controlled` ||
            reach.rowCommitParked ||
            !active?.beganDuringHydration ||
            active.writes === 0
          ) {
            return params.commit(...args)
          }
          reach.rowCommitParked = true
          return releaseCommit.promise
            .then(async () => {
              const applied = params.commit(...args)
              if (applied !== true) await applied
              reach.rowCommitApplied = true
            })
            .catch((error: unknown) => {
              failure ??= failureMessage(error)
              phase = `failed`
              throw error
            })
        },
      }),
  }
  const options = persistedCollectionOptions<
    Item,
    string | number,
    never,
    ElectricCollectionUtils<Item>
  >({
    ...source,
    sync: mode === `controlled` ? controlledSync : sourceSync,
    persistence,
    schemaVersion: 1,
  })

  if (mode === `controlled`) {
    const adapter = options.persistence.adapter
    const originalScope = adapter.runInHydrationScope?.bind(adapter)
    if (!originalScope) {
      throw new Error(`Persistence adapter has no hydration scope`)
    }
    adapter.runInHydrationScope = async (task) => {
      events.push(`hydration-scope-start`)
      const heldThisScope = { value: false }
      const result = await originalScope(async (scopedAdapter) => {
        const originalLoadSubset = scopedAdapter.loadSubset.bind(scopedAdapter)
        return task({
          ...scopedAdapter,
          loadSubset: async (...args) => {
            events.push(`hydration-load-subset-called`)
            const rows = await originalLoadSubset(...args)
            events.push(`hydration-load-subset-returned`)
            if (
              controlArmed &&
              !reach.hydrationLoadReturned &&
              args[0] === collectionId
            ) {
              heldThisScope.value = true
              reach.hydrationLoadReturned = true
              reach.hydrationHeld = true
              await releaseHydration.promise
              reach.hydrationHeld = false
            }
            return rows
          },
        })
      })
      if (heldThisScope.value) {
        events.push(`hydration-scope-exit`)
        reach.hydrationScopeExited = true
      }
      return result
    }
  }

  stage = `building collection`
  const collection = createCollection(options)
  cleanupTasks.unshift(() => collection.cleanup())
  status = () => collection.status
  isLeader = () => coordinator.isLeader(collectionId)
  publicRows = () => sortedRows(collection.values())
  durableRows = async () => {
    const snapshot =
      await options.persistence.adapter.loadResumeSnapshot(collectionId)
    return sortedRows(snapshot.rows.map(({ value }) => value as Item))
  }
  stage = `preloading collection`
  await collection.preload()
  const initialDemand = {}
  stage = `loading initial source row`
  await collection._sync.loadSubset(initialDemand)
  cleanupTasks.unshift(() => collection._sync.unloadSubset(initialDemand))
  stage = `collection preloaded`
  phase = `ready`
  startHydration = () => {
    if (mode !== `controlled` || controlArmed) {
      throw new Error(`Controlled hydration cannot start again`)
    }
    controlArmed = true
    // A distinct, empty demand opens another persisted hydration scope. Its
    // remote snapshot cannot supply the updated row independently of the live
    // transaction whose commit this fixture parks.
    const subsetDemand = {
      where: new IR.Func(`eq`, [
        new IR.PropRef([`id`]),
        new IR.Value(`absent-row`),
      ]),
    }
    void Promise.resolve(collection._sync.loadSubset(subsetDemand))
      .then(() => collection._sync.unloadSubset(subsetDemand))
      .catch((error: unknown) => {
        failure ??= failureMessage(error)
        phase = `failed`
      })
      .finally(() => {
        reach.subsetLoadAndReleaseChainSettled = true
      })
  }
} catch (error) {
  failure =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ``}`
      : String(error)
  phase = `failed`
}
