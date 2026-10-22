/**
 * Receiving oracle for the Convex provider boundary. Automatic pagination must
 * match an independent unpaginated server query after each committed mutation.
 * The first driver uses real server-assigned cursors, both SDK clients, and
 * inserts, deletion at a boundary, and movement between ranges. Expected rows
 * come from tasks:all, which does not paginate or use the adapter.
 *
 * The durable driver checks the outbox's documented process-restart law with
 * actual disk storage and SIGKILL. Its independent model applies one logical
 * insert, update, or delete, hence the draft row or its absence and one receipt.
 * Histories vary the operation and draft's text/rank, plus whether a second
 * crash loses the server acknowledgement. Native values vary on inserted rows.
 * A server-accepted checkpoint occurs before the outbox phase can be recorded,
 * so replay must reuse its key rather than rely on a completed local marker.
 * Checkpoints are observed in child stdout before killing the process. Server
 * rows/receipts and replayed Collection rows are checked only after replay.
 *
 * This is a receiving witness for the offline engine's interruption/settlement
 * owners, not another model of leadership. It covers one pending mutation in one
 * Collection against a real local backend. Shared-key/multi-tab histories stay
 * with those primary owners. Cloud infrastructure and an OS power failure
 * during a filesystem write are outside this process-crash test.
 */
import fc from 'fast-check'
import { convexToJson } from 'convex/values'
import { createCollection } from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { describe, expect, inject, it } from 'vitest'
import { convexPaginatedCollectionOptions } from '../src/index'
import type { Value } from 'convex/values'
import type { ConvexCollectionClient } from '../src/index'
import type { PaginationOptions, PaginationResult } from 'convex/server'

type Task = {
  _id: string
  _creationTime: number
  clientId: string
  text: string
  rank: number
  payload?: Value
}
const seed = makeFunctionReference<`mutation`, { count: number }, null>(
  `tasks:seed`,
)
const write = makeFunctionReference<
  `mutation`,
  {
    idempotencyKey: string
    clientId: string
    text: string
    rank: number
    remove?: boolean
  },
  null
>(`tasks:write`)
const all = makeFunctionReference<`query`, {}, Array<Task>>(`tasks:all`)
const url = inject(`convexUrl`)

describe.each([`javascript`, `react`] as const)(
  `real backend with %s client`,
  (kind) => {
    it.each([`list`, `split`] as const)(
      `loads %s pages through inserts, moves, deletions, and server splits`,
      async (functionName) => {
        const client =
          kind === `javascript`
            ? new ConvexClient(url, { unsavedChangesWarning: false })
            : new ConvexReactClient(url, { unsavedChangesWarning: false })
        await client.mutation(seed, { count: 23 })
        let splitResponses = 0
        const inspect = (value: unknown): void => {
          if (
            value &&
            typeof value === `object` &&
            `pageStatus` in value &&
            (value.pageStatus === `SplitRequired` ||
              value.pageStatus === `SplitRecommended`)
          )
            splitResponses++
        }
        const source: ConvexCollectionClient =
          `onUpdate` in client
            ? {
                onUpdate: (query, args, callback, onError) =>
                  client.onUpdate(
                    query,
                    args,
                    (value) => {
                      inspect(value)
                      return callback(value)
                    },
                    onError,
                  ),
              }
            : {
                watchQuery: (query, args, options) => {
                  const watch = client.watchQuery(query, args, options)
                  return {
                    ...watch,
                    localQueryResult: () => {
                      const value = watch.localQueryResult()
                      inspect(value)
                      return value
                    },
                  }
                },
              }

        const collection = createCollection(
          convexPaginatedCollectionOptions({
            id: `tasks`,
            client: source,
            query: makeFunctionReference<
              `query`,
              { paginationOpts: PaginationOptions },
              PaginationResult<Task>
            >(`tasks:${functionName}`),
            queryArgs: {},
            pageSize: 4,
            getKey: (task) => task.clientId,
            gcTime: 0,
          }),
        )
        const check = async () => {
          const expected = await client.query(all, {})
          await collection.utils.awaitSync()
          const actual = [...collection.values()]
            .map(({ clientId, text, rank }) => ({ clientId, text, rank }))
            .sort((a, b) => a.rank - b.rank)
          expect(actual).toEqual(
            expected.map(({ clientId, text, rank }) => ({
              clientId,
              text,
              rank,
            })),
          )
        }
        try {
          await collection.preload()
          expect(collection.size).toBe(23)
          await check()
          for (const operation of [
            {
              clientId: `new-first`,
              rank: -10,
              text: `insert before all pages`,
            },
            {
              clientId: `new-last`,
              rank: 100,
              text: `append after exhaustion`,
            },
            { clientId: `3`, rank: 3, text: `delete a boundary`, remove: true },
            { clientId: `12`, rank: -5, text: `move across cursor ranges` },
            { clientId: `8`, rank: 8, text: `update a middle page` },
          ]) {
            await client.mutation(write, {
              ...operation,
              idempotencyKey: crypto.randomUUID(),
            })
            await check()
          }
          if (functionName === `split`)
            expect(splitResponses).toBeGreaterThan(0)
        } finally {
          await collection.cleanup()
          await client.close()
        }
      },
    )
  },
)

