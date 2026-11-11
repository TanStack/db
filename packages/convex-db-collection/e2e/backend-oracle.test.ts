/**
 * Receiving oracle for the Convex provider boundary. Automatic pagination must
 * match an independent unpaginated server query after each committed mutation.
 * The first driver uses real server-assigned cursors, both SDK clients, and
 * inserts, deletion at a boundary, and movement between ranges. Expected rows
 * come from tasks:all, which does not paginate or use the adapter.
 *
 * The durable driver checks the outbox's documented process-restart law with
 * actual disk storage and SIGKILL. Its independent model applies one logical
 * insert, update, or delete, hence the draft row or its absence, one receipt
 * containing the durable key, and one increment of a non-idempotent counter.
 * Histories vary the operation and draft's text/rank, plus whether a second
 * crash loses the server acknowledgement. Native values vary on inserted and updated rows.
 * A server-accepted checkpoint occurs before the outbox phase can be recorded,
 * so replay must reuse its key rather than rely on a completed local marker.
 * Checkpoints are observed in child stdout before killing the process. Server
 * rows, receipt keys, application count, and complete replayed Collection rows
 * are checked after replay. Equal task rows alone cannot distinguish a duplicate
 * server application, while the independently observed counter can.
 * Each fixed/random campaign declares and reports reach in individual process
 * histories. Counts follow observed disk admission, the uncertain child cut,
 * and successful replay comparisons; generated intentions do not earn reach.
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
import { expect, inject } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import { convexPaginatedCollectionOptions } from '../src/index'
import { withTestCleanup } from '../tests/helpers'
import { all, seed } from './backend-support'
import type { Task } from './backend-support'
import type { Value } from 'convex/values'
import type { ConvexCollectionClient } from '../src/index'
import type { PaginationOptions, PaginationResult } from 'convex/server'

type AssertionHistory<T> = T extends fc.Arbitrary<infer H> ? H : never
type AssertionReach = {
  beginHistory: () => void
  reach: (state: string) => void
}

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
const url = inject(`convexUrl`)

/**
 * The check, a second formulation: after the source accepts each write, the
 * mirrored Collection equals the unpaginated tasks:all query in rank order.
 * That query does not paginate or use the adapter.
 */
async function expectMirrorsAllTasks(
  client: ConvexClient | ConvexReactClient,
  collection: {
    utils: { awaitSync: () => Promise<unknown> }
    values: () => Iterable<Task>
  },
): Promise<void> {
  const expected = await client.query(all, {})
  await collection.utils.awaitSync()
  const actual = [...collection.values()]
    .map(({ clientId, text, rank }) => ({ clientId, text, rank }))
    .sort((a, b) => a.rank - b.rank)
  oracleAssertion(`backend-oracle.test.ts:80:toEqual`, () =>
    expect(actual).toEqual(
      expected.map(({ clientId, text, rank }) => ({
        clientId,
        text,
        rank,
      })),
    ),
  )
}

const pageLoads = ([`javascript`, `react`] as const).flatMap((kind) =>
  ([`list`, `split`] as const).map((functionName) => ({ kind, functionName })),
)

// One client loads one paginated function's pages, then receives each
// authored backend write. After every write the Collection must mirror the
// backend's own complete `all` query.
async function loadPagesThroughWrites({
  kind,
  functionName,
}: (typeof pageLoads)[number]): Promise<void> {
  const client =
    kind === `javascript`
      ? new ConvexClient(url, { unsavedChangesWarning: false })
      : new ConvexReactClient(url, { unsavedChangesWarning: false })
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
  const check = () => expectMirrorsAllTasks(client, collection)
  await withTestCleanup(
    async () => {
      await client.mutation(seed, { count: 23 })
      await collection.preload()
      oracleAssertion(`backend-oracle.test.ts:160:toBe`, () =>
        expect(collection.size).toBe(23),
      )
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
        {
          clientId: `3`,
          rank: 3,
          text: `delete a boundary`,
          remove: true,
        },
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
        oracleAssertion(`backend-oracle.test.ts:189:toBeGreaterThan`, () =>
          expect(splitResponses).toBeGreaterThan(0),
        )
    },
    () => collection.cleanup(),
    () => client.close(),
  )
}

oracleProperty({
  id: `convex.backend-pages`,
  law: {
    statement: `A paginated Convex Collection mirrors the backend's complete task list after preload and after each insert, move, deletion and server split.`,
    authority: `The real-backend contract stated at the top of this file; docs/collections/convex-collection.md; docs/contributing/oracle-coverage.md.`,
    limits: `The isolated local backend, 23 seeded tasks, five authored writes, the list and split functions, through both installed SDKs.`,
  },
  histories: pageLoads,
  label: ({ kind, functionName }) =>
    `real backend with ${kind} client: loads ${functionName} pages through inserts, moves, deletions, and server splits`,
  resolve: (pageLoad) => ({ pageLoad }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`convex backend pages`, plan, observe, () =>
      loadPagesThroughWrites(plan.pageLoad),
    ),
  check: forwardAssertionJudgment,
})

