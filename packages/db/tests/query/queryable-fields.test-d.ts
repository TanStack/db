import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  Query,
  createLiveQueryCollection,
  eq,
  withQueryableFields,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

type JobEngagementDocument = {
  _id: string
  status: `ACTIVE` | `INACTIVE`
  user_id: string
  employer_id: string
  created_at: string
  updated_at: string
  platform_fee_percent: number
}

function createEngagementsCollection() {
  return createCollection(
    mockSyncCollectionOptions<JobEngagementDocument>({
      id: `test-engagements`,
      getKey: (engagement) => engagement._id,
      initialData: [],
    }),
  )
}

describe(`Queryable field constraints`, () => {
  test(`supports queryable option on createLiveQueryCollection config`, () => {
    const engagementsCollection = createEngagementsCollection()

    const collection = createLiveQueryCollection({
      queryable: {
        filterable: [
          `_id`,
          `status`,
          `user_id`,
          `employer_id`,
          `created_at`,
          `updated_at`,
        ] as const,
        sortable: [`created_at`, `updated_at`, `status`] as const,
      },
      query: (q) =>
        q
          .from({ engagement: engagementsCollection })
          .where(({ engagement }) => eq(engagement.status, `ACTIVE`))
          .orderBy(({ engagement }) => engagement.updated_at, `desc`),
    })

    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<JobEngagementDocument>
    >()
  })

  test(`queryable option rejects disallowed fields at compile-time`, () => {
    const engagementsCollection = createEngagementsCollection()

    createLiveQueryCollection({
      queryable: {
        filterable: [
          `_id`,
          `status`,
          `user_id`,
          `employer_id`,
          `created_at`,
          `updated_at`,
        ] as const,
        sortable: [`created_at`, `updated_at`, `status`] as const,
      },
      query: (q) =>
        q
          .from({ engagement: engagementsCollection })
          .where(({ engagement }) => {
            // @ts-expect-error platform_fee_percent is not queryable
            return eq(engagement.platform_fee_percent, 0.15)
          }),
    })
  })

  test(`empty queryable lists do not widen back to full document`, () => {
    const engagementsCollection = createEngagementsCollection()

    createLiveQueryCollection({
      queryable: {
        filterable: [] as const,
        sortable: [] as const,
      },
      query: (q) =>
        q
          .from({ engagement: engagementsCollection })
          .where(({ engagement }) => {
            // @ts-expect-error no fields are queryable when both lists are empty
            return eq(engagement.status, `ACTIVE`)
          }),
    })
  })

  test(`allows configured fields in where and orderBy`, () => {
    const engagementsCollection = createEngagementsCollection()

    const queryableEngagements = withQueryableFields(engagementsCollection, {
      filterable: [
        `_id`,
        `status`,
        `user_id`,
        `employer_id`,
        `created_at`,
        `updated_at`,
      ] as const,
      sortable: [`created_at`, `updated_at`, `status`] as const,
    })

    const collection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ engagement: queryableEngagements })
          .where(({ engagement }) => eq(engagement.status, `ACTIVE`))
          .orderBy(({ engagement }) => engagement.updated_at, `desc`),
    })

    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<JobEngagementDocument>
    >()
  })

  test(`rejects disallowed where fields at compile-time`, () => {
    const engagementsCollection = createEngagementsCollection()

    const queryableEngagements = withQueryableFields(engagementsCollection, {
      filterable: [
        `_id`,
        `status`,
        `user_id`,
        `employer_id`,
        `created_at`,
        `updated_at`,
      ] as const,
      sortable: [`created_at`, `updated_at`, `status`] as const,
    })

    createLiveQueryCollection({
      query: (q) =>
        q.from({ engagement: queryableEngagements }).where(({ engagement }) => {
          // @ts-expect-error platform_fee_percent is not queryable
          return eq(engagement.platform_fee_percent, 0.15)
        }),
    })
  })

  test(`rejects disallowed orderBy fields at compile-time`, () => {
    const engagementsCollection = createEngagementsCollection()

    const queryableEngagements = withQueryableFields(engagementsCollection, {
      filterable: [
        `_id`,
        `status`,
        `user_id`,
        `employer_id`,
        `created_at`,
        `updated_at`,
      ] as const,
      sortable: [`created_at`, `updated_at`, `status`] as const,
    })

    createLiveQueryCollection({
      query: (q) =>
        q
          .from({ engagement: queryableEngagements })
          .where(({ engagement }) => eq(engagement.status, `ACTIVE`))
          .orderBy(({ engagement }) => {
            // @ts-expect-error platform_fee_percent is not queryable
            return engagement.platform_fee_percent
          }),
    })
  })

  test(`keeps restrictions across subquery refs while preserving output shape`, () => {
    const engagementsCollection = createEngagementsCollection()

    const queryableEngagements = withQueryableFields(engagementsCollection, {
      filterable: [
        `_id`,
        `status`,
        `user_id`,
        `employer_id`,
        `created_at`,
        `updated_at`,
      ] as const,
      sortable: [`created_at`, `updated_at`, `status`] as const,
    })

    const subquery = new Query().from({ engagement: queryableEngagements })

    createLiveQueryCollection({
      query: (q) =>
        q.from({ engagement: subquery }).where(({ engagement }) => {
          // @ts-expect-error platform_fee_percent is not queryable via subquery refs
          return eq(engagement.platform_fee_percent, 0.15)
        }),
    })

    const resultCollection = createLiveQueryCollection({
      query: (q) => q.from({ engagement: subquery }),
    })

    expectTypeOf(resultCollection.toArray).toEqualTypeOf<
      Array<JobEngagementDocument>
    >()
  })
})
