import { DatabaseSync } from 'node:sqlite'
import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import {
  SQLiteCorePersistenceAdapter,
  SingleProcessCoordinator,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import {
  oraclePropertyOptions,
  readOracleRunConfig,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  managedTagPersistence,
  storageTargetId,
} from './electric-persistence-fixture'
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
import type { TestRow } from './electric-persistence-fixture'
import type {
  RetryDecision,
  RetryModel,
  RetryObservation,
  RetryStep,
} from './electric-retry-decision-model'
import type { ElectricCollectionUtils } from '../src/electric'
import type { SyncMetadataApi, SyncPersistenceCapabilityV1 } from '@tanstack/db'
import type {
  PersistenceAdapter,
  ProtocolEnvelope,
  SQLiteDriver,
  TxCommitted,
} from '../../db-sqlite-persistence-core/src'
import type { Message } from '@electric-sql/client'
import type * as ElectricSdkModule from '@electric-sql/client'

// Observe the real constructor boundary without changing the installed SDK's
// options, prototype, methods, or HTTP behavior. Only the rotation lane enables
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
 * snapshot requests must run in order. Named two-launch and concurrent cases
 * check those laws at HTTP, local-read, public-row, and settlement boundaries.
 * A coordinator notification after the scoped A snapshot changes an unrelated
 * durable row. The source Map still predicts A for its active predicate. The
 * post-notification public comparison must retain A; the persistence capability
 * scan fences coordinator processing first.
 * A real node:sqlite cold-launch witness starts with an incompatible partial
 * cache and no reset marker. It must exclude that row before and after the
 * installed SDK returns an empty source snapshot for the demanded predicate.
 * A source-release lane, documented at its property, checks that cleanup
 * removes every listener that a run's streams registered on `document`.
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
const { replayPath, replayProperty } = readOracleRunConfig()
const fixedCase = replayPath === undefined ? it : it.skip
const replayFault = process.env.TANSTACK_DB_ELECTRIC_SDK_DELIVERY_FAULT
if (
  replayFault !== undefined &&
  replayFault !== `snapshot-rows` &&
  replayFault !== `move-in`
) {
  throw new Error(`Unknown Electric SDK delivery oracle fault`)
}

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
  if (replayPath !== undefined) {
    if (replayProperty === propertyId)
      it(`${name} (replay)`, () => runCampaign())
    return
  }
  it(`${name} (fixed)`, () => runCampaign(fixedSeed))
  it(`${name} (random)`, () => runCampaign())
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

type Item = { id: number; name: string }

function toSqliteBinding(value: unknown): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  return String(value)
}

function nodeSqliteDriver(database: DatabaseSync): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) =>
      Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toSqliteBinding))
          .map((row) => ({ ...row })) as Array<never>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(toSqliteBinding))
      return Promise.resolve()
    },
    transaction: async (transaction) => {
      database.exec(`BEGIN IMMEDIATE`)
      try {
        const result = await transaction(driver)
        database.exec(`COMMIT`)
        return result
      } catch (error) {
        database.exec(`ROLLBACK`)
        throw error
      }
    },
  }
  return driver
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type Request = { url: URL; respond: (response: Response) => void }

// The finite provider only holds responses and observes each fetch's signal.
function controlledHttp() {
  const queued: Array<Request> = []
  const waiting: Array<{
    snapshot: boolean | undefined
    resolve: (request: Request) => void
    reject: (error: unknown) => void
  }> = []
  const active = new Set<() => void>()
  let closed = false
  const closedError = new Error(`Electric oracle HTTP provider closed`)
  const isSnapshot = (request: Request) =>
    request.url.searchParams.has(`subset__where`)
  const fetchClient: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      if (closed) {
        reject(closedError)
        return
      }
      const signal = init?.signal
      const url = new URL(String(input))
      const request: Request = {
        url,
        respond: (response) => {
          remove()
          resolve(response)
        },
      }
      const remove = () => {
        signal?.removeEventListener(`abort`, abort)
        active.delete(abort)
        const index = queued.indexOf(request)
        if (index >= 0) queued.splice(index, 1)
      }
      const abort = () => {
        remove()
        reject(
          signal?.reason ??
            new DOMException(`Provider request aborted`, `AbortError`),
        )
      }
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener(`abort`, abort, { once: true })
      active.add(abort)
      const index = waiting.findIndex(
        (waiter) =>
          waiter.snapshot === undefined ||
          waiter.snapshot === isSnapshot(request),
      )
      if (index >= 0) waiting.splice(index, 1)[0]!.resolve(request)
      else queued.push(request)
    })
  return {
    fetchClient,
    take: (snapshot = false): Promise<Request> => {
      if (closed) return Promise.reject(closedError)
      const index = queued.findIndex(
        (request) => isSnapshot(request) === snapshot,
      )
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]!)
      return new Promise((resolve, reject) =>
        waiting.push({ snapshot, resolve, reject }),
      )
    },
    takeAny: (): Promise<Request> => {
      if (closed) return Promise.reject(closedError)
      if (queued.length > 0) return Promise.resolve(queued.shift()!)
      return new Promise((resolve, reject) =>
        waiting.push({ snapshot: undefined, resolve, reject }),
      )
    },
    close: () => {
      closed = true
      for (const abort of [...active]) abort()
      for (const waiter of waiting.splice(0)) waiter.reject(closedError)
    },
    activeCount: () => active.size,
  }
}

