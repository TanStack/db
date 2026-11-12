import fc from 'fast-check'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import {
  isGeneratedOracleCampaign,
  oracleReplayRequested,
  oracleRuns,
} from '../../db/tests/oracle-config'
import {
  oracleProperty,
  violation as oracleViolation,
  pass,
} from '../../db/tests/oracle-property'
import {
  recordAssertionJudgment,
  rejectAt,
} from '../../db/tests/oracle-assertion-adapter'
import {
  checkExistingElectricComparison,
  existingElectricComparison,
} from './electric-property-oracle'
import {
  controlledHttp,
  deferred,
  headers,
  recordVisibilityListeners,
} from './electric-sdk-delivery-support'
import {
  atCheckpoint,
  startUnmetWaits,
  withElectricCleanup,
  withElectricSetup,
} from './electric-oracle-lifecycle'
import {
  applyRetryModel,
  createRetryModel,
  expectedRetryObservation,
} from './electric-retry-decision-model'
import {
  managedTagPersistence,
  storageTargetId,
} from './electric-persistence-fixture'
import type { Observation } from '../../db/tests/oracle-property'
import type { TestRow } from './electric-persistence-fixture'
import type { Item, Request } from './electric-sdk-delivery-support'
import type { ElectricCollectionUtils } from '../src/electric'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import type {
  RetryDecision,
  RetryModel,
  RetryObservation,
  RetryStep,
} from './electric-retry-decision-model'
import type { SyncMetadataApi } from '@tanstack/db'
import type { Message } from '@electric-sql/client'
import type * as ElectricSdkModule from '@electric-sql/client'

// Observe the real constructor boundary without changing the installed SDK's
// options, prototype, methods, or HTTP behavior. Only the rotation grammar enables
// the callback; every construction still executes the original ShapeStream.
const sdkConstruction = vi.hoisted(() => ({
  observe: undefined as (() => void) | undefined,
}))
vi.mock(`@electric-sql/client`, async (importOriginal) => {
  const original = await importOriginal<typeof ElectricSdkModule>()
  return {
    ...original,
    ShapeStream: new Proxy(original.ShapeStream, {
      construct(target, args, newTarget) {
        sdkConstruction.observe?.()
        return Reflect.construct(target, args, newTarget)
      },
    }),
  }
})

/**
 * # Does the installed Electric SDK deliver the adapter's assumed protocol?
 *
 * The Collection subset contract and the Electric adapter's tagged-row
 * contract are owned by electric-oracle.property.test.ts. The installed SDK's
 * reset framing is checked by electric-sdk-framing.test.ts. This driver
 * moves the boundary outward: a finite HTTP provider sends authored Electric
 * responses, and the installed ShapeStream owns framing, pause, snapshot,
 * abort, and silent-move delivery. The adapter must publish the union of
 * overlapping source snapshots and the tagged row's DNF visibility.
 *
 * The source Map models the union and payload replacement, while a bit set
 * models active tag conditions. Each bit represents one tag condition; each
 * group represents a disjunctive tag on the row. Neither model uses the
 * adapter's tag index or the SDK's framing logic. The history grammar has
 * three ordered subset responses or one tagged insert followed by move cycles.
 * The production driver invokes loadSubset and receives ShapeStream callbacks
 * through controlled HTTP.
 * The refinement checks compare exact public Collection rows after each SDK
 * delivery; they do not assert public order or intermediate callback cuts.
 * For an uncertified persisted on-demand restart, the Electric guide promises
 * scoped source snapshots: old durable rows remain cache-only, an empty
 * snapshot cannot readmit them, and no demand causes no unrestricted local or
 * full-shape network read. Concurrent demands share one SDK cursor, so their
 * snapshot requests must run in order. The hand-written two-launch and
 * concurrent cases in electric-sdk-delivery.test.ts illustrate those laws at
 * HTTP, local-read, public-row, and settlement boundaries; the resume-checkpoint family below models cursor persistence and the
 * next launch independently of the adapter and SDK cursor state.
 * A coordinator notification after the scoped A snapshot changes an unrelated
 * durable row. The source Map still predicts A for its active predicate. The
 * post-notification public comparison must retain A; the persistence capability
 * scan fences coordinator processing first.
 * A real node:sqlite cold-launch witness starts with an incompatible partial
 * cache and no reset marker. It must exclude that row before and after the
 * installed SDK returns an empty source snapshot for the demanded predicate.
 * A source-release grammar, documented at its property, checks that cleanup
 * removes every listener that a run's streams registered on `document`.
 *
 * These finite HTTP fixtures do not prove that a live Electric service emits
 * the authored snapshot or move frames, nor do they cover multiple row keys,
 * arbitrary retry schedules, native persistence hosts, or arbitrary provider schedules.
 * Dropped rows and reactivation controls prove the named comparisons are live.
 */

// Replay a generated law with the complete printed Replay: coordinates:
// TANSTACK_DB_ORACLE_SEED, TANSTACK_DB_ORACLE_PATH, TANSTACK_DB_ORACLE_PROPERTY,
// and TANSTACK_DB_ORACLE_UNIT. The original pre-unit example below retains
// historical coordinates; its first path index selected a construction. Use
// the migration note in docs/contributing/oracle-coverage.md before translating:
// TANSTACK_DB_ORACLE_SEED=20260917 TANSTACK_DB_ORACLE_PATH=0 \
// TANSTACK_DB_ORACLE_PROPERTY=electric.sdk-snapshot-delivery \
// pnpm --dir packages/electric-db-collection exec vitest run tests/electric-sdk-delivery-oracle.property.test.ts
// TANSTACK_DB_ELECTRIC_SDK_DELIVERY_FAULT is a fault-injection switch, not a
// replay variable. It stays readable during replays.
const replayFault = process.env.TANSTACK_DB_ELECTRIC_SDK_DELIVERY_FAULT
if (
  replayFault !== undefined &&
  replayFault !== `snapshot-rows` &&
  replayFault !== `move-in`
) {
  throw new Error(`Unknown Electric SDK delivery oracle fault`)
}

// Scaled with the run multiplier, so stress campaigns keep their budget.
const campaignTimeoutMs = oracleRuns(30_000)

// Native campaign tests retain the old campaign-local shrink predicate and
// minimum-one census. Fixed calibration tests reset this bookkeeping too, but
// do not acquire campaign reach obligations. Snapshot constructions below
// additionally enforce every required state on each generated construction.
const resumeViolations: Array<ReturnType<typeof sameViolation>> = []
beforeEach(() => {
  snapshotViolation.reset()
  membershipViolation.reset()
  rotationViolation.reset()
  releaseViolation.reset()
  for (const judgment of resumeViolations) judgment.reset()
  snapshotObservedStates.clear()
  rotationObservedStates.clear()
  releaseObservedStates.clear()
})
afterEach(({ task }) => {
  // The old census ran only after a successful campaign. Preserve an earlier
  // law/driver failure as primary, and stand aside during path replay.
  if (task.result?.errors?.length || oracleReplayRequested()) return
  if (!isGeneratedOracleCampaign(task.name)) return
  const property = task.suite?.name
  const census:
    | { expected: ReadonlyArray<string>; observed: ReadonlySet<string> }
    | undefined =
    property === `electric.sdk-snapshot-delivery`
      ? { expected: snapshotStates, observed: snapshotObservedStates }
      : property === `electric.sdk-rotation-release`
        ? { expected: rotationStates, observed: rotationObservedStates }
        : property === `electric.sdk-source-release`
          ? { expected: releaseStates, observed: releaseObservedStates }
          : undefined
  if (census !== undefined)
    expect(
      census.expected.filter((state) => !census.observed.has(state)),
      `${property}: existing campaign state census`,
    ).toEqual([])
})

function violationCheckpoint(error: unknown): string {
  if (!(error instanceof Error)) return `${typeof error}:${String(error)}`
  const message = error.message.split(`\n`)[0] ?? ``
  const checkpoint = /Electric oracle checkpoint timed out: (.+)/.exec(
    message,
  )?.[1]
  const assertion = /^(.+?): expected(?: |$)/.exec(message)?.[1]
  const sourceLine = error.stack?.match(
    /electric-sdk-delivery-oracle\.property\.test\.ts:(\d+):/,
  )?.[1]
  return `${error.name}:${checkpoint ?? assertion ?? sourceLine ?? message}`
}

// A shrink candidate at another checkpoint cannot replace the first mismatch.
// The generated parameters reconstruct the finite HTTP history for its report.
function sameViolation() {
  let original: { checkpoint: string; history: string } | undefined
  return {
    reset: () => {
      original = undefined
    },
    check: async (history: unknown, run: () => Promise<void>) => {
      try {
        await run()
      } catch (error) {
        const checkpoint = violationCheckpoint(error)
        original ??= { checkpoint, history: JSON.stringify(history) }
        if (checkpoint !== original.checkpoint) return
        throw error
      }
    },
    report: (error: unknown): unknown => {
      if (original !== undefined && error instanceof Error) {
        error.message += `\nOriginal violation: ${original.checkpoint}; history: ${original.history}`
      }
      return error
    },
  }
}

async function retainSdkViolation(
  judgment: ReturnType<typeof sameViolation>,
  history: unknown,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await judgment.check(history, run)
  } catch (error) {
    throw judgment.report(error)
  }
}

let sequence = 0

function resetResumeMetadata(): SyncMetadataApi<string | number> {
  const stored = new Map<string, unknown>([
    [`electric:resume`, { kind: `reset`, updatedAt: 1 }],
  ])
  return {
    persistence: null,
    row: { get: () => undefined, set: () => {}, delete: () => {} },
    collection: {
      get: (key) => stored.get(key),
      set: (key, value) => {
        stored.set(key, value)
      },
      delete: (key) => {
        stored.delete(key)
      },
      list: (prefix) =>
        Array.from(stored, ([key, value]) => ({ key, value })).filter(
          ({ key }) => !prefix || key.startsWith(prefix),
        ),
    },
  }
}

