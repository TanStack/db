import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { IR, createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { electricCollectionOptions } from '../src/electric'
import {
  oraclePropertyOptions,
  readOracleRunConfig,
} from '../../db/tests/oracle-config'
import {
  atCheckpoint,
  withElectricCleanup,
  withElectricSetup,
} from './electric-oracle-lifecycle'
import type { Message } from '@electric-sql/client'

/**
 * # Does the installed Electric SDK deliver the adapter's assumed protocol?
 *
 * The Collection subset contract and the Electric adapter's tagged-row
 * contract are owned by electric-oracle.property.test.ts. The installed SDK's
 * reset framing is checked by electric-sdk-framing-oracle.test.ts. This driver
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
 *
 * These finite HTTP fixtures do not prove that a live Electric service emits
 * the authored snapshot or move frames, nor do they cover multiple row keys,
 * network retries, native persistence hosts, or arbitrary provider schedules.
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
