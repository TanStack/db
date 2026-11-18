/**
 * The installed SDK must publish the union of overlapping subset snapshots,
 * preserving whole authored payloads, while request retries leave source health
 * unchanged. Live outages follow the documented fifth-attempt threshold, and
 * retired txid evidence is accepted/exported only once a restarted run is ready.
 *
 * This is the existing snapshot owner extracted for Node and Chromium. The
 * source Map, health rule, grammar and every held/delivery/restart checkpoint
 * are shared. Controlled HTTP supplies provider framing; no live Electric
 * service, progressive delivery or native persistence claim follows from it.
 */
import fc from 'fast-check'
import { IR, createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import { electricCollectionOptions } from '../src/electric'
import { controlledHttp, deferred, headers } from './sdk-http'
import {
  atCheckpoint,
  withElectricCleanup,
  withElectricSetup,
} from './electric-oracle-lifecycle'
import { electricApplicationRows } from './cross-adapter-rows'
import { untilElectric } from './cross-adapter-http'
import { sameElectricOracleValue } from './electric-oracle-values'
import type { Item } from './sdk-http'
import type { Message } from '@electric-sql/client'

let sequence = 0
export class SnapshotComparisonFailure extends Error {
  override name = `AssertionError`
  constructor(
    readonly checkpoint: string,
    readonly actual: unknown,
    readonly expected: unknown,
  ) {
    super(
      `${checkpoint}: expected installed-SDK observation to match independent source`,
    )
  }
}
// One browser-safe comparison receives the exact same bounded plain data on
// both hosts. Own undefined fields remain distinct from absent application data.
function snapshotExpect(actual: unknown, checkpoint = `snapshot observation`) {
  const compare = (accepted: boolean, expected: unknown) => {
    if (!accepted)
      throw new SnapshotComparisonFailure(checkpoint, actual, expected)
  }
  return {
    toEqual: (expected: unknown) =>
      compare(sameElectricOracleValue(actual, expected), expected),
    toBe: (expected: unknown) => compare(Object.is(actual, expected), expected),
    toMatch: (expected: RegExp) =>
      compare(
        typeof actual === `string` && expected.test(actual),
        String(expected),
      ),
    toContain: (expected: string) =>
      compare(
        typeof actual === `string` && actual.includes(expected),
        expected,
      ),
    toHaveLength: (expected: number) =>
      compare(Array.isArray(actual) && actual.length === expected, expected),
  }
}

export type SnapshotReachState =
  | `subset-attempts-past-threshold`
  | `live-pauses-past-threshold`
  | `live-outage`
  | `live-outage-with-synchronous-throws`
  | `live-outage-led-by-throw`
  | `live-outage-crossed-by-throw`
  | `retired-evidence-after-restart`
export const snapshotStates: ReadonlyArray<SnapshotReachState> = [
  `subset-attempts-past-threshold`,
  `live-pauses-past-threshold`,
  `live-outage`,
  `live-outage-with-synchronous-throws`,
  `live-outage-led-by-throw`,
  `live-outage-crossed-by-throw`,
  `retired-evidence-after-restart`,
]

/**
 * Retried subset attempts: how many HTTP 503 responses each subset request
 * gets before its snapshot, and how many empty loads follow the three
 * ordered ones, each pausing the live request.
 */
export type SubsetRetries = {
  failures: ReadonlyArray<number>
  extraLoads: number
  /**
   * Failed live attempts after the first load, in order: an HTTP 503, or the
   * app's `fetchClient` throwing before it returns a request.
   */
  live?: ReadonlyArray<`http` | `throw`>
}

export async function checkSDKSnapshotDeliveries(
  width: number,
  name: string,
  dropRows = false,
  cleanupFailure?: Error,
  setupFault?: { primary: Error; cleanup?: Error },
  retries: SubsetRetries = { failures: [], extraLoads: 0 },
  observeState?: (state: SnapshotReachState) => void,
  receiving?: {
    completed: () => void
    cleanupFailure: (label: string | undefined, error: unknown) => void
  },
) {
  const reached = (state: SnapshotReachState) => {
    observeState?.(state)
  }
  const http = controlledHttp()
  // Live attempts the app's fetchClient still throws on, and every failed
  // live attempt the provider made, in order.
  let liveThrows = 0
  const made: Array<`http` | `throw`> = []
  const batches: Array<Array<Message<Item>>> = []
  let delivery = deferred<void>()
  const subscribe = ShapeStream.prototype.subscribe
  const spy = await withElectricSetup(() => {
    ShapeStream.prototype.subscribe = function (callback, onError) {
      return subscribe.call(
        this,
        (messages) => {
          const snapshot = messages.some(
            (message) => message.headers.control === `snapshot-end`,
          )
          batches.push(structuredClone(messages) as Array<Message<Item>>)
          const result = callback(
            dropRows && snapshot
              ? messages.filter((message) => !(`value` in message))
              : messages,
          )
          delivery.resolve()
          return result
        },
        onError,
      )
    }
    return {
      mockRestore: () => {
        ShapeStream.prototype.subscribe = subscribe
      },
    }
  }, [
    {
      label: `snapshot HTTP provider during spy setup`,
      release: () => http.close(),
    },
  ])
  const collection = await withElectricSetup(() => {
    if (setupFault !== undefined) throw setupFault.primary
    return createCollection(
      electricCollectionOptions<Item>({
        id: `sdk-snapshot-${++sequence}`,
        shapeOptions: {
          url: `http://test-url/snapshot-${sequence}`,
          params: { table: `rows` },
          // A live attempt can throw before it returns a request.
          // Only shape-log requests carry a signal. A prefetch is one too, and
          // counts (maintainer decision 2026-11-02); `made` records it.
          fetchClient: (input, init) => {
            if (liveThrows > 0 && init?.signal) {
              liveThrows--
              made.push(`throw`)
              throw new TypeError(`offline`)
            }
            return http.fetchClient(input, init)
          },
          backoffOptions: { initialDelay: 1, maxDelay: 2, multiplier: 1 },
        },
        syncMode: `on-demand`,
        startSync: true,
        getKey: (row) => row.id,
      }),
    )
  }, [
    {
      label: `snapshot HTTP provider during setup`,
      release: () => {
        http.close()
        if (setupFault?.cleanup !== undefined) throw setupFault.cleanup
      },
    },
    {
      label: `snapshot subscription spy during setup`,
      release: () => spy.mockRestore(),
    },
  ])
  const rows = () => electricApplicationRows(collection.values())
  const source = Array.from({ length: width }, (_unused, index) => ({
    id: index + 1,
    name: `${name}-${index}`,
  }))
  const expected = new Map<number, Item>()
  return withElectricCleanup(
    async () => {
      // A cold on-demand request may acquire a snapshot while the initial live
      // poll is still pending; requestSnapshot owns pausing that poll.
      await atCheckpoint(http.take(), `initial live request`)
      snapshotExpect(rows()).toEqual([])
      // After ready, five live attempts in a row that the client retries are
      // a source outage (Electric's threshold, maintainer decision
      // 2026-10-30). Only the live stream's up-to-date ends it; a subset's
      // end does not.
      let outage = false
      // HEALTH-4: the outage shows the attempt that crossed the threshold: the
      // client's error for a 503 response, which names the status and the
      // request, or the error the app's fetchClient threw.
      const sourceHealth = (label: string) => {
        snapshotExpect(collection.health.failureReason !== null, label).toBe(
          outage,
        )
        if (outage) {
          snapshotExpect(
            collection.health.failureReason?.message,
            label,
          ).toMatch(
            made[4] === `throw` ? /^offline$/ : /^HTTP Error 503 at http\S+$/,
          )
        }
      }
      const lowerBounds = [
        1,
        2,
        ...Array.from(
          { length: retries.extraLoads + 1 },
          (_, i) => width + 1 + i,
        ),
      ]
      for (const [index, lowerBound] of lowerBounds.entries()) {
        // Distinct predicates prevent request deduplication; the second response
        // overlaps prior rows and changes their payload, and the last is empty.
        if (index === 1) for (const item of source) item.name += `-changed`
        const responseRows = source
          .filter((item) => item.id >= lowerBound)
          .map((item) => ({ ...item }))
        const before = rows()
        delivery = deferred<void>()
        const loading = collection._sync.loadSubset({
          where: new IR.Func(`gte`, [
            new IR.PropRef([`id`]),
            new IR.Value(lowerBound),
          ]),
        })
        // Observe rejection immediately even while the HTTP delivery is held.
        const completion = Promise.resolve(loading).then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        )
        let request = await atCheckpoint(http.take(true), `snapshot request`)
        // The fifth distinct snapshot request confirms five live pauses.
        if (index >= 4) reached(`live-pauses-past-threshold`)
        // A subset request's attempts that the client retries belong to that
        // request, not to the source: the source node shows no problem
        // (glossary, request error), however many fail in a row.
        for (
          let attempt = 0;
          attempt < (retries.failures[index] ?? 0);
          attempt++
        ) {
          request.respond(new Response(`transient`, { status: 503 }))
          request = await atCheckpoint(
            http.take(true),
            `retried snapshot request`,
          )
          if (attempt >= 4) reached(`subset-attempts-past-threshold`)
          sourceHealth(`snapshot ${index} attempt ${attempt} source health`)
        }
        snapshotExpect(
          request.url.searchParams.get(`subset__where`),
          `snapshot ${index} request predicate`,
        ).toContain(`id`)
        snapshotExpect(rows(), `snapshot ${index} held rows`).toEqual(before)
        const data = responseRows.map((item) => ({
          key: String(item.id),
          value: { ...item, id: String(item.id) },
          headers: { operation: `insert` },
        }))
        request.respond(
          new Response(
            JSON.stringify({
              metadata: {
                xmin: `10`,
                xmax: `20`,
                xip_list: [],
                database_lsn: `10`,
                snapshot_mark: index + 1,
              },
              data,
            }),
            { headers: headers(index + 2) },
          ),
        )
        // This is subscriber delivery after the real SDK adds both boundaries,
        // not an assumption that loadSubset's Promise means rows were applied.
        await atCheckpoint(delivery.promise, `snapshot delivery`)
        const batch = batches.at(-1)!
        snapshotExpect(
          batch.slice(-2).map((message) => message.headers.control),
          `snapshot ${index} SDK boundaries`,
        ).toEqual([`snapshot-end`, `subset-end`])
        snapshotExpect(
          batch.filter((message) => `value` in message),
          `snapshot ${index} SDK row count`,
        ).toHaveLength(responseRows.length)
        for (const item of responseRows) expected.set(item.id, item)
        snapshotExpect(rows(), `snapshot ${index} applied rows`).toEqual(
          [...expected.values()].sort((a, b) => a.id - b.id),
        )
        sourceHealth(`snapshot ${index} source health`)
        const attempts = index === 0 ? (retries.live ?? []) : []
        // Leading throws hit the live request that resumes after this load.
        let next = attempts.findIndex((kind) => kind === `http`)
        if (next === -1) next = attempts.length
        liveThrows = next
        const outcome = await atCheckpoint(
          completion,
          `snapshot request completion`,
        )
        if (!outcome.ok) throw outcome.error
        if (attempts.length > 0) {
          let live = await atCheckpoint(http.take(), `resumed live request`)
          // Each 503 is followed by the throws that come before the next one.
          while (next < attempts.length) {
            live.respond(new Response(`transient`, { status: 503 }))
            made.push(`http`)
            let throws = 0
            while (attempts[++next] === `throw`) throws++
            liveThrows = throws
            live = await atCheckpoint(http.take(), `retried live request`)
          }
          // The outage follows the attempts the provider made, not the plan.
          outage = made.length >= 5
          if (outage) reached(`live-outage`)
          if (outage && made.slice(0, 5).includes(`throw`)) {
            reached(`live-outage-with-synchronous-throws`)
          }
          if (outage && made[0] === `throw`) {
            reached(`live-outage-led-by-throw`)
          }
          if (made[4] === `throw`) {
            reached(`live-outage-crossed-by-throw`)
          }
          sourceHealth(`source health after live attempts`)
        }
      }
      await atCheckpoint(http.take(), `resumed live request`)

      // EVID-2 across a restart (maintainer decision 2026-10-30): the
      // snapshots' boundary (xmin 10) shows txid 5 committed, and imported sync
      // metadata (META-1) shows txid 25, which no snapshot boundary covers
      // (xmax 20). A restarted run counts that retired
      // evidence once it is ready, because its rows are read after it.
      collection.config.sync.importSyncMeta?.({ version: 1, seenTxids: [25] })
      for (const txid of [5, 25]) {
        snapshotExpect(
          await collection.utils.awaitTxId(txid, 50),
          `txid ${txid} before the restart`,
        ).toBe(true)
      }
      await collection.cleanup()
      void collection.preload()
      const restartedLive = await atCheckpoint(
        http.take(),
        `restarted live request`,
      )
      const retired = [5, 25].map((txid) => {
        const wait = {
          settled: `pending` as `pending` | `fulfilled` | `rejected`,
        }
        collection.utils.awaitTxId(txid, 5_000).then(
          () => (wait.settled = `fulfilled`),
          () => (wait.settled = `rejected`),
        )
        return wait
      })
      for (let turn = 0; turn < 5; turn++)
        await new Promise((r) => setTimeout(r, 0))
      snapshotExpect(
        retired.map((wait) => wait.settled),
        `retired evidence before the restarted run is ready`,
      ).toEqual([`pending`, `pending`])
      // META-1 with EVID-2: exported sync metadata claims a txid only when
      // this Collection's `awaitTxId` accepts it now, and claims each accepted
      // txid evidence, so a Collection that imports it, as hydration does,
      // accepts no more. The format carries txids only, so snapshot evidence
      // (txid 5) is not exported.
      const acceptedAfterImport = async () => {
        const fresh = createCollection(
          electricCollectionOptions<Item>({
            id: `snapshot-meta-import-${++sequence}`,
            shapeOptions: {
              url: `http://test-url/unused`,
              params: { table: `rows` },
            },
            getKey: (row) => row.id,
          }),
        )
        fresh.config.sync.importSyncMeta?.(
          collection.config.sync.exportSyncMeta?.(),
        )
        return Promise.all(
          [5, 25].map((txid) =>
            // Imported evidence answers at once; 1 ms bounds a refusal.
            fresh.utils.awaitTxId(txid, 1).then(
              () => true,
              () => false,
            ),
          ),
        )
      }
      snapshotExpect(
        await acceptedAfterImport(),
        `exported evidence before the restarted run is ready`,
      ).toEqual([false, false])
      // The restarted run becomes ready on its live up-to-date, which carries
      // no evidence for either txid: only the retired evidence can fulfill
      // the waits.
      restartedLive.respond(
        new Response(
          JSON.stringify([
            { headers: { control: `up-to-date`, global_last_seen_lsn: `1` } },
          ]),
          { headers: headers(lowerBounds.length + 2) },
        ),
      )
      await untilElectric(
        () => collection.status === `ready`,
        `restarted run ready`,
      )
      for (let turn = 0; turn < 5; turn++)
        await new Promise((r) => setTimeout(r, 0))
      snapshotExpect(collection.status, `restarted status`).toBe(`ready`)
      snapshotExpect(
        retired.map((wait) => wait.settled),
        `retired evidence once the restarted run is ready`,
      ).toEqual([`fulfilled`, `fulfilled`])
      snapshotExpect(
        (await acceptedAfterImport())[1],
        `exported txid evidence once the restarted run is ready`,
      ).toBe(true)
      reached(`retired-evidence-after-restart`)
      receiving?.completed()
    },
    [
      { label: `snapshot collection`, release: () => collection.cleanup() },
      {
        label: `snapshot requests after collection cleanup`,
        release: () => snapshotExpect(http.activeCount()).toBe(0),
      },
      ...(cleanupFailure === undefined
        ? []
        : [
            {
              label: `injected snapshot cleanup`,
              release: () => {
                throw cleanupFailure
              },
            },
          ]),
      { label: `snapshot HTTP provider`, release: () => http.close() },
      { label: `snapshot subscription spy`, release: () => spy.mockRestore() },
      {
        label: `snapshot requests after provider closure`,
        release: () => snapshotExpect(http.activeCount()).toBe(0),
      },
    ],
    receiving?.cleanupFailure,
  )
}

