/**
 * The installed Electric ShapeStream parses a fresh complete shape over a
 * controlled HTTP boundary. A snapshot starts at offset -1 and ends with
 * up-to-date; it replaces persisted rows even when restore is still held.
 * Reload may resume its cursor, so refresh answers must-refetch before the
 * same complete shape. Resumed delta-only startup belongs to Electric's
 * recovery oracle and must not be judged as complete replacement.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import {
  sortedStartupRows,
  startupRows,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import {
  startupInitialRender,
  trackStartupSync,
  untilStartup,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { electricCollectionOptions } from '../src/electric'
import type {
  PersistedStartupHistory,
  StartupRow,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type { PersistedStartupAdapter } from '../../db-adapter-conformance/tests/persisted-startup-driver'

type Request = { url: URL; respond: (response: Response) => void }
export const electricStartupAdapter: PersistedStartupAdapter<PersistedStartupHistory> =
  {
    scope: `collection`,
    create(persistence, history, id) {
      const requests: Array<Request> = []
      let available = false
      let offset = 0
      // Shape handles must never be reused. The SDK keeps expired handles in
      // localStorage, including across a browser reload with the same URL.
      const shape = `startup-${crypto.randomUUID()}`
      const fetchClient: typeof fetch = (input, init) =>
        new Promise((resolve, reject) => {
          const signal = init?.signal
          const request = {
            url: new URL(String(input)),
            respond: (response: Response) => {
              signal?.removeEventListener(`abort`, abort)
              resolve(response)
            },
          }
          const abort = () => {
            const index = requests.indexOf(request)
            if (index >= 0) requests.splice(index, 1)
            reject(signal?.reason ?? new DOMException(`aborted`, `AbortError`))
          }
          if (signal?.aborted) {
            abort()
            return
          }
          signal?.addEventListener(`abort`, abort, { once: true })
          requests.push(request)
        })
      const options = electricCollectionOptions<StartupRow>({
        id,
        shapeOptions: {
          url: `http://startup/shape-${id}`,
          params: { table: `rows` },
          fetchClient,
        },
        getKey: (row) => row.id,
      })
      const startup = trackStartupSync(options.sync)
      const collection = createCollection(
        persistedCollectionOptions({
          ...options,
          sync: startup.sync,
          ...startupInitialRender(history),
          persistence,
        }),
      )
      const take = async () => {
        await untilStartup(() => requests.length > 0)
        return requests.shift()!
      }
      const deliver = async () => {
        let request = await take()
        if (request.url.searchParams.get(`offset`) !== `-1`) {
          request.respond(
            new Response(
              JSON.stringify([{ headers: { control: `must-refetch` } }]),
              {
                status: 409,
                headers: { 'electric-handle': `${shape}-${++offset}` },
              },
            ),
          )
          request = await take()
        }
        offset++
        request.respond(
          new Response(
            JSON.stringify([
              ...startupRows(history.next, 2).map((row) => ({
                key: row.id,
                value: { id: row.id, value: String(row.value) },
                headers: { operation: `insert` },
              })),
              {
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: String(offset),
                },
              },
            ]),
            {
              headers: {
                'electric-handle': `${shape}-${offset}`,
                'electric-offset': `${offset}_0`,
                'electric-cursor': String(offset),
                'electric-up-to-date': `true`,
                'electric-schema': JSON.stringify({
                  id: { type: `text`, pk_index: 0 },
                  value: { type: `int4` },
                }),
              },
            },
          ),
        )
        available = true
      }
      return {
        collection,
        initialResult: startup.initialResult,
        firstSubmission: startup.firstSubmission,
        waitForRestore: startup.waitForRestore,
        snapshot: () => ({ rows: sortedStartupRows(collection.values()) }),
        deliver,
        responseAvailable: () => available,
        refresh: async () => {
          const reloaded = collection.reload()
          await deliver()
          await reloaded
        },
        dispose: () => collection.cleanup(),
      }
    },
  }
