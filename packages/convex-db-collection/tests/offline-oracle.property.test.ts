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
import { expect } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import { convexCollectionOptions } from '../src/index'
import { convexOfflineMutation } from '../src/offline'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { controlledClient, query, withTestCleanup } from './helpers'
import type { Row } from './helpers'
import type { ConvexClient } from 'convex/browser'
import type { OfflineConfig } from '@tanstack/offline-transactions'

type AssertionHistory<T> = T extends fc.Arbitrary<infer H> ? H : never
type AssertionReach = {
  beginHistory: () => void
  reach: (state: string) => void
}

declareOracle({
  owns: [
    `src/index.ts#convexCollectionOptions`,
    `src/offline.ts#convexOfflineMutation`,
  ],
})

const mutation = makeFunctionReference<
  `mutation`,
  { idempotencyKey: string; text: string },
  null
>(`tasks:save`)
const stages = [`args`, `mutation`, `sync`] as const
const failures = [`none`, ...stages] as const

const convex_offlineHistory = fc.record({
  key: fc.string({ maxLength: 15 }),
  text: fc.string({ maxLength: 15 }),
})
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_offlineJudgment(
  { key, text }: AssertionHistory<typeof convex_offlineHistory>,
  reach: AssertionReach,
) {
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
      oracleAssertion(`offline-oracle.property.test.ts:67:toEqual`, () =>
        expect(args).toEqual({ idempotencyKey: key, text }),
      )
      return Promise.resolve(null)
    }
    const persist = convexOfflineMutation({
      client: { mutation: send } as unknown as Pick<ConvexClient, `mutation`>,
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
    oracleAssertion(`offline-oracle.property.test.ts:101:toEqual`, () =>
      expect(trace).toEqual(
        boundary === -1 ? stages : stages.slice(0, boundary + 1),
      ),
    )
    oracleAssertion(`offline-oracle.property.test.ts:104:toBe`, () =>
      expect(observed.status).toBe(boundary === -1 ? `fulfilled` : `rejected`),
    )
    if (observed.status === `rejected`) {
      if (boundary < 2)
        oracleAssertion(
          `offline-oracle.property.test.ts:109:toBeInstanceOf`,
          () => expect(observed.error).toBeInstanceOf(NonRetriableError),
        )
      else
        oracleAssertion(`offline-oracle.property.test.ts:110:toBe`, () =>
          expect(observed.error).toBe(cause),
        )
    }
  }
}

