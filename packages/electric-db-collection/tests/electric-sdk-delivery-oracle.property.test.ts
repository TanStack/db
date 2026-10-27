import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { IR, createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { electricCollectionOptions } from '../src/electric'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
} from '../../db/tests/oracle-config'
import {
  controlledHttp,
  deferred,
  headers,
} from './electric-sdk-delivery-support'
import {
  atCheckpoint,
  withElectricCleanup,
  withElectricSetup,
} from './electric-oracle-lifecycle'
import {
  applyRetryModel,
  createRetryModel,
  expectedRetryObservation,
} from './electric-retry-decision-model'
import type { Item } from './electric-sdk-delivery-support'
import type {
  RetryDecision,
  RetryModel,
  RetryObservation,
  RetryStep,
} from './electric-retry-decision-model'
import type { SyncMetadataApi } from '@tanstack/db'
import type { Message } from '@electric-sql/client'

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
 * HTTP, local-read, public-row, and settlement boundaries; no declared check
 * in this file compares the scoped-restart history with a model.
 * A coordinator notification after the scoped A snapshot changes an unrelated
 * durable row. The source Map still predicts A for its active predicate. The
 * post-notification public comparison must retain A; the persistence capability
 * scan fences coordinator processing first.
 * A real node:sqlite cold-launch witness starts with an incompatible partial
 * cache and no reset marker. It must exclude that row before and after the
 * installed SDK returns an empty source snapshot for the demanded predicate.
 *
 * These finite HTTP fixtures do not prove that a live Electric service emits
 * the authored snapshot or move frames, nor do they cover multiple row keys,
 * arbitrary retry schedules, native persistence hosts, or arbitrary provider schedules.
 * Dropped rows and reactivation controls prove the named comparisons are live.
 */

// Replay only the selected generated law with TANSTACK_DB_ORACLE_SEED,
// TANSTACK_DB_ORACLE_PATH, and TANSTACK_DB_ORACLE_PROPERTY. For example:
// TANSTACK_DB_ORACLE_SEED=20260917 TANSTACK_DB_ORACLE_PATH=0 \
// TANSTACK_DB_ORACLE_PROPERTY=electric.sdk-snapshot-delivery \
// pnpm --dir packages/electric-db-collection exec vitest run tests/electric-sdk-delivery-oracle.property.test.ts -t 'replay'
// Ordinary tests stand aside during any path replay, which runs one property.
const fixedCase = oracleReplayTest(it)
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

// The checks are the drivers that run a finite history and compare production
// with the model state at each checkpoint. The retry model is the shared
// module `electric-retry-decision-model.ts`, which predicts each observation.
declareOracle({
  check: [checkSnapshots, checkMembership, runClientRetryCell],
  model: [createRetryModel, applyRetryModel, expectedRetryObservation],
})

function sdkCampaigns(
  propertyId: string,
  name: string,
  fixedSeed: number,
  violation: { reset: () => void; report: (error: unknown) => unknown },
  run: (seed?: number) => Promise<void>,
): void {
  const runCampaign = async (seed?: number) => {
    violation.reset()
    try {
      await run(seed)
    } catch (error) {
      throw violation.report(error)
    }
  }
  // A path replay of the property runs only the random campaign, from its
  // path. The fixed campaign stands aside during every path replay.
  oracleReplayTest(it)(`${name} (fixed)`, () => runCampaign(fixedSeed))
  oracleReplayTest(it, propertyId)(`${name} (random)`, () => runCampaign())
}

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

