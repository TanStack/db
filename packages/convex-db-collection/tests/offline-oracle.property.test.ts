/**
 * The Convex offline bridge sends one durable idempotency key, then waits for
 * source acceptance. Argument construction and rejected server mutations are
 * terminal application failures; a sync failure after server confirmation may
 * be retried with that same key. This is the bridge's public retry contract,
 * received by the existing outbox engine's NonRetriableError boundary.
 *
 * The model is an ordered dependency list: args, mutation, sync. A failure
 * admits only its prefix. Each generated history constructively crosses every
 * failure stage with arbitrary text and durable keys; this prevents a random
 * campaign from missing a classification boundary. The comparison checks calls
 * and caller error after settlement. Storage and leadership have other owners.
 */
import { createCollection, withAcceptedReceipt } from '@tanstack/db'
import fc from 'fast-check'
import { NonRetriableError } from '@tanstack/offline-transactions'
import { makeFunctionReference } from 'convex/server'
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { oracleRuns } from '../../db/tests/oracle-config'
import { convexCollectionOptions } from '../src/index'
import { convexOfflineMutation } from '../src/offline'
import { controlledClient, query, withTestCleanup } from './helpers'
import type { Row } from './helpers'
import type { ConvexClient } from 'convex/browser'
import type { OfflineConfig } from '@tanstack/offline-transactions'

const mutation = makeFunctionReference<
  `mutation`,
  { idempotencyKey: string; text: string },
  null
>(`tasks:save`)
const stages = [`args`, `mutation`, `sync`] as const
const failures = [`none`, ...stages] as const

it(`preserves ordered replay and retry classification across bridge failures`, async () => {
  await runOracleCampaign(
    `CONVEX_OFFLINE_ORACLE`,
    failures,
    async (reach, parameters) => {
      const property = fc.asyncProperty(
        fc.record({
          key: fc.string({ maxLength: 15 }),
          text: fc.string({ maxLength: 15 }),
        }),
        async ({ key, text }) => {
          reach.beginHistory()
          for (const failure of failures) {
            const trace: Array<string> = []
            const cause = new Error(`injected ${failure}`)
            const enter = (stage: string) => {
              trace.push(stage)
              if (failure === stage) throw cause
            }
            const send = (
              _ref: unknown,
              args: { idempotencyKey: string; text: string },
            ) => {
              enter(`mutation`)
              expect(args).toEqual({ idempotencyKey: key, text })
              return Promise.resolve(null)
            }
            const persist = convexOfflineMutation({
              client: { mutation: send } as unknown as Pick<
                ConvexClient,
                `mutation`
              >,
              mutation,
              getArgs: () => {
                enter(`args`)
                return { text }
              },
              collections: [
                {
                  utils: {
                    awaitSync: () => {
                      enter(`sync`)
                      return Promise.resolve()
                    },
                  },
                },
              ],
            })
            const params = {
              transaction: { mutations: [] },
              idempotencyKey: key,
            } as unknown as Parameters<OfflineConfig[`mutationFns`][string]>[0]
            const observed = await persist(params).then(
              () => ({ status: `fulfilled` as const }),
              (error: unknown) => ({ status: `rejected` as const, error }),
            )
            reach.reach(failure)
            const boundary = stages.indexOf(failure as (typeof stages)[number])
            expect(trace).toEqual(
              boundary === -1 ? stages : stages.slice(0, boundary + 1),
            )
            expect(observed.status).toBe(
              boundary === -1 ? `fulfilled` : `rejected`,
            )
            if (observed.status === `rejected`) {
              if (boundary < 2)
                expect(observed.error).toBeInstanceOf(NonRetriableError)
              else expect(observed.error).toBe(cause)
            }
          }
        },
      )
      await fc.assert(property, { numRuns: oracleRuns(60), ...parameters })
    },
    { fixedSeed: 20261022 },
  )
})

/**
 * Source acceptance is owed by the documented Collection boundary even on cold
 * replay. Real Collections receive held provider callbacks. The independent
 * judgment is whether a valid source snapshot arrived: pending data cannot
 * fulfill replay, a provider failure rejects with its cause, and a valid empty
 * snapshot counts as acceptance. Provider errors before first readiness fail that sync run. The #2168
 * health contract requires reload before valid-result recovery; later sync
 * failures can recover in the same ready run.
 *
 * Every generated history crosses idle/pending/failed startup with each first
 * delivery, using generated text. Startup failure has no live provider and is
 * terminal at this cut. This bounded matrix ensures that the declared cuts are
 * reached in both normal campaigns; it does not model durable outbox I/O.
 */