async function durableHistory(
  draft: { clientId: string; text: string; rank: number; payload?: Value },
  uncertain: boolean,
  operation: `insert` | `update` | `delete`,
) {
  const { spawn } = await import('node:child_process')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const directory = await mkdtemp(join(tmpdir(), `convex-outbox-`))
  const client = new ConvexClient(url, { unsavedChangesWarning: false })
  await client.mutation(seed, { count: operation === `insert` ? 0 : 1 })
  const before = (await client.query(all, {})).map(
    ({ clientId, text, rank, payload }) => ({ clientId, text, rank, payload }),
  )
  // The public write contract gives one final draft for insert/update and no
  // row for delete. These expectations do not inspect restored mutations.
  const expected =
    operation === `delete` ? [] : [{ ...draft, payload: draft.payload }]
  async function run(mode: string, target: string): Promise<Array<string>> {
    const child = spawn(
      process.execPath,
      [
        `--import`,
        `tsx`,
        fileURLToPath(new URL(`./offline-child.ts`, import.meta.url)),
        mode,
        directory,
        url,
        JSON.stringify(convexToJson(draft)),
        operation,
      ],
      { stdio: [`ignore`, `pipe`, `pipe`] },
    )
    let output = ``
    let errors = ``
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill(`SIGKILL`)
        reject(new Error(`Child ${mode} timed out: ${output}\n${errors}`))
      }, 15000)
      child.stderr.on(`data`, (chunk) => {
        errors += String(chunk)
      })
      child.stdout.on(`data`, (chunk) => {
        output += String(chunk)
        if (output.includes(`CHECKPOINT:${target}\n`)) {
          clearTimeout(timeout)
          child.kill(`SIGKILL`)
          resolve()
        }
      })
      child.on(`error`, reject)
      child.on(`exit`, (code, signal) => {
        if (code !== 0 && signal !== `SIGKILL`) {
          clearTimeout(timeout)
          reject(new Error(`Child ${mode} failed: ${errors}`))
        }
      })
    })
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve()
      else child.once(`exit`, () => resolve())
    })
    return output
      .split(`\n`)
      .filter((line) => line.startsWith(`CHECKPOINT:`))
      .map((line) => line.slice(11))
  }
  try {
    const admitted = await run(`admit`, `durable`)
    expect(admitted).not.toContain(`provider-call`)
    expect(
      (await client.query(all, {})).map(
        ({ clientId, text, rank, payload }) => ({
          clientId,
          text,
          rank,
          payload,
        }),
      ),
    ).toEqual(before)
    if (uncertain) {
      expect(await run(`uncertain`, `server-accepted`)).toContain(
        `provider-call`,
      )
      expect((await client.query(all, {})).map((row) => row.clientId)).toEqual(
        expected.map((row) => row.clientId),
      )
    }
    expect(await run(`replay`, `replayed`)).toContain(`provider-call`)
    const receipts = makeFunctionReference<`query`, {}, Array<{ key: string }>>(
      `tasks:receipts`,
    )
    expect(await client.query(receipts, {})).toHaveLength(1)
    expect(
      (await client.query(all, {})).map(
        ({ clientId, text, rank, payload }) => ({
          clientId,
          text,
          rank,
          payload,
        }),
      ),
    ).toEqual(expected)
  } finally {
    await client.close()
    await rm(directory, { recursive: true, force: true })
  }
}

it.each([`insert`, `update`, `delete`] as const)(
  `restores durable %s and deduplicates uncertain acknowledgements across generated process histories`,
  async (operation) => {
    const property = fc.asyncProperty(
      fc.record({
        text:
          operation === `delete`
            ? fc.constant(`task 0`)
            : fc.string({ maxLength: 12 }),
        rank:
          operation === `delete`
            ? fc.constant(0)
            : fc.integer({ min: -50, max: 50 }),
        uncertain: fc.boolean(),
        payload:
          operation === `insert`
            ? fc.oneof(
                fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }),
                fc.constantFrom(NaN, Infinity, -Infinity, -0),
                fc
                  .uint8Array({ maxLength: 12 })
                  .map((bytes) => bytes.buffer as ArrayBuffer),
              )
            : fc.constant(undefined),
      }),
      async ({ text, rank, uncertain, payload }) =>
        durableHistory(
          {
            clientId: operation === `insert` ? `offline-created` : `0`,
            text,
            rank,
            ...(operation === `insert` ? { payload } : {}),
          },
          uncertain,
          operation,
        ),
    )
    const replaySeed = process.env.CONVEX_BACKEND_ORACLE_SEED
    if (replaySeed)
      await fc.assert(property, {
        numRuns: 6,
        seed: Number(replaySeed),
        path: process.env.CONVEX_BACKEND_ORACLE_PATH,
      })
    else {
      await fc.assert(property, { numRuns: 6, seed: 20261022 })
      await fc.assert(property, { numRuns: 6 })
    }
  },
  120000,
)
