// Ordinary tests for virtual row fields: a fixed root-shape scenario compared
// with written values, and a harness self-test for checkWithCleanup. The
// published-row classification law is owned by virtual-row-fields-oracle.test.ts.
import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { hasVirtualProps } from '../../src/virtual-props.js'
import { mockSyncCollectionOptions } from '../utils.js'
import {
  checkWithCleanup,
  virtualFieldNames,
} from './virtual-row-fields-support.js'

type Profile = { label: string }

type Row = {
  id: string
  profile: Profile
  optionalProfile?: Profile
  createdAt: Date
  tags: Array<string>
}

function assertPublishedRootFields(row: unknown, name: string): void {
  for (const field of virtualFieldNames) {
    if (!(field in Object(row))) {
      throw new Error(`${name} root must expose ${field}`)
    }
  }
  expect(hasVirtualProps(row), `${name} root classification`).toBe(true)
}

describe(`virtual row field runtime boundary`, () => {
  test(`publishes every virtual field on implicit, expression, and functional root shapes`, async () => {
    const rows = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `virtual-row-fields-root-shapes-source`,
        getKey: (row) => row.id,
        initialData: [
          {
            id: `row-1`,
            profile: { label: `nested` },
            createdAt: new Date(`2026-09-20T12:34:56.000Z`),
            tags: [`one`],
          },
        ],
      }),
    )
    const implicit = createLiveQueryCollection((q) => q.from({ row: rows }))
    const expression = createLiveQueryCollection((q) =>
      q.from({ row: rows }).select(({ row }) => ({
        id: row.id,
        label: row.profile.label,
      })),
    )
    const functional = createLiveQueryCollection((q) =>
      q.from({ row: rows }).fn.select(({ row }) => ({
        id: row.id,
        label: row.profile.label,
      })),
    )

    await checkWithCleanup(async () => {
      await Promise.all([
        implicit.preload(),
        expression.preload(),
        functional.preload(),
      ])

      const observed = [
        { name: `implicit`, row: implicit.toArray[0] },
        { name: `expression`, row: expression.toArray[0] },
        { name: `functional`, row: functional.toArray[0] },
      ]
      for (const { name, row } of observed) {
        expect(row, `${name} root must publish`).toBeDefined()
        assertPublishedRootFields(row, name)
        expect(row!.$hasPendingWrites, `${name} has no pending write`).toBe(
          false,
        )
        expect(row!.$hasPendingWrites, `${name} legacy inverse`).toBe(
          !row!.$synced,
        )
      }

      expect(implicit.toArray[0]?.id).toBe(`row-1`)
      expect(expression.toArray[0]).toMatchObject({
        id: `row-1`,
        label: `nested`,
      })
      expect(functional.toArray[0]).toMatchObject({
        id: `row-1`,
        label: `nested`,
      })

      // Wrong rule: functional projection outputs are treated as ordinary
      // values and never receive root fields. The direct field check above
      // rejects this observation at the same post-preload checkpoint.
      const wrongFunctionalRoot = Object.fromEntries(
        Object.entries(functional.toArray[0]!).filter(
          ([field]) => field !== `$collectionId`,
        ),
      )
      expect(() =>
        assertPublishedRootFields(wrongFunctionalRoot, `functional`),
      ).toThrow(`functional root must expose $collectionId`)
    }, [
      () => functional.cleanup(),
      () => expression.cleanup(),
      () => implicit.cleanup(),
      () => rows.cleanup(),
    ])
  })

  test(`keeps the primary mismatch and attempts every cleanup`, async () => {
    const mismatch = new Error(`published row mismatch`)
    const firstCleanupError = new Error(`first cleanup failed`)
    const lastCleanupError = new Error(`last cleanup failed`)
    const attempted: Array<string> = []

    await expect(
      checkWithCleanup(async () => {
        throw mismatch
      }, [
        async () => {
          attempted.push(`first`)
          throw firstCleanupError
        },
        async () => {
          attempted.push(`middle`)
        },
        async () => {
          attempted.push(`last`)
          throw lastCleanupError
        },
      ]),
    ).rejects.toMatchObject({
      cause: mismatch,
      errors: [firstCleanupError, lastCleanupError],
    })
    expect(attempted).toEqual([`first`, `middle`, `last`])
  })
})