async function checkSnapshots(
  width: number,
  name: string,
  dropRows = false,
  cleanupFailure?: Error,
  setupFault?: { primary: Error; cleanup?: Error },
) {
  const http = controlledHttp()
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
          fetchClient: http.fetchClient,
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
    for (const [index, lowerBound] of [1, 2, width + 1].entries()) {
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
      const request = await atCheckpoint(http.take(true), `snapshot request`)
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
      const outcome = await atCheckpoint(
        completion,
        `snapshot request completion`,
      )
      if (!outcome.ok) throw outcome.error
    }
    await atCheckpoint(http.take(), `resumed live request`)
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
const snapshotViolation = sameViolation()
const snapshotProperty = fc.asyncProperty(
  fc.integer({ min: 2, max: 4 }),
  fc.string({ maxLength: 10 }),
  (width, name) =>
    snapshotViolation.check({ width, name }, () =>
      checkSnapshots(width, name, replayFault === `snapshot-rows`),
    ),
)
sdkCampaigns(
  `electric.sdk-snapshot-delivery`,
  `applies installed-SDK snapshot deliveries against an independent overlapping source`,
  20260917,
  snapshotViolation,
  (seed) =>
    fc.assert(snapshotProperty, {
      ...oraclePropertyOptions(12, `electric.sdk-snapshot-delivery`),
      ...(seed === undefined ? {} : { seed }),
    }),
)

fixedCase(`detects dropped snapshot rows`, async () => {
  await expect(checkSnapshots(2, `payload`, true)).rejects.toMatchObject({
    name: `AssertionError`,
    message: expect.stringContaining(`snapshot 0 applied rows`),
  })
})

fixedCase(
  `retains the snapshot law and checkpoint when cleanup also fails`,
  async () => {
    const cleanupFailure = new Error(`injected cleanup failure`)
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const subscribe = ShapeStream.prototype.subscribe
    snapshotViolation.reset()
    try {
      let primary: unknown
      try {
        await snapshotViolation.check({ width: 2, name: `payload` }, () =>
          checkSnapshots(2, `payload`, true, cleanupFailure),
        )
      } catch (error) {
        primary = snapshotViolation.report(error)
      }
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
    } finally {
      warning.mockRestore()
    }
  },
)

fixedCase(
  `restores the SDK setup resources after construction fails`,
  async () => {
    const primary = new Error(`collection construction failed`)
    const secondary = new Error(`provider release failed`)
    const subscribe = ShapeStream.prototype.subscribe
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    try {
      await expect(
        checkSnapshots(2, `payload`, false, undefined, {
          primary,
          cleanup: secondary,
        }),
      ).rejects.toBe(primary)
      expect(warning.mock.calls).toEqual([
        [
          `Electric oracle cleanup failed after a primary error: snapshot HTTP provider during setup`,
          secondary,
        ],
      ])
      expect(ShapeStream.prototype.subscribe).toBe(subscribe)
    } finally {
      warning.mockRestore()
    }
  },
)

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
const membershipProperty = fc.asyncProperty(
  fc.integer({ min: 1, max: 2 }),
  fc.integer({ min: 1, max: 2 }),
  fc.integer({ min: 1, max: 3 }),
  (left, right, cycles) =>
    membershipViolation.check({ left, right, cycles }, () =>
      checkMembership(left, right, cycles, replayFault === `move-in`),
    ),
)
sdkCampaigns(
  `electric.sdk-dnf-membership`,
  `preserves DNF visibility through installed-SDK silent move-in cycles`,
  20260918,
  membershipViolation,
  (seed) =>
    fc.assert(membershipProperty, {
      ...oraclePropertyOptions(12, `electric.sdk-dnf-membership`),
      ...(seed === undefined ? {} : { seed }),
    }),
)

fixedCase(`detects dropped move-in at its visibility checkpoint`, async () => {
  await expect(checkMembership(1, 1, 1, true)).rejects.toMatchObject({
    name: `AssertionError`,
    message: expect.stringContaining(`after silent move-in`),
  })
})

/**
 * # The retry-decision law through the installed Electric client
 *
 * The retry-decision oracle in `electric-oracle.property.test.ts` drives the
 * adapter through a controlled ShapeStream. This lane receives the same law
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
 * At each checkpoint the lane compares the Collection status, each demand's
 * settlement, and whether the snapshot's row is visible with the model:
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
    expect(
      clientObservation({
        status: collection.status,
        demands: [...settlements],
        rowVisible: collection.has(1),
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

fixedCase.each(clientRetryCells)(
  `installed client: %s in %s mode with an onError %s follows the retry-decision model`,
  (outcome, mode, decision) => runClientRetryCell(outcome, mode, decision),
  60_000,
)
