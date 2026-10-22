/**
 * Concrete adapter options own one Collection, following the existing
 * LocalStorage options claim policy. Cleanup ends a sync run, not the options
 * owner's identity. A descriptor materializes fresh options for each DbClient.
 * This boundary prevents a second Collection from stealing cached mutation
 * confirmation or error state from the first.
 *
 * The model judges identity alone: concrete and shallow-copy attempts reuse
 * one owner, while fresh options and separate DbClients have separate owners.
 * Generated histories cross reuse form with before-sync, ready, and cleanup
 * checkpoints. At admission, a reused owner must reject. Accepted independent
 * owners must each settle a mutation against the latest cached provider rows.
 * The controlled provider holds callbacks after changing its cache, which is
 * the SDK's documented cached-listener window. Real SDK timing is separately
 * received in sdk.test.ts. This owner does not model arbitrary DB lifecycle.
 */
import { DbClient, collectionOptions, createCollection } from '@tanstack/db'
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { convexCollectionOptions } from '../src/index'
import { controlledClient, query } from './helpers'

it(`keeps concrete options ownership across generated lifecycle checkpoints`, async () => {
  const property = fc.asyncProperty(
    fc.constantFrom(`direct`, `shallow`, `fresh`, `descriptor`),
    fc.constantFrom(`idle`, `ready`, `cleaned-up`),
    fc.string({ maxLength: 16 }),
    async (form, checkpoint, text) => {
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
      try {
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
          await transaction.isPersisted.promise
          expect(second.get(`a`)?.text).toBe(text)
        }
        // Failed reuse and sibling cleanup cannot revoke the rightful owner.
        for (const collection of collections.slice(1))
          await collection.cleanup()
        await first.preload()
        transport.cache([{ _id: `a`, text: `owner:${text}` }])
        const transaction = first.update(`a`, (row) => {
          row.text = `optimistic`
        })
        await transaction.isPersisted.promise
        expect(first.get(`a`)?.text).toBe(`owner:${text}`)
      } finally {
        await Promise.all(collections.map((collection) => collection.cleanup()))
      }
    },
  )
  const seed = process.env.CONVEX_OWNERSHIP_ORACLE_SEED
  if (seed)
    await fc.assert(property, {
      seed: Number(seed),
      path: process.env.CONVEX_OWNERSHIP_ORACLE_PATH,
      numRuns: 60,
    })
  else {
    await fc.assert(property, { seed: 20261022, numRuns: 60 })
    await fc.assert(property, { numRuns: 60 })
  }
})