// Grammar: width 2..4, a 0..10-character payload stem, and three ordered
// predicates id>=1, id>=2, id>=width+1. Width 2 reconstructs the smallest
// overlapping replacement plus empty final response; width 4 makes the
// overlap tail longer. Removing width loses that marginal case. Removing
// the stem loses payload variation while retaining membership. The second
// response changes every overlapping payload; removing that transition would
// miss update-through-snapshot behavior. A response containing a row below its
// requested lower bound is excluded by construction. This bounded grammar
// does not claim arbitrary predicate orders or provider snapshots. The row at
// id=2 distinguishes id>=2 from a misplaced exclusive boundary at snapshot 1.
// Retries: each subset request gets 0..7 HTTP 503 responses that the client
// retries before its snapshot, so five or more in a row are common; 0..3
// extra empty loads (id>=width+2 on) pause the live request up to six times
// between its responses. After the first load, the live stream makes 0..7
// failed attempts the client retries, each an HTTP 503 or a throw of the
// app's fetchClient before it returns a request, in any order: a throw can
// lead, cross the threshold, or follow a 503. Five or more in a row are a
// source outage, which shows the attempt that crossed the threshold
// (HEALTH-4). The expected outage follows the attempts the provider
// actually made.
// The source node shows a problem exactly when the live stream had that
// outage: a subset request's retried attempts and a live pause are not
// failures of the source, and a subset's end does not end its outage.
export const snapshotHistoryArbitrary = fc.tuple(
  fc.integer({ min: 2, max: 4 }),
  fc.string({ maxLength: 10 }),
  fc.record({
    failures: fc.array(fc.nat(7), { maxLength: 6 }),
    extraLoads: fc.nat(3),
    live: fc.array(fc.constantFrom(`http` as const, `throw` as const), {
      maxLength: 7,
    }),
  }),
)
export type SnapshotHistory = [number, string, SubsetRetries]
export const snapshotConstructionStates = new WeakMap<
  SnapshotHistory,
  ReadonlyArray<string>