// EventTarget registration identity is callback plus capture. Replay native
// add/remove calls in order: a removal cannot erase a later registration, and
// repeated additions of one identity retain one listener. The installed SDK
// uses no once or signal options, which would need automatic-removal tracking.
function recordVisibilityListeners() {
  const add = vi.spyOn(document, `addEventListener`)
  const remove = vi.spyOn(document, `removeEventListener`)
  const visibility = (calls: Array<Array<unknown>>) =>
    calls
      .filter(([type]) => type === `visibilitychange`)
      .map(([, listener]) => listener)
  return {
    registered: () => visibility(add.mock.calls).length,
    live: () => {
      const calls = [
        ...add.mock.calls.map((call, index) => ({
          call,
          adding: true,
          order: add.mock.invocationCallOrder[index]!,
        })),
        ...remove.mock.calls.map((call, index) => ({
          call,
          adding: false,
          order: remove.mock.invocationCallOrder[index]!,
        })),
      ].sort((left, right) => left.order - right.order)
      const listeners = new Map<
        EventListenerOrEventListenerObject,
        Set<boolean>
      >()
      for (const {
        call: [type, listener, options],
        adding,
      } of calls) {
        if (type !== `visibilitychange`) continue
        const capture =
          typeof options === `boolean` ? options : Boolean(options?.capture)
        if (adding) {
          const captures = listeners.get(listener) ?? new Set<boolean>()
          captures.add(capture)
          listeners.set(listener, captures)
        } else listeners.get(listener)?.delete(capture)
      }
      return [...listeners.values()].reduce(
        (count, captures) => count + captures.size,
        0,
      )
    },
    restore: () => {
      // The comparison has already run. Release even a failed subject's
      // registrations so RED runs and shrinking do not retain dead streams.
      try {
        for (const [type, listener, options] of add.mock.calls)
          if (type === `visibilitychange`)
            document.removeEventListener(type, listener, options)
      } finally {
        add.mockRestore()
        remove.mockRestore()
      }
    },
  }
}

// EventTarget identifies a listener by callback and capture, coalesces duplicate
// additions, and applies removals in order (DOM Standard, "EventTarget"). This
// bounded calibration sends every sequence of up to three add/remove calls
// through the real EventTarget, then compares dispatch with the recorder before
// teardown. Two callbacks and both capture modes distinguish wrong identities;
// omitted, boolean, and object options distinguish equivalent capture spellings.
// Three calls reach add/remove/re-add. Once and signal options are outside this
// recorder's installed-SDK domain.
fixedCase(
  `records EventTarget ownership across bounded listener histories`,
  () => {
    type Step = {
      add: boolean
      callback: number
      options: boolean | { capture: boolean } | undefined
    }
    const options = [
      undefined,
      false,
      true,
      { capture: false },
      { capture: true },
    ]
    const steps: Array<Step> = [false, true].flatMap((add) =>
      [0, 1].flatMap((callback) =>
        options.map((capture) => ({ add, callback, options: capture })),
      ),
    )
    function* histories(prefix: Array<Step> = []): Generator<Array<Step>> {
      yield prefix
      if (prefix.length < 3)
        for (const step of steps) yield* histories([...prefix, step])
    }
    let checked = 0
    for (const history of histories()) {
      const listeners = recordVisibilityListeners()
      const callbacks = [vi.fn(), vi.fn()]
      try {
        for (const step of history) {
          const callback = callbacks[step.callback]!
          if (step.add)
            document.addEventListener(
              `visibilitychange`,
              callback,
              step.options,
            )
          else
            document.removeEventListener(
              `visibilitychange`,
              callback,
              step.options,
            )
        }
        document.dispatchEvent(new Event(`visibilitychange`))
        // Native dispatch supplies the independent count, including both capture
        // identities of one callback. Teardown cannot change this observation.
        const dispatched = callbacks.reduce(
          (count, callback) => count + callback.mock.calls.length,
          0,
        )
        expect(listeners.live(), JSON.stringify(history)).toBe(dispatched)
        checked++
      } finally {
        listeners.restore()
        for (const callback of callbacks) {
          document.removeEventListener(`visibilitychange`, callback, false)
          document.removeEventListener(`visibilitychange`, callback, true)
        }
      }
    }
    expect(checked).toBe(8421)
  },
  60_000,
)

// Teardown must preserve a failed comparison and release its registrations.
// Enumerate every retained subset of three fresh callbacks. Dispatch observes
// actual EventTarget ownership independently of the recorder's live count.
fixedCase(
  `releases recorded listeners after preserving a primary failure`,
  async () => {
    for (let retained = 0; retained < 8; retained++) {
      const listeners = recordVisibilityListeners()
      const callbacks = Array.from({ length: 3 }, () => vi.fn())
      const primary = new Error(`listener comparison failed`)
      try {
        await expect(
          withElectricCleanup(() => {
            for (const [index, callback] of callbacks.entries()) {
              document.addEventListener(`visibilitychange`, callback)
              if ((retained & (1 << index)) === 0)
                document.removeEventListener(`visibilitychange`, callback)
            }
            expect(listeners.registered()).toBe(3)
            throw primary
          }, [() => listeners.restore()]),
        ).rejects.toBe(primary)
        document.dispatchEvent(new Event(`visibilitychange`))
        for (const callback of callbacks)
          expect(callback).not.toHaveBeenCalled()
      } finally {
        // Independent cleanup also makes this calibration safe on the old recorder.
        for (const callback of callbacks)
          document.removeEventListener(`visibilitychange`, callback)
        listeners.restore()
      }
    }
  },
)

