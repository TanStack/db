import { describe, expectTypeOf, test } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'

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
      expectTypeOf(result.issues).toMatchTypeOf<
        Collection<{ id: number; title: string }>
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
      expectTypeOf(result.issues).toMatchTypeOf<Collection<Issue>>()
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
      expectTypeOf(result.issues).toMatchTypeOf<
        Collection<{ id: number; title: string }>
      >()
      expectTypeOf(result.comments).toMatchTypeOf<
        Collection<{ id: number; body: string }>
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
      expectTypeOf(result.issues).toMatchTypeOf<
        Collection<{
          id: number
          title: string
          comments: Collection<{ id: number; body: string }>
        }>
      >()
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

      type ProjectWithIssueArray = {
        id: number
        name: string
        issues: Array<{
          id: number
          title: string
        }>
      }

      const result = collection.toArray[0]!
      expectTypeOf(result).toEqualTypeOf<ProjectWithIssueArray>()
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

      type ProjectWithFullIssueArray = {
        id: number
        issues: Array<Issue>
      }

      const result = collection.toArray[0]!
      expectTypeOf(result).toEqualTypeOf<ProjectWithFullIssueArray>()
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

      type ProjectWithNestedArrays = {
        id: number
        issues: Array<{
          id: number
          title: string
          comments: Array<{
            id: number
            body: string
          }>
        }>
      }

      const result = collection.toArray[0]!
      expectTypeOf(result).toEqualTypeOf<ProjectWithNestedArrays>()
    })
  })
})