const sourceStarts = [`idle`, `pending`, `startup-error`] as const
const sourceDeliveries = [`empty`, `rows`, `error`, `cleanup`] as const
const sourceReachStates = [
  ...sourceStarts,
  ...sourceDeliveries,
  `provider-recovery`,
] as const

it(`requires real source acceptance through cold replay histories`, async () => {
  await runOracleCampaign(
    `CONVEX_OFFLINE_SOURCE_ORACLE`,
    sourceReachStates,
    async (reach, parameters) => {
      const property = fc.asyncProperty(
        fc.string({ maxLength: 15 }),
        async (text) => {
          reach.beginHistory()
          for (const state of sourceStarts) {
            for (const delivery of sourceDeliveries) {
              const transport = controlledClient()
              const cause = new Error(`source unavailable`)
              const collection = createCollection(
                convexCollectionOptions({
                  client:
                    state === `startup-error`
                      ? {
                          onUpdate: () => {
                            throw cause
                          },
                        }
                      : transport.client,
                  query,
                  queryArgs: { owner: `alice` },
                  getKey: (row) => row._id,
                  gcTime: 0,
                }),
              )
              if (state !== `idle`) collection.startSyncImmediate()
              const persist = convexOfflineMutation({
                client: {
                  mutation: () => Promise.resolve(null),
                } as unknown as Pick<ConvexClient, `mutation`>,
                mutation,
                getArgs: () => ({ text }),
                collections: [collection],
              })
              let outcome: { status: string; error?: unknown } = {
                status: `pending`,
              }
              const pending = persist({
                transaction: { mutations: [] },
                idempotencyKey: `source-key`,
              } as unknown as Parameters<typeof persist>[0]).then(
                () => {
                  outcome = { status: `fulfilled` }
                },
                (error) => {
                  outcome = { status: `rejected`, error }
                },
              )
              await withTestCleanup(
                async () => {
                  await new Promise((resolve) => setTimeout(resolve, 0))
                  reach.reach(state)
                  if (state === `startup-error`) {
                    expect(outcome).toEqual({
                      status: `rejected`,
                      error: cause,
                    })
                  } else {
                    expect(outcome.status).toBe(`pending`)
                    expect(transport.counts().subscriptions).toBe(1)
                    if (delivery === `error`) transport.error(cause)
                    else if (delivery === `cleanup`) await collection.cleanup()
                    else
                      transport.emit(
                        delivery === `empty` ? [] : [{ _id: `a`, text }],
                      )
                    await pending
                    reach.reach(delivery)
                    expect(outcome.status).toBe(
                      delivery === `error` || delivery === `cleanup`
                        ? `rejected`
                        : `fulfilled`,
                    )
                    if (delivery === `error`) {
                      expect(outcome.error).toBe(cause)
                      transport.cache([{ _id: `a`, text }])
                      await collection.reload()
                      await persist({
                        transaction: { mutations: [] },
                        idempotencyKey: `source-key`,
                      } as unknown as Parameters<typeof persist>[0])
                      reach.reach(`provider-recovery`)
                      expect(collection.get(`a`)?.text).toBe(text)
                    }
                    if (delivery === `rows`)
                      expect(collection.get(`a`)?.text).toBe(text)
                    if (delivery === `empty`) expect(collection.size).toBe(0)
                  }
                },
                () => collection.cleanup(),
              )
            }
          }
        },
      )
      await fc.assert(property, { numRuns: oracleRuns(60), ...parameters })
    },
    { fixedSeed: 20261023 },
  )
})

/**
 * A durable wrapper can reject before handing a committed source proposal to
 * core, as specified by whenSyncAccepted. The public guide requires that run to
 * stay failed until cleanup/restart, including when an earlier snapshot was
 * accepted. Same-cache reads and changed callbacks cannot restore that authority.
 *
 * The reference retains only the previously accepted rows and failed/restarted
 * judgment. Each generated history crosses first empty/nonempty proposals with
 * later insert/update/delete/replacement proposals over accepted empty/nonempty
 * bases. The wrapper defers actual core commit behind durability. At rejection
 * and every retry, the bridge must reject with the exact durable cause and public
 * rows must equal the accepted base. Both unchanged and changed cache retries
 * occur in every history, followed by generated extra retries and fresh-run
 * recovery. These are receipt-interface histories, not native SQLite failures.
 */
const acceptanceScenes = [
  `first-empty`,
  `first-rows`,
  `accepted-empty-insert`,
  `accepted-row-insert`,
  `accepted-row-update`,
  `accepted-row-delete`,
  `accepted-row-replacement`,
] as const
const acceptanceReachStates = [
  ...acceptanceScenes,
  `unchanged-cache-retry`,
  `changed-cache-retry`,
  `restart-recovery`,
] as const

