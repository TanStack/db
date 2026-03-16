import { describe, expectTypeOf, test } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { WithVirtualProps } from '../../src/virtual-props.js'

type Project = {
  id: number
  name: string
}

type Issue = {
  id: number
  projectId: number
  title: string
}

type Comment = {
  id: number
  issueId: number
  body: string
}

function createProjectsCollection() {
  return createCollection(
    mockSyncCollectionOptions<Project>({
      id: `includes-type-projects`,
      getKey: (p) => p.id,
      initialData: [],
    }),
  )
}

function createIssuesCollection() {
  return createCollection(
    mockSyncCollectionOptions<Issue>({
      id: `includes-type-issues`,
      getKey: (i) => i.id,
      initialData: [],
    }),
  )
}

function createCommentsCollection() {
  return createCollection(
    mockSyncCollectionOptions<Comment>({
      id: `includes-type-comments`,
      getKey: (c) => c.id,
      initialData: [],
    }),
  )
}

describe(`includes subquery types`, () => {
  const projects = createProjectsCollection()
  const issues = createIssuesCollection()
  const comments = createCommentsCollection()

  describe(`Collection includes`, () => {
    test(`includes with select infers child result as Collection`, () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: q
            .from({ i: issues })
            .where(({ i }) => eq(i.projectId, p.id))
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
            })),
        })),
      )

      const result = collection.toArray[0]!
      expectTypeOf(result.id).toEqualTypeOf<number>()
      expectTypeOf(result.name).toEqualTypeOf<string>()
      expectTypeOf(result.$synced).toEqualTypeOf<boolean>()
      expectTypeOf(result.$origin).toEqualTypeOf<`local` | `remote`>()
      expectTypeOf(result.$key).toEqualTypeOf<string | number>()
      expectTypeOf(result.$collectionId).toEqualTypeOf<string>()
      expectTypeOf(result.issues.toArray[0]!).toMatchTypeOf<
        WithVirtualProps<{ id: number; title: string }>
      >()
    })

    test(`includes without select infers full child type as Collection`, () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          issues: q.from({ i: issues }).where(({ i }) => eq(i.projectId, p.id)),
        })),
      )

      const result = collection.toArray[0]!
      expectTypeOf(result.id).toEqualTypeOf<number>()
      expectTypeOf(result.$synced).toEqualTypeOf<boolean>()
      expectTypeOf(result.$origin).toEqualTypeOf<`local` | `remote`>()
      expectTypeOf(result.$key).toEqualTypeOf<string | number>()
      expectTypeOf(result.$collectionId).toEqualTypeOf<string>()
      expectTypeOf(result.issues.toArray[0]!).toMatchTypeOf<
        WithVirtualProps<Issue>
      >()
    })

    test(`multiple sibling includes each infer their own Collection type`, () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          issues: q
            .from({ i: issues })
            .where(({ i }) => eq(i.projectId, p.id))
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
            })),
          comments: q
            .from({ c: comments })
            .where(({ c }) => eq(c.issueId, p.id))
            .select(({ c }) => ({
              id: c.id,
              body: c.body,
            })),
        })),
      )

      const result = collection.toArray[0]!
      expectTypeOf(result.issues.toArray[0]!).toMatchTypeOf<
        WithVirtualProps<{ id: number; title: string }>
      >()
      expectTypeOf(result.comments.toArray[0]!).toMatchTypeOf<
        WithVirtualProps<{ id: number; body: string }>
      >()
    })

    test(`nested Collection includes infer correctly`, () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          issues: q
            .from({ i: issues })
            .where(({ i }) => eq(i.projectId, p.id))
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
              comments: q
                .from({ c: comments })
                .where(({ c }) => eq(c.issueId, i.id))
                .select(({ c }) => ({
                  id: c.id,
                  body: c.body,
                })),
            })),
        })),
      )

      const result = collection.toArray[0]!
      expectTypeOf(result.issues.toArray[0]!.id).toEqualTypeOf<number>()
      expectTypeOf(result.issues.toArray[0]!.title).toEqualTypeOf<string>()
      expectTypeOf(result.issues.toArray[0]!.$synced).toEqualTypeOf<boolean>()
      expectTypeOf(result.issues.toArray[0]!.$origin).toEqualTypeOf<
        `local` | `remote`
      >()
      expectTypeOf(result.issues.toArray[0]!.$key).toEqualTypeOf<
        string | number
      >()
      expectTypeOf(
        result.issues.toArray[0]!.$collectionId,
      ).toEqualTypeOf<string>()
      expectTypeOf(
        result.issues.toArray[0]!.comments.toArray[0]!,
      ).toMatchTypeOf<WithVirtualProps<{ id: number; body: string }>>()
    })
  })

  describe(`toArray`, () => {
    test(`toArray includes infers child result as Array`, () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: toArray(
            q
              .from({ i: issues })
              .where(({ i }) => eq(i.projectId, p.id))
              .select(({ i }) => ({
                id: i.id,
                title: i.title,
              })),
          ),
        })),
      )

      const result = collection.toArray[0]!
      expectTypeOf(result.id).toEqualTypeOf<number>()
      expectTypeOf(result.name).toEqualTypeOf<string>()
      expectTypeOf(result.$synced).toEqualTypeOf<boolean>()
      expectTypeOf(result.$origin).toEqualTypeOf<`local` | `remote`>()
      expectTypeOf(result.$key).toEqualTypeOf<string | number>()
      expectTypeOf(result.$collectionId).toEqualTypeOf<string>()
      expectTypeOf(result.issues[0]!).toMatchTypeOf<
        WithVirtualProps<{ id: number; title: string }>
      >()
    })

    test(`toArray includes without select infers child type`, () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          issues: toArray(
            q.from({ i: issues }).where(({ i }) => eq(i.projectId, p.id)),
          ),
        })),
      )

      const result = collection.toArray[0]!
      expectTypeOf(result.id).toEqualTypeOf<number>()
      expectTypeOf(result.$synced).toEqualTypeOf<boolean>()
      expectTypeOf(result.$origin).toEqualTypeOf<`local` | `remote`>()
      expectTypeOf(result.$key).toEqualTypeOf<string | number>()
      expectTypeOf(result.$collectionId).toEqualTypeOf<string>()
      expectTypeOf(result.issues[0]!).toMatchTypeOf<WithVirtualProps<Issue>>()
    })

    test(`nested toArray infers nested arrays`, () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          issues: toArray(
            q
              .from({ i: issues })
              .where(({ i }) => eq(i.projectId, p.id))
              .select(({ i }) => ({
                id: i.id,
                title: i.title,
                comments: toArray(
                  q
                    .from({ c: comments })
                    .where(({ c }) => eq(c.issueId, i.id))
                    .select(({ c }) => ({
                      id: c.id,
                      body: c.body,
                    })),
                ),
              })),
          ),
        })),
      )

      const result = collection.toArray[0]!
      expectTypeOf(result.id).toEqualTypeOf<number>()
      expectTypeOf(result.$synced).toEqualTypeOf<boolean>()
      expectTypeOf(result.$origin).toEqualTypeOf<`local` | `remote`>()
      expectTypeOf(result.$key).toEqualTypeOf<string | number>()
      expectTypeOf(result.$collectionId).toEqualTypeOf<string>()
      expectTypeOf(result.issues[0]!).toMatchTypeOf<
        WithVirtualProps<{
          id: number
          title: string
          comments: Array<WithVirtualProps<{ id: number; body: string }>>
        }>
      >()
    })
  })
})
