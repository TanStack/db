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
import { expect } from 'vitest'
import { oracleProperty, pass } from '../../db/tests/oracle-property'
import { convexCollectionOptions } from '../src/index'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { controlledClient, query, withTestCleanup } from './helpers'
import type { Observation, Verdict } from '../../db/tests/oracle-property'

declareOracle({
  owns: [`src/index.ts#convexCollectionOptions`],
})

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

const ownershipHistory = fc.tuple(
  fc.shuffledSubarray([...forms], { minLength: 4, maxLength: 4 }),
  fc.shuffledSubarray([...checkpoints], { minLength: 3, maxLength: 3 }),
  fc.string({ maxLength: 16 }),
)
type AssertionHistory<T> = T extends fc.Arbitrary<infer H> ? H : never
type OwnershipHistory = AssertionHistory<typeof ownershipHistory>

// Identity, rather than the adapter's ownership machinery, determines which
// admissions must reject. Independent owners owe the authored cached text.
function ownershipModel([
  orderedForms,
  orderedCheckpoints,
  text,
]: OwnershipHistory) {
  return orderedForms.flatMap((form) =>
    orderedCheckpoints.flatMap((checkpoint) => [
      {
        checkpoint: `${form === `direct` || form === `shallow` ? `admission` : `independent`}:${form}:${checkpoint}`,
        value:
          form === `direct` || form === `shallow`
            ? `only one Collection`
            : text,
      },
      { checkpoint: `rightful:${form}:${checkpoint}`, value: `owner:${text}` },
    ]),
  )
}

function checkOwnership(
  _history: OwnershipHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof ownershipModel>,
): Verdict {
  const cuts = trace.filter((entry) => entry.checkpoint !== `reach`)
  try {
    for (const [index, actual] of cuts.entries()) {
      const owed = expected[index]
      expect(actual.checkpoint).toBe(owed?.checkpoint)
      if (actual.checkpoint.startsWith(`admission:`)) {
        expect(() => {
          if (actual.value !== undefined) throw actual.value
        }).toThrow(String(owed?.value))
      } else expect(actual.value).toBe(owed?.value)
    }
    return pass
  } catch (error) {
    if (!(error instanceof Error) || error.name !== `AssertionError`)
      throw error
    return {
      kind: `violation`,
      checkpoint: cuts.at(-1)?.checkpoint ?? `ownership`,
      law: `concrete options ownership`,
      difference: error.message,
      cause: error,
    }
  }
}

oracleProperty({
  id: `convex.ownership`,
  law: {
    statement: `Concrete and shallow-copied options retain one Collection owner through cleanup; fresh options and descriptors admit independent owners whose mutations confirm from their own cache.`,
    authority: `docs/collections/convex-collection.md; established concrete options ownership contract in oracle-coverage.md.`,
    limits: `The existing controlled provider and finite identity/checkpoint matrix; no arbitrary lifecycle or real SDK transport timing.`,
    owner: `Convex collection integration`,
  },
  histories: {
    arbitrary: ownershipHistory,
    runs: 60,
    fixedSeeds: [20261022],
    states,
    constructed: [
      {
        name: `complete ownership matrix`,
        enters: states,
        build: (history) => history,
      },
    ],
  },
  model: ownershipModel,
  check: checkOwnership,
  driver: async ([orderedForms, orderedCheckpoints, text], observe) => {
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
              let rejected: unknown
              try {
                const unexpected = construct()
                collections.push(unexpected)
              } catch (error) {
                rejected = error
              }
              observe(`admission:${form}:${checkpoint}`, rejected)
              expect(() => {
                if (rejected !== undefined) throw rejected
              }).toThrow(`only one Collection`)
            } else {
              const second = construct()
              collections.push(second)
              await second.preload()
              transport.cache([{ _id: `a`, text }])
              const transaction = second.update(`a`, (row) => {
                row.text = `optimistic`
              })
              await transaction.when('settled')
              observe(
                `independent:${form}:${checkpoint}`,
                second.get(`a`)?.text,
              )
              expect(second.get(`a`)?.text).toBe(text)
              observe(`reach`, `independent-confirmation`)
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
            observe(`rightful:${form}:${checkpoint}`, first.get(`a`)?.text)
            expect(first.get(`a`)?.text).toBe(`owner:${text}`)
            observe(`reach`, `${form}:${checkpoint}`)
            observe(
              `reach`,
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
              ...collections.map((collection) => () => collection.cleanup()),
            )
          },
        )
      }
    }
  },
})
