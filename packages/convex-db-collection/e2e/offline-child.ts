import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { createCollection } from '@tanstack/db'
import { startOfflineExecutor } from '@tanstack/offline-transactions'
import { ConvexClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { jsonToConvex } from 'convex/values'
import { convexPaginatedCollectionOptions } from '../src/index'
import { convexMutationCodec, convexOfflineMutation } from '../src/offline'
import type { Value } from 'convex/values'
import type { StorageAdapter } from '@tanstack/offline-transactions'
import type { PaginationOptions, PaginationResult } from 'convex/server'

type Task = { clientId: string; text: string; rank: number; payload?: Value }
const [mode, directory, url, draftJSON] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
]
const draft = jsonToConvex(JSON.parse(draftJSON)) as Task
const checkpoint = (value: string) => {
  process.stdout.write(`CHECKPOINT:${value}\n`)
}
await mkdir(directory, { recursive: true })
const storage: StorageAdapter = {
  get: async (key) => {
    try {
      return await readFile(join(directory, encodeURIComponent(key)), `utf8`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === `ENOENT`) return null
      throw error
    }
  },
  set: async (key, value) => {
    if (
      mode === `uncertain` &&
      JSON.parse(value).outboxPhase === `deletion-pending`
    ) {
      checkpoint(`server-accepted`)
      await new Promise(() => {})
    }
    const path = join(directory, encodeURIComponent(key))
    await writeFile(`${path}.tmp`, value)
    await rename(`${path}.tmp`, path)
  },
  delete: async (key) => {
    await unlink(join(directory, encodeURIComponent(key)))
  },
  keys: async () =>
    (await readdir(directory))
      .filter((name) => !name.endsWith(`.tmp`))
      .map(decodeURIComponent),
  clear: async () => {
    for (const name of await readdir(directory))
      await unlink(join(directory, name))
  },
}
const client = new ConvexClient(url, {
  unsavedChangesWarning: false,
  logger: false,
})
const query = makeFunctionReference<
  `query`,
  { paginationOpts: PaginationOptions },
  PaginationResult<Task>
>(`tasks:list`)
const mutation = makeFunctionReference<
  `mutation`,
  {
    idempotencyKey: string
    clientId: string
    text: string
    rank: number
    payload?: Value
  },
  null
>(`tasks:write`)
const collection = createCollection(
  convexPaginatedCollectionOptions({
    id: `durable-tasks`,
    client,
    query,
    queryArgs: {},
    pageSize: 3,
    getKey: (row) => row.clientId,
    gcTime: 0,
    select: (rows) =>
      rows.map(({ clientId, text, rank, payload }) => ({
        clientId,
        text,
        rank,
        ...(payload === undefined ? {} : { payload }),
      })),
  }),
)
await collection.preload()
const offline = mode === `admit`
if (offline) await client.close()
let leader = true
const persist = convexOfflineMutation({
  client,
  mutation,
  collections: [collection],
  getArgs: ({ transaction }) => {
    const row = transaction.mutations[0].modified as Task
    return {
      clientId: row.clientId,
      text: row.text,
      rank: row.rank,
      ...(row.payload === undefined ? {} : { payload: row.payload }),
    }
  },
})
const executor = startOfflineExecutor({
  mutationCodec: convexMutationCodec,
  collections: { tasks: collection },
  storage,
  mutationFns: {
    save: async (params) => {
      checkpoint(`provider-call`)
      await persist(params)
    },
  },
  leaderElection: {
    requestLeadership: () => Promise.resolve(true),
    releaseLeadership: () => {
      leader = false
    },
    isLeader: () => leader,
    onLeadershipChange: () => () => {},
  },
  onlineDetector: {
    isOnline: () => !offline,
    subscribe: () => () => {},
    notifyOnline: () => {},
    dispose: () => {},
  },
})
await executor.waitForInit()
if (offline) {
  const action = executor.createOfflineAction<Task>({
    mutationFnName: `save`,
    onMutate: (row) => {
      collection.insert(row)
    },
  })
  action(draft)
  const poll = setInterval(async () => {
    if ((await executor.peekOutbox()).length === 1) {
      clearInterval(poll)
      checkpoint(`durable`)
    }
  }, 5)
} else if (mode === `replay`) {
  const poll = setInterval(async () => {
    if ((await executor.peekOutbox()).length === 0) {
      clearInterval(poll)
      await collection.utils.awaitSync()
      if (collection.get(draft.clientId)?.text !== draft.text)
        throw new Error(`Restored row did not reach the collection`)
      checkpoint(`replayed`)
      executor.dispose()
      await collection.cleanup()
      await client.close()
      process.exit(0)
    }
  }, 5)
}
// Parent sends SIGKILL at the admission/uncertain checkpoint. No graceful
// executor disposal or in-memory persistence is allowed to help restoration.