// Deliver a coordinator notification through the same persistence wrapper
// used by the installed-SDK receiver. The test still controls the provider
// response independently of this durable-cache notification.
function controlledCoordinator(collectionId: string) {
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  return Object.assign(new SingleProcessCoordinator(), {
    subscribe: (
      _collectionId: string,
      onMessage: (message: ProtocolEnvelope<unknown>) => void,
    ) => {
      subscriber = onMessage
      return () => {
        subscriber = undefined
      }
    },
    emit: (payload: TxCommitted) => {
      subscriber?.({
        v: 1,
        dbName: `sdk-receiver`,
        collectionId,
        senderId: `other-tab`,
        ts: Date.now(),
        payload,
      })
    },
  })
}

const headers = (offset: number) => ({
  'electric-handle': `shape`,
  'electric-offset': `${offset}_0`,
  'electric-cursor': String(offset),
  'electric-up-to-date': `true`,
  'electric-schema': JSON.stringify({
    id: { type: `int4` },
    name: { type: `text` },
  }),
})
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

fixedCase(`lets requestSnapshot own the warm transport`, async () => {
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
            const result = callback(messages)
            delivery.resolve()
            return result
          },
          onError,
        )
      }),
    [
      {
        label: `warm HTTP provider during spy setup`,
        release: () => http.close(),
      },
    ],
  )
  const collection = await withElectricSetup(
    () =>
      createCollection(
        electricCollectionOptions<Item>({
          id: `sdk-warm-snapshot-${++sequence}`,
          shapeOptions: {
            url: `http://test-url/warm-snapshot-${sequence}`,
            params: { table: `rows` },
            fetchClient: http.fetchClient,
          },
          syncMode: `on-demand`,
          startSync: true,
          getKey: (row) => row.id,
        }),
      ),
    [
      { label: `warm HTTP provider during setup`, release: () => http.close() },
      {
        label: `warm subscription spy during setup`,
        release: () => spy.mockRestore(),
      },
    ],
  )

  return withElectricCleanup(async () => {
    const initial = await atCheckpoint(http.take(), `initial live request`)
    initial.respond(
      new Response(
        JSON.stringify([
          {
            headers: {
              control: `up-to-date`,
              global_last_seen_lsn: `1`,
            },
          },
        ]),
        { headers: headers(1) },
      ),
    )
    await atCheckpoint(delivery.promise, `initial up-to-date delivery`)

    // Hold the next live poll. The installed SDK's requestSnapshot owns the
    // pause/abort transition from this poll to the subset request.
    await atCheckpoint(http.take(), `warm live poll`)
    delivery = deferred<void>()
    const loading = collection._sync.loadSubset({
      where: new IR.Func(`gte`, [new IR.PropRef([`id`]), new IR.Value(1)]),
    })
    const request = await atCheckpoint(
      http.takeAny(),
      `first request after warm loadSubset`,
    )
    expect(request.url.searchParams.has(`subset__where`)).toBe(true)
    expect(http.activeCount()).toBe(1)
    request.respond(
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: 2,
          },
          data: [],
        }),
        { headers: headers(2) },
      ),
    )
    await atCheckpoint(delivery.promise, `warm snapshot delivery`)
    await atCheckpoint(Promise.resolve(loading), `warm snapshot completion`)
  }, [
    { label: `warm collection`, release: () => collection.cleanup() },
    { label: `warm HTTP provider`, release: () => http.close() },
    { label: `warm subscription spy`, release: () => spy.mockRestore() },
    {
      label: `warm requests after provider closure`,
      release: () => expect(http.activeCount()).toBe(0),
    },
  ])
})

/**
 * The installed SDK can finish a subset HTTP response after the shared stream
 * was externally aborted. The stream can no longer apply that row, so the
 * adapter must reject the demand and leave its predicate uncertified. This
 * receives the oracle's external-abort law through the real requestSnapshot
 * transport rather than relying on a mocked provider promise.
 */
fixedCase(`does not certify an aborted SDK subset snapshot`, async () => {
  const http = controlledHttp()
  const external = new AbortController()
  const collection = createCollection(
    electricCollectionOptions<Item>({
      id: `sdk-subset-abort-${++sequence}`,
      shapeOptions: {
        url: `http://test-url/subset-abort-${sequence}`,
        params: { table: `rows` },
        fetchClient: http.fetchClient,
        signal: external.signal,
      },
      syncMode: `on-demand`,
      startSync: true,
      getKey: (row) => row.id,
    }),
  )

  await withElectricCleanup(async () => {
    await atCheckpoint(http.take(), `abortable live transport`)
    const first = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
    void first.catch(() => undefined)
    const request = await atCheckpoint(http.take(true), `abortable subset HTTP`)
    external.abort()
    request.respond(
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: 1,
          },
          data: [
            {
              key: `1`,
              value: { id: `1`, name: `discarded` },
              headers: { operation: `insert` },
            },
          ],
        }),
        { headers: headers(2) },
      ),
    )
    await expect(
      atCheckpoint(first, `externally aborted SDK subset`),
    ).rejects.toMatchObject({ name: `AbortError` })
    expect(collection.has(1)).toBe(false)
    const second = collection._sync.loadSubset({ limit: 1 })
    expect(second).not.toBe(true)
    await expect(Promise.resolve(second)).rejects.toMatchObject({
      name: `AbortError`,
    })
  }, [() => collection.cleanup(), () => http.close()])
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
 * resources or replace SDK behavior. This lane
 * covers sequential rotations in an on-demand run with the installed browser
 * SDK; overlapping rotations, other SDK versions, and native hosts remain separate.
 * Both retained demands must remain pending until replacement source responses
 * arrive. Promise outcomes are observed while rotation is held and again before
 * the first replacement response; final rows alone cannot establish settlement.
 */