>()
// Preserve width, payload and optional retries. Splice only the premises for
// the existing census: five subset retries, five pauses, and live failures
// whose first and fifth attempts throw. The middle attempts and suffix still
// vary. Every construction is a fresh tuple inside the arbitrary's bounds.
// Without this splice, seed 361651584 misses an outage crossed by a throw.
export function constructSnapshotHistory([
  width,
  name,
  retries,
]: SnapshotHistory): SnapshotHistory {
  const history: SnapshotHistory = [
    width,
    name,
    {
      failures: [
        Math.max(5, retries.failures[0] ?? 0),
        ...retries.failures.slice(1),
      ],
      extraLoads: Math.max(2, retries.extraLoads),
      live: [
        `throw`,
        ...Array.from({ length: 3 }, (_, i) => retries.live?.[i + 1] ?? `http`),
        `throw`,
        ...(retries.live?.slice(5) ?? []),
      ],
    },
  ]
  snapshotConstructionStates.set(history, snapshotStates)
  return history
}

/** Serialize only a judgment made at the shared comparison's original cut. */
export async function observeSDKSnapshotDelivery(
  history: SnapshotHistory,
  dropRows = false,
  fault?: `cleanup-only` | `mismatch-and-cleanup`,
) {
  const reached: Array<SnapshotReachState> = []
  const cleanupErrors: Array<string> = []
  const checkpoint = { completed: false }
  try {
    await checkSDKSnapshotDeliveries(
      history[0],
      history[1],
      dropRows || fault === `mismatch-and-cleanup`,
      fault
        ? new Error(`injected snapshot receiving cleanup failure`)
        : undefined,
      undefined,
      history[2],
      (state) => reached.push(state),
      {
        completed: () => {
          checkpoint.completed = true
        },
        cleanupFailure: (label, error) =>
          cleanupErrors.push(`${label}: ${describeOracleCleanupError(error)}`),
      },
    )
    return { reached, cleanupErrors }
  } catch (error) {
    if (checkpoint.completed && cleanupErrors.length)
      return { reached, cleanupErrors }
    if (!(error instanceof SnapshotComparisonFailure)) throw error
    return {
      reached,
      cleanupErrors,
      failure: {
        checkpoint: error.checkpoint,
        actual: error.actual,
        expected: error.expected,
      },
    }
  }
}
export type SDKSnapshotResult = Awaited<
  ReturnType<typeof observeSDKSnapshotDelivery>
> & {
  browserErrors?: ReadonlyArray<string>
}