type SnapshotReachState =
  | `subset-attempts-past-threshold`
  | `live-pauses-past-threshold`
  | `live-outage`
  | `live-outage-with-synchronous-throws`
  | `live-outage-led-by-throw`
  | `live-outage-crossed-by-throw`
  | `retired-evidence-after-restart`
const snapshotStates: ReadonlyArray<SnapshotReachState> = [
  `subset-attempts-past-threshold`,
  `live-pauses-past-threshold`,
  `live-outage`,
  `live-outage-with-synchronous-throws`,
  `live-outage-led-by-throw`,
  `live-outage-crossed-by-throw`,
  `retired-evidence-after-restart`,
]
const snapshotObservedStates = new Set<SnapshotReachState>()

/**
 * Retried subset attempts: how many HTTP 503 responses each subset request
 * gets before its snapshot, and how many empty loads follow the three
 * ordered ones, each pausing the live request.
 */
type SubsetRetries = {
  failures: ReadonlyArray<number>
  extraLoads: number
  /**
   * Failed live attempts after the first load, in order: an HTTP 503, or the
   * app's `fetchClient` throwing before it returns a request.
   */
  live?: ReadonlyArray<`http` | `throw`>
}

async function checkSnapshots(
  width: number,
  name: string,
  dropRows = false,
  cleanupFailure?: Error,
  setupFault?: { primary: Error; cleanup?: Error },
  retries: SubsetRetries = { failures: [], extraLoads: 0 },
  observeState?: (state: SnapshotReachState) => void,
) {
  const reached = (state: SnapshotReachState) => {
    snapshotObservedStates.add(state)
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
  const spy = await withElectricSetup(
    () =>
      vi.spyOn(ShapeStream.prototype, `subscribe`).mockImplementation(function (
        this: ShapeStream,
        callback,
        onError,
      ) {
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
      }),
    [
      {
        label: `snapshot HTTP provider during spy setup`,
        release: () => http.close(),
      },
    ],
  )
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
  const rows = () =>
    collection.toArray
      .map(({ id, name: value }) => ({ id, name: value }))
      .sort((a, b) => a.id - b.id)
  const source = Array.from({ length: width }, (_unused, index) => ({
    id: index + 1,
    name: `${name}-${index}`,
  }))
  const expected = new Map<number, Item>()
  return withElectricCleanup(async () => {
    // A cold on-demand request may acquire a snapshot while the initial live
    // poll is still pending; requestSnapshot owns pausing that poll.
    await atCheckpoint(http.take(), `initial live request`)
    expect(rows()).toEqual([])
    // After ready, five live attempts in a row that the client retries are
    // a source outage (Electric's threshold, maintainer decision
    // 2026-10-30). Only the live stream's up-to-date ends it; a subset's
    // end does not.
    let outage = false
    // HEALTH-4: the outage shows the attempt that crossed the threshold: the
    // client's error for a 503 response, which names the status and the
    // request, or the error the app's fetchClient threw.
    const sourceHealth = (label: string) => {
      expect(collection.health.failureReason !== null, label).toBe(outage)
      if (outage) {
        expect(collection.health.failureReason?.message, label).toMatch(
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
      expect(
        request.url.searchParams.get(`subset__where`),
        `snapshot ${index} request predicate`,
      ).toContain(`id`)
      expect(rows(), `snapshot ${index} held rows`).toEqual(before)
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
      expect(
        batch.slice(-2).map((message) => message.headers.control),
        `snapshot ${index} SDK boundaries`,
      ).toEqual([`snapshot-end`, `subset-end`])
      expect(
        batch.filter((message) => `value` in message),
        `snapshot ${index} SDK row count`,
      ).toHaveLength(responseRows.length)
      for (const item of responseRows) expected.set(item.id, item)
      expect(rows(), `snapshot ${index} applied rows`).toEqual(
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
      expect(
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
    expect(
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
    expect(
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
    await vi.waitFor(() => expect(collection.status).toBe(`ready`))
    for (let turn = 0; turn < 5; turn++)
      await new Promise((r) => setTimeout(r, 0))
    expect(collection.status, `restarted status`).toBe(`ready`)
    expect(
      retired.map((wait) => wait.settled),
      `retired evidence once the restarted run is ready`,
    ).toEqual([`fulfilled`, `fulfilled`])
    expect(
      (await acceptedAfterImport())[1],
      `exported txid evidence once the restarted run is ready`,
    ).toBe(true)
    reached(`retired-evidence-after-restart`)
  }, [
    { label: `snapshot collection`, release: () => collection.cleanup() },
    {
      label: `snapshot requests after collection cleanup`,
      release: () => expect(http.activeCount()).toBe(0),
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
      release: () => expect(http.activeCount()).toBe(0),
    },
  ])
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
const snapshotViolation = sameViolation()
const snapshotHistoryArbitrary = fc.tuple(
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
type SnapshotHistory = [number, string, SubsetRetries]
const snapshotConstructionStates = new WeakMap<
  SnapshotHistory,
  ReadonlyArray<string>
>()
const snapshotReachedByHistory = new WeakMap<
  SnapshotHistory,
  Set<SnapshotReachState>
>()

// Preserve width, payload and optional retries. Splice only the premises for
// the existing census: five subset retries, five pauses, and live failures
// whose first and fifth attempts throw. The middle attempts and suffix still
// vary. Every construction is a fresh tuple inside the arbitrary's bounds.
// Without this splice, seed 361651584 misses an outage crossed by a throw.
function constructSnapshotHistory([
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

const snapshotComparison = existingElectricComparison(
  `electric.sdk-snapshot-delivery`,
  (history: SnapshotHistory) => {
    const [width, name, retries] = history
    return retainSdkViolation(snapshotViolation, { width, name, retries }, () =>
      checkSnapshots(
        width,
        name,
        replayFault === `snapshot-rows`,
        undefined,
        undefined,
        retries,
        (state) => snapshotReachedByHistory.get(history)?.add(state),
      ),
    )
  },
)

// The pinned framework checks seed-derived constructions. This check also
// enforces the same obligations for fresh constructions in generated runs.
// Product mismatches remain primary; missing reach cannot replace their law.
function checkSnapshotConstruction(
  plan: { history: SnapshotHistory },
  trace: ReadonlyArray<Observation>,
  judgment: ReturnType<typeof snapshotComparison.model>,
) {
  if (judgment.kind !== `pass`) return judgment
  const reached = new Set(
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
  )
  const missing = (snapshotConstructionStates.get(plan.history) ?? []).filter(
    (state) => !reached.has(state),
  )
  return missing.length
    ? oracleViolation(
        `constructed states`,
        `constructed history did not enter ${missing.join(`, `)}`,
        `constructed reach`,
      )
    : pass
}

oracleProperty({
  id: `electric.sdk-snapshot-delivery`,
  law: {
    statement: `Installed-SDK snapshot deliveries agree with the independent overlapping source.`,
    authority: `The snapshot-delivery contract and independent source/health judgments stated beside checkSnapshots.`,
    limits: `The unchanged finite HTTP, overlap, retry, and outage grammar over the installed SDK; no live Electric-service or native-host claim.`,
  },
  owns: [`src/electric.ts#electricCollectionOptions`],
  histories: {
    arbitrary: snapshotHistoryArbitrary,
    states: snapshotStates,
    constructed: [
      {
        name: `subset retries, live pauses, throw-led and throw-crossed outage, restart`,
        enters: snapshotStates,
        build: constructSnapshotHistory,
      },
    ],
    runs: 40,
    fixedSeeds: [20260917],
  },
  ...snapshotComparison,
  driver: async (plan, observe) => {
    const reached = new Set<SnapshotReachState>()
    snapshotReachedByHistory.set(plan.history, reached)
    await snapshotComparison.driver(plan, observe)
    for (const state of reached) observe(`reach`, state)
  },
  check: checkSnapshotConstruction,
  calibrations: snapshotStates.map((state) => ({
    name: `omits constructed ${state}`,
    law: `constructed reach`,
    corrupt: (
      trace: ReadonlyArray<Observation>,
      plan: { history: SnapshotHistory },
    ) =>
      snapshotConstructionStates.has(plan.history)
        ? trace.filter(
            ({ checkpoint, value }) =>
              checkpoint !== `reach` || value !== state,
          )
        : undefined,
  })),
  timeout: campaignTimeoutMs,
})

/** Whether a calibration's old Vitest matchers accept a rejection. */
function matches(assertions: () => void): boolean {
  try {
    assertions()
    return true
  } catch {
    return false
  }
}
const asError = (failure: unknown): Error =>
  failure instanceof Error ? failure : new Error(String(failure))
/** A rejection that the old matchers did not accept stays a driver error: a
 * new, unmarked error, so no comparison checkpoint inside it counts. */
const unaccepted = (mutant: string, failure: unknown): Error =>
  new Error(
    `${mutant} failed in a way that its calibration does not accept: ${String(failure)}`,
  )
const rejectionOf = (run: Promise<unknown>): Promise<unknown> =>
  run.then(
    () => undefined,
    (error: unknown) => error ?? new Error(String(error)),
  )

// The snapshot calibrations below corrupt exactly the two-row `payload`
// history with no retries, which the generated grammar cannot take back (it
// always draws live attempts), so it runs as its own enumerated case through
// the same checkSnapshots driver and comparison.
type SnapshotCalibrationPlan = { history: { width: number; name: string } }
const SNAPSHOT_FIXED_LAW = `electric.sdk-snapshot-delivery-fixed`
oracleProperty({
  id: `electric.sdk-snapshot-delivery-fixed`,
  law: {
    statement: `Installed-SDK snapshot deliveries agree with the independent overlapping source.`,
    authority: `The snapshot-delivery contract and independent source/health judgments stated beside checkSnapshots.`,
    limits: `The two-row payload history without retries, which the snapshot calibrations corrupt; it runs through the same driver as electric.sdk-snapshot-delivery.`,
  },
  owns: [`src/electric.ts#electricCollectionOptions`],
  histories: [{ width: 2, name: `payload` }],
  label: ({ width, name }) => `${width} rows named ${name}, no retries`,
  ...existingElectricComparison(
    SNAPSHOT_FIXED_LAW,
    ({ width, name }: { width: number; name: string }) =>
      checkSnapshots(width, name),
  ),
  check: checkExistingElectricComparison,
  calibrations: [
    {
      name: `detects dropped snapshot rows`,
      law: SNAPSHOT_FIXED_LAW,
      driver: (plan: SnapshotCalibrationPlan, observe) =>
        recordAssertionJudgment(SNAPSHOT_FIXED_LAW, plan, observe, async () => {
          const { width, name } = plan.history
          const failure = await rejectionOf(checkSnapshots(width, name, true))
          if (failure === undefined) return
          // Exactly the old matcher.
          if (
            matches(() =>
              expect(failure).toMatchObject({
                name: `AssertionError`,
                message: expect.stringContaining(`snapshot 0 applied rows`),
              }),
            )
          )
            rejectAt(`dropped snapshot rows`, asError(failure))
          throw unaccepted(`the dropped-rows mutant`, failure)
        }),
    },
    {
      name: `retains the snapshot law and checkpoint when cleanup also fails`,
      law: SNAPSHOT_FIXED_LAW,
      driver: (plan: SnapshotCalibrationPlan, observe) =>
        recordAssertionJudgment(SNAPSHOT_FIXED_LAW, plan, observe, async () => {
          const { width, name } = plan.history
          const cleanupFailure = new Error(`injected cleanup failure`)
          const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
          const subscribe = ShapeStream.prototype.subscribe
          snapshotViolation.reset()
          try {
            let primary: unknown
            try {
              await snapshotViolation.check({ width, name }, () =>
                checkSnapshots(width, name, true, cleanupFailure),
              )
            } catch (error) {
              primary = snapshotViolation.report(error)
            }
            if (primary === undefined) return
            // Exactly the old matchers: the primary law and checkpoint survive,
            // the cleanup failure is reported once, and the SDK is restored.
            if (
              matches(() => {
                expect(primary).toMatchObject({
                  name: `AssertionError`,
                  message: expect.stringContaining(`snapshot 0 applied rows`),
                })
                expect((primary as Error).message).toContain(
                  `Original violation: AssertionError:snapshot 0 applied rows`,
                )
                expect(warning.mock.calls).toEqual([
                  [
                    `Electric oracle cleanup failed after a primary error: injected snapshot cleanup`,
                    cleanupFailure,
                  ],
                ])
                expect(ShapeStream.prototype.subscribe).toBe(subscribe)
              })
            )
              rejectAt(`snapshot cleanup failure`, asError(primary))
            throw unaccepted(`the cleanup-failure mutant`, primary)
          } finally {
            warning.mockRestore()
          }
        }),
    },
    {
      name: `restores the SDK setup resources after construction fails`,
      law: SNAPSHOT_FIXED_LAW,
      driver: (plan: SnapshotCalibrationPlan, observe) =>
        recordAssertionJudgment(SNAPSHOT_FIXED_LAW, plan, observe, async () => {
          const { width, name } = plan.history
          const primary = new Error(`collection construction failed`)
          const secondary = new Error(`provider release failed`)
          const subscribe = ShapeStream.prototype.subscribe
          const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
          try {
            const failure = await rejectionOf(
              checkSnapshots(width, name, false, undefined, {
                primary,
                cleanup: secondary,
              }),
            )
            if (failure === undefined) return
            // Exactly the old matchers: the construction failure stays primary,
            // the release failure is reported, and the SDK is restored.
            if (
              matches(() => {
                expect(failure).toBe(primary)
                expect(warning.mock.calls).toEqual([
                  [
                    `Electric oracle cleanup failed after a primary error: snapshot HTTP provider during setup`,
                    secondary,
                  ],
                ])
                expect(ShapeStream.prototype.subscribe).toBe(subscribe)
              })
            )
              rejectAt(`setup failure cleanup`, asError(failure))
            throw unaccepted(`the setup-failure mutant`, failure)
          } finally {
            warning.mockRestore()
          }
        }),
    },
  ],
  timeout: campaignTimeoutMs,
})

async function checkMembership(
  leftWidth: number,
  rightWidth: number,
  cycles: number,
  dropMoveIn = false,
) {
  const http = controlledHttp()
  let delivery = deferred<void>()
  const subscribe = ShapeStream.prototype.subscribe
  const spy = await withElectricSetup(
    () =>
      vi.spyOn(ShapeStream.prototype, `subscribe`).mockImplementation(function (
        this: ShapeStream,
        callback,
        onError,
      ) {
        return subscribe.call(
          this,
          (messages) => {
            const result = callback(
              dropMoveIn
                ? messages.filter(
                    (message) => message.headers.event !== `move-in`,
                  )
                : messages,
            )
            delivery.resolve()
            return result
          },
          onError,
        )
      }),
    [
      {
        label: `membership HTTP provider during spy setup`,
        release: () => http.close(),
      },
    ],
  )
  const collection = await withElectricSetup(
    () =>
      createCollection(
        electricCollectionOptions<Item>({
          id: `sdk-membership-${++sequence}`,
          shapeOptions: {
            url: `http://test-url/membership-${sequence}`,
            params: { table: `rows` },
            fetchClient: http.fetchClient,
          },
          startSync: true,
          getKey: (row) => row.id,
        }),
      ),
    [
      {
        label: `membership HTTP provider during setup`,
        release: () => http.close(),
      },
      {
        label: `membership subscription spy during setup`,
        release: () => spy.mockRestore(),
      },
    ],
  )
  // A fixed OR of two AND groups. The expected state is just a bit set,
  // independent of the adapter's tag indexes and mutable DNF arrays.
  const width = leftWidth + rightWidth
  const left = (1 << leftWidth) - 1
  const right = ((1 << width) - 1) ^ left
  let active = left | right
  const groups = [left, right]
  const hashes = Array.from({ length: width }, (_unused, pos) => `hash_${pos}`)
  let offset = 0
  async function send(message: unknown, label: string) {
    delivery = deferred<void>()
    const request = await atCheckpoint(http.take(), `membership request`)
    request.respond(
      new Response(
        JSON.stringify([
          message,
          {
            headers: {
              control: `up-to-date`,
              global_last_seen_lsn: String(++offset),
            },
          },
        ]),
        { headers: headers(offset) },
      ),
    )
    await atCheckpoint(delivery.promise, `membership delivery`)
    const visible = groups.some((group) => (active & group) === group)
    expect(
      collection.toArray.map(({ id, name }) => ({ id, name })),
      label,
    ).toEqual(visible ? [{ id: 1, name: `member` }] : [])
  }
  async function move(
    event: `move-in` | `move-out`,
    pos: number,
    label: string,
  ) {
    if (event === `move-in`) active |= 1 << pos
    else active &= ~(1 << pos)
    await send(
      { headers: { event, patterns: [{ pos, value: hashes[pos] }] } },
      label,
    )
  }
  return withElectricCleanup(async () => {
    await send(
      {
        key: `1`,
        value: { id: `1`, name: `member` },
        headers: {
          operation: `insert`,
          tags: groups.map((group) =>
            hashes
              .map((hash, pos) => (group & (1 << pos) ? hash : ``))
              .join(`/`),
          ),
          active_conditions: hashes.map(() => true),
        },
      },
      `initial membership`,
    )
    // This is the supported move-out/in/out cycle in tags.test.ts. Both
    // disjuncts retain at least one live alternative until the final deletion;
    // no move-in is used to resurrect a row whose tag index was removed.
    for (let cycle = 0; cycle < cycles; cycle++) {
      await move(`move-out`, 0, `cycle ${cycle} left inactive`)
      await move(`move-in`, 0, `cycle ${cycle} silent left reactivation`)
      await move(`move-out`, leftWidth, `cycle ${cycle} after silent move-in`)
      await move(
        `move-in`,
        leftWidth,
        `cycle ${cycle} silent right reactivation`,
      )
    }
    await move(`move-out`, 0, `one disjunct remains`)
    await move(`move-out`, leftWidth, `all disjuncts inactive`)
    await atCheckpoint(http.take(), `pending membership poll`)
  }, [
    { label: `membership collection`, release: () => collection.cleanup() },
    {
      label: `membership requests after collection cleanup`,
      release: () => expect(http.activeCount()).toBe(0),
    },
    { label: `membership HTTP provider`, release: () => http.close() },
    { label: `membership subscription spy`, release: () => spy.mockRestore() },
    {
      label: `membership requests after provider closure`,
      release: () => expect(http.activeCount()).toBe(0),
    },
  ])
}

// Grammar: two disjoint AND groups of 1..2 conditions, with 1..3 complete
// move-out/in cycles and a final two-group deactivation. The 1/1/1 witness
// reconstructs a dropped move-in at its visibility checkpoint. A width of 2
// distinguishes one condition from a conjunction. Removing either width axis
// loses that group's marginal case. Removing cycle count loses repeated
// reactivation.
// Each move-in has a preceding move-out, so the grammar excludes an unmatched
// move-in and a move for a tag absent from the inserted row. It does not claim
// row resurrection after the tag index has been removed. The first left
// move-out leaves the right group active; it distinguishes OR from a wrong
// rule that requires both groups to remain active.
const membershipViolation = sameViolation()
const membershipHistoryArbitrary = fc.tuple(
  fc.integer({ min: 1, max: 2 }),
  fc.integer({ min: 1, max: 2 }),
  fc.integer({ min: 1, max: 3 }),
)
oracleProperty({
  id: `electric.sdk-dnf-membership`,
  law: {
    statement: `DNF visibility survives installed-SDK silent move-in cycles.`,
    authority: `The independent tag-group membership contract and checkMembership comparison stated above.`,
    limits: `The unchanged disjoint two-group, one-to-three-cycle HTTP grammar; arbitrary provider frames and unmatched move-ins remain outside this owner.`,
  },
  owns: [`src/electric.ts#electricCollectionOptions`],
  histories: {
    arbitrary: membershipHistoryArbitrary,
    runs: 12,
    fixedSeeds: [20260918],
    // The dropped move-in calibration corrupts this smallest history.
    fixed: [{ name: `one left, one right, one cycle`, history: [1, 1, 1] }],
  },
  ...existingElectricComparison(
    `electric.sdk-dnf-membership`,
    ([left, right, cycles]: [number, number, number]) =>
      retainSdkViolation(membershipViolation, { left, right, cycles }, () =>
        checkMembership(left, right, cycles, replayFault === `move-in`),
      ),
  ),
  check: checkExistingElectricComparison,
  calibrations: [
    {
      name: `detects dropped move-in at its visibility checkpoint`,
      law: `electric.sdk-dnf-membership`,
      driver: (plan: { history: [number, number, number] }, observe) =>
        recordAssertionJudgment(
          `electric.sdk-dnf-membership`,
          plan,
          observe,
          async () => {
            const [left, right, cycles] = plan.history
            const failure = await rejectionOf(
              checkMembership(left, right, cycles, true),
            )
            if (failure === undefined) return
            // Exactly the old matcher.
            if (
              matches(() =>
                expect(failure).toMatchObject({
                  name: `AssertionError`,
                  message: expect.stringContaining(`after silent move-in`),
                }),
              )
            )
              rejectAt(`dropped move-in`, asError(failure))
            throw unaccepted(`the dropped move-in mutant`, failure)
          },
        ),
    },
  ],
  timeout: campaignTimeoutMs,
})

/**
 * # The retry-decision law through the installed Electric client
 *
 * The retry-decision oracle in `electric-oracle.property.test.ts` drives the
 * adapter through a controlled ShapeStream. This receiving path receives the same law
 * through the installed `@electric-sql/client`, its retry policy, and HTTP.
 * It uses the same independent model (`electric-retry-decision-model.ts`).
 *
 * The client turns three provider behaviors into the model's steps:
 *
 * - A 503 the client retries, then a complete snapshot: an error whose
 *   decision is a retry, then the first up-to-date.
 * - A response without Electric headers: an error whose decision is a retry,
 *   then the client gives up by itself, because the error is not retryable.
 * - Repeated 503 responses: an error and a retry for each one, until the
 *   client spends its budget of 50 consecutive retries and gives up by
 *   itself on the 51st error.
 *
 * The client gives up in the same continuation that receives the decision,
 * so the checkpoint after that decision already includes the give-up.
 *
 * The grammar crosses those three behaviors with the eager, on-demand
 * full-log, and progressive sync modes, and with a synchronous or an
 * asynchronous retry from `onError`. Each history starts one waiting demand
 * and, after the outcome, one later demand. A full-log demand is a subset
 * load. An eager or progressive Collection has no subset demand before its
 * first ready, so its demand is the readiness wait (`preload()`).
 *
 * At each checkpoint the receiving path compares the Collection status, each demand's
 * settlement, whether the snapshot's row is visible, and two pairs of waits
 * that no evidence satisfies, one started with the history and one started
 * at the checkpoint, with the model:
 * after the first error reaches `onError`, after an asynchronous decision,
 * after the outcome, and after the later demand. It also checks that a
 * full-log Collection requests the full log, and that a client that gave up
 * keeps no provider transport open. A rejection's cause is
 * compared only as a rejection here; the retry-decision oracle checks causes.
 */
type ClientOutcome = `retried-503` | `missing-headers` | `exhausted`
type ClientMode = `eager` | `full-log` | `progressive`

const clientRetryCells = (
  [`retried-503`, `missing-headers`, `exhausted`] as const
).flatMap((outcome) =>
  ([`eager`, `full-log`, `progressive`] as const).flatMap((mode) =>
    ([`sync-retry`, `async-retry`] as const).map(
      (decision) => [outcome, mode, decision] as const,
    ),
  ),
)

// The installed client's documented consecutive-retry budget.
const CLIENT_RETRY_BUDGET = 50

// A rejection's cause, and the readiness wait's cause, are checked by the
// controlled retry-decision oracle. Here a non-full-log demand is itself a
// readiness wait.
function clientObservation(observation: RetryObservation): RetryObservation {
  return {
    status: observation.status,
    rowVisible: observation.rowVisible,
    waits: observation.waits,
    lateWaits: observation.lateWaits,
    health: observation.health,
    demands: observation.demands.map((settlement) =>
      settlement.startsWith(`rejected`) ? `rejected:any` : settlement,
    ),
  }
}

async function runClientRetryCell(
  outcome: ClientOutcome,
  mode: ClientMode,
  decision: Extract<RetryDecision, `sync-retry` | `async-retry`>,
): Promise<void> {
  const http = controlledHttp()
  const decisions: Array<() => void> = []
  let onErrorCalls = 0
  const options = electricCollectionOptions<Item>({
    id: `sdk-retry-${outcome}-${mode}-${decision}-${++sequence}`,
    shapeOptions: {
      url: `http://test-url/retry-${sequence}`,
      params: { table: `rows` },
      fetchClient: http.fetchClient,
      backoffOptions: {
        initialDelay: 0,
        maxDelay: 0,
        multiplier: 1,
        maxRetries: 0,
      },
      onError: () => {
        onErrorCalls++
        if (decision === `sync-retry`) return {}
        return new Promise<Record<string, never>>((resolve) => {
          decisions.push(() => resolve({}))
        })
      },
    },
    syncMode:
      mode === `eager`
        ? `eager`
        : mode === `progressive`
          ? `progressive`
          : `on-demand`,
    startSync: true,
    getKey: (row) => row.id,
  })
  const metadata = resetResumeMetadata()
  const originalSync = options.sync
  const collection = createCollection({
    ...options,
    sync:
      mode === `full-log`
        ? {
            sync: (params: Parameters<typeof originalSync.sync>[0]) =>
              originalSync.sync({ ...params, metadata }),
          }
        : originalSync,
  })
  const model: RetryModel = createRetryModel(false)
  // Waits that no evidence satisfies: one pair started with the history,
  // and one started at each checkpoint, after its step.
  const waits = startUnmetWaits(collection.utils)
  const settlements: Array<`pending` | `fulfilled` | `rejected:any`> = []
  const track = (result: unknown) => {
    const slot = settlements.push(`pending`) - 1
    void Promise.resolve(result).then(
      () => {
        settlements[slot] = `fulfilled`
      },
      () => {
        settlements[slot] = `rejected:any`
      },
    )
  }
  const demand = () =>
    track(
      mode === `full-log`
        ? collection._sync.loadSubset({ limit: settlements.length + 1 })
        : collection.preload(),
    )
  const step = (next: RetryStep) => applyRetryModel(model, next, true, `e`)
  const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  const check = async (label: string) => {
    await turn()
    await turn()
    const lateWaits = startUnmetWaits(collection.utils)
    await turn()
    expect(
      clientObservation({
        status: collection.status,
        demands: [...settlements],
        rowVisible: collection.has(1),
        waits: waits(),
        lateWaits: lateWaits(),
        health:
          collection.status === `ready`
            ? collection.health.error
              ? `error`
              : `none`
            : undefined,
      }),
      `${outcome} ${mode} ${decision}: ${label}`,
    ).toEqual(clientObservation(expectedRetryObservation(model, false)))
  }
  // Answer one request with an error, and settle its decision. When the
  // client gives up after this decision, the same checkpoint shows it.
  const failOnce = async (
    response: Response,
    label: string,
    givesUp: boolean,
  ) => {
    const calls = onErrorCalls
    const request = await atCheckpoint(http.take(), `${label} HTTP`)
    // A full-log Collection asks the provider for the full log.
    if (mode === `full-log`)
      expect(request.url.searchParams.get(`log`)).toBe(`full`)
    request.respond(response)
    await vi.waitFor(() => expect(onErrorCalls).toBe(calls + 1))
    step({ kind: `error`, decision })
    if (decision === `async-retry`) {
      await check(`${label} reached onError`)
      decisions.shift()!()
      step({ kind: `decide` })
    }
    if (givesUp) step({ kind: `client-give-up` })
    await check(`${label} decided`)
  }

  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const consoleWarn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  await withElectricCleanup(async () => {
    demand()
    step({ kind: `demand` })
    if (outcome === `retried-503`) {
      await failOnce(
        new Response(`transient`, { status: 503 }),
        `first 503`,
        false,
      )
      const retry = await atCheckpoint(http.take(), `retried HTTP`)
      retry.respond(
        new Response(
          JSON.stringify([
            {
              key: `1`,
              value: { id: `1`, name: `recovered` },
              headers: { operation: `insert` },
            },
            { headers: { control: `up-to-date`, global_last_seen_lsn: `1` } },
          ]),
          { headers: headers(1) },
        ),
      )
      await vi.waitFor(() => expect(collection.status).not.toBe(`loading`))
      step({ kind: `up-to-date` })
    } else if (outcome === `missing-headers`) {
      await failOnce(new Response(`[]`, { status: 200 }), `headerless`, true)
    } else {
      // The client retries while its budget lasts, then gives up.
      for (let attempt = 1; attempt <= CLIENT_RETRY_BUDGET + 1; attempt++) {
        await failOnce(
          new Response(`transient`, { status: 503 }),
          `503 #${attempt}`,
          attempt === CLIENT_RETRY_BUDGET + 1,
        )
      }
    }
    await check(`outcome`)
    // A client that gave up keeps no provider transport open.
    if (outcome !== `retried-503`) expect(http.activeCount()).toBe(0)
    demand()
    step({ kind: `demand` })
    await check(`later demand`)
  }, [
    () => collection.cleanup(),
    () => http.close(),
    () => consoleError.mockRestore(),
    () => consoleWarn.mockRestore(),
  ])
}

oracleProperty({
  id: `electric.sdk-client-retry`,
  law: {
    statement: `The installed Electric client's retry, give-up and recovery outcomes follow the retry-decision model at every checkpoint.`,
    authority: `The retry-decision law and model in electric-retry-decision-model.ts, received through the installed client as stated above.`,
    limits: `The eighteen outcome, sync-mode and onError-decision cells above; rejection causes are compared only as rejections here.`,
  },
  owns: [`src/electric.ts#electricCollectionOptions`],
  histories: clientRetryCells,
  label: ([outcome, mode, decision]) =>
    `installed client: ${outcome} in ${mode} mode with an onError ${decision} follows the retry-decision model`,
  ...existingElectricComparison(
    `electric.sdk-client-retry`,
    ([outcome, mode, decision]: (typeof clientRetryCells)[number]) =>
      runClientRetryCell(outcome, mode, decision),
  ),
  check: checkExistingElectricComparison,
  timeout: 60_000,
})

/**
 * A managed cache claim can expire while an installed SDK snapshot request is
 * still in flight. The source model has no row for the old predicate and one
 * row for the new predicate. The old provider session loses authority before
 * cache rotation; its late HTTP response cannot publish or persist a row in
 * either generation. The SQLite persistence guide requires immediate retirement
 * of expired source callbacks. This restriction belongs to this expired session;
 * a peer with a valid claim may still use a retired generation. Each round
 * remembers its retired storage target and excludes only the late response's
 * absent key there, allowing other retained rows. The replacement session must
 * settle both demands from its own snapshots. This receives the controlled
 * provider-restart law through the installed ShapeStream and HTTP path. A
 * Map-backed adapter supplies the generation boundary; real SQLite and native
 * hosts have separate owners.
 * It also receives the stream-listener release law below for the retired
 * session. The Electric guide requires releasing its owned resources before
 * constructing the replacement ShapeStream. The independent rule is zero
 * old listeners at that constructor boundary, one replacement listener after
 * delivery, and zero after cleanup. Cache rotation may finish before disposal;
 * no zero-listener promise applies while the rotation result is held.
 *
 * Generated histories rotate one to three times in the same sync run. Each
 * retired HTTP snapshot arrives while rotation is held, just before replacement
 * snapshots, or after replacement settlement. A forwarding constructor observer
 * records listener ownership before invoking the real SDK. It does not release
 * resources or replace SDK behavior. This receiving path
 * covers sequential rotations in an on-demand run with the installed browser
 * SDK; overlapping rotations, other SDK versions, and native hosts remain separate.
 * Both retained demands must remain pending until replacement source responses
 * arrive. Promise outcomes are observed while rotation is held and again before
 * the first replacement response; final rows alone cannot establish settlement.
 */
type RetiredSnapshotCut =
  `during-rotation` | `before-snapshots` | `after-snapshots`
const rotationStates = [
  `during-rotation`,
  `before-snapshots`,
  `after-snapshots`,
  `first-session`,
  `replacement-session`,
  `demands-await-replacement`,
  `retired-target-observed`,
]
const rotationObservedStates = new Set<string>()

async function checkManagedRotation(cuts: ReadonlyArray<RetiredSnapshotCut>) {
  const listeners = recordVisibilityListeners()
  const http = controlledHttp()
  const rows = new Map<string, Map<number, Item>>([
    [`old-generation`, new Map()],
  ])
  const metadata = new Map<string, Map<string, unknown>>([
    [`old-generation`, new Map()],
  ])
  let storageId = `old-generation`
  let claimExpired = false
  let rotations = 0
  let allowRotation = deferred<void>()
  let rotationRequested = deferred<void>()
  let replacementConstructed = deferred<void>()
  const beforeConstruction: Array<number> = []
  sdkConstruction.observe = () => {
    beforeConstruction.push(listeners.live())
    replacementConstructed.resolve()
  }
  const claimId = `managed-sdk-claim`
  const adapter: PersistenceAdapter = {
    claimCacheGeneration: () =>
      Promise.resolve({
        storageCollectionId: storageId,
        claimId,
        expiresAtMs: Date.now() + 10_000,
      }),
    renewCacheGenerationClaim: () =>
      Promise.resolve(claimExpired ? undefined : Date.now() + 10_000),
    rotateCacheGeneration: (
      _collectionId,
      _claimId,
      resetMetadata,
      expectedStorageId,
    ) => {
      expect(expectedStorageId).toBe(storageId)
      rotations++
      rotationRequested.resolve()
      storageId = `generation-${rotations}`
      rows.set(storageId, new Map())
      metadata.set(
        storageId,
        new Map(
          resetMetadata ? [[resetMetadata.key, resetMetadata.value]] : [],
        ),
      )
      claimExpired = false
      return allowRotation.promise.then(() => ({
        storageCollectionId: storageId,
        claimId,
        expiresAtMs: Date.now() + 10_000,
      }))
    },
    releaseCacheGenerationClaim: async () => {},
    loadSubset: (id) =>
      Promise.resolve(
        Array.from(rows.get(storageTargetId(id)) ?? [], ([key, value]) => ({
          key,
          value,
        })),
      ),
    loadResumeSnapshot: (id) =>
      Promise.resolve({
        rows: Array.from(
          rows.get(storageTargetId(id)) ?? [],
          ([key, value]) => ({
            key,
            value,
          }),
        ),
        keySet: {
          status:
            storageTargetId(id) === `old-generation`
              ? `consistent`
              : `incompatible`,
        },
        collectionMetadata: Array.from(
          metadata.get(storageTargetId(id)) ?? [],
          ([key, value]) => ({ key, value }),
        ),
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: (id, tx) => {
      expect(tx.cacheGenerationClaimId).toBe(claimId)
      const generationRows = rows.get(storageTargetId(id))!
      if (tx.truncate) generationRows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          generationRows.delete(Number(mutation.key))
        } else {
          generationRows.set(Number(mutation.key), mutation.value as Item)
        }
      }
      const generationMetadata = metadata.get(storageTargetId(id))!
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) generationMetadata.delete(mutation.key)
        else generationMetadata.set(mutation.key, mutation.value)
      }
      return Promise.resolve()
    },
    ensureIndex: async () => {},
  }
  const electric = electricCollectionOptions<Item>({
    id: `sdk-managed-restart-${++sequence}`,
    shapeOptions: {
      url: `http://test-url/managed-restart-${sequence}`,
      params: { table: `rows` },
      // A provider can finish an HTTP request after stream retirement.
      fetchClient: (input, init) =>
        http.fetchClient(input, { ...init, signal: undefined }),
    },
    syncMode: `on-demand`,
    startSync: true,
    getKey: (row) => row.id,
  })
  const collection = await withElectricSetup(
    () =>
      createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          ElectricCollectionUtils<Item>
        >({
          ...electric,
          persistence: { adapter },
        }),
      ),
    [
      () => allowRotation.resolve(),
      () => http.close(),
      () => listeners.restore(),
      () => {
        sdkConstruction.observe = undefined
      },
    ],
  )
  const demand = (id: number) => ({
    where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(id)]),
  })
  const respond = (request: Request, row: Item | undefined, offset: number) =>
    request.respond(
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: offset,
          },
          data: row
            ? [
                {
                  key: String(row.id),
                  value: { ...row, id: String(row.id) },
                  headers: { operation: `insert` },
                },
              ]
            : [],
        }),
        { headers: headers(offset) },
      ),
    )

  await withElectricCleanup(async () => {
    for (const [round, retiredSnapshotCut] of cuts.entries()) {
      allowRotation = deferred<void>()
      rotationRequested = deferred<void>()
      const oldId = round * 2 + 1
      const newId = oldId + 1
      const retiredStorageId = storageId
      const oldOptions = demand(oldId)
      const newOptions = demand(newId)
      const settlements: Array<`pending` | `fulfilled` | `rejected`> = []
      const loadDemand = (options: ReturnType<typeof demand>) => {
        const slot = settlements.push(`pending`) - 1
        const result = Promise.resolve(collection._sync.loadSubset(options))
        void result.then(
          () => {
            settlements[slot] = `fulfilled`
          },
          () => {
            settlements[slot] = `rejected`
          },
        )
        return result
      }
      const assertDemandsPending = async (checkpoint: string) => {
        // Requests are still held. Yield one task so nested promise reactions
        // report an early settlement before comparing their public outcomes.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect([...settlements], checkpoint).toEqual([`pending`, `pending`])
      }
      await atCheckpoint(http.take(), `old managed stream`)
      const oldDemand = loadDemand(oldOptions)
      const oldSnapshot = await atCheckpoint(
        http.take(true),
        `old managed subset snapshot`,
      )

      replacementConstructed = deferred<void>()
      claimExpired = true
      const newDemand = loadDemand(newOptions)
      await atCheckpoint(rotationRequested.promise, `managed rotation entry`)
      expect(rotations).toBe(round + 1)
      expect(storageId).toBe(`generation-${round + 1}`)
      expect([...beforeConstruction]).toHaveLength(round + 1)
      expect(listeners.registered()).toBe(round + 1)

      const deliverRetiredSnapshot = async () => {
        const retiredMetadata = new Map(metadata.get(retiredStorageId))
        const currentMetadata = new Map(metadata.get(storageId))
        respond(oldSnapshot, { id: oldId, name: `late-old` }, round * 4 + 1)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(collection.get(oldId)).toBeUndefined()
        expect(
          rows.get(retiredStorageId)!.has(oldId),
          `retired response in retired cache`,
        ).toBe(false)
        expect(
          metadata.get(retiredStorageId),
          `retired response metadata`,
        ).toEqual(retiredMetadata)
        expect(metadata.get(storageId), `current generation metadata`).toEqual(
          currentMetadata,
        )
        rotationObservedStates.add(`retired-target-observed`)
      }
      if (retiredSnapshotCut === `during-rotation`)
        await deliverRetiredSnapshot()
      await assertDemandsPending(`demands while cache rotation is held`)
      allowRotation.resolve()
      await atCheckpoint(
        replacementConstructed.promise,
        `replacement construction`,
      )
      expect([...beforeConstruction]).toHaveLength(round + 2)
      expect(
        beforeConstruction[round + 1],
        `retired listeners before replacement construction`,
      ).toBe(0)
      rotationObservedStates.add(retiredSnapshotCut)
      rotationObservedStates.add(
        round === 0 ? `first-session` : `replacement-session`,
      )
      if (retiredSnapshotCut === `before-snapshots`)
        await deliverRetiredSnapshot()
      await assertDemandsPending(`demands before replacement source responses`)
      rotationObservedStates.add(`demands-await-replacement`)

      // The replacement SDK first reacquires the old demand, then the new one.
      // Empty snapshots for oldId distinguish source authority from the old
      // request's late row; the newId snapshot establishes the fresh row.
      respond(
        await atCheckpoint(http.take(true), `first replacement snapshot`),
        undefined,
        round * 4 + 2,
      )
      respond(
        await atCheckpoint(http.take(true), `replayed old demand`),
        undefined,
        round * 4 + 3,
      )
      respond(
        await atCheckpoint(http.take(true), `new demand snapshot`),
        { id: newId, name: `fresh` },
        round * 4 + 4,
      )
      await atCheckpoint(
        Promise.all([oldDemand, newDemand]),
        `replacement demand settlement`,
      )
      expect([...settlements]).toEqual([`fulfilled`, `fulfilled`])
      expect(collection.get(newId)?.name).toBe(`fresh`)

      if (retiredSnapshotCut === `after-snapshots`)
        await deliverRetiredSnapshot()
      expect(collection.get(oldId)).toBeUndefined()
      expect(collection.get(newId)?.name).toBe(`fresh`)
      expect([...rows.get(storageId)!.keys()]).toEqual([newId])
      expect(
        rows.get(retiredStorageId)!.has(oldId),
        `retired response in retired cache after replacement`,
      ).toBe(false)
      expect(listeners.registered()).toBe(round + 2)
      expect(listeners.live(), `live listeners after rotation`).toBe(1)
      // End these demands before the next round; its fresh IDs ensure an old
      // source snapshot is really in flight when the next claim expires.
      collection._sync.unloadSubset(oldOptions)
      collection._sync.unloadSubset(newOptions)
    }
  }, [
    () => allowRotation.resolve(),
    () => collection.cleanup(),
    () => http.close(),
    () => expect(listeners.live(), `live listeners after cleanup`).toBe(0),
    () => listeners.restore(),
    () => {
      sdkConstruction.observe = undefined
    },
  ])
}

const rotationViolation = sameViolation()
oracleProperty({
  id: `electric.sdk-rotation-release`,
  law: {
    statement: `Retired SDK resources are released before constructing a replacement.`,
    authority: `The Electric resource-retirement and persisted-cache rotation contracts stated beside checkManagedRotation.`,
    limits: `The unchanged one-to-three sequential rotations through installed-SDK HTTP delivery and a Map-backed persistence adapter; no overlapping rotations or native-host claim.`,
  },
  owns: [`src/electric.ts#electricCollectionOptions`],
  histories: {
    arbitrary: fc.array(
      fc.constantFrom<RetiredSnapshotCut>(
        `during-rotation`,
        `before-snapshots`,
        `after-snapshots`,
      ),
      { minLength: 1, maxLength: 3 },
    ),
    runs: 40,
    fixedSeeds: [20261026],
    fixed: [
      {
        name: `discards an old SDK snapshot after managed cache rotation`,
        history: [`after-snapshots`],
      },
    ],
  },
  ...existingElectricComparison(
    `electric.sdk-rotation-release`,
    (cuts: ReadonlyArray<RetiredSnapshotCut>) =>
      retainSdkViolation(rotationViolation, cuts, () =>
        checkManagedRotation(cuts),
      ),
  ),
  check: checkExistingElectricComparison,
  timeout: campaignTimeoutMs,
})

/**
 * # Cleanup releases the installed client's stream listeners
 *
 * Cleanup ends a sync run and releases its adapter-owned resources
 * (`CleanupFn` in `packages/db/src/types.ts`, and "Sync Implementation" in the
 * collection options creator guide). The Electric adapter constructs one
 * ShapeStream per provider session. The installed client registers a
 * `visibilitychange` listener on `document` for each stream, so that the
 * stream pauses while the page is hidden. That listener keeps the stream
 * reachable until the client releases it. The law: after cleanup, `document`
 * holds no `visibilitychange` listener from a stream of the cleaned-up run,
 * whatever state the source reached. While a run is active, it holds at most
 * the listener of its one stream.
 *
 * The model is the number of active sync runs, 0 or 1. It reads no adapter or
 * client state. A run is active from its start until its cleanup, and each run
 * constructs one stream, so the expected number of live listeners is at most
 * the number of active runs, and exactly 0 once no run is active. The model
 * does not predict when an active stream releases its listener, because the
 * client may release it early, for example when its signal aborts.
 *
 * The history grammar has a sync mode and one to three sync runs. The first
 * run starts with the Collection; each later run is a restart of the
 * cleaned-up Collection through `preload()`. In each run the provider answers
 * zero to three requests: a row-only batch, a row with an up-to-date, an HTTP
 * 409 reset, or a 503 that `onError` retries. Rows and resets may remain
 * incomplete when cleanup starts; neither needs a later up-to-date first.
 * The run then stays open, gives up on one more 503, aborts the external
 * signal, or receives a 503 whose asynchronous `onError` decision stays
 * pending through cleanup. That held decision can later retry or give up;
 * neither future outcome may postpone the run's resource release. Held
 * decisions settle only in fixture teardown, so later runs can start while
 * an old decision is still pending. Cleanup ends the run. The signal stays
 * aborted, so a run that starts after an abort
 * starts with an aborted signal and sends no request. The provider answers
 * only a request the client sent. The grammar does not answer a request after
 * a give-up or an abort, because the client sends none.
 *
 * The production driver uses a real Collection, the Electric adapter, the
 * installed ShapeStream, and controlled HTTP. The recorder wraps
 * `document.addEventListener` and `document.removeEventListener` and counts
 * the `visibilitychange` listeners still registered. The comparison runs after
 * each ordinary provider answer, give-up, abort, and cleanup. Ordinary answers
 * wait for the next request; a held decision instead positively observes
 * `onError` entry before cleanup, without awaiting that decision. The model
 * still requires zero listeners after completed cleanup. The active upper
 * bound and one-registration-per-run calibration describe this installed SDK
 * and the driver's one-stream topology, rather than a universal SDK policy.
 *
 * Limits: the receiving path observes the browser listener in jsdom. Client versions
 * that observe React Native's AppState instead register through a runtime
 * adapter, which this receiving path does not install. A live Electric service and
 * snapshot requests are outside this receiving path. The managed cache rotation case
 * above replaces a provider session within one run; it receives the same law
 * for the retired session.
 */
type ReleaseRun = {
  answers: Array<`row` | `up-to-date` | `reset` | `retry`>
  end: `open` | `give-up` | `abort` | `deciding-retry` | `deciding-give-up`
}
type ReleaseHistory = {
  mode: `eager` | `on-demand` | `progressive`
  runs: Array<ReleaseRun>
}
type ReleaseState =
  | `cleanup-while-loading`
  | `cleanup-after-ready`
  | `cleanup-after-give-up`
  | `cleanup-after-abort`
  | `cleanup-of-restarted-run`
  | `cleanup-after-partial-delivery`
  | `cleanup-during-reset`
  | `cleanup-during-retry-decision`

const releaseStates: ReadonlyArray<ReleaseState> = [
  `cleanup-while-loading`,
  `cleanup-after-ready`,
  `cleanup-after-give-up`,
  `cleanup-after-abort`,
  `cleanup-of-restarted-run`,
  `cleanup-after-partial-delivery`,
  `cleanup-during-reset`,
  `cleanup-during-retry-decision`,
]
const releaseObservedStates = new Set<ReleaseState>()

async function checkSourceRelease(history: ReleaseHistory): Promise<void> {
  const listeners = recordVisibilityListeners()
  const http = controlledHttp()
  const external = new AbortController()
  let retries = true
  let onErrorCalls = 0
  let heldDecision:
    ReturnType<typeof deferred<Record<string, never> | void>> | undefined
  const settleDecisions: Array<() => void> = []
  const collection = createCollection(
    electricCollectionOptions<Item>({
      id: `sdk-release-${++sequence}`,
      shapeOptions: {
        url: `http://test-url/release-${sequence}`,
        params: { table: `rows` },
        fetchClient: http.fetchClient,
        signal: external.signal,
        backoffOptions: {
          initialDelay: 0,
          maxDelay: 0,
          multiplier: 1,
          maxRetries: 0,
        },
        onError: () => {
          onErrorCalls++
          return heldDecision?.promise ?? (retries ? {} : undefined)
        },
      },
      syncMode: history.mode,
      startSync: true,
      getKey: (row) => row.id,
    }),
  )

  // The model is `activeRuns`. `sending` chooses legal provider steps.
  // `pendingAnswers` records authored rows/resets since the latest up-to-date,
  // not adapter internals; readiness reach uses public Collection status.
  let activeRuns = 1
  let runsStarted = 1
  let sending = true
  let offset = 0
  const pendingAnswers = new Set<`row` | `reset`>()

  const check = (label: string) =>
    expect(listeners.live(), `${label}: live listeners`).toBeLessThanOrEqual(
      activeRuns,
    )
  const next = (label: string) =>
    atCheckpoint(http.take(), `${label} HTTP request`)

  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  const consoleWarn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  await withElectricCleanup(async () => {
    for (const [index, run] of history.runs.entries()) {
      if (index > 0) {
        void collection.preload().catch(() => undefined)
        activeRuns = 1
        runsStarted++
        sending = !external.signal.aborted
        pendingAnswers.clear()
      }
      let request = sending ? await next(`run ${index} start`) : undefined
      for (const answer of run.answers) {
        if (!request) break
        if (answer === `row` || answer === `up-to-date`) {
          offset++
          request.respond(
            new Response(
              JSON.stringify([
                {
                  key: `1`,
                  value: { id: `1`, name: `row` },
                  headers: { operation: `insert` },
                },
                ...(answer === `up-to-date`
                  ? [
                      {
                        headers: {
                          control: `up-to-date`,
                          global_last_seen_lsn: String(offset),
                        },
                      },
                    ]
                  : []),
              ]),
              { headers: headers(offset) },
            ),
          )
          if (answer === `up-to-date`) {
            pendingAnswers.clear()
          } else pendingAnswers.add(`row`)
        } else if (answer === `reset`) {
          offset++
          request.respond(
            new Response(
              JSON.stringify([{ headers: { control: `must-refetch` } }]),
              { status: 409, headers: { 'electric-handle': `shape` } },
            ),
          )
          pendingAnswers.clear()
          pendingAnswers.add(`reset`)
        } else {
          request.respond(new Response(`transient`, { status: 503 }))
        }
        request = await next(`run ${index} ${answer}`)
        check(`run ${index} ${answer}`)
      }
      if (
        request &&
        (run.end === `deciding-retry` || run.end === `deciding-give-up`)
      ) {
        const calls = onErrorCalls
        const decision = deferred<Record<string, never> | void>()
        heldDecision = decision
        settleDecisions.push(() =>
          decision.resolve(run.end === `deciding-retry` ? {} : undefined),
        )
        request.respond(new Response(`transient`, { status: 503 }))
        await vi.waitFor(() => expect(onErrorCalls).toBe(calls + 1))
        releaseObservedStates.add(`cleanup-during-retry-decision`)
        check(`run ${index} pending decision`)
      } else if (request && run.end === `give-up`) {
        const calls = onErrorCalls
        retries = false
        request.respond(new Response(`transient`, { status: 503 }))
        await vi.waitFor(() => expect(onErrorCalls).toBe(calls + 1))
        retries = true
        sending = false
        check(`run ${index} give-up`)
      } else if (run.end === `abort` && !external.signal.aborted) {
        external.abort()
        sending = false
        check(`run ${index} abort`)
      }

      releaseObservedStates.add(
        external.signal.aborted
          ? `cleanup-after-abort`
          : !sending
            ? `cleanup-after-give-up`
            : collection.status === `ready`
              ? `cleanup-after-ready`
              : `cleanup-while-loading`,
      )
      if (index > 0) releaseObservedStates.add(`cleanup-of-restarted-run`)
      if (pendingAnswers.has(`row`))
        releaseObservedStates.add(`cleanup-after-partial-delivery`)
      if (pendingAnswers.has(`reset`))
        releaseObservedStates.add(`cleanup-during-reset`)
      await collection.cleanup()
      activeRuns = 0
      check(`run ${index} cleanup`)
      // A later run has its own decision; the old promise remains unresolved.
      heldDecision = undefined
    }
    // Calibration: the recorder observed the listener of every run's stream.
    expect(listeners.registered()).toBe(runsStarted)
  }, [
    () => collection.cleanup(),
    () => settleDecisions.forEach((settle) => settle()),
    () => http.close(),
    () => listeners.restore(),
    () => consoleError.mockRestore(),
    () => consoleWarn.mockRestore(),
  ])
}

// Replay the smallest incomplete deliveries and their terminal neighbors in
// every mode through the same driver and cleanup comparison as generation.
const incompleteDeliveries = (
  [`eager`, `on-demand`, `progressive`] as const
).flatMap((mode) =>
  ([`row`, `reset`] as const).flatMap((answer) =>
    (
      [
        `open`,
        `give-up`,
        `abort`,
        `deciding-retry`,
        `deciding-give-up`,
      ] as const
    ).map((end) => ({
      name: `releases listeners after incomplete delivery in ${mode} mode: ${answer} answer, ${end} end`,
      history: { mode, runs: [{ answers: [answer], end }] },
    })),
  ),
)

const releaseViolation = sameViolation()
const releaseHistoryArbitrary = fc.record({
  mode: fc.constantFrom(
    `eager` as const,
    `on-demand` as const,
    `progressive` as const,
  ),
  runs: fc.array(
    fc.record({
      answers: fc.array(
        fc.constantFrom(
          `row` as const,
          `up-to-date` as const,
          `reset` as const,
          `retry` as const,
        ),
        { maxLength: 3 },
      ),
      end: fc.constantFrom(
        `open` as const,
        `give-up` as const,
        `abort` as const,
        `deciding-retry` as const,
        `deciding-give-up` as const,
      ),
    }),
    { minLength: 1, maxLength: 3 },
  ),
})
oracleProperty({
  id: `electric.sdk-source-release`,
  law: {
    statement: `Every installed-SDK stream listener is released when its sync run is cleaned up.`,
    authority: `The resource-ownership law and EventTarget-calibrated listener comparison stated beside checkSourceRelease.`,
    limits: `The unchanged one-to-three-run browser-SDK grammar in jsdom; React Native AppState and arbitrary provider schedules remain separate.`,
  },
  owns: [`src/electric.ts#electricCollectionOptions`],
  histories: {
    arbitrary: releaseHistoryArbitrary,
    runs: 40,
    fixedSeeds: [20261024],
    fixed: incompleteDeliveries,
  },
  ...existingElectricComparison(
    `electric.sdk-source-release`,
    (history: ReleaseHistory) =>
      retainSdkViolation(releaseViolation, history, () =>
        checkSourceRelease(history),
      ),
  ),
  check: checkExistingElectricComparison,
  timeout: campaignTimeoutMs,
})

/**
 * A completed scoped snapshot establishes rows and a durable continuation
 * checkpoint. The Electric guide's persisted-resume contract requires the
 * response's handle/offset, not the cursor from the preceding response.
 * The independent model uses only authored HTTP positions and source rows.
 * It never reads ShapeStream state to predict durable metadata.
 *
 * Each history starts changes-only. Direct and live-query consumers perform
 * two distinct demands. The cursor consumer makes two physical requests in
 * one admitted demand. Successful histories restart; rejected writes stop at
 * rejection. Each tag/consumer/empty-second-response/delivery lane runs fixed
 * and random campaigns of generated positions and payloads. Distinct demands
 * avoid deduplication. Increasing positions are legal; regressing ones are not.
 * The first load distinguishes an absent cursor, the second a stale cursor,
 * and the empty neighbor requires progress without a row write. Tagged restart
 * must quarantine cache-only rows; its reset policy is owned separately.
 *
 * The real installed SDK receives controlled HTTP. Comparisons run immediately
 * after successful acquisition settlement, then after a fresh launch's demand.
 * No extra polling may repair a missing durable checkpoint after settlement.
 * This does not establish a real server's framing, native SQLite durability,
 * intermediate row/cursor atomic publication, or arbitrary provider schedules.
 */
function expectedResumeCheckpoint(offset: number, tagged: boolean) {
  return {
    kind: `resume`,
    handle: `shape`,
    offset: `${offset}_0`,
    requiresTagState: tagged,
  }
}

// Virtual Collection metadata is outside this source payload law.
function checkpointRow(row: TestRow | undefined) {
  return row && { id: row.id, name: row.name, stable: row.stable }
}

type ResumeCheckpointHistory = { base: number; gap: number; name: string }
type ResumeCheckpointLane = {
  tagged: boolean
  consumer: `direct` | `live-query` | `cursor`
  emptySecond: boolean
  delivery: `apply` | `hold` | `reject`
}
async function checkResumeCheckpoint(
  history: ResumeCheckpointHistory,
  { tagged, consumer, emptySecond, delivery }: ResumeCheckpointLane,
) {
  const expectedCuts =
    delivery === `reject`
      ? [`checkpoint-rejected`]
      : [
          ...(consumer === `cursor` ? [`next-request`] : [`cold-cursor`]),
          `advanced-cursor`,
          `fresh-launch-demand`,
          ...(delivery === `hold` ? [`held-checkpoint`] : []),
        ]
  const observedCuts = new Set<string>()
  const fixture = managedTagPersistence()
  const entered = deferred<void>()
  const release = deferred<void>()
  const checkpointError = new Error(`checkpoint storage failed`)
  let intercepted = false
  const apply = fixture.adapter.applyCommittedTx.bind(fixture.adapter)
  fixture.adapter.applyCommittedTx = async (target, tx) => {
    if (
      !intercepted &&
      tx.collectionMetadataMutations?.some(
        (mutation) =>
          mutation.type !== `delete` &&
          mutation.key === `electric:resume` &&
          typeof mutation.value === `object` &&
          mutation.value !== null &&
          `kind` in mutation.value &&
          mutation.value.kind === `resume`,
      )
    ) {
      intercepted = true
      entered.resolve()
      if (delivery === `hold`) await release.promise
      if (delivery === `reject`) throw checkpointError
    }
    return apply(target, tx)
  }
  const http = controlledHttp()
  const collectionId = `sdk-resume-checkpoint-${++sequence}`
  const create = () =>
    createCollection(
      persistedCollectionOptions<
        TestRow,
        string | number,
        never,
        ElectricCollectionUtils<TestRow>
      >({
        ...electricCollectionOptions<TestRow>({
          id: collectionId,
          shapeOptions: {
            url: `http://test-url/${collectionId}`,
            params: { table: `rows` },
            fetchClient: http.fetchClient,
          },
          syncMode: `on-demand`,
          startSync: true,
          getKey: (row) => row.id,
        }),
        persistence: { adapter: fixture.adapter },
      }),
    )
  const first = create()
  let current = first
  const queries: Array<{ cleanup: () => Promise<void> }> = []
  let firstLaunch = true
  const demand = (id: number) => {
    if (consumer === `cursor` && firstLaunch) {
      const field = new IR.PropRef([`id`])
      return Promise.resolve(
        current._sync.loadSubset({
          limit: 10,
          orderBy: [
            {
              expression: field,
              compareOptions: {
                direction: `asc`,
                nulls: `last`,
                stringSort: `lexical`,
              },
            },
          ],
          cursor: {
            whereCurrent: new IR.Func(`eq`, [field, new IR.Value(1)]),
            whereFrom: new IR.Func(`gt`, [field, new IR.Value(1)]),
            lastKey: 1,
          },
        }),
      )
    }
    if (consumer === `direct` || consumer === `cursor`)
      return Promise.resolve(
        current._sync.loadSubset({
          where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(id)]),
        }),
      )
    const source = current
    const query = createLiveQueryCollection({
      startSync: false,
      query: (q) =>
        q
          .from({ row: source })
          .where(({ row }) => eq(row.id, id))
          .select(({ row }) => ({
            id: row.id,
            name: row.name,
            stable: row.stable,
          })),
    })
    queries.push(query)
    return query.preload()
  }
  const respond = (
    request: Request,
    id: number,
    offset: number,
    empty: boolean,
  ) => {
    const cursorFrom = consumer === `cursor` && firstLaunch && id === 2
    expect(request.url.searchParams.get(`subset__where`)).toBe(
      cursorFrom ? `"id" > $1` : `"id" = $1`,
    )
    expect(
      JSON.parse(request.url.searchParams.get(`subset__params`) ?? `null`),
    ).toEqual({ 1: String(cursorFrom ? 1 : id) })
    request.respond(
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: offset,
          },
          data: empty
            ? []
            : [
                {
                  key: String(id),
                  value: {
                    id: String(id),
                    name: history.name,
                    stable: `retained`,
                  },
                  headers: {
                    operation: `insert`,
                    ...(tagged ? { tags: [`selected`] } : {}),
                  },
                },
              ],
        }),
        {
          headers: {
            ...headers(offset),
            'electric-schema': JSON.stringify({
              id: { type: `int4` },
              name: { type: `text` },
              stable: { type: `text` },
            }),
          },
        },
      ),
    )
  }
  await withElectricCleanup(async () => {
    const initial = await atCheckpoint(http.take(), `checkpoint first stream`)
    expect(initial.url.searchParams.get(`log`)).toBe(`changes_only`)
    let queued:
      { loading: ReturnType<typeof demand>; request: Request } | undefined
    for (const id of [1, 2]) {
      let settlement = `pending`
      const loading = queued?.loading ?? demand(id)
      void loading.then(
        () => {
          settlement = `fulfilled`
        },
        () => {
          settlement = `rejected`
        },
      )
      const offset = history.base + (id - 1) * history.gap
      respond(
        queued?.request ??
          (await atCheckpoint(http.take(true), `checkpoint snapshot ${id}`)),
        id,
        offset,
        id === 2 && emptySecond,
      )
      if (id === 1 && delivery !== `apply`) {
        await atCheckpoint(
          Promise.race([
            entered.promise,
            loading.then(
              () => undefined,
              () => undefined,
            ),
          ]),
          `durable checkpoint or load settlement`,
        )
        expect(
          intercepted,
          `load cannot finish without its durable checkpoint`,
        ).toBe(true)
        if (delivery === `reject`) {
          // The persistence contract exposes its named durability error and
          // preserves the storage failure as the local cause (core README).
          await expect(loading).rejects.toMatchObject({
            name: `PersistedCollectionDurabilityError`,
            cause: checkpointError,
          })
          observedCuts.add(`checkpoint-rejected`)
          return
        }
        // The adapter reached the durable write, which stays held. Yield only
        // to expose an incorrectly early load settlement at this semantic cut.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(settlement, `load waits for durable cursor`).toBe(`pending`)
        observedCuts.add(`held-checkpoint`)
        if (consumer === `cursor`) {
          // Both requests belong to one admitted cursor demand, so this cut
          // bypasses the persistence wrapper's next-demand hydration barrier.
          queued = {
            loading,
            request: await atCheckpoint(
              http.take(true),
              `next physical snapshot while checkpoint is held`,
            ),
          }
          observedCuts.add(`next-request`)
          release.resolve()
          continue
        }
        release.resolve()
      }
      await atCheckpoint(loading, `checkpoint demand ${id} applied`)
      expect(
        fixture.metadata().get(`electric:resume`),
        `durable cursor at successful demand settlement`,
      ).toMatchObject(expectedResumeCheckpoint(offset, tagged))
      expect(checkpointRow(current.get(id))).toEqual(
        id === 2 && emptySecond
          ? undefined
          : { id, name: history.name, stable: `retained` },
      )
      observedCuts.add(id === 1 ? `cold-cursor` : `advanced-cursor`)
    }
    for (const query of queries.splice(0)) await query.cleanup()
    await first.cleanup()
    firstLaunch = false
    current = create()
    const resumed = await atCheckpoint(
      http.take(),
      `checkpoint restarted stream`,
    )
    expect(resumed.url.searchParams.get(`log`)).toBe(`changes_only`)
    expect(resumed.url.searchParams.get(`offset`)).toBe(
      tagged ? `now` : `${history.base + history.gap}_0`,
    )
    expect(resumed.url.searchParams.get(`handle`)).toBe(tagged ? null : `shape`)
    const loading = demand(1)
    void loading.catch(() => undefined)
    respond(
      await atCheckpoint(http.take(true), `checkpoint restarted snapshot`),
      1,
      history.base + history.gap + 1,
      false,
    )
    await atCheckpoint(loading, `checkpoint restarted demand applied`)
    expect(checkpointRow(current.get(1))).toEqual({
      id: 1,
      name: history.name,
      stable: `retained`,
    })
    expect(fixture.rows().get(1)?.value).toEqual(checkpointRow(current.get(1)))
    if (tagged)
      expect(fixture.metadata().get(`electric:resume`)).toMatchObject({
        kind: `reset`,
      })
    observedCuts.add(`fresh-launch-demand`)
  }, [
    () => release.resolve(),
    async () => {
      for (const query of queries) await query.cleanup()
    },
    () => current.cleanup(),
    () => first.cleanup(),
    () => http.close(),
    () => expect(http.activeCount()).toBe(0),
  ])
  if (!oracleReplayRequested())
    expect(expectedCuts.filter((cut) => !observedCuts.has(cut))).toEqual([])
  console.log(
    `ORACLE_REACH`,
    JSON.stringify({
      property: `electric.sdk-resume-checkpoint`,
      tagged,
      consumer,
      emptySecond,
      delivery,
      counts: Object.fromEntries(
        expectedCuts.map((cut) => [cut, Number(observedCuts.has(cut))]),
      ),
    }),
  )
}
for (const tagged of [false, true])
  for (const consumer of [`direct`, `live-query`, `cursor`] as const)
    for (const emptySecond of [false, true])
      for (const delivery of [`apply`, `hold`, `reject`] as const) {
        if (consumer === `cursor` && delivery !== `hold`) continue
        const property = `electric.sdk-resume-checkpoint.${tagged}.${consumer}.${emptySecond}.${delivery}`
        const violation = sameViolation()
        resumeViolations.push(violation)
        oracleProperty({
          id: property,
          law: {
            statement: `Each completed SDK snapshot cursor persists before demand settlement, tagged=${tagged} consumer=${consumer} emptySecond=${emptySecond} delivery=${delivery}.`,
            authority: `The independent authored-HTTP-position model and persisted-resume contract stated beside checkResumeCheckpoint.`,
            limits: `The unchanged bounded two-demand, restart, cursor and durable-settlement receiving lane; no additional provider schedules or native-host claim.`,
          },
          owns: [`src/electric.ts#electricCollectionOptions`],
          histories: {
            arbitrary: fc.record({
              base: fc.integer({ min: 1, max: 30 }),
              gap: fc.integer({ min: 1, max: 5 }),
              name: fc.string({ minLength: 1, maxLength: 8 }),
            }),
            runs: 8,
            fixedSeeds: [20261109],
          },
          ...existingElectricComparison(
            property,
            (history: ResumeCheckpointHistory) =>
              retainSdkViolation(violation, history, () =>
                checkResumeCheckpoint(history, {
                  tagged,
                  consumer,
                  emptySecond,
                  delivery,
                }),
              ),
          ),
          check: checkExistingElectricComparison,
          timeout: campaignTimeoutMs,
        })
      }