type RetiredSnapshotCut =
  `during-rotation` | `before-snapshots` | `after-snapshots`
const createRotationReach = () =>
  createOracleReach<
    | RetiredSnapshotCut
    | `first-session`
    | `replacement-session`
    | `demands-await-replacement`
    | `retired-target-observed`
  >(`electric.sdk-rotation-release`, [
    `during-rotation`,
    `before-snapshots`,
    `after-snapshots`,
    `first-session`,
    `replacement-session`,
    `demands-await-replacement`,
    `retired-target-observed`,
  ])
let rotationReach: ReturnType<typeof createRotationReach> | undefined

async function checkManagedRotation(cuts: ReadonlyArray<RetiredSnapshotCut>) {
  rotationReach?.beginHistory()
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
        respond(oldSnapshot, { id: oldId, name: `late-old` }, round * 4 + 1)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(collection.get(oldId)).toBeUndefined()
        expect(
          rows.get(retiredStorageId)!.has(oldId),
          `retired response in retired cache`,
        ).toBe(false)
        rotationReach?.reach(`retired-target-observed`)
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
      rotationReach?.reach(retiredSnapshotCut)
      rotationReach?.reach(
        round === 0 ? `first-session` : `replacement-session`,
      )
      if (retiredSnapshotCut === `before-snapshots`)
        await deliverRetiredSnapshot()
      await assertDemandsPending(`demands before replacement source responses`)
      rotationReach?.reach(`demands-await-replacement`)

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

fixedCase(`discards an old SDK snapshot after managed cache rotation`, () =>
  checkManagedRotation([`after-snapshots`]),
)
const rotationViolation = sameViolation()
sdkCampaigns(
  `electric.sdk-rotation-release`,
  `releases retired SDK resources before constructing a replacement`,
  20261026,
  rotationViolation,
  async (seed) => {
    rotationReach = createRotationReach()
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom<RetiredSnapshotCut>(
            `during-rotation`,
            `before-snapshots`,
            `after-snapshots`,
          ),
          { minLength: 1, maxLength: 3 },
        ),
        (cuts) =>
          rotationViolation.check(cuts, () => checkManagedRotation(cuts)),
      ),
      {
        ...oraclePropertyOptions(40, `electric.sdk-rotation-release`),
        ...(seed === undefined ? {} : { seed }),
      },
    )
    rotationReach.assertReached()
  },
)

/**
 * An expired run can rotate without Electric reset metadata, then persist one
 * demanded source row in its private generation. That row is a partial cache,
 * not an offline source snapshot. After a cold restart, the provider model has
 * no matching row. Real SQLite supplies incompatible key-set evidence and no
 * resume record; the installed SDK holds an empty subset HTTP response. Before
 * and after that response, the public Collection must not expose the stale
 * cached row. The generation must rotate before it can serve the new demand,
 * even when the caller supplies an explicit source offset or handle. Those
 * source cursor options do not certify the persisted cache's key set.
 */
fixedCase.each([
  { cursor: `none`, shapeCursor: {} },
  { cursor: `explicit offset`, shapeCursor: { offset: `now` as const } },
  { cursor: `explicit handle`, shapeCursor: { handle: `explicit-shape` } },
])(
  `keeps a partial cache without a reset marker private after cold restart with $cursor`,
  async ({ shapeCursor }) => {
    const database = new DatabaseSync(`:memory:`)
    const adapter = new SQLiteCorePersistenceAdapter({
      driver: nodeSqliteDriver(database),
    })
    const collectionId = `sdk-cold-expired-cache-${++sequence}`
    const first = await adapter.claimCacheGeneration(collectionId)
    const partial = await adapter.rotateCacheGeneration(
      collectionId,
      first.claimId,
    )
    await adapter.applyCommittedTx(
      {
        kind: `managed`,
        storageCollectionId: partial.storageCollectionId,
        claimId: partial.claimId,
      },
      {
        txId: `partial-subset-row`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: partial.claimId,
        mutations: [
          {
            type: `insert`,
            key: 1,
            value: { id: 1, name: `stale-partial` },
          },
        ],
      },
    )
    const seeded = await adapter.loadResumeSnapshot(
      {
        kind: `managed`,
        storageCollectionId: partial.storageCollectionId,
        claimId: partial.claimId,
      },
      { cacheGenerationClaimId: partial.claimId },
    )
    expect(seeded.keySet).toEqual({ status: `incompatible` })
    expect(seeded.collectionMetadata).toEqual([])
    await adapter.releaseCacheGenerationClaim(partial.claimId)

    const http = controlledHttp()
    const electric = electricCollectionOptions<Item>({
      id: collectionId,
      shapeOptions: {
        url: `http://test-url/${collectionId}`,
        params: { table: `rows` },
        fetchClient: http.fetchClient,
        ...shapeCursor,
      },
      syncMode: `on-demand`,
      startSync: true,
      getKey: (row) => row.id,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        ElectricCollectionUtils<Item>
      >({ ...electric, persistence: { adapter } }),
    )

    try {
      await withElectricCleanup(async () => {
        const stream = await atCheckpoint(http.take(), `cold restart stream`)
        expect(stream.url.searchParams.get(`log`)).toBe(`changes_only`)
        const load = Promise.resolve(
          collection._sync.loadSubset({
            where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(1)]),
          }),
        )
        void load.catch(() => undefined)
        const request = await atCheckpoint(
          http.take(true),
          `cold restart source snapshot`,
        )
        expect(collection.get(1), `before source evidence`).toBeUndefined()
        const current = await adapter.claimCacheGeneration(collectionId)
        try {
          expect(current.storageCollectionId).not.toBe(
            partial.storageCollectionId,
          )
        } finally {
          await adapter.releaseCacheGenerationClaim(current.claimId)
        }

        request.respond(
          new Response(
            JSON.stringify({
              metadata: {
                xmin: `10`,
                xmax: `20`,
                xip_list: [],
                database_lsn: `10`,
                snapshot_mark: 2,
              },
              data: [],
            }),
            { headers: headers(2) },
          ),
        )
        await atCheckpoint(load, `empty source snapshot applied`)
        expect(collection.status).toBe(`ready`)
        expect(collection.get(1), `after empty source evidence`).toBeUndefined()
      }, [() => collection.cleanup(), () => http.close()])
    } finally {
      database.close()
    }
  },
)