async function durableHistory(
  draft: { clientId: string; text: string; rank: number; payload?: Value },
  uncertain: boolean,
  operation: `insert` | `update` | `delete`,
  reached: (state: DurableReachState) => void,
) {
  const { spawn } = await import('node:child_process')
  const { mkdtemp, rm, readdir, readFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const directory = await mkdtemp(join(tmpdir(), `convex-outbox-`))
  const client = new ConvexClient(url, { unsavedChangesWarning: false })
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
  await withTestCleanup(
    async () => {
      await client.mutation(seed, { count: operation === `insert` ? 0 : 1 })
      const before = (await client.query(all, {})).map(
        ({ clientId, text, rank, payload }) => ({
          clientId,
          text,
          rank,
          payload,
        }),
      )
      // The public write contract gives one final draft for insert/update and no
      // row for delete. These expectations do not inspect restored mutations.
      const expected =
        operation === `delete` ? [] : [{ ...draft, payload: draft.payload }]
      const admitted = await run(`admit`, `durable`)
      oracleAssertion(`backend-oracle.test.ts:278:toContain`, () =>
        expect(admitted).not.toContain(`provider-call`),
      )
      // Read the actual admission record after SIGKILL, independently of the
      // replay child. A fresh key on replay cannot pass a receipt-count check.
      const records = (await readdir(directory)).filter((name) =>
        decodeURIComponent(name).startsWith(`tx:`),
      )
      oracleAssertion(`backend-oracle.test.ts:284:toHaveLength`, () =>
        expect(records).toHaveLength(1),
      )
      const durable: { idempotencyKey: unknown } = JSON.parse(
        await readFile(join(directory, records[0]!), `utf8`),
      )
      oracleAssertion(`backend-oracle.test.ts:288:toBe`, () =>
        expect(typeof durable.idempotencyKey).toBe(`string`),
      )
      {
        const oracleObserved0 = await client.query(all, {})
        oracleAssertion(`backend-oracle.test.ts:289:toEqual`, () =>
          expect(
            oracleObserved0.map(({ clientId, text, rank, payload }) => ({
              clientId,
              text,
              rank,
              payload,
            })),
          ).toEqual(before),
        )
      }
      reached(`disk-admission`)
      if (uncertain) {
        {
          const oracleObserved1 = await run(`uncertain`, `server-accepted`)
          oracleAssertion(`backend-oracle.test.ts:301:toContain`, () =>
            expect(oracleObserved1).toContain(`provider-call`),
          )
        }
        {
          const oracleObserved2 = await client.query(all, {})
          oracleAssertion(`backend-oracle.test.ts:304:toEqual`, () =>
            expect(oracleObserved2.map((row) => row.clientId)).toEqual(
              expected.map((row) => row.clientId),
            ),
          )
        }
        // Count the observed child checkpoint, not the generated intention to
        // lose a durable acknowledgement. run() waits for this exact stdout cut.
        reached(`uncertain-acknowledgement`)
      }
      {
        const oracleObserved3 = await run(`replay`, `replayed`)
        oracleAssertion(`backend-oracle.test.ts:311:toContain`, () =>
          expect(oracleObserved3).toContain(`provider-call`),
        )
      }
      const receipts = makeFunctionReference<
        `query`,
        {},
        Array<{ key: string }>
      >(`tasks:receipts`)
      {
        const oracleObserved4 = await client.query(receipts, {})
        oracleAssertion(`backend-oracle.test.ts:317:toEqual`, () =>
          expect(oracleObserved4.map(({ key }) => key)).toEqual([
            durable.idempotencyKey,
          ]),
        )
      }
      const applicationCount = makeFunctionReference<`query`, {}, number>(
        `tasks:applicationCount`,
      )
      {
        const oracleObserved5 = await client.query(applicationCount, {})
        oracleAssertion(`backend-oracle.test.ts:323:toBe`, () =>
          expect(oracleObserved5).toBe(1),
        )
      }
      {
        const oracleObserved6 = await client.query(all, {})
        oracleAssertion(`backend-oracle.test.ts:324:toEqual`, () =>
          expect(
            oracleObserved6.map(({ clientId, text, rank, payload }) => ({
              clientId,
              text,
              rank,
              payload,
            })),
          ).toEqual(expected),
        )
      }
      reached(`replay`)
      if (!uncertain) reached(`known-acknowledgement`)
      // Native payload reach is credited only after the child has compared its
      // complete public row and the parent has compared the final server row.
      if (operation !== `delete`) {
        if (typeof draft.payload === `bigint`) reached(`payload-int64`)
        else if (draft.payload instanceof ArrayBuffer) reached(`payload-bytes`)
        else if (
          typeof draft.payload === `number` &&
          (!Number.isFinite(draft.payload) || Object.is(draft.payload, -0))
        )
          reached(`payload-special-float`)
      }
    },
    () => client.close(),
    () => rm(directory, { recursive: true, force: true }),
  )
}

type DurableReachState =
  | `disk-admission`
  | `replay`
  | `known-acknowledgement`
  | `uncertain-acknowledgement`
  | `payload-int64`
  | `payload-special-float`
  | `payload-bytes`

const backendProperties = {
  insert: `convex.backend.insert`,
  update: `convex.backend.update`,
  delete: `convex.backend.delete`,
} as const
for (const operation of [`insert`, `update`, `delete`] as const) {
  const draft = (payload: fc.Arbitrary<Value | undefined>) =>
    fc.record({
      text:
        operation === `delete`
          ? fc.constant(`task 0`)
          : fc.string({ maxLength: 12 }),
      rank:
        operation === `delete`
          ? fc.constant(0)
          : fc.integer({ min: -50, max: 50 }),
      payload,
    })
  // A generated bundle constructively includes both acknowledgement cuts and
  // every claimed native payload class. Values remain generated independently
  // in each history. Six unconstrained choices could omit a required cut or
  // payload class; increasing their random budget would only reduce that risk.
  const payloads =
    operation === `delete`
      ? fc.tuple(draft(fc.constant(undefined)))
      : fc.tuple(
          draft(fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n })),
          draft(fc.constantFrom(NaN, Infinity, -Infinity, -0)),
          draft(
            fc.uint8Array({ maxLength: 12 }).map(
              (bytes) => ({ __oracleBytes: [...bytes] }),
              (recipe: unknown) => {
                if (
                  recipe === null ||
                  typeof recipe !== `object` ||
                  !(`__oracleBytes` in recipe) ||
                  !Array.isArray(recipe.__oracleBytes) ||
                  !recipe.__oracleBytes.every(
                    (byte: unknown) =>
                      typeof byte === `number` &&
                      Number.isInteger(byte) &&
                      byte >= 0 &&
                      byte <= 255,
                  )
                )
                  throw new Error(`not a byte recipe`)
                return new Uint8Array(recipe.__oracleBytes)
              },
            ),
          ),
        )
  const histories = fc.record({
    known: payloads,
    uncertain: payloads,
    uncertainFirst: fc.boolean(),
  })
  const states: Array<DurableReachState> = [
    `disk-admission`,
    `replay`,
    `known-acknowledgement`,
    `uncertain-acknowledgement`,
    ...(operation === `delete`
      ? []
      : ([`payload-int64`, `payload-special-float`, `payload-bytes`] as const)),
  ]
  // Each operation owns its replay grammar. One insert/update bundle contains
  // six process histories; three delete bundles contain six too. Fixed and
  // random campaigns therefore retain the same six-history budget per operation.

  // The existing durable helper retains the process lifecycle and independent
  // durable-state judgment. Native registration only transports its assertion result.
  async function checkDurableBundle(
    { known, uncertain, uncertainFirst }: AssertionHistory<typeof histories>,
    reach: AssertionReach,
  ) {
    for (const lostAcknowledgement of [uncertainFirst, !uncertainFirst]) {
      // The two payload tuples have different lengths, so the loop
      // reads either one as an array of its drafts.
      const drafts: ReadonlyArray<(typeof known)[number]> = lostAcknowledgement
        ? uncertain
        : known
      for (const { text, rank, payload } of drafts) {
        reach.beginHistory()
        await durableHistory(
          {
            clientId: operation === `insert` ? `offline-created` : `0`,
            text,
            rank,
            ...(operation !== `delete`
              ? {
                  payload:
                    payload !== null &&
                    typeof payload === `object` &&
                    `__oracleBytes` in payload
                      ? new Uint8Array(payload.__oracleBytes as Array<number>)
                          .buffer
                      : payload,
                }
              : {}),
          },
          lostAcknowledgement,
          operation,
          (state) => reach.reach(state),
        )
      }
    }
  }
  oracleProperty({
    id: backendProperties[operation],
    law: {
      statement: `Durable ${operation} restores once across known and uncertain acknowledgement histories.`,
      authority: `Existing Convex native-value and durable replay contract above; docs/contributing/oracle-coverage.md.`,
      limits: `The unchanged isolated local backend and bounded process histories, through both installed SDKs; no new coverage claim.`,
    },
    histories: {
      arbitrary: histories,
      runs: operation === `delete` ? 3 : 1,
      fixedSeeds: [20261022],
      measured: states,
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    check: forwardAssertionJudgment,
    // Every old bundle already constructs all its required states. Preserve
    // its small backend run budget by checking that same reach per bundle,
    // instead of adding another complete backend bundle as a native constructor.
    driver: async (plan, observe) => {
      const reached = new Set<string>()
      await recordAssertionJudgment(
        `convex durable replay`,
        plan,
        observe,
        async () => {
          await checkDurableBundle(plan.history, {
            beginHistory: () => {},
            reach: (state) => {
              reached.add(state)
              observe(`reach`, state)
            },
          })
          oracleAssertion(`required state reach`, () =>
            expect(states.filter((state) => !reached.has(state))).toEqual([]),
          )
        },
      )
    },
    timeout: 120000,
  })
}
