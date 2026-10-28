/**
 * A truncate replacement owes every current participant and accepted receipt.
 * Under #2168 and architecture law 16, abort ends an obsolete load for core,
 * even while its provider promise remains pending. Failure leaves the last complete publication visible;
 * ordinary later writes cannot supply the missing authority. Each live-query
 * owner has its own publication barrier; a peer holds no authority over it. Retiring one
 * logical owner removes only its obligations. Cleanup terminates old graphs.
 * Authority: live/ARCHITECTURE.md, Replay participants and failure, normative
 * laws 7, 9 and 14; types.ts LoadSubsetFn and SyncAppliedReceipt.
 *
 * The scientific model below retains authored snapshots, active logical
 * owners, outstanding participant obligations, receipt application and failure.
 * It knows no replay queues, graph counters, source cursors or page chains.
 * Its attempt number names authored work, not a production generation token.
 * The driver maps these facts onto real sync commits, two live-query owners,
 * actual optimistic holds and adapter promises. Every publication callback and
 * every drained semantic action compares public rows with the last complete
 * model snapshot. Cleanup abandons accepted work and closes the old model.
 *
 * Grammar controls: 1–4 rows, signed row values, independently permuted current
 * participant settlement, obsolete success/AbortError, owner retirement before
 * or after retry acceptance, 1–3 ordinary revisions after failure, and cleanup
 * before/after releasing its held receipt. Each history reconstructs the known
 * overlap and failed-write witnesses; removing overlap, failure, receipt holds
 * or retirement removes its corresponding distinguishing checkpoint. Starting
 * a request-scoped write after observing abort is excluded. Limits: one source,
 * two full filtered owners, no joined/includes graph or throwing callbacks.
 */
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { createTransaction } from '../../src/transactions.js'
import { runOracleCampaign } from '../oracle-campaign.js'
import { oracleRuns } from '../oracle-config'
import { flushPromises, withOracleCleanup } from '../utils.js'
import type {
  LoadSubsetOptions,
  SyncAppliedReceipt,
  SyncConfig,
} from '../../src/types.js'

type Row = { id: string; version: number; value: number; kind: `data` | `hold` }
type PublicRow = Pick<Row, `id` | `version` | `value`>
type Owner = `main` | `peer`
const normalize = (rows: ReadonlyArray<PublicRow>) =>
  rows
    .map(({ id, version, value }) => ({ id, version, value }))
    .sort((a, b) => a.id.localeCompare(b.id))

// Last complete publication and current obligations are distinguishable: the
// same new rows remain private with an older participant or a failed owner,
// but become public once all still-owned work and receipts establish success.
class ReplayPublicationModel {
  readonly owners = new Set<Owner>([`main`, `peer`])
  readonly visible = new Map<Owner, Array<PublicRow>>()
  private replacement: Array<PublicRow>
  private readonly participants = new Map<
    string,
    { owner: Owner; attempt: number }
  >()
  private readonly receipts = new Set<string>()
  private readonly failed = new Set<Owner>()
  private latest = 0
  private readonly replaying = new Set<Owner>()
  private closed = false

  constructor(initial: Array<PublicRow>) {
    this.replacement = normalize(initial)
    for (const owner of this.owners) this.visible.set(owner, normalize(initial))
  }
  start(): number {
    if (this.closed) throw new Error(`model: replay after cleanup`)
    for (const owner of this.owners) this.replaying.add(owner)
    this.failed.clear()
    // A replacement aborts the prior attempts. Accepted writes still owe
    // their receipts, but obsolete provider settlement holds no readiness.
    this.participants.clear()
    const attempt = ++this.latest
    for (const owner of this.owners)
      this.participants.set(`${attempt}:${owner}`, { owner, attempt })
    return attempt
  }
  accept(id: string, rows: Array<PublicRow>): void {
    this.replacement = normalize(rows)
    this.receipts.add(id)
  }
  apply(id: string): void {
    this.receipts.delete(id)
    this.publishIfComplete()
  }
  settle(attempt: number, owner: Owner, failed: boolean): void {
    this.participants.delete(`${attempt}:${owner}`)
    if (
      !this.closed &&
      this.owners.has(owner) &&
      attempt === this.latest &&
      failed
    )
      this.failed.add(owner)
    this.publishIfComplete()
  }
  retire(owner: Owner): void {
    this.owners.delete(owner)
    this.failed.delete(owner)
    for (const [id, participant] of this.participants)
      if (participant.owner === owner) this.participants.delete(id)
    this.publishIfComplete()
  }
  cleanup(): void {
    this.closed = true
  }
  private publishIfComplete(): void {
    if (this.closed || this.receipts.size) return
    for (const owner of this.owners) {
      if (!this.replaying.has(owner) || this.failed.has(owner)) continue
      if (
        [...this.participants.values()].some(
          (participant) => participant.owner === owner,
        )
      )
        continue
      this.visible.set(owner, normalize(this.replacement))
      this.replaying.delete(owner)
    }
  }
}