oracleProperty({
  id: `convex.offline`,
  law: {
    statement: `preserves ordered replay and retry classification across bridge failures`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
  },
  histories: {
    arbitrary: convex_offlineHistory,
    runs: 60,
    fixedSeeds: [20261022],
    states: failures,
    constructed: [
      {
        name: `existing constructive history`,
        enters: failures,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.offline`, plan, observe, () =>
      convex_offlineJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 120000,
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

const convex_offline_sourceHistory = fc.string({ maxLength: 15 })
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_offline_sourceJudgment(
  text: AssertionHistory<typeof convex_offline_sourceHistory>,
  reach: AssertionReach,
) {
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
            oracleAssertion(`offline-oracle.property.test.ts:202:toEqual`, () =>
              expect(outcome).toEqual({
                status: `rejected`,
                error: cause,
              }),
            )
          } else {
            oracleAssertion(`offline-oracle.property.test.ts:207:toBe`, () =>
              expect(outcome.status).toBe(`pending`),
            )
            oracleAssertion(`offline-oracle.property.test.ts:208:toBe`, () =>
              expect(transport.counts().subscriptions).toBe(1),
            )
            if (delivery === `error`) transport.error(cause)
            else if (delivery === `cleanup`) await collection.cleanup()
            else
              transport.emit(delivery === `empty` ? [] : [{ _id: `a`, text }])
            await pending
            reach.reach(delivery)
            oracleAssertion(`offline-oracle.property.test.ts:217:toBe`, () =>
              expect(outcome.status).toBe(
                delivery === `error` || delivery === `cleanup`
                  ? `rejected`
                  : `fulfilled`,
              ),
            )
            if (delivery === `error`) {
              oracleAssertion(`offline-oracle.property.test.ts:223:toBe`, () =>
                expect(outcome.error).toBe(cause),
              )
              transport.cache([{ _id: `a`, text }])
              await collection.reload()
              await persist({
                transaction: { mutations: [] },
                idempotencyKey: `source-key`,
              } as unknown as Parameters<typeof persist>[0])
              reach.reach(`provider-recovery`)
              oracleAssertion(`offline-oracle.property.test.ts:231:toBe`, () =>
                expect(collection.get(`a`)?.text).toBe(text),
              )
            }
            if (delivery === `rows`)
              oracleAssertion(`offline-oracle.property.test.ts:234:toBe`, () =>
                expect(collection.get(`a`)?.text).toBe(text),
              )
            if (delivery === `empty`)
              oracleAssertion(`offline-oracle.property.test.ts:235:toBe`, () =>
                expect(collection.size).toBe(0),
              )
          }
        },
        () => collection.cleanup(),
      )
    }
  }
}

oracleProperty({
  id: `convex.offline-source`,
  law: {
    statement: `requires real source acceptance through cold replay histories`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
  },
  histories: {
    arbitrary: convex_offline_sourceHistory,
    runs: 60,
    fixedSeeds: [20261023],
    states: sourceReachStates,
    constructed: [
      {
        name: `existing constructive history`,
        enters: sourceReachStates,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.offline-source`, plan, observe, () =>
      convex_offline_sourceJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 120000,
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

const convex_offline_acceptanceHistory = fc.record({
  text: fc.string({ maxLength: 12 }),
  extraRetries: fc.array(fc.boolean(), { maxLength: 2 }),
  changedFirst: fc.boolean(),
})
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_offline_acceptanceJudgment(
  {
    text,
    extraRetries,
    changedFirst,
  }: AssertionHistory<typeof convex_offline_acceptanceHistory>,
  reach: AssertionReach,
) {
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
          oracleAssertion(`offline-oracle.property.test.ts:355:toEqual`, () =>
            expect(
              [...collection.values()].map(({ _id, text: observedText }) => ({
                _id,
                text: observedText,
              })),
            ).toEqual(prior),
          )
        } else collection.startSyncImmediate()
        acceptImmediately = false
        durable = new Promise<void>((_resolve, reject) => {
          rejectDurable = reject
        })
        transport.emit(proposed)
        const pending = persist(params)
        const rejected = oracleAssertion(
          `offline-oracle.property.test.ts:370:toBe`,
          () => expect(pending).rejects.toBe(cause),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
        rejectDurable(cause)
        await rejected
        reach.reach(scene)
        oracleAssertion(`offline-oracle.property.test.ts:375:toEqual`, () =>
          expect(
            [...collection.values()].map(({ _id, text: observedText }) => ({
              _id,
              text: observedText,
            })),
          ).toEqual(prior),
        )
        const retries = changedFirst
          ? [true, false, ...extraRetries]
          : [false, true, ...extraRetries]
        for (const changed of retries) {
          if (changed) transport.emit([{ _id: `a`, text: `new:${text}` }])
          await oracleAssertion(
            `offline-oracle.property.test.ts:389:toBe`,
            () => expect(persist(params)).rejects.toBe(cause),
          )
          reach.reach(changed ? `changed-cache-retry` : `unchanged-cache-retry`)
          oracleAssertion(`offline-oracle.property.test.ts:393:toEqual`, () =>
            expect(
              [...collection.values()].map(({ _id, text: observedText }) => ({
                _id,
                text: observedText,
              })),
            ).toEqual(prior),
          )
        }
        await collection.cleanup()
        acceptImmediately = true
        transport.cache([{ _id: `a`, text: `restarted:${text}` }])
        collection.startSyncImmediate()
        await persist(params)
        reach.reach(`restart-recovery`)
        oracleAssertion(`offline-oracle.property.test.ts:408:toEqual`, () =>
          expect(
            [...collection.values()].map(({ _id, text: observedText }) => ({
              _id,
              text: observedText,
            })),
          ).toEqual([{ _id: `a`, text: `restarted:${text}` }]),
        )
      },
      () => collection.cleanup(),
    )
  }
}

oracleProperty({
  id: `convex.offline-acceptance`,
  law: {
    statement: `keeps rejected source acceptance terminal until a fresh sync run`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
  },
  histories: {
    arbitrary: convex_offline_acceptanceHistory,
    runs: 60,
    fixedSeeds: [20261023],
    states: acceptanceReachStates,
    constructed: [
      {
        name: `existing constructive history`,
        enters: acceptanceReachStates,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.offline-acceptance`, plan, observe, () =>
      convex_offline_acceptanceJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 120000,
})