/**
 * Two active demands share one ShapeStream cursor. The source model gives each
 * predicate one row and increasing offsets. The second provider snapshot may
 * start only after the first settles; otherwise an older HTTP response can
 * overwrite a later row and regress that cursor. The SDK method invocation is
 * the checkpoint, while public rows verify both acquisitions still apply.
 */
fixedCase(
  `serializes concurrent subset snapshots on one SDK stream`,
  async () => {
    const http = controlledHttp()
    const requestSnapshot = vi.spyOn(ShapeStream.prototype, `requestSnapshot`)
    const collection = createCollection(
      electricCollectionOptions<Item>({
        id: `sdk-ordered-snapshots-${++sequence}`,
        shapeOptions: {
          url: `http://test-url/ordered-snapshots-${sequence}`,
          params: { table: `rows` },
          fetchClient: http.fetchClient,
        },
        syncMode: `on-demand`,
        startSync: true,
        getKey: (row) => row.id,
      }),
    )
    const demand = (id: number) => ({
      where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(id)]),
    })
    const respond = (request: Request, id: number) =>
      request.respond(
        new Response(
          JSON.stringify({
            metadata: {
              xmin: `10`,
              xmax: `20`,
              xip_list: [],
              database_lsn: `10`,
              snapshot_mark: id,
            },
            data: [
              {
                key: String(id),
                value: { id: String(id), name: `row-${id}` },
                headers: { operation: `insert` },
              },
            ],
          }),
          { headers: headers(id + 1) },
        ),
      )
    await withElectricCleanup(async () => {
      await atCheckpoint(http.take(), `initial ordered-snapshot transport`)
      const first = Promise.resolve(collection._sync.loadSubset(demand(1)))
      const second = Promise.resolve(collection._sync.loadSubset(demand(2)))
      const firstRequest = await atCheckpoint(
        http.take(true),
        `first ordered snapshot`,
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(
        requestSnapshot,
        `second snapshot waits for first`,
      ).toHaveBeenCalledTimes(1)
      respond(firstRequest, 1)
      await atCheckpoint(first, `first ordered snapshot applied`)
      const secondRequest = await atCheckpoint(
        http.take(true),
        `second ordered snapshot`,
      )
      expect(requestSnapshot).toHaveBeenCalledTimes(2)
      respond(secondRequest, 2)
      await atCheckpoint(second, `second ordered snapshot applied`)
      expect(collection.toArray.map(({ id, name }) => ({ id, name }))).toEqual([
        { id: 1, name: `row-1` },
        { id: 2, name: `row-2` },
      ])
    }, [
      () => collection.cleanup(),
      () => http.close(),
      () => requestSnapshot.mockRestore(),
      () => expect(http.activeCount()).toBe(0),
    ])
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
 * Restart demand must remain legal when recovery changes provider capability.
 * Electric's SDK permits requestSnapshot only in changes_only mode. The
 * LoadSubsetFn contract requires success to follow application of the rows
 * that establish the requested subset. This receiving witness uses the real
 * SDK with the same durable-storage seam as the tag-history owner.
 *
 * The independent model is a complete replacement row after the second
 * launch. Tagged and untagged launches differ only in provider acquisition:
 * the tagged launch cannot resume its prior cursor, but its on-demand stream
 * can start changes-only and request the active subset. The untagged neighbor
 * resumes its cursor. Both must satisfy the same subset demand.
 * A new descriptor and Collection discard all prior in-memory tag state.
 * This checks SDK behavior over controlled HTTP, not server tag generation,
 * native SQLite, or a separate operating-system process.
 * One source snapshot for id = 1 may satisfy the live query's active demand.
 * The receiver verifies that scope before returning the authored row. The
 * law judges applied rows and demand settlement, not the number of physical
 * snapshot requests.
 */
fixedCase.each(
  [false, true].flatMap((tagged) =>
    ([`direct`, `live-query`] as const).map((consumer) => ({
      tagged,
      consumer,
    })),
  ),
)(
  `satisfies subset demand after a fresh persisted launch, tagged=$tagged consumer=$consumer`,
  async ({ tagged, consumer }) => {
    const { adapter, rows, metadata } = managedTagPersistence()
    const collectionId = `sdk-persisted-restart-${++sequence}`
    const http = controlledHttp()
    const firstRow: TestRow = { id: 1, name: `first`, stable: `retained` }
    const replacement: TestRow = { ...firstRow, name: `replacement` }
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
          persistence: { adapter },
        }),
      )
    const message = (row: TestRow) => ({
      key: String(row.id),
      value: { ...row, id: String(row.id) },
      headers: {
        operation: `insert`,
        ...(tagged ? { tags: [`selected`] } : {}),
      },
    })
    const responseHeaders = (offset: number) => ({
      ...headers(offset),
      'electric-schema': JSON.stringify({
        id: { type: `int4` },
        name: { type: `text` },
        stable: { type: `text` },
      }),
    })
    const snapshotResponse = (row: TestRow, offset: number) =>
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: offset,
          },
          data: [message(row)],
        }),
        { headers: responseHeaders(offset) },
      )
    const demand = {
      where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(1)]),
    }
    const expectIdOneSnapshot = (request: Request) => {
      expect(request.url.searchParams.get(`subset__where`)).toBe(`"id" = $1`)
      expect(
        JSON.parse(request.url.searchParams.get(`subset__params`) ?? `null`),
      ).toEqual({ 1: `1` })
    }
    const first = create()
    let current = first
    let cleanupQuery = () => Promise.resolve()
    await withElectricCleanup(async () => {
      const initial = await atCheckpoint(
        http.take(),
        `first launch stream started`,
      )
      expect(initial.url.searchParams.get(`log`)).toBe(`changes_only`)
      const firstLoad = Promise.resolve(first._sync.loadSubset(demand))
      void firstLoad.catch(() => undefined)
      const request = await atCheckpoint(
        http.take(true),
        `first launch snapshot`,
      )
      expectIdOneSnapshot(request)
      request.respond(snapshotResponse(firstRow, 2))
      await atCheckpoint(firstLoad, `first launch subset applied`)
      await vi.waitFor(
        () =>
          expect(metadata().get(`electric:resume`)).toMatchObject({
            kind: `resume`,
            requiresTagState: tagged,
          }),
        { interval: 1 },
      )
      expect(rows().get(1)?.value).toEqual(firstRow)
      await first.cleanup()

      current = create()
      const resumed = await atCheckpoint(
        http.take(),
        `second launch stream started`,
      )
      expect(resumed.url.searchParams.get(`log`)).toBe(`changes_only`)
      expect(resumed.url.searchParams.get(`offset`)).toBe(
        tagged ? `now` : `2_0`,
      )
      const query =
        consumer === `live-query`
          ? createLiveQueryCollection({
              startSync: false,
              query: (q) =>
                q
                  .from({ row: current })
                  .where(({ row }) => eq(row.id, 1))
                  .select(({ row }) => ({
                    id: row.id,
                    name: row.name,
                    stable: row.stable,
                  })),
            })
          : undefined
      if (query) cleanupQuery = () => query.cleanup()
      const loading = Promise.resolve(
        query ? query.preload() : current._sync.loadSubset(demand),
      ).then(
        () => ({ kind: `fulfilled` as const }),
        (error: unknown) => ({
          kind: `rejected` as const,
          error: String(error),
        }),
      )
      const resumedSnapshot = await atCheckpoint(
        http.take(true),
        `resumed subset snapshot`,
      )
      expectIdOneSnapshot(resumedSnapshot)
      resumedSnapshot.respond(snapshotResponse(replacement, 3))
      const outcome = await atCheckpoint(
        loading,
        `second launch subset settled`,
      )
      await vi.waitFor(() => expect(current.status).toBe(`ready`), {
        interval: 1,
      })
      await vi.waitFor(
        () => expect(rows().get(1)?.value).toEqual(replacement),
        {
          interval: 1,
        },
      )
      // Observe settlement as well as rows. A ready Collection with correct
      // rows cannot excuse a rejected subset acquisition.
      expect({
        outcome,
        status: current.status,
        row: current.get(1),
      }).toMatchObject({
        outcome: { kind: `fulfilled` },
        status: `ready`,
        row: replacement,
      })
      if (query) {
        expect(query.status).toBe(`ready`)
        // This law observes selected payload values, not virtual metadata.
        expect(
          query.toArray.map(({ id, name, stable }) => ({ id, name, stable })),
        ).toEqual([replacement])
      }
    }, [
      () => cleanupQuery(),
      () => current.cleanup(),
      () => first.cleanup(),
      () => http.close(),
      () => expect(http.activeCount()).toBe(0),
    ])
  },
)