type Scenario = {
  count: number
  value: number
  mainFirst: boolean
  obsoleteRejects: boolean
  retireBeforeAccept: boolean
  ordinaryWrites: number
  releaseBeforeCleanup: boolean
}
const scenario = fc.record({
  count: fc.integer({ min: 1, max: 4 }),
  value: fc.integer({ min: -20, max: 20 }),
  mainFirst: fc.boolean(),
  obsoleteRejects: fc.boolean(),
  retireBeforeAccept: fc.boolean(),
  ordinaryWrites: fc.integer({ min: 1, max: 3 }),
  releaseBeforeCleanup: fc.boolean(),
})

async function runHistory(h: Scenario) {
  const rows = (version: number): Array<Row> =>
    Array.from({ length: h.count }, (_, i) => ({
      id: `row${i}`,
      version,
      value: h.value + i + version,
      kind: `data`,
    }))
  const model = new ReplayPublicationModel(rows(1))
  const failures: Array<unknown> = []
  let action = `initial`
  const reaches = new Set<string>()
  let operations!: Parameters<SyncConfig<Row>[`sync`]>[0]
  let run = 0
  let firstLoad = true
  let currentAttempt = 0
  const loads: Array<{
    owner: Owner
    attempt: number
    options: LoadSubsetOptions
    outcome: ReturnType<typeof createDeferred<boolean>>
    done: Promise<void>
    settled: boolean
    receipts: Array<SyncAppliedReceipt>
  }> = []
  const subscriptions = new Map<LoadSubsetOptions[`subscription`], Owner>()
  const activeQueries: Array<{ cleanup: () => Promise<void> }> = []
  const source = createCollection<Row>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (controls) => {
        operations = controls
        run++
        firstLoad = true
        controls.markReady()
        return {
          loadSubset: (options) => {
            let owner = subscriptions.get(options.subscription)
            if (!owner) {
              owner = subscriptions.size === 0 ? `main` : `peer`
              subscriptions.set(options.subscription, owner)
            }
            if (currentAttempt === 0 || run > 1) {
              if (firstLoad) {
                firstLoad = false
                controls.begin()
                for (const value of rows(run > 1 ? 20 : 1))
                  controls.write({ type: `insert`, value })
                return controls.commit()
              }
              return true
            }
            const outcome = createDeferred<boolean>()
            const load = {
              owner,
              attempt: currentAttempt,
              options,
              outcome,
              done: Promise.resolve(),
              settled: false,
              receipts: [] as Array<SyncAppliedReceipt>,
            }
            // A conforming adapter cannot report success before its actual
            // establishing receipt. Obsolete work has no later request writes.
            load.done = outcome.promise.then(async (failed) => {
              await Promise.all(load.receipts)
              load.settled = true
              model.settle(load.attempt, load.owner, failed)
              if (failed) throw new Error(`authored replacement failed`)
              if (options.signal?.aborted && h.obsoleteRejects)
                throw new DOMException(`obsolete`, `AbortError`)
            })
            void load.done.catch(() => undefined)
            loads.push(load)
            return load.done
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const createQuery = () =>
    createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .where(({ row }) => eq(row.kind, `data`))
        .select(({ row }) => ({
          id: row.id,
          version: row.version,
          value: row.value,
        })),
    )
  const main = createQuery()
  const peer = createQuery()
  activeQueries.push(main, peer)
  const publications = new Map<Owner, Array<Array<PublicRow>>>([
    [`main`, []],
    [`peer`, []],
  ])
  const record = (owner: Owner, query: typeof main) =>
    query.subscribeChanges(
      () => {
        const observed = normalize(query.toArray)
        publications.get(owner)!.push(observed)
        if (currentAttempt > 0) {
          try {
            expect(
              observed,
              `joint replay publication ${owner} during ${action}`,
            ).toEqual(model.visible.get(owner))
          } catch (error) {
            failures.push(error)
          }
        }
      },
      { includeInitialState: true },
    )
  const mainSubscription = record(`main`, main)
  const peerSubscription = record(`peer`, peer)
  let held: { release: () => void; done: Promise<unknown> } | undefined
  const hold = () => {
    const pending = createDeferred<void>()
    const transaction = createTransaction({ mutationFn: () => pending.promise })
    transaction.mutate(() =>
      source.insert({ id: `hold`, version: 0, value: 0, kind: `hold` }),
    )
    held = { release: pending.resolve, done: transaction.when('settled') }
  }
  const release = async () => {
    if (!held) return
    const pending = held
    held = undefined
    action = `apply held receipt`
    pending.release()
    await pending.done
    await flushPromises()
  }
  const checkpoint = async (label: string) => {
    await flushPromises()
    if (failures.length) throw failures[0]
    expect(normalize(main.toArray), `joint replay ${label}: main`).toEqual(
      model.visible.get(`main`),
    )
    if (model.owners.has(`peer`))
      expect(normalize(peer.toArray), `joint replay ${label}: peer`).toEqual(
        model.visible.get(`peer`),
      )
  }
  const start = async () => {
    currentAttempt = model.start()
    action = `start replay ${currentAttempt}`
    operations.begin()
    operations.truncate()
    operations.commit()
    await checkpoint(`start ${currentAttempt}`)
  }
  const accept = (version: number) => {
    const id = `receipt${version}`
    action = `accept revision ${version}`
    model.accept(id, rows(version))
    operations.begin()
    for (const value of rows(version))
      operations.write({
        type: source.base.has(value.id) ? `update` : `insert`,
        value,
      })
    const receipt = operations.commit()
    for (const load of loads)
      if (
        load.attempt === currentAttempt &&
        !load.settled &&
        model.owners.has(load.owner)
      )
        load.receipts.push(receipt)
    if (receipt === true) model.apply(id)
    else
      void receipt.then(
        () => model.apply(id),
        () => {
          /* cleanup abandons accepted work */
        },
      )
    return receipt
  }
  const settle = async (attempt: number, failed: boolean) => {
    const owned = loads.filter((load) => load.attempt === attempt)
    const ordered = h.mainFirst ? owned : [...owned].reverse()
    for (const load of ordered) {
      action = `settle ${attempt}:${load.owner}`
      load.outcome.resolve(failed)
      await checkpoint(`settle ${attempt}:${load.owner}`)
    }
  }
  await withOracleCleanup(async () => {
    await Promise.all([main.preload(), peer.preload()])
    expect(normalize(main.toArray)).toEqual(normalize(rows(1)))
    expect(normalize(peer.toArray)).toEqual(normalize(rows(1)))
    await start() // A provider promise remains pending after its abort.
    await start() // B is authoritative; A no longer gates publication.
    expect(loads.filter((load) => load.attempt === 1)).toHaveLength(2)
    expect(loads.filter((load) => load.attempt === 2)).toHaveLength(2)
    expect(
      loads
        .filter((load) => load.attempt === 1)
        .every((load) => load.options.signal?.aborted),
    ).toBe(true)
    hold()
    const heldReceipt = accept(3)
    expect(heldReceipt).toBeInstanceOf(Promise)
    for (const load of loads.filter((candidate) => candidate.attempt === 2))
      load.outcome.resolve(false)
    await checkpoint(`accepted held replacement`)
    expect(
      loads.filter((load) => load.attempt === 2).every((load) => !load.settled),
    ).toBe(true)
    reaches.add(`overlap-with-held-receipt`)
    await release()
    await checkpoint(`newest settles before older`)
    expect(
      loads.filter((load) => load.attempt === 2).every((load) => load.settled),
    ).toBe(true)
    expect(
      loads.filter((load) => load.attempt === 1).every((load) => !load.settled),
    ).toBe(true)
    expect(normalize(main.toArray)).toEqual(normalize(rows(3)))
    reaches.add(`newest-done-older-aborted`)
    await settle(1, false)
    await checkpoint(`all overlapping work settled`)
    expect(normalize(main.toArray)).toEqual(normalize(rows(3)))

    await start()
    accept(4)
    await settle(3, true)
    const failurePublications = publications.get(`main`)!.length
    for (let i = 0; i < h.ordinaryWrites; i++) {
      accept(5 + i)
      await checkpoint(`ordinary write after failure ${i}`)
      expect(publications.get(`main`)!).toHaveLength(failurePublications)
    }
    reaches.add(`failure-keeps-ordinary-writes-private`)
    await start()
    const retirePeer = async () => {
      model.retire(`peer`)
      peerSubscription.unsubscribe()
      await peer.cleanup()
      await checkpoint(`peer retired`)
    }
    if (h.retireBeforeAccept) await retirePeer()
    accept(10)
    if (!h.retireBeforeAccept) await retirePeer()
    const survivor = loads.find(
      (load) => load.attempt === 4 && load.owner === `main`,
    )!
    survivor.outcome.resolve(false)
    await checkpoint(`surviving owner succeeds`)
    expect(normalize(main.toArray)).toEqual(normalize(rows(10)))
    reaches.add(`retired-peer-does-not-block-retry`)

    await start()
    hold()
    accept(11)
    if (h.releaseBeforeCleanup) await release()
    model.cleanup()
    // Internal teardown retains the crash boundary. Public cleanup refuses
    // this active dependent under architecture law 14.
    await expect(source.cleanup()).rejects.toThrow(`dependent(s) read it`)
    await source._lifecycle.cleanup()
    expect(main.status).toBe(`crashed`)
    await release()
    // Old completions and their errors may release resources but cannot revive
    // the terminal graph. A fresh dependent belongs to the restarted sync run.
    for (const load of loads) load.outcome.resolve(false)
    source.startSyncImmediate()
    const fresh = createQuery()
    activeQueries.push(fresh)
    await fresh.preload()
    await checkpoint(`cleanup and restarted source`)
    expect(normalize(main.toArray)).toEqual(normalize(rows(10)))
    expect(main.status).toBe(`crashed`)
    expect(normalize(fresh.toArray)).toEqual(normalize(rows(20)))
    reaches.add(`cleanup-holds-old-graph-terminal`)
  }, [
    async () => {
      for (const load of loads) load.outcome.resolve(false)
      await release()
    },
    () => mainSubscription.unsubscribe(),
    () => peerSubscription.unsubscribe(),
    async () => {
      for (const query of activeQueries) await query.cleanup()
    },
    () => source.cleanup(),
  ])
  return reaches
}

it(`composes overlapping replay receipts, failure, surviving ownership and restart`, async () => {
  await runOracleCampaign(
    `JOINT_REPLAY_ORACLE`,
    [
      `overlap-with-held-receipt`,
      `newest-done-older-aborted`,
      `failure-keeps-ordinary-writes-private`,
      `retired-peer-does-not-block-retry`,
      `cleanup-holds-old-graph-terminal`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(scenario, async (h) => {
          reach.beginHistory()
          const observed = await runHistory(h)
          for (const state of [
            `overlap-with-held-receipt`,
            `newest-done-older-aborted`,
            `failure-keeps-ordinary-writes-private`,
            `retired-peer-does-not-block-retry`,
            `cleanup-holds-old-graph-terminal`,
          ] as const) {
            expect(observed.has(state)).toBe(true)
            reach.reach(state)
          }
        }),
        { numRuns: oracleRuns(35), ...parameters },
      ),
    { fixedSeed: 20261027 },
  )
}, 60000)