it(`keeps rejected source acceptance terminal until a fresh sync run`, async () => {
  await runOracleCampaign(
    `CONVEX_OFFLINE_ACCEPTANCE_ORACLE`,
    acceptanceReachStates,
    async (reach, parameters) => {
      const property = fc.asyncProperty(
        fc.record({
          text: fc.string({ maxLength: 12 }),
          extraRetries: fc.array(fc.boolean(), { maxLength: 2 }),
          changedFirst: fc.boolean(),
        }),
        async ({ text, extraRetries, changedFirst }) => {
          reach.beginHistory()
          for (const scene of acceptanceScenes) {
            const transport = controlledClient()
            const cause = new Error(`durable acceptance failed`)
            let rejectDurable!: (error: unknown) => void
            let durable = Promise.resolve()
            let acceptImmediately = true
            const prior: Array<Row> = scene.startsWith(`accepted-row`)
              ? [{ _id: `a`, text }]
              : []
            const proposed: Array<Row> =
              scene === `first-empty` || scene === `accepted-row-delete`
                ? []
                : scene === `accepted-row-insert`
                  ? [...prior, { _id: `b`, text: `inserted:${text}` }]
                  : scene === `accepted-row-replacement`
                    ? [{ _id: `b`, text: `replacement:${text}` }]
                    : [{ _id: `a`, text: `proposed:${text}` }]
            const options = convexCollectionOptions({
              client: transport.client,
              query,
              queryArgs: { owner: `alice` },
              getKey: (row) => row._id,
              gcTime: 0,
            })
            const collection = createCollection({
              ...options,
              sync: {
                ...options.sync,
                sync: (syncParams) =>
                  options.sync.sync({
                    ...syncParams,
                    commit: () => {
                      if (acceptImmediately) return syncParams.commit()
                      const visible = durable.then(async () => {
                        await syncParams.commit()
                      })
                      return withAcceptedReceipt(visible, durable)
                    },
                  }),
              },
            })
            const persist = convexOfflineMutation({
              client: {
                mutation: () => Promise.resolve(null),
              } as unknown as Pick<ConvexClient, `mutation`>,
              mutation,
              getArgs: () => ({ text }),
              collections: [collection],
            })
            const params = {
              transaction: { mutations: [] },
              idempotencyKey: `same-durable-key`,
            } as unknown as Parameters<typeof persist>[0]
            await withTestCleanup(
              async () => {
                if (scene.startsWith(`accepted`)) {
                  const accepted = collection.utils.awaitSync()
                  transport.emit(prior)
                  await accepted
                  expect(
                    [...collection.values()].map(
                      ({ _id, text: observedText }) => ({
                        _id,
                        text: observedText,
                      }),
                    ),
                  ).toEqual(prior)
                } else collection.startSyncImmediate()
                acceptImmediately = false
                durable = new Promise<void>((_resolve, reject) => {
                  rejectDurable = reject
                })
                transport.emit(proposed)
                const pending = persist(params)
                const rejected = expect(pending).rejects.toBe(cause)
                await new Promise((resolve) => setTimeout(resolve, 0))
                rejectDurable(cause)
                await rejected
                reach.reach(scene)
                expect(
                  [...collection.values()].map(
                    ({ _id, text: observedText }) => ({
                      _id,
                      text: observedText,
                    }),
                  ),
                ).toEqual(prior)
                const retries = changedFirst
                  ? [true, false, ...extraRetries]
                  : [false, true, ...extraRetries]
                for (const changed of retries) {
                  if (changed)
                    transport.emit([{ _id: `a`, text: `new:${text}` }])
                  await expect(persist(params)).rejects.toBe(cause)
                  reach.reach(
                    changed ? `changed-cache-retry` : `unchanged-cache-retry`,
                  )
                  expect(
                    [...collection.values()].map(
                      ({ _id, text: observedText }) => ({
                        _id,
                        text: observedText,
                      }),
                    ),
                  ).toEqual(prior)
                }
                await collection.cleanup()
                acceptImmediately = true
                transport.cache([{ _id: `a`, text: `restarted:${text}` }])
                collection.startSyncImmediate()
                await persist(params)
                reach.reach(`restart-recovery`)
                expect(
                  [...collection.values()].map(
                    ({ _id, text: observedText }) => ({
                      _id,
                      text: observedText,
                    }),
                  ),
                ).toEqual([{ _id: `a`, text: `restarted:${text}` }])
              },
              () => collection.cleanup(),
            )
          }
        },
      )
      await fc.assert(property, { numRuns: oracleRuns(60), ...parameters })
    },
    { fixedSeed: 20261023 },
  )
})
