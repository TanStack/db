/**
 * Real-browser refinement of the remote-subset wire law. A persisted on-demand
 * Query Collection and filtered live-query Collection follow the reported
 * two-tab path. The follower must send a clone-safe request and receive the
 * selected public row. React rendering and Firefox/Zen remain outside scope.
 * See https://github.com/TanStack/db/issues/1498.
 */
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import {
  parseLoadSubsetOptions,
  queryCollectionOptions,
} from '@tanstack/query-db-collection'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src/index'
import type { LoadSubsetOptions } from '@tanstack/db'

type Item = { id: string; label: string }

export type RemoteSubsetObservation = {
  phase: `starting` | `ready` | `failed`
  failure?: string
  isLeader: boolean
  rows: Array<Item>
  upstreamLoads: number
  ensureRequests: Array<{
    hasWhere: boolean
    hasSignal: boolean
    hasSubscriptionCallback: boolean
  }>
  remoteSubsetPosts: number
  remoteSubsetPostFailures: Array<string>
}

type RemoteSubsetProbe = {
  observe: () => RemoteSubsetObservation
  tryInvalidWire: () => Promise<{
    name: string
    path?: string
    postsBefore: number
    postsAfter: number
  }>
  cleanup: () => Promise<Array<string>>
}

declare global {
  interface Window {
    __remoteSubsetProbe?: RemoteSubsetProbe
  }
}

const parameters = new URL(location.href).searchParams
const databaseId = parameters.get(`databaseId`)
const itemId = parameters.get(`itemId`)
if (!databaseId || !itemId) throw new Error(`Missing oracle parameters`)

let phase: RemoteSubsetObservation[`phase`] = `starting`
let failure: string | undefined
let upstreamLoads = 0
let remoteSubsetPosts = 0
const remoteSubsetPostFailures: Array<string> = []
const ensureRequests: RemoteSubsetObservation[`ensureRequests`] = []
const cleanupTasks: Array<() => Promise<void> | void> = []
let readRuntime = () => ({
  isLeader: false,
  rows: [] as Array<Item>,
})
let cleaned = false
let tryInvalidWire: RemoteSubsetProbe[`tryInvalidWire`] = () =>
  Promise.reject(new Error(`Coordinator not ready`))

window.__remoteSubsetProbe = {
  observe: () => ({
    phase,
    ...(failure ? { failure } : {}),
    ...readRuntime(),
    upstreamLoads,
    ensureRequests: [...ensureRequests],
    remoteSubsetPosts,
    remoteSubsetPostFailures: [...remoteSubsetPostFailures],
  }),
  tryInvalidWire: () => tryInvalidWire(),
  cleanup: async () => {
    if (cleaned) return []
    cleaned = true
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

const originalPostMessage = BroadcastChannel.prototype.postMessage
BroadcastChannel.prototype.postMessage = function (message: unknown) {
  const payload =
    typeof message === `object` && message !== null
      ? (message as { payload?: { type?: unknown } }).payload
      : undefined
  const isRemoteSubset = payload?.type === `rpc:ensureRemoteSubset:req`
  if (isRemoteSubset) remoteSubsetPosts++
  try {
    return originalPostMessage.call(this, message)
  } catch (error) {
    if (isRemoteSubset) {
      remoteSubsetPostFailures.push(
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
      )
    }
    throw error
  }
}
cleanupTasks.unshift(() => {
  BroadcastChannel.prototype.postMessage = originalPostMessage
})

try {
  const database = await openBrowserWASQLiteOPFSDatabase({
    databaseName: `${databaseId}.sqlite`,
  })
  cleanupTasks.unshift(async () => database.close?.())

  const coordinator = new BrowserCollectionCoordinator({ dbName: databaseId })
  cleanupTasks.unshift(() => coordinator.dispose())
  const originalEnsure = coordinator.requestEnsureRemoteSubset.bind(coordinator)
  coordinator.requestEnsureRemoteSubset = (collectionId, options) => {
    ensureRequests.push({
      hasWhere: options.where !== undefined,
      hasSignal: options.signal !== undefined,
      hasSubscriptionCallback: typeof options.subscription?.on === `function`,
    })
    return originalEnsure(collectionId, options)
  }
  tryInvalidWire = async () => {
    const postsBefore = remoteSubsetPosts
    try {
      await coordinator.requestEnsureRemoteSubset(`repro-items`, {
        where: new IR.Value({ nested: () => {} }),
      } as unknown as LoadSubsetOptions)
      return { name: `none`, postsBefore, postsAfter: remoteSubsetPosts }
    } catch (error) {
      return {
        name: error instanceof Error ? error.name : String(error),
        ...(typeof error === `object` && error !== null && `path` in error
          ? { path: String(error.path) }
          : {}),
        postsBefore,
        postsAfter: remoteSubsetPosts,
      }
    }
  }

  const persistence = createBrowserWASQLitePersistence({
    database,
    coordinator,
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  cleanupTasks.unshift(() => queryClient.clear())
  const source = createCollection(
    persistedCollectionOptions<Item, string>({
      id: `repro-items`,
      schemaVersion: 1,
      persistence,
      ...queryCollectionOptions<Item, unknown, Array<string>, string>({
        queryKey: [`repro-items`],
        queryClient,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        queryFn: ({ meta }) => {
          upstreamLoads++
          const { limit, where, orderBy } = meta?.loadSubsetOptions ?? {}
          const { filters } = parseLoadSubsetOptions({ limit, where, orderBy })
          const idFilter = filters.find(
            (filter) =>
              filter.field.join(`.`) === `id` && filter.operator === `eq`,
          )
          if (!idFilter) return Promise.resolve([])
          const id = String(idFilter.value)
          return Promise.resolve([{ id, label: `Item ${id}` }])
        },
      }),
    }),
  )
  cleanupTasks.unshift(() => source.cleanup())

  const live = createLiveQueryCollection((query) =>
    query
      .from({ item: source })
      .where(({ item }) => eq(item.id, itemId))
      .select(({ item }) => ({ id: item.id, label: item.label })),
  )
  cleanupTasks.unshift(() => live.cleanup())
  readRuntime = () => ({
    isLeader: coordinator.isLeader(`repro-items`),
    rows: [...live.values()],
  })

  await live.preload()
  phase = `ready`
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  phase = `failed`
}
