/**
 * Concrete adapter options own one Collection, following the existing
 * LocalStorage options claim policy. Cleanup ends a sync run, not the options
 * owner's identity. A descriptor materializes fresh options for each DbClient.
 * This boundary prevents a second Collection from stealing cached mutation
 * confirmation or error state from the first.
 *
 * The model judges identity alone: concrete and shallow-copy attempts reuse
 * one owner, while fresh options and separate DbClients have separate owners.
 * Each generated history permutes all reuse forms and all before-sync, ready,
 * and cleanup checkpoints, so every admission cell has enforced reach. Reused
 * owners must reject at admission. Accepted independent owners must each settle
 * a mutation against the latest cached provider rows.
 * The controlled provider holds callbacks after changing its cache, which is
 * the SDK's documented cached-listener window. Real SDK timing is separately
 * received in sdk.test.ts. This owner does not model arbitrary DB lifecycle.
 */
import { DbClient, collectionOptions, createCollection } from '@tanstack/db'
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { oracleRuns } from '../../db/tests/oracle-config'
import { convexCollectionOptions } from '../src/index'
import { controlledClient, query, withTestCleanup } from './helpers'

const forms = [`direct`, `shallow`, `fresh`, `descriptor`] as const
const checkpoints = [`idle`, `ready`, `cleaned-up`] as const
const states = [
  ...forms.flatMap((form) =>
    checkpoints.map((checkpoint) => `${form}:${checkpoint}` as const),
  ),
  `independent-confirmation`,
  `rightful-after-rejected-reuse`,
  `rightful-after-sibling-cleanup`,
] as const

it(`keeps concrete options ownership across generated lifecycle checkpoints`, async () => {
  await runOracleCampaign(
    `CONVEX_OWNERSHIP_ORACLE`,
    states,
    async (reach, parameters) => {
      const property = fc.asyncProperty(
        fc.shuffledSubarray([...forms], { minLength: 4, maxLength: 4 }),
        fc.shuffledSubarray([...checkpoints], { minLength: 3, maxLength: 3 }),
        fc.string({ maxLength: 16 }),
        async (orderedForms, orderedCheckpoints, text) => {
          reach.beginHistory()
          // Exhaust the finite identity/checkpoint matrix in generated order.
          // Text still varies cached results; no rare cell depends on sampling.
          for (const form of orderedForms) {
            for (const checkpoint of orderedCheckpoints) {
              const transport = controlledClient()
              transport.cache([{ _id: `a`, text: `old` }])
              const makeOptions = () =>
                convexCollectionOptions({
                  id: `review-owned-tasks`,
                  client: transport.client,
                  query,
                  queryArgs: { owner: `alice` },
                  getKey: (row) => row._id,
                  gcTime: 0,
                  onUpdate: () => Promise.resolve(),
                })
              const options = makeOptions()
              const descriptor = collectionOptions(options)
              const first =
                form === `descriptor`
                  ? new DbClient().collection(descriptor)
                  : createCollection(options)
              const collections = [first]
              await withTestCleanup(
                async () => {
                  if (checkpoint !== `idle`) await first.preload()
                  if (checkpoint === `cleaned-up`) await first.cleanup()
                  const reusedOwner = form === `direct` || form === `shallow`
                  const construct = () =>
                    form === `descriptor`
                      ? new DbClient().collection(descriptor)
                      : createCollection(
                          form === `fresh`
                            ? makeOptions()
                            : form === `shallow`
                              ? { ...options }
                              : options,
                        )
                  if (reusedOwner) {
                    expect(construct).toThrow(`only one Collection`)
                  } else {
                    const second = construct()
                    collections.push(second)
                    await second.preload()
                    transport.cache([{ _id: `a`, text }])
                    const transaction = second.update(`a`, (row) => {
                      row.text = `optimistic`
                    })
                    await transaction.when('settled')
                    expect(second.get(`a`)?.text).toBe(text)
                    reach.reach(`independent-confirmation`)
                  }
                  // Failed reuse and sibling cleanup cannot revoke the rightful owner.
                  for (const collection of collections.slice(1))
                    await collection.cleanup()
                  await first.preload()
                  transport.cache([{ _id: `a`, text: `owner:${text}` }])
                  const transaction = first.update(`a`, (row) => {
                    row.text = `optimistic`
                  })
                  await transaction.when('settled')
                  expect(first.get(`a`)?.text).toBe(`owner:${text}`)
                  reach.reach(`${form}:${checkpoint}`)
                  reach.reach(
                    reusedOwner
                      ? `rightful-after-rejected-reuse`
                      : `rightful-after-sibling-cleanup`,
                  )
                },
                async () => {
                  // The second owner can be admitted inside the body. Enumerate all
                  // resources at cleanup time, then attempt every release.
                  await withTestCleanup(
                    () => {},
                    ...collections.map(
                      (collection) => () => collection.cleanup(),
                    ),
                  )
                },
              )
            }
          }
        },
      )
      await fc.assert(property, { numRuns: oracleRuns(60), ...parameters })
    },
    { fixedSeed: 20261022 },
  )
})