/**
 * A persisted source row is only a cache after tag state is lost. The source
 * model starts with A and B, then changes A and removes B while the Collection
 * is closed. Only A is active at the second launch. Its scoped snapshot may
 * establish A, but neither the old B row nor a later empty B snapshot may
 * re-admit B from SQLite. This driver observes HTTP scope, durable rows, local
 * reads, public rows, and acquisition settlement at each cut. The controlled
 * provider supplies authoritative responses for the requested predicates;
 * live-server framing and native storage remain separate receiving boundaries.
 * A local cache clear is not source readiness: the restarted Collection stays
 * loading at the stream-request cut, before Electric sends source evidence.
 */
fixedCase.each([
  { cause: `lost tags`, tagged: true, nextTable: `rows` },
  { cause: `changed shape`, tagged: false, nextTable: `other_rows` },
  {
    cause: `malformed resume state`,
    tagged: false,
    nextTable: `rows`,
    malformed: true,
  },
])(
  `quarantines uncertified cache rows across later scoped demands after $cause`,
  async ({ tagged, nextTable, malformed }) => {
    const fixture = managedTagPersistence()
    const { adapter, rows, metadata } = fixture
    const baselineReads = vi.spyOn(adapter, `loadResumeSnapshot`)
    const http = controlledHttp()
    const collectionId = `sdk-scoped-restart-${++sequence}`
    const coordinator = controlledCoordinator(collectionId)
    let currentCapability: SyncPersistenceCapabilityV1<string | number> | null =
      null
    const source = new Map<number, TestRow>([
      [1, { id: 1, name: `old-a`, stable: `a` }],
      [2, { id: 2, name: `old-b`, stable: `b` }],
    ])
    const demand = (id: number) => ({
      where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(id)]),
    })
    const create = (table = `rows`) => {
      const electricOptions = electricCollectionOptions<TestRow>({
        id: collectionId,
        shapeOptions: {
          url: `http://test-url/${collectionId}`,
          params: { table },
          fetchClient: http.fetchClient,
        },
        syncMode: `on-demand`,
        startSync: true,
        getKey: (row) => row.id,
      })
      return createCollection(
        persistedCollectionOptions<
          TestRow,
          string | number,
          never,
          ElectricCollectionUtils<TestRow>
        >({
          ...electricOptions,
          sync: {
            ...electricOptions.sync,
            sync: (params) => {
              currentCapability = params.metadata?.persistence ?? null
              return electricOptions.sync.sync(params)
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
    }
    const respond = (
      request: Request,
      result: Array<TestRow>,
      offset: number,
    ) =>
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
            data: result.map((row) => ({
              key: String(row.id),
              value: { ...row, id: String(row.id) },
              headers: {
                operation: `insert`,
                ...(tagged ? { tags: [`selected`] } : {}),
              },
            })),
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
    const publicRows = (collection: ReturnType<typeof create>) =>
      collection.toArray
        .map(({ id, name, stable }) => ({ id, name, stable }))
        .sort((a, b) => a.id - b.id)
    const first = create()
    let current = first
    let localReads: { mockRestore: () => void } | undefined
    await withElectricCleanup(async () => {
      await atCheckpoint(http.take(), `initial changes-only transport`)
      for (const [id, row] of source) {
        const loading = Promise.resolve(first._sync.loadSubset(demand(id)))
        const request = await atCheckpoint(
          http.take(true),
          `initial subset ${id}`,
        )
        respond(request, [row], id + 1)
        await atCheckpoint(loading, `initial subset ${id} applied`)
      }
      expect(publicRows(first)).toEqual([...source.values()])
      expect(rows().size).toBe(2)
      expect(metadata().get(`electric:resume`)).toMatchObject({
        kind: `resume`,
        requiresTagState: tagged,
      })
      await first.cleanup()
      baselineReads.mockClear()
      if (malformed) {
        metadata().set(`electric:resume`, { kind: `resume`, offset: 10 })
      }
      const oldStorageId = fixture.currentStorageId()

      source.set(1, { id: 1, name: `new-a`, stable: `a` })
      source.delete(2)
      localReads = vi.spyOn(adapter, `loadSubset`)
      current = create(nextTable)
      const resumed = await atCheckpoint(
        http.take(),
        `scoped restart transport`,
      )
      expect(resumed.url.searchParams.get(`log`)).toBe(`changes_only`)
      expect(resumed.url.searchParams.get(`offset`)).toBe(`now`)
      expect(publicRows(current), `before active demand`).toEqual([])
      expect(current.status, `before source readiness`).toBe(`loading`)
      expect(baselineReads, `startup metadata read`).toHaveBeenCalled()
      expect(
        baselineReads.mock.calls.every(
          ([, context]) => context?.includeRows !== true,
        ),
        `no full baseline row read`,
      ).toBe(true)

      if (!tagged) {
        // An empty first source snapshot must still establish its own demand
        // without promoting the stale durable B row into the Collection.
        const emptyFirst = Promise.resolve(current._sync.loadSubset(demand(2)))
        const emptyRequest = await atCheckpoint(
          http.take(true),
          `first empty scoped snapshot`,
        )
        expect(localReads).not.toHaveBeenCalled()
        respond(emptyRequest, [], 4)
        await atCheckpoint(emptyFirst, `first empty subset applied`)
        expect(publicRows(current), `after first empty subset`).toEqual([])
      }

      const loadingA = Promise.resolve(
        current._sync.loadSubset({ ...demand(1), limit: 10 }),
      )
      const requestA = await atCheckpoint(http.take(true), `scoped A snapshot`)
      expect(requestA.url.searchParams.get(`subset__where`)).toContain(`id`)
      expect(localReads).not.toHaveBeenCalled()
      respond(requestA, [source.get(1)!], tagged ? 4 : 5)
      await atCheckpoint(loadingA, `scoped A applied`)
      expect(publicRows(current), `after A applied`).toEqual([source.get(1)])
      expect(
        fixture.rowsAt(oldStorageId).get(2)?.value,
        `durable B retained`,
      ).toEqual({
        id: 2,
        name: `old-b`,
        stable: `b`,
      })

      // A second tab updates durable cache outside the active A demand. The
      // provider has not sent another source change, so the public A row still
      // follows its applied source snapshot. The capability scan fences the
      // coordinator's async handling before this public observation.
      const durablePosition = await adapter.loadResumeSnapshot(
        { kind: `eager`, collectionId: collectionId },
        {
          includeRows: false,
        },
      )
      const otherTabRow: TestRow = {
        id: 3,
        name: `other-tab-cache`,
        stable: `c`,
      }
      source.set(3, otherTabRow)
      rows().set(3, { value: otherTabRow })
      coordinator.emit({
        type: `tx:committed`,
        term: durablePosition.latestTerm,
        seq: durablePosition.latestSeq + 1,
        txId: `other-tab-cache-update`,
        latestRowVersion: durablePosition.latestRowVersion + 1,
        requiresFullReload: false,
        changedRows: [{ key: 3, value: otherTabRow }],
        deletedKeys: [],
      })
      expect(currentCapability?.scanPersistedRows).toBeTypeOf(`function`)
      await currentCapability!.scanPersistedRows()
      expect(publicRows(current), `after coordinator invalidation`).toEqual([
        source.get(1),
      ])

      if (tagged) {
        // The coordinator may refresh A, but the new physical cache does not
        // require that request. Service it first only if the provider sends
        // it; either path must leave B absent after B's empty snapshot.
        const loadingB = Promise.resolve(current._sync.loadSubset(demand(2)))
        let requestB = await atCheckpoint(http.take(true), `empty B snapshot`)
        let bOffset = 5
        if (requestB.url.searchParams.get(`subset__params`)?.includes(`:"1"`)) {
          respond(requestB, [source.get(1)!], 5)
          requestB = await atCheckpoint(http.take(true), `empty B snapshot`)
          bOffset = 6
        }
        expect(requestB.url.searchParams.get(`subset__params`)).toContain(`"2"`)
        expect(publicRows(current), `while B is pending`).toEqual([
          source.get(1),
        ])
        expect(localReads).not.toHaveBeenCalled()
        respond(requestB, [], bOffset)
        await atCheckpoint(loadingB, `empty B applied`)
        expect(publicRows(current), `after empty B applied`).toEqual([
          source.get(1),
        ])
      }
      expect(metadata().get(`electric:resume`)).toMatchObject({ kind: `reset` })

      await current.cleanup()
      localReads.mockRestore()
      localReads = vi.spyOn(adapter, `loadSubset`)
      current = create(nextTable)
      const idle = await atCheckpoint(http.take(), `idle scoped restart`)
      expect(idle.url.searchParams.get(`log`)).toBe(`changes_only`)
      expect(idle.url.searchParams.get(`offset`)).toBe(`now`)
      expect(publicRows(current), `no active demand`).toEqual([])
      expect(localReads, `no unrestricted local read`).not.toHaveBeenCalled()
      expect(
        baselineReads.mock.calls.every(
          ([, context]) => context?.includeRows !== true,
        ),
        `no full baseline row read without demand`,
      ).toBe(true)
      expect(
        fixture.rowsAt(oldStorageId).get(2)?.value,
        `cache retained without demand`,
      ).toMatchObject({
        id: 2,
        name: `old-b`,
      })
    }, [
      () => current.cleanup(),
      () => first.cleanup(),
      () => http.close(),
      () => localReads?.mockRestore(),
      () => baselineReads.mockRestore(),
      () => expect(http.activeCount()).toBe(0),
    ])
  },
)

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
 * Limits: the lane observes the browser listener in jsdom. Client versions
 * that observe React Native's AppState instead register through a runtime
 * adapter, which this lane does not install. A live Electric service and
 * snapshot requests are outside this lane. The managed cache rotation case
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

const createReleaseReach = () =>
  createOracleReach<ReleaseState>(`electric.sdk-source-release`, [
    `cleanup-while-loading`,
    `cleanup-after-ready`,
    `cleanup-after-give-up`,
    `cleanup-after-abort`,
    `cleanup-of-restarted-run`,
    `cleanup-after-partial-delivery`,
    `cleanup-during-reset`,
    `cleanup-during-retry-decision`,
  ])
// Each campaign declares its own reach.
let releaseReach = createReleaseReach()

async function checkSourceRelease(history: ReleaseHistory): Promise<void> {
  releaseReach.beginHistory()
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
        releaseReach.reach(`cleanup-during-retry-decision`)
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

      releaseReach.reach(
        external.signal.aborted
          ? `cleanup-after-abort`
          : !sending
            ? `cleanup-after-give-up`
            : collection.status === `ready`
              ? `cleanup-after-ready`
              : `cleanup-while-loading`,
      )
      if (index > 0) releaseReach.reach(`cleanup-of-restarted-run`)
      if (pendingAnswers.has(`row`))
        releaseReach.reach(`cleanup-after-partial-delivery`)
      if (pendingAnswers.has(`reset`))
        releaseReach.reach(`cleanup-during-reset`)
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
fixedCase.each([`eager`, `on-demand`, `progressive`] as const)(
  `releases listeners after incomplete delivery in %s mode`,
  async (mode) => {
    for (const answer of [`row`, `reset`] as const)
      for (const end of [
        `open`,
        `give-up`,
        `abort`,
        `deciding-retry`,
        `deciding-give-up`,
      ] as const)
        await checkSourceRelease({ mode, runs: [{ answers: [answer], end }] })
  },
)

const releaseViolation = sameViolation()
const releaseProperty = fc.asyncProperty(
  fc.record({
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
  }),
  (history: ReleaseHistory) =>
    releaseViolation.check(history, () => checkSourceRelease(history)),
)
sdkCampaigns(
  `electric.sdk-source-release`,
  `releases every installed-SDK stream listener when a sync run is cleaned up`,
  20261024,
  releaseViolation,
  async (seed) => {
    releaseReach = createReleaseReach()
    await fc.assert(releaseProperty, {
      ...oraclePropertyOptions(40, `electric.sdk-source-release`),
      ...(seed === undefined ? {} : { seed }),
    })
    releaseReach.assertReached()
  },
)
